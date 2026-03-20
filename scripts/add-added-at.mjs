#!/usr/bin/env node
/** One-off: add missing columns to elite_traders (Neon already has table). */
import "dotenv/config";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'elite_traders' AND column_name = 'added_at') THEN
        ALTER TABLE elite_traders ADD COLUMN added_at TIMESTAMPTZ DEFAULT NOW();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'elite_traders' AND column_name = 'notes') THEN
        ALTER TABLE elite_traders ADD COLUMN notes TEXT;
      END IF;
    END $$;
  `);
  console.log("OK: elite_traders missing columns added (or already present).");
} catch (err) {
  console.error("Error:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
