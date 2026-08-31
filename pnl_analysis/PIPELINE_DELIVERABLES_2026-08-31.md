# Pipeline Deliverables — 2026-08-31

Generated after full `refresh_product.py` run at 14:41 UTC.

## How this compares to Unusual Whales / OddsJam

| Capability | Unusual Whales / Hashdive | OddsJam-style | PredictionInsider (this build) |
|------------|---------------------------|---------------|--------------------------------|
| Find hot wallets | Market-first Z-score on holders | Curated roster + heat | **Both**: `scan_unusual_flow.py` (UW) + Polydata watch queue + graded copy book |
| Find consistent winners | Smart tags, limited backtest | Shrinkage ranks | **As-of Q score** from full CSV books; ROI only from DB/backtest, never live API PnL |
| Daily top 1–2 plays | Alerts only | Sniper picks | **Sniper TAKE** (`asof_live_q60_sport_rel2`) — empty days are intentional when gates fail |
| Big graded board | Flow alerts | Full odds board | **`ranked_play_board.json`** — 34 plays graded 0–100 with explicit `why[]` and gate misses |
| Relative sizing | Holder % of market | Stake vs normal | **`rel = total open cost / as-of median stake`**, aggregated per market+side (see sizing section) |
| Backtest honesty | Opaque | Marketing curves | **452-play hold-to-resolution backtest** with leave-one-out + quarterly splits |

## Product tiers (your 1–2/day flag)

- **Sniper TAKE** — rule `asof_live_q60_sport_rel2`: Q≥60, sport-lane ROI≥+5%, rel≥2× median, 10–88¢ entry, no NFL, fill VWAP+2¢, hold to resolution. **0–2/day when all gates clear.**
- **Explorer** — rule `asof_q60_sub_rel2`: wider labeled lane (politics/submarkets OK); shown in UI but **not** auto-Telegram TAKE.
- **Graded board** — all opens from live+bench+watch books, tiers: `take` / `near` / `watch`.

## Traders added / removed (this run)

**Auto-promote tick:** promoted=0, demoted=0 — roster stable, no bucket changes.

### Polydata discovery → watch (+12 new)
- **BillyGating** — Polydata PnL/vol screen → watch queue (CSV fetch pending)
- **ethanaz** — Polydata PnL/vol screen → watch queue (CSV fetch pending)
- **tes21sa** — Polydata PnL/vol screen → watch queue (CSV fetch pending)
- **kilian7kilian** — Polydata PnL/vol screen → watch queue (CSV fetch pending)
- **jjj1995** — Polydata PnL/vol screen → watch queue (CSV fetch pending)
- **Shori888** — Polydata PnL/vol screen → watch queue (CSV fetch pending)
- **RJW1** — Polydata PnL/vol screen → watch queue (CSV fetch pending)
- **beachboy4** — Polydata PnL/vol screen → watch queue (CSV fetch pending)
- **xifutloong3** — Polydata PnL/vol screen → watch queue (CSV fetch pending)
- **alexdave888** — Polydata PnL/vol screen → watch queue (CSV fetch pending)
- **11vsldfdsgfkjgos** — Polydata PnL/vol screen → watch queue (CSV fetch pending)
- **0xd3A0b4E941B557D33A8EFd5a51c581e7c79cF136** — Polydata PnL/vol screen → watch queue (CSV fetch pending)

### Why watch wallets did NOT promote to live
- **ShucksIt69** (bleeding): gates_fail life=4.62 regime=bleeding l30=-8.89 — unique ROI 4.62%, take-rule n=6
- **SineNooneEI** (stable): take_bleed_n=14_roi=-17.96 — unique ROI 4.32%, take-rule n=14
- **UAEVALORANTFAN** (turnaround): take_bleed_n=19_roi=-45.05 — unique ROI 3.18%, take-rule n=19
- **0xE30E74595517de48f1FB19f4553dd3d9F1E96B87** (hot): not_joinable — unique ROI 14.47%, take-rule n=1
- **3edmond.dantes** (stable): not_joinable — unique ROI 39.5%, take-rule n=0
- **HVAB** (hot): not_joinable — unique ROI 11.09%, take-rule n=56
- **S-Works** (bleeding): gates_fail life=-2.27 regime=bleeding l30=-1.47 — unique ROI -2.27%, take-rule n=0
- **bloodmaster** (stable): not_joinable — unique ROI 4.32%, take-rule n=0

**Current copy book:** live=0, bench=17, watch=43 (no one in live bucket this run — prior live names like `0x8a3a…` and `HongYunX` demoted to bench for recency/quiet gates; bench still tails for graded opens)

## Top plays today (2026-08-31)

Board scanned **24** CSV books. Counts: TAKE=0, NEAR=22, WATCH=12.
Lanes: sports=3, politics/other=30, futures=1.

### Sniper TAKE matches
**0 TAKE plays today.** No open position from live/bench/watch books passes all Sniper gates simultaneously. This is expected — the product prefers silence over forced picks.

Closest **live-book NEAR** (from `take_health.json`):
- **DLEK** — Will the Democratic Party control the House after the 2026 M · Yes
  Q=30, rel=8.55×, cost=$48,916, misses: Q 30 < 60, sport POLITICS ROI 5% (need +5% as-of)
- **DLEK** — Poilievre out as leader of Conservatives by December 31, 202 · Yes
  Q=30, rel=0.02×, cost=$140, misses: Q 30 < 60, rel 0.0× < 2×

### Top 10 by grade (full board — OddsJam-style list)
1. **[NEAR]** grade=43 · ShortFlutterStock · lane=futures
   Will a team from LPL (China) win LoL Worlds 2026?
   Q=55 rel=0.39× entry=0.203 cost=$1,128
   Why: Near miss — 2 gate(s) away from product TAKE | Trader quality Q 55/100 | Stake 0.4× their own median | As-of sport-lane ROI 15%

2. **[NEAR]** grade=41 · TTdes · lane=other
   Trump out as President before 2027?
   Q=49 rel=19.77× entry=0.84 cost=$20,160
   Why: Near miss — 2 gate(s) away from product TAKE | Trader quality Q 49/100 | Stake 19.8× their own median | As-of sport-lane ROI -27%

3. **[NEAR]** grade=41 · TTdes · lane=other
   Will the Republican Party control the Senate after the 2026 Midterm el
   Q=49 rel=12.94× entry=0.71 cost=$13,202
   Why: Near miss — 2 gate(s) away from product TAKE | Trader quality Q 49/100 | Stake 12.9× their own median | As-of sport-lane ROI -5%

4. **[NEAR]** grade=41 · TTdes · lane=other
   Will the Democratic Party control the Senate after the 2026 Midterm el
   Q=49 rel=6.67× entry=0.71 cost=$6,805
   Why: Near miss — 2 gate(s) away from product TAKE | Trader quality Q 49/100 | Stake 6.7× their own median | As-of sport-lane ROI -5%

5. **[NEAR]** grade=41 · TTdes · lane=other
   Will the Democratic Party control the House after the 2026 Midterm ele
   Q=49 rel=4.75× entry=0.7 cost=$4,841
   Why: Near miss — 2 gate(s) away from product TAKE | Trader quality Q 49/100 | Stake 4.8× their own median | As-of sport-lane ROI -5%

6. **[NEAR]** grade=38 · 0xheavy888 · lane=other
   Will the Democratic Party control the House after the 2026 Midterm ele
   Q=46 rel=30.0× entry=0.5 cost=$152,500
   Why: Near miss — 2 gate(s) away from product TAKE | Trader quality Q 46/100 | Stake 30.0× their own median | As-of sport-lane ROI 2%

7. **[NEAR]** grade=38 · 0xheavy888 · lane=other
   Will the Democratic Party control the House after the 2026 Midterm ele
   Q=46 rel=30.0× entry=0.52 cost=$166,603
   Why: Near miss — 2 gate(s) away from product TAKE | Trader quality Q 46/100 | Stake 30.0× their own median | As-of sport-lane ROI 2%

8. **[NEAR]** grade=38 · 0xheavy888 · lane=other
   Will the Democratic Party control the Senate after the 2026 Midterm el
   Q=46 rel=28.15× entry=0.496 cost=$40,664
   Why: Near miss — 2 gate(s) away from product TAKE | Trader quality Q 46/100 | Stake 28.1× their own median | As-of sport-lane ROI 2%

9. **[NEAR]** grade=38 · 0xheavy888 · lane=other
   Will the Democratic Party control the Senate after the 2026 Midterm el
   Q=46 rel=27.69× entry=0.5 cost=$40,000
   Why: Near miss — 2 gate(s) away from product TAKE | Trader quality Q 46/100 | Stake 27.7× their own median | As-of sport-lane ROI 2%

10. **[NEAR]** grade=38 · 0xheavy888 · lane=other
   Will Trump acquire Greenland before 2027?
   Q=46 rel=11.21× entry=0.81 cost=$16,198
   Why: Near miss — 2 gate(s) away from product TAKE | Trader quality Q 46/100 | Stake 11.2× their own median | As-of sport-lane ROI -1%

### Sports lane only (live/upcoming — what you'd tail for game day)
- #30 norrisfan: Will Michael Carrick be appointed as manager of Manches — grade 2, misses: Q 14 < 60, rel 1.1× < 2×
- #33 norrisfan: Will Michael Carrick be appointed as manager of Manches — grade 2, misses: Q 14 < 60, rel 0.2× < 2×
- #34 norrisfan: Will Oliver Glasner be appointed as manager of Manchest — grade 2, misses: Q 14 < 60, rel 0.0× < 2×

## Why the top trades rank where they do

Grade formula (from `scan_ranked_opens.py`):
- Base = trader **Q score** (0–100, as-of expanding book with 1-day knowledge lag)
- **0 misses** (full TAKE): +3 if Q≥70, +2 if rel≥3, +2 if rel≥5, +4 if rel≥2
- **1 miss**: −5; **2 misses**: −12; **3+ misses**: −25
- Tier: `take`=0 misses, `near`=1–2 misses, `watch`=3+ misses

Today's #1 (grade 43) is **ShortFlutterStock / LoL Worlds** — high Q-adjacent sport ROI (+15%) but fails Q<60 and rel<2×, plus it's classified **futures** lane (long-dated esports), not sports live/upcoming.
Politics-heavy **TTdes** positions rank #2–5 on **rel size** (6–20× median) but fail Q<60 and negative politics ROI — high conviction sizing from a bench trader, not a Sniper TAKE.

## Relative trade sizing — how we know it's correct

For each **open position**, we:
1. **Aggregate all CSV rows** sharing the same `conditionId + side` (handles 20+ micro-fills as one position)
2. Sum `cost = totalBought × avgPrice` (fallback `initialValue`) across those rows
3. Compute **entry** as cost-weighted average price across fills
4. Look up trader's **as-of median stake** from closed-book history (only markets resolved ≥1 day before now; dust <$200 ignored when ≥10 big bets exist)
5. **`rel = total aggregated cost / median stake`**

Example from today's board: **DLEK** House control play — cost **$48,916 aggregated** across fills, median ~$5,720 → **rel=8.55×** (large for them, but Q=30 blocks TAKE).

Limits to know:
- Median is from **closed** positions only; a trader scaling up structurally will show high rel until history catches up
- Positions split across **both sides** of same market are tracked separately (not netted)
- Watch-list wallets without CSV yet cannot be sized (28 missing CSVs flagged in verify step)

## Finding long-term winners vs super-hot wallets

| Signal | Where | What it means |
|--------|-------|---------------|
| **Q score + sport ROI** | Insider ranks / as-of snapshot | Long-term consistent edge in a lane |
| **recency=HOT + last_30d_roi** | copy_universe.json | Recent form surge (may promote after gates) |
| **Z-score unusual flow** | unusual_flow.json | UW-style 'someone just showed up big in this market' |
| **hot_copy_screen.json** | digest | Named whales with joinability + take-rule history |
| **consensus (2+ wallets same side)** | signals merge | Multiple trusted books aligned (when enabled) |

**Unusual flow today:** 0 insider alerts across 30 markets scanned.

## Backtesting — Sniper TAKE strategy

### Full-book hold-to-resolution (`asof_fullbook_backtest.json`)
- **n=452** plays, **WR=69.91%**, **ROI+2¢=10.41%**, PF=1.47
- **7 traders** in universe; robustness OK: n≥200, +ROI after 2¢, leave-one-out and quarters hold
- Leave-one-out: drop Capman → still +4.93% ROI on 192 plays (concentration risk noted: Capman = 57.5% of PnL)
- Quarters: 2026Q1 best (+15.62% ROI, n=305); 2026Q2 thin (n=10, −9.56%)

### Adaptive lab ($100/play unit simulation)
- n=974, WR=60.16%, unit ROI=1.61%, PF=1.04, max DD=$-2,971
- avg rel=6.05×, avg Q=72.7, ~5.1 signals/day historically (live TAKE caps at 1–2)

### Take-health status
- **status=go** — strategy not paused
- All-time take slice: n=452, WR=69.91%, ROI+2¢=10.41%
- Last 30d: n=0 (no recent resolved take plays in window — normal in quiet periods)

## Artifact paths

- `pnl_analysis/output/ranked_play_board.json` (45 KB)
- `pnl_analysis/output/take_health.json` (6 KB)
- `pnl_analysis/output/auto_promote_log.json` (12 KB)
- `pnl_analysis/output/copy_universe.json` (138 KB)
- `pnl_analysis/output/asof_fullbook_backtest.json` (24 KB)
- `pnl_analysis/output/asof_fullbook_plays.csv` (9799 KB)
- `pnl_analysis/output/unusual_flow.json` (83 KB)
- `pnl_analysis/output/hot_copy_screen.json` (29 KB)
- `pnl_analysis/output/adaptive_copy_lab.json` (220 KB)
- `pnl_analysis/output/polydata_boards.json` (313 KB)