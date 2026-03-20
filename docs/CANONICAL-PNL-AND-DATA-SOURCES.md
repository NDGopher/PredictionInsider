# Canonical PNL and Data Sources

This doc explains where elite trader PnL, ROI, win rate, and position-size metrics come from. **We use real data only — no invented numbers, no caps.**

## Two data sources

### 1. Canonical PNL (Polymarket APIs)

- **Source:** Polymarket **closed-positions** and **positions** APIs (same data the Python script uses).
- **Computed in:** `server/eliteAnalysis.ts` → `fetchCanonicalPNL`, then `patchProfileWithCanonicalPNL`.
- **Aggregation:** By **event** (eventSlug). All positions in the same game/market are netted (YES + NO, moneyline + spread + totals). One row per **event** = one “position” in the sense of “total capital in that market.”
- **Stored in:** `elite_trader_profiles.metrics` (and `elite_trader_positions` for raw sync).
- **When it runs:** On “Refresh PNL” and any scheduled canonical refresh.

**What we store from canonical:**

- `overallPNL`, `overallROI`, `winRate` / `pnlWinRate`
- `roiBySport`, `roiBySportMarketType` (with **per-event** `avgPositionSize` and `medianPositionSize`)
- `closedByCategory`, `monthlyROI`, `last30dROI`, `last90dROI`, etc.
- `medianBetSize` / `avgBetSize` at profile level (from closed position rows)

**Important:** When we run canonical, we **always** overwrite PnL, ROI, win rate, and `roiBySport` in the profile. So the displayed ROI/win rate and sport breakdown come from real Polymarket position data, not from CSV when canonical has been run.

### 2. CSV / real trade analysis (Python pipeline)

- **Source:** Exported trade/position CSVs processed by the Python pipeline (`pnl_analysis/`), e.g. `analyze_trader.py`, `run_full_pipeline.py`.
- **Aggregation:** By **event** (grouping_id = eventSlug). So `sport_stats` and `market_stats` are also **per-event**: `events` = number of events (markets), `avg_bet` / `median_bet` = mean/median of **total cost per event** (i.e. position size per market), not per individual fill.
- **Ingested via:** `POST /api/elite/traders/ingest-analysis`. Writes `sport_stats`, `market_stats`, `quality_score`, `csvTailGuide`, etc. into the profile.
- **Role:** CSV supplies **quality_score** (Gemini-style metric), tail guides, and optional reference stats. It does **not** override canonical ROI/win rate/`roiBySport` after a canonical refresh — canonical is the source of truth for those when it has run.

So: **both** canonical and CSV are “real” (APIs and CSV export). Canonical is the source of truth for PnL, ROI, win rate, and `roiBySport` whenever we have run it; CSV is the source of truth for quality score and tail/guide content.

## Position size vs “bet”

- **Position size:** Total capital in **one market/event** (e.g. $1000 across 20 fills in the same game = $1000 position).
- **Per-trade size:** Size of a single fill (e.g. $50). We do **not** use per-trade median for “normal” size.

For “is this position outsized?” we compare:

- **This position’s size:** e.g. `costBasis` or `actualRisk` (total in that market).
- **Normal:** **Median (or average) position size** in that sport (or sport×marketType), i.e. median/mean of *per-event* invested.

So we use **median position size** (and avg position size), not “median bet” in the sense of per-trade. In code and DB we expose:

- `medianPositionSize` / `avgPositionSize` in `roiBySport` and `roiBySportMarketType` (canonical and ingest).
- Legacy `medianBet` / `avgBet` are kept and equal to the same position-level values.

We do **not** apply an artificial floor (e.g. 200) to “normal” — so 7.6× can appear when the trader’s typical position in that sport is small and the current position is larger. Low volume is reflected in sample size (e.g. tradeCount), not by capping multiples.

## No caps

- **ROI and win rate** are never capped (e.g. no 60% ROI or 85% win rate ceiling). If the data says 97%, we show 97%; if it’s wrong, we fix the underlying calculation or data source, not the display.
- **relBetSize / traderRelSize** use actual median/avg position size; no minimum “normal” floor.

## Summary

| Concept              | Source                    | Meaning |
|----------------------|---------------------------|--------|
| Canonical PNL/ROI/WR | Polymarket APIs           | Event-level aggregation; source of truth when canonical has run |
| CSV analysis         | Python on exported CSVs   | Same event-level idea; owns quality_score and tail guides |
| Position size        | Per-event invested        | Total in that market; median/avg of this = “normal” for relBetSize |
| No caps              | N/A                       | Show actual ROI, win rate, and position multiples from real data |
