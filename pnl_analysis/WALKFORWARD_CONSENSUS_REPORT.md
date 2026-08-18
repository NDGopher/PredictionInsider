# Honest walk-forward consensus backtest (through 2026-08-18)

Run: `npm run backtest:consensus`  
Health: `npm run backtest:health`  
Frontend: **Strategies** (`/strategies`) reads `pnl_analysis/output/tail_strategies.json` and live `/api/signals`.

## What was wrong with the last-60d numbers

Three bugs stacked:

1. **Redeem timestamps are not event dates.** Closed winners get a fresh `timestamp`; unredeemed losers often have none. Last-60d windows looked like 100% winners.
2. **`realizedPnl` ignored `cashPnl`.** Open settled losers live in `/positions` with `curPrice` 0 and large negative `cashPnl`. Cannae’s closed-only “+44% ROI / +$31M” was redeemed winners only. After merging the unique open book, dashboard PnL is **+$6.8M / +12.9%**, and the open book MTM is about **−$16.5M**. Polymarket portfolio value is ~$45k.
3. **`/positions` repeats the last page forever** after ~10,500 rows, and pandas was reading 77-digit `asset` ids as float64 so merges did not dedupe.

Last 30/60/90d are now **dashboard PnL** (`realizedPnl + cashPnl`) dated from `endDate` / slug, including redeemable losers.

Cannae **last 60d size-weighted dashboard is still +45%** because of a handful of World Cup bombs. **Last 30d copy WR is 21.8%.** You will not get his size. Overlay soccer ML NO only; never an unfiltered 2+ voter.

## Copy-all baseline (tailable wallets only)

Quitters, MMs, $90k-median whales, and volume grinders (~1% ROI on thousands of markets) are skipped.

| Book | n | WR | Implied | ROI |
|------|--:|---:|--------:|----:|
| Previous closed-only copy-all | 267,698 | 58.2% | 53.0% | **+3.7%** |
| Prior “full” book still including kicked wallets | 327,025 | 54.1% | 51.9% | **−2.9%** |
| **Now, tailable roster only** | **214,024** | **53.2%** | **50.8%** | **−1.5%** |

Blind copy-all still loses after slippage. Consensus has to earn its keep.

## Roster (see `TRADER_HEALTH_REPORT.md`)

**KEEP 12 · TIGHTEN 14 · OVERLAY 1 (Cannae) · WATCH 1 · KICK 28**

Kicked from live `/api/signals` (quit, last-60d blow-up, or un-tailable):

- **Quit / dormant** (no dated play in 45+ days): Capman, tcp2, CemeterySun, Bienville, RandomPunter, redskinrick, 9sh8f, HedgeMaster88, 877s8d8g89I9f8d98fd99ww2, JPMorgan101, 0xCb6Ed933, kch123, middleoftheocean
- **Blow-ups:** LynxTitan (−44% last 60d), 0x53eCc53E7 (−60%), TheMangler (−5.8% at volume)
- **Impossible to join:** Qpkwks (median ~$92k), HomeRunHazard (~1% ROI on 24k markets)
- **Closed-only sample was fake:** quavoo (−10.5% hold-to-res), wr0ngw4yb3tt0r (−6.1%)

**New KEEP after full-open grade:** GoalLineGhost (49.8% hold-to-res, median ~$1.3k), ferrariChampions2026 (14.2%, hedge-heavy, median ~$4k), WTSA, 0x8a3aB812…

## Strategy ROI @ join_max + 2¢

$100/play. Universe last resolved play: **2026-08-17**. Grade &lt;60 band is **−43% ROI** (calibration holds).

| Strategy | n | WR | Implied | ROI | Notes |
|----------|--:|---:|--------:|----:|-------|
| **2+ Q50 moneyline (best)** | 375 | 77.6% | 59.0% | **+41.2%** | GoalLineGhost 34% of book |
| Core ML grade70, no Cannae, no NFL | 615 | 81.3% | 61.6% | **+39.7%** | GoalLineGhost 34% |
| Grade 70+ live, no Cannae | 758 | 82.1% | 63.5% | **+37.6%** | |
| Favorites 60–80¢ | 469 | 84.0% | 75.4% | **+12.3%** | RN1/GoalLine mix |
| Soccer ML **no** Cannae | 678 | 63.9% | 57.5% | **+14.0%** | |
| Soccer ML **with** Cannae | 1,055 | 62.2% | 59.5% | **+7.1%** | He inflates 2+ |
| Copy-all | 214,024 | 53.2% | 50.8% | **−1.5%** | |
| Grade &lt;60 | 502 | 34.1% | 55.1% | **−43.3%** | Do not take |

Last 20 of the best book are **2026-08-15 → 2026-08-17** (through today), labeled title · side · submarket.

### Sport × submarket (best book, join_max+2¢)

| Sport | Submarket | n | WR | ROI | /day | Last |
|-------|-----------|--:|---:|----:|-----:|------|
| Soccer | Moneyline | 254 | 75.2% | +39.7% | 2.73 | 2026-08-17 |
| Other | Moneyline | 121 | 82.6% | +44.3% | 2.12 | 2026-08-17 |

## What to trade

1. **Default:** 2+ warmed-up wallets, **moneyline**, Q≥50, join_max+2¢, skip NFL and Cannae as a 2+ voter.
2. **Favorites 60–80¢** if you want a slower, less GoalLineGhost-concentrated book (~+12% after slip).
3. Cannae soccer ML **NO** overlay is optional; soccer 2+ is worse with him in the cluster (+7% vs +14%).
4. Do not tail quitters, $90k-median wallets, or 1% ROI grinders.

## Method

- Win iff `curPrice ≥ 0.99` or `redeemable`, including `status=open`.
- Event date from `endDate` or slug/title; **never** fill/redeem timestamp.
- Full unique `/positions` book (stop on wrap; multi-sort CURRENT/CASHPNL so recent zeros are not hidden behind March whales).
- Play = `conditionId` + side. Walk-forward Q uses only markets dated ≥1 day earlier.
- 20 warmup, ≥$200, category filters, $100 flat.
