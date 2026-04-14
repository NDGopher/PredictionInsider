/**
 * Drizzle Kit config. NOTE: shared/schema.ts is Zod-only (API shapes), not Drizzle pgTable defs.
 * `drizzle-kit push` can propose DROPPING elite_* tables created by init-db.sql - do not confirm that.
 * Normal local refresh: use `npm run db:init` only (idempotent CREATE IF NOT EXISTS).
 */
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
