/**
 * Check elite_traders vs elite_trader_profiles overlap (case-insensitive).
 */
import "dotenv/config";
import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const [t, p, overlap] = await Promise.all([
    pool.query("SELECT COUNT(*) as c FROM elite_traders").then(r => r.rows[0].c),
    pool.query("SELECT COUNT(*) as c FROM elite_trader_profiles").then(r => r.rows[0].c),
    pool.query(`
      SELECT COUNT(*) as c FROM elite_traders t
      WHERE EXISTS (SELECT 1 FROM elite_trader_profiles p WHERE LOWER(p.wallet) = LOWER(t.wallet))
    `).then(r => r.rows[0].c),
  ]);
  console.log("elite_traders:", t);
  console.log("elite_trader_profiles:", p);
  console.log("traders with matching profile (LOWER):", overlap);
  const missing = await pool.query(`
    SELECT t.wallet, t.username FROM elite_traders t
    WHERE NOT EXISTS (SELECT 1 FROM elite_trader_profiles p WHERE LOWER(p.wallet) = LOWER(t.wallet))
    ORDER BY t.username
  `);
  console.log("Traders WITHOUT profile:", missing.rows.length);
  missing.rows.forEach(r => console.log("  ", r.username, r.wallet));
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
