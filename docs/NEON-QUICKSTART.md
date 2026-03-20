# Neon: Where to Put Your Connection String

You only need to put your Neon connection string in **one place**.

---

## 1. Get the connection string from Neon

1. Go to [console.neon.tech](https://console.neon.tech) and open your project.
2. On the project dashboard you’ll see **Connection string** (or go to **Connection details**).
3. Choose **URI** or **Connection string** and copy the full URL. It looks like:
   ```text
   postgresql://myuser:AbCdEf123@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. Copy the **entire** string (it’s a secret — don’t paste it in chat, email, or any file you commit).

---

## 2. Put it in your project’s `.env` file

1. Open your project folder **PredictionInsider** (the same folder as `package.json`).
2. Open the file named **`.env`** (if it doesn’t exist, copy `.env.example` and rename the copy to `.env`).
3. Find the line that starts with **`DATABASE_URL=`**.
4. Replace the value with your Neon connection string. The line should look **exactly** like this (but with your real URL):
   ```env
   DATABASE_URL=postgresql://myuser:password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
   ```
5. Save the file.

**That’s it.** The app reads `DATABASE_URL` from `.env` when you run `npm run dev` or the ingest pipeline.

---

## 3. Make sure the database has tables

If this is a **new** Neon project, create the tables once:

1. In Neon: open your project → **SQL Editor**.
2. Open the file **`scripts/init-db.sql`** in your PredictionInsider repo (in the `scripts` folder).
3. Copy its **entire** contents and paste into the Neon SQL Editor.
4. Click **Run**. You should see success messages.

---

## 4. Run the app

```bash
npm run dev
```

Then in another terminal, run the ingest so traders and scores load:

```bash
cd pnl_analysis
python run_full_pipeline.py --ingest
```

---

## Don’t

- Don’t paste your real `DATABASE_URL` in chat, Discord, or email.
- Don’t commit `.env` to Git (it’s already in `.gitignore`).
- Don’t put the connection string in any file except `.env` in the project root.

## Do

- Keep `.env` only on your machine (and on any server you deploy to, via that server’s secrets/env).
- If you need help, say “I put my Neon URL in .env as DATABASE_URL” — you don’t need to send the actual URL.
