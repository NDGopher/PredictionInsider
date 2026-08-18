# Robust tail research

As of **2026-08-18**. Data through last resolved consensus play **2026-08-18**.

Run: `npm run backtest:research`

## What to tail
1. **GoalLineGhost + ferrariChampions2026 (or Ghost + RN1) moneylines** — This is the book that actually prints (Ghost+ferrari ~+89% WR 97% on 142 plays). 2+ Q50 moneyline is 44.31% only because Ghost is on 73% of those plays. Without Ghost the same filter is -52.39%. You are tailing Ghost's soccer/other moneylines, not a 12-name consensus.
2. **Favorites 60–80¢ as the low-vol book** — Ask+2¢ 12.28% WR 84.01%. Use this when you do not want GoalLineGhost-sized variance.
3. **Soccer moneyline overlay without Cannae in the 2+ cluster** — Ask+2¢ 13.97%. Cannae is overlay-only (soccer ML NO), never an unfiltered voter.
4. **Mute bleed lanes; only count a wallet where they are experts** — Per-trader sport × submarket filters. Ignore places they bleed even if they are KEEP overall.

## Dual fill (their entry vs ask-at-alert)

Their entry = size-weighted VWAP of the wallets on the play. Ask-at-alert proxy = later member's price (`join_max`); live tailing uses **join_max + 2¢**. $100/play, hold to resolution.

| Book | n | Their VWAP ROI | Ask (join_max) ROI | Ask+2¢ ROI | WR | Sharpe | Last |
|------|--:|---------------:|-------------------:|-----------:|---:|-------:|------|
| Any 2+ live 10–88¢ | 1636 | 25.41% | 13.25% | **8.88%** | 64.91% | 2.53 | 2026-08-18 |
| Favorites 60–80¢ | 469 | 22.98% | 15.38% | **12.28%** | 84.01% | 4.43 | 2026-08-17 |
| 2+ Q50 moneyline | 361 | 66.16% | 50.92% | **44.31%** | 78.39% | 5.4 | 2026-08-17 |
| 2+ Q50 moneyline (no GoalLineGhost) | 96 | -44.86% | -50.7% | **-52.39%** | 29.17% | -14.31 | 2026-08-15 |
| 2+ both Q≥50 moneyline | 538 | 66.09% | 47.86% | **41.77%** | 80.3% | 7.02 | 2026-08-17 |
| Grade 70+ live, no Cannae/NFL | 756 | 58.26% | 43.22% | **37.65%** | 82.01% | 5.96 | 2026-08-18 |
| Core 2+ live, no Cannae/NFL | 1237 | 32.4% | 19.45% | **14.73%** | 67.5% | 2.31 | 2026-08-18 |
| Soccer ML no Cannae | 678 | 31.45% | 18.94% | **13.97%** | 63.86% | 2.71 | 2026-08-18 |
| Soccer ML with Cannae | 1055 | 23.15% | 11.55% | **7.12%** | 62.18% | 2.96 | 2026-08-18 |
| Grade <60 (do not take) | 502 | -34.27% | -41.01% | **-43.27%** | 34.06% | -7.97 | 2026-08-17 |

## CLV (alert → close)

Close line = last CLOB mid in (2¢, 98¢) before event end. Fill for this table is **join_max+2¢** (the live tail price), not a CLOB mid. Expected ROI = close / fill − 1. Negative expected CLV means the close is *worse* than our fill — we are not beating the market into settlement; the edge is hold-to-resolution. Coverage 0.996 of the Q50 moneyline sample.

| Book | n | CLOB ask cov. | Close-line cov. | Realized ROI | Expected (CLV) ROI | Avg CLV |
|------|--:|--------------:|----------------:|-------------:|-------------------:|--------:|
| 2+ Q50 moneyline | 250 | 1.0 | 0.996 | 69.24% | -10.21% | -8.1¢ |
| Favorites 60–80¢ | 250 | 0.992 | 0.98 | 23.59% | -16.99% | -12.99¢ |
| Soccer ML no Cannae | 250 | 0.996 | 0.988 | 51.8% | -10.31% | -9.59¢ |

## Steady winners (active, joinable, low-vol)

| Trader | Grade | Last | 90d dash | 180d Sharpe | Max DD | Median | Why |
|--------|-------|------|---------:|------------:|-------:|-------:|-----|
| RN1 | **STEADY** | 2026-08-19 | 63.14% | 16.04 | -0.36% | $600 | Active 2026-08-19, last 90d dash 63.1% (n=5880), Sharpe 16.04, DD -0.4%. |
| BoomLaLa | **VOLATILE** | 2026-08-19 | 10.25% | 7.39 | -1.31% | $308 | Worst recent month -32.5% ROI. |
| ferrariChampions2026 | **STEADY** | 2026-08-19 | 29.83% | 7.42 | -2.92% | $3,962 | Active 2026-08-19, last 90d dash 29.8% (n=14044), Sharpe 7.42, DD -2.9%. |
| GoalLineGhost | **STEADY** | 2026-08-18 | 48.82% | 16.87 | -0.0% | $1,827 | Active 2026-08-18, last 90d dash 48.8% (n=9915), Sharpe 16.87, DD 0.0%. |
| 0xheavy888 | **STEADY** | 2026-08-19 | 30.52% | 13.35 | -0.37% | $2,041 | Active 2026-08-19, last 90d dash 30.5% (n=1410), Sharpe 13.35, DD -0.4%. |
| bloodmaster | **GRINDER** | 2026-08-18 | 2.61% | 3.47 | -1.94% | $949 | 92.6% WR / 4.1% ROI — grinder-adjacent, not a steady directional book. |
| DLEK | **VOLATILE** | 2026-07-29 | 74.93% | 3.06 | -6.72% | $5,502 | Worst recent month -66.8% ROI. |
| TTdes | **STEADY** | 2026-08-16 | 29.73% | 2.81 | -8.95% | $996 | Active 2026-08-16, last 90d dash 29.7% (n=70), Sharpe 2.81, DD -8.9%. |
| Supah9ga | **THIN** | 2026-08-15 | 52.59% | 4.57 | -5.23% | $5,686 | Last 90d only 17 resolved markets. |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | **STEADY** | 2026-08-19 | 5.0% | 2.76 | -3.01% | $4,838 | Active 2026-08-19, last 90d dash 5.0% (n=229), Sharpe 2.76, DD -3.0%. |
| WTSA | **STEADY** | 2026-08-17 | 20.3% | 5.57 | -7.43% | $28,134 | Active 2026-08-17, last 90d dash 20.3% (n=130), Sharpe 5.57, DD -7.4%. |
| 0xE30E74595517de48f1FB19f4553dd3d9F1E96B87 | **UNTAILABLE** | 2026-08-19 | 3.1% | 0.73 | -12.22% | $38,537 | Median stake $38,537 — cannot join at $100/play. |
| Cannae | **OVERLAY** | 2026-08-18 | 44.85% | 8.62 | -2.18% | $264 | Keep only as a soccer moneyline overlay, never an unfiltered 2+ voter. Hold-to-res 21.5% on 16112; last 60d dashboard 45.2% (n=874). Spreads/totals/draws/UCL/NBA/NFL and YES-side stay blocked. |
| 0p0jogggg | **LANE_ONLY** | 2026-08-17 | 62.45% | 5.24 | -4.51% | $350 | Keep only Esports, NBA, Soccer; mute NFL; skip Draw. Full 11.2% / last60d dash 70.7%. |
| S-Works | **LANE_ONLY** | 2026-08-15 | 36.77% | 9.39 | -1.09% | $3,457 | Keep only Esports, Soccer, Tennis, WNBA; skip Player Prop. Full 6.8% / last60d dash 40.8%. |
| ShortFlutterStock | **VOLATILE** | 2026-08-03 | 3.09% | 1.82 | -2.4% | $2,082 | Worst recent month -70.5% ROI. |
| TutiFromFactsOfLife | **FADED** | 2026-08-16 | -2.54% | -1.38 | -7.39% | $10,000 | Last 90d dashboard -2.5% / hold -7.6%. |
| Andromeda1 | **STALE** | 2026-07-19 | 4.93% | 1.2 | -4.97% | $1,849 | Last dated event 2026-07-19 (30d ago). Do not tail stale markers. |
| ShucksIt69 | **VOLATILE** | 2026-08-16 | 5.92% | 1.91 | -2.15% | $9,420 | Worst recent month -31.0% ROI. |
| JhonAlexanderHinestroza | **LANE_ONLY** | 2026-08-18 | -1.88% | 1.27 | -3.25% | $2,534 | Keep only Soccer; skip Spread. Full 6.2% / last60d dash -2.6%. |
| CoryLahey | **LANE_ONLY** | 2026-08-16 | 2.69% | 1.45 | -3.4% | $8,300 | Keep only Esports, NHL, Soccer; mute MLB, Tennis. Full 5.3% / last60d dash 3.2%. |
| 0x20D6436849F930584892730C7F96eBB2Ac763856 | **FADED** | 2026-08-13 | -0.62% | -3.21 | -12.67% | $3,861 | Last 90d dashboard -0.6% / hold 1.8%. |
| UAEVALORANTFAN | **VOLATILE** | 2026-08-16 | 24.6% | 2.84 | -5.9% | $4,470 | Worst recent month -92.0% ROI. |
| norrisfan | **FADED** | 2026-08-19 | -9.79% | -0.88 | -8.07% | $4,446 | Last 90d dashboard -9.8% / hold -8.6%. |
| JuniorB | **VOLATILE** | 2026-07-31 | 5.48% | 6.67 | -2.46% | $721 | Worst recent month -90.7% ROI. |
| Vetch | **VOLATILE** | 2026-08-02 | 13.53% | 1.36 | -9.13% | $2,480 | Last 30d dashboard -18.4% (n=56). |
| geniusMC | **STALE** | 2026-07-19 | -0.02% | 1.33 | -8.57% | $5,767 | Last dated event 2026-07-19 (30d ago). Do not tail stale markers. |
| Avarice31 | **STALE** | 2026-07-20 | 85.99% | 3.86 | -1.59% | $359 | Last dated event 2026-07-20 (29d ago). Do not tail stale markers. |

## Combinations

Leave-one-out on the 2+ Q50 moneyline book (play dropped if fewer than 2 voters remain):

| Dropped | Remaining n | Ask+2¢ ROI | Top remaining |
|---------|------------:|-----------:|---------------|
| GoalLineGhost | 149 | -9.23% | RN1 34% |
| ferrariChampions2026 | 250 | 32.18% | RN1 36% |
| RN1 | 250 | 54.13% | GoalLineGhost 42% |
| Cannae | 315 | 46.77% | GoalLineGhost 30% |
| BoomLaLa | 361 | 44.31% | GoalLineGhost 34% |
| 0xheavy888 | 361 | 44.31% | GoalLineGhost 34% |

Best co-occurring pairs (plays containing both names), ask+2¢:

| Pair | n | ROI | WR | Sharpe | Last |
|------|--:|----:|---:|-------:|------|
| GoalLineGhost + ferrariChampions2026 | 142 | 88.83% | 97.18% | 23.89 | 2026-08-17 |
| GoalLineGhost + RN1 | 105 | 72.89% | 94.29% | 21.36 | 2026-08-17 |
| Cannae + GoalLineGhost | 57 | 60.42% | 98.25% | 20.04 | 2026-08-16 |
| RN1 + ferrariChampions2026 | 48 | 26.82% | 75.0% | 8.09 | 2026-08-17 |
| Cannae + ferrariChampions2026 | 19 | 18.47% | 68.42% | 6.76 | 2026-08-16 |
| Cannae + RN1 | 16 | -3.71% | 62.5% | 3.92 | 2026-08-14 |
| JhonAlexanderHinestroza + RN1 | 15 | -61.29% | 26.67% | -16.43 | 2026-05-08 |

Best triples:

| Triple | n | ROI | WR | Last |
|--------|--:|----:|---:|------|
| Cannae + GoalLineGhost + ferrariChampions2026 | 13 | 73.14% | 100.0% | 2026-08-16 |
| GoalLineGhost + RN1 + ferrariChampions2026 | 37 | 64.52% | 97.3% | 2026-08-17 |

## Expert lanes (weight these, mute bleeds)

### RN1
Experts: Esports/Futures 63.31% (n=35); MLB/Moneyline 44.9% (n=960); Tennis/Moneyline 40.49% (n=5011); Tennis/Futures 35.16% (n=235); Other/Total 24.15% (n=5929); Tennis/Total 21.74% (n=65)
Bleed: Other/Map / Game -57.58% (n=24); MLB/Spread -39.81% (n=352); MLB/Total -22.29% (n=410); Other/Draw -10.2% (n=499)

### BoomLaLa
Experts: NHL/Total 17.29% (n=1228); Other/Total 11.01% (n=753)
Bleed: WNBA/Total -31.02% (n=57); Soccer/Spread -13.5% (n=152); MLB/Spread -13.18% (n=678); NBA/Spread -12.04% (n=673)

### ferrariChampions2026
Experts: Tennis/Futures 48.77% (n=141); NHL/Total 37.74% (n=23); Other/Total 31.27% (n=773); Soccer/Moneyline 26.18% (n=1272); Other/Moneyline 26.12% (n=1033); Soccer/Total 23.73% (n=1666)
Bleed: NBA/Total -14.5% (n=316); Other/Spread -11.66% (n=240); NHL/Moneyline -10.8% (n=52)

### GoalLineGhost
Experts: Soccer/Spread 66.86% (n=1027); Other/Spread 63.63% (n=918); Soccer/Moneyline 60.51% (n=1909); Soccer/Total 54.55% (n=2892); Other/Total 47.6% (n=1996); Other/Moneyline 46.98% (n=1658)

### 0xheavy888
Experts: Soccer/Total 57.54% (n=28); MLB/Spread 31.28% (n=48); Esports/Map / Game 23.16% (n=2866); Esports/Moneyline 19.27% (n=1817); Other/Total 9.34% (n=20)
Bleed: MLB/Total -15.7% (n=130)

### DLEK
Experts: NBA/Total 26.54% (n=318); WNBA/Moneyline 10.92% (n=93)

### TTdes
Experts: Soccer/Moneyline 26.49% (n=169)

### Supah9ga
Experts: Other/Moneyline 70.39% (n=53); NFL/Moneyline 27.66% (n=32); Soccer/Moneyline 18.33% (n=341); Esports/Moneyline 17.09% (n=75)

### 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a
Experts: NBA/Spread 22.2% (n=97); Other/Moneyline 17.75% (n=65)

### WTSA
Experts: Soccer/Moneyline 24.15% (n=61)

### Cannae
Experts: Other/Spread 44.26% (n=518); Other/Total 37.23% (n=1935); Other/Moneyline 36.15% (n=1160); Soccer/Moneyline 34.8% (n=1981); Other/Draw 30.8% (n=314); Soccer/Spread 13.91% (n=1150)
Bleed: MLB/Total -28.47% (n=101); NBA/Total -8.24% (n=1101)
Proposed mute: sports `MLB` · types `—`

### 0p0jogggg
Experts: Esports/Map / Game 45.07% (n=716); Soccer/Moneyline 36.13% (n=916); MLB/Spread 33.99% (n=32); Esports/Spread 32.52% (n=329); Other/Map / Game 25.48% (n=24); Esports/Moneyline 23.23% (n=2167)
Bleed: NHL/Total -16.96% (n=529); MLB/Total -15.64% (n=95); NFL/Moneyline -13.5% (n=106); Soccer/Draw -12.35% (n=143); Other/Spread -9.9% (n=890); Tennis/Futures -8.16% (n=75)
Proposed mute: sports `NFL` · types `draw`

### S-Works
Experts: MLB/Total 88.33% (n=32); Soccer/Total 50.22% (n=27); NHL/Total 36.56% (n=23); NFL/Spread 35.2% (n=24); Esports/Map / Game 22.84% (n=187); Esports/Total 22.14% (n=33)
Bleed: Soccer/Spread -84.27% (n=23); NBA/Spread -37.74% (n=96); Soccer/Futures -28.18% (n=76); Other/Player Prop -24.89% (n=20); Tennis/Futures -22.89% (n=53); Esports/Futures -21.46% (n=37)

### ShortFlutterStock
Experts: Soccer/Futures 38.1% (n=246); NFL/Spread 30.86% (n=36); NHL/Total 27.34% (n=77); NBA/Total 21.71% (n=27); Esports/Moneyline 14.03% (n=816); Other/Moneyline 12.88% (n=355)
Bleed: NHL/Spread -52.35% (n=26); Other/Spread -21.87% (n=52); MLB/Moneyline -20.26% (n=26); NBA/Moneyline -16.39% (n=143); NHL/Moneyline -12.11% (n=286); Esports/Total -10.05% (n=579)
Proposed mute: sports `MLB, NBA, NHL` · types `—`

### TutiFromFactsOfLife
Experts: NFL/Moneyline 25.01% (n=45); Soccer/Spread 8.16% (n=41)
Bleed: MLB/Total -14.78% (n=47); Soccer/Moneyline -13.97% (n=98)
Proposed mute: sports `—` · types `total`

### ShucksIt69
Experts: MLB/Spread 39.8% (n=28); Other/Spread 10.68% (n=24); MLB/Moneyline 8.52% (n=183)
Bleed: Other/Moneyline -16.63% (n=34); Soccer/Spread -12.16% (n=44)
Proposed mute: sports `—` · types `futures`

### JhonAlexanderHinestroza
Experts: Soccer/Moneyline 14.78% (n=721); Other/Spread 11.49% (n=32); Other/Moneyline 10.35% (n=308)
Bleed: Soccer/Spread -41.47% (n=43); Other/Total -15.56% (n=175)

### CoryLahey
Experts: Soccer/Spread 114.63% (n=23); NHL/Moneyline 30.73% (n=23); Soccer/Total 26.1% (n=64); Other/Futures 17.62% (n=20); NBA/Total 14.9% (n=87); Esports/Moneyline 14.87% (n=93)
Bleed: Other/Spread -41.77% (n=32); Tennis/Moneyline -26.5% (n=25); NBA/Spread -9.85% (n=90)
Proposed mute: sports `MLB, Tennis` · types `—`

### 0x20D6436849F930584892730C7F96eBB2Ac763856
Experts: MLB/Spread 62.38% (n=24); Other/Total 54.86% (n=95); Soccer/Spread 34.09% (n=24); MLB/Total 32.0% (n=21); NHL/Total 29.32% (n=80); NBA/Spread 13.54% (n=138)
Bleed: NBA/Total -29.03% (n=77); NHL/Spread -21.89% (n=42); NBA/Moneyline -19.12% (n=125); Other/Spread -15.89% (n=59)
Proposed mute: sports `NBA` · types `—`

### UAEVALORANTFAN
Experts: Esports/Spread 69.48% (n=26); Other/Spread 58.51% (n=25); Soccer/Moneyline 38.82% (n=75); Tennis/Moneyline 28.65% (n=24); Soccer/Total 12.44% (n=26); Esports/Moneyline 12.28% (n=414)
Bleed: Other/Total -40.6% (n=26); NBA/Total -16.22% (n=41); NHL/Moneyline -10.08% (n=67)
Proposed mute: sports `NHL, Other` · types `—`

### norrisfan
Experts: Other/Futures 20.67% (n=53)
Bleed: NBA/Moneyline -17.9% (n=30); Esports/Moneyline -9.83% (n=35)
Proposed mute: sports `NBA, Other` · types `draw, spread`

### JuniorB
Experts: Other/Futures 28.26% (n=82); Soccer/Moneyline 14.24% (n=187)
Bleed: Politics/Moneyline -85.93% (n=25); Tennis/Moneyline -28.81% (n=24); Politics/Futures -13.63% (n=32)
Proposed mute: sports `Politics` · types `—`

### Vetch
Experts: NHL/Moneyline 25.91% (n=31); Other/Moneyline 17.33% (n=40); Tennis/Moneyline 15.67% (n=120); NBA/Moneyline 14.0% (n=122); Esports/Moneyline 12.03% (n=203)

## New names not on our list

Screen only (not full-open). Do not tail until a unique open-book grade.

| Username | LB PnL | Hold ROI | Closed ROI | Bias | Windows |
|----------|-------:|---------:|-----------:|-----:|---------|
| 0xwise | $26,657 | 59.88% | 55.62% | -4 | all,month,week |

## Method

- ROI/PnL from PostgreSQL-ingested CSVs (hold-to-res + dashboard cash+realized). Never live portfolio math.
- Event dates from endDate / slug / title. Redeem timestamps are not recency.
- Consensus tape = walk-forward 2+ filtered wallets, warmed up, category filters applied.
- Ask-at-alert = max member VWAP (when the later voter made a 2+ alert possible), plus 2¢ slip. Optional CLOB mid at that timestamp.
- CLV expected ROI uses the last non-terminal CLOB price before endDate.

