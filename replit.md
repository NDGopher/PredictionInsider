# PredictionInsider

A sports prediction market intelligence dashboard that surfaces consensus signals from active Polymarket traders.

## Architecture

**Frontend**: React + TypeScript + Wouter routing + TanStack Query + Shadcn UI
**Backend**: Express.js server that proxies Polymarket public APIs and computes signals
**Data**: All live from Polymarket public APIs (no database needed — read-only data)

## Pages

- `/` — Dashboard: Signal overview, top stats, trader mini-list, how it works. Signals are clickable rows that expand inline to show live price vs entry, actionability, traders, and Polymarket link. 90s auto-refresh.
- `/signals` — Signals: Two modes — Elite (large bets + positions) and Live Feed (consensus from recent trades). Shows ACTIONABLE/PRICE MOVED/BIG PLAY badges. Elite refreshes 120s, Fast 45s.
- `/traders` — Top Traders: Unified pool of 300+ traders — Sports LB + Curated elites + Discovered (from 20K trade scan) + General LB active in sports. Source filter pills (All/Sports LB/Curated/Discovered) above search bar. Source badges show origin (📌 Curated, 🔍 Discovered, 🔥 Hot). Pool breakdown shown in footer.
- `/markets` — Sports Markets: Filter tabs (Upcoming/Moneyline/Spread/Total/Futures/All). Shows LIVE/PREGAME/FUTURES badges. 30s auto-refresh. Game markets populated from positions registry.
- `/bets` — My Bets: localStorage bet tracker. Log bets from signal cards ("Track" button), enter amount, resolve as Won/Lost with auto PNL calculation. Stats: Open count, Win Rate, Total PNL, At Risk.

## Key API Routes

- `GET /api/traders?category=sports` — Sports-specific leaderboard (default). Use `category=all` for overall leaderboard
- `GET /api/markets?type=upcoming|all|moneyline|spread|total|futures` — Sports markets with type filtering
- `GET /api/signals?sports=true/false` — Elite signals: large bets ($1K+, price 10¢–90¢) + positions from top sports traders
- `GET /api/signals/fast?sports=true/false` — Live Feed: consensus from recent 5000 trades
- `GET /api/orderbook?tokenId=...` — Live CLOB order book data (15s cache)
- `GET /api/trader/:address/positions` — Individual trader's current positions
- `GET /api/alerts/live` — Recent large bets ($1K+, 10¢–90¢) by tracked traders
- `GET /api/market/price-by-condition/:conditionId` — Live YES price for a market (checks signal cache → market registry → Gamma API)
- `GET /api/stream?channel=alerts` — SSE stream; pushes alert batch every 15s

## Signal Computation Logic

### Elite Signals (`/api/signals`) — Dual Source

**Phase 1–3: Trades-based signals**
1. Fetch leaderboard (ALL + SPORTS multi-window: ALL+WEEK+MONTH → 150+ unique traders)
2. Fetch recent 5000 trades (5 pages × 1000), filter to $100+ bets only
3. Group by (conditionId, wallet, side); find dominant YES/NO per market
4. Apply quality gates: verified sports LB + $500, OR 3+ traders + $1.5K, OR whale $5K+, etc.
5. Fetch live CLOB midpoint; compute value delta and confidence score

**Phase 4: Positions-based signals**
1. Fetch top 100 sports leaderboard wallets
2. Fetch current open positions for each wallet (parallel `Promise.all`)
3. Group by (conditionId, outcomeIndex=0→YES/1→NO)
4. Filter: curPrice 0.08–0.95, currentValue > $50 per trader, sports keywords match
5. Quality gate: 2+ traders with $1K+ total, OR single trader with $50K+
6. Emit as separate signals with `source: "positions"` — deduped vs trades signals
7. Populate **gameMarketRegistry** with each market seen in positions (used by /api/markets)

### Live Feed Signals (`/api/signals/fast`)
1. Fetch recent 5000 trades
2. Filter to sports-related markets by keyword matching
3. Group by (conditionId, wallet), track net position
4. Require 2+ unique wallets same side for MED/HIGH signals
5. Compute isActionable, bigPlayScore, marketCategory fields

## Signal Fields

- **isActionable** (bool): true if current price is within 12¢ of avg entry (not >90¢ or <8¢, not moved >10¢ against signal)
- **bigPlayScore** (0-3): 3 if totalUsdc≥30K or avg≥15K; 2 if ≥10K or avg≥5K; 1 if ≥3K or avg≥1.5K
- **marketCategory**: moneyline | spread | total | futures | other (from classifyMarketType)
- **marketType**: live | pregame | futures (from categoriseMarket — time-based)
- **outcomeLabel**: human-readable bet description (e.g. "Warriors WIN", "Over 225.5", "-6.5 covers")

## Signal Tiers

- **SINGLE**: One trader only — requires LB status or $2k+ bet
- **MED**: 2 traders same side
- **HIGH**: 3+ traders same side with avgQuality ≥ 45

## Game Market Registry

Module-level `gameMarketRegistry: Map<conditionId, GameMarketEntry>` populated when positions signals are generated.
The Gamma API only returns markets sorted by popularity (mostly long-term futures in top 800). Today's game markets (NBA, NHL matchups) don't appear there. The registry captures these from positions data and supplements the /api/markets endpoint for the Upcoming/Moneyline/Spread/Total tabs.

## Market Classification

- **classifyMarketType(question)**: → moneyline | spread | total | futures | other
  - moneyline: "vs" without O/U or spread keywords
  - spread: "spread", "ATS", or "(+/-N)" parenthetical
  - total: "o/u", "over/under", "total"
  - futures: "will X win", season/finals/playoffs keywords
- **categoriseMarket(question, endDate)**: → live | pregame | futures
  - live: title contains "(1H)", "(2H)", "Quarter", "(OT)", "Live" OR ends within 4h
  - pregame: ends within 7 days (and not futures)
  - futures: ends more than 7 days out

## External APIs Used

- `https://data-api.polymarket.com/trades` — Recent trades with market info + asset field
- `https://data-api.polymarket.com/positions?user=` — Current open positions per wallet
- `https://data-api.polymarket.com/v1/leaderboard` — Top PNL traders (ALL/WEEK/MONTH windows)
- `https://gamma-api.polymarket.com/markets` — Market metadata, prices, tokenIds
- `https://clob.polymarket.com/midpoint` — Live midpoint prices per token
- `https://clob.polymarket.com/book?token_id=` — Live order book (for /api/orderbook)
- `https://api.goldsky.com/api/public/.../pnl-subgraph/...` — On-chain PNL data

## Caching

All API responses cached in-memory:
- Trades: 2 minutes
- Positions: 8 minutes (per wallet)
- Leaderboard (multi-window): 10 minutes
- Markets (Gamma API): 3 minutes
- Elite signals: 2 minutes
- Live signals: 45 seconds
- Midpoints: 30 seconds
- Orderbook: 15 seconds

## Multi-Window Leaderboard

`fetchMultiWindowSportsLB()` runs three parallel leaderboard fetches (ALL×200, WEEK×100, MONTH×100 with category=sports), deduplicates by proxyWallet, and annotates each trader with `_windows: { inAll, inWeek, inMonth }` for recency scoring. Cache key: `lb-multi-sports` (10 min).

**NOTE**: Polymarket's leaderboard API is hard-capped at 50 traders per request regardless of limit parameter. Three windows (ALL+WEEK+MONTH) yield ~50–120 unique traders.

## Curated Elite Traders

`CURATED_ELITES` is a minimal list of known high-calibre sports traders verified on Polymarket who are worth fetching trade history for. Entry shape: `{ addr: string; name: string }` — no hardcoded PNL or quality scores.

`fetchEliteTraderTrades(wallet, limit=100)` fetches recent trades per curated wallet via `DATA_API/trades?user=wallet`. These are merged into `allTrades` (deduped by transactionHash) before signal processing. Curated traders are pre-populated in `lbMap` at the start of Phase 1 with `isSportsLb: true`.

**INTEGRITY RULE**: Only add wallets that are verified on Polymarket. No placeholder or fabricated entries. No hardcoded quality scores or PNL figures.

**Dynamic quality scoring**: qualityScore is computed from the wallet's actual sports trade history (fetched during signal computation): `volScore (45%) + countScore (30%) + avgBetScore (25%)`, capped at 90.

Current curated list: kch123 (addr: 0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee). Scores ~90 from $450K sports volume, 99 sports trades.

## Trader Discovery (Positions Phase Expansion)

In addition to leaderboard traders, the positions scan now includes **discovered sports bettors** found in the recent 10K trades scan:

- Threshold: `totalSize >= $3,000 OR (count >= 3 trades AND totalSize >= $1,000)`  
- Sort: by total volume descending; cap at 120 discovered wallets  
- This captures whales who make single large sports bets (e.g., $48K single bet = 1 trade)  
- Typical expansion: +5-20 wallets per cycle beyond the ~50 leaderboard traders

Quality scores for discovered traders use a three-factor formula from their observed activity in the 10K trade window.

## Trader Recency Scoring

`traderQualityScore(pnl, roi, posCount, windows)` applies a recency multiplier:
- WEEK + MONTH appearance → ×1.5 ("🔥 Hot")
- WEEK only → ×1.4 ("⚡ This week")
- MONTH only → ×1.1 ("📈 This month")
- ALL-time only → ×1.0 (no badge, "all-time")

Traders page sorted by this score (hot hands bubbled to top). Signal lbMap also uses recency-weighted scores.

## LIVE/PREGAME Status

`categoriseMarket(question, endDate, gameStartTime)`:
1. Text keywords (live/in-game/period/etc.) → "live" immediately
2. `ms < 0` (market already ended) → "pregame" (not live — avoids false positives)
3. `ms > 7 days` → "futures"
4. `gameStartTime` provided AND `now >= gameStartTime` → "live" (game in progress)
5. `gameStartTime` provided AND `now < gameStartTime` → "pregame"
6. No `gameStartTime` → "pregame" (safe default, never falsely marks unstarted games as live)

**Key fix**: Removed `ms < 4h → live` and `ms ∈ [-20h,0) → live` heuristics which falsely marked resolved/ending markets as live.

**Game market override**: After `categoriseMarket()`, all three signal paths (elite/pos/fast) override: if raw type is "futures" but `marketCategory !== "futures"` (i.e., it's a moneyline/spread/total market for a specific game), force to "pregame". This prevents specific game markets with endDates > 7 days from showing the FUTURES badge — FUTURES badge is reserved for season/championship outright winner markets only.

**Slug date vs game date**: Polymarket slugs contain the market CREATION date (e.g., `nba-den-mem-2026-01-25` was created Jan 25 for a March 18 game). The `endDate` field from positions API and Gamma API contains the actual game date and should be used for date filtering, not the slug date.

## Chart Price History

`GameScorePanel` price chart: backend `/api/price-history` returns YES-normalized prices (0–1). When `side === "NO"`, the frontend inverts each price point (`p = 1 - p`) so the chart shows the NO token's price trajectory. Label dynamically shows "NO price" or "YES price" based on side.

## Design

- Blue primary theme (217 91% 35%)
- Dark/light mode support
- Sidebar navigation with live status indicators
- Sports-only toggle on Elite signals mode
- Markets filter tabs: Upcoming | Moneyline | Spread | Total | Futures | All
- Expandable signal rows on Dashboard (inline panel)
- ACTIONABLE (emerald), PRICE MOVED (gray), BIG PLAY (amber), VALUE EDGE, ELITE, SPORTS LB, POSITIONS badges
- LIVE (red pulsing), PREGAME (blue), FUTURES (gray) game status badges

## Key Technical Details

- Polymarket trades API caps at 1000/call → paginate with offset (5 pages → 5000 trades)
- Game markets close fast → use market DB for enrichment only, not as hard filter
- Sports is ~7% of all trades → few qualified trades; positions API fills the gap
- Today's NBA/NHL game markets not in Gamma API top-800 → gameMarketRegistry fills this
- Top sports traders (DrPufferfish, EIf, 0p0jogggg, Herdonia, sovereign2013, etc.) are dominant
- Anonymous wallets show truncated addresses; auto-pseudonyms are Polymarket format
- `isSportsRelated()` keyword filter used to classify markets
