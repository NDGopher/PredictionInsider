# Honest walk-forward consensus backtest (through 2026-08-18)

Run: `npm run backtest:consensus`  
Health: `npm run backtest:health`  
Frontend: **Strategies** (`/strategies`) reads `pnl_analysis/output/tail_strategies.json` and live `/api/signals`.

## Why last 20 used to freeze in April

Three stacked bugs, not “the market died”:

1. **Closed-only books are win-biased.** Losers stay on `/positions` with `status=open` and `curPrice` 0 or 1 until the wallet redeems. Winners get redeemed and show up as closed.
2. Incremental ingest only pulled **20 open pages** (~1,000 rows). Cannae/RN1/CemeterySun have thousands of unredeemed settled rows, so May–August never merged.
3. Many of those rows have **null `endDate`**. We now parse `20XX-MM-DD` from slug/title and drop still-future markets.

Copy-all hold-to-res **including settled-open**, dates through today:

| Book | n | WR | Implied | ROI |
|------|--:|---:|--------:|----:|
| Previous closed-only copy-all | 267,698 | 58.2% | 53.0% | **+3.7%** |
| **Now (through 2026-08-19 horizon)** | 327,025 | 54.1% | 51.9% | **−2.9%** |

That is the honest baseline. Consensus does **not** print 20–50% after this fix.

## Cannae — still include?

**Overlay only. Do not use as a 2+ voter.**

Honest hold-to-res (settled-open included, dated through **2026-08-16**):

| Window | n | WR | ROI |
|--------|--:|---:|----:|
| Full (Jan 7 → Aug 16) | 14,602 | 53.8% | **+27.1%** |
| Last 90d | 385 | 87.3% | **+56.0%** |
| Last 30d | 34 | 76.5% | **+50.3%** |
| May–Aug dated | 571 | 87.9% | **+63.8%** |

He did **not** go −50% on hold-to-resolution. What changed:

- **Volume collapsed** after April (~60 markets/day Jan–Apr vs a thin May–Aug book).
- Live UI is full of **unredeemed losers** that never hit `closed-positions`.
- Leave-one-out still shows he **inflates 2+ soccer-NO clusters**. Core 2+ with him looks great and is not a stable edge.

Live filters: soccer only, mute UCL / NBA / NFL / NHL / spreads / totals / draws / **YES**.

## Roster re-grade (hold-to-res)

See `TRADER_HEALTH_REPORT.md` and the Strategies → Roster tab.

**Kicked from live `/api/signals`:**

| Trader | Why |
|--------|-----|
| **LynxTitan** | Last 90d **−92%** (n=222) |
| **geniusMC** | Last 90d **−21%** (n=35) |
| **0x53eCc53E7** | Last 90d **−49.5%** (n=186) |

**Keep (examples):** RN1, BoomLaLa, TheArena, S-Works, 0xheavy888, WTSA, Qpkwks, 0p0jogggg, CemeterySun (CSV still maxes 2026-04-30 — needs full-open refresh).

**Tighten:** CoryLahey (spreads already muted), TutiFromFactsOfLife (−2% full / −7.6% 90d), 0x2c3350 (high-volume slightly negative — he is 13% of the favorites book, size down).

**Watch:** kch123 last 90d −39% on only 33 plays (volume died); JPMorgan101 last 90d −27.5%; 0xCb6Ed933 n=28 last play March.

**New candidates (sports LB rank 2–4):** HomeRunHazard fetched: **~1% ROI on $124M** (96.9% WR moneylines) — favorite/bond grinder, **do not tail**. ferrariChampions2026 / wr0ngw4yb3tt0r still fetching; closed-sample ~97% ROI is the win-bias artifact.

## Strategy ROI @ join_max + 2¢ (what you actually pay)

$100/play. Last resolved play in the universe: **2026-08-17/19**.

| Strategy | n | WR | Implied | ROI | Trades/day | Last play |
|----------|--:|---:|--------:|----:|-----------:|-----------|
| **Favorites 60–80¢ (recommended)** | 399 | 77.4% | 74.7% | **+4.0%** | **2.08** | 2026-08-16 |
| Core 2+ no Cannae, no NFL, 10–88¢ | 1,220 | 56.5% | 60.2% | **−8.6%** | **4.15** | 2026-08-17 |
| Grade 70+ same filters | 638 | 59.1% | 61.2% | −4.9% | 2.79 | 2026-08-17 |
| Moneyline only | 1,050 | 55.3% | 59.0% | −8.2% | 3.89 | 2026-08-17 |
| 2+ live including Cannae | 1,440 | 56.5% | 59.8% | −7.9% | 4.74 | 2026-08-17 |
| Soccer 2+ no Cannae | 859 | 57.2% | — | −6.0% | 3.78 | 2026-08-17 |

Favorites 60–80¢ years @ join+2¢: 2025 **−1.3%** (n=129), 2026 **+6.5%** (n=269). Not a 2025-stable machine — size modestly.

VWAP (their price, you cannot actually get this until the later wallet is in): favorites **+12.2%**. Join+5¢ is ~flat.

### Sport × submarket (favorites 60–80¢)

| Sport | Submarket | n | WR | ROI | /day | Last |
|-------|-----------|--:|---:|----:|-----:|------|
| Soccer | Moneyline | 262 | 74.4% | +1.4% | 1.93 | 2026-08-16 |
| Other | Moneyline | 52 | 78.8% | +6.4% | 1.30 | 2026-08-12 |
| Soccer | Draw | 32 | 84.4% | +10.2% | 1.10 | 2026-07-15 |
| Other | Draw | 21 | 76.2% | +0.7% | 1.17 | 2026-07-07 |

Longshots 0–20¢: **−67%**. NFL moneyline consensus inside the wide book: still terrible. Spreads/totals almost never make 2+ after `doNotTail` (n=0 in those product filters).

## What to trade

1. **Default:** 2+ wallets, **60–80¢**, join_max+2¢, skip NFL. ~**2 plays/day**, ~**+4% ROI** after slippage.
2. Do **not** run “core 10–88¢ no Cannae” expecting the old +8–19% — that was closed-only + Cannae mirage.
3. Cannae soccer overlay is optional and concentrated; never let him create a 2+ by himself pairing with RN1/CemeterySun.
4. Live plays: Strategies page, polls `/api/signals` every 30s, labeled **title · side · sport · submarket**.

## Method

- Win iff `curPrice ≥ 0.99`, including `status=open`.
- Event date from `endDate` or slug/title `YYYY-MM-DD`; drop dates after tomorrow.
- Play = `conditionId` + side. Walk-forward Q uses only markets dated ≥1 day earlier.
- 20 warmup, ≥$200, category filters, $100 flat.
