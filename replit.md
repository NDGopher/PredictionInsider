# PredictionInsider

A sports prediction market intelligence dashboard that surfaces consensus signals from active Polymarket traders.

## Architecture

**Frontend**: React + TypeScript + Wouter routing + TanStack Query + Shadcn UI
**Backend**: Express.js server that proxies Polymarket public APIs and computes signals
**Data**: All live from Polymarket public APIs (no database needed — read-only data)

## Pages

- `/` — Dashboard: Signal overview, top stats, trader mini-list, how it works
- `/signals` — Signals: Two modes — Elite (large bets + positions) and Live Feed (consensus from recent trades)
- `/traders` — Top Traders: Active sports traders from recent Polymarket activity 
- `/markets` — Sports Markets: Active Polymarket sports markets with prices, volume, liquidity

## Key API Routes

- `GET /api/traders?category=sports` — Sports-specific leaderboard (default). Use `category=all` for overall leaderboard
- `GET /api/markets` — Active sports prediction markets from Gamma API
- `GET /api/signals?sports=true/false` — Elite signals: large bets ($200+) + positions from top sports traders
- `GET /api/signals/fast?sports=true/false` — Live Feed: consensus from recent 5000 trades

## Signal Computation Logic

### Elite Signals (`/api/signals`) — Dual Source

**Phase 1–3: Trades-based signals**
1. Fetch leaderboard (ALL + SPORTS, up to 60 traders) for quality enrichment
2. Fetch recent 5000 trades (5 pages × 1000), filter to $100+ bets only
3. Group by (conditionId, wallet, side); find dominant YES/NO per market
4. Apply quality gates: verified sports LB + $500, OR 3+ traders + $1.5K, OR whale $5K+, etc.
5. Fetch live CLOB midpoint; compute value delta and confidence score

**Phase 4: Positions-based signals (NEW)**
1. Fetch top 30 sports leaderboard wallets
2. Fetch current open positions for each wallet (parallel `Promise.all`)
3. Group by (conditionId, outcomeIndex=0→YES/1→NO)
4. Filter: curPrice 0.08–0.95, currentValue > $50 per trader, sports keywords match
5. Quality gate: 2+ traders with $1K+ total, OR single trader with $50K+
6. Emit as separate signals with `source: "positions"` — deduped vs trades signals
7. Signals marked with blue "POSITIONS" badge in UI

### Live Feed Signals (`/api/signals/fast`)
1. Fetch recent 5000 trades
2. Filter to sports-related markets by keyword matching
3. Group by (conditionId, wallet), track net position
4. Require 2+ unique wallets same side for MED/HIGH signals
5. Compute confidence and value delta with live midpoints

## Signal Tiers

- **SINGLE**: One trader only — requires LB status or $2k+ bet
- **MED**: 2 traders same side
- **HIGH**: 3+ traders same side with avgQuality ≥ 45

## Confidence Score Components

- ROI component (from leaderboard PNL/volume ratio)
- Consensus component (% of traders on dominant side)
- Value component (value delta vs current price)
- Size component (average bet size)
- Tier bonus (MED/HIGH)
- SINGLE trader cap at 62

## External APIs Used

- `https://data-api.polymarket.com/trades` — Recent trades with market info + asset field
- `https://data-api.polymarket.com/positions?user=` — Current open positions per wallet (fields: `outcome`, `outcomeIndex`, `curPrice`, `avgPrice`, `currentValue`, `conditionId`, `title`, `endDate`)
- `https://data-api.polymarket.com/v1/leaderboard` — Top PNL traders for quality enrichment
- `https://gamma-api.polymarket.com/markets` — Market metadata, prices, tokenIds
- `https://clob.polymarket.com/midpoint` — Live midpoint prices per token
- `https://api.goldsky.com/api/public/.../pnl-subgraph/...` — On-chain PNL data (used for Traders page)

## Caching

All API responses cached in-memory:
- Trades: 2 minutes
- Positions: 8 minutes (per wallet)
- Leaderboard: 10 minutes
- Markets: 3 minutes
- Elite signals: 5 minutes
- Live signals: 2 minutes
- Midpoints: 1 minute

## Design

- Blue primary theme (217 91% 35%)
- Dark/light mode support
- Sidebar navigation with live status indicators
- Sports-only toggle on Elite signals mode
- Filter tabs: live/pregame/futures/multi-trader/whale
- Expandable signal cards with trader breakdown and score details
- Signal source badges: ELITE (yellow), SPORTS LB (green), POSITIONS (blue), VALUE EDGE, NEW
- "LB" amber badge on trader rows for verified leaderboard traders

## Key Technical Details

- Polymarket trades API caps at 1000/call → paginate with offset (5 pages → 5000 trades)
- Game markets close fast → use market DB for enrichment only, not as hard filter
- Sports is ~7% of all trades → few qualified trades; positions API fills the gap
- Top sports traders (DrPufferfish, EIf, 0p0jogggg, Herdonia, sovereign2013, etc.) are dominant
- Anonymous wallets show truncated addresses; auto-pseudonyms are Polymarket format
- `isSportsRelated()` keyword filter used to classify markets
