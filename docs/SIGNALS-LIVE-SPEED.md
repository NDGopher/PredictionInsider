# Making signals more live: speed and rate limits

We want signals to feel real-time without hitting Polymarket rate limits. Polymarket does **not** expose a public WebSocket for order book or trades; everything is HTTP. So "more live" means: **fewer, smarter requests** and **faster refresh cycles** where we stay under limits.

---

## What we did

### 1. **Batch CLOB midpoints (biggest win)**

- **Before:** For each signal we called `GET /midpoint?token_id=X` once. 50 signals = 50 requests per signal build.
- **After:** We collect all token IDs (YES + NO for every market in the batch), then call **POST /midpoints** with a body of `[{ "token_id": "..." }, ...]` in chunks of 150. So 50 markets → 1 request; 200 tokens → 2 requests.
- **Rate limit:** Polymarket allows **500 POST /midpoints per 10s**. We send 1–2 batch requests per elite signal build (every ~2 min when cache misses), so we stay well under the limit and get **fresh prices in one shot** instead of 30s-cached single-token GETs.

### 2. **Position refresh: 90s → 60s**

- `refreshLivePositions()` runs every **60 seconds** instead of 90. Positions (and thus “who still holds”) update more often, so signals reflect exits and new entries sooner. We still run 8 traders at a time to avoid rate spikes.

### 3. **Price stream: 3s → 2s**

- The SSE **price** channel (`/api/stream?channel=price&conditionId=...`) now polls every **2 seconds** when a client is watching one market. That’s one request per 2s per viewer (to our server; we then hit Gamma/registry/cache), so it’s light and makes the single-market view feel live.

---

## What we’re *not* doing (and why)

| Idea | Why we don’t |
|------|----------------|
| **Polymarket WebSocket** | No public WebSocket for CLOB order book or trades. Only HTTP APIs. |
| **Our own WebSocket** | We’d still have to poll Polymarket on the server. SSE (what we use) is simpler and enough for push updates. |
| **Shorter signal cache (e.g. 30s)** | Would multiply server load (full signal build + batch midpoints + DB) and Polymarket position/trade calls. 2 min cache is a good balance; client already refetches every 60s. |
| **Polling /book per token** | Order book is 1,500 req/10s per token. Batching midpoints is cheaper and gives a single “tradeable” price; we don’t need full book for signal confidence. |

---

## Rate limits (Polymarket, rough reference)

- **GET /midpoint:** 1,500 req/10s  
- **POST /midpoints:** 500 req/10s (we use this; each request can contain many token IDs)  
- **GET /book:** 1,500 req/10s  
- **Data API (trades, positions):** not clearly documented; we throttle with 8 concurrent position fetches and 60s refresh.

By batching midpoints we use **far fewer** CLOB calls per signal build and avoid rate limits while keeping prices fresh.

---

## Optional next steps (if you want even more “live”)

1. **SSE “signal ticker”**  
   When the server finishes a new signal build, push a short summary (e.g. signal IDs + top N prices) to clients subscribed to `channel=signals`. Clients can refetch only when something changed, or refresh the list every 60s as now.

2. **Client: subscribe to price stream for visible cards**  
   For each signal card on screen, open an SSE to `channel=price&conditionId=X`. Our server already supports 2s polling per conditionId; you’d have one connection per visible market so the UI prices update every 2s without refetching the whole list.

3. **Order book only where needed**  
   If you add “depth” or “spread” to the UI for one market, call our existing **GET /api/orderbook?tokenId=...** (we proxy CLOB /book). Use it only for the focused market to stay under 1,500/10s.

4. **Shorter midpoint cache for single-token GET**  
   `fetchMidpoint()` still caches 30s for ad-hoc calls. If you have a “live price” widget that doesn’t use the batch path, we could reduce that cache to 10s for a more live feel on that widget.

---

## Summary

| Change | Effect |
|--------|--------|
| Batch POST /midpoints in signal build | Fewer CLOB calls, fresh prices, no rate limit issues |
| Position refresh 60s | Sooner view of who holds what |
| Price SSE 2s | More live single-market view |

Signals are “more live” by **batching order-book-derived prices**, **refreshing positions more often**, and **streaming price updates faster** where it matters, without adding WebSockets or risking Polymarket rate limits.
