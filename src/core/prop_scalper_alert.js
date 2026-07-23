/**
 * Prop Firm Scalper alert watcher — watches the live "Prop Firm Scalper
 * [Keagan]" strategy on a small symbol list and notifies (via Pushover) the
 * moment it actually enters a real trade. Same mechanism as orb_alert.js:
 * no LLM judgment call, the Pine strategy's own deterministic entry logic
 * (Bollinger/RSI mean reversion gated by an ADX regime filter) IS the
 * signal, so "a good buy-in moment" means "the strategy just placed a real
 * order," not a separate confidence read.
 *
 * Default symbol list is deliberately just the two markets this strategy
 * has an actual verified backtested edge on so far (see
 * PROP_SCALPER_SPEC.md) — ES1!/NQ1!, not "any market". EURUSD/AAPL are
 * pending re-verification after the 2026-07-23 position-sizing fix and
 * should not be added here until that's confirmed.
 *
 * Designed to run standalone (no live Claude Code session) via
 * `tv prop-scalper-alert check` on a schedule (cron/launchd), same pattern
 * as orb_alert.js/trade_alert.js.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { evaluate } from "../connection.js";
import * as chart from "./chart.js";
import * as capture from "./capture.js";

const STATE_DIR = join(homedir(), ".tradingview-mcp");
const STATE_PATH = join(STATE_DIR, "prop_scalper_alert_state.json");
const PUSHOVER_API_URL = "https://api.pushover.net/1/messages.json";
const CHART_API = "window.TradingViewApi._activeChartWidgetWV.value()";
const STRATEGY_NAME = "Prop Firm Scalper [Keagan]";
const STRATEGY_TIMEFRAME = "15"; // matches the timeframe the strategy was backtested/tuned on

function loadState() {
  if (!existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Sends a Pushover notification, optionally with a chart screenshot attached
 * directly in the request body (same approach as orb_alert.js/trade_alert.js).
 */
async function sendPushover({ title, message, imagePath }) {
  const token = process.env.PUSHOVER_API_TOKEN;
  const user = process.env.PUSHOVER_USER_KEY;
  if (!token || !user) {
    throw new Error(
      "PUSHOVER_API_TOKEN / PUSHOVER_USER_KEY not set — see .env.example",
    );
  }

  const form = new FormData();
  form.append("token", token);
  form.append("user", user);
  form.append("title", title);
  form.append("message", message);
  if (imagePath) {
    const buffer = readFileSync(imagePath);
    form.append("attachment", new Blob([buffer], { type: "image/png" }), "chart.png");
  }

  const resp = await fetch(PUSHOVER_API_URL, { method: "POST", body: form });
  const data = await resp.json();
  if (!resp.ok || data.status !== 1) {
    throw new Error(
      `Pushover error ${resp.status}: ${data.errors ? data.errors.join(", ") : JSON.stringify(data)}`,
    );
  }
  return data;
}

async function findStrategyEntityId() {
  const studies = await evaluate(
    `${CHART_API}.getAllStudies().map(function(s) { return {id: s.id, name: s.name}; })`,
  );
  const match = (studies || []).find((s) => s.name === STRATEGY_NAME);
  return match ? match.id : null;
}

async function ensureStrategyOnChart() {
  const existing = await findStrategyEntityId();
  if (existing) return existing;
  const result = await chart.manageIndicator({
    action: "add",
    indicator: STRATEGY_NAME,
  });
  if (!result.success || !result.entity_id) {
    throw new Error(`Could not add "${STRATEGY_NAME}" to the chart`);
  }
  await new Promise((r) => setTimeout(r, 1500));
  return result.entity_id;
}

/**
 * Every order fill (entries AND exits) the strategy has made, oldest first,
 * plus the current backtested performance snapshot (win rate / profit
 * factor / trade count) for the symbol currently on the chart — included in
 * alert messages so a signal always comes with the honest track record
 * behind it, not just a bare direction.
 * `e: true` marks an entry fill — that's the actual "buy-in moment".
 */
async function getFilledOrders(entityId) {
  const result = await evaluate(`
    (function() {
      var study = ${CHART_API}.getStudyById('${entityId}');
      if (!study) return null;
      var model = study.study();
      if (!model) return null; // strategy model not ready yet (e.g. still loading after a symbol switch)
      var report = model.reportData();
      if (!report) return null;
      var perf = report.performance && report.performance.all;
      return JSON.parse(JSON.stringify({
        orders: report.filledOrders || [],
        performance: perf ? {
          totalTrades: perf.totalTrades,
          winRate: perf.percentProfitable,
          profitFactor: perf.profitFactor,
          netProfit: perf.netProfit,
        } : null,
      }));
    })()
  `);
  return result;
}

/**
 * Polls filledOrders() until the count is identical across consecutive
 * reads (reportData() can return transient/stale values right after a
 * symbol switch or recalculation — see CLAUDE.md). Requires 3 consecutive
 * matches, not 2, per the same lesson learned building orb_alert.js.
 */
async function getStableFilledOrders(entityId, { maxAttempts = 8, gapMs = 2500, requiredStreak = 3 } = {}) {
  let last = null;
  let stableStreak = 0;
  let result = null;
  for (let i = 0; i < maxAttempts && stableStreak < requiredStreak; i++) {
    result = await getFilledOrders(entityId);
    const len = result && result.orders ? result.orders.length : 0;
    if (last !== null && len === last) stableStreak++;
    else stableStreak = 0;
    last = len;
    if (stableStreak < requiredStreak) await new Promise((r) => setTimeout(r, gapMs));
  }
  return result;
}

function tickerPart(symbol) {
  const idx = symbol.lastIndexOf(":");
  return (idx === -1 ? symbol : symbol.slice(idx + 1)).toUpperCase();
}

/**
 * Confirms the chart actually resolved to the requested symbol before
 * trusting any report read against it — TradingView can silently fall back
 * to a different (previously-loaded) symbol on a failed switch, with
 * `chart_ready`/`state` still reporting a plausible-looking success. See
 * CLAUDE.md's "tv symbol --set" fragility notes.
 */
async function verifySymbolResolved(symbol, { maxAttempts = 5, gapMs = 1500 } = {}) {
  const wantTicker = tickerPart(symbol);
  for (let i = 0; i < maxAttempts; i++) {
    const state = await chart.getState();
    if (state && tickerPart(state.symbol) === wantTicker) return true;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return false;
}

export async function checkPropScalperSignal({ symbols, dry_run = false } = {}) {
  const symbolList =
    symbols && symbols.length
      ? symbols
      : (process.env.PROP_SCALPER_ALERT_SYMBOLS || "CME_MINI:ES1!,CME_MINI:NQ1!")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

  const cooldownMs =
    Number(process.env.PROP_SCALPER_ALERT_COOLDOWN_MINUTES || 15) * 60 * 1000;

  let originalSymbol, originalTimeframe;
  try {
    const currentState = await chart.getState();
    originalSymbol = currentState.symbol;
    originalTimeframe = currentState.resolution;
  } catch (_) {}

  const state = loadState();
  const now = Date.now();
  const checked = [];
  const alertsSent = [];

  for (const symbol of symbolList) {
    try {
      await chart.setSymbol({ symbol });
      await new Promise((r) => setTimeout(r, 1200));

      const resolved = await verifySymbolResolved(symbol);
      if (!resolved) {
        checked.push({ symbol, error: "Chart did not resolve to this symbol — skipped to avoid reading another symbol's data" });
        continue;
      }

      await chart.setTimeframe({ timeframe: STRATEGY_TIMEFRAME });
      await new Promise((r) => setTimeout(r, 1200));

      const entityId = await ensureStrategyOnChart();
      const stable = await getStableFilledOrders(entityId);
      if (stable === null) {
        checked.push({ symbol, error: "Strategy report not ready (study still loading) — skipped this cycle" });
        continue;
      }
      const orders = stable.orders;
      const performance = stable.performance;
      const orderCount = orders.length;

      const symbolState = state[symbol] || {};
      // Same fingerprint-based diffing as orb_alert.js — the backtest
      // window rolls forward with real time, so filledOrders.length can
      // shrink and a raw count/index comparison would silently miss a new
      // entry once the array is shorter than the last-seen count.
      const lastFp = symbolState.lastEntryFingerprint ?? null;
      let newEntries = [];
      if (orders) {
        if (lastFp === null) {
          newEntries = []; // first run for this symbol — establish baseline only
        } else {
          const idx = orders.findLastIndex(
            (o) => o.e === true && `${o.c}:${o.p}:${o.q}` === lastFp,
          );
          newEntries = idx === -1
            ? [] // fingerprint rolled off the window — resync, don't guess
            : orders.slice(idx + 1).filter((o) => o.e === true);
        }
      }

      checked.push({ symbol, filled_order_count: orderCount, new_entries: newEntries.length });

      if (newEntries.length) {
        const latest = newEntries[newEntries.length - 1];
        const direction = latest.c === "Long" ? "LONG" : "SHORT";
        const lastAlertAt = symbolState.lastAlertAt || {};
        const lastAlertTime = lastAlertAt[latest.c]
          ? new Date(lastAlertAt[latest.c]).getTime()
          : 0;

        if (now - lastAlertTime >= cooldownMs) {
          const title = `${symbol} — Prop Scalper ${direction} entry`;
          const perfLine = performance
            ? ` Backtested track record on this chart right now: ${(performance.winRate * 100).toFixed(0)}% win rate, ` +
              `profit factor ${performance.profitFactor.toFixed(2)}, over ${performance.totalTrades} trades ` +
              `(net ${performance.netProfit >= 0 ? "+" : ""}$${performance.netProfit.toFixed(0)}). ` +
              `${performance.winRate < 0.33 || performance.netProfit < 0 ? "This symbol has NOT had a real edge historically — treat this signal with caution, not confidence." : ""}`
            : " (backtest stats unavailable this cycle)";
          const body =
            `${symbol}: Prop Firm Scalper [Keagan] just entered ${direction} at ${latest.p} ` +
            `(qty ${latest.q}).${perfLine} This is a deterministic strategy signal from a same-day, ` +
            `not-yet-forward-tested strategy, not investment advice — see PROP_SCALPER_SPEC.md before acting on it.`;

          let imagePath;
          if (!dry_run) {
            try {
              const shot = await capture.captureScreenshot({
                region: "chart",
                filename: `prop_scalper_alert_${symbol.replace(/[:!]/g, "_")}_${now}`,
              });
              if (shot.success && shot.file_path) imagePath = shot.file_path;
            } catch (err) {
              console.error(`Screenshot skipped: ${err.message}`);
            }
            await sendPushover({ title, message: body, imagePath });
          }

          alertsSent.push({
            symbol,
            direction,
            price: latest.p,
            qty: latest.q,
            title,
            body,
            photo_attached: Boolean(imagePath),
            sent: !dry_run,
          });

          if (!dry_run) {
            symbolState.lastAlertAt = { ...lastAlertAt, [latest.c]: new Date(now).toISOString() };
          }
        }
      }

      if (!dry_run) {
        const allEntries = orders ? orders.filter((o) => o.e === true) : [];
        const newestEntry = allEntries[allEntries.length - 1];
        if (newestEntry) {
          symbolState.lastEntryFingerprint = `${newestEntry.c}:${newestEntry.p}:${newestEntry.q}`;
        }
        symbolState.filledOrderCount = orderCount; // kept for visibility/debugging only, not used for diffing
        state[symbol] = symbolState;
      }
    } catch (err) {
      checked.push({ symbol, error: err.message });
    }
  }

  if (originalSymbol) {
    try {
      await chart.setSymbol({ symbol: originalSymbol });
      await new Promise((r) => setTimeout(r, 1200));
      if (originalTimeframe) await chart.setTimeframe({ timeframe: originalTimeframe });
    } catch (_) {}
  }

  if (!dry_run) saveState(state);

  return {
    success: true,
    checked_at: new Date().toISOString(),
    dry_run,
    cooldown_minutes: cooldownMs / 60000,
    checked,
    alerts_sent: alertsSent,
  };
}
