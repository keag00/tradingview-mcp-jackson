# ORB EMA Trend Strategy — Spec

Living spec for Keagan's Opening Range Breakout strategy on NQ1! (Nasdaq futures). Separate from `ICT_STRATEGY_SPEC.md` (the GBPUSD ICT/SMC project) — different instrument, different concept, kept independent per Keagan's call on 2026-07-20 to stop building on the ICT confluence strategy and start fresh rather than force this into the same doc/rules.

## Origin

Based on an Instagram reel from @flexingjoetrades (saved to `brain/README.md` on the `claude/save-video-claude-brain-vnl9i2` branch of this repo, along with the source video): an Opening Range Breakout day-trading strategy demonstrated on NQ. The reel's caption — "5 for 5 today! This simple strategy won all day!" — is a curated highlight clip of 5 winning trades, not a verified track record. Nothing here assumes that holds; the point of building this as a real `strategy()` is to find out.

## Strategy logic

Implemented in [`indicators/orb-ema-trend-strategy.pine`](indicators/orb-ema-trend-strategy.pine) as **"ORB EMA Trend [Keagan]"**, a Pine v6 `strategy()` (backtestable in the Strategy Tester, unlike a plain indicator).

1. **Opening range:** high/low of the first N minutes (default 5) of the RTH session (default `0930-1600` ET). Frozen once the window closes.
2. **EMA trend filter:** default 21 EMA. Rising EMA + price above it = long bias; falling EMA + price below it = short bias. (The reel just says "an EMA" without a period — 21 is a common intraday default, exposed as an input to retune.)
3. **Entry:** a confirmed breakout (close crosses the OR boundary and the *next* bar still holds beyond it — filters single-bar fakeouts) or, optionally, a retest of the broken level holding in the trend direction. Both require the EMA bias to agree. Only one entry at a time (`pyramiding=0`), only within a configurable entry window (default `0935-1545` ET) so setups aren't taken right at the open or into the close chop.
4. **Stop:** the opposite side of the broken OR level, plus an ATR buffer (not the far side of the whole range — matches "stop goes on the other side of the breakout level" from the reel).
5. **Target:** a fixed R multiple (default 2.5R — the reel's 5 example winners ran 2.19R–4.8R, so 2.5 sits at the low end of that, deliberately conservative rather than assuming the best case).
6. **Position sizing:** risk-%-of-equity (default 1%), correctly using `syminfo.pointvalue` so the dollar risk is accurate for a futures contract, not just a raw price-difference guess.
7. **Risk control:** halts new entries after N consecutive same-day losses (default 2); flattens any open position in a configurable window before the close (default `1555-1600` ET) rather than holding into the close/overnight.

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

## Backtest results (2026-07-21)

Real Strategy Tester runs via `reportData()` (ground truth, polled to stability — see above), all on 15m bars with `margin_long=0, margin_short=0` and the `maxQtyPerTrade` cap applied, `initial_capital=$25,000`, 1% risk per trade, default 2.5R target. **Range: Apr 30 – Jul 21, 2026 (~82 days)** — the most history TradingView's Basic plan would load on the chart at 15m resolution without a Premium "Deep Backtesting" upgrade; every attempt to extend it (wider preset ranges, custom date ranges, programmatic chart scroll-back) either hit the same Premium paywall or silently failed to fetch more bars. Treat ~82 days / ~100 trades per market as a real but modest sample, not a long-run verdict.

| Market | Trades | Net P&L | Win rate | Profit factor | Max drawdown | Notes |
|---|---|---|---|---|---|---|
| **NQ1! (Nasdaq E-mini)** | 107 | **+$15,725.75 (+62.9%)** | 29.0% | 1.17 | $25,499 (43.6%) | Long side carried it: 61 trades, +$22,088, PF 1.50. Short side was a net loser: 46 trades, −$6,360, PF 0.87 — this window was a strong Nasdaq uptrend (dashboard showed "EMA: LONG bias" persistently), so this may partly reflect the regime, not just the strategy. |
| ES1! (S&P 500 E-mini) | 91 | −$14,506.50 (−58.0%) | 26.4% | 0.61 | $17,787 (69.6%) | Clearly worse than NQ on the same window — less volatile/trending, more chop, breakouts fail more often. |
| RTY1! (Russell 2000 E-mini) | 103 | −$7,398.00 (−29.6%) | 25.2% | 0.73 | $9,069 (36.3%) | Also a net loser, smaller magnitude than ES. |
| TSLA (stock, exploratory) | ~38–95 (unstable read) | consistently negative (−$3K to −$20K depending on read) | ~15.8% | very poor (as low as 0.03 in one read) | n/a | **Not a fair/clean comparison** — the strategy's commission model (`$2.25 per contract`) is a futures assumption that becomes absurd applied per-share to a stock, and this was also where the position-sizing blowup bug (finding #5 above) was first caught. Would need a stock-appropriate commission model and a fresh, clean re-run to trust a real verdict on individual equities. Flagging honestly rather than reporting a number I don't trust. |

**Parameter sensitivity check on NQ1!** (same window, EMA length only): 9 → +$12,318 (PF 1.13, 114 trades); **21 (shipped default) → +$15,726 (PF 1.17, 107 trades)**; 50 → **−$3,409 (PF 0.96, 98 trades)**. The edge survives nearby short EMA lengths but inverts with a slow one — some real sensitivity, not "any setting works," but also not knife-edge fragile around the shipped default.

**Read this honestly:**
- NQ1! is the clear standout of the markets tested, and it's also the exact instrument the source reel demonstrated — both the qualitative pick and the quantitative result agree, for whatever that's worth over an 82-day sample.
- 107 trades is a real sample, not a toy one, but it's still under 3 months of one specific market regime (a Nasdaq uptrend). Nothing here says this holds in a chop or downtrend period — the short side already underperforming within this same window is a hint that regime matters a lot to this strategy.
- Max drawdown ($25,499) is essentially the whole starting account and exceeds net profit — the equity curve was rough even in the winning scenario. Sharpe ratio was 0.10 (very low) despite the strategy being net profitable in raw dollars.
- Buy-and-hold NQ over the same window returned $23,960 (95.8%) — *more* than this strategy's $15,726 (62.9%) in raw-dollar terms. This strategy trades intraday only (flat every night, no overnight risk), which is a real and different risk profile than buy-and-hold, but it's an honest comparison to have on record rather than only citing the strategy's own numbers in isolation.

## Next steps

- ~~Get it into TradingView~~ — done 2026-07-20.
- ~~Run a real Strategy Tester pass~~ — done 2026-07-21, see Backtest results above.
- Get a longer sample (Premium "Deep Backtesting" trial, or wait and accumulate more real trading days) before trusting this beyond "promising, worth continuing to track."
- If pursuing further: try a longer-timeframe trend filter (e.g. daily EMA) to bias which side to trade, given the short side was a net loser specifically during this uptrending window — the strategy may benefit from not fighting a higher-timeframe trend.
- If testing on stocks specifically, fix the commission model (per-share, not per-"contract") and re-run cleanly before drawing any conclusion about equities.
