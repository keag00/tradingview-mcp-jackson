/**
 * ORB EMA Trend alert watcher — watches the live "ORB EMA Trend [Keagan]"
 * strategy on a small symbol list and notifies (via Pushover) the moment it
 * actually enters a real trade. Unlike trade_alert.js this makes no LLM
 * judgment call: the Pine strategy's own tuned, deterministic entry logic
 * (opening-range breakout + EMA + daily-trend filter) IS the signal, so a
 * "good buy-in moment" here means "the strategy just placed a real order",
 * not a separate confidence read.
 *
 * Designed to run standalone (no live Claude Code session) via `tv orb-alert
 * check` on a schedule (cron/launchd), same pattern as trade_alert.js.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { evaluate } from "../connection.js";
import * as chart from "./chart.js";
import * as capture from "./capture.js";

const STATE_DIR = join(homedir(), ".tradingview-mcp");
const STATE_PATH = join(STATE_DIR, "orb_alert_state.json");
const PUSHOVER_API_URL = "https://api.pushover.net/1/messages.json";
const CHART_API = "window.TradingViewApi._activeChartWidgetWV.value()";
const STRATEGY_NAME = "ORB EMA Trend [Keagan]";
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
 * directly in the request body (same approach as trade_alert.js).
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
 * Every order fill (entries AND exits) the strategy has made, oldest first.
 * `e: true` marks an entry fill — that's the actual "buy-in moment".
 */
async function getFilledOrders(entityId) {
  const orders = await evaluate(`
    (function() {
      var study = ${CHART_API}.getStudyById('${entityId}');
      if (!study) return null;
      var report = study.study().reportData();
      return JSON.parse(JSON.stringify(report.filledOrders || []));
    })()
  `);
  return orders;
}

/**
 * Polls filledOrders() until the count is identical across consecutive
 * reads (reportData() can return transient/stale values right after a
 * symbol switch or recalculation — see CLAUDE.md).
 */
async function getStableFilledOrders(entityId, { maxAttempts = 6, gapMs = 2500 } = {}) {
  let last = null;
  let stableStreak = 0;
  for (let i = 0; i < maxAttempts && stableStreak < 2; i++) {
    const orders = await getFilledOrders(entityId);
    const len = orders ? orders.length : 0;
    if (last !== null && len === last) stableStreak++;
    else stableStreak = 0;
    last = len;
    if (stableStreak < 2) await new Promise((r) => setTimeout(r, gapMs));
    if (i === maxAttempts - 1) return orders;
  }
  return getFilledOrders(entityId);
}

export async function checkOrbSignal({ symbols, dry_run = false } = {}) {
  const symbolList =
    symbols && symbols.length
      ? symbols
      : (process.env.ORB_ALERT_SYMBOLS || "COMEX:GC1!")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

  const cooldownMs =
    Number(process.env.ORB_ALERT_COOLDOWN_MINUTES || 15) * 60 * 1000;

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
      await chart.setTimeframe({ timeframe: STRATEGY_TIMEFRAME });
      await new Promise((r) => setTimeout(r, 1200));

      const entityId = await ensureStrategyOnChart();
      const orders = await getStableFilledOrders(entityId);
      const orderCount = orders ? orders.length : 0;

      const symbolState = state[symbol] || {};
      const lastSeenCount = symbolState.filledOrderCount ?? orderCount;
      const newOrders = orders ? orders.slice(lastSeenCount) : [];
      const newEntries = newOrders.filter((o) => o.e === true);

      checked.push({ symbol, filled_order_count: orderCount, new_entries: newEntries.length });

      if (newEntries.length) {
        const latest = newEntries[newEntries.length - 1];
        const direction = latest.c === "Long" ? "LONG" : "SHORT";
        const lastAlertAt = symbolState.lastAlertAt || {};
        const lastAlertTime = lastAlertAt[latest.c]
          ? new Date(lastAlertAt[latest.c]).getTime()
          : 0;

        if (now - lastAlertTime >= cooldownMs) {
          const title = `${symbol} — ORB EMA ${direction} entry`;
          const body =
            `${symbol}: ORB EMA Trend [Keagan] just entered ${direction} at ${latest.p} ` +
            `(qty ${latest.q}). This is a real, deterministic strategy signal from a backtested ` +
            `Pine script, not investment advice — see ORB_STRATEGY_SPEC.md for the real numbers ` +
            `and caveats before acting on it.`;

          let imagePath;
          if (!dry_run) {
            try {
              const shot = await capture.captureScreenshot({
                region: "chart",
                filename: `orb_alert_${symbol.replace(/[:!]/g, "_")}_${now}`,
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
        symbolState.filledOrderCount = orderCount;
        state[symbol] = symbolState;
      }
    } catch (err) {
      checked.push({ symbol, error: err.message });
    }
  }

  if (originalSymbol) {
    try {
      await chart.setSymbol({ symbol: originalSymbol });
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
