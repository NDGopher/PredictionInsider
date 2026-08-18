/**
 * Paper-log take-book plays to tracked_bets. No CLOB / no auto-bet.
 */
import { Pool } from "pg";
import type { AnnotatedTakePlay } from "./takePlays";

const STAKE = 100;

let pool: Pool | null = null;

function getPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      connectionTimeoutMillis: 15000,
      statement_timeout: 15000,
    });
  }
  return pool;
}

export async function paperLogTakePlays(
  plays: AnnotatedTakePlay[],
  *,
  paused: boolean,
): Promise<number> {
  const db = getPool();
  if (!db) return 0;
  let inserted = 0;
  for (const p of plays) {
    if (!p.take) continue;
    const id = `take-paper-${p.id}`;
    const notes = [
      paused ? "PAUSED — paper only, do not fill live" : "TAKE BOOK paper ticket",
      `Q ${Math.round(p.q)} · ${p.rel.toFixed(1)}× · sport ROI ${p.sportRoi == null ? "n/a" : `${p.sportRoi.toFixed(0)}%`}`,
      `traders ${p.traders.join(", ") || "—"}`,
      `their ${Math.round(p.avgEntryPrice * 100)}¢ · live ${Math.round(p.currentPrice * 100)}¢ · fill ≤ ${Math.round(p.fillPlus2c * 100)}¢`,
      "Human fill $100 · hold to res · no auto-bet",
    ].join(" · ");
    try {
      const result = await db.query(
        `INSERT INTO tracked_bets
           (id, market_question, outcome_label, side, slug, entry_price,
            bet_amount, bet_date, status, notes, book, polymarket_price, sport)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,'paper',$10,$11)
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          p.marketQuestion,
          p.playLabel,
          p.side,
          p.slug ?? null,
          p.fillPlus2c,
          STAKE,
          Date.now(),
          notes,
          p.currentPrice,
          p.sport ?? null,
        ],
      );
      inserted += result.rowCount ?? 0;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[paper-take] insert failed for ${id}: ${msg}`);
    }
  }
  return inserted;
}
