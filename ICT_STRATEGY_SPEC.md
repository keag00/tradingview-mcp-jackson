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
| Trend bias (uptrend/downtrend/range) | ✅ v1 | Compares last two confirmed swing highs/lows (HH/HL = uptrend, LH/LL = downtrend), shown in a top-right table |
| Break of Structure (BOS) | ✅ v1 | `close` crosses the last confirmed swing high/low |
| Liquidity sweep | ✅ v1 | Wick trades beyond a swing high/low but closes back inside it; only flags once per level |
| Fair Value Gap (FVG) | ✅ v1 | Classic 3-candle imbalance (`low > high[2]` / `high < low[2]`); box extends right only while unmitigated, freezes once price trades back through it |
| Order Block | ✅ v1 (simplified) | Last opposite-colour candle before a BOS impulse, searched back up to `obLookback` bars; box freezes once mitigated (price closes back through it) |
| Equilibrium / premium-discount | ✅ v1 | 50% midpoint of the current swing range (last swing high ↔ last swing low), with shaded premium/discount zones |
| Live (unconfirmed) swing high/low + live BOS | ✅ v2 (2026-07-15) | Rolling `ta.highest`/`ta.lowest` over a `swingLen`-derived window — no right-side confirmation bars needed, so it reacts intrabar instead of lagging `swingLen` bars behind the confirmed pivots above. Plotted as dotted yellow/orange circles; a "BOS?" triangle marks when price crosses it live. Toggle via `showLiveSwing` / `showLiveBOS`. |
| Previous Day/Week High-Low (PDH/PDL/PWH/PWL) | ✅ v3 (2026-07-15) | Non-repainting via `request.security(..., [high[1], low[1]], lookahead=barmerge.lookahead_off)` on `"D"`/`"W"` — always the last *completed* day/week. Silver dashed lines for day, blue dotted for week, each labeled and extending from the start of that day/week to the current bar. Toggle via `showPDHL` / `showPWHL`. |
| Session highs/lows (Asia/London/NY) | ✅ v3 (2026-07-15) | Tracks the running high/low while each session (`input.session`, default Asia 1900-0400 / London 0300-1200 / NY 0800-1700, all America/New_York) is active; the line freezes and keeps extending right once the session ends, until the next occurrence resets it. Purple/blue/orange lines labeled "ASIA H/L", "LDN H/L", "NY H/L". Toggle via `showSessions`. |

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
- No backtesting/statistics on any of these signals yet — purely visual markup
- No alerts wired up for any of these conditions yet
- Second instrument mentioned early on ("pound is the main one, second is GBP/USD") was clarified to mean GBPUSD is the only instrument for now — revisit if a second pair/cross is actually wanted later
- Doji thresholds are heuristic defaults — tune `dojiBodyMaxPct` / `oppWickMaxPct` / `longLeggedWickMinPct` / `crossSymTolPct` against real chart examples
- Session windows (Asia/London/NY) default to commonly-used ET ranges (1900-0400 / 0300-1200 / 0800-1700) — tune via the `showSessions` group's session inputs if Keagan's actual trading hours differ.
- Confirmed swing/BOS/Order Block structure still has an inherent `swingLen`-bar confirmation lag — `ta.pivothigh`/`ta.pivotlow` need that many bars *after* a pivot to validate it, which is fundamental to what ICT means by a "confirmed" swing, not a bug. The v2 live/unconfirmed layer (see table above) is the workaround for wanting a same-tick reaction; it can relabel which bar was the "swing" as new bars arrive, since it's provisional by design.

## Real-time behavior (added 2026-07-15)

- Doji, FVG, and liquidity-sweep detection already react on every realtime tick by default (Pine indicators recalculate the still-forming bar on each price update) — no code gate was holding them to bar-close.
- Fixed a latent repaint bug: confirmed-BOS and FVG object creation (`line.new`/`box.new`) used live `close`/`high`/`low` inside a one-shot condition with no per-bar guard, so a price chopping back and forth around the level within a single unconfirmed bar could fire the condition on more than one tick and stack duplicate lines/boxes for what should be a single event. Added `bar_index`-based one-shot guards (`lastBullBosBar`/`lastBearBosBar`/`lastBullFvgBar`/`lastBearFvgBar`) — reacts on the first tick the condition trips, never duplicates. Order Block creation is nested under BOS so it inherited the fix for free.
- Added a genuinely lag-free live swing high/low (rolling `ta.highest`/`ta.lowest`) and a "live BOS" marker built on it, since the confirmed pivots are structurally lagged by `swingLen` bars — see the table above.

## Confluence backtest strategy (added 2026-07-16)

Keagan asked for a "90% profitable" strategy. That number isn't real — no rules-based system sustains a fixed win rate, and claiming one would just be a lie dressed up as an answer. What got built instead: [`indicators/ict-confluence-sniper-strategy.pine`](indicators/ict-confluence-sniper-strategy.pine), a genuine Pine `strategy()` (not just an `indicator()`) called **"ICT Confluence Sniper [Keagan]"** — same structure/FVG/OB/equilibrium/doji detection as the main indicator, but wired into a scored confluence filter with real entries, stops, and targets so it can be backtested for **actual, verifiable** win-rate/profit-factor numbers in TradingView's Strategy Tester tab, instead of anyone guessing.

- **Confluence score (0-6 per side):** trend bias aligned, recent liquidity sweep, recent BOS, price in discount/premium (relative to equilibrium), price inside an unmitigated FVG or order block, recent reversal doji of the matching color family (exact same 8-pattern taxonomy as the main indicator, matches `rules.json`'s `bias_criteria` wording). `minScore` input (default 5/6) gates entries.
- **Hard filters (not scored, must all pass):** London/NY kill-zone session filter with a configurable minutes-after-open buffer, a manual high-impact-news blackout window, and a daily halt after N consecutive losses — all three lifted directly from `rules.json`'s existing `risk_rules`.
- **Risk management:** stop-loss anchored to the swept liquidity level (+ ATR buffer), take-profit at a minimum R:R multiple (default 2:1, matches `rules.json`'s "R:R at least 1:2" rule), position size computed from a risk-% -of-equity input rather than a fixed lot size.
- **Labels:** structure signals (BOS/SWEEP/FVG/OB/doji) use the same subdued, semi-transparent color-coded labels as the main indicator; entries/exits use solid, high-contrast labels ("▲ LONG 5/6", "▼ SHORT 6/6", TP/SL exit comments) so they're visually distinct from the structure markup at a glance.
- **Alerts:** `alertcondition()` for long/short confluence entries, BOS, and liquidity sweeps, plus native `strategy.entry`/`strategy.exit` order-fill alerts (`alert_message`/`alert_profit`/`alert_loss`) for entries, take-profits, and stop-losses — 4 additional alert types beyond the main indicator's existing 6.
- Verified via `tv pine analyze` (0 issues) and `tv pine check` (0 errors, 0 warnings) server-side compile. **Real backtest stats (win rate, profit factor, drawdown) have not been captured yet** — run it in the Strategy Tester on GBPUSD across a few timeframes/date ranges before trusting any number this produces, and don't assume performance transfers to other symbols or the current regime.
- **Not yet loaded into TradingView itself.** Getting a genuinely *new* saved script's content set programmatically turned out to be unreliable in this TradingView Desktop build — every method tried (Monaco `setValue`/`executeEdits`, simulated keystrokes) either no-opped or corrupted the buffer; see the new "Known fragility" entry in `CLAUDE.md` for the full postmortem before attempting this again. The original `ICT Concepts + Doji Scanner [Keagan]` indicator was verified untouched throughout (diffed against `indicators/ict-concepts-doji-scanner.pine` and checked via `pine-facade`'s `modified` timestamp multiple times). **Manual step still needed:** open TradingView → Pine Editor → Create new → Strategy → paste in `indicators/ict-confluence-sniper-strategy.pine` → Save as "ICT Confluence Sniper [Keagan]" → Add to chart → open Strategy Tester.

## Alert fix (added 2026-07-20)

The 6 `alertcondition()` calls at the end of the strategy (long/short confluence entry, bullish/bearish BOS, liquidity sweep high/low) were no-ops — `alertcondition()` only functions inside `indicator()` scripts; TradingView's own compiler flags this with warning CW10017 inside a `strategy()`. Fixed by converting each to a guarded `alert()` call (`if <condition> \n alert(message, alert.freq_once_per_bar)`), using the conditions' existing one-shot guards so nothing double-fires. Verified via `tv pine check`: 0 errors, 0 warnings (the CW10017 warnings are gone). To receive all 10 possible notifications (4 order-fill alerts from `strategy.entry`/`strategy.exit`'s `alert_message`/`alert_profit`/`alert_loss`, plus these 6), create one TradingView alert on the script with condition **"Any alert() function call"** — that's the standard pattern for strategies with multiple distinct notification points.

**Update 2026-07-20, later same day:** the alert fix is now live. Getting there took a detour — see the "Known fragility" entries in `CLAUDE.md` for the full postmortem, summarized here: a real, reproducible `FIND_MONACO` bug was found and fixed in `src/core/pine.js` (it used `querySelector`, grabbing the first — often stale/invisible — `.monaco-editor.pine-editor-monaco` match instead of the visible one). Before that fix was proven out, unrelated Pine Editor interactions caused TradingView to silently autosave a corrupted hybrid buffer over "ICT Confluence Sniper" (wrong header, orphaned code fragment, would not compile) — caught via a `pine-facade` ground-truth fetch, not the visible editor, which is the only reason it was caught at all. After the `FIND_MONACO` fix, `pine_set_source` was re-tested and now works reliably: content was pushed, verified byte-for-byte identical to the local `.pine` file via a direct cloud fetch, compiled clean (0 errors/0 warnings), and saved. Both this strategy and the original "ICT Concepts + Doji Scanner" indicator were independently re-verified untouched/correct afterward.

## Backtest results (added 2026-07-20)

Real Strategy Tester runs against the live "ICT Confluence Sniper" script on `OANDA:GBPUSD`, using whatever history TradingView's Basic plan had already loaded on the chart at each resolution (longer/"Deep Backtesting" ranges are Premium-gated on this account — see caveat below):

| Timeframe | Range tested | `minScore` | Trades | Result |
|---|---|---|---|---|
| 1h | Jan 1, 2025 – Jul 20, 2026 (~18 months) | 5/6 (default) | 0 | No qualifying setups — confluence bar not cleared even once |
| 1h | Jan 1, 2025 – Jul 20, 2026 (~18 months) | 3/6 (diagnostic) | 0 | Still zero — see caveat below on bar-based lookbacks |
| 15m | Apr 30 – Jul 20, 2026 (~3 months) | 5/6 (default) | 0 | No qualifying setups |
| 15m | Apr 30 – Jul 20, 2026 (~3 months) | 1/6 (diagnostic, mechanics check only) | 1 | 1 short trade, stopped out: **PnL −$104.37 (−1.04%), 0% win rate (0/1), profit factor 0, max drawdown $104.37 (1.04%)** |

**Read this honestly, not optimistically:**
- The one real trade above is a single data point at an artificially low, non-default threshold used purely to confirm the entry/exit/stop/target mechanics actually fire and settle correctly in the Strategy Tester (they do). It is not a performance result — 1 trade tells you nothing about win rate.
- At the strategy's actual designed default (`minScore = 5/6`), **zero trades fired in either tested window.** That's a real, load-bearing finding: either the confluence bar is calibrated for genuinely rare "A+" setups and needs a much longer sample (a year-plus at native timeframe) to see any trades at all, or it's stricter than intended and needs recalibration — can't tell which from this data alone.
- The strategy's recency windows (`sweepLookback`, `bosLookback`, `dojiLookback` — 6 to 10 bars) were designed assuming intraday bars (5m/15m). Testing on 1h changes what "recent" means for those windows and likely suppresses scoring further; 1h results shouldn't be read as informative about the strategy at its intended timeframe.
- TradingView's Basic plan restricts the Strategy Tester to only whatever history is already loaded on the chart at the current resolution — going beyond that (e.g. "Entire history" on 5m, or even "Last 90 days" on 5m) triggers a "Deep Backtesting" Premium upsell instead of running the test. Real multi-month backtesting at 5m/15m — the strategy's actual intended timeframe — needs either a Premium plan or scrolling the chart far enough back to force more history into memory first.

## Next steps (add to as the project grows)

- (add new requirements here as they come up)
- ~~Get the alert fix into the live TradingView script~~ — done 2026-07-20, see "Update" note above
- Get a longer, native-timeframe (5m/15m) backtest sample — either via a Premium "Deep Backtesting" trial or by scrolling the chart back to load more history first — to get a real read on whether `minScore = 5/6` is calibrated correctly or too strict
- Consider whether the confluence recency windows need separate tuning per timeframe if this strategy is ever tested on anything other than 5m/15m
