/**
 * Paper-log take-book plays to tracked_bets at the live ask. No CLOB order.
 * User can PATCH actual_price with the fill they really got.
 */
import { Pool } from "pg";
import { americanFromPrice } from "./oddsFormat";
import type { AnnotatedTakePlay } from "./takePlays";

const STAKE = 100;

let pool: Pool | null = null;
let schemaReady = false;

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

export function paperIdForTake(signalId: string): string {
  return `take-paper-${signalId}`;
}

async function ensureColumns(db: Pool): Promise<void> {
  if (schemaReady) return;
  await db.query(`
    ALTER TABLE tracked_bets ADD COLUMN IF NOT EXISTS alert_price NUMERIC;
    ALTER TABLE tracked_bets ADD COLUMN IF NOT EXISTS actual_price NUMERIC;
    ALTER TABLE tracked_bets ADD COLUMN IF NOT EXISTS token_id TEXT;
    ALTER TABLE tracked_bets ADD COLUMN IF NOT EXISTS take_cap NUMERIC;
  `);
  schemaReady = true;
}

export async function paperLogTakePlays(
  plays: AnnotatedTakePlay[],
  opts: { paused: boolean },
): Promise<number> {
  const paused = opts.paused;
  const db = getPool();
  if (!db) return 0;
  await ensureColumns(db);
  let inserted = 0;
  for (const p of plays) {
    if (!p.take || !p.valid) continue;
    const ask = p.liveAsk ?? p.takePrice ?? p.currentPrice;
    if (!ask || ask <= 0) continue;
    const id = paperIdForTake(p.id);
    const notes = [
      paused ? "PAUSED — paper only" : "TAKE alert · paper at live ask",
      `Q ${Math.round(p.q)} · ${p.rel.toFixed(1)}× · sport ROI ${p.sportRoi == null ? "n/a" : `${p.sportRoi.toFixed(0)}%`}`,
      `traders ${p.traders.join(", ") || "—"}`,
      `VWAP ${p.avgEntryPrice.toFixed(3)} · take cap ${p.takeCap.toFixed(3)} · ask ${ask.toFixed(3)}`,
      "Edit actual fill in My Bets if you paid a different price.",
    ].join(" · ");
    try {
      const result = await db.query(
        `INSERT INTO tracked_bets
           (id, market_question, outcome_label, side, condition_id, slug, entry_price,
            bet_amount, bet_date, status, notes, book, american_odds, polymarket_price, sport,
            alert_price, actual_price, token_id, take_cap)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,'paper',$11,$12,$13,$14,NULL,$15,$16)
         ON CONFLICT (id) DO UPDATE SET
           polymarket_price = EXCLUDED.polymarket_price,
           take_cap = EXCLUDED.take_cap
           WHERE tracked_bets.actual_price IS NULL AND tracked_bets.status = 'open'`,
        [
          id,
          p.marketQuestion,
          p.playLabel,
          p.side,
          p.conditionId ?? null,
          p.slug ?? null,
          ask,
          STAKE,
          Date.now(),
          notes,
          americanFromPrice(ask),
          ask,
          p.sport ?? null,
          ask,
          p.tokenId ?? null,
          p.takeCap,
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

/** Cancel paper tickets that never got a real fill. Keep rows the user actually took. */
export async function cancelUnfilledTake(paperId: string, reason: string): Promise<boolean> {
  const db = getPool();
  if (!db) return false;
  await ensureColumns(db);
  try {
    const result = await db.query(
      `UPDATE tracked_bets SET
         status = 'cancelled',
         notes = CONCAT(COALESCE(notes, ''), ' · INVALID: ', $2)
       WHERE id = $1 AND status = 'open' AND actual_price IS NULL`,
      [paperId, reason],
    );
    return (result.rowCount ?? 0) > 0;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[paper-take] cancel failed for ${paperId}: ${msg}`);
    return false;
  }
}
