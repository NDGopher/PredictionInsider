# Database setup: local (Docker) or free online (Neon)

PredictionInsider needs PostgreSQL. You can run it **locally with Docker** (full control, free) or use a **free hosted DB** (Neon) in a few minutes.

---

## Option A: Local database with Docker (recommended for development)

You get a full Postgres you can maintain, backup, and inspect. No account required.

### 1. Install Docker

- **Windows:** [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/)
- **Mac:** [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/)
- **Linux:** `sudo apt install docker.io docker-compose-plugin` (or your distro’s package)

### 2. Start the database

From the project root:

```bash
docker compose up -d
```

This starts Postgres 16 on host port **5433** (mapped from container 5432; **5433** avoids conflicts with a native Windows PostgreSQL on **5432**) and runs `scripts/init-db.sql` to create all tables (`elite_traders`, `elite_trader_profiles`, etc.).

### 3. Configure the app

Copy the example env and use the default Docker URL:

```bash
cp .env.example .env
```

`.env.example` already contains the local URL:

```env
DATABASE_URL=postgresql://predictioninsider:predictioninsider_local@127.0.0.1:5433/predictioninsider
```

If you already have a `.env`, set `DATABASE_URL` to the line above (or leave it if it’s correct).

### 4. Create tables (required)

```bash
npm run db:init
```

This runs `scripts/init-db.sql` (`CREATE TABLE IF NOT EXISTS`). Do **not** run `npm run db:push` for routine setup — `shared/schema.ts` is Zod-only; Drizzle Kit can propose **dropping** `elite_*` tables.

### 5. Run the app and ingest

```bash
npm run dev
```

Then run the pipeline with ingest so traders and scores are in the DB:

```bash
cd pnl_analysis
python run_full_pipeline.py --ingest
```

### Useful Docker commands

| Command | Purpose |
|--------|--------|
| `docker compose up -d` | Start DB in background |
| `docker compose down` | Stop and remove containers (data in volume is kept) |
| `docker compose down -v` | Stop and **delete** the data volume |
| `docker compose logs -f db` | Follow Postgres logs |
| `docker exec -it predictioninsider-db psql -U predictioninsider -d predictioninsider -c "\dt"` | List tables |

---

## Option B: Free online database (Neon)

Good if you don’t want to run Docker or want a cloud DB for Replit/deploy.

### 1. Create a free Neon project

1. Go to [neon.tech](https://neon.tech) and sign up (GitHub is fine).
2. Create a new project (e.g. **predictioninsider**), pick a region.
3. Copy the **connection string** (Postgres URL). It looks like:
   ```text
   postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
   ```

### 2. Create tables

Neon gives an empty database. Create the same tables as local:

**Option 2a — Run init script in Neon SQL editor**

1. In Neon dashboard: your project → **SQL Editor**.
2. Paste the contents of **`scripts/init-db.sql`** from this repo.
3. Run the script.

**Option 2b — Run init script from your machine**

If you have `psql` and the Neon URL:

```bash
psql "postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require" -f scripts/init-db.sql
```

### 3. Configure the app

In your project, set `DATABASE_URL` to the Neon connection string:

- **Local:** put it in `.env`:
  ```env
  DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
  ```
- **Replit:** Tools → **Secrets** → add key `DATABASE_URL`, value = the Neon URL.

Then run `npm run db:init` if you have not already applied `init-db.sql`, start the app, and run the ingest pipeline with `--ingest`.

### Neon free tier (as of 2024)

- 0.5 GB storage
- Branching and point-in-time restore
- No credit card for signup

Enough for development and light use; upgrade if you need more.

---

## Summary

| Option | Pros | Cons |
|--------|------|------|
| **Local (Docker)** | Full control, free, no signup, easy backups | Requires Docker installed |
| **Neon** | No Docker, free tier, works from Replit/hosted apps | Account + paste URL + run init SQL once |

After either option: set `DATABASE_URL`, start the app, run **`python pnl_analysis/run_full_pipeline.py --ingest`** so traders and quality scores load.
