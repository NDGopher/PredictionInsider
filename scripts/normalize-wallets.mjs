/**
 * One-off: set wallet to lowercase in elite_traders and elite_trader_profiles
 * so JOINs match regardless of case (fixes "Analysis pending" for ingested traders).
 */
import "dotenv/config";
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const client = await pool.connect();
  try {
    const r1 = await client.query(
      `UPDATE elite_trader_profiles SET wallet = LOWER(wallet) WHERE wallet != LOWER(wallet)`
    );
    const r2 = await client.query(
      `UPDATE elite_traders SET wallet = LOWER(wallet) WHERE wallet != LOWER(wallet)`
    );
    console.log("elite_trader_profiles normalized:", r1.rowCount);
    console.log("elite_traders normalized:", r2.rowCount);
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
