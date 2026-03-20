# Firecrawl & Replit Setup Guide

This guide covers **Firecrawl CLI** (verified working) and **where to keep your database** when running PredictionInsider on **Replit** or locally.

---

## 1. Firecrawl CLI — Verified & How to Use

Firecrawl is **authorized and working**. You can use it from this project for:

- **Polymarket API docs** — scrape or search [docs.polymarket.com](https://docs.polymarket.com) to check endpoints and payloads.
- **Research** — e.g. competitor pages, news, any URL.
- **API discovery** — e.g. `firecrawl search "Polymarket API"` then scrape the result URLs.

### Verify auth (from project root)

```bash
npx firecrawl-cli --status
```

You should see: `● Authenticated via stored credentials`, plus Concurrency and Credits.

### Commands you can run

**Scrape a single page (saves to `.firecrawl/`):**

```bash
npx firecrawl-cli scrape "https://docs.polymarket.com/api-reference" -o .firecrawl/polymarket-api-ref.md
```

**Search the web (e.g. for API docs):**

```bash
npx firecrawl-cli search "Polymarket data-api closed-positions" --limit 5 -o .firecrawl/search.json --json
```

**Scrape with main content only (less nav/footer):**

```bash
npx firecrawl-cli scrape "https://example.com" --only-main-content -o .firecrawl/example.md
```

Output goes under `.firecrawl/` (already in `.gitignore`). Use `-o .firecrawl/<name>.md` or `.json` so results don’t flood the terminal.

### Optional: API key in project

If you want scripts or CI to use Firecrawl without browser login, add to `.env` (do not commit):

```env
FIRECRAWL_API_KEY=fc-your-key-here
```

Then the CLI will use it when you run `npx firecrawl-cli` from this repo (e.g. in Replit Shell with env loaded).

---

## 2. Where to Keep the Database (Replit vs Local)

PredictionInsider expects **PostgreSQL** and a **`DATABASE_URL`** environment variable. You can keep the DB in two ways:

| Where | Best for | How |
|-------|----------|-----|
| **Replit (built-in Database)** | Running the app on Replit | Use Replit’s Database tool; `DATABASE_URL` is set automatically. |
| **Local or external Postgres** | Running locally (e.g. Cursor/Windows) or sharing one DB across apps | Create a DB (local or e.g. Neon/Supabase), put the connection string in Secrets (Replit) or `.env` (local). |

---

## 3. Replit: Database & Secrets (What to Ask Replit)

If your project **lives on Replit** and you want the app to have a database there:

### A. Add / use the built-in database

1. In the Replit workspace, open the **Tools** dock (left sidebar).
2. Open **Database** (or search “Replit Database”).
3. Each Replit app gets a **built-in SQL database** by default. Open it and check the **Settings** tab (gear icon) for **connection credentials**.
4. Replit sets **`DATABASE_URL`** (and `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGPORT`) automatically. Your app already uses `process.env.DATABASE_URL` — no code change needed.

**If you don’t see a database:**

- Ask Replit Agent: *“Add a PostgreSQL database to this app and show me where DATABASE_URL is set.”*
- Or in the Database tool: use **Add a database** / follow the in-ui steps so the app gets a DB and env vars.

### B. Storing DATABASE_URL (or any secret) on Replit

If you use an **external** Postgres (e.g. Neon, Supabase) instead of Replit’s built-in DB:

1. Open **Secrets** from the left Tool dock (or search “Secrets”).
2. **Add a secret:** Key = `DATABASE_URL`, Value = your full connection string, e.g.  
   `postgresql://user:password@host:5432/dbname?sslmode=require`
3. Save. Replit exposes it as `process.env.DATABASE_URL` in your app.

**Useful to ask Replit:**

- *“Where do I set DATABASE_URL for this app?”* → They’ll point you to **Secrets**.
- *“How do I get the connection string for the built-in database?”* → They’ll point you to **Database → Settings** and the env vars listed there.

### C. After DATABASE_URL is set on Replit

1. Push the schema from this repo (Drizzle):  
   In Replit Shell: `npm run db:push`
2. Seed/ingest traders (from your CSVs):  
   `cd pnl_analysis && python run_full_pipeline.py --ingest`  
   (with `BACKEND_URL` pointing at your Replit app URL if the script runs off-Replit).

Then the Replit app will have traders and quality scores in the DB.

---

## 4. Local (e.g. Cursor on Windows)

- Install Postgres and create a database (or use a hosted one).
- In the **project root**, create a **`.env`** file (do not commit):

  ```env
  DATABASE_URL=postgresql://user:password@localhost:5432/predictioninsider
  BACKEND_URL=http://localhost:5000
  ```

- Run `npm run db:push`, then run the ingest pipeline with `--ingest` so the app has data.

---

## 5. Quick Reference Links (Replit)

- **Database (PostgreSQL on Replit):**  
  https://docs.replit.com/cloud-services/storage-and-databases/postgresql-on-replit  
- **Secrets (env vars):**  
  https://docs.replit.com/programming-ide/workspace-features/storing-sensitive-information-environment-variables  
- **Connect app to SQL database:**  
  https://docs.replit.com/getting-started/quickstarts/database-connection  

Replit’s docs say: when you add the Replit Database, it automatically creates **`DATABASE_URL`** (and the other `PG*` vars). So on Replit you often **don’t** need to add `DATABASE_URL` in Secrets — only if you use an external Postgres.

---

## 6. Summary

| Goal | Action |
|------|--------|
| **Use Firecrawl in this project** | Run `npx firecrawl-cli` from the repo; auth is already done. Use `.firecrawl/` for output. |
| **DB on Replit** | Use Replit **Database** tool; use **Secrets** only for external `DATABASE_URL`. Ask Replit: “Add PostgreSQL / show DATABASE_URL.” |
| **DB locally** | Set `DATABASE_URL` in `.env`, run `npm run db:push`, then run the ingest pipeline with `--ingest`. |
