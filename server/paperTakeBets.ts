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
    ALTER TABLE tracked_bets ADD COLUMN IF NOT EXISTS close_price NUMERIC;
    ALTER TABLE tracked_bets ADD COLUMN IF NOT EXISTS event_start_ms BIGINT;
    ALTER TABLE tracked_bets ADD COLUMN IF NOT EXISTS kickoff_sent BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE tracked_bets ADD COLUMN IF NOT EXISTS user_id TEXT;
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

export interface FollowedTake {
  id: string;
  marketQuestion: string;
  playLabel: string;
  side: string;
  slug: string | null;
  conditionId: string | null;
  tokenId: string | null;
  alertPrice: number;
  actualPrice: number | null;
  closePrice: number | null;
  takeCap: number | null;
  eventStartMs: number | null;
  kickoffSent: boolean;
  betAmount: number;
  sport: string | null;
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export async function listFollowedTakes(): Promise<FollowedTake[]> {
  const db = getPool();
  if (!db) return [];
  await ensureColumns(db);
  const { rows } = await db.query(
    `SELECT id, market_question, outcome_label, side, slug, condition_id, token_id,
            alert_price, actual_price, close_price, take_cap, event_start_ms,
            kickoff_sent, bet_amount, sport, entry_price
     FROM tracked_bets
     WHERE status = 'open' AND id LIKE 'take-paper-%'
     ORDER BY bet_date ASC`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    marketQuestion: String(r.market_question || ""),
    playLabel: String(r.outcome_label || r.market_question || ""),
    side: String(r.side || "YES"),
    slug: r.slug ? String(r.slug) : null,
    conditionId: r.condition_id ? String(r.condition_id) : null,
    tokenId: r.token_id ? String(r.token_id) : null,
    alertPrice: numOrNull(r.alert_price) ?? numOrNull(r.entry_price) ?? 0,
    actualPrice: numOrNull(r.actual_price),
    closePrice: numOrNull(r.close_price),
    takeCap: numOrNull(r.take_cap),
    eventStartMs: r.event_start_ms != null ? Number(r.event_start_ms) : null,
    kickoffSent: Boolean(r.kickoff_sent),
    betAmount: numOrNull(r.bet_amount) ?? 100,
    sport: r.sport ? String(r.sport) : null,
  }));
}

export async function markKickoff(
  id: string,
  closePrice: number,
  eventStartMs: number | null,
): Promise<void> {
  const db = getPool();
  if (!db) return;
  await ensureColumns(db);
  await db.query(
    `UPDATE tracked_bets SET
       close_price = $2,
       event_start_ms = COALESCE($3, event_start_ms),
       kickoff_sent = TRUE
     WHERE id = $1`,
    [id, closePrice, eventStartMs],
  );
}

export interface TakeTapeRow {
  id: string;
  playLabel: string;
  status: string;
  alertPrice: number;
  closePrice: number | null;
  pnl: number | null;
  sport: string | null;
  kickoffSent: boolean;
  betDate: number | null;
  resolvedDate: number | null;
}

export async function listTakeTape(): Promise<{ open: TakeTapeRow[]; recent: TakeTapeRow[] }> {
  const db = getPool();
  if (!db) return { open: [], recent: [] };
  await ensureColumns(db);
  try {
    const { rows } = await db.query(
      `SELECT id, outcome_label, market_question, status, alert_price, entry_price,
              close_price, pnl, sport, kickoff_sent, bet_date, resolved_date
       FROM tracked_bets
       WHERE id LIKE 'take-paper-%'
       ORDER BY COALESCE(resolved_date, bet_date) DESC NULLS LAST
       LIMIT 40`,
    );
    const mapped: TakeTapeRow[] = rows.map((r) => ({
      id: String(r.id),
      playLabel: String(r.outcome_label || r.market_question || ""),
      status: String(r.status || "open"),
      alertPrice: numOrNull(r.alert_price) ?? numOrNull(r.entry_price) ?? 0,
      closePrice: numOrNull(r.close_price),
      pnl: numOrNull(r.pnl),
      sport: r.sport ? String(r.sport) : null,
      kickoffSent: Boolean(r.kickoff_sent),
      betDate: r.bet_date != null ? Number(r.bet_date) : null,
      resolvedDate: r.resolved_date != null ? Number(r.resolved_date) : null,
    }));
    return {
      open: mapped.filter((r) => r.status === "open"),
      recent: mapped.filter((r) => r.status !== "open").slice(0, 15),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[paper-take] list tape: ${msg}`);
    return { open: [], recent: [] };
  }
}

export async function markSettled(
  id: string,
  opts: { won: boolean; resolvedPrice: number; pnl: number },
): Promise<void> {
  const db = getPool();
  if (!db) return;
  await ensureColumns(db);
  await db.query(
    `UPDATE tracked_bets SET
       status = $2,
       resolved_price = $3,
       resolved_date = $4,
       pnl = $5
     WHERE id = $1 AND status = 'open'`,
    [id, opts.won ? "won" : "lost", opts.resolvedPrice, Date.now(), opts.pnl],
  );
}
