# Verified Elite Sniper — walk-forward backtest

Generated **2026-08-31T15:28:37 UTC**.

## Honesty contract

- Alert time = first fill timestamp (else endDate−12h).
- Q / sport ROI / rel / median use only markets resolved ≥1 day before alert.
- Elite promote/kick uses only take-gate history resolved before alert.
- Trade only if trader was **already elite** at alert AND Sniper gates clear.
- Fill = VWAP+2¢, $100/play, hold to resolution. No peeking at the outcome for ranking.

## Portfolio (what we would have traded)

- **n=380** · WR **67.37%** · ROI+2¢ **11.16%** · PnL **$4242.07** · PF 1.342 · maxDD $-1752.63
- Span 2025-12-02 → 2026-04-13 · ~4.42/day
- Avg Q 73.9 · avg rel 5.09× · edge 8.0%

### Rolling windows

- **last_30d**: n=110 WR=70.91% ROI+2¢=14.15% PnL=$1556.21
- **last_60d**: n=282 WR=66.67% ROI+2¢=11.6% PnL=$3271.73
- **last_90d**: n=364 WR=68.13% ROI+2¢=12.77% PnL=$4648.59

### By quarter

- **2025Q4**: n=4 WR=25.0% ROI=-59.02%
- **2026Q1**: n=363 WR=68.6% ROI=13.01%
- **2026Q2**: n=13 WR=46.15% ROI=-18.75%

### Leave-one-out (robustness)

- Drop **Andromeda1**: n=376 WR=67.82% ROI=11.91%
- Drop **Capman**: n=179 WR=60.89% ROI=6.99%
- Drop **JhonAlexanderHinestroza**: n=317 WR=67.82% ROI=7.92%
- Drop **ShortFlutterStock**: n=312 WR=71.79% ROI=16.53%
- Drop **Vetch**: n=336 WR=65.77% ROI=10.63%

### By trader (contributors)

- **Capman**: n=201 WR=73.13% ROI=14.88% PnL=$2990.23 elite_days≈2
- **ShortFlutterStock**: n=68 WR=47.06% ROI=-13.48% PnL=$-916.48 elite_days≈1
- **JhonAlexanderHinestroza**: n=63 WR=65.08% ROI=27.5% PnL=$1732.47 elite_days≈1
- **Vetch**: n=44 WR=79.55% ROI=15.27% PnL=$671.92 elite_days≈1
- **Andromeda1**: n=4 WR=25.0% ROI=-59.02% PnL=$-236.07 elite_days≈1

## Current elite roster (as-of now)

- **HVAB** — take n=48 ROI=8.99% active30=230 median=$1,920 · keep_elite take=48/9.0% active30=230

## Proven bench (cleared gates, currently stale — will re-promote when active)

- **JhonAlexanderHinestroza** — take n=106 ROI=23.62% · stale_30d_n=0
- **Vetch** — take n=84 ROI=19.24% · stale_30d_n=0
- **Capman** — take n=255 ROI=14.89% · stale_30d_n=0

## Recent roster changes (fluid)

- 2026-08-31 **kick** Capman: stale_30d_n=0
- 2026-08-31 **kick** JhonAlexanderHinestroza: stale_30d_n=0
- 2026-08-31 **kick** Vetch: stale_30d_n=0
- 2026-08-29 **promote** HVAB: promote take=43/12.1% wr_band active30=229 sports=79%
- 2026-03-01 **kick** ShortFlutterStock: life_floor_roi=0.4
- 2026-02-21 **promote** JhonAlexanderHinestroza: promote take=42/20.7% wr_band active30=383 sports=79%
- 2026-02-20 **promote** ShortFlutterStock: promote take=45/21.3% wr_band active30=1303 sports=100%
- 2026-01-12 **promote** Capman: promote take=62/8.6% wr_band active30=1405 sports=100%
- 2026-01-08 **kick** Capman: life_floor_roi=3.6
- 2026-01-03 **promote** Capman: promote take=43/10.7% wr_band active30=953 sports=100%
- 2025-12-31 **promote** Vetch: promote take=40/23.6% wr_band active30=165 sports=100%
- 2025-12-02 **kick** Andromeda1: life_floor_roi=3.2
- 2025-12-01 **promote** Andromeda1: promote take=41/9.3% wr_band active30=246 sports=98%

## Last 20 trades we would have taken

- 2026-04-12 W $14.88 Q=83 rel=2.46× **JhonAlexanderHinestroza** — Will CD Tondela vs. Gil Vicente FC end in a draw?
- 2026-04-11 L $-100.0 Q=84 rel=4.42× **JhonAlexanderHinestroza** — Will SC Braga win on 2026-04-12?
- 2026-04-12 L $-100.0 Q=83 rel=2.46× **JhonAlexanderHinestroza** — Will Shenzhen Xinpengcheng FC win on 2026-04-12?
- 2026-04-11 W $81.82 Q=84 rel=2.02× **JhonAlexanderHinestroza** — Will RB Leipzig vs. Borussia Mönchengladbach end in a d
- 2026-04-11 L $-100.0 Q=84 rel=4.8× **JhonAlexanderHinestroza** — Will Udinese Calcio win on 2026-04-11?
- 2026-04-04 L $-100.0 Q=85 rel=2.26× **JhonAlexanderHinestroza** — Will Fenerbahçe SK win on 2026-04-05?
- 2026-04-05 L $-100.0 Q=85 rel=6.72× **JhonAlexanderHinestroza** — Will Eintracht Frankfurt win on 2026-04-05?
- 2026-04-05 W $132.56 Q=85 rel=2.48× **JhonAlexanderHinestroza** — Eintracht Frankfurt vs. 1. FC Köln: O/U 2.5
- 2026-04-04 W $117.75 Q=85 rel=3.5× **JhonAlexanderHinestroza** — Will DSC Arminia Bielefeld win on 2026-04-04?
- 2026-04-04 L $-100.0 Q=85 rel=6.27× **JhonAlexanderHinestroza** — Will VfL Wolfsburg win on 2026-04-04?
- 2026-03-28 W $82.68 Q=74 rel=2.62× **Capman** — Credit One Charleston Open, Qualification: Aliona Bolso
- 2026-04-03 W $26.58 Q=86 rel=8.27× **JhonAlexanderHinestroza** — Will Paris Saint-Germain FC win on 2026-04-03?
- 2026-04-02 L $-100.0 Q=86 rel=3.92× **JhonAlexanderHinestroza** — Will CR Flamengo win on 2026-04-02?
- 2026-03-31 W $23.8 Q=72 rel=11.97× **Capman** — Pistons vs. Thunder
- 2026-03-30 L $-100.0 Q=74 rel=2.58× **Capman** — Suns vs. Magic
- 2026-03-31 W $17.15 Q=72 rel=11.04× **Capman** — Bulls vs. Spurs: O/U 242.5
- 2026-03-31 L $-100.0 Q=72 rel=14.68× **Capman** — 76ers vs. Heat
- 2026-03-30 W $14.94 Q=74 rel=8.0× **Capman** — Spread: Michigan Wolverines (-7.5)
- 2026-03-30 W $100.52 Q=74 rel=7.92× **Capman** — Spread: Trail Blazers (-19.5)
- 2026-03-30 W $22.91 Q=74 rel=3.72× **Capman** — Spread: Clippers (-13.5)

## Rules

- Promote: take-gate n≥40, ROI+2¢≥8.0%, sports_frac≥60%, active30≥8, joinable median < $15,000, WR 48.0–75.0 (or ≤85.0 if take proven).
- Kick: active30<5, or 60d take ROI<-5.0% (n≥12), or life take ROI<5.0% (n≥40).
- Sniper play: Q≥60, sport ROI≥+5%, rel≥2×, 10–88¢, no NFL.

