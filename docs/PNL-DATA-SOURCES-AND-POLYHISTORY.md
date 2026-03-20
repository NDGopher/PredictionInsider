# PNL Data Sources and polyhistory Alignment

This doc describes how we ensure **accurate PNL and ROI** in line with the **polyhistory** folder and Gemini’s breakdown (ANALYSISCODE / Cannae-style).

## Data source (how we grab trader activity)

- **Same as polyhistory:** we use Polymarket’s Data API:
  - `GET https://data-api.polymarket.com/closed-positions?user=<address>&limit=50&offset=...`
  - `GET https://data-api.polymarket.com/positions?user=<address>&limit=50&offset=...`
- **Pipeline:** `pnl_analysis/run_full_pipeline.py` fetches both, concatenates (closed + open), dedupes by `id`, and writes one CSV per trader: `output/<username>_<wallet8>.csv`.
- **polyhistory:** `polyhistory/Cannae.py` (and similar `.py` files) do the same: fetch `closed-positions` and `positions`, concat, add `total_position_pnl = realizedPnl + cashPnl`, `grouping_id = eventSlug.fillna(slug)`, and save CSV.

So **data grab** is aligned: same API, same row-level fields (`realizedPnl`, `cashPnl`, `totalBought`, `avgPrice`, `eventSlug`, `slug`, `status`, `initialValue`, etc.).

## How Gemini broke down PNLs (ANALYSISCODE)

In `polyhistory/ANALYSISCODE.py`:

1. **Cost basis (per row):**
   - Closed: `calculated_cost = totalBought * avgPrice`
   - Open: `calculated_cost = initialValue`
2. **Event grouping:** `grouping_id = eventSlug.fillna(slug)` so hedges on the same event net out when we aggregate.
3. **Event-level aggregation:**  
   `event_agg = df.groupby('grouping_id').agg({'total_position_pnl':'sum', 'calculated_cost':'sum', ...})`
4. **Totals and ROI:**
   - Total Profit = `event_agg['total_position_pnl'].sum()`
   - Total Risked = `event_agg['calculated_cost'].sum()`
   - Overall ROI = `(Total Profit / Total Risked) * 100`

No hedge/bond stripping: **all rows** are included. ROI is therefore “dashboard match”: same logic as running ANALYSISCODE on the same CSV.

## How we use this in the pipeline

- **Display PNL:** We use **raw realized PNL** = `sum(realizedPnl)` over all rows. This matches Polymarket’s realized PNL.
- **Display ROI:** We use **dashboard-match ROI** so it stays consistent with ANALYSISCODE and the CSV:
  - We do **event-level aggregation on all rows** (before any hedge/bond strip):  
    `event_agg_all = df.groupby('grouping_id').agg(total_position_pnl=sum, calculated_cost=sum)`  
  - `total_risked_dashboard = event_agg_all['calculated_cost'].sum()`
  - `roi_dashboard = (raw_realized_pnl / total_risked_dashboard) * 100`
- **Output and ingest:** We expose:
  - `total_risked` = `total_risked_dashboard` (denominator for ROI)
  - `overall_roi` = `roi_dashboard`
  - `total_profit` = `raw_realized_pnl` (so summary matches display PNL)

So **CSV ROIs** and app ROIs are no longer “preposterous”: they use the same event-level, all-rows cost and PNL logic as polyhistory/ANALYSISCODE.

- **Quality score / tier / tail guide:** We still use **directional** metrics (after hedge and bond stripping) so that:
  - Quality and tags reflect “directional edge” only.
  - Sport/market breakdowns and “do not tail” logic stay based on directional performance.

## Summary

| Metric            | Source / formula                                                                 |
|-------------------|-----------------------------------------------------------------------------------|
| Data              | Same as polyhistory: `closed-positions` + `positions` → one CSV per trader       |
| Cost per row      | Closed: `totalBought * avgPrice`; Open: `initialValue`                           |
| Grouping          | `grouping_id = eventSlug.fillna(slug)` (event-level)                             |
| Display PNL       | `raw_realized_pnl` = sum(realizedPnl)                                            |
| Display ROI       | `roi_dashboard` = raw_realized_pnl / total_risked_dashboard * 100                |
| Total risked      | Sum of `calculated_cost` at event level over **all** rows (dashboard match)      |
| Quality / tier    | Directional only (after hedge + bond strip)                                     |

This keeps **accurate PNL data** and **sensible CSV ROIs** in line with polyhistory and Gemini’s ANALYSISCODE, while still using directional metrics for quality and tailing rules.

## Display PNL: Polymarket as source of truth

To avoid mismatches (e.g. app showing $5M vs Polymarket showing $902k), **display PNL** in the app is taken from the **canonical (Polymarket API) source** when available:

- The server’s **refresh-canonical-pnl** flow syncs each trader’s positions from Polymarket (`closed-positions` + `positions`), aggregates at event level (same as polyhistory), and writes **rawRealizedPnl** into the profile.
- After `POST /api/elite/admin/refresh-canonical-pnl` (or the scheduled run), the UI shows **rawRealizedPnl** from that canonical computation so numbers match Polymarket.
- Run this after ingest or periodically so cards never show “fabricated” PNL.

## Keeping CSVs and cards up to date

- **Per-trader scripts:** `python pnl_analysis/gen_trader_scripts.py` writes one Cannae-style `.py` per trader under `pnl_analysis/trader_scripts/`. Each script writes to `pnl_analysis/output/<safe_username>_<wallet8>.csv`. Run any script to refresh that trader’s CSV (e.g. `python pnl_analysis/trader_scripts/0p0jogggg_0x6ac5bb.py`).
- **Pipeline:**  
  - `python pnl_analysis/run_full_pipeline.py --stale-days 999 --ingest` — fetch only traders that **don’t** have a CSV yet, then analyze all and ingest.  
  - `python pnl_analysis/run_full_pipeline.py --analyze-only --ingest` — re-analyze existing CSVs and push to DB (no fetch).  
  - `python pnl_analysis/run_full_pipeline.py --ingest` — full fetch for all, then analyze and ingest.
- **Red dot on Elite:** Traders with no CSV / never analyzed show a **red dot** next to their name (`last_analyzed_at` is null). Create their CSV (pipeline or per-trader script), then run analyze + ingest and optionally **refresh-canonical-pnl** so PNL matches Polymarket.
- **Daily run (incremental only):** Use `python pnl_analysis/run_full_pipeline.py --incremental --ingest`. This only **merges new trades** into existing CSVs (no full re-fetch), then re-analyzes all and ingests. Run daily so CSVs stay current without re-downloading millions of rows.
- **Whales / skip huge CSVs:** Use `--skip-if-rows-over 250000` so traders with 250k+ rows are not re-fetched in batch; use their per-trader script for a full refresh when needed.
- **Grade-change alert:** After each ingest the pipeline diffs the new run vs `output/_previous_ingest.json`, writes `output/grade_changes_<timestamp>.json`, and prints why grades changed, what they changed to, and whether tail_guide (do-not-tail / tail logic) changed. Review that report to see what caused tier/ROI/quality changes.
- **Removing a trader (e.g. swisstony):** Remove them from `ALL_TRADERS` in the pipeline and from `gen_trader_scripts.py`, then call `POST /api/elite/admin/remove-trader` with body `{ "wallet": "0x..." }` to delete them from the DB.

## Double-check vs polyhistory

The manually verified `polyhistory/*.txt` analyses (e.g. Cannae, JuniorB, 0p0joggg) describe **which sports each trader is good/bad at** and **which submarkets** (Spread, Totals, Moneyline) to tail or mute. Our pipeline analyzes the same way:

- **sport_stats** and **market_stats** in each trader’s JSON match the polyhistory breakdown (per-sport ROI, net profit, win rate; per–market-type ROI).
- **do_not_tail_sports**, **auto_tail_sports**, **do_not_tail_market_types**, **do_not_tail_sides** are derived from the same thresholds (e.g. ROI &lt; -2% or WR &lt; 45% for do-not-tail; ROI &gt; 5% and 20+ events for auto-tail).
- This feeds into the app via ingest: **roiBySport**, **roiByMarketType**, **roiBySportMarketType**, **csvDoNotTailSports**, **csvAutoTailSports**, **csvDoNotTailMarketTypes**. Signals use `getEffectiveCategoryFilter(wallet, metrics)` so per-sport and per-submarket filtering matches the re-analyzed CSV logic.

After running the pipeline, run **`python pnl_analysis/validate_vs_polyhistory.py`** to print a side-by-side of pipeline vs polyhistory for every trader that has both; use it as a double-check that good/bad sports and submarkets align.
