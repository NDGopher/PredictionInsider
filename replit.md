# PredictionInsider

A sports prediction market intelligence dashboard that surfaces consensus signals from active Polymarket traders.

## Architecture

**Frontend**: React + TypeScript + Wouter routing + TanStack Query + Shadcn UI
**Backend**: Express.js server that proxies Polymarket public APIs and computes signals
**Data**: All live from Polymarket public APIs (no database needed — read-only data)

## Pages

- `/` — Dashboard: Signal overview, top stats, trader mini-list, how it works
- `/signals` — Live Signals: Filterable/sortable consensus signals with confidence bars, trader details
- `/traders` — Top Traders: Active sports traders from recent Polymarket activity 
- `/markets` — Sports Markets: Active Polymarket sports markets with prices, volume, liquidity

## Key API Routes

- `GET /api/traders` — Active traders from recent trades, aggregated by wallet
- `GET /api/markets` — Active sports prediction markets from Gamma API
- `GET /api/signals` — Computed consensus signals (2+ traders same side = consensus)

## Signal Computation Logic

1. Fetch recent trades from `data-api.polymarket.com/trades`
2. Filter for sports-related markets using keyword matching
3. Group trades by conditionId (market) and by wallet (trader)
4. Find consensus: when 55%+ of traders on same side (YES/NO)
5. Get live midpoint price from CLOB API
6. Compute value delta: current price vs average entry price (with 2% slippage)
7. Confidence score = 20% activity + 50% consensus + 20% value + 10% size

## External APIs Used

- `https://data-api.polymarket.com/trades` — Recent trades with market info
- `https://data-api.polymarket.com/positions` — User open positions  
- `https://gamma-api.polymarket.com/markets` — Market metadata, prices
- `https://clob.polymarket.com/midpoint` — Live midpoint prices per token

## Caching

All API responses cached in-memory:
- Trades: 2 minutes
- Markets: 3 minutes
- Signals: 2 minutes
- Midpoints: 1 minute
- Positions: 5 minutes

## Design

- Blue primary theme (217 91% 35%)
- Dark/light mode support
- Sidebar navigation with live status indicators
- Professional sports betting analytics aesthetic
