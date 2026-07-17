# ICT Concepts + Doji Scanner — Strategy Spec

Living spec for Keagan's custom GBP/USD chart-analysis project, built on top of this MCP server. Keep this file updated as requirements are added — this is an ongoing, multi-session build.

## Instrument

- Primary chart: **GBPUSD** spot forex. Use `OANDA:GBPUSD` (or another retail forex feed) — do **not** use bare `GBPUSD` or `FX:GBPUSD` in `chart_set_symbol`/`tv symbol --set`, it resolves to `CME_DL:6BU2026` (British Pound *futures*, a different instrument) on this account, likely because of a linked futures broker. Always verify with `tv state` after setting the symbol and confirm the title bar / exchange reads `OANDA` (or your preferred forex broker), not `CME`.

## Implementation

The indicator is developed via the `pine-develop` skill workflow (`node scripts/pine_push.js` / `pine_pull.js`) working out of `scripts/current.pine` (gitignored scratch buffer), and is loaded onto the chart as **"ICT Concepts + Doji Scanner [Keagan]"**. The persisted, version-controlled copy of the source lives at [`indicators/ict-concepts-doji-scanner.pine`](indicators/ict-concepts-doji-scanner.pine) — when you finish an editing session, copy `scripts/current.pine` over that file (`cp scripts/current.pine indicators/ict-concepts-doji-scanner.pine`) so the real deliverable doesn't just live in TradingView's cloud and the gitignored scratch file.

Architecture decision: everything is detected and drawn **natively in Pine Script** (not computed in JS + `draw_shape`), so it redraws live as the chart updates and matches how this repo's other custom indicators already work.

### Structure / ICT concepts (all toggleable via indicator inputs)

| Concept | Status | Logic |
|---|---|---|
| Trend bias (uptrend/downtrend/range) | ✅ v1, live override v4 (2026-07-15) | Compares last two confirmed swing highs/lows (HH/HL = uptrend, LH/LL = downtrend); a live/unconfirmed BOS (`liveBullBOS`/`liveBearBOS`) now overrides it immediately instead of waiting up to `swingLen` bars for the next confirmed pair, tagged "(live)" in the top-right table until structure confirms it |
| Break of Structure (BOS) | ✅ v1 | `close` crosses the last confirmed swing high/low |
| Liquidity sweep | ✅ v1 | Wick trades beyond a swing high/low but closes back inside it; only flags once per level |
| Fair Value Gap (FVG) | ✅ v1 | Classic 3-candle imbalance (`low > high[2]` / `high < low[2]`); box extends right only while unmitigated, freezes once price trades back through it |
| Order Block | ✅ v1 (simplified) | Last opposite-colour candle before a BOS impulse, searched back up to `obLookback` bars; box freezes once mitigated (price closes back through it) |
| Equilibrium / premium-discount | ✅ v1 | 50% midpoint of the current swing range (last swing high ↔ last swing low), with shaded premium/discount zones |
| Live (unconfirmed) swing high/low + live BOS | ✅ v2 (2026-07-15) | Rolling `ta.highest`/`ta.lowest` over a `swingLen`-derived window — no right-side confirmation bars needed, so it reacts intrabar instead of lagging `swingLen` bars behind the confirmed pivots above. Plotted as dotted yellow/orange circles; a "BOS?" triangle marks when price crosses it live. Toggle via `showLiveSwing` / `showLiveBOS`. |
| Previous Day/Week/Month High/Low (PDH/PDL/PWH/PWL/PMH/PML) | ✅ v3 (2026-07-15) | Non-repainting via `request.security(..., [high[1], low[1]], lookahead=barmerge.lookahead_off)` on `"D"`/`"W"`/`"M"` — always the last *completed* day/week/month. Silver dashed lines for day, blue dotted for week, fuchsia solid (width 2) for month, each labeled and extending from the start of that period to the current bar. Toggle via `showPDHL` / `showPWHL` / `showPMHL`. |
| Session highs/lows (Asia/London/NY) | ✅ v3 (2026-07-15) | Tracks the running high/low while each session (`input.session`, default Asia 1900-0400 / London 0300-1200 / NY 0800-1700, all America/New_York) is active; the line freezes and keeps extending right once the session ends, until the next occurrence resets it. Purple/blue/orange lines labeled "ASIA H/L", "LDN H/L", "NY H/L". Toggle via `showSessions`. |
| Macro / news context | ✅ v4 (2026-07-15) | Pine has no live internet access, so this is a manually-maintained layer: a `macroBias` input (Bullish/Bearish/Neutral, second row in the BIAS table, tooltip carries a free-text `macroNote`) plus up to 3 hand-entered high-impact event times (`event1Time`..`event3Time` + labels) that draw a vertical marker/label when reached and shade a `blackoutMins`-long no-trade background after each — reinforcing the `rules.json` risk rule of not trading around high-impact news. Current defaults reflect 2026-07-15 research: `macroBias` = Bullish (cooling US CPI + dovish Fed Chair Warsh testimony pressuring USD, i.e. GBP-supportive), with events set to the Jul 14 CPI release, Jul 14 Fed Chair testimony, and Jul 17 prelim consumer sentiment. **Needs manual refresh** — nothing here updates itself as new data comes out. |

### Doji patterns (exact set requested, each with its own show/hide input)

| Pattern | Status |
|---|---|
| Green Doji | ✅ v1 |
| Red Doji | ✅ v1 |
| Green Long-Legged Doji | ✅ v1 |
| Red Long-Legged Doji | ✅ v1 |
| Green Cross Doji | ✅ v1 |
| Red Inverted Cross Doji | ✅ v1 |
| Green Dragonfly Doji | ✅ v1 |
| Red Gravestone Doji | ✅ v1 |

Classification is mutually exclusive per candle, checked in priority order: **Dragonfly > Gravestone > Cross (symmetric wicks) > Long-Legged (long but asymmetric wicks) > plain Doji (fallback)**. Thresholds are tunable via inputs (`dojiBodyMaxPct`, `oppWickMaxPct`, `longLeggedWickMinPct`, `crossSymTolPct`) — the defaults are a reasonable starting point, not backtested.

Only the exact 8 color/shape combos above are marked (e.g. red dragonfly and green gravestone are *not* marked) because that's what was asked for. The classification variables already compute the shape for any color, so adding the mirror combos later is a one-line change per pattern if wanted.

## Known caveats / not yet done

- Order Block detection is a simplified heuristic (nearest opposite-colour candle before a BOS), not full ICT nuance (no distinction between breaker blocks, mitigation blocks, propulsion blocks, etc.)
- No backtesting/statistics on any of these signals yet — purely visual markup. (Partially addressed outside this indicator: the MCP server now has a replay-backtest journal — `replay_trade`/`journal_stats` — for testing `rules.json` bias criteria against history; the indicator's own signals still aren't tied into it.)
- Second instrument mentioned early on ("pound is the main one, second is GBP/USD") was clarified to mean GBPUSD is the only instrument for now — revisit if a second pair/cross is actually wanted later
- Doji thresholds are heuristic defaults — tune `dojiBodyMaxPct` / `oppWickMaxPct` / `longLeggedWickMinPct` / `crossSymTolPct` against real chart examples
- Session windows (Asia/London/NY) default to commonly-used ET ranges (1900-0400 / 0300-1200 / 0800-1700) — tune via the `showSessions` group's session inputs if Keagan's actual trading hours differ.
- Confirmed swing/BOS/Order Block structure still has an inherent `swingLen`-bar confirmation lag — `ta.pivothigh`/`ta.pivotlow` need that many bars *after* a pivot to validate it, which is fundamental to what ICT means by a "confirmed" swing, not a bug. The v2 live/unconfirmed layer (see table above) is the workaround for wanting a same-tick reaction; it can relabel which bar was the "swing" as new bars arrive, since it's provisional by design.
- Macro/news layer (v4) is inherently manual — Pine can't call out to the web, so `macroBias`/`macroNote`/event times are a snapshot of whatever research was done at edit time, not a live feed. Re-run the research and update the inputs periodically (or wire up a note in `rules.json`'s `notes` field and cross-reference it here) rather than trusting stale defaults.
- v4 was verified with `tv pine check` (server-side compile, 0 errors/0 warnings) but **not** pushed into the live on-chart copy in TradingView's cloud — the CDP-attached desktop window in that session was too narrow (1094×677 logical px) for TradingView's bottom widget bar to open Pine Editor at all (`bottomWidgetBar._enabledWidgetsConfigs` came back empty even after `activateScriptEditorTab`/dialog-button clicks). Run the normal `pine-develop` push/compile loop from a normally-sized window to get this onto the live chart.

## Real-time behavior (added 2026-07-15)

- Doji, FVG, and liquidity-sweep detection already react on every realtime tick by default (Pine indicators recalculate the still-forming bar on each price update) — no code gate was holding them to bar-close.
- Fixed a latent repaint bug: confirmed-BOS and FVG object creation (`line.new`/`box.new`) used live `close`/`high`/`low` inside a one-shot condition with no per-bar guard, so a price chopping back and forth around the level within a single unconfirmed bar could fire the condition on more than one tick and stack duplicate lines/boxes for what should be a single event. Added `bar_index`-based one-shot guards (`lastBullBosBar`/`lastBearBosBar`/`lastBullFvgBar`/`lastBearFvgBar`) — reacts on the first tick the condition trips, never duplicates. Order Block creation is nested under BOS so it inherited the fix for free.
- Added a genuinely lag-free live swing high/low (rolling `ta.highest`/`ta.lowest`) and a "live BOS" marker built on it, since the confirmed pivots are structurally lagged by `swingLen` bars — see the table above.

## Performance fix (2026-07-15)

- Found and fixed a real drawing-object churn bug: the Equilibrium/premium-discount line+boxes, PDH/PDL/PWH/PWL lines+labels, and the Asia/London/NY session H/L lines+labels were all being `line.delete()`/`box.delete()`'d and rebuilt from scratch on **every single bar** (not just when their values actually changed) — across the whole chart history on load and on every realtime tick. That's the classic Pine anti-pattern the docs warn against; it's very likely what "not running smoothly" was pointing at (flicker/lag on lower timeframes, extra load on every tick).
- Rewired all three to the idiomatic pattern: create the line/box/label objects once (`var ... = na`, create only when `na`), then move them in place on every other bar with `line.set_xy1`/`set_xy2`, `box.set_lefttop`/`set_rightbottom`, `label.set_x`/`set_y` instead of deleting and recreating. PDH/PWH and the session levels now only actually delete+recreate on the bar a new day/week/session instance begins (a handful of times a day) instead of every bar.
- Also dropped the redundant `var bool obFound*` flags in the Order Block search loops in favor of an early `break` once the nearest opposite-colour candle is found, instead of always scanning the full `obLookback` range.
- Visual behavior is unchanged — same lines, same values, same freeze-on-mitigation semantics — this is purely an internal efficiency fix. Verified via `tv pine analyze` (0 issues) and `tv pine check` (compiled successfully, 0 errors/0 warnings). Live in-app push (`tv pine set`) hit the known Monaco-fiber-tree fragility noted above and couldn't be used to visually re-confirm on this pass — worth a manual re-check in the TradingView Pine Editor next session.

## Alerts (added 2026-07-15)

`alertcondition()` calls are now wired up for the three actionable confirmed signals — **BOS** (bull/bear), **liquidity sweep** (high/low), and **FVG formed** (bull/bear) — 6 conditions total, selectable in TradingView's Alert dialog under this indicator's name. Doji patterns, order blocks, and PDH/PDL/session sweeps intentionally have no alerts, to keep the dropdown from turning into noise.

## New York Open Strategy (added 2026-07-17)

A concrete playbook for trading the NY session open using only signals this indicator already draws, built as a direct application of `rules.json`'s existing `bias_criteria`/`risk_rules` (not new criteria) — see `rules.json`'s `ny_open_playbook` key for the machine-readable version of the same steps. NY session per the indicator defaults to 0800-1700 ET; this playbook is scoped to the 0800-0930 ET open.

**Core idea:** NY often runs the stops sitting just beyond the Asia/London session extremes (or the previous day's high/low) right after its open, then reverses. The playbook waits for that sweep, then trades the reversal using the same confluence `rules.json` already requires (bias + BOS + premium/discount + FVG/OB + doji-or-sweep) — it does not invent new signals.

1. **07:30-08:00 ET — prep.** Read the trend-bias table (Uptrend/Downtrend/Range). Note the Asia session H/L line (frozen, session ended), the London session H/L line (still live-tracking, London runs 0300-1200 ET), and PDH/PDL. Note the equilibrium (50%) line for premium/discount. Check `macroBias` and whether any hand-entered event's `blackoutMins` window overlaps the open — if so, skip or size down.
2. **Identify the draw on liquidity.** Whichever external level — Asia H/L, London H/L so far, or PDH/PDL — sits on the *opposite* side of price from the prevailing bias is the likely target of an NY stop-run. E.g., uptrend bias with price sitting near the Asia low → expect a sweep of the Asia low before NY pushes higher.
3. **08:00-08:15 ET — observe only.** This matches the existing risk_rules ("no trading in the first 15 minutes of the NY session open") — treat it as a watch window, not a dead window. Watch for the indicator's liquidity-sweep flag firing on the level identified in step 2 (wick beyond it, close back inside), and/or the trend-bias table flipping via the live/unconfirmed BOS tag.
4. **08:15 ET onward — confirmation and entry.** Long setup (mirror everything for short):
   - Liquidity sweep of a swing low / the Asia or London low / PDL has already fired.
   - A bullish BOS prints — confirmed line, or the live "BOS?" marker — on the 5m entry timeframe (cross-check 1m per `rules.json.scan_timeframes` for exact timing).
   - Price sits in the **discount** zone (below the equilibrium line).
   - An unmitigated bullish FVG or bullish Order Block sits between current price and the swept low.
   - Ideal trigger: a bullish reversal doji (Green Dragonfly, Green Doji, Green Cross, or Green Long-Legged) prints at that FVG/OB. Per the existing bias_criteria this is "doji OR sweep," so sweep + BOS + FVG is already sufficient confluence if no doji forms — the doji just sharpens entry timing.
   - Enter on the retest of the FVG/OB.
5. **Stop loss:** beyond the actual wick that swept liquidity, not just beneath the entry candle — the whole premise is that the stop-hunt needed that room.
6. **Targets:** TP1 = the opposing session high/low or the nearest unmitigated opposite-side FVG/OB; TP2 (runner) = PDH/PDL. If the nearest realistic liquidity target doesn't clear the existing 1:2 R:R minimum from the sweep-based stop, skip the trade — don't force it.
7. **Risk management:** unchanged from `rules.json.risk_rules` — max 2 concurrent positions, stop for the day after 2 consecutive losses, respect the macro blackout window.

**Running it with the existing tooling:**
- `tv session-init` first thing to make sure the symbol and indicator are synced.
- ~07:45-08:00 ET: `tv screenshot`, or `data_get_pine_labels`/`data_get_pine_boxes`/`chart_get_state`, to read the current session H/L, PDH/PDL, trend bias, and any unmitigated FVG/OB already on the chart.
- 08:00-08:15 ET: watch for the liquidity-sweep `alertcondition` (already wired, see "Alerts" section above) or check `data_get_pine_labels` for a fresh sweep label.
- 08:15 ET+: watch the BOS/FVG `alertcondition`s, confirm premium/discount position, check for a reversal doji via `chart_get_state`/screenshot before entering.
- Optionally log the trade via `tv journal`/the replay tooling to track this specific playbook's hit rate over time, since none of these signals are backtested yet (see Known caveats).

**Caveats specific to this playbook:** it inherits every caveat already listed above — Order Block detection is a simplified heuristic, doji thresholds are untuned defaults, confirmed BOS/swing structure lags by `swingLen` bars (the live BOS marker is the workaround), and `macroBias`/event times need periodic manual refresh. It's a discretionary framework for applying the existing indicator, not an automated signal — no backtesting has validated the NY-open timing specifically.

## Next steps (add to as the project grows)

- (add new requirements here as they come up)
- Re-confirm the performance fix visually in the live Pine Editor once the `pine_push`/`pine_pull` Monaco-fiber fragility isn't blocking (see caveat above)
- Alerts still not wired up for BOS/FVG/sweep/OB conditions (carried over from "Known caveats")
- Backtest the NY Open Strategy above against history (replay/journal tooling) once enough live samples exist to be worth checking
