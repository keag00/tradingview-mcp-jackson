import { register } from "../router.js";
import * as core from "../../core/orb_alert.js";

register("orb-alert", {
  description:
    "Watch the ORB EMA Trend strategy on your symbol list and notify you (Pushover) the moment it enters a real trade",
  subcommands: new Map([
    [
      "check",
      {
        description:
          "Run one check cycle now: for each symbol, ensure the strategy is on the chart, check for new order fills since last check, notify on new entries",
        options: {
          symbols: {
            type: "string",
            short: "s",
            description:
              "Comma-separated symbol list (default: $ORB_ALERT_SYMBOLS env var, or COMEX:GC1!)",
          },
          "dry-run": {
            type: "boolean",
            description:
              "Check and print what would be sent, without sending a notification or updating cooldown state",
          },
        },
        handler: async ({ symbols, "dry-run": dryRun }) =>
          core.checkOrbSignal({
            symbols: symbols ? symbols.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
            dry_run: !!dryRun,
          }),
      },
    ],
  ]),
});
