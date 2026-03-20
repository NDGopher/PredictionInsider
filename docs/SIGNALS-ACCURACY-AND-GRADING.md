# Signals: position coverage, alert accuracy, and grading

## 1. Confirmation: are we getting all positions?

**Yes, after the changes below.**

- **Open positions:** We were already fetching **all** open positions per trader. `refreshLivePositions()` calls `fetchAllPositionsFull(wallet)`, which paginates the Polymarket positions API (500 per page, up to 10 pages = 5,000 positions per wallet). So every current holding is in `livePositionCache`.
- **Market universe:** The problem was that the **set of markets** used for elite signals came only from the **last 100 trades** per trader (`fetchEliteTraderTrades(wallet, 100)`). So:
  - Very active traders (many trades) dominated the list.
  - Traders with older or fewer recent trades rarely appeared.
  - Markets where someone had a position but no trade in that small window were missing.

**Fixes applied:**

1. **Trade limit increased 100 → 1000**  
   We now call `fetchEliteTraderTrades(e.addr, 1000)` so the trade-derived market set is much larger. Cache key includes the limit so we don’t serve stale 100-trade data.

2. **Markets built from positions as well as trades**  
   After building `marketWallets` from trades, we merge in **every current open position** from `posLookup`:
   - Build `tokenIdToCondId` from `marketDb` (asset → conditionId).
   - For each curated trader and each of their positions, if the market is in the DB and passes the sports filter, we add/update that market in `marketWallets` with position size and side.
   - So we now see every market where any curated trader has an open position (that’s in our market DB), not only markets that appeared in the last 1000 trades.

Result: we use **all positions** for coverage, and a **larger trade window** so the same few traders don’t dominate the list.

---

## 2. Alert side and “trader already sold”

**Side:**  
We resolve side from the API (`resolveSide(outcome, outcomeIndex)`) and use the **positions API** for the actual current holding. So the side we show (YES/NO) is the side of the **current position** when we have it.

**Sold between alert and now:**  
We now **require position confirmation** before emitting a signal:

- For each “dominant” entry we enrich with `posLookup`: same wallet, same asset, same side, `shares > 0` → `positionConfirmed: true`.
- We only add a signal when **at least one** dominant entry has `positionConfirmed === true`.
- If everyone on the dominant side has already sold (no current position), we skip that market.

So we do **not** alert on the wrong side, and we do **not** alert when the trader(s) have already sold. There is still a window (e.g. up to the next `refreshLivePositions()` cycle, ~90s) where a position could be sold just after we last refreshed; that’s inherent to any polling design.

---

## 3. Weightings and grades — current design and suggested improvements

### Current design (summary)

- **Trader quality (Elite page):**  
  PNL (35%), ROI (45%), position count (20%), with recency multiplier (e.g. in-week + in-month → 1.5x).  
  Also CSV/Gemini “Copy-Trade Metric” can override when present.

- **Signal confidence (`computeConfidence`):**  
  - ROI: up to 40% of score (25% ROI = full 40 pts).  
  - Consensus: up to 30% (single-trader gets half weight; counter-traders penalize up to 40 pts).  
  - Value edge: up to 20% (gradient from -5¢ to +5¢).  
  - Size: up to 10% (avg net USDC vs 15K cap).  
  - Relative bet size (conviction): 0–15 pts (2x–10x+ normal).  
  - Tier bonus: +3–8 for multi-trader or high quality.  
  Single-trader cap is 68–82 depending on conviction.

- **Quality gates for a market to become a signal:**  
  At least one of: verified sports LB + $500+; 2+ tracked + $1K+; single $5K+; 3+ traders $1.5K+; 2+ tracked $800+ each. Plus consensus ≥ 55%, and now position confirmation.

### Opinion and improvements

**What’s working well**

- Position-based merge and 1000-trade window fix the “same traders” and coverage issues.
- Position-confirmation gate keeps alerts aligned with who actually holds.
- Relative bet size (conviction) and counter-trader penalty are good ideas.
- Sport-specific ROI for confidence is the right direction.

**What I’d improve**

1. **ROI cap and curve**  
   - 25% ROI = full 40 pts can over-reward short hot streaks.  
   - Consider: cap at a higher ROI (e.g. 40%) and/or use a sublinear curve (e.g. sqrt) so 15% vs 30% isn’t double the points.  
   - Option: use **realized** ROI from canonical/CSV only when we have enough closed positions (e.g. ≥20), otherwise cap ROI contribution.

2. **Single-trader vs multi-trader**  
   - Single-trader cap (68–82) is reasonable, but a single elite with a huge relative size (e.g. 10x) and no counter-traders might deserve a higher ceiling (e.g. 85) when position is confirmed and size is well above their norm.  
   - Could add a small “conviction bonus” when `positionConfirmed` and `relBetSize >= 5`.

3. **Recency of position**  
   - We don’t currently down-weight positions that have been held for a very long time (e.g. 60+ days) with no recent trade.  
   - Optional: use `lastTimestamp` (or position age) to slightly reduce confidence for very stale holds so “fresh” conviction is weighted more.

4. **Value edge (20%)**  
   - The -5¢ to +5¢ band is reasonable.  
   - Consider a small penalty when `currentPrice` is *below* a threshold (e.g. 8¢) so we don’t over-score nearly-dead markets.

5. **Transparency**  
   - Exposing a short “breakdown” (ROI pts, consensus pts, value pts, size pts, conviction, tier) in the UI would help users trust and interpret grades.  
   - Optional: “Position confirmed” badge so users see we only show signals where someone still holds.

6. **Grades vs outcomes**  
   - If you store resolved bets (e.g. in My Bets), you could backtest: regress “did the user win?” on confidence band, value delta, and trader count.  
   - Use that to tune weights (e.g. maybe consensus weight or ROI weight should move up/down).

7. **Futures cap**  
   - Futures already have a recency-based cap (older entries get lower cap).  
   - Could add a “time to resolution” factor so positions very far from expiry don’t get over-scored.

---

## 4. Summary

| Topic | Status |
|-------|--------|
| All positions for all traders | Yes: positions paginated fully; markets now built from positions + 1000 trades. |
| Same traders bias | Reduced: 1000-trade window + merging all positions into `marketWallets`. |
| Correct side | Yes: side from positions API; trades used for enrichment only. |
| No alert after trader sold | Enforced: signal only if ≥1 dominant entry has current position (same side, shares > 0). |
| Weightings/grades | Documented; suggestions: ROI curve, single-trader ceiling, recency, value edge floor, backtesting. |
