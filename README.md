# PredictionInsider

Elite Polymarket trader tracking system. Monitors 42 curated wallets in `CURATED_TRADERS` (`server/eliteAnalysis.ts`); market-maker bots are excluded from consensus. The app detects when multiple elites enter the same market and generates consensus signals scored by sport-specific ROI, conviction size, and position overlap.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, TailwindCSS, shadcn/ui, TanStack Query |
| Backend | Node.js 20, Express, TypeScript (tsx) |
| Database | PostgreSQL (via Drizzle ORM) |
| Analysis Pipeline | Python 3.11+, pandas |
| Signals | Live position cache (90s refresh), Polymarket CLOB API |

---

## Prerequisites

- **Node.js** v20+ (v18 minimum)
- **npm** v9+
- **Python** 3.11+
- **pip** / **uv** (uv recommended for speed)
- **PostgreSQL** 14+ (local or managed)
- A Polymarket account is not required — data is fetched from public APIs

---

## Local Development Setup

### 1. Clone the repo

```bash
git clone https://github.com/NDGopher/PredictionInsider.git
cd PredictionInsider
```

### 2. Install Node dependencies

```bash
npm install
```

### 3. Install Python dependencies

```bash
# Using pip
pip install pandas requests openpyxl python-docx

# Or using uv (faster)
uv pip install pandas requests openpyxl python-docx
```

### 4. Set up PostgreSQL

Choose one:

- **Local (Docker)** — Full control, no account. [Install Docker](https://docs.docker.com/get-docker/), then from project root: `npm run db:up` (starts Postgres and creates tables). Your `.env` already has the correct `DATABASE_URL`.
- **Free online (Neon)** — No Docker. Sign up at [neon.tech](https://neon.tech), create a project, copy the connection string into `.env` as `DATABASE_URL`, then run the SQL in `scripts/init-db.sql` in Neon’s SQL Editor (see [docs/DATABASE-SETUP.md](docs/DATABASE-SETUP.md)).

Detailed steps: **[docs/DATABASE-SETUP.md](docs/DATABASE-SETUP.md)**.

### 5. Configure environment variables

Create a `.env` file in the project root:

```env
# Required — PostgreSQL connection string
# Local Docker from this repo: use port 5433 (see docker-compose.yml and .env.example)
DATABASE_URL=postgresql://predictioninsider:predictioninsider_local@127.0.0.1:5433/predictioninsider
# Generic / self-hosted Postgres example:
# DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/predictioninsider

# Optional — defaults to 5000 if omitted
PORT=5000

# Optional — set to "production" for prod builds
NODE_ENV=development

# Optional — used by Python analysis scripts to push results to the backend
# Defaults to http://localhost:5000 if not set
BACKEND_URL=http://localhost:5000

# Optional — for Firecrawl CLI (web scraping / API docs). See "Firecrawl CLI" below.
# FIRECRAWL_API_KEY=fc-xxxx
```

> The `DATABASE_URL` is the only required secret. Everything else has a default.

### Authorizing Firecrawl CLI (optional)

If you use the Firecrawl CLI in this project (e.g. for Polymarket API docs or research), authorize it once:

**Option A — Browser (recommended)**  
From the project root, run:

```bash
npx firecrawl-cli login --browser
```

Your browser will open to log in; after that, the CLI is authenticated for your user.

**Option B — API key in this project**  
1. Get an API key from [firecrawl.dev](https://firecrawl.dev).  
2. Add to your `.env` (do not commit):

   ```env
   FIRECRAWL_API_KEY=fc-your-key-here
   ```

3. Use the CLI via npx so it picks up the env:

   ```bash
   npx firecrawl-cli --status
   ```

   (Or export `FIRECRAWL_API_KEY` in your shell so a globally installed `firecrawl` uses it.)

For **using Firecrawl in this project** and **where to keep the database on Replit**, see [docs/FIRECRAWL-AND-REPLIT.md](docs/FIRECRAWL-AND-REPLIT.md).

### 6. Create database tables

Elite tables are defined in `scripts/init-db.sql` (not Drizzle `pgTable` yet). Run:

```bash
npm run db:init
```

Avoid `npm run db:push` unless you have added real Drizzle table definitions — it can propose dropping `elite_*` tables.

### 7. Start the development server

```bash
npm run dev
```

The app runs at **http://localhost:5000** — both the API and the frontend are served from the same port.

---

## Python Analysis Pipeline

The **database of all traders** is PostgreSQL: `elite_traders` (roster) and `elite_trader_profiles` (metrics, quality score, tags, ROI by sport/market). Those profiles are filled and updated when you run the pipeline **with `--ingest`** so the backend and Top Signals use your CSV-derived scores. Run the pipeline daily (or on a cron) to keep scores and trader lists up to date.

The `pnl_analysis/` scripts analyze trader CSV exports and push results into the database. You run them manually (or on a cron job) to refresh trader metrics.

### Running a full refresh on all curated traders

```bash
cd pnl_analysis
python run_full_pipeline.py
```

### Running analysis on a single trader

```bash
cd pnl_analysis
python analyze_one_address.py 0xYOUR_WALLET_ADDRESS
```

### Ingesting CSVs directly

If you have Polymarket trade history CSVs already downloaded:

```bash
cd pnl_analysis
python ingest_csvs.py --ingest
```

Or run the full pipeline (fetch + analyze + push to DB):

```bash
python run_full_pipeline.py --ingest
```

The pipeline:
1. Fetches trader history from Polymarket's public API (or uses existing CSVs)
2. Computes sport-specific ROI, market-type ROI, price-bucket stats, **quality scores (agentic score)**, and tier ratings
3. POSTs results to the backend at `POST /api/elite/traders/ingest-analysis`, which writes to `elite_trader_profiles`

**You must run with `--ingest`** to push analyses into the database. Without it, CSVs and JSON are updated locally but the app will not show new scores or traders.

---

## Troubleshooting

### Traders not loading / "Failing to load traders" / Low or zero signal scores

The traders list and the **agentic quality scores** on Top Signals both depend on:

1. **PostgreSQL and `DATABASE_URL`**  
   The app reads traders and metrics from `elite_traders` and `elite_trader_profiles`. If `DATABASE_URL` is missing or wrong, `/api/elite/traders` and `/api/traders` return 500 and the UI shows "failing to load" or empty lists.

2. **Profiles must be populated from your CSVs**  
   Even with a valid DB, **scores and trader data come from the ingest pipeline**. The DB tables are filled when you run the Python pipeline **with `--ingest`**:

   - **From existing CSVs (and JSON analyses):**  
     ```bash
     cd pnl_analysis
     python run_full_pipeline.py --analyze-only --ingest
     ```
   - **Full refresh (re-fetch from Polymarket, analyze, then ingest):**  
     ```bash
     python run_full_pipeline.py --ingest
     ```
   - **Or ingest only from already-generated analysis files:**  
     ```bash
     python ingest_csvs.py --ingest
     ```

   Until ingest has run, `elite_trader_profiles` is empty or stale, so:

   - The Traders / Elite pages show no (or old) traders.
   - `loadCanonicalMetricsFromDB()` in the backend returns no ROI/win-rate/quality, so signal scoring falls back to zeros and **all scores look "shitty"**.

**Quick check:** Ensure the server is started with `DATABASE_URL` set, then run the pipeline with `--ingest` at least once. Reload the dashboard; traders and scores should appear after the next signals refresh (~90s) or page reload.

---

## Project Scripts Reference

| Command | What it does |
|---|---|
| `npm run dev` | Runs the full app in development (Express + Vite HMR) |
| `refresh-all.bat` (Windows) | Same as `start-prediction-insider.bat` — double-click to refresh DB + analysis + ingest |
| `start-prediction-insider.bat` (Windows) | Kills port 5000, Docker + `db:init`, **new** server window, waits for HTTP, then pipeline + ingest in this window — see `full` / `skip` / `hosted` |
| `scripts/start-vps.sh` (Linux) | Same idea on a VPS: `db:init` then dev or production `node dist/index.cjs` |
| `npm run build` | Compiles the frontend and bundles the backend to `dist/` |
| `npm start` | Runs the compiled production build |
| `npm run db:push` | Runs Drizzle Kit push — **can propose dropping `elite_*` tables** until `shared/schema.ts` defines real Drizzle `pgTable`s; normal refreshes use `db:init` only |
| `npm run db:init` | Runs `scripts/init-db.sql` (elite tables, etc.) — **safe** idempotent `CREATE IF NOT EXISTS`; the launcher runs this, not `db:push` |
| `npm run check` | TypeScript type check (no emit) |

---

## Digital Ocean Droplet Deployment

### Recommended droplet

- **Size**: Basic, 2 GB RAM / 1 vCPU (the $12/mo plan) — the live position cache holds 35k+ entries so 1 GB may swap
- **Image**: Ubuntu 22.04 LTS
- **Region**: Any (US East if your users are US-based)

### 1. Provision a managed PostgreSQL database (optional but recommended)

In Digital Ocean → Databases → Create → PostgreSQL 14.  
Copy the connection string — it looks like:  
`postgresql://doadmin:AVNS_xxx@db-postgresql-xxx.ondigitalocean.com:25060/defaultdb?sslmode=require`

Or run PostgreSQL on the same droplet (see step 3b below).

### 2. Initial server setup

SSH into your droplet:

```bash
ssh root@your-droplet-ip
```

Install Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v  # Should say v20.x.x
```

Install Python 3.11 and pip:

```bash
sudo apt update
sudo apt install -y python3.11 python3-pip python3.11-venv
```

Install PostgreSQL locally (skip if using managed DB):

```bash
# Option B: local Postgres on the same droplet
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE DATABASE predictioninsider;"
sudo -u postgres psql -c "CREATE USER piuser WITH PASSWORD 'strongpassword';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE predictioninsider TO piuser;"
```

Install PM2 (process manager):

```bash
npm install -g pm2
```

### 3. Deploy the app

```bash
cd /var/www
git clone https://github.com/NDGopher/PredictionInsider.git
cd PredictionInsider
npm install
```

Create the production `.env`:

```bash
nano .env
```

Paste and edit:

```env
DATABASE_URL=postgresql://piuser:strongpassword@localhost:5432/predictioninsider
PORT=3000
NODE_ENV=production
BACKEND_URL=http://localhost:3000
```

Create tables (idempotent):

```bash
npm run db:init
```

Build the production bundle:

```bash
npm run build
```

### 4. Start with PM2

```bash
pm2 start dist/index.cjs --name predictioninsider
pm2 startup   # Follow the printed command to auto-start on reboot
pm2 save
```

Check it's running:

```bash
pm2 status
pm2 logs predictioninsider --lines 50
```

### 5. Set up Nginx reverse proxy

```bash
sudo apt install -y nginx
```

Create a site config:

```bash
sudo nano /etc/nginx/sites-available/predictioninsider
```

Paste:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/predictioninsider /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 6. SSL with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Certbot will auto-renew. Your app is now live at `https://yourdomain.com`.

### 7. Set up the Python pipeline cron job

The app has a built-in daily refresh scheduler (3 AM UTC) that triggers via the admin panel, but if you want the Python pipeline to run on a cron schedule as well:

```bash
crontab -e
```

Add (runs the full pipeline at 4 AM UTC daily):

```bash
0 4 * * * cd /var/www/PredictionInsider/pnl_analysis && python3.11 run_full_pipeline.py >> /var/log/pi_pipeline.log 2>&1
```

---

## Deploying updates

When you push changes from local:

```bash
# On the droplet
cd /var/www/PredictionInsider
git pull origin main
npm install
npm run build
pm2 restart predictioninsider
```

---

## Project Structure

```
PredictionInsider/
├── client/               # React frontend (Vite)
│   └── src/
│       ├── pages/        # Signals.tsx, Elite.tsx, etc.
│       └── components/   # UI components
├── server/               # Express backend
│   ├── index.ts          # Entry point
│   ├── routes.ts         # All API routes + signal logic
│   └── eliteAnalysis.ts  # Curated trader list, sport classifiers
├── shared/
│   └── schema.ts         # Drizzle ORM schema (source of truth for types)
├── pnl_analysis/         # Python analysis pipeline
│   ├── analyze_trader.py # Core scoring engine
│   ├── ingest_csvs.py    # CSV → DB pipeline
│   └── run_full_pipeline.py
├── migrations/           # Drizzle-generated SQL migrations
└── .env                  # You create this (not committed)
```

---

## Notes

- **No external APIs required** — all data comes from Polymarket's public CLOB and Gamma APIs
- **The live position cache** refreshes every 90 seconds in the background; expect a ~90s warm-up after first start before signals populate
- **Signal scoring** uses sport-specific ROI from the Python pipeline — if you haven't run the analysis pipeline yet, scores will use fallback overall ROI
- **Admin panel** (Elite page → bottom) shows daily refresh status and a "Run Now" button to trigger re-analysis from the UI
