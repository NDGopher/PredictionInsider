# Working copy model

Generated **2026-08-18T23:18:31 UTC**. Pull this file plus `pnl_analysis/output/working_copy_model.json` and `pnl_analysis/output/recent_take_alerts.json` — they are committed, not CSVs.

Product rule: **`asof_live_q60_sport_rel2`** — Q≥60, sport-lane ROI≥+5%, rel≥2× median, 10–88¢, no NFL, fill VWAP+2¢, hold to resolution. Unique-book ROI/PnL is truth. Polydata month curves are discovery only.

## Live copy (Take these tails these names tonight)

**0x8a3aB8120807bD64a3De48695110e390fa2ceB9a, TTdes**

| Trader | Unique ROI | WR | Median | 30d n | 30d ROI | Take-rule n | Take +2¢ | Why live |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | 14.95% | 53.86% | $4,838 | 119 | -6.72% | 24 | 7.4% | joinable HOT/WARM, unique ROI≥5%, ≥8 prints/30d |
| TTdes | 7.27% | 53.82% | $920 | 23 | 43.04% | 4 | -54.55% | joinable HOT/WARM, unique ROI≥5%, ≥8 prints/30d |

## Bench / demoted (keep the book, do not fire live)

Supah9ga, WTSA, DLEK, Vetch, 0x5966Db1fE50763C9e3C014d756369BAd07E1F804, HedgeMaster88, ckw, Bienville, JhonAlexanderHinestroza, 0x20D6436849F930584892730C7F96eBB2Ac763856, 0xheavy888, JuniorB, Andromeda1

| Trader | Bucket reason | Unique ROI | Recency | Last event | Take n | Take +2¢ |
|---|---|---:|---|---|---:|---:|
| Supah9ga | quiet_30d_n=1<8, recency_HOT | 21.87% | HOT | 2026-08-15 | 43 | 8.62% |
| WTSA | median=$27,763_unjoinable, unjoinable_keep_book | 20.21% | HOT | 2026-08-17 | 12 | 14.5% |
| DLEK | recency_COLD | 7.67% | COLD | 2026-07-30 | 22 | -23.24% |
| Vetch | recency_COLD | 11.24% | COLD | 2026-08-02 | 123 | 12.2% |
| 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | median=$46,033_unjoinable, stale_DARK | 25.47% | DARK | 2026-07-16 | 32 | 21.07% |
| HedgeMaster88 | stale_DROP | 19.07% | DROP | 2026-05-27 | 35 | -7.71% |
| ckw | stale_DARK | 2.29% | DARK | 2026-07-26 | 0 | —% |
| Bienville | stale_DROP | 2.12% | DROP | 2026-04-30 | 5 | 55.35% |
| JhonAlexanderHinestroza | unique_roi=1.48_lt_5.0, unique_roi=1.48_bench | 1.48% | HOT | 2026-08-18 | 146 | 9.85% |
| 0x20D6436849F930584892730C7F96eBB2Ac763856 | unique_roi=1.85_lt_5.0, unique_roi=1.85_bench | 1.85% | HOT | 2026-08-13 | 129 | 6.3% |
| 0xheavy888 | unique_roi=2.22_lt_5.0, unique_roi=2.22_bench | 2.22% | HOT | 2026-08-19 | 0 | —% |
| JuniorB | unique_roi=4.71_bench | 4.71% | COLD | 2026-07-31 | 0 | —% |
| Andromeda1 | stale_DARK | 3.32% | DARK | 2026-07-19 | 79 | -17.19% |

## Watch (thinking about — never auto-live)

| Trader | Unique ROI | WR | Median | 30d n | CSV | Take n | Take +2¢ | Stance |
|---|---:|---:|---:|---:|---|---:|---:|---|
| 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | 34.66% | 51.39% | $12,788 | 51 | yes | 0 | —% | screen only |
| CoryLahey | 4.61% | 59.4% | $7,365 | 15 | yes | 66 | 1.3% | screen only |
| ShucksIt69 | 4.15% | 53.19% | $5,221 | 122 | yes | 6 | 0.4% | screen only |
| SineNooneEI | 5.37% | 53.97% | $6,839 | 249 | yes | 14 | -17.96% | screen only |
| HongYunX | 9.43% | 60.79% | $3,113 | 54 | yes | 0 | —% | screen only |
| UAEVALORANTFAN | 3.42% | 55.25% | $3,741 | 80 | yes | 19 | -45.05% | screen only |
| bigspending | 30.26% | 67.86% | $7,380 | 27 | yes | 2 | -26.07% | lottery / thin book |
| predictionlegend | 63.53% | 50.0% | $18,320 | 12 | yes | 0 | —% | lottery / thin book |
| 0xE30E74595517de48f1FB19f4553dd3d9F1E96B87 | 12.47% | 55.1% | $39,638 | 28 | yes | 1 | -100.0% | whale/unjoinable |
| theowalcott | 13.96% | 58.46% | $26,833 | 65 | yes | 5 | 18.18% | lottery / thin book |
| HVAB | 10.46% | 81.99% | $896 | 163 | yes | 27 | 9.81% | WR outside 48–75 |
| sainttroplay | 77.2% | 83.33% | $650,807 | 6 | yes | 0 | —% | lottery / thin book |
| S-Works | -2.27% | 67.69% | $1,206 | 106 | yes | 0 | —% | screen only |
| musholius722 | 60.63% | 50.0% | $173,568 | 1 | yes | 0 | —% | lottery / thin book |
| SDTrading | -0.29% | 48.33% | $4,912 | 284 | yes | 0 | —% | screen only |
| TutiFromFactsOfLife | -1.66% | 50.31% | $7,680 | 40 | yes | 0 | —% | screen only |
| bloodmaster | 4.32% | 88.73% | $598 | 305 | yes | 0 | —% | WR outside 48–75 |
| ShortFlutterStock | 1.0% | 57.35% | $1,274 | 82 | yes | 0 | —% | screen only |
| 3edmond.dantes | 25.37% | 50.0% | $278,600 | 4 | yes | 0 | —% | lottery / thin book |
| Sassy-Bucket | -7.58% | 46.91% | $42,941 | 157 | yes | 0 | —% | WR outside 48–75 |
| fengdubiying | 28.15% | 71.43% | $12,835 | 0 | yes | 0 | —% | screen only |
| asparagus2012 | 249.97% | 68.75% | $29,604 | 4 | yes | 0 | —% | lottery / thin book |
| norrisfan | -15.66% | 43.19% | $1,770 | 127 | yes | 0 | —% | WR outside 48–75 |
| TennisLove | 40.56% | 100.0% | $99,223 | 2 | yes | 0 | —% | lottery / thin book |
| KeyTransporter | 45.71% | 76.92% | $301,277 | 0 | yes | 0 | —% | lottery / thin book |
| midwicket72 | None% | 0.0% | $0 | 0 | missing | 0 | —% | lottery / thin book |

## Take-rule backtests (hold to resolution, $100, VWAP+2¢)

| Pool | n | WR | +2¢ ROI | Meaning |
|---|---:|---:|---:|---|
| `matched_12` | 579 | 68.22% | 11.65% | Frozen historical take-book 12 (Capman-heavy). Not who we tail tonight. |
| `matched_12_minus_bots` | 296 | 63.85% | 8.09% | Take-book 12 minus 100k-fill bots. |
| `live_joinable` | 28 | 53.57% | -1.45% | Current live copy list under the product rule. |
| `live_plus_bench` | 654 | 59.48% | 4.69% | Live + demoted/quiet/whale take-book names. |
| `watch_candidates` | 140 | 55.0% | -5.82% | Names we are thinking about. extra_watch never auto-live. |
| `archive_stale` | 323 | 70.9% | 13.5% | Capman / HedgeMaster / Bienville / tcp2 / kch123 — months stale. |

## Recent would-fire TAKE alerts

Alert time = first unique-book fill timestamp (what `/api/take-plays` would have seen on the next 90s refresh). Fill = their VWAP+2¢. Result = hold to resolution. CLV = CLOB last trade ~30 min before event end minus our fill (positive = beat the close).

- Live copy last **7d**: n=0 WR=0.0% +2¢ ROI=0.0% PnL=$0.0
- Live+bench+watch hypothetical last **7d**: n=13 WR=76.92% +2¢ ROI=19.67% PnL=$255.68
- Live copy last **14d**: n=0 WR=0.0% +2¢ ROI=0.0% PnL=$0.0
- Live+bench+watch hypothetical last **14d**: n=22 WR=72.73% +2¢ ROI=5.68% PnL=$124.94
- Live copy last **30d**: n=0 WR=0.0% +2¢ ROI=0.0% PnL=$0.0
- Live+bench+watch hypothetical last **30d**: n=61 WR=65.57% +2¢ ROI=16.18% PnL=$986.73

CLV on the recent hypothetical tape: **15/61** plays had a CLOB close. Avg CLV **-3.9¢**, expected CLV ROI **-7.09%**, realized +2¢ ROI **16.18%**.

### Last live-copy TAKEs (all-time as-of tape, not just 30d)

| Alerted | Trader | Play | Fill | Close | CLV¢ | Result | $100 PnL |
|---|---|---|---:|---:|---:|---|---:|
| 2026-05-16T18:00 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | UFC Fight Night: Khaos Williams vs. Nikolay Vere | 0.495 | — | — | lost | -100.0 |
| 2026-05-09T18:00 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | UFC 328: Sean Strickland vs. Khamzat Chimaev (Mi | 0.844 | — | — | lost | -100.0 |
| 2026-05-02T18:00 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | UFC Fight Night: Tim Elliott vs. Steve Erceg (Fl | 0.39 | — | — | lost | -100.0 |
| 2026-04-25T18:00 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | UFC Fight Night: Alexander Hernandez vs. Rafa Ga | 0.546 | — | — | won | 83.05 |
| 2026-04-11T18:00 | TTdes | Senators vs. Devils | 0.57 | — | — | lost | -100.0 |
| 2026-04-11T18:00 | TTdes | Canucks vs. Sharks | 0.651 | — | — | lost | -100.0 |
| 2026-04-11T18:00 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | Spread: Hornets (-13.5) | 0.559 | — | — | won | 78.86 |
| 2026-04-11T18:00 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | UFC 327: Curtis Blaydes vs. Josh Hokit (Heavywei | 0.552 | — | — | won | 81.0 |
| 2026-04-10T18:00 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | Grizzlies vs. Jazz | 0.603 | — | — | won | 65.98 |
| 2026-04-09T18:00 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | Spread: Heat (-16.5) | 0.536 | — | — | won | 86.6 |
| 2026-04-08T18:00 | TTdes | Oilers vs. Sharks | 0.49 | — | — | lost | -100.0 |
| 2026-04-07T18:00 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | Spread: Warriors (-14.5) | 0.55 | — | — | lost | -100.0 |
| 2026-04-07T18:00 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | Spread: Celtics (-4.5) | 0.555 | — | — | lost | -100.0 |
| 2026-04-07T18:00 | TTdes | Oilers vs. Utah | 0.55 | — | — | won | 81.82 |
| 2026-04-03T18:00 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | Spread: Celtics (-17.5) | 0.55 | — | — | won | 81.79 |

### Last 30d hypothetical TAKEs (bench + watch, would have fired if live)

| Alerted | Pool | Trader | Play | Fill | Close | CLV¢ | Result | $100 PnL |
|---|---|---|---|---:|---:|---:|---|---:|
| 2026-08-17T18:00 | watch | HVAB | National Bank Open: Jakub Mensik vs Ben  | 0.896 | — | — | won | 11.66 |
| 2026-08-17T18:00 | watch | HVAB | ITF W35 Vigo Women: Celia Cervino Ruiz v | 0.625 | — | — | won | 60.13 |
| 2026-08-16T18:00 | watch | HVAB | Todi: Murkel Dellien vs Daniel Galan | 0.452 | — | — | lost | -100.0 |
| 2026-08-15T18:00 | watch | bigspending | Will ADO Den Haag win on 2026-08-16? | 0.378 | 0.345 | -3.34 | lost | -100.0 |
| 2026-08-15T18:00 | watch | bigspending | Will Frosinone Calcio win on 2026-08-16? | 0.676 | 0.555 | -12.13 | won | 47.86 |
| 2026-08-15T18:00 | watch | HVAB | National Bank Open: Alexandra Eala vs Be | 0.74 | — | — | won | 35.19 |
| 2026-08-14T18:00 | watch | HVAB | National Bank Open: Iva Jovic vs Alina K | 0.702 | — | — | won | 42.51 |
| 2026-08-13T18:00 | watch | HVAB | ITF Ourense: Sonja Zhiyenbayeva vs Alici | 0.765 | — | — | won | 30.65 |
| 2026-08-12T18:00 | watch | HVAB | National Bank Open: Anna Kalinskaya vs D | 0.731 | — | — | won | 36.78 |
| 2026-08-12T18:00 | watch | theowalcott | Will CF Monterrey win on 2026-08-12? | 0.493 | 0.495 | 0.19 | won | 102.8 |
| 2026-08-12T18:00 | watch | theowalcott | CR Vasco da Gama vs. Club Olimpia: O/U 2 | 0.428 | — | — | lost | -100.0 |
| 2026-08-11T18:00 | watch | theowalcott | Will Club Bolívar win on 2026-08-11? | 0.512 | 0.465 | -4.72 | won | 95.24 |
| 2026-08-11T18:00 | watch | theowalcott | Will CA Tigre win on 2026-08-12? | 0.518 | 0.47 | -4.85 | won | 92.86 |
| 2026-08-10T18:00 | watch | HVAB | National Bank Open: Anna Kalinskaya vs M | 0.557 | — | — | lost | -100.0 |
| 2026-08-10T18:00 | watch | HVAB | ITF Londrina: Jose Pereira vs Mateus Alv | 0.699 | — | — | won | 43.04 |
| 2026-08-09T18:00 | watch | HVAB | National Bank Open: Diane Parry vs Kayla | 0.745 | — | — | lost | -100.0 |
| 2026-08-09T18:00 | watch | HVAB | Hagen: Alex Molcan vs Chun-Hsin Tseng | 0.791 | — | — | won | 26.47 |
| 2026-08-09T18:00 | watch | HVAB | ITF W100 Landisville, PA Women: Ava Cata | 0.778 | — | — | won | 28.45 |
| 2026-08-09T18:00 | watch | theowalcott | Will CD Santa Clara win on 2026-08-10? | 0.54 | 0.515 | -2.54 | lost | -100.0 |
| 2026-08-07T18:00 | watch | HVAB | Targu Mures: Kaitlin Quevedo vs Francesc | 0.736 | — | — | won | 35.81 |
| 2026-08-07T18:00 | watch | HVAB | Canadian Open, Qualification: Alexei Pop | 0.818 | — | — | won | 22.25 |
| 2026-08-06T18:00 | watch | HVAB | Targu Mures: Sara Sorribes Tormo vs Luci | 0.883 | — | — | won | 13.24 |
| 2026-08-02T18:00 | watch | HVAB | Targu Mures: Caijsa Hennemann vs Mia Poh | 0.237 | — | — | won | 321.76 |
| 2026-08-01T18:00 | bench | Vetch | Hamburg European Open: Anna Bondar vs Ta | 0.542 | — | — | lost | -100.0 |
| 2026-08-01T18:00 | bench | Vetch | Estoril Open: Luca Van Assche vs Alexand | 0.59 | — | — | lost | -100.0 |

Full tape: `pnl_analysis/output/recent_take_alerts.json`.

## Grab locally

```bat
git fetch origin
git checkout cursor/hot-copy-polydata-51c7
git pull origin cursor/hot-copy-polydata-51c7
```

Then copy these (small, committed):

- `pnl_analysis/WORKING_COPY_MODEL.md` (this file)
- `pnl_analysis/output/working_copy_model.json`
- `pnl_analysis/output/recent_take_alerts.json`
- `pnl_analysis/extra_traders.json`
- `pnl_analysis/output/copy_universe.json`

Rebuild after a unique-book ingest:

```bat
python pnl_analysis/rebuild_working_model.py
```

Do not recrawl 89 wallets to refresh this model. Incremental ingest of live+bench+watch is enough.

## Fluid rules (do not retune Q/rel from a cold week)

- Pause live copy if last 30d take-slice n≥25 and +2¢ ROI < 0, or last 60d n≥40 and ROI < −5%.
- extra_traders `watch` never auto-promotes. Human status change required.
- Unique ROI < 5%, quiet 30d n<8, median ≥$15k, WR outside 48–75, or 100k+ fills → not $100 live.
- RN1 / HOG993 / mentionmarket / MM bots stay skipped.
- Empty Take these is honest when nothing passes Q/rel/price tonight.
