# Working copy model

Generated **2026-08-24T18:22:27 UTC**. Pull this file plus `pnl_analysis/output/working_copy_model.json` and `pnl_analysis/output/recent_take_alerts.json` — they are committed, not CSVs.

**Single roster contract**: Live tail list = `pnl_analysis/output/verified_elite_roster.json` → `elite[]`. See `LIVE_ROSTER.md` for full contract.

Product rule: **`asof_live_q60_sport_rel2`** — Q≥60, sport-lane ROI≥+5%, rel≥2× median, 10–88¢, no NFL, fill VWAP+2¢, hold to resolution. Unique-book ROI/PnL is truth. Polydata month curves are discovery only.

## Live copy (verified_elite_roster elite = Telegram/Sniper tail)

Current elite roster from walk-forward: **HVAB** (tennis specialist, Path-B WR 82%, unique ROI 15%)

Path-B specialist exception: WR 75–85 allowed for walk-forward Elite with curve-book unique≥10% + sports specialty + joinable median.

| Trader | Unique ROI | WR | Median | 30d n | Specialty | Why elite |
|---|---:|---:|---:|---:|---|---|
| HVAB | 15.01% | 82.0% | $1,874 | 230 | TENNIS | elite curve-book unique=15.0% spec=TENNIS@14.9% (Path-B specialist) |

**Not live (legacy claims)**: 0x8a3a, TTdes, etc. are no longer in the elite roster. Run `walkforward_elite_discovery.py` to regenerate.

## Bench / demoted (keep the book, do not fire live)

Supah9ga, WTSA, DLEK, Vetch, 0x5966Db1fE50763C9e3C014d756369BAd07E1F804, HedgeMaster88, ckw, Bienville, JhonAlexanderHinestroza, 0xheavy888, TTdes, JuniorB, Andromeda1

| Trader | Bucket reason | Unique ROI | Recency | Last event | Take n | Take +2¢ |
|---|---|---:|---|---|---:|---:|
| Supah9ga | quiet_30d_n=1<8, recency_HOT | 21.53% | HOT | 2026-08-15 | 21 | 16.57% |
| WTSA | median=$27,763_unjoinable, unjoinable_keep_book | 20.21% | HOT | 2026-08-17 | 0 | —% |
| DLEK | recency_COLD | 7.28% | COLD | 2026-07-30 | 22 | -23.24% |
| Vetch | recency_COLD | 11.24% | COLD | 2026-08-02 | 84 | 12.6% |
| 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | median=$46,033_unjoinable, stale_DARK | 25.47% | DARK | 2026-07-16 | 0 | —% |
| HedgeMaster88 | stale_DROP | 19.07% | DROP | 2026-05-27 | 35 | -7.71% |
| ckw | stale_DARK | 2.29% | DARK | 2026-07-26 | 0 | —% |
| Bienville | stale_DROP | 2.12% | DROP | 2026-04-30 | 0 | —% |
| JhonAlexanderHinestroza | unique_roi=1.48_lt_5.0, unique_roi=1.48_bench | 1.48% | HOT | 2026-08-18 | 108 | 19.49% |
| 0xheavy888 | unique_roi=2.22_lt_5.0, unique_roi=2.22_bench | 2.22% | HOT | 2026-08-19 | 0 | —% |
| TTdes | take_rule_bleed, recency_HOT | 7.06% | HOT | 2026-08-19 | 15 | -42.67% |
| JuniorB | unique_roi=4.71_bench | 4.71% | COLD | 2026-07-31 | 0 | —% |
| Andromeda1 | stale_DARK | 3.32% | DARK | 2026-07-19 | 79 | -17.19% |

## Watch (thinking about — never auto-live)

| Trader | Unique ROI | WR | Median | 30d n | CSV | Take n | Take +2¢ | Stance |
|---|---:|---:|---:|---:|---|---:|---:|---|
| CoryLahey | 4.61% | 59.4% | $7,365 | 10 | missing | 0 | —% | lottery / thin book |
| ShucksIt69 | 4.62% | 53.22% | $5,211 | 71 | yes | 6 | 0.4% | screen only |
| SineNooneEI | 5.01% | 53.75% | $6,832 | 196 | missing | 0 | —% | lottery / thin book |
| HongYunX | 10.31% | 60.91% | $3,132 | 38 | yes | 0 | —% | screen only |
| UAEVALORANTFAN | 3.18% | 55.29% | $3,725 | 60 | yes | 19 | -45.05% | screen only |
| predictionlegend | 63.53% | 50.0% | $18,320 | 12 | missing | 0 | —% | lottery / thin book |
| bigspending | 24.89% | 64.52% | $7,426 | 30 | missing | 0 | —% | lottery / thin book |
| 0xE30E74595517de48f1FB19f4553dd3d9F1E96B87 | 12.47% | 55.1% | $39,638 | 25 | missing | 0 | —% | lottery / thin book |
| HVAB | 10.31% | 81.84% | $896 | 175 | missing | 0 | —% | lottery / thin book |
| sainttroplay | 77.2% | 83.33% | $650,807 | 6 | missing | 0 | —% | lottery / thin book |
| S-Works | -2.27% | 67.69% | $1,206 | 106 | yes | 0 | —% | screen only |
| musholius722 | 60.63% | 50.0% | $173,568 | 1 | missing | 0 | —% | lottery / thin book |
| SDTrading | -0.15% | 48.62% | $4,539 | 222 | yes | 0 | —% | screen only |
| bloodmaster | 4.32% | 88.73% | $598 | 305 | yes | 0 | —% | WR outside 48–75 |
| ShortFlutterStock | 1.0% | 57.35% | $1,274 | 82 | yes | 0 | —% | screen only |
| theowalcott | -0.71% | 56.47% | $24,555 | 71 | missing | 0 | —% | lottery / thin book |
| Sassy-Bucket | -7.83% | 46.5% | $42,250 | 124 | missing | 0 | —% | lottery / thin book |
| norrisfan | -15.66% | 43.19% | $1,770 | 127 | yes | 0 | —% | WR outside 48–75 |
| TennisLove | 40.56% | 100.0% | $99,223 | 2 | missing | 0 | —% | lottery / thin book |
| midwicket72 | None% | 0.0% | $0 | 0 | missing | 0 | —% | lottery / thin book |

## Take-rule backtests (hold to resolution, $100, VWAP+2¢)

| Pool | n | WR | +2¢ ROI | Meaning |
|---|---:|---:|---:|---|
| `matched_12` | 469 | 69.72% | 11.0% | Frozen historical take-book 12 (Capman-heavy). Not who we tail tonight. |
| `matched_12_minus_bots` | 186 | 65.05% | 4.32% | Take-book 12 minus 100k-fill bots. |
| `live_joinable` | 35 | 62.86% | 21.83% | Current live copy list under the product rule. |
| `live_plus_bench` | 399 | 59.9% | 3.75% | Live + demoted/quiet/whale take-book names. |
| `watch_candidates` | 25 | 36.0% | -34.14% | Names we are thinking about. extra_watch never auto-live. |
| `archive_stale` | 318 | 70.75% | 12.84% | Capman / HedgeMaster / Bienville / tcp2 / kch123 — months stale. |

## Recent would-fire TAKE alerts

Alert time = first unique-book fill timestamp (what `/api/take-plays` would have seen on the next 90s refresh). Fill = their VWAP+2¢. Result = hold to resolution. CLV = CLOB last trade ~30 min before event end minus our fill (positive = beat the close).

- Live copy last **7d**: n=0 WR=0.0% +2¢ ROI=0.0% PnL=$0.0
- Live+bench+watch hypothetical last **7d**: n=0 WR=0.0% +2¢ ROI=0.0% PnL=$0.0
- Live copy last **14d**: n=3 WR=100.0% +2¢ ROI=90.75% PnL=$272.26
- Live+bench+watch hypothetical last **14d**: n=3 WR=100.0% +2¢ ROI=90.75% PnL=$272.26
- Live copy last **30d**: n=11 WR=72.73% +2¢ ROI=53.31% PnL=$586.38
- Live+bench+watch hypothetical last **30d**: n=11 WR=72.73% +2¢ ROI=53.31% PnL=$586.38

CLV on the recent hypothetical tape: **0/11** plays had a CLOB close. Avg CLV **None¢**, expected CLV ROI **None%**, realized +2¢ ROI **53.31%**.

### Last live-copy TAKEs (all-time as-of tape, not just 30d)

| Alerted | Trader | Play | Fill | Close | CLV¢ | Result | $100 PnL |
|---|---|---|---:|---:|---:|---|---:|
| 2026-08-16T18:00 | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | Houston Astros vs. San Diego Padres | 0.54 | — | — | won | 85.19 |
| 2026-08-10T18:00 | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | Toronto Blue Jays vs. Houston Astros | 0.46 | — | — | won | 117.58 |
| 2026-08-10T18:00 | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | Pittsburgh Pirates vs. Milwaukee Brewers | 0.59 | — | — | won | 69.49 |
| 2026-08-09T18:00 | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | St. Louis Cardinals vs. New York Yankees | 0.34 | — | — | won | 194.12 |
| 2026-08-07T18:00 | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | St. Louis Cardinals vs. Toronto Blue Jays | 0.417 | — | — | lost | -100.0 |
| 2026-08-05T18:00 | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | Seattle Mariners vs. Los Angeles Dodgers | 0.4 | — | — | lost | -100.0 |
| 2026-08-04T18:00 | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | Milwaukee Brewers vs. San Francisco Giants | 0.522 | — | — | lost | -100.0 |
| 2026-08-03T18:00 | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | New York Yankees vs. Chicago White Sox | 0.54 | — | — | won | 85.19 |
| 2026-08-01T18:00 | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | Boston Red Sox vs. Los Angeles Dodgers: O/U 8.5 | 0.513 | — | — | won | 94.78 |
| 2026-08-01T18:00 | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | Minnesota Twins vs. Seattle Mariners: O/U 7.5 | 0.44 | — | — | won | 127.27 |
| 2026-07-31T18:00 | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | New York Yankees vs. Chicago Cubs: O/U 6.5 | 0.47 | — | — | won | 112.77 |
| 2026-05-16T18:00 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | UFC Fight Night: Khaos Williams vs. Nikolay Vere | 0.495 | — | — | lost | -100.0 |
| 2026-05-09T18:00 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | UFC 328: Sean Strickland vs. Khamzat Chimaev (Mi | 0.844 | — | — | lost | -100.0 |
| 2026-05-02T18:00 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | UFC Fight Night: Tim Elliott vs. Steve Erceg (Fl | 0.39 | — | — | lost | -100.0 |
| 2026-04-25T18:00 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | UFC Fight Night: Alexander Hernandez vs. Rafa Ga | 0.546 | — | — | won | 83.05 |

### Last 30d hypothetical TAKEs (bench + watch, would have fired if live)

| Alerted | Pool | Trader | Play | Fill | Close | CLV¢ | Result | $100 PnL |
|---|---|---|---|---:|---:|---:|---|---:|
| 2026-08-16T18:00 | live | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | Houston Astros vs. San Diego Padres | 0.54 | — | — | won | 85.19 |
| 2026-08-10T18:00 | live | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | Pittsburgh Pirates vs. Milwaukee Brewers | 0.59 | — | — | won | 69.49 |
| 2026-08-10T18:00 | live | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | Toronto Blue Jays vs. Houston Astros | 0.46 | — | — | won | 117.58 |
| 2026-08-09T18:00 | live | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | St. Louis Cardinals vs. New York Yankees | 0.34 | — | — | won | 194.12 |
| 2026-08-07T18:00 | live | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | St. Louis Cardinals vs. Toronto Blue Jay | 0.417 | — | — | lost | -100.0 |
| 2026-08-05T18:00 | live | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | Seattle Mariners vs. Los Angeles Dodgers | 0.4 | — | — | lost | -100.0 |
| 2026-08-04T18:00 | live | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | Milwaukee Brewers vs. San Francisco Gian | 0.522 | — | — | lost | -100.0 |
| 2026-08-03T18:00 | live | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | New York Yankees vs. Chicago White Sox | 0.54 | — | — | won | 85.19 |
| 2026-08-01T18:00 | live | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | Minnesota Twins vs. Seattle Mariners: O/ | 0.44 | — | — | won | 127.27 |
| 2026-08-01T18:00 | live | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | Boston Red Sox vs. Los Angeles Dodgers:  | 0.513 | — | — | won | 94.78 |
| 2026-07-31T18:00 | live | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | New York Yankees vs. Chicago Cubs: O/U 6 | 0.47 | — | — | won | 112.77 |

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
- extra_traders `watch` never auto-promotes — **exception**: verified_elite_roster elite names override watch gate.
- Unique ROI < 5%, quiet 30d n<8, median ≥$15k, or 100k+ fills → not $100 live.
- **WR gates**: 48–75 standard, 75–85 Path-B specialist (walk-forward Elite + unique≥10%).
- RN1 / HOG993 / mentionmarket / Vigilant-Environment / sentrio / Mysaria bots stay skipped.
- Empty Take these is honest when nothing passes Q/rel/price tonight **and** HVAB is in the live tail set.
