# Local setup — current blocker and fix

## Why signals / traders failed

Nothing was listening on the Postgres port (Docker uses **5433** on the host; see `docker-compose.yml`). The app needs **PostgreSQL** for canonical PnL/ROI (`elite_trader_profiles`), trader lists, and ingest. The log `ECONNREFUSED` means Postgres is not running (or `DATABASE_URL` is wrong).

## Fix (recommended: Docker)

1. Install **Docker Desktop** for Windows: https://docs.docker.com/desktop/install/windows-install/
2. Open a **new** PowerShell after install, `cd C:\PredictionInsider`
3. `npm run db:up` — starts Postgres (see `docker-compose.yml`)
4. `npm run db:init` — runs `scripts/init-db.sql` (creates `elite_traders`, `elite_trader_profiles`, etc.). Skip `npm run db:push` unless you add Drizzle `pgTable` definitions — it can propose **dropping** those tables.
6. `npm run dev` — open http://127.0.0.1:5000

**One-click (Windows):** double-click **`refresh-all.bat`** or **`start-prediction-insider.bat`**. It (1) **kills anything on port 5000** so no stale Node process keeps an old `DATABASE_URL`; (2) verifies Docker, starts Postgres, **`db:init`** (not `db:push`); (3) opens a **new** server window with a fresh env; (4) waits until `http://127.0.0.1:5000` responds; (5) runs the pipeline **in this window** so you see **ingest** + **grade_changes_*.json** when it succeeds. Use `start-prediction-insider.bat full` for a full re-fetch (slow). Use `start-prediction-insider.bat skip` for DB + dev in this window only.

If Docker says **“Docker Desktop is unable to start”** or **cannot reach the daemon**: open **Docker Desktop** from the Start menu and wait until it shows the engine running (often 1–2 minutes); reboot after first install; run **`wsl --update`** in an admin terminal if Docker uses WSL2. **Workaround without Docker:** create a free DB at [Neon](https://neon.tech), put `DATABASE_URL` in `.env`, then run **`start-prediction-insider.bat hosted`** (skips Docker entirely).

**VPS (Linux):** `chmod +x scripts/start-vps.sh` then `./scripts/start-vps.sh` (dev) or `./scripts/start-vps.sh production` after `npm run build`. For a real server, use **PM2** as in `README.md` (Digital Ocean section).

**Alternative:** Use a hosted Postgres (e.g. Neon), paste the connection string into `.env` as `DATABASE_URL`, then `npm run db:init`. See `docs/DATABASE-SETUP.md`.

## Optional: full analytics in the DB

After Postgres works:

```bash
cd pnl_analysis
python run_full_pipeline.py --ingest
```

## Where to look in Cursor

| File | Purpose |
|------|---------|
| `.env` | `DATABASE_URL`, `PORT`, `BACKEND_URL` |
| `docker-compose.yml` | Local Postgres user `predictioninsider` / DB `predictioninsider` |
| `server/routes.ts` | `formatApiError`, `/api/signals` profile-metrics fallback when DB is down |
| `docs/DATABASE-SETUP.md` | Neon vs Docker detail |
| `refresh-all.bat` | Same as `start-prediction-insider.bat` — convenience double-click |
| `scripts/kill-listen-port.cmd` | Frees port 5000 (stale Node / wrong DB env) |
| `start-prediction-insider.bat` | Docker + `db:init` + new server window + wait + pipeline + ingest |
| `scripts/start-vps.sh` | Linux/VPS: docker (optional) + `db:init` + dev or production |
| `scripts/run-pipeline.cmd` | `full` or `incremental` pipeline only |

## Code changes already in the repo

- Clear **503** + readable **error text** when Postgres refuses connections (no more empty `"error":""`).
- **`/api/signals`** continues if only the profile-metrics query fails (category filters degrade; full quality still needs DB).
- **`/api/traders`** still needs **`elite_trader_profiles`** — run Postgres + `db:init` (and ingest when you want real PnL rows).
