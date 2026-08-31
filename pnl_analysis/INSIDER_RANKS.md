# Insider Ranks

As of **2026-08-24**. Polydata is the public calibration. Our Insider Score is built on **our** full books (winners + losers + recent closed, plus opens).

## Why this exists

Tracking sites rank individual traders with Smart Score, win rate, profit factor, Sharpe/Sortino, HHI, Kelly, bot score, and sports-category PnL. We want the same surface — customized for copy-tailing (recency + joinability) and fed by our CSVs, not a winner-sorted 10k closed-position dump.

Polydata Smart Score mix: PnL consistency 25%, WR quality 20%, risk 20%, diversification 15%, timing 10%, bot penalty 10%.

Our mix: PnL consistency 22%, WR 18%, risk 18%, diversification 8%, **recency 22%**, **copyability 12%**. DROP/DARK take-book names stay in the archive filter — they do not get a live copyability boost.

## Polydata Sports ranks (scraped profiles)

| Sports # | Trader | Sports PnL | Smart Score | WR | PF | Sharpe | On roster |
|--------:|--------|-----------:|------------:|---:|---:|-------:|:----------|
| 1 | [swisstony](https://polydata.pro/traders/swisstony) | +$23,509,332 | 74 | 58.0% | 1.15 | 0.909 | no |
| 2 | [RN1](https://polydata.pro/traders/RN1) | +$11,947,782 | 76 | 55.0% | 1.32 | 1.297 | yes |
| 3 | [kch123](https://polydata.pro/traders/kch123) | +$11,485,086 | 59 | 55.0% | 1.12 | 0.75 | yes |
| 11 | [KeyTransporter](https://polydata.pro/traders/KeyTransporter) | +$5,711,460 | 89 | 71.0% | 6.15 | 11.382 | yes |
| 15 | [0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563](https://polydata.pro/traders/0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563) | +$4,585,293 | 76 | 56.0% | 1.17 | 1.161 | yes |
| 25 | [sainttroplay](https://polydata.pro/traders/sainttroplay) | +$3,622,316 | 58 | 67.0% | 2.51 | — | yes |
| 28 | [asparagus2012](https://polydata.pro/traders/asparagus2012) | +$3,562,640 | 83 | 63.0% | 32.34 | 8.051 | yes |
| 31 | [ferrariChampions2026](https://polydata.pro/traders/ferrariChampions2026) | +$2,968,715 | 71 | 48.0% | 1.09 | 1.233 | yes |
| 37 | [0x5966Db1fE50763C9e3C014d756369BAd07E1F804](https://polydata.pro/traders/0x5966Db1fE50763C9e3C014d756369BAd07E1F804) | +$2,665,879 | 94 | 62.0% | 1.81 | 7.088 | yes |
| 46 | [HomeRunHazard](https://polydata.pro/traders/HomeRunHazard) | +$2,274,381 | 60 | 54.0% | 1.05 | 1.366 | yes |
| 53 | [geniusMC](https://polydata.pro/traders/geniusMC) | +$2,091,209 | 39 | 83.0% | 0.82 | -1.007 | yes |
| 57 | [Supah9ga](https://polydata.pro/traders/Supah9ga) | +$1,946,119 | 82 | 53.0% | 1.52 | 3.393 | yes |
| 58 | [CemeterySun](https://polydata.pro/traders/CemeterySun) | +$1,927,133 | 45 | 52.0% | 1.02 | 0.471 | yes |
| 59 | [S-Works](https://polydata.pro/traders/S-Works) | +$1,894,767 | 76 | 70.0% | 1.14 | 1.218 | yes |
| 66 | [3edmond.dantes](https://polydata.pro/traders/3edmond.dantes) | +$1,639,979 | 47 | 75.0% | 1.46 | — | yes |
| 72 | [Qpkwks](https://polydata.pro/traders/Qpkwks) | +$1,536,999 | 68 | 32.0% | 1.59 | 4.375 | yes |
| 75 | [DLEK](https://polydata.pro/traders/DLEK) | +$1,516,512 | 71 | 55.0% | 1.19 | 1.706 | yes |
| 85 | [Cannae](https://polydata.pro/traders/Cannae) | +$1,396,623 | 72 | 52.0% | 1.26 | 3.258 | yes |
| 91 | [0xD9E0AACa471f48F91A26E8669A805f2](https://polydata.pro/traders/0xD9E0AACa471f48F91A26E8669A805f2) | +$1,295,318 | 65 | 63.0% | 1.1 | 1.523 | yes |
| 107 | [0xE30E74595517de48f1FB19f4553dd3d9F1E96B87](https://polydata.pro/traders/0xE30E74595517de48f1FB19f4553dd3d9F1E96B87) | +$1,133,573 | 20 | 45.0% | 0.78 | -1.386 | yes |
| 113 | [ripley86alien](https://polydata.pro/traders/ripley86alien) | +$1,094,910 | 65 | 100.0% | 99.0 | — | yes |
| 135 | [HedgeMaster88](https://polydata.pro/traders/HedgeMaster88) | +$931,923 | 75 | 53.0% | 1.35 | 4.128 | yes |
| 144 | [0x1b20a00709DfE648AFd26b326394b5e031f83ab0](https://polydata.pro/traders/0x1b20a00709DfE648AFd26b326394b5e031f83ab0) | +$872,748 | 22 | 75.0% | 0.42 | — | yes |
| 154 | [ckw](https://polydata.pro/traders/ckw) | +$826,378 | 64 | 56.0% | 1.07 | 0.891 | yes |
| 169 | [02-](https://polydata.pro/traders/02-) | +$714,784 | 32 | 62.0% | 0.84 | -1.425 | yes |

## Take book (the copy list)

Copyable = the 12 matched sports books in `trusted_full_books.json`. Health KICK on hold-to-res does **not** remove a take-book name.

| Trader | Recency | Last | Our PnL | Our WR | PD WR | ΔWR | Accuracy | Closed |
|--------|---------|------|--------:|-------:|------:|----:|----------|-------:|
| Supah9ga | HOT | 2026-08-15 | +$1,967,685 | 52.23% | 53.0% | -0.8 | matched | 549 |
| WTSA | HOT | 2026-08-17 | +$1,154,695 | 53.44% | 54.0% | -0.6 | matched | 0 |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | HOT | 2026-08-25 | +$708,973 | 54.24% | 58.0% | -3.8 | matched | 435 |
| DLEK | COLD | 2026-07-30 | +$1,362,509 | 55.62% | 55.0% | +0.6 | matched | 1123 |
| Vetch | COLD | 2026-08-02 | +$321,365 | 60.79% | 61.0% | -0.2 | matched | 613 |
| 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | DARK | 2026-07-16 | +$3,458,340 | 58.24% | 62.0% | -3.8 | matched | 0 |
| kch123 | DROP | 2026-07-01 | +$12,061,185 | 58.0% | 55.0% | +3.0 | matched | 3818 |
| HedgeMaster88 | DROP | 2026-05-27 | +$931,923 | 53.39% | 53.0% | +0.4 | matched | 136 |
| ckw | DARK | 2026-07-26 | +$839,272 | 54.93% | 56.0% | -1.1 | matched | 2384 |
| Capman | DROP | 2026-04-08 | +$267,281 | 55.09% | 54.0% | +1.1 | matched | 15803 |
| Bienville | DROP | 2026-04-30 | +$391,645 | 50.15% | 52.0% | -1.9 | matched | 0 |
| tcp2 | DROP | 2026-04-16 | +$539,799 | 49.93% | 55.0% | -5.1 | matched | 20810 |

**Take book (12):** Supah9ga, WTSA, 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a, DLEK, Vetch, 0x5966Db1fE50763C9e3C014d756369BAd07E1F804, kch123, HedgeMaster88, ckw, Capman, Bienville, tcp2

**Kicked / do-not-copy (30):** GoalLineGhost, fkgggg2, HomeRunHazard, iDropMyHotdog, xytest, EIf, TheArena, 0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563, quavoo, wr0ngw4yb3tt0r, Qpkwks, 0xwise, TheMangler, 0x53eCc53E7, bigmoneyloser00, ferrariChampions2026, RandomPunter, middleoftheocean, 0xCb6Ed9332A8FD1b930893c705dd234f37aa248E6, redskinrick, 0p0jogggg, 877s8d8g89I9f8d98fd99ww2, CemeterySun, 9sh8f, JPMorgan101, mentionmarket, midwicket72, betterfasterstronger, HOG993, LynxTitan

## Notes

- ROI/PnL come from our CSVs (`dashboard_pnl` = realized + cash on the full book).
- Accuracy `matched` = our WR within 6pp of Polydata and PnL same sign / within 3x.
- Kicked names stay in the file so the UI can show what we removed.
- swisstony is Sports #1 on Polydata and is listed as reference-only until we ingest a full book.

