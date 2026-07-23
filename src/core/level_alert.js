/**
 * Level-break alert watcher — notifies (Pushover) the moment a 15m candle
 * *closes* beyond a manually marked price level (e.g. today's session open,
 * yesterday's close — whatever levels are passed in). Deliberately simple:
 * no strategy logic, just "did the last closed bar's close price cross a
 * line you drew," for watching a specific live setup rather than a
 * backtested edge.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as chart from "./chart.js";
import * as data from "./data.js";
import * as capture from "./capture.js";

const STATE_DIR = join(homedir(), ".tradingview-mcp");
const STATE_PATH = join(STATE_DIR, "level_alert_state.json");
const PUSHOVER_API_URL = "https://api.pushover.net/1/messages.json";
const TIMEFRAME = "15";

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
  const respData = await resp.json();
  if (!resp.ok || respData.status !== 1) {
    throw new Error(
      `Pushover error ${resp.status}: ${respData.errors ? respData.errors.join(", ") : JSON.stringify(respData)}`,
    );
  }
  return respData;
}

function tickerPart(symbol) {
  const idx = symbol.lastIndexOf(":");
  return (idx === -1 ? symbol : symbol.slice(idx + 1)).toUpperCase();
}

async function verifySymbolResolved(symbol, { maxAttempts = 5, gapMs = 1500 } = {}) {
  const wantTicker = tickerPart(symbol);
  for (let i = 0; i < maxAttempts; i++) {
    const state = await chart.getState();
    if (state && tickerPart(state.symbol) === wantTicker) return true;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return false;
}

/**
 * Checks whether the most recently *closed* 15m bar broke above `high` or
 * below `low`, and alerts once per break (won't re-alert every subsequent
 * bar that stays beyond the level — tracks the last bar time it already
 * alerted on).
 */
export async function checkLevelBreak({ symbol, high, low, dry_run = false } = {}) {
  if (!symbol) throw new Error("symbol is required");
  if (high == null && low == null) throw new Error("at least one of high/low is required");

  let originalSymbol, originalTimeframe;
  try {
    const currentState = await chart.getState();
    originalSymbol = currentState.symbol;
    originalTimeframe = currentState.resolution;
  } catch (_) {}

  const state = loadState();
  const key = `${symbol}:${high ?? "-"}:${low ?? "-"}`;
  const symbolState = state[key] || {};

  const result = { symbol, high, low, dry_run, checked_at: new Date().toISOString() };

  try {
    await chart.setSymbol({ symbol });
    await new Promise((r) => setTimeout(r, 1200));

    const resolved = await verifySymbolResolved(symbol);
    if (!resolved) {
      result.error = "Chart did not resolve to this symbol — skipped";
      return result;
    }

    await chart.setTimeframe({ timeframe: TIMEFRAME });
    await new Promise((r) => setTimeout(r, 1200));

    // Last 2 bars: [-2] is the most recently *closed* bar, [-1] is the
    // still-forming live bar (whose close keeps changing until it closes).
    const bars = await data.getOhlcv({ count: 2, summary: false });
    if (!bars.success || !bars.bars || bars.bars.length < 2) {
      result.error = "Not enough bar data returned";
      return result;
    }
    const lastClosed = bars.bars[bars.bars.length - 2];

    result.last_closed_bar_time = lastClosed.time;
    result.last_closed_close = lastClosed.close;

    const alreadyAlertedThisBar = symbolState.lastAlertedBarTime === lastClosed.time;

    let breakDirection = null;
    if (high != null && lastClosed.close > high) breakDirection = "above";
    else if (low != null && lastClosed.close < low) breakDirection = "below";

    if (breakDirection && !alreadyAlertedThisBar) {
      const level = breakDirection === "above" ? high : low;
      const title = `${symbol} — 15m close ${breakDirection} ${level}`;
      const body =
        `${symbol}: the last 15m candle closed at ${lastClosed.close}, ${breakDirection} your marked ` +
        `level of ${level}. This is a raw price-level break, not a strategy signal — judge the entry yourself.`;

      let imagePath;
      if (!dry_run) {
        try {
          const shot = await capture.captureScreenshot({
            region: "chart",
            filename: `level_alert_${symbol.replace(/[:!]/g, "_")}_${Date.now()}`,
          });
          if (shot.success && shot.file_path) imagePath = shot.file_path;
        } catch (err) {
          console.error(`Screenshot skipped: ${err.message}`);
        }
        await sendPushover({ title, message: body, imagePath });
      }

      result.alert_sent = {
        direction: breakDirection,
        level,
        close: lastClosed.close,
        title,
        body,
        photo_attached: Boolean(imagePath),
        sent: !dry_run,
      };

      if (!dry_run) {
        symbolState.lastAlertedBarTime = lastClosed.time;
        state[key] = symbolState;
      }
    } else {
      result.alert_sent = null;
    }
  } catch (err) {
    result.error = err.message;
  }

  if (originalSymbol) {
    try {
      await chart.setSymbol({ symbol: originalSymbol });
      await new Promise((r) => setTimeout(r, 1200));
      if (originalTimeframe) await chart.setTimeframe({ timeframe: originalTimeframe });
    } catch (_) {}
  }

  if (!dry_run) saveState(state);

  return result;
}
