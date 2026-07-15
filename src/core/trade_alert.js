/**
 * Trade alert watcher — scans the watchlist, asks Claude for a genuine
 * confidence read against the user's rules.json bias/risk criteria, and
 * texts the user (via Twilio) when confidence crosses a threshold.
 *
 * Designed to run standalone (no live Claude Code session) via `tv alert check`
 * on a schedule (cron/launchd) — see scripts/com.tradingview-mcp.trade-alert.plist.example.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as morning from "./morning.js";

const STATE_DIR = join(homedir(), ".tradingview-mcp");
const STATE_PATH = join(STATE_DIR, "alert_state.json");

const SIGNAL_SCHEMA = {
  type: "object",
  properties: {
    signals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          direction: {
            type: "string",
            enum: ["bullish", "bearish", "neutral"],
          },
          confidence: {
            type: "integer",
            description: "0-100, how confident you are this is a high-conviction entry right now",
          },
          key_level: { anyOf: [{ type: "number" }, { type: "null" }] },
          reasoning: { type: "string" },
        },
        required: [
          "symbol",
          "direction",
          "confidence",
          "key_level",
          "reasoning",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["signals"],
  additionalProperties: false,
};

function loadAlertState() {
  if (!existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveAlertState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function evaluateSignals({ rules, symbolsScanned }) {
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_ALERT_MODEL || "claude-opus-4-8";
  const effort = process.env.ANTHROPIC_ALERT_EFFORT || "medium";

  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: {
      effort,
      format: { type: "json_schema", schema: SIGNAL_SCHEMA },
    },
    system: [
      "You evaluate whether right now is a high-conviction trade entry, for a trader who only wants a text message when you are genuinely confident.",
      "Apply the user's bias_criteria and risk_rules literally to the indicator and price data given for each symbol — do not invent criteria that aren't there.",
      "Be conservative: confidence should reflect real conviction, not enthusiasm. Most checks should NOT produce a high confidence score.",
      "direction 'neutral' means there is no actionable setup right now, regardless of confidence.",
    ].join(" "),
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          bias_criteria: rules.bias_criteria || null,
          risk_rules: rules.risk_rules || null,
          notes: rules.notes || null,
          symbols: symbolsScanned,
        }),
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) {
    throw new Error(
      `No text response from ${model} (stop_reason: ${response.stop_reason})`,
    );
  }
  const parsed = JSON.parse(textBlock.text);
  return parsed.signals.map((s) => ({
    ...s,
    confidence: Math.max(0, Math.min(100, Math.round(s.confidence))),
  }));
}

async function sendSms({ to, from, body }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error(
      "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set — see .env.example",
    );
  }
  if (!to || !from) {
    throw new Error(
      "ALERT_TO_NUMBER / TWILIO_FROM_NUMBER not set — see .env.example",
    );
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    },
  );
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(
      `Twilio error ${resp.status}: ${data.message || JSON.stringify(data)}`,
    );
  }
  return data;
}

export async function checkForSignals({ rules_path, dry_run = false } = {}) {
  const brief = await morning.runBrief({ rules_path });
  const symbolsScanned = brief.symbols_scanned.filter((s) => !s.error);

  if (!symbolsScanned.length) {
    return {
      success: true,
      checked_at: new Date().toISOString(),
      dry_run,
      signals: [],
      texts_sent: [],
      note: "No symbols scanned successfully — nothing to evaluate.",
    };
  }

  const signals = await evaluateSignals({ rules: brief.rules, symbolsScanned });

  const threshold = Number(process.env.ALERT_CONFIDENCE_THRESHOLD || 85);
  const cooldownMs =
    Number(process.env.ALERT_COOLDOWN_MINUTES || 120) * 60 * 1000;
  const state = loadAlertState();
  const now = Date.now();
  const textsSent = [];

  for (const signal of signals) {
    if (signal.direction === "neutral" || signal.confidence < threshold) {
      continue;
    }

    const key = `${signal.symbol}:${signal.direction}`;
    const lastSent = state[key] ? new Date(state[key]).getTime() : 0;
    if (now - lastSent < cooldownMs) continue;

    const body =
      `${signal.symbol} ${signal.direction.toUpperCase()} ${signal.confidence}% — ${signal.reasoning}`.slice(
        0,
        300,
      );

    if (!dry_run) {
      await sendSms({
        to: process.env.ALERT_TO_NUMBER,
        from: process.env.TWILIO_FROM_NUMBER,
        body,
      });
      state[key] = new Date(now).toISOString();
    }

    textsSent.push({
      symbol: signal.symbol,
      direction: signal.direction,
      confidence: signal.confidence,
      body,
      sent: !dry_run,
    });
  }

  if (!dry_run && textsSent.length) saveAlertState(state);

  return {
    success: true,
    checked_at: new Date().toISOString(),
    dry_run,
    threshold,
    signals,
    texts_sent: textsSent,
  };
}
