import { register } from "../router.js";
import * as core from "../../core/level_alert.js";

register("level-alert", {
  description:
    "Watch a symbol for a 15m candle closing beyond a marked price level and notify you (Pushover)",
  subcommands: new Map([
    [
      "check",
      {
        description:
          "Run one check cycle now: if the last closed 15m candle closed beyond --high or --low, notify",
        options: {
          symbol: {
            type: "string",
            short: "s",
            description: "Symbol to watch (default: $LEVEL_ALERT_SYMBOL env var)",
          },
          high: {
            type: "string",
            description: "Alert if the close is above this price (default: $LEVEL_ALERT_HIGH env var)",
          },
          low: {
            type: "string",
            description: "Alert if the close is below this price (default: $LEVEL_ALERT_LOW env var)",
          },
          "dry-run": {
            type: "boolean",
            description: "Check and print what would be sent, without sending or updating state",
          },
        },
        handler: async ({ symbol, high, low, "dry-run": dryRun }) =>
          core.checkLevelBreak({
            symbol: symbol || process.env.LEVEL_ALERT_SYMBOL,
            high: high != null ? Number(high) : (process.env.LEVEL_ALERT_HIGH ? Number(process.env.LEVEL_ALERT_HIGH) : null),
            low: low != null ? Number(low) : (process.env.LEVEL_ALERT_LOW ? Number(process.env.LEVEL_ALERT_LOW) : null),
            dry_run: !!dryRun,
          }),
      },
    ],
  ]),
});
