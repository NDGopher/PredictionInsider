# Trader health re-grade (hold-to-resolution through today)

As of **2026-08-18**. Last 30/60/90d are **dashboard PnL** (`realizedPnl + cashPnl`) on event-dated resolved rows, including unredeemed losers. Fill/redeem timestamps are never used (that bug made Cannae last-60d look like all winners). Hold-to-res is still used for overall copy-edge.

## Cannae

- **Action: OVERLAY** — Keep only as a soccer moneyline overlay, never an unfiltered 2+ voter. Hold-to-res 21.5% on 16112; last 60d dashboard 45.2% (n=874). Spreads/totals/draws/UCL/NBA/NFL and YES-side stay blocked.
- Full honest hold-to-res: n=16112, WR=51.7%, ROI=**21.52%**, last date=2026-08-18
- Last 90d dashboard: n=1538, PnL=$3,325,204.04, ROI=44.85%
- Last 60d dashboard: n=874, PnL=$1,768,619.66, ROI=**45.21%**
- Last 30d dashboard: n=412, PnL=$111,536.39, ROI=24.97%
- Last 30d **copy WR is 21.8%** (size-weighted PnL is carried by a few World Cup bombs you will not get at $100/play).
- Open-book mark-to-market is about **−$16.5M** on 13k unique unredeemed rows; Polymarket portfolio value is ~$45k. Closed-only “+44% ROI” was the bug.
- May–Aug 2026 dated subset: n=2576, ROI=53.33%

By sport:

| Sport | n | WR | ROI |
|-------|--:|---:|----:|
| Soccer | 9118 | 50.4% | 23.79% |
| Other | 3927 | 51.5% | 36.14% |
| NBA | 2400 | 54.5% | -2.2% |
| NHL | 413 | 64.2% | 3.53% |
| MLB | 238 | 49.6% | -14.36% |
| NFL | 16 | 75.0% | 8.95% |

By submarket:

| Type | n | WR | ROI |
|------|--:|---:|----:|
| Total | 8380 | 49.6% | 14.47% |
| Moneyline | 4270 | 49.6% | 27.16% |
| Spread | 2401 | 68.4% | 11.68% |
| Draw | 1061 | 39.0% | 15.41% |

By side (Yes/No/Over/Under/Specific only):

| Side | n | WR | ROI |
|------|--:|---:|----:|
| Under | 4817 | 41.6% | 15.43% |
| Specific | 3658 | 65.3% | 6.05% |
| Over | 3563 | 60.3% | 12.98% |
| No | 2743 | 50.9% | 25.28% |
| Yes | 1331 | 29.1% | 69.3% |

## Roster decisions

KEEP 12 · TIGHTEN 14 · OVERLAY 1 · WATCH 1 · KICK 28

| Trader | Action | n | ROI | 60d n | 60d dash ROI | Last date | Why |
|--------|--------|--:|----:|------:|-------------:|-----------|-----|
| 0x53eCc53E7 | **KICK** | 727 | -14.22% | 104 | -60.17% | 2026-07-20 | Last 60d dashboard -60.2% (n=104). Recent form is not copyable. |
| quavoo | **KICK** | 5504 | -10.51% | 5659 | -8.96% | 2026-08-19 | 5504 markets at -10.5% ROI — volume grinder with no copyable edge. Do not tail. |
| wr0ngw4yb3tt0r | **KICK** | 6795 | -6.09% | 6337 | -2.09% | 2026-08-19 | 6795 markets at -6.1% ROI — volume grinder with no copyable edge. Do not tail. |
| TheMangler | **KICK** | 5049 | -5.77% | 3282 | -8.75% | 2026-08-19 | 5049 markets at -5.8% ROI — volume grinder with no copyable edge. Do not tail. |
| EIf | **KICK** | 4458 | -3.38% | 643 | -11.93% | 2026-08-18 | 4458 markets at -3.4% ROI — volume grinder with no copyable edge. Do not tail. |
| 0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563 | **KICK** | 6015 | -2.76% | 4760 | -1.33% | 2026-08-19 | 6015 markets at -2.8% ROI — volume grinder with no copyable edge. Do not tail. |
| TheArena | **KICK** | 2411 | -0.77% | 451 | -2.98% | 2026-08-17 | 2411 markets at -0.8% ROI — volume grinder with no copyable edge. Do not tail. |
| middleoftheocean | **KICK** | 1020 | -0.06% | 2 | -12.41% | 2026-07-01 | No dated activity in 45+ days (last=2026-07-01). Account looks quit or dormant — do not tail stale markers. |
| LynxTitan | **KICK** | 23181 | 0.09% | 442 | -44.43% | 2026-07-20 | 23181 markets at 0.1% ROI — volume grinder with no copyable edge. Do not tail. |
| HomeRunHazard | **KICK** | 24156 | 0.97% | 18276 | 0.88% | 2026-08-19 | 24156 markets at 1.0% ROI — volume grinder with no copyable edge. Do not tail. |
| iDropMyHotdog | **KICK** | 2444 | 1.07% | 28 | 12.17% | 2026-08-17 | 2444 markets at 1.1% ROI — volume grinder with no copyable edge. Do not tail. |
| bigmoneyloser00 | **KICK** | 12595 | 1.35% | 0 | 0.0% | 2026-04-13 | No dated activity in 45+ days (last=2026-04-13). Account looks quit or dormant — do not tail stale markers. |
| ckw | **KICK** | 2225 | 1.72% | 45 | 0.4% | 2026-07-26 | 2225 markets at 1.7% ROI — volume grinder with no copyable edge. Do not tail. |
| fkgggg2 | **KICK** | 3149 | 1.93% | 662 | 0.13% | 2026-08-17 | 3149 markets at 1.9% ROI — volume grinder with no copyable edge. Do not tail. |
| Bienville | **KICK** | 2503 | 2.2% | 0 | 0.0% | 2026-04-30 | No dated activity in 45+ days (last=2026-04-30). Account looks quit or dormant — do not tail stale markers. |
| xytest | **KICK** | 4083 | 2.48% | 1984 | 0.79% | 2026-08-17 | 4083 markets at 2.5% ROI — volume grinder with no copyable edge. Do not tail. |
| tcp2 | **KICK** | 9093 | 2.87% | 0 | 0.0% | 2026-04-16 | No dated activity in 45+ days (last=2026-04-16). Account looks quit or dormant — do not tail stale markers. |
| RandomPunter | **KICK** | 7186 | 3.27% | 0 | 0.0% | 2026-05-27 | No dated activity in 45+ days (last=2026-05-27). Account looks quit or dormant — do not tail stale markers. |
| 9sh8f | **KICK** | 676 | 3.45% | 0 | 0.0% | 2026-04-02 | No dated activity in 45+ days (last=2026-04-02). Account looks quit or dormant — do not tail stale markers. |
| 877s8d8g89I9f8d98fd99ww2 | **KICK** | 627 | 4.58% | 0 | 0.0% | 2026-05-15 | No dated activity in 45+ days (last=2026-05-15). Account looks quit or dormant — do not tail stale markers. |
| CemeterySun | **KICK** | 4991 | 4.8% | 0 | 0.0% | 2026-04-30 | No dated activity in 45+ days (last=2026-04-30). Account looks quit or dormant — do not tail stale markers. |
| redskinrick | **KICK** | 835 | 4.83% | 0 | 0.0% | 2026-04-07 | No dated activity in 45+ days (last=2026-04-07). Account looks quit or dormant — do not tail stale markers. |
| kch123 | **KICK** | 2462 | 7.8% | 17 | -17.87% | 2026-07-01 | No dated activity in 45+ days (last=2026-07-01). Account looks quit or dormant — do not tail stale markers. |
| Capman | **KICK** | 6079 | 11.6% | 0 | 0.0% | 2026-04-08 | No dated activity in 45+ days (last=2026-04-08). Account looks quit or dormant — do not tail stale markers. |
| JPMorgan101 | **KICK** | 345 | 14.03% | 7 | -90.8% | 2026-07-02 | No dated activity in 45+ days (last=2026-07-02). Account looks quit or dormant — do not tail stale markers. |
| Qpkwks | **KICK** | 58 | 14.5% | 66 | 19.1% | 2026-08-17 | Median stake $91,583 — too large to join. |
| HedgeMaster88 | **KICK** | 235 | 19.08% | 0 | 0.0% | 2026-05-27 | No dated activity in 45+ days (last=2026-05-27). Account looks quit or dormant — do not tail stale markers. |
| 0xCb6Ed9332A8FD1b930893c705dd234f37aa248E6 | **KICK** | 28 | 26.25% | 0 | 0.0% | 2026-03-30 | No dated activity in 45+ days (last=2026-03-30). Account looks quit or dormant — do not tail stale markers. |
| Avarice31 | **WATCH** | 8972 | 5.0% | 1 | -100.0% | 2026-07-20 | Mixed: full 5.0% (n=8972), last60d dash -100.0% (n=1). Revisit after more games. |
| TutiFromFactsOfLife | **TIGHTEN** | 1953 | -1.98% | 144 | -8.54% | 2026-08-16 | Keep only NFL; skip Total. Full -2.0% / last60d dash -8.5%. |
| norrisfan | **TIGHTEN** | 888 | -1.98% | 261 | -4.77% | 2026-08-19 | Keep only Soccer; mute NBA, Other; skip Draw, Spread. Full -2.0% / last60d dash -4.8%. |
| geniusMC | **TIGHTEN** | 466 | 1.33% | 12 | 0.12% | 2026-07-19 | Keep only Other, Soccer; mute NFL, NHL. Full 1.3% / last60d dash 0.1%. |
| JuniorB | **TIGHTEN** | 794 | 2.06% | 18 | 6.25% | 2026-07-31 | Keep only Soccer; mute Politics. Full 2.1% / last60d dash 6.2%. |
| UAEVALORANTFAN | **TIGHTEN** | 1117 | 3.65% | 160 | 32.36% | 2026-08-16 | Keep only Esports, Soccer, Tennis; mute NHL, Other; skip Total. Full 3.6% / last60d dash 32.4%. |
| ShucksIt69 | **TIGHTEN** | 1937 | 4.16% | 153 | -3.94% | 2026-08-16 | Keep only MLB; skip Futures. Full 4.2% / last60d dash -3.9%. |
| 0x20D6436849F930584892730C7F96eBB2Ac763856 | **TIGHTEN** | 1369 | 4.2% | 211 | 0.61% | 2026-08-13 | Keep only MLB, NFL, Other; mute NBA. Full 4.2% / last60d dash 0.6%. |
| Andromeda1 | **TIGHTEN** | 1940 | 4.56% | 78 | 6.11% | 2026-07-19 | Keep only MLB, NBA, NFL, Other; mute Tennis. Full 4.6% / last60d dash 6.1%. |
| ShortFlutterStock | **TIGHTEN** | 4934 | 5.19% | 799 | 3.59% | 2026-08-03 | Keep only Esports, NFL, Soccer, WNBA; mute MLB, NBA, NHL. Full 5.2% / last60d dash 3.6%. |
| CoryLahey | **TIGHTEN** | 1468 | 5.33% | 380 | 3.19% | 2026-08-16 | Keep only Esports, NHL, Soccer; mute MLB, Tennis. Full 5.3% / last60d dash 3.2%. |
| JhonAlexanderHinestroza | **TIGHTEN** | 1859 | 6.23% | 481 | -2.57% | 2026-08-18 | Keep only Soccer; skip Spread. Full 6.2% / last60d dash -2.6%. |
| S-Works | **TIGHTEN** | 5662 | 6.79% | 104 | 40.84% | 2026-08-15 | Keep only Esports, Soccer, Tennis, WNBA; skip Player Prop. Full 6.8% / last60d dash 40.8%. |
| 0p0jogggg | **TIGHTEN** | 20225 | 11.25% | 177 | 70.73% | 2026-08-17 | Keep only Esports, NBA, Soccer; mute NFL; skip Draw. Full 11.2% / last60d dash 70.7%. |
| Vetch | **TIGHTEN** | 565 | 11.99% | 103 | 13.53% | 2026-08-02 | Keep only Esports, NBA, NHL, Other, Tennis; mute Soccer. Full 12.0% / last60d dash 13.5%. |
| Cannae | **OVERLAY** | 16112 | 21.52% | 874 | 45.21% | 2026-08-18 | Keep only as a soccer moneyline overlay, never an unfiltered 2+ voter. Hold-to-res 21.5% on 16112; last 60d dashboard 45.2% (n=874). Spreads/totals/draws/UCL/NBA/NFL and YES-side stay blocked. |
| 0xE30E74595517de48f1FB19f4553dd3d9F1E96B87 | **KEEP** | 94 | 3.5% | 35 | 13.11% | 2026-08-19 | Modest but positive: 3.5% full, 3.1% last 90d. |
| bloodmaster | **KEEP** | 2667 | 4.11% | 317 | 1.62% | 2026-08-18 | Modest but positive: 4.1% full, 2.6% last 90d. |
| BoomLaLa | **KEEP** | 19363 | 4.42% | 973 | -1.21% | 2026-08-19 | Still printing: last 90d 10.2% (n=2136), full 4.4% on 19363. |
| DLEK | **KEEP** | 1464 | 8.01% | 38 | 82.07% | 2026-07-29 | Still printing: last 90d 74.9% (n=42), full 8.0% on 1464. |
| TTdes | **KEEP** | 1097 | 11.27% | 39 | 27.65% | 2026-08-16 | Still printing: last 90d 29.7% (n=70), full 11.3% on 1097. |
| ferrariChampions2026 | **KEEP** | 18687 | 14.19% | 10909 | 27.18% | 2026-08-19 | Still printing: last 90d 29.8% (n=14044), full 14.2% on 18687. |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | **KEEP** | 435 | 14.33% | 177 | -1.25% | 2026-08-19 | Still printing: last 90d 5.0% (n=229), full 14.3% on 435. |
| RN1 | **KEEP** | 46409 | 19.49% | 4284 | 63.83% | 2026-08-19 | Still printing: last 90d 63.1% (n=5880), full 19.5% on 46409. |
| 0xheavy888 | **KEEP** | 5514 | 19.55% | 1076 | 30.04% | 2026-08-19 | Still printing: last 90d 30.5% (n=1410), full 19.6% on 5514. |
| WTSA | **KEEP** | 128 | 20.31% | 130 | 20.3% | 2026-08-17 | Still printing: last 90d 20.3% (n=130), full 20.3% on 128. |
| Supah9ga | **KEEP** | 660 | 20.8% | 6 | -73.81% | 2026-08-15 | Still printing: last 90d 52.6% (n=17), full 20.8% on 660. |
| GoalLineGhost | **KEEP** | 11807 | 49.84% | 7736 | 48.0% | 2026-08-18 | Still printing: last 90d 48.8% (n=9915), full 49.8% on 11807. |

## Method

Hold-to-resolution on directional price-resolved rows (curPrice 0/1 or redeemable), including status=open unredeemed losers. Last 30/60/90d use dashboard PnL (realizedPnl+cashPnl) on ALL resolved rows dated from endDate or slug/title — never fill/redeem timestamps. Hedges and 95¢ NO bonds stripped from hold-to-res only. Quit = no dated activity in 45+ days. Untailable = MM, $50k+ median, or 94%+ WR grinders.
