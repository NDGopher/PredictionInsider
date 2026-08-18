# Trader health re-grade (hold-to-resolution through today)

As of **2026-08-18**. Closed-only CSVs were win-biased: losers stay `status=open` until redeem. This review treats `curPrice` 0 or 1 as settled, dates games from `endDate` or the slug/title, and drops still-future markets.

## Cannae

- **Action: OVERLAY** — Keep only as a soccer moneyline overlay, never an unfiltered 2+ voter. Honest hold-to-res is 27.1% on 14602 markets and last 90d is 56.0% (n=385), but volume collapsed after April (Jan–Apr was ~60 markets/day; May–Aug is a thin book). Spreads/totals/draws/UCL/NBA/NFL and YES-side stay blocked. Leave-one-out showed he inflates 2+ soccer-NO clusters.
- Full honest book: n=14602, WR=53.8%, ROI=**27.13%**, last date=2026-08-16
- Last 90d: n=385, ROI=55.95%
- Last 30d: n=34, ROI=50.31%
- May–Aug 2026 dated subset: n=571, ROI=63.75%

He is **still +ROI** on hold-to-resolution. The last few months look like a **volume collapse** (and a noisy live UI full of unredeemed losers), not a -50% wipeout. Do not use him as a 2+ voter.

By sport:

| Sport | n | WR | ROI |
|-------|--:|---:|----:|
| Soccer | 7729 | 54.2% | 28.88% |
| NBA | 3114 | 50.6% | 11.97% |
| Other | 2908 | 57.2% | 41.82% |
| NHL | 573 | 50.3% | 12.6% |
| MLB | 251 | 48.6% | 3.63% |
| NFL | 27 | 51.9% | 26.75% |

By submarket:

| Type | n | WR | ROI |
|------|--:|---:|----:|
| Total | 7767 | 50.7% | 26.34% |
| Moneyline | 3604 | 55.7% | 29.58% |
| Spread | 2624 | 60.6% | 22.03% |
| Draw | 607 | 52.6% | 18.07% |

By side (Yes/No/Over/Under only; team names omitted):

| Side | n | WR | ROI |
|------|--:|---:|----:|
| Yes | 678 | 40.9% | 69.12% |
| No | 1604 | 65.5% | 25.92% |
| Over | 3399 | 60.4% | 22.33% |
| Under | 4368 | 43.0% | 28.97% |
| over | 3399 | 60.4% | 22.33% |
| under | 4368 | 43.0% | 28.97% |

## Roster decisions

KEEP 23 · TIGHTEN 16 · OVERLAY 1 · WATCH 7 · KICK 3

| Trader | Action | n | ROI | 90d n | 90d ROI | Last date | Why |
|--------|--------|--:|----:|------:|--------:|-----------|-----|
| 0x53eCc53E7 | **KICK** | 753 | -4.71% | 186 | -49.51% | 2026-07-20 | Last 90d collapsed (-49.5% on 186). Full-sample -4.7% is not enough to keep. |
| LynxTitan | **KICK** | 30473 | 4.04% | 222 | -92.32% | 2026-07-20 | Last 90d collapsed (-92.3% on 222). Full-sample 4.0% is not enough to keep. |
| geniusMC | **KICK** | 583 | 4.75% | 35 | -20.86% | 2026-07-19 | Last 90d collapsed (-20.9% on 35). Full-sample 4.8% is not enough to keep. |
| xytest | **WATCH** | 7035 | 2.48% | 2717 | 1.15% | 2026-08-17 | Mixed: full 2.5% (n=7035), last90 1.1% (n=2717). Revisit after more games. |
| 9sh8f | **WATCH** | 701 | 3.45% | 0 | 0.0% | 2026-04-02 | Mixed: full 3.5% (n=701), last90 0.0% (n=0). Revisit after more games. |
| redskinrick | **WATCH** | 846 | 5.19% | 0 | 0.0% | 2026-04-07 | Mixed: full 5.2% (n=846), last90 0.0% (n=0). Revisit after more games. |
| JPMorgan101 | **WATCH** | 424 | 14.03% | 50 | -27.5% | 2026-07-02 | Mixed: full 14.0% (n=424), last90 -27.5% (n=50). Revisit after more games. |
| ckw | **WATCH** | 2394 | 23.61% | 60 | -19.91% | 2026-07-26 | Mixed: full 23.6% (n=2394), last90 -19.9% (n=60). Revisit after more games. |
| 0xCb6Ed9332A8FD1b930893c705dd234f37aa248E6 | **WATCH** | 28 | 26.25% | 0 | 0.0% | 2026-03-30 | Mixed: full 26.2% (n=28), last90 0.0% (n=0). Revisit after more games. |
| kch123 | **WATCH** | 3727 | 35.28% | 33 | -39.37% | 2026-07-01 | Mixed: full 35.3% (n=3727), last90 -39.4% (n=33). Revisit after more games. |
| 0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563 | **TIGHTEN** | 7235 | -2.76% | 5088 | -3.22% | 2026-08-19 | Keep only Esports, NHL; mute NBA, Tennis; skip Futures. Full -2.8% / last90 -3.2%. |
| TutiFromFactsOfLife | **TIGHTEN** | 2341 | -1.98% | 313 | -7.58% | 2026-08-16 | Keep only NFL; skip Total. Full -2.0% / last90 -7.6%. |
| norrisfan | **TIGHTEN** | 943 | -1.27% | 336 | -8.51% | 2026-08-19 | Keep only Soccer; mute NBA, Other; skip Draw, Spread. Full -1.3% / last90 -8.5%. |
| TheMangler | **TIGHTEN** | 3265 | -0.55% | 2238 | 2.02% | 2026-08-19 | Keep only MLB, NHL, Tennis, WNBA; mute NBA, NFL, Other, Politics; skip Draw, Futures. Full -0.6% / last90 2.0%. |
| iDropMyHotdog | **TIGHTEN** | 2474 | 1.07% | 110 | -9.77% | 2026-08-17 | Keep only NFL, NHL; mute Other, Tennis. Full 1.1% / last90 -9.8%. |
| JuniorB | **TIGHTEN** | 820 | 1.82% | 18 | 11.68% | 2026-07-31 | Keep only Soccer; mute Politics. Full 1.8% / last90 11.7%. |
| Bienville | **TIGHTEN** | 3078 | 2.2% | 0 | 0.0% | 2026-04-30 | Keep only Soccer; mute Esports, Tennis; skip Futures, Spread. Full 2.2% / last90 0.0%. |
| middleoftheocean | **TIGHTEN** | 1028 | 2.7% | 8 | -73.59% | 2026-06-30 | Keep only NFL; mute NBA; skip Total. Full 2.7% / last90 -73.6%. |
| UAEVALORANTFAN | **TIGHTEN** | 1144 | 2.71% | 168 | 24.63% | 2026-08-16 | Keep only Esports, Soccer, Tennis; mute Other; skip Total. Full 2.7% / last90 24.6%. |
| 877s8d8g89I9f8d98fd99ww2 | **TIGHTEN** | 635 | 4.0% | 0 | 0.0% | 2026-05-15 | Keep only NBA, Soccer; mute Other, Tennis. Full 4.0% / last90 0.0%. |
| 0x20D6436849F930584892730C7F96eBB2Ac763856 | **TIGHTEN** | 1521 | 4.2% | 274 | 1.82% | 2026-08-13 | Keep only MLB, NFL, Other; mute NBA. Full 4.2% / last90 1.8%. |
| CoryLahey | **TIGHTEN** | 1486 | 6.0% | 457 | 2.53% | 2026-08-16 | Keep only Esports, NHL, Soccer; mute MLB. Full 6.0% / last90 2.5%. |
| DLEK | **TIGHTEN** | 1566 | 6.67% | 44 | 70.35% | 2026-07-29 | Keep only NFL, Other; mute Soccer. Full 6.7% / last90 70.3%. |
| ShortFlutterStock | **TIGHTEN** | 4606 | 11.25% | 696 | 3.85% | 2026-08-03 | Keep only Esports, NFL, Soccer; mute MLB. Full 11.2% / last90 3.9%. |
| Vetch | **TIGHTEN** | 656 | 11.8% | 102 | 13.14% | 2026-08-02 | Keep only Esports, NBA, NHL, Other, Tennis; mute Soccer. Full 11.8% / last90 13.1%. |
| RandomPunter | **TIGHTEN** | 9906 | 22.09% | 0 | 0.0% | 2026-03-16 | NO-side only (NO 29.1% vs YES -6.5%). Mute YES. |
| Cannae | **OVERLAY** | 14602 | 27.13% | 385 | 55.95% | 2026-08-16 | Keep only as a soccer moneyline overlay, never an unfiltered 2+ voter. Honest hold-to-res is 27.1% on 14602 markets and last 90d is 56.0% (n=385), but volume collapsed after April (Jan–Apr was ~60 markets/day; May–Aug is a thin book). Spreads/totals/draws/UCL/NBA/NFL and YES-side stay blocked. Leave-one-out showed he inflates 2+ soccer-NO clusters. |
| fkgggg2 | **KEEP** | 3757 | 4.55% | 606 | 2.51% | 2026-08-17 | Modest but positive: 4.5% full, 2.5% last 90d. |
| EIf | **KEEP** | 4276 | 4.86% | 508 | 6.11% | 2026-08-18 | Still printing: last 90d 6.1% (n=508), full 4.9% on 4276. |
| JhonAlexanderHinestroza | **KEEP** | 1866 | 9.14% | 562 | 2.98% | 2026-08-17 | Full-sample 9.1% on 1866. Recent book is thin or flat, not a blow-up. |
| TTdes | **KEEP** | 1160 | 9.85% | 63 | 49.81% | 2026-08-16 | Still printing: last 90d 49.8% (n=63), full 9.8% on 1160. |
| CemeterySun | **KEEP** | 5334 | 12.2% | 0 | 0.0% | 2026-04-30 | Full-sample 12.2% on 5334. Recent book is thin or flat, not a blow-up. |
| bloodmaster | **KEEP** | 2639 | 12.47% | 303 | 22.05% | 2026-08-18 | Still printing: last 90d 22.1% (n=303), full 12.5% on 2639. |
| S-Works | **KEEP** | 6677 | 13.18% | 223 | 51.29% | 2026-08-16 | Still printing: last 90d 51.3% (n=223), full 13.2% on 6677. |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | **KEEP** | 435 | 14.33% | 229 | 4.85% | 2026-08-19 | Full-sample 14.3% on 435. Recent book is thin or flat, not a blow-up. |
| Qpkwks | **KEEP** | 58 | 14.5% | 58 | 14.5% | 2026-08-17 | Still printing: last 90d 14.5% (n=58), full 14.5% on 58. |
| Avarice31 | **KEEP** | 12475 | 16.22% | 5 | 151.78% | 2026-07-20 | Full-sample 16.2% on 12475. Recent book is thin or flat, not a blow-up. |
| tcp2 | **KEEP** | 13513 | 17.11% | 0 | 0.0% | 2026-04-13 | Full-sample 17.1% on 13513. Recent book is thin or flat, not a blow-up. |
| HedgeMaster88 | **KEEP** | 235 | 19.09% | 1 | 12.32% | 2026-05-27 | Full-sample 19.1% on 235. Recent book is thin or flat, not a blow-up. |
| BoomLaLa | **KEEP** | 24545 | 19.13% | 861 | 9.31% | 2026-08-19 | Still printing: last 90d 9.3% (n=861), full 19.1% on 24545. |
| Supah9ga | **KEEP** | 673 | 20.02% | 17 | 48.19% | 2026-08-15 | Still printing: last 90d 48.2% (n=17), full 20.0% on 673. |
| WTSA | **KEEP** | 128 | 20.31% | 128 | 20.31% | 2026-08-17 | Still printing: last 90d 20.3% (n=128), full 20.3% on 128. |
| Andromeda1 | **KEEP** | 2168 | 21.32% | 250 | 25.23% | 2026-07-19 | Still printing: last 90d 25.2% (n=250), full 21.3% on 2168. |
| bigmoneyloser00 | **KEEP** | 15146 | 22.26% | 0 | 0.0% | 2026-04-13 | Full-sample 22.3% on 15146. Recent book is thin or flat, not a blow-up. |
| RN1 | **KEEP** | 50642 | 23.37% | 1715 | 53.53% | 2026-08-19 | Still printing: last 90d 53.5% (n=1715), full 23.4% on 50642. |
| Capman | **KEEP** | 7338 | 30.09% | 0 | 0.0% | 2026-04-08 | Full-sample 30.1% on 7338. Recent book is thin or flat, not a blow-up. |
| 0p0jogggg | **KEEP** | 25622 | 30.52% | 154 | 65.5% | 2026-08-17 | Still printing: last 90d 65.5% (n=154), full 30.5% on 25622. |
| 0xheavy888 | **KEEP** | 7227 | 32.91% | 850 | 40.34% | 2026-08-19 | Still printing: last 90d 40.3% (n=850), full 32.9% on 7227. |
| ShucksIt69 | **KEEP** | 2371 | 32.92% | 161 | 64.64% | 2026-08-16 | Still printing: last 90d 64.6% (n=161), full 32.9% on 2371. |
| TheArena | **KEEP** | 2048 | 38.68% | 560 | 56.24% | 2026-08-17 | Still printing: last 90d 56.2% (n=560), full 38.7% on 2048. |

## Method

Hold-to-resolution on every price-resolved row (curPrice 0/1), including status=open unredeemed losers. Event date from endDate or slug/title. Hedges and 95¢ NO bonds stripped. ROI = hold PnL / cost, not scalp realizedPnl.
