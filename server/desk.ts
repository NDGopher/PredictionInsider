/**
 * Desk payload: current TAKE/NEAR/SKIP + 30d would-have + roster actions.
 * Reads pipeline artifacts only. Never invents fills or PnL.
 */
import fs from "fs";
import path from "path";
import type { DeskResponse } from "@shared/schema";

interface JsonMap {
  [key: string]: unknown;
}

function loadJson(rel: string): JsonMap | null {
  const p = path.join(process.cwd(), rel);
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as JsonMap;
  } catch (err) {
    console.error(`[desk] failed to read ${rel}:`, err);
    return null;
  }
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function englishFromRow(username: unknown, wallet: unknown, display?: unknown): string {
  if (typeof display === "string" && display.trim()) return display;
  const user = String(username || "");
  const w = String(wallet || "").toLowerCase();
  const known: Record<string, string> = {
    "0xec981ed70ae69c5cbcac08c1ba063e734f6bafcd": "Heavy888",
    "0x8a3ab8120807bd64a3de48695110e390fa2ceb9a": "8a3a",
    "0x5966db1fe50763c9e3c014d756369bad07e1f804": "5966",
    "0x20d6436849f930584892730c7f96ebb2ac763856": "20D6",
    "0xe30e74595517de48f1fb19f4553dd3d9f1e96b87": "E30E",
    "0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8": "HVAB",
  };
  if (w && known[w]) return known[w];
  if (/^0x[a-fA-F0-9]{10,}/.test(user)) {
    return `Book ${user.replace(/^0x/i, "").slice(0, 4)}`;
  }
  return user || (w ? `Book ${w.replace(/^0x/, "").slice(0, 4)}` : "Book");
}

export function loadDeskPayload(now: {
  take: number;
  near: number;
  skip: number;
  paused: boolean;
  pauseReason: string | null;
}): DeskResponse {
  const would = loadJson("pnl_analysis/output/would_have_30d.json") || {};
  const uni = loadJson("pnl_analysis/output/copy_universe.json") || {};
  const extraRaw = loadJson("pnl_analysis/extra_traders.json");
  const extraList = Array.isArray(extraRaw) ? extraRaw : [];
  const extraByWallet = new Map<string, JsonMap>();
  for (const row of extraList) {
    if (!row || typeof row !== "object") continue;
    const rec = row as JsonMap;
    extraByWallet.set(String(rec.wallet || "").toLowerCase(), rec);
  }
  const promo = loadJson("pnl_analysis/output/auto_promote_log.json") || {};
  const health = loadJson("pnl_analysis/output/take_health.json") || {};

  const bookIn = (would.book && typeof would.book === "object") ? would.book as JsonMap : {};
  const traders = Array.isArray(uni.traders) ? (uni.traders as JsonMap[]) : [];
  const roster = traders
    .filter((t) => ["live", "bench", "watch", "scout"].includes(String(t.bucket || "")))
    .map((t) => {
      const wallet = String(t.wallet || "");
      const extra = extraByWallet.get(wallet.toLowerCase()) || {};
      return {
        username: String(t.username || ""),
        wallet,
        displayName: englishFromRow(t.username, wallet, t.display_name),
        bucket: String(t.bucket || ""),
        extraStatus: extra.status != null ? String(extra.status) : (t.extra_status != null ? String(t.extra_status) : null),
        joinable: Boolean(t.joinable),
        recency: t.recency != null ? String(t.recency) : undefined,
        winRate: num(t.win_rate),
        uniqueRoi: num(t.unique_roi),
        last30n: num(t.last_30d_n),
        last30Roi: num(t.last_30d_roi),
        whyTail: String(t.why_tail || extra.why_tail || extra.auto_promote_reason || ""),
        reasons: Array.isArray(t.reasons) ? t.reasons.map(String) : [],
        promoteReason: extra.auto_promote_reason != null ? String(extra.auto_promote_reason) : null,
        demoteReason: extra.auto_demote_reason != null ? String(extra.auto_demote_reason) : (extra.bench_reason != null ? String(extra.bench_reason) : null),
        pathB: Boolean(t.path_b),
      };
    });

  const wouldHave = (Array.isArray(would.by_trader) ? would.by_trader as JsonMap[] : []).map((t) => {
    const curveRaw = Array.isArray(t.equity_curve) ? (t.equity_curve as JsonMap[]) : [];
    return {
      username: String(t.username || ""),
      wallet: t.wallet != null ? String(t.wallet) : undefined,
      displayName: englishFromRow(t.username, t.wallet, t.display_name),
      n: num(t.n) || 0,
      winRate: num(t.win_rate),
      roi2c: num(t.roi_2c),
      pnl2c: num(t.pnl_2c),
      maxDd: num(t.max_dd),
      equityEnd: num(t.equity_end),
      last: t.last != null ? String(t.last) : null,
      equityCurve: curveRaw.map((p) => ({
        t: String(p.end || p.t || ""),
        equity: num(p.equity) || 0,
        pnl: num(p.pnl_2c ?? p.pnl) ?? undefined,
      })),
    };
  });

  const plays = (Array.isArray(would.plays) ? would.plays as JsonMap[] : []).map((p) => ({
    end: String(p.end || ""),
    username: p.username != null ? String(p.username) : undefined,
    displayName: englishFromRow(p.username, p.wallet, p.display_name),
    play: String(p.play || ""),
    won: Boolean(p.won),
    fill: num(p.fill) ?? undefined,
    pnl_2c: num(p.pnl_2c) || 0,
    equity: num(p.equity) ?? undefined,
  }));

  const equityCurve = (Array.isArray(would.equity_curve) ? would.equity_curve as JsonMap[] : []).map((p) => ({
    t: String(p.t || p.end || ""),
    equity: num(p.equity) || 0,
    pnl: num(p.pnl) ?? undefined,
  }));

  const mapAction = (rows: unknown): DeskResponse["actions"]["promoted"] =>
    (Array.isArray(rows) ? rows as JsonMap[] : []).map((r) => ({
      username: r.username != null ? String(r.username) : undefined,
      displayName: englishFromRow(r.username, r.wallet, r.display_name),
      wallet: r.wallet != null ? String(r.wallet) : undefined,
      action: r.action != null ? String(r.action) : undefined,
      why: r.why != null ? String(r.why) : undefined,
    }));

  const blocked = (Array.isArray(would.blocked) ? would.blocked as JsonMap[] : []).map((b) => ({
    username: b.username != null ? String(b.username) : undefined,
    displayName: englishFromRow(b.username, b.wallet, b.display_name),
    why: String(b.why || "no tape"),
  }));

  const diagnoseBits: string[] = [];
  if (now.take === 0) {
    diagnoseBits.push("TAKE is empty — the live rule (Q≥60, sport ROI≥5%, 2× size, 10–88¢, no NFL) has no fillable ticket right now.");
  }
  if (now.near === 0 && now.take === 0) {
    diagnoseBits.push("NEAR is also empty. Closest misses should appear from the open-book scan (take_health) or the signals cache.");
  }
  const csvLive = Array.isArray(health.live_open) ? health.live_open.length : 0;
  const csvNear = Array.isArray(health.near_open) ? health.near_open.length : 0;
  if (now.take === 0 && csvLive === 0 && csvNear > 0) {
    diagnoseBits.push(`CSV open scan has ${csvNear} NEAR and 0 TAKE — diagnose is still true: gates are strict, empty TAKE is honest.`);
  }
  if (would.blocked_reason) {
    diagnoseBits.push(String(would.blocked_reason));
  }

  const stillBlocked: string[] = [];
  if (!would.generated_at) {
    stillBlocked.push("30d would-have JSON is missing — run npm run backtest:would-have after CSVs exist.");
  }
  if (would.blocked_reason) {
    stillBlocked.push(String(would.blocked_reason));
  }
  if (now.take === 0 && csvLive === 0) {
    stillBlocked.push("TAKE/NEAR diagnose: 0 live TAKEs on the open scan. Not a UI bug — the rule has no fillable sports ticket.");
  }
  stillBlocked.push("PTA (PolymarketTraderAnalyst) is paused and was not touched.");
  stillBlocked.push("SharpMoney is a separate live MM and was not changed.");

  return {
    generatedAt: would.generated_at != null ? String(would.generated_at) : (uni.generated_at != null ? String(uni.generated_at) : null),
    asOf: would.as_of != null ? String(would.as_of) : (health.as_of != null ? String(health.as_of) : null),
    invented: Boolean(would.invented) === true ? true : false,
    blockedReason: would.blocked_reason != null ? String(would.blocked_reason) : null,
    howToRead: String(
      would.how_to_read
      || "n is tickets the live take rule would have taken in the last 30d of resolved unique-book tape. ROI/PnL are unit $100 at VWAP+2¢. Blocked names have no honest tape.",
    ),
    promoteHow: String(
      promo.method
      || "Promote when joinable + HOT/WARM + (unique ROI≥5% or Path-B elite or equity turnaround). Demote on take bleed or 90d stale. Not vibes.",
    ),
    takeNearDiagnose: diagnoseBits.join(" ") || "TAKE/NEAR classification is live.",
    stillBlocked,
    book: {
      n: num(bookIn.n) || 0,
      winRate: num(bookIn.win_rate),
      roi2c: num(bookIn.roi),
      pnl2c: num(bookIn.unit_pnl),
    },
    now,
    roster,
    wouldHave,
    plays,
    equityCurve,
    actions: {
      promoted: mapAction(promo.promoted),
      demoted: mapAction(promo.demoted),
      benched: mapAction(promo.benched),
      scoutsAdded: mapAction(promo.scouts_added),
    },
    blockedTraders: blocked,
  };
}
