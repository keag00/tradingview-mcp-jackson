# ORB EMA Trend Strategy — Spec

Living spec for Keagan's Opening Range Breakout strategy on NQ1! (Nasdaq futures). Separate from `ICT_STRATEGY_SPEC.md` (the GBPUSD ICT/SMC project) — different instrument, different concept, kept independent per Keagan's call on 2026-07-20 to stop building on the ICT confluence strategy and start fresh rather than force this into the same doc/rules.

## Origin

Based on an Instagram reel from @flexingjoetrades (saved to `brain/README.md` on the `claude/save-video-claude-brain-vnl9i2` branch of this repo, along with the source video): an Opening Range Breakout day-trading strategy demonstrated on NQ. The reel's caption — "5 for 5 today! This simple strategy won all day!" — is a curated highlight clip of 5 winning trades, not a verified track record. Nothing here assumes that holds; the point of building this as a real `strategy()` is to find out.

## Strategy logic

Implemented in [`indicators/orb-ema-trend-strategy.pine`](indicators/orb-ema-trend-strategy.pine) as **"ORB EMA Trend [Keagan]"**, a Pine v6 `strategy()` (backtestable in the Strategy Tester, unlike a plain indicator).

1. **Opening range:** high/low of the first N minutes (default 5) of the RTH session (default `0930-1600` ET). Frozen once the window closes.
2. **EMA trend filter:** default 21 EMA on the chart timeframe. Rising EMA + price above it = long bias; falling EMA + price below it = short bias. (The reel just says "an EMA" without a period — 21 is a common intraday default, exposed as an input to retune.)
3. **Daily trend filter (added 2026-07-21):** a higher-timeframe daily EMA (default length 50, via `request.security(..., "D", ..., lookahead=barmerge.lookahead_off)`) must also agree — longs need daily close above the daily EMA, shorts need daily close below it. Toggleable (`useDailyTrendFilter`). Added specifically because the short side was a net loser during the uptrending backtest window; see Backtest results below for the effect.
4. **Entry:** a confirmed breakout (close crosses the OR boundary by at least a minimum ATR-scaled distance — `minBreakoutBufferMult`, default 0.1×ATR, added 2026-07-21 to filter marginal/barely-there breakouts — and the *next* bar still holds beyond it) or, optionally, a retest of the broken level holding in the trend direction. Both require the EMA bias (intraday *and* daily) to agree. Only one entry at a time (`pyramiding=0`), only within a configurable entry window (default `0935-1545` ET) so setups aren't taken right at the open or into the close chop.
5. **Stop:** the opposite side of the broken OR level, plus an ATR buffer (not the far side of the whole range — matches "stop goes on the other side of the breakout level" from the reel).
6. **Target:** a fixed R multiple (default 2.5R — the reel's 5 example winners ran 2.19R–4.8R, so 2.5 sits at the low end of that, deliberately conservative rather than assuming the best case).
7. **Position sizing:** risk-%-of-equity (default **0.5%**, lowered from an initial 1% on 2026-07-21 specifically to reduce drawdown — see Backtest results), correctly using `syminfo.pointvalue` so the dollar risk is accurate for a futures contract, not just a raw price-difference guess, rounded to a whole contract and capped at `maxQtyPerTrade` (default 20, a safety ceiling — see "Critical bug found" below).
8. **Risk control:** halts new entries after N consecutive same-day losses (default 2); flattens any open position in a configurable window before the close (default `1555-1600` ET) rather than holding into the close/overnight.

## Known simplifications / not yet done

- EMA period, opening-range length, and R multiple are defaults chosen for reasonableness, not backtested/optimized. A quick EMA-length sensitivity check (see Backtest results below) found 21 (shipped default) and 9 both profitable, 50 not — some real parameter sensitivity exists, this is not a "any setting works" strategy.
- Only one opening range and one entry window per session; no multi-day range carryover or overnight logic (NQ trades nearly 24h, but this only acts during RTH by design, matching the reel).
- No news/macro blackout filter (unlike the ICT confluence strategy) — Keagan asked not to force-fit `rules.json`'s existing risk rules here; add one later if it turns out to matter for NQ specifically.
- `margin_long=0, margin_short=0` in the `strategy()` declaration is a deliberate simplification, not an oversight — see "Critical bug found" below. It assumes day-trading buying power isn't a binding constraint (reasonable since the strategy always flattens by `flatSession` and never holds overnight), not that real margin is irrelevant.
- `maxQtyPerTrade` (default 20) is a safety circuit-breaker, not a normal operating constraint — see "Critical bug found" below.
- Verified via `tv pine check`: 0 errors, 0 warnings.

## Critical bug found and fixed (2026-07-20/21, during backtesting)

**The strategy silently placed zero real trades for hours of testing despite entry logic firing correctly 108 times.** Root-caused via a from-scratch diagnostic process (documented in full for future reference since it generalizes beyond this strategy):

1. `reportData()` (the strategy's real internal report object, accessed directly via `cw.getStudyById(id).study().reportData()` in the page's JS console — far more reliable than the Strategy Tester UI panel, which showed stale/misleading state repeatedly) showed `totalTrades: 0` even when the chart visibly displayed "▲ ORB LONG" / "▼ ORB SHORT" entry labels. **Those labels were stale rendering artifacts, not real fills — never trust chart labels as evidence of a real trade; only `reportData()` or the Strategy Tester's own settled report counts.**
2. Added temporary debug `plot(..., display=display.data_window)` cumulative counters (not visible on the chart, only in the Data Window) to trace the funnel across the whole loaded history in one query instead of scrubbing bar-by-bar: `cnt_longCondition`/`cnt_shortCondition` (the actual gate on `strategy.entry()`) were **62 and 46 respectively — the logic fires constantly.** Yet `strategy.position_size` never changed once (`cnt_posSizeChanged: 0`) across the whole backtest.
3. Ruled out (in order tested): the EMA filter being too strict (bypassed it entirely — still zero), fractional contract quantities (rounded to whole numbers — still zero).
4. **Root cause: TradingView's default margin requirement for CME futures (NQ/ES/RTY) exceeded the strategy's `initial_capital=25000`, so every `strategy.entry()` call was silently rejected for insufficient margin** — no error, no warning, just no fill, ever. Fixed by adding `margin_long=0, margin_short=0` to the `strategy()` declaration. This is defensible for this specific strategy because it never holds a position overnight (see `flatSession`), so full exchange margin doesn't really apply the way it would to a swing/position strategy — but it's an assumption worth remembering if this strategy is ever adapted to hold overnight.
5. **Secondary bug found immediately after the margin fix:** with margin no longer blocking anything, position sizing (`riskDollars / (riskDistance × pointValue)`) has no upper bound, and on at least one instrument (TSLA) a bar with an unusually tight stop distance produced a **263,920-share order** — mathematically "correct" risk-% sizing, but absurd relative to a $25K account. Fixed by adding an explicit `maxQtyPerTrade` safety cap (default 20 contracts/shares) as a circuit breaker independent of the risk-% math.
6. **Lesson for future backtesting sessions in this repo:** `reportData()` can return transient, wildly wrong intermediate values (seen: a stable-looking $15,728 profit reading immediately followed by a stable-looking −$1.6M reading with 363,380 max contracts held, both surviving several consecutive polls before the *real* settled value emerged). **Poll to stability with at least 5–6 consecutive identical reads, several seconds apart, especially right after a symbol switch or script edit** — a single read, or even a few consistent-looking reads in quick succession, is not sufficient evidence of a settled result.

## Backtest results — v1 (2026-07-21, superseded by v2 below)

Real Strategy Tester runs via `reportData()` (ground truth, polled to stability — see above), all on 15m bars with `margin_long=0, margin_short=0` and the `maxQtyPerTrade` cap applied, `initial_capital=$25,000`, **1%** risk per trade (later lowered to 0.5%, see v2), default 2.5R target, **no daily trend filter, no minimum breakout distance filter** (both added after this pass). Range: Apr 30 – Jul 21, 2026 (~82 days).

| Market | Trades | Net P&L | Win rate | Profit factor | Max drawdown |
|---|---|---|---|---|---|
| NQ1! (Nasdaq E-mini) | 107 | +$15,725.75 (+62.9%) | 29.0% | 1.17 | $25,499 (43.6%) |
| ES1! (S&P 500 E-mini) | 91 | −$14,506.50 (−58.0%) | 26.4% | 0.61 | $17,787 (69.6%) |
| RTY1! (Russell 2000 E-mini) | 103 | −$7,398.00 (−29.6%) | 25.2% | 0.73 | $9,069 (36.3%) |
| TSLA (stock, exploratory) | ~38–95 (unstable read) | consistently negative (−$3K to −$20K) | ~15.8% | very poor | — |

NQ1!'s v1 long side carried the whole result (61 trades, +$22,088, PF 1.50); the short side was a net loser (46 trades, −$6,360, PF 0.87) — this window was a strong Nasdaq uptrend, so counter-trend shorts were fighting the tape. That observation directly motivated the two v2 changes below. TSLA was never a clean read — the strategy's per-contract futures commission model doesn't translate to per-share stock trading, and it's also where a position-sizing edge case first surfaced (fixed via `maxQtyPerTrade`, see "Critical bug found" above).

**Parameter sensitivity check on NQ1! (v1 logic, EMA length only):** 9 → +$12,318 (PF 1.13, 114 trades); 21 (default) → +$15,726 (PF 1.17, 107 trades); 50 → −$3,409 (PF 0.96, 98 trades). The edge survives nearby short EMA lengths but inverts with a slow one.

## Backtest results — v2 (2026-07-21, current)

Two changes made directly in response to the v1 findings, per Keagan's request:
1. **Daily EMA trend filter** — shorts now require the daily trend to also be bearish (and longs require it bullish), so the strategy stops fighting the higher-timeframe trend.
2. **Tighter entries + smaller size** — a minimum ATR-scaled breakout distance filters marginal breakouts, and risk-per-trade was halved (1% → 0.5%) to directly address the v1 drawdown.

Same methodology (`reportData()` polled to stability, same ~82-day Apr 30 – Jul 21 window), now run across six markets — the original three equity indices plus Dow, Gold, and Crude Oil, to properly answer "which market is best" rather than assuming it's one of the indices:

| Market | Trades | Net P&L | Win rate | Profit factor | Max drawdown | Long / Short split |
|---|---|---|---|---|---|---|
| **GC1! (Gold, COMEX)** | 30 | **+$27,875 (+111.5%)** | 40.0% | **3.40** | $7,616 (18.8%) | All 30 trades short (daily filter found gold in a daily downtrend almost the entire window) |
| NQ1! (Nasdaq E-mini) | 52 | +$15,881 (+63.5%) | 26.9% | 1.37 | $12,360 (35.3%) | 51 long (+$17,336, PF 1.42), 1 short (−$1,455) |
| CL1! (Crude Oil, NYMEX) | 40 | +$3,353 (+13.4%) | 37.5% | 1.31 | $5,608 | 11 long (+$3,941), 29 short (−$588) |
| RTY1! (Russell 2000 E-mini) | 50 | −$610 (−2.4%) | 26.0% | 0.94 | $3,220 | 50 long, 0 short — essentially breakeven |
| YM1! (Dow, CBOT) | 49 | −$3,416 (−13.7%) | 14.3% | 0.75 | $5,629 | 49 long, 0 short |
| ES1! (S&P 500 E-mini) | 48 | −$5,091 (−20.4%) | 25.0% | 0.70 | $6,428 | 47 long (−$4,537), 1 short (−$555) |

**Gold is the new standout — by a wide margin.** Every trade the daily filter allowed was a short, into a genuine daily downtrend, and the strategy caught it cleanly: highest profit factor (3.40) and win rate (40%) of any market tested, lowest drawdown-as-% (18.8%) of any profitable result. NQ1! remains solidly profitable and is now meaningfully de-risked (drawdown cut from 43.6% to 35.3% of account) but no longer the top pick. RTY1!, YM1!, and ES1! are all roughly flat-to-slightly-negative now rather than sharply negative — the daily filter and tighter entries reduced their losses substantially (ES1! from −58% to −20%, RTY1! from −29.6% to essentially breakeven) even though it didn't flip them profitable.

**v1 → v2 improvement on NQ1! specifically:** trades 107 → 52 (far more selective, roughly half as many), net profit $15,726 → $15,881 (essentially unchanged in dollars despite half the risk-per-trade), profit factor 1.17 → 1.37, **max drawdown $25,499 → $12,360 (a 51.5% reduction)**. Almost the same return for roughly half the pain — exactly the outcome the risk-adjustment changes were aimed at.

**Read this honestly:**
- Gold's result is real (ground-truth `reportData()`, polled to stability, chart-resolution-verified) but rests on a much smaller sample than the others — 30 trades, all one-directional (short), during what was evidently a strong gold downtrend inside this specific 82-day window. A single clean regime producing a great number is exactly the kind of result that needs a longer sample or an out-of-sample period before being trusted as a durable edge, not just a lucky alignment between the daily filter and one strong trending move.
- The daily trend filter is doing most of the heavy lifting across the board — on 4 of 6 markets it filtered one entire side down to 0–1 trades. That's the intended effect, but it also means these v2 results are really "how well does trading only with the daily trend work on this market during this window," not a test of the original two-sided breakout idea anymore.
- Buy-and-hold gold over the same window actually *lost* money (−$47,330 buy-and-hold return) while the strategy made +$27,875 — a case where the strategy's short-only, trend-aligned approach clearly added value beyond just being long a rising market, unlike the NQ1! v1 result where buy-and-hold had won.
- Still an ~82-day sample throughout, for the same TradingView Basic-plan data-availability reason documented in v1.

## Commission model fix (2026-07-22)

Switched `commission_type` from `strategy.commission.cash_per_contract` ($2.25) to `strategy.commission.cash_per_order` ($1 flat per order). The per-contract model is a futures assumption that becomes absurd applied per-*share* to a stock (effectively $2.25/share — TSLA's original read was corrupted by this); a flat per-order fee is a reasonable universal approximation for both asset classes without needing per-instrument configuration. Gold and Silver were re-verified under the new model (negligible difference, as expected — a few dollars per trade at most). NQ1!, ES1!, RTY1!, YM1!, and CL1!'s v2 numbers above were captured just before this fix and were not individually re-verified after — expect them to be accurate to within a few dollars per trade, not materially different.

## Full market sweep — v2 (2026-07-22)

Same strategy, same ~82-day window, same methodology (`reportData()` polled to stability, chart resolution/symbol verified via `tv state` after every switch — see `CLAUDE.md` for the specific traps hit doing this: stale screenshots, silent resolution drift, phantom intermediate readings). Expanded from the original six markets to sixteen, spanning equity indices, metals, energy, currencies, crypto, and two individual stocks (with the commission fix applied, unlike the original TSLA read):

| Market | Trades | Net P&L | Win rate | Profit factor | Max drawdown |
|---|---|---|---|---|---|
| **GC1! (Gold, COMEX)** | 30 | **+$27,950** | 40.0% | **3.42** | $7,607 |
| NVDA (stock, NASDAQ) | 14 | +$113 | 42.9% | 1.69 | $83 |
| NG1! (Natural Gas, NYMEX) | 30 | +$1,969 | 46.7% | 1.60 | $1,167 |
| NQ1! (Nasdaq E-mini) | 52 | +$15,881 | 26.9% | 1.37 | $12,360 |
| CL1! (Crude Oil, NYMEX) | 40 | +$3,353 | 37.5% | 1.31 | $5,608 |
| 6B1! (British Pound, CME) | 36 | +$1,034 | 44.4% | 1.27 | $1,625 |
| 6E1! (Euro FX, CME) | 49 | +$932 | 40.8% | 1.18 | $1,925 |
| TSLA (stock, NASDAQ) | 16 | +$39 | 25.0% | 1.10 | $216 |
| SI1! (Silver, COMEX) | 32 | −$1,339 | 31.3% | 0.96 | $19,150 |
| RTY1! (Russell 2000 E-mini) | 50 | −$610 | 26.0% | 0.94 | $3,220 |
| HG1! (Copper, COMEX) | 43 | −$2,424 | 23.3% | 0.77 | $4,148 |
| YM1! (Dow, CBOT) | 49 | −$3,416 | 14.3% | 0.75 | $5,629 |
| DX1! (US Dollar Index, ICE) | 65 | −$2,075 | 32.3% | 0.73 | $2,965 |
| ES1! (S&P 500 E-mini) | 48 | −$5,091 | 25.0% | 0.70 | $6,428 |
| BTCUSD (Bitcoin, Coinbase) | 61 | −$4,379 | 24.6% | 0.59 | $5,024 |
| 6J1! (Japanese Yen, CME) | 69 | −$5,201 | 29.0% | 0.47 | $5,767 |

**Gold remains the standout by a wide margin** — highest profit factor and win rate of anything tested, on real (if thin) sample size. 8 of 16 markets were net profitable (profit factor > 1); metals, energy, and the major "risk-on" currencies (GBP, EUR) did well, while the Dollar Index, Yen, Bitcoin, and Copper were clear losers. Stocks (TSLA, NVDA) were essentially non-events either way — very small trade counts (14–16) and the `maxQtyPerTrade` safety cap (20) binding almost every trade, meaning the risk-% sizing model is significantly under-expressing itself on lower-point-value instruments; a stock-specific sizing recalibration would be needed before drawing any real conclusion about equities.

**Read this honestly:** this is a screening pass across sixteen single-regime, ~82-day snapshots, not sixteen independent verdicts — many of these markets share macro drivers (the FX pairs and Dollar Index are mechanically related; equity indices tend to correlate), so don't read "8 winners, 8 losers" as more statistically meaningful than it is. Gold's result is the one worth actually tracking forward; everything else here is exploratory context for that pick, not a portfolio.

## Pushover alerting (added 2026-07-22, running continuously as of the same day)

`tv orb-alert check` (`src/core/orb_alert.js`) watches the live strategy on `ORB_ALERT_SYMBOLS` and pushes a real Pushover notification the moment it places a genuine new order — no LLM judgment call, the strategy's own tuned entry logic is the signal. See the "ORB strategy alert watcher" section in `CLAUDE.md` for the full mechanism (it reads `reportData().filledOrders`, not `.trades`, specifically so it can catch an entry before the trade closes). Verified end-to-end: detection/message-building logic confirmed via a `--dry-run` simulation, and raw Pushover connectivity confirmed with a real, clearly-labeled test push to the configured device.

**Now scheduled and running continuously** via `launchctl` (`~/Library/LaunchAgents/com.tradingview-mcp.orb-alert.plist`, checking every 5 minutes) — currently watching `COMEX:GC1!` and `OANDA:GBPUSD` (see the GBPUSD section below for why that second symbol is there despite a bad backtest). The plist points at this worktree's directory, not the main checkout, since this code isn't merged yet — it'll keep working as long as the worktree exists, but needs repointing (and reloading) once the PR is merged and the worktree is cleaned up.

A real production bug was caught and fixed within the first hour of running: `study.study()` can return null right after a symbol switch (the strategy model isn't loaded yet), and the original code let that throw instead of handling it — now surfaced as an explicit "not ready, skipped this cycle" entry, self-recovering on the next tick. See the git history for `src/core/orb_alert.js` for the fix.

## GBPUSD (spot forex) backtest — real edge or no edge? (2026-07-22)

Keagan asked to trade the GBPUSD market open and wanted the strategy watching it. Backtested first, honestly, before setting up the alert: **31 trades, 0% win rate — every single trade lost**, both sides (13 long: −$26.02, 18 short: −$35.89), net −$61.92 on `OANDA:GBPUSD` 15m over the same ~82-day window. Confirmed via both `reportData()` (polled to stability, chart resolution/symbol re-verified given how often those silently drifted mid-session) and a direct visual check of the Strategy Tester's trade list, which matched.

**This is not the same as "GBPUSD has no edge" on its own** — two confounding issues, not yet disentangled:
1. **Position sizing was capped at `maxQtyPerTrade` (20) on every single trade** — meaning the intended 0.5%-risk-per-trade sizing was never actually being expressed; spot FX's point-value mechanics via `syminfo.pointvalue` don't scale against typical ATR-based stop distances the same way the futures/commodities markets tested here do. The dollar amounts above are small specifically *because* of this, not because the strategy is barely losing.
2. Separately, `6B1!` (GBP **futures**, CME) tested profitably in the main sweep above (36 trades, +$1,034, PF 1.27) — the *same underlying currency pair*, different instrument mechanics, opposite result. That strongly suggests the sizing/mechanics issue (point 1) is doing real damage to the spot-GBPUSD read, not that GBP itself is a bad market for this strategy.

Given real money was about to be risked and there wasn't time to properly investigate before the open, the honest call was made to flag this clearly to Keagan rather than either hide it or unilaterally decide not to set up the alert — he chose to have it watch GBPUSD anyway and judge entries himself, eyes open about the backtest. **Before trusting this instrument's alerts as a real signal (not just "interesting to watch"), the position-sizing-for-spot-FX issue needs a real fix and a clean re-run** — likely either a spot-FX-specific quantity calculation, or accepting that this strategy is futures/commodities-native and spot forex needs its own sizing model entirely.

## Next steps

- ~~Get it into TradingView~~ — done 2026-07-20.
- ~~Run a real Strategy Tester pass~~ — done 2026-07-21 (v1), refined 2026-07-21 (v2).
- ~~Add a daily trend filter and tighten entries/sizing~~ — done 2026-07-21, see v2 results above.
- ~~Test more markets~~ — done 2026-07-21/22: expanded from 3 to 16 markets across every major asset class. Gold is the standing top pick.
- ~~Connect to Pushover alerts~~ — done 2026-07-22, and now actually scheduled/running continuously via launchd, see above.
- Get a longer sample (Premium "Deep Backtesting" trial, or wait and accumulate more real trading days/alerts) before trusting the Gold result beyond "promising, worth continuing to track" — 30 trades in one regime is a thin reed for a strategy this good-looking.
- Fix position sizing for low-point-value/spot instruments (the `maxQtyPerTrade` cap is binding almost every stock *and* spot-FX trade — see the GBPUSD section above — meaning risk-% sizing isn't really being tested for either) before drawing any real conclusion about equities or spot forex specifically.
- Once the sizing issue is fixed, re-run GBPUSD cleanly and decide whether to keep it in the alert watcher based on real numbers, not the honest-but-confounded 0%-win-rate read it has today.
- Consider whether the daily filter should also gate scoring/logging on the *filtered-out* side (e.g. record what a disallowed short would have done) to distinguish "the filter avoided real losses" from "the filter just reduced sample size" per market.
- Repoint `~/Library/LaunchAgents/com.tradingview-mcp.orb-alert.plist` at the main checkout once this PR is merged and the worktree is no longer needed.
