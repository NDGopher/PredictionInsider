# PredictionInsider

Elite Polymarket trader tracking system. Monitors ~49 curated sharp traders ("insiders"), detects when multiple elites enter the same market, and generates consensus signals scored by sport-specific ROI, conviction size, and position overlap.

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

Create a database locally:

```bash
createdb predictioninsider
```

Or use a hosted provider (see Digital Ocean section below).

### 5. Configure environment variables

Create a `.env` file in the project root:

```env
# Required — PostgreSQL connection string
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/predictioninsider

# Optional — defaults to 5000 if omitted
PORT=5000

# Optional — set to "production" for prod builds
NODE_ENV=development

# Optional — used by Python analysis scripts to push results to the backend
# Defaults to http://localhost:5000 if not set
BACKEND_URL=http://localhost:5000
```

> The `DATABASE_URL` is the only required secret. Everything else has a default.

### 6. Push the database schema

This creates all tables from the Drizzle schema:

```bash
npm run db:push
```

### 7. Start the development server

```bash
npm run dev
```

The app runs at **http://localhost:5000** — both the API and the frontend are served from the same port.

---

## Python Analysis Pipeline

The `pnl_analysis/` directory contains the scripts that analyze trader CSV exports and push results into the database. You run these manually (or on a cron job) to refresh trader metrics.

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
python ingest_csvs.py
```

The pipeline:
1. Fetches trader history from Polymarket's public API
2. Computes sport-specific ROI, market-type ROI, price-bucket stats, quality scores, and tier ratings
3. POSTs results to the Express backend which writes them to PostgreSQL

---

## Project Scripts Reference

| Command | What it does |
|---|---|
| `npm run dev` | Runs the full app in development (Express + Vite HMR) |
| `npm run build` | Compiles the frontend and bundles the backend to `dist/` |
| `npm start` | Runs the compiled production build |
| `npm run db:push` | Syncs the Drizzle schema to your PostgreSQL database |
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

Push the schema:

```bash
npm run db:push
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
