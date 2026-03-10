# PredictionInsider

A sports prediction market intelligence dashboard that surfaces consensus signals from active Polymarket traders.

## Architecture

**Frontend**: React + TypeScript + Wouter routing + TanStack Query + Shadcn UI
**Backend**: Express.js server that proxies Polymarket public APIs and computes signals
**Data**: All live from Polymarket public APIs (no database needed — read-only data)

## Pages

- `/` — Dashboard: Signal overview, top stats, trader mini-list, how it works
- `/signals` — Signals: Two modes — Elite (large bets) and Live Feed (consensus from recent trades)
- `/traders` — Top Traders: Active sports traders from recent Polymarket activity 
- `/markets` — Sports Markets: Active Polymarket sports markets with prices, volume, liquidity

## Key API Routes

- `GET /api/traders` — Active traders from recent trades, aggregated by wallet
- `GET /api/markets` — Active sports prediction markets from Gamma API
- `GET /api/signals?sports=true/false` — Elite signals: large bets ($200+) with leaderboard enrichment
- `GET /api/signals/fast?sports=true/false` — Live Feed: consensus from recent 2000 trades

## Signal Computation Logic

### Elite Signals (`/api/signals`)
1. Fetch leaderboard (ALL + MONTH, up to 200 traders) for quality enrichment
2. Fetch recent 8000 trades, filter to $200+ bets only (large bet threshold)
3. Filter "Up or Down" minute markets out; optionally filter to sports-only
4. Aggregate per (conditionId, wallet) — track YES/NO positions with prices
5. Find dominant side (YES vs NO by unique wallets)
6. Fetch live CLOB midpoint using trade `asset` field (token ID)
7. Compute value delta: avg entry price vs current midpoint (with 2% slippage)
8. Compute confidence score with tier system (SINGLE/MED/HIGH)
9. Enrich with leaderboard data (PNL, ROI, quality score, "LB" badge)

### Live Feed Signals (`/api/signals/fast`)
1. Fetch recent 2000 trades
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
- `https://data-api.polymarket.com/v1/leaderboard` — Top PNL traders for quality enrichment
- `https://gamma-api.polymarket.com/markets` — Market metadata, prices, tokenIds
- `https://clob.polymarket.com/midpoint` — Live midpoint prices per token
- `https://api.goldsky.com/api/public/.../pnl-subgraph/...` — On-chain PNL data (used for Traders page)

## Caching

All API responses cached in-memory:
- Trades: 2 minutes
- Leaderboard: 10 minutes
- Markets: 3 minutes
- Elite signals: 5 minutes
- Live signals: 2 minutes
- Midpoints: 1 minute
- Subgraph positions: 8 minutes

## Design

- Blue primary theme (217 91% 35%)
- Dark/light mode support
- Sidebar navigation with live status indicators
- Sports-only toggle on Elite signals mode
- Filter tabs: live/pregame/futures/multi-trader/whale
- Expandable signal cards with trader breakdown and score details
- "LB" amber badge on trader rows for verified leaderboard traders
