# Prop Firm Scalper — spec & backtest log

## What this is

`indicators/prop-firm-scalper-strategy.pine` ("Prop Firm Scalper [Keagan]" on TradingView, script id `USER;0a167ea2e2594a4e811b8d62f605bc78`). Built 2026-07-23 at Keagan's request: a strategy aimed specifically at passing prop-firm funded-account evaluations as fast as possible, which is a different design target than "maximize return." A funded challenge is failed by a single bad day or a slow bleed past the drawdown limit regardless of the win rate, so the strategy is built around the account rules themselves, not just an entry signal.

**Entry model — mean reversion, not trend-following.** Fade price closes beyond a 20-period Bollinger Band (2 stdev), confirmed by RSI (oversold/overbought), gated by an ADX regime filter (only trade when ADX < 25, i.e. the market isn't in a strong trend — mean-reversion gets destroyed trading against a real trend). This combination is chosen specifically because fading an extreme in a genuinely ranging market has a structurally higher hit rate than trend continuation/breakout entries, at the cost of a lower reward-per-trade — an intentional trade-off, since a funded-account challenge rewards consistency far more than a few outsized wins.

**The prop-firm-specific part — a real risk governor, not just an entry filter:**
- `maxDailyLossPct` (default 4%, under the ~5% daily-loss limit most funded-account programs enforce): halts new entries for the rest of the day if tripped, resets automatically at the next new day.
- `maxOverallDrawdownPct` (default 8%, under the ~10% max-drawdown limit most programs enforce): halts entries **permanently** and flattens any open position once tripped — this simulates what actually happens on a real funded account (it gets disabled), so the backtest honestly answers "would this account have survived," not just "is this profitable in aggregate."
- `profitTargetPct` (default 8%, a typical Phase-1 evaluation target): purely informational — flags the first bar where cumulative return crossed it, so you can see how many trades/days it took.
- A dashboard table (top-right of the chart) shows live daily P&L%, overall drawdown%, total return%, and halt status (Trading / DAILY HALT / FAILED — Max DD).

Market-agnostic by design (risk-%-of-equity position sizing via `syminfo.pointvalue`, no symbol-specific assumptions) — built to be tested across instruments, per Keagan's "any market" ask, not tuned to one.

## Backtest results (2026-07-23, 15m timeframe, default settings)

All runs use the strategy's default inputs (`riskPctPerTrade=0.25%, rrMultiple=1.2, atrStopMult=1.2, bbLen=20/2.0, rsiLen=14, adxThreshold=25`), on whatever chart history TradingView's "Range from chart" default window covers at the time of the run. Polled `reportData()` to stability (4+ consecutive identical reads) before recording, per this project's established methodology.

| Market | Trades | Win rate | Net P&L | Profit factor | Max contracts held | Notes |
|---|---|---|---|---|---|---|
| **CME_MINI:ES1! (S&P 500 E-mini)** | 30 | **60.0%** | +$2,740 (+11.0%) | 1.415 | 1 | Clean read, no sizing confound |
| **CME_MINI:NQ1! (Nasdaq E-mini)** | 21 | **57.1%** | +$6,403 (+25.6%) | 1.757 | 1 | Clean read, no sizing confound |
| COMEX:GC1! (Gold) | 2 | 0% | −$2,114 | 0 | 1 | Sample too thin to mean anything — Gold has been trending for most of this window, so the ADX<25 regime filter almost never allowed an entry. Not evidence against Gold, just evidence the filter did its job of avoiding a trend it shouldn't fade. |
| OANDA:EURUSD (spot forex) | 51 | 0% | −$102 | 0 | **50 (capped)** | **Confounded, not a real "no edge" read** — hit the `maxQtyPerTrade` safety cap on every trade, same known spot-FX point-value sizing issue already documented in `ORB_STRATEGY_SPEC.md` for the ORB strategy. The dollar P&L is tiny specifically because real risk-% sizing was never actually being expressed. |
| NASDAQ:AAPL (stock) | 60 | 36.7% | −$889 (−3.6%) | 0.624 | **50 (capped)** | Same sizing-cap confound as EURUSD — not a clean read. |

**Honest read: this strategy has a real, clean, well-above-50%-win-rate edge specifically on index futures (ES1!, NQ1!) tested so far** — which lines up well with the "funded account" goal, since index futures are the single most common funded-account asset class (Apex, TopStep, Elite Trader Funding, and most other prop firms specialize in ES/NQ/YM/RTY). It does **not** yet have a validated edge on spot FX or single stocks — those two markets need the same position-sizing fix already flagged as an open issue for the ORB strategy before they can be judged fairly. Gold's sample is too thin (2 trades) to say anything either way. "Any market" was the brief; the honest state today is "proven on index futures, unproven elsewhere pending a sizing fix" — not a universal edge yet.

Attempted to extend the sweep to YM1! (`CBOT_MINI:YM1!`) and RTY1! (`CME_MINI:RTY1!`) but both failed to resolve on the automation window during this session (transient — see `CLAUDE.md`'s documented symbol-resolution fragility); not retried further given time constraints. Worth another pass before relying on this strategy for those markets specifically.

## Where it lives

Created as a genuinely new TradingView script (not an edit of an existing one) via the dropdown's "Create new → Strategy" flow, per the safe-script-creation procedure documented in `CLAUDE.md`. Built and tested entirely in a second, isolated TradingView Desktop window (confirmed not to affect the main chart — a symbol switch in the isolated window does not propagate to the main one) so none of this testing touched Keagan's live view. Compiles clean: 0 real errors (one harmless `barstate.islast` advisory-severity message, the same known-benign message documented elsewhere in this repo for other strategies).

## Next steps

- Fix the `maxQtyPerTrade` position-sizing cap for spot-FX/stock instruments (shared open issue with the ORB strategy — see `ORB_STRATEGY_SPEC.md`'s "Next steps") before trusting or dismissing the EURUSD/AAPL reads.
- Re-attempt YM1!/RTY1! and a few more index futures (CME:6E1!, ICE:DX1!?) for a broader sample before calling the futures edge "proven" rather than "promising."
- Get a longer sample on ES1!/NQ1! (Premium "Deep Backtesting" or more real trading days) — 21-30 trades in one regime is a real signal but still a thin one.
- Consider whether the ADX<25 regime filter is too strict for markets that trend more persistently (Gold) — might need a per-market or adaptive threshold rather than one fixed value.
- Not yet wired into any alert watcher (`orb_alert.js`/`trade_alert.js`) — do that once there's more confidence in the sizing fix and a broader market sample.
