# Walk-forward tailing backtest (no look-ahead)

Run: `npm run backtest:walkforward`  
Source: `walkforward_tail_backtest.py`  
Full numbers: `output/walkforward_tail_backtest.json`

## Method (only what we would have known)

For each closed **directional** play (hedges and 95¢ NO bonds stripped, same as `analyze_trader`):

1. Sort that trader’s book by `endDate` (resolved-history walk-forward).
2. **Trader Q at T** = pipeline grade on prior resolved events only (`endDate` strictly before this play). Needs 20 prior events.
3. **Play grade at T** clones dashboard `computeConfidence` for a *single* trader at their entry (`valueDelta=0`). Inputs: prior sport-lane ROI, size vs **prior** median stake, prior Q.
4. Tail **$100/play**. Win = `100*(1/fill−1)`, loss = `−100`. Fills: their `avgPrice`, and +1¢ / +2¢ / +5¢ slippage.

This is **not** live 90+ consensus (that needs multiple wallets on the same side). The dashboard **caps a single-trader grade at 68–82**, so the live `90+` bucket is empty. An **uncapped** clone of the same formula is stored as `play_grade_uncapped` so we can still ask “what if 90+ existed from one book.”

**Caveats:** expanding Q can pin at 100 after warmup; resolved-history is slightly optimistic vs true entry-time knowledge when many games overlap; $100 equal-bet ≠ proportional-to-their-size.

Universe: **49 traders, 69,138 closed plays, 68,158 after warmup**. Mean play grade 46.3, mean Q 41.7.

## Calibration (dashboard-capped grade)

| Band | n | WR | Implied WR | avg Q |
|------|--:|---:|-----------:|------:|
| 90+ (dashboard) | 0 | — | — | — |
| 90+ (uncapped) | 1,864 | 96.0% | 59.8% | 93.3 |
| 80–89 | 2,453 | 89.3% | 61.5% | 82.0 |
| 70–79 | 3,520 | 82.9% | 59.1% | 75.7 |
| 60–69 | 12,075 | 81.5% | 56.0% | 75.2 |
| 50–59 | 9,847 | 67.3% | 59.3% | 40.2 |
| <50 | 40,263 | 57.8% | 54.0% | 26.6 |

Grades rank-order well. They are **not** calibrated probabilities (80+ wins ~89%, not 80%).

## Best tailing strategies (n≥50, ranked by Sharpe then ROI at their entry)

| Strategy | n | WR | ROI their $ | ROI +2¢ | ROI +5¢ | PF | Sharpe | MaxDD $ | Exp $ |
|----------|--:|---:|------------:|--------:|--------:|---:|-------:|--------:|------:|
| Uncapped 90+ | 1,864 | 96.0% | **70.9%** | 64.5% | 55.9% | 18.9 | 14.95 | −300 | 70.88 |
| Uncapped 85+ | 2,880 | 94.1% | 67.1% | 60.8% | 52.4% | 12.4 | 13.64 | −600 | 67.13 |
| Grade≥70 AND 40–60¢ flip | 2,829 | 83.2% | 65.7% | 59.3% | 50.8% | 4.92 | 12.95 | −1,000 | 65.71 |
| Trader Q≥70 AND play≥70 | 4,183 | 92.1% | 64.1% | 57.8% | 49.4% | 9.13 | 12.03 | −700 | 64.05 |
| Dashboard 80+ | 2,453 | 89.3% | 55.5% | 49.1% | 41.1% | 6.17 | 11.56 | −500 | 55.47 |
| Dashboard 70+ | 5,973 | 85.6% | 51.4% | 45.5% | 37.9% | 4.54 | 10.73 | −1,000 | 51.41 |
| S-tier any play (Q≥70) | 13,886 | 89.1% | **73.8%** | 64.7% | 54.1% | 9.06 | 9.22 | −4,000 | 73.83 |
| High-grade (Q50 + lane + 2×med) | 7,556 | 82.6% | 43.1% | 37.2% | 29.8% | 3.25 | 9.15 | −1,800 | 43.11 |
| Copy all after warmup | 68,158 | 65.6% | 23.0% | 16.6% | 8.7% | 1.85 | 4.81 | −4,700 | 23.03 |

Copy-all at **+5¢ still +8.7%**. The **&lt;50 band goes negative at 5¢ (−4.7%)**.

## What to actually run (matches the live dashboard)

Because single-trader **90+ never prints** on the product:

1. **Best Sharpe among shown grades:** tail **80+** (or **Q≥70 AND grade≥70** if you also filter the book).
2. **Best $ expectancy among mid-volume filters:** **grade≥70 in the 40–60¢ flip zone**.
3. **Highest raw ROI, more drawdown:** tail **every play** from wallets that were already S-tier at T (Q≥70). Bigger book, −$4k DD on $100 units.
4. **Avoid:** grade &lt;50, especially with any slippage.

Underdog 70+ has lower WR (66.6%) but huge expectancy (~$95/play at their price) because of longshot payouts — high variance, not a “safe” bucket.

Sports on the high-grade filter: NHL / NBA / esports strongest; tennis weakest (70.5% WR, 11% ROI). Years: 2024 small-n; 2025 +25% ROI; 2026 +48% ROI (regime, not a guarantee).
