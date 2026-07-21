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

- EMA period, opening-range length, and R multiple are defaults chosen for reasonableness, not backtested/optimized — that's the next step, not a finished calibration.
- Only one opening range and one entry window per session; no multi-day range carryover or overnight logic (NQ trades nearly 24h, but this only acts during RTH by design, matching the reel).
- No news/macro blackout filter (unlike the ICT confluence strategy) — Keagan asked not to force-fit `rules.json`'s existing risk rules here; add one later if it turns out to matter for NQ specifically.
- Verified via `tv pine check`: 0 errors, 0 warnings. **Real Strategy Tester numbers not yet captured** — same Basic-plan data-availability caveat documented in `ICT_STRATEGY_SPEC.md` likely applies (backtestable range limited to whatever history is already loaded on the NQ1! chart at the tested resolution).

## Next steps

- ~~Get it into TradingView~~ — done 2026-07-20: live as "ORB EMA Trend [Keagan]" on the `CME_MINI:NQ1!` 5m chart, added via the Strategy Tester. Verified byte-for-byte against this repo's `.pine` file via a direct `pine-facade` cloud fetch, not just the visible editor.
- Run a real Strategy Tester pass and record actual win rate / profit factor / drawdown / trade count here — do not trust the reel's implied performance until this exists. The default "Range from chart" window on first load was Jun 18 – Jul 20, 2026 with 0 trades ("This report requires trade data") — same Basic-plan data-availability caveat as the ICT confluence strategy likely applies; see `ICT_STRATEGY_SPEC.md`'s "Backtest results" section for how that showed up there.
- Revisit EMA length / OR length / R multiple once there's a real trade sample to look at
