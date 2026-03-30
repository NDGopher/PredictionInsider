# Daily CSV and DB Updates

To keep **PNL, trader scores, and signals** accurate, run the pipeline at least once per day. **Incremental** mode merges **recent** trades into existing CSVs (not a full history re-download every time).

**One-click Windows (`refresh-all.bat`):** Defaults to **smart** mode — it starts Docker, DB, and the dev server, and runs the Python incremental pipeline **only** if the last successful **ingest** was more than **24 hours** ago. The timestamp file is `pnl_analysis/output/.last_pipeline_run` (written after a successful ingest). To **force** a pipeline run the same day: `start-prediction-insider.bat incremental`, or in the same CMD window: `set PI_FORCE_REFRESH=1` then `refresh-all.bat`.

**Automatic on server start:** If the pipeline has not been run in the last 24 hours, the server will start it in the background when you run `npm run dev`. Same `.last_pipeline_run` file as above.

## Quick run (recommended for daily)

- **Incremental:** For each trader with an existing CSV, fetches only **recent activity** (2 pages closed + 1 open), merges into the CSV, then **re-analyzes all** traders and **ingests** to the DB. Much faster than a full re-fetch.

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
