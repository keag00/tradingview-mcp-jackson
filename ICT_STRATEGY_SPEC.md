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

## Next steps (add to as the project grows)

- (add new requirements here as they come up)
