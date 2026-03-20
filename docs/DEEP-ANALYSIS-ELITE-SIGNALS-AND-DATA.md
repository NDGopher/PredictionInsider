# Deep Analysis: Elite Signals, Data Integrity & Keeping Things Up to Date

This document summarizes what changed after filling in missing CSVs, what made the system better, the results, and how we keep data accurate and up to date. The **north star** is: **find traders who are elite at certain markets, making outsized bets on those markets, with price still in the vicinity — and downgrade when one of our elites is on the opposite side.**

---

## 1. What We Changed Since “Missing CSVs”

### 1.1 Filling in missing CSVs

- **Problem:** Some curated traders had no CSV in `pnl_analysis/output/`, so they never got analyzed or ingested. The Elite page showed a red dot (no analysis) and signals couldn’t use their sport/market ROI or quality.
- **What we did:**
  - **Fetch-only for missing:** `python pnl_analysis/run_full_pipeline.py --stale-days 999 --ingest` — only fetches traders that **don’t** have a CSV yet, then analyzes **all** (including existing CSVs) and ingests.
  - **Analyze-only after drop-in:** If you manually drop CSVs into `output/`, run `python pnl_analysis/run_full_pipeline.py --analyze-only --ingest` to re-analyze from existing CSVs and push to DB (no re-fetch).
- **Result:** Full roster (~41–46 traders) now has CSVs, JSON analysis, and DB profiles. No more “Analysis pending” for curated wallets.

### 1.2 Grade-change detection and reporting

- **What we did:** After each ingest, the pipeline diffs the current run against `output/_previous_ingest.json`, computes **grade changes** (tier, quality_score, ROI, total_profit, tail_guide), and:
  - Writes `output/grade_changes_<timestamp>.json`
  - Prints a “GRADE CHANGES” block to stdout with username and what changed.
- **Why it matters:** You can see exactly which traders moved tier, why ROI/PNL changed, and when do-not-tail / auto-tail logic was updated (e.g. after new closed positions).

### 1.3 Signal quality gates (good traders only)

- **Trades path (Phase 3):** Emit only when the cluster’s **average quality (avgQuality) ≥ 40** (B-Tier+). Lower-graded clusters are skipped.
- **Position-group path (Phase 4):** Same gate — **avgQualityForScore ≥ 40**.
- **Default feed filter:** When the client does **not** send `minQuality`, the server uses **effectiveMinQuality = 50**. So the default Live Signals feed only returns signals with **avgQuality ≥ 50**.
- **“All grades” option:** The Signals page has an “Elite only (Q≥50)” / “All grades” toggle; “All grades” sends `minQuality=0` so you can still see lower-grade signals when needed.

### 1.4 Canonical PNL and display

- **Display PNL** prefers **canonical** (Polymarket API) when available: `rawRealizedPnl` from `refresh-canonical-pnl` is shown on Elite cards so numbers align with Polymarket.
- **Fallback:** If canonical hasn’t been run, we show CSV-derived PNL (`csvDirectionalPNL` / `overallPNL`). Running “Refresh PNL (Polymarket API)” (or bulk canonical refresh) keeps cards in sync.

### 1.5 Trade settlement correctness

- **Settle All Trades (Fix Quality Scores):** Re-settles all trades with the **correct** win/loss formula (WIN: `size * (1 - price)`, LOSS: `-(size * price)`). Fixes the 0% ROI problem when `size` was misinterpreted.
- **Reset PNL:** Clears all settled data and re-runs settlement globally, then recomputes all trader profiles.

---

## 2. What Made It Better

| Area | Before | After |
|------|--------|--------|
| **Coverage** | Some traders had no CSV → no analysis, no signals | Full roster has CSVs; analyze-only + ingest keeps DB in sync |
| **Signals** | Low-quality clusters could surface (avgQuality &lt; 25) | B-Tier+ gate (40) on emit; default feed only shows Q≥50 |
| **Sport/market fit** | Generic ROI | **Sport- and sport×marketType-specific ROI** from ingest (roiBySport, roiBySportMarketType); elite tennis trader on tennis gets their tennis ROI, not overall |
| **Do-not-tail** | Manual or missing | CSV-derived **doNotTailSports**, **autoTailSports**, **doNotTailMarketTypes** in DB; signals skip when primary trader is do-not-tail for that sport |
| **PNL display** | Could diverge from Polymarket | Canonical PNL refresh aligns with Polymarket; CSV remains source for analysis |
| **Transparency** | Hard to see why grades changed | Grade-change report after each ingest (tier, quality, ROI, PNL, tail_guide) |
| **Opposite side** | N/A | **Counter-trader penalty:** each of our elites on the opposite side reduces consensus by 20 pts (max −40) so score drops when “one of our 40ish elites is on the opposite side” |

---

## 3. Results (Scoring Philosophy in Practice)

The **biggest focus** is: **elite traders who are elite at specific markets, making outsized bets on those markets, with price still in the vicinity → high grade. If multiple high-level specialists are on the same side, score is effectively maxed. We take away score when one of our elites is on the opposite side.**

### 3.1 How the score rewards “elite at market + outsized bet + price in vicinity”

- **Sport/market-specific ROI (avgROI):**  
  For each signal we use the trader’s **sport×marketType** ROI (e.g. Tennis|moneyline) when sample size ≥ 20; else sport-level ROI; else overall. So an “elite tennis trader” is scored by their **tennis** (and tennis|moneyline) performance, not by their politics ROI.

- **Relative bet size (relBetSize):**  
  Normal = median/avg position size in that sport (or sport×marketType) from canonical DB.  
  `relBetSize = this position size / normal` (capped at 20×).  
  - **5× bet** on a market that hasn’t moved → **10 pts** (relSizePts); **5× single-trader cap = 82** so a single elite can reach 82.  
  - 10×+ → 15 pts; 7× → 13 pts; 3× → 7 pts; 2× → 4 pts; &lt;2× → 0.

- **Price in the vicinity (priceStatus):**  
  - **actionable:** current price within 2–3¢ of sharps’ avg entry (right zone).  
  - **dip:** you can enter cheaper than sharps (still good).  
  - **moved:** price moved against the bet → **signal is not emitted** (filtered out). So “price remaining somewhat in the vicinity” is enforced by **dropping** “moved” signals.

- **Multiple high-level traders:**  
  - **Consensus** is quality-weighted; multiple elites on the same side increase consensus and tier bonus (e.g. 3+ traders with avgQuality ≥ 50 → +8 tier bonus).  
  - **Single-trader cap** is relaxed when relBetSize is high (5× → cap 82, 3× → 76, 2× → 72). So “multiple high level tennis traders on it” → consensus and tier bonus push the score toward the top.

### 3.2 Opposite-side penalty (elite on the other side)

- **counterTraderCount** = number of our tracked elites with a position on the **opposite** side (YES vs NO).  
- **Penalty:** each such trader reduces **effective consensus** by **20 points**, max **40**. So “100% consensus” with 2 opposite-side elites becomes 60% before consensus scoring.  
- Implemented in `computeConfidence(..., counterTraderCount, ...)` and passed from both trades path and position-group path (via `posMap.get(oppositeKey)?.traders.length`).

### 3.3 Current leaderboard and signals behavior

- Leaderboard: S-Tier (e.g. Vetch 91, geniusMC 83, HedgeMaster88 84) down to C-Tier; quality_score and csv_tier come from pipeline + ingest.
- Default Live Signals: only **avgQuality ≥ 50** (B-Tier+), so “good plays from good traders” surface by default; “All grades” allows lower-grade signals for inspection.
- Position-group signals: same B-Tier+ gate (40) and same **priceStatus === "moved" → skip** and **counterTraderCount** penalty.

---

## 4. Data Integrity & Accuracy

### 4.1 Sources of truth

| Data | Source | Notes |
|------|--------|--------|
| **Trade/position history** | Polymarket Data API (closed-positions + positions) | Fetched by pipeline or per-trader scripts → CSV |
| **Analysis (ROI, quality, do-not-tail)** | Python `analyze_trader.py` on CSV | Event-level aggregation; directional after hedge/bond strip; ingested into DB |
| **Display PNL** | Prefer **canonical** (Polymarket API sum of realizedPnl) | After refresh-canonical-pnl; else CSV-based |
| **Settled trades (win/loss)** | DB: `elite_trader_trades` | Correct formula: WIN = size*(1-price), LOSS = -(size*price) |

### 4.2 Ingest validation

- **Alias guard:** Known alt-accounts (KNOWN_ALIASES) are rejected at ingest so they don’t overwrite the canonical trader.
- **Python → routes mapping:** Sport and market-type keys are normalized (e.g. Python "SOCCER (EPL)" → "Soccer") so roiBySport, csvDoNotTailSports, roiBySportMarketType stay consistent for signal logic.
- **roiBySport / roiBySportMarketType:** Built from CSV `sport_stats` and `sport_market_stats` and stored in profile metrics; **loadCanonicalMetricsFromDB** reads these for signal scoring.

### 4.3 Settlement and profile recompute

- **Settle All Trades** (and **Reset PNL**) use the correct win/loss formula so quality_score and ROI recomputed from DB trades are accurate.
- **Refresh PNL (Polymarket API)** does not overwrite CSV-derived analytics; it only updates **rawRealizedPnl** (and related display fields) so Elite cards match Polymarket.

### 4.4 Optional checks (run periodically)

- **Validate vs polyhistory:**  
  `python pnl_analysis/validate_vs_polyhistory.py`  
  Compares pipeline auto_tail / do_not_tail / good-bad sports to manual polyhistory analyses. Use after pipeline runs to confirm sport/market logic alignment.

- **Grade-change report:**  
  After every ingest with `--ingest`, check `output/grade_changes_<timestamp>.json` and the printed “GRADE CHANGES” block to see what changed and whether it’s expected (e.g. new closed positions, formula change).

- **Canonical vs CSV:**  
  For a few traders, compare Elite card PNL to Polymarket profile. If they diverge, run **Refresh PNL (Polymarket API)** for those wallets (or bulk refresh).

### 4.5 Data integrity checklist (periodic)

1. **All curated have analysis:** `GET /api/elite/refresh-status` — ensure no trader has `isStale: true` for extended periods; every curated wallet should have `last_analyzed_at` set after a full pipeline run.
2. **Grade changes:** After any `--ingest`, open latest `pnl_analysis/output/grade_changes_*.json` and confirm tier/ROI/PNL changes are expected.
3. **Polyhistory alignment:** Run `python pnl_analysis/validate_vs_polyhistory.py` and skim auto_tail / do_not_tail vs manual analyses.
4. **PNL match:** Spot-check 2–3 Elite cards (e.g. Vetch, geniusMC) vs Polymarket profile All-Time PnL; if off, run canonical refresh.
5. **Settlement:** If any trader shows 0% ROI or clearly wrong win/loss, run **Settle All Trades (Fix Quality Scores)** or **Reset PNL** from Elite admin.

---

## 5. Keeping Data Up to Date Going Forward

### 5.1 Automated (server)

| Job | When | What |
|-----|------|------|
| **Scheduled pipeline (Python)** | Once per 24h (if not run in last 24h) on server start | `run_full_pipeline.py --incremental --ingest`: merge **new** trades into existing CSVs, re-analyze all, ingest. Writes `_previous_ingest.json` and grade_changes. |
| **Canonical PNL refresh** | 30s after startup, then every 24h | `runCanonicalPNLRefreshForAll()`: for each curated wallet, fetch Polymarket closed/positions, compute rawRealizedPnl, patch profile. Keeps display PNL aligned with Polymarket. |
| **Daily incremental refresh (Node)** | 3 AM UTC (checked every hour) | `runDailyRefreshForCurated()`: for traders not refreshed in 20h, fetch **new** activity only, re-run analysis, update DB. Runs 4 traders at a time. |

### 5.2 Manual (when you want control)

- **Full pipeline (all traders, full re-fetch):**  
  `python pnl_analysis/run_full_pipeline.py --ingest`  
  Use after adding new traders or when you want a full CSV refresh.

- **Analyze-only (no fetch):**  
  `python pnl_analysis/run_full_pipeline.py --analyze-only --ingest`  
  Use when you’ve dropped new CSVs or fixed data and only need re-analysis + ingest.

- **Fetch only missing CSVs:**  
  `python pnl_analysis/run_full_pipeline.py --stale-days 999 --ingest`  
  Fetches only traders without a CSV, then analyzes all and ingests.

- **Refresh canonical PNL:**  
  - Single: `POST /api/elite/admin/refresh-canonical-pnl/:wallet`  
  - All: `POST /api/elite/admin/refresh-canonical-pnl`  
  Use after ingest or when you want Elite cards to match Polymarket immediately.

- **Settle all trades / Reset PNL:**  
  From Elite page or admin endpoints when you need to fix settlement or recompute profiles.

### 5.3 Recommended cadence (summary)

- **Daily (automatic):** Incremental pipeline (24h), canonical PNL (24h), daily refresh (3 AM UTC).  
- **After adding traders or bulk CSV refresh:** Run full pipeline with `--ingest`, then optionally “Refresh PNL (Polymarket API)” so new traders show correct PNL.  
- **Periodic sanity checks:** Run `validate_vs_polyhistory.py`; review latest `grade_changes_*.json`; spot-check a few Elite PNLs vs Polymarket.

---

## 6a. Trade history for signals (per trader, not global volume)

**Problem:** Using Polymarket’s **global** “last N trades” biases the feed toward **hyperactive** wallets (raw trade count), not toward **strong traders’ current books** (positions, entry, relative size).

**What we do instead:**

- **Elite `/api/signals`:** For **each** curated wallet, fetch up to **`ELITE_TRADES_PER_WALLET` (4000)** trades via `/trades?user=&limit=1000&offset=…` (paginated), dedupe, sort **oldest→newest** so buy/sell netting stays correct. Merge batches from all curated elites (same cap **per** trader).
- **`/api/signals/fast`:** Uses the **same merged curated feed** (not global `trades?limit=4000`), plus canonical quality — activity volume no longer drowns out selective elites.
- **Live alerts / Sharp Moves (`/api/alerts/live` + SSE):** Same merged per-wallet feed; scan **newest-first** so fresh $1K+ curated buys surface first.

Signals still ground truth on **open positions** (live cache) and **CLOB mid** for entry vs market; trade history is for **which markets** have recent insider activity, not for ranking traders by message frequency.

---

## 6b. VIP premium lane (don’t miss elite specialty + huge stake)

**Goal:** If a **high-rated** curated trader is in a **sport/submarket they’re statistically strong in** and puts on a **large, confirmed** position, we should **not** drop the signal because **dollar-weighted cluster** avgROI or avgQuality looks bad, or because **consensus %** is borderline.

**Detection (`server/routes.ts`):**

- **Quality:** canonical `qualityScore ≥ 72`.
- **Book:** trades path requires **positionConfirmed** + stake **`≥ $350`** (USDC at risk).
- **Lane:** `traderSpecialtyLaneROI` — same sample rules as scoring (sport×marketType or sport ≥20 trades); lane ROI **`≥ 5%`**, or **`≥ 3%`** if stake **`≥ $8k`** (trades) / **`≥ $15k`** (positions path for “huge” alt).
- **Respect doNotTail** for that sport on the wallet.
- **Bypass cluster** when VIP USDC is **`≥ 45%`** of dominant risk **or** aggregate VIP stake **`≥ $8k`** (trades) / **`≥ $15k`** (positions): then **skip** negative avgROI and **&lt;40** avgQuality gates, allow **weak consensus** and **min activity gate** via `vipPassMinGate`, **`+7` confidence**, **`vipPremium: true`** on payload.
- **Positions-only path:** solo trader can pass the **`$50k`** floor if **`vipPremium` solo** with cost basis **`≥ $3.5k`** (same Q/lane rules).

**Product:** **`vipPremium`** sorts **above** other signals at equal confidence; default **`minQuality`** filter **does not** hide VIP rows. UI: **VIP LANE** / **VIP** badges on Signals + Dashboard.

**Cache:** elite response cache key bumped (`signals-elite-v44-vip-premium-…`); TTL **90s** for fresher entry proximity.

---

## 6. Summary Table: Scoring and Data Flow

| Concept | Implementation |
|--------|-----------------|
| **Elite at market** | avgROI from roiBySport / roiBySportMarketType (sport×marketType when ≥20 trades) |
| **Outsized bet** | relBetSize = position size / normal (median/avg in that sport×marketType); 5× → 10 pts, single-trader cap 82 |
| **Price in vicinity** | priceStatus: actionable or dip → keep; moved → **do not emit** |
| **Multiple elites same side** | Consensus + tier bonus (e.g. 3+ with Q≥50 → +8); higher effective score |
| **Elite on opposite side** | counterTraderCount → −20 per trader (max −40) on consensus |
| **VIP premium lane** | High Q + confirmed + lane ROI + size → bypass weak cluster avgROI/avgQuality/consensus; sort boost; `vipPremium` flag |
| **Data freshness** | 24h incremental pipeline + 24h canonical PNL + 3 AM UTC daily refresh |
| **Data integrity** | Correct settlement formula; canonical for display PNL; validate_vs_polyhistory + grade_changes review |

This keeps the system focused on **high-grade plays from strong traders in their best markets, with size and price still actionable**, and ensures we **reduce score when our own elites are on the other side**. Data stays aligned with Polymarket and CSV analysis through the refresh and ingest flows above.
