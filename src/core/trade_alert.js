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
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import * as morning from "./morning.js";
import * as capture from "./capture.js";

const STATE_DIR = join(homedir(), ".tradingview-mcp");
const STATE_PATH = join(STATE_DIR, "alert_state.json");

const TUNNEL_URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const TUNNEL_STARTUP_TIMEOUT_MS = 20000;
// cloudflared's quick-tunnel DNS record can take ~10-20s to propagate after
// the URL is printed — polling until the tunnel actually answers avoids
// handing Twilio a MediaUrl that isn't resolvable yet (Twilio does not retry).
// A query made too early gets negatively cached by the resolver and poisons
// every retry after it, so wait out an initial grace period untested before
// polling at all — confirmed empirically: 0 grace period never recovers
// within 30s of retries, a 12s grace period succeeds on the first poll.
const TUNNEL_READY_GRACE_MS = 12000;
const TUNNEL_READY_TIMEOUT_MS = 30000;
const TUNNEL_READY_POLL_MS = 2000;
const DELIVERY_POLL_MS = 2000;
const DELIVERY_TIMEOUT_MS = 45000;

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

function twilioAuthHeader() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error(
      "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set — see .env.example",
    );
  }
  return { sid, header: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` };
}

async function sendSms({ to, from, body, mediaUrl }) {
  const { sid, header } = twilioAuthHeader();
  if (!to || !from) {
    throw new Error(
      "ALERT_TO_NUMBER / TWILIO_FROM_NUMBER not set — see .env.example",
    );
  }

  const params = { To: to, From: from, Body: body };
  if (mediaUrl) params.MediaUrl = mediaUrl;

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: header,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
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

async function waitForMessageDelivery(messageSid) {
  const { sid, header } = twilioAuthHeader();
  const deadline = Date.now() + DELIVERY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, DELIVERY_POLL_MS));
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages/${messageSid}.json`,
      { headers: { Authorization: header } },
    );
    const data = await resp.json();
    if (["delivered", "sent", "failed", "undelivered"].includes(data.status)) {
      return data.status;
    }
  }
  return "timeout";
}

/**
 * Serves `filePath` over a loopback-only HTTP server and exposes it via a
 * cloudflared "quick tunnel" (no account/config needed) so Twilio's servers
 * can fetch it as MMS media. Caller must call the returned cleanup() once
 * delivery is confirmed (or times out) to tear down the tunnel + server.
 */
async function startImageTunnel(filePath) {
  const imageBuffer = readFileSync(filePath);
  const server = createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": imageBuffer.length,
    });
    res.end(req.method === "HEAD" ? undefined : imageBuffer);
  });

  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  const port = server.address().port;

  const cloudflared = spawn(
    "cloudflared",
    ["tunnel", "--url", `http://127.0.0.1:${port}`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const cleanup = () => {
    cloudflared.kill();
    server.close();
  };

  try {
    const tunnelUrl = await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for cloudflared tunnel URL"));
      }, TUNNEL_STARTUP_TIMEOUT_MS);

      const onData = (chunk) => {
        output += chunk.toString();
        const match = output.match(TUNNEL_URL_REGEX);
        if (match) {
          clearTimeout(timeout);
          resolve(match[0]);
        }
      };
      cloudflared.stdout.on("data", onData);
      cloudflared.stderr.on("data", onData);
      cloudflared.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      cloudflared.once("exit", (code) => {
        if (code !== 0 && code !== null) {
          clearTimeout(timeout);
          reject(new Error(`cloudflared exited early with code ${code}`));
        }
      });
    });

    await new Promise((r) => setTimeout(r, TUNNEL_READY_GRACE_MS));

    const deadline = Date.now() + TUNNEL_READY_TIMEOUT_MS;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(tunnelUrl, { method: "HEAD" });
        if (resp.ok) {
          ready = true;
          break;
        }
      } catch {
        // DNS/tunnel not propagated yet — keep polling until the deadline.
      }
      await new Promise((r) => setTimeout(r, TUNNEL_READY_POLL_MS));
    }
    if (!ready) {
      throw new Error("Tunnel never became reachable before timeout");
    }

    return { url: tunnelUrl, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
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

    const position = signal.direction === "bullish" ? "LONG" : "SHORT";
    const moveWord = signal.direction === "bullish" ? "up" : "down";
    const keyLevel = signal.key_level != null ? signal.key_level : "n/a";
    const body =
      `${signal.symbol} — ${position} — ${signal.confidence}% probability it moves ${moveWord}. Key level: ${keyLevel}. ${signal.reasoning}`.slice(
        0,
        300,
      );

    let photoAttached = false;

    if (!dry_run) {
      let tunnel;
      try {
        const shot = await capture.captureScreenshot({
          region: "chart",
          filename: `alert_${signal.symbol}_${now}`,
        });
        if (shot.success && shot.file_path) {
          tunnel = await startImageTunnel(shot.file_path);
        }
      } catch (err) {
        // Photo attach is best-effort — never let it block the actual alert.
        console.error(`Photo attach skipped: ${err.message}`);
      }

      try {
        const sent = await sendSms({
          to: process.env.ALERT_TO_NUMBER,
          from: process.env.TWILIO_FROM_NUMBER,
          body,
          mediaUrl: tunnel?.url,
        });
        photoAttached = Boolean(tunnel);

        if (tunnel) await waitForMessageDelivery(sent.sid);
      } finally {
        tunnel?.cleanup();
      }

      state[key] = new Date(now).toISOString();
    }

    textsSent.push({
      symbol: signal.symbol,
      direction: signal.direction,
      confidence: signal.confidence,
      body,
      photo_attached: photoAttached,
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
