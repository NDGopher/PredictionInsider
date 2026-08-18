# Take-book bankroll (Q60 + sport expert + 2×, no NFL)

As of **2026-08-18**. Hold to resolution. Fill = **VWAP + 2¢**. Start bankroll **$10,000**. Same-day tickets share that morning’s bank (day cap 50%, per-bet cap 25%).

Tape: **578 plays**, 67.13% WR, 2025-01-07 → 2026-08-02, **3.04 bets / active day** (190 days with a bet, 1.01/calendar day). Busiest day: 12 tickets.

## Headline: $100 flat vs growing the stake

| Sizing | End bank | PnL | ROI on start | Max DD $ | Max DD % | Sharpe (calendar) | Sortino (cal.) | Calmar | PF | Avg stake |
|--------|---------:|----:|-------------:|---------:|---------:|------------------:|---------------:|-------:|---:|----------:|
| **$100 flat** | $16,229 | $6,229 | 62.29% | −$569 | -4.75% | 2.58 | 3.2 | 10.95 | 1.328 | $100 |
| **1% of bank (compounds from $10k)** | $18,296 | $8,296 | 82.96% | −$1,001 | -5.6% | 2.38 | 2.44 | 8.28 | 1.317 | $135 |
| **¼ Kelly, walk-forward** | $102,340 | $92,340 | 923.4% | −$27,469 | -21.16% | 1.77 | 1.03 | 3.36 | 1.301 | $1,769 |
| **½ Kelly, walk-forward** | $414,651 | $404,651 | 4046.51% | −$255,857 | -39.32% | 1.02 | 0.48 | 1.58 | 1.205 | $10,339 |
| **Full Kelly, walk-forward** | $738,735 | $728,735 | 7287.35% | −$725,860 | -68.24% | 0.6 | 0.28 | 1.0 | 1.125 | $29,068 |
| **½ Kelly, in-sample p (optimistic)** | $39,209 | $29,209 | 292.09% | −$39,863 | -80.73% | 0.49 | 0.31 | 0.73 | 1.088 | $1,793 |

Flat $100 never resizes: you made **$6,229** on **$57,800** turned over (10.78% ROI on staked), ending at **$16,229**. Max drawdown **−$569** (-4.75% of peak equity). Longest losing streak **5**. 63.2% of active days were green.

Walk-forward Kelly uses only *prior* take-book results (40-play warmup) to estimate edge, then `f* = (p − fill) / (1 − fill)`. In-sample Kelly peeks at the whole-tape win rate and is **not** a live recipe.

## $100 flat — ratios

| Metric | Value |
|--------|------:|
| Plays | 578 |
| Win rate | 67.13% |
| Expectancy / $100 | $11 |
| Avg win / avg loss | $65 / −$100 |
| Profit factor | 1.328 |
| Sharpe (calendar days, incl. zeros, √365) | 2.58 |
| Sharpe (active days only, daily $ PnL) | 4.56 |
| Sharpe (active-day ROI, √365) | 3.67 |
| Sortino (calendar) | 3.2 |
| Sortino (active days) | 9.65 |
| Calmar (total PnL / abs max DD) | 10.95 |
| Max drawdown | −$569 (-4.75%) |
| Longest lose / win streak | 5 / 12 |
| Bets per active day | 3.04 (median 2.0, max 12) |
| Bets per calendar day | 1.01 |
| Date span | 2025-01-07 → 2026-08-02 (573 days) |

## Monthly PnL ($100 flat)

| Month | n | WR | ROI +2¢ | PnL |
|-------|--:|---:|--------:|----:|
| 2025-01 | 14 | 57.14% | -19.21% | −$269 |
| 2025-02 | 8 | 37.5% | -30.28% | −$242 |
| 2025-09 | 7 | 71.43% | 23.97% | $168 |
| 2025-10 | 14 | 71.43% | 21.65% | $303 |
| 2025-11 | 43 | 69.77% | 2.77% | $119 |
| 2025-12 | 47 | 76.6% | 15.24% | $716 |
| 2026-01 | 78 | 70.51% | 17.97% | $1,402 |
| 2026-02 | 71 | 71.83% | 9.34% | $663 |
| 2026-03 | 165 | 67.88% | 11.8% | $1,948 |
| 2026-04 | 25 | 56.0% | -2.37% | −$59 |
| 2026-05 | 31 | 54.84% | 9.02% | $280 |
| 2026-06 | 21 | 71.43% | 18.13% | $381 |
| 2026-07 | 52 | 61.54% | 19.62% | $1,020 |
| 2026-08 | 2 | 0.0% | -100.0% | −$200 |

## As-of Q (grade at the time of the bet)

| Q bucket | n | WR | Implied | Edge | ROI +2¢ | PnL @ $100 | Avg rel | PF |
|----------|--:|---:|--------:|-----:|--------:|-----------:|--------:|---:|
| 60–64 | 150 | 66.67% | 59.0% | 7.7 | **11.88%** | $1,783 | 5.72× | 1.36 |
| 65–69 | 115 | 67.83% | 57.0% | 10.8 | **17.1%** | $1,967 | 6.09× | 1.53 |
| 70–74 | 113 | 66.37% | 60.0% | 6.3 | **5.6%** | $633 | 4.4× | 1.17 |
| 75–79 | 70 | 68.57% | 62.1% | 6.5 | **17.09%** | $1,196 | 4.38× | 1.54 |
| 80–89 | 114 | 68.42% | 64.1% | 4.3 | **5.03%** | $573 | 4.47× | 1.16 |
| 90–100 | 16 | 56.25% | 55.9% | 0.4 | **4.82%** | $77 | 3.9× | 1.11 |

## Relative size vs that trader’s own median (at the time)

Every row is already ≥2× (the take filter). This is *how much* larger.

| Size vs own median | n | WR | Implied | Edge | ROI +2¢ | PnL @ $100 | Avg Q | PF |
|--------------------|--:|---:|--------:|-----:|--------:|-----------:|------:|---:|
| 2–3× | 201 | 66.67% | 58.7% | 8.0 | **11.83%** | $2,377 | 72.3 | 1.35 |
| 3–5× | 196 | 63.78% | 60.5% | 3.3 | **5.49%** | $1,076 | 72.1 | 1.15 |
| 5–7× | 84 | 69.05% | 61.5% | 7.6 | **10.65%** | $895 | 73.1 | 1.34 |
| 7–10× | 46 | 80.43% | 62.9% | 17.6 | **27.23%** | $1,253 | 72.0 | 2.39 |
| 10×+ | 51 | 66.67% | 59.5% | 7.1 | **12.33%** | $629 | 67.5 | 1.37 |

## Notes

- **Flat vs compound:** compounding (1% of bank) is the honest “sized up as we grew” path. It is the same average risk as $100 on $10k on day one, then the stake rides the equity curve.
- **Kelly:** walk-forward ¼ Kelly is the only Kelly column that stays in a liveable drawdown (~21%). Half and full Kelly turn a +$6k edge into a casino path (−39% / −68% peak-to-trough). In-sample ½ Kelly is *worse* than walk-forward because a constant 67% p refuses tickets priced above ~67¢ and still full-sizes the cold 2025Q1 open. Do not live-trade full Kelly on this tape.
- **Sharpe:** headline number is **calendar Sharpe** (zeros on days with no bet). Active-day Sharpe ~3.7 annualizes as if you bet 365 days a year — that is not the investor experience.
- This is the **same tape we used to pick the filter**, not a holdout. The $6,229 is the backtest path at +2¢, not a live guarantee.
- Replay is by **resolution date**, not fill time. Several games can settle the same night; those tickets share that day’s bank.

