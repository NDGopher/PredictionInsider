# Polymarket Analytics – Data Source & Comparison

## Pipeline run (this session)

- **Command:** `python pnl_analysis/run_full_pipeline.py --analyze-only --ingest`
- **Result:** 39 traders processed, 39 updated in DB. Master `_all_analysis.json` has 39 entries (RN1 deduped).
- **Skipped (no CSV):** Traders without a CSV in output/. Others in ALL_TRADERS but not in this run’s output (e.g. wallet-only names) may still be in DB from prior ingest.

## How Polymarket Analytics gets data (from network traffic)

Using the in-IDE browser (cursor-ide-browser), the traders page was loaded and **network requests** were captured.

### APIs they call

1. **Leaderboard data**
   - `GET https://polymarketanalytics.com/api/traders-tag-performance`
   - Query params: `tag=Overall`, `sortDirection=ASC`, `limit=100`, `offset=0`, `sortColumn=rank`, and filter ranges: `minPnL`, `maxPnL`, `minWinAmount`, `maxWinAmount`, `minLossAmount`, `maxLossAmount`, `minWinRate`, `maxWinRate`, `minCurrentValue`, `maxCurrentValue`, `minTotalPositions`, `maxTotalPositions`.
   - So they use a **backend API** (their own server), not Goldsky directly in the browser.

2. **Global range for filters**
   - `GET https://polymarketanalytics.com/api/traders-tag-performance?getGlobalRange=true&tag=Overall`

3. **Other**
   - `GET https://polymarketanalytics.com/api/trader-tags`
   - `GET https://polymarketanalytics.com/api/market-tags`

### Interpretation

- Their site is “Powered by Goldsky.” So their **server** likely uses Goldsky (Turbo Pipelines or PnL subgraph) to build trader stats, then exposes them via the REST API above.
- The browser only talks to **polymarketanalytics.com**; no direct Goldsky or Polymarket API calls from the client.

## Our data vs “true” PnL

- **We now have two PnL numbers per trader:**
  - **raw_realized_pnl** = sum of `realizedPnl` over the **raw CSV** (no hedge/bond stripping). This is the number that **matches Polymarket** (and Polymarket Analytics, which uses similar underlying data).
  - **total_profit** = directional, event-level, after hedge and bond filters. Used **only for analysis** (quality score, tier, ROI, etc.).

- **Display:** Our API returns `overall_pnl` = `rawRealizedPnl` when present, so the UI shows the Polymarket-matching value.

- **Example (Vetch):**
  - raw_realized_pnl (true PnL): **513,568.66**
  - total_profit (directional, for analysis): **223,457.01**

## Numeric comparison with Polymarket Analytics

- Their public API was **rate-limited (429)** when requested from this environment, so no automated side-by-side PnL table was produced.
- You can compare manually: open [Polymarket Analytics – Traders](https://polymarketanalytics.com/traders), search for the same usernames (e.g. Vetch, kch123, geniusMC, RN1), and check “Overall PnL” vs our Elite Traders page.
- Our **displayed** PnL is now **raw_realized_pnl** (true PnL); it should align with Polymarket and Polymarket Analytics, up to timing of data and any definitional differences (e.g. they use “Total Wins − Total Losses” per market).

## Camoufox

- Camoufox was not used; analysis was done with the in-IDE browser (cursor-ide-browser) and its **browser_network_requests** tool to capture the requests above.
- If you prefer Camoufox for future runs, you can use it to load the same traders page and inspect the same endpoints in the Network tab.
