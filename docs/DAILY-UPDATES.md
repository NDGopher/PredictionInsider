# Daily CSV and DB Updates

To keep **PNL, trader scores, and signals** accurate, run the pipeline at least once per day. **Incremental** mode merges **recent** trades into existing CSVs (not a full history re-download every time).

**One-click Windows (`refresh-all.bat`):** Runs **incremental** pipeline every time (merge recent API data into CSVs, re-analyze all traders, ingest) so rankings and ROI stay current when you double-click. For a faster start without Python: `start-prediction-insider.bat skip`.

**Smart mode (`start-prediction-insider.bat` with no args):** Skips the pipeline if the last successful **ingest** was within **PI_SMART_REFRESH_HOURS** (default **6**; was 24h). Timestamp file: `pnl_analysis/output/.last_pipeline_run`. Force a run: `set PI_FORCE_REFRESH=1` then the same bat, or `start-prediction-insider.bat incremental`.

**Automatic on server start:** If ingest is older than the same threshold, `npm run dev` spawns the incremental pipeline in the background (uses `py -3` / `python` / `python3` on Windows as available).

## Quick run (recommended for daily)

- **Incremental:** For each trader with an existing CSV, fetches **recent closed and open pages** from the API, **overlays** them onto the full CSV (same position `id` keeps the newest row for accurate PnL), then **re-analyzes** and **ingests**. Much faster than a full re-fetch.

```bash
npm run daily-pipeline
```

Or directly:

```bash
python pnl_analysis/run_full_pipeline.py --incremental --ingest
```

Ensure the backend is running (e.g. `npm run dev`) and `BACKEND_URL` points to it (default `http://localhost:5000`), so ingest can POST to `/api/elite/traders/ingest-analysis`.

## Full refresh (all CSVs from API)

Use when you want to pull **full trade history** for every trader (no stale skip):

```bash
npm run pipeline:full
```

## Analyze-only (no fetch)

If you already have CSVs and only want to re-run analysis and update the DB:

```bash
npm run pipeline:analyze
```

## Scheduling

- **Windows**: Task Scheduler — create a daily task that runs `npm run daily-pipeline` (or the Python command above) from the project directory.
- **GitHub Actions**: Add a workflow that runs daily and executes the same command (and optionally sets `BACKEND_URL` to your deployed API).
- **Cron (Linux/macOS)**: e.g. `0 6 * * * cd /path/to/PredictionInsider && npm run daily-pipeline`.

After ingest, **canonical metrics** (roiBySport, quality_score, etc.) are cleared in the app cache so the next `/api/signals` request uses the new weighting and scores.
