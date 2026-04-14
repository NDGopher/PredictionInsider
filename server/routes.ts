import type { Express } from "express";
import { createServer, type Server } from "http";
import { Pool } from "pg";
import {
  seedCuratedTraders, startPeriodicRefresh, startCanonicalPNLRefresh, runAnalysisForTrader,
  resolveUsernameToWallet, generateTraderCSV, curatedWalletSet, curatedWalletToUsername,
  settleUnresolvedTrades, fetchFullTradeHistory, computeTraderProfile,
  settleAllUnresolvedTradesGlobal, fetchAllActivity, computeTraderProfileFromActivity,
  CURATED_TRADERS, DISCOVERED_ELITES, KNOWN_ALIASES, MARKET_MAKER_WALLETS, TRADER_CATEGORY_FILTERS, getEffectiveCategoryFilter, classifySport, classifySportFull, patchProfileWithCanonicalPNL, fetchCanonicalPNL,
  runCanonicalPNLRefreshForAll, computeMarketOFI, syncTraderPositions,
  runDailyRefreshForCurated, scheduleDailyRefresh, getDailyRefreshState
} from "./eliteAnalysis";

const elitePool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 25000,
  statement_timeout: 30000,
});

const GAMMA_API   = "https://gamma-api.polymarket.com";
const DATA_API    = "https://data-api.polymarket.com";
const CLOB_API    = "https://clob.polymarket.com";
const SUBGRAPH_URL =
  "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn";

// ─── Cache ────────────────────────────────────────────────────────────────────
const cache: Record<string, { data: unknown; ts: number; ttl: number }> = {};
function getCache<T>(key: string): T | null {
  const e = cache[key];
  if (!e || Date.now() - e.ts > e.ttl) return null;
  return e.data as T;
}
function setCache(key: string, data: unknown, ttlMs: number) {
  cache[key] = { data, ts: Date.now(), ttl: ttlMs };
}
/** Drop elite signals cache so the next GET /api/signals recomputes (e.g. after fresh live trades). */
function invalidateEliteSignalsCache() {
  delete cache["signals-elite-v56-vip-premium-sp"];
  delete cache["signals-elite-v56-vip-premium-all"];
}
const seenSignalIds = new Set<string>();

/** pg often throws AggregateError with empty .message — still return a useful client string */
function formatApiError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  const agg = err as AggregateError & { code?: string };
  if (agg?.errors?.length) {
    const parts = agg.errors.map((e: Error) => e?.message || String(e)).filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  const code = typeof err === "object" && err && "code" in err ? String((err as { code?: string }).code) : "";
  if (code === "ECONNREFUSED") {
    return "Cannot connect to PostgreSQL. Start the database (e.g. npm run db:up after Docker Desktop is running), then npm run db:init. Or fix DATABASE_URL in .env.";
  }
  return String(err ?? "unknown error");
}

// ─── American odds helper ─────────────────────────────────────────────────────
function toAmericanOdds(price: number): string {
  const p = Math.max(0.01, Math.min(0.99, price));
  if (p >= 0.5) return `-${Math.round((p / (1 - p)) * 100)}`;
  return `+${Math.round(((1 - p) / p) * 100)}`;
}

// ─── SSE client registry ──────────────────────────────────────────────────────
// Each connected client gets a Response object stored here.
// We broadcast fresh data to all clients whenever our live-alerts cache refreshes.
type SseClient = { res: import("express").Response; channel: string };
const sseClients = new Set<SseClient>();

function broadcastSSE(channel: string, event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) {
    if (c.channel === channel) {
      try { c.res.write(payload); } catch { sseClients.delete(c); }
    }
  }
}

// ─── Game Market Registry ─────────────────────────────────────────────────────
// Shared registry populated by positions-based signal generation.
// Lets the /api/markets route show today's game markets even when they
// don't appear in the Gamma API's top-800 popularity sort.
interface GameMarketEntry {
  question: string; slug?: string; endDate?: string;
  gameStartTime?: string; // Polymarket's actual game start time (UTC ISO)
  currentPrice?: number; volume: number; liquidity: number;
  marketType?: string; gameStatus?: string; active: boolean;
}
const gameMarketRegistry = new Map<string, GameMarketEntry>();

function upsertGameMarket(conditionId: string, entry: GameMarketEntry) {
  const existing = gameMarketRegistry.get(conditionId);
  if (!existing || (entry.currentPrice && !existing.currentPrice)) {
    gameMarketRegistry.set(conditionId, entry);
    // Populate slug→GST cache for categoriseMarket lookups
    if (entry.slug && entry.gameStartTime) {
      gameSlugToGST.set(entry.slug, entry.gameStartTime);
      const bs = entry.slug.match(/^(.+-\d{4}-\d{2}-\d{2})(-|$)/)?.[1];
      if (bs && bs !== entry.slug) gameSlugToGST.set(bs, entry.gameStartTime);
    }
  }
}

// ─── Signal-per-market registry (for /api/markets sharp action overlay) ───────
interface SharpAction {
  side: "YES" | "NO"; confidence: number; traderCount: number;
  totalUsdc: number; isActionable: boolean; bigPlayScore: number;
  avgEntry: number; currentPrice: number; marketCategory?: string;
}
const signalsByMarket = new Map<string, SharpAction>();

// ─── Fetch helpers ────────────────────────────────────────────────────────────
async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: { Accept: "application/json", "User-Agent": "PredictionInsider/3.0", ...(options.headers || {}) },
        signal: AbortSignal.timeout(14000),
      });
      if (res.status === 429) { await sleep(2500 * (i + 1)); continue; }
      return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(1000 * (i + 1));
    }
  }
  throw new Error(`Failed after ${retries} retries`);
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function graphqlQuery(query: string): Promise<any> {
  try {
    const res = await fetchWithRetry(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ─── Sports detection ─────────────────────────────────────────────────────────
const SPORTS_KW = [
  "nfl","nba","mlb","nhl","mls","ncaa","ufc","mma","boxing","tennis","golf","pga",
  "super bowl","world cup","champions league","premier league","bundesliga","la liga",
  "serie a","playoff","championship","stanley cup","finals","semifinal","tournament",
  "wimbledon","us open","australian open","french open","roland garros",
  "f1","formula 1","nascar","olympics","world series","march madness",
  " vs "," vs.","match ","game ","season ","league ","draft ","transfer ",
  "quarterback","pitcher","goalkeeper","mvp","title","winner","beat the",
  "score ","goals ","touchdown","points ","atp","wta","bnp","open ","cup ",
  "super bowl","stanley cup","nba finals","world series","champions league final",
  "college football","college basketball","march madness","ncaab","ncaaf",
  "premier league","efl","fa cup","el classico","derby","grand prix","open championship",
  "masters ","ryder cup","solheim cup","futsal","volleyball","handball","cricket",
  "rugby","ashes","ipl","carabao","euros ","copa ","ligue 1","eredivisie","6 nations",
  "esport","dota 2","dota2","counter-strike","cs2","valorant","league of legends",
  "lol champions","iem ","major ","blast ","esl ","faceit","pgl ","navi ","team liquid",
  "team spirit","team vitality","natus vincere","faze clan","astralis",
];
function isSportsRelated(text: string): boolean {
  const t = (text || "").toLowerCase();
  return SPORTS_KW.some(k => t.includes(k));
}

/** Returns true if a market appears to be postponed, cancelled, or voided */
function isPostponedOrCancelled(question: string, active: boolean, closed: boolean): boolean {
  if (!active || closed) return true;
  const q = (question || "").toLowerCase();
  return /(postponed|cancelled|canceled|suspended|voided|void|abandoned|forfeit|no contest|walkover)/.test(q);
}

// ─── Categorise as Pregame / Live / Futures ───────────────────────────────────

/**
 * Strip market-type suffixes to get the canonical game slug for ESPN lookups.
 * e.g. "nhl-ana-ott-2026-03-14-total-6pt5" → "nhl-ana-ott-2026-03-14"
 *      "epl-che-new-2026-03-14-draw"        → "epl-che-new-2026-03-14"
 *      "nhl-wsh-bos-2026-03-14"             → "nhl-wsh-bos-2026-03-14"
 */
function baseGameSlug(slug: string): string {
  const m = slug.match(/^(.+-\d{4}-\d{2}-\d{2})(-|$)/);
  return m ? m[1] : slug;
}

/**
 * Categorise a market as live / pregame / futures.
 * Uses Polymarket's own `gameStartTime` when available — this is the most accurate method.
 * Falls back to simple endDate heuristics only when gameStartTime is unknown.
 */
function categoriseMarket(question: string, endDate?: string, gameStartTime?: string, slug?: string): "live" | "pregame" | "futures" {
  const q = (question || "").toLowerCase();
  const now = Date.now();

  // Long-horizon futures (season titles, etc.): never "live" from hype words in the title
  // (e.g. "live" inside "Liverpool", or "quarter" inside "quarterback").
  if (endDate && isFuturesMarket(question)) {
    let endMsEarly: number;
    if (/^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())) {
      endMsEarly = new Date(endDate + "T23:59:59Z").getTime();
    } else {
      endMsEarly = new Date(endDate).getTime();
    }
    if (endMsEarly - now > 7 * 24 * 3600_000) return "futures";
  }

  // Definitive live signals from question text (e.g. in-play markets).
  // Use word boundaries: plain "live" matches inside "Liverpool"; "quarter" matches "quarterback"; "lead" matches "leading".
  if (/\b(lead|trailing|winning|losing|currently|live)\b|in-game|halftime|first half|second half|\bquarter\b|overtime|\bperiod\b|\binning\b/.test(q)) return "live";

  // Many O/U / spread markets share a game slug but have a suffix like -total-6pt5.
  // Resolve the base game slug for ESPN cache lookups (ESPN tracks the game, not
  // individual market variants).
  const rawSlug = slug || "";
  const base = rawSlug ? baseGameSlug(rawSlug) : "";

  // Track any sports event slug we see so refreshESPNLiveGames can look them up.
  // sharedMarketDb has CLOB market_slug (e.g. "ducks-vs-senators-ou-6-5"), NOT the
  // event slug (e.g. "nhl-ana-ott-2026-03-14-total-6pt5"), so we must collect slugs here.
  if (rawSlug && /^(nba|nhl|nfl|mlb|ncaab|ncaaf)-/.test(rawSlug)) {
    seenEventSlugs.add(rawSlug);
    if (base && base !== rawSlug) seenEventSlugs.add(base);
  }

  // If this market itself doesn't have gameStartTime, try the slug-keyed GST cache.
  // This covers O/U and spread market variants (e.g. "nhl-ana-ott-2026-03-14-total-6pt5")
  // that share a base game slug ("nhl-ana-ott-2026-03-14") with the moneyline market
  // which DOES have gameStartTime.
  let resolvedGST = gameStartTime;
  if (!resolvedGST) {
    resolvedGST = gameSlugToGST.get(rawSlug) ?? gameSlugToGST.get(base) ?? undefined;
  }

  // ── Priority 1: Polymarket's actual game start time ───────────────────────
  // IMPORTANT: Check gameStartTime BEFORE endDate. Many Polymarket markets use a
  // bare date string for endDate (e.g. "2026-03-14") which JavaScript parses as
  // midnight UTC — making the market look 17+ hours "expired" while the game is
  // actively in progress. gameStartTime is far more reliable.
  if (resolvedGST) {
    const startMs = new Date(resolvedGST).getTime();
    if (now < startMs) return "pregame"; // game hasn't started yet
    // Game has started. Use a 14-hour window (covers OT/long games).
    // Trust ESPN's completed flag as the authoritative "game over" signal.
    const hoursElapsed = (now - startMs) / 3_600_000;
    if (hoursElapsed > 14) {
      // Definitely over — only mark live if ESPN explicitly still has it active
      const espnOverride = espnLiveGames.get(rawSlug) ?? espnLiveGames.get(base);
      if (espnOverride === true) return "live";
      return "pregame";
    }
    // Within 14h of tip-off — live unless ESPN explicitly says completed
    const espnCheck = espnLiveGames.get(rawSlug) ?? espnLiveGames.get(base);
    if (espnCheck === false) return "pregame";
    return "live";
  }

  // ── No gameStartTime: fall back to endDate heuristics ────────────────────
  if (!endDate) return "pregame";

  // Fix: bare date strings like "2026-03-14" parse to midnight UTC which is
  // way before the game starts. Treat them as end-of-day instead (23:59 UTC).
  let endMs: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())) {
    endMs = new Date(endDate + "T23:59:59Z").getTime();
  } else {
    endMs = new Date(endDate).getTime();
  }
  const ms = endMs - now;

  // Market already past its end-of-day — check ESPN cache with generous window
  if (ms < 0) {
    const espnCheck = espnLiveGames.get(rawSlug) ?? espnLiveGames.get(base);
    if (ms > -6 * 3600_000 && espnCheck === true) return "live";
    return "pregame";
  }
  // Far future → futures
  if (ms > 7 * 24 * 3600_000) return "futures";

  // ── Fallback: ESPN background cache ────────────────────────────────────────
  // Check both the exact slug and the base game slug.
  if (rawSlug) {
    const espnLive = espnLiveGames.get(rawSlug) ?? espnLiveGames.get(base);
    if (espnLive === true)  return "live";
    if (espnLive === false) return "pregame";
  }

  return "pregame";
}

// ─── Market type classifiers ─────────────────────────────────────────────────
function isMoneylineMarket(q: string): boolean {
  const t = q.toLowerCase();
  // "Team A vs Team B" with no sub-market modifier
  if (!(t.includes(" vs ") || t.includes(" vs."))) return false;
  // Exclude spread/total markers
  if (/o\/?u\s*[\d.]|total\s*[\d.]|spread|ats|\([+-]\d/.test(t)) return false;
  // Exclude colon that would indicate a sub-market (unless it's "Tournament: P1 vs P2")
  const colonIdx = t.indexOf(":");
  const vsIdx = t.indexOf(" vs");
  if (colonIdx !== -1 && colonIdx > vsIdx) return false; // "Warriors vs Jazz: O/U 225"
  return true;
}

function isSpreadMarket(q: string): boolean {
  return /spread|ats/i.test(q) || /\([+-]\d+\.?\d*\)/.test(q) || /[+-]\d+\.?\d*\s*(pts?|point)/i.test(q);
}

function isTotalMarket(q: string): boolean {
  return /o\/?u\s*[\d.]+/i.test(q) || /total[\s:]+[\d.]+/i.test(q) || /over\/under/i.test(q);
}

function isFuturesMarket(q: string): boolean {
  return /\bwill\b.+\b(win|make|reach|appear|advance|go to|qualify)\b/i.test(q)
    || /\b(season|finals|championship|title|playoffs?|super bowl|nba finals|stanley cup|world series)\b/i.test(q)
    || /\b(who will win|most wins|league winner|conference winner)\b/i.test(q);
}

function classifyMarketType(q: string): "moneyline" | "spread" | "total" | "futures" | "other" {
  if (isTotalMarket(q))     return "total";
  if (isSpreadMarket(q))    return "spread";
  if (isMoneylineMarket(q)) return "moneyline";
  if (isFuturesMarket(q))   return "futures";
  return "other";
}

/** Compute actionability: price is still close enough to avg entry to be worth acting on.
 *  Threshold is proportional to price — low-prob markets move fast in % terms.
 *  - < 30¢ or > 70¢ (mirror): max delta 2¢  (sharp doubled their money = too late)
 *  - 30–70¢ range:             max delta 3¢  */
/**
 * Returns a 3-state price status:
 * "actionable" — current price is within 2-3¢ of sharp avg entry (right price zone)
 * "dip"        — price has fallen BELOW sharp avg entry for YES (or risen above for NO)
 *                = you can enter CHEAPER than what sharps paid — favorable
 * "moved"      — price has moved AGAINST the bet direction (too expensive vs sharp entry)
 */
function computePriceStatus(
  currentPrice: number,
  avgEntry: number,
  side: "YES" | "NO",
  /** In-play prices move every minute — use a tighter band so we stop showing stale “tail this” rows. */
  timing: "live" | "pregame" | "futures" = "pregame",
): "actionable" | "dip" | "moved" {
  if (currentPrice < 0.08 || currentPrice > 0.92) return "moved";
  const refPrice = Math.min(avgEntry, currentPrice);
  const isLive = timing === "live";
  // Live: ~1.2–1.8¢ vs 2–3¢ pregame — odds shift quickly after goals/possession (e.g. O/U 1.5).
  const maxDelta = isLive
    ? (refPrice < 0.30 || refPrice > 0.70 ? 0.012 : 0.018)
    : (refPrice < 0.30 || refPrice > 0.70 ? 0.02 : 0.03);
  const priceDiff = currentPrice - avgEntry; // positive = price went up, negative = price went down

  // Within tolerance → actionable (right at entry price zone)
  if (Math.abs(priceDiff) <= maxDelta) return "actionable";

  // Price DROPPED below avg entry for YES = dip (cheaper than sharps paid)
  if (side === "YES" && priceDiff < -maxDelta) return "dip";
  // Price ROSE above avg entry for NO = dip (cheaper than sharps paid on NO side)
  if (side === "NO"  && priceDiff >  maxDelta) return "dip";

  // Otherwise: price moved against the bet (too expensive)
  return "moved";
}

function computeIsActionable(
  currentPrice: number,
  avgEntry: number,
  side: "YES" | "NO",
  timing: "live" | "pregame" | "futures" = "pregame",
): boolean {
  const status = computePriceStatus(currentPrice, avgEntry, side, timing);
  return status === "actionable" || status === "dip"; // dip = better price than sharps got = still act on it
}

/** Score for "big play": how large is this bet */
function computeBigPlayScore(totalUsdc: number, traderCount: number, relBetSize: number = 1): number {
  const avg = totalUsdc / Math.max(traderCount, 1);
  let base = totalUsdc >= 30_000 || avg >= 15_000 ? 3  // huge
           : totalUsdc >= 10_000 || avg >= 5_000  ? 2  // big
           : totalUsdc >= 3_000  || avg >= 1_500  ? 1  // notable
           : 0;
  // Conviction upgrade: if the trader(s) are betting well above their normal, bump one tier.
  // A $4K bet at 5× normal is a stronger signal than a routine $4K play.
  if (relBetSize >= 5 && base < 3) base = Math.min(base + 2, 3);
  else if (relBetSize >= 3 && base < 3) base = Math.min(base + 1, 3);
  return base;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function truncAddr(addr: string) {
  if (!addr || addr.length < 10) return addr || "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const PRICE_SCALE  = 1_000_000;
const AMOUNT_SCALE = 1_000_000;

/** Trader quality 0–100 with recency-decay weighting.
 *  Traders active in WEEK window get a 1.4x multiplier (hot hand),
 *  MONTH-only gets 1.1x, ALL-only is base. Multi-window appearance adds further.
 */
function traderQualityScore(
  pnl: number, roi: number, positionCount: number,
  windows?: { inAll?: boolean; inWeek?: boolean; inMonth?: boolean },
): number {
  const pnlScore   = Math.min(pnl / 2_000_000, 1) * 100;         // max at $2M PNL
  const roiScore   = Math.min(Math.max(roi, 0) / 60, 1) * 100;   // max at 60% ROI
  const countScore = Math.min(positionCount / 15, 1) * 100;       // max at 15 positions
  const base = Math.round(pnlScore * 0.35 + roiScore * 0.45 + countScore * 0.20);
  // Recency multiplier
  let recency = 1.0;
  if (windows?.inWeek && windows?.inMonth) recency = 1.5;   // dominant right now
  else if (windows?.inWeek) recency = 1.40;                  // hot this week
  else if (windows?.inMonth) recency = 1.10;                 // recent form
  // else all-time only — no boost (may be cold)
  return Math.min(Math.round(base * recency), 100);
}

/**
 * Tiered confidence formula with explicit breakdown.
 * Returns { total, breakdown: { roiPct, consensusPct, valuePct, sizePct, tierBonus } }
 *
 * counterTraderCount: number of tracked traders on the OPPOSITE side — reduces consensus score.
 * Each counter trader reduces the effective consensus by 20 points (max -40), so a "100% consensus"
 * signal with 2 counter traders effectively becomes 60% consensus before scoring.
 */
function computeConfidence(
  avgROI: number,
  consensusPct: number,
  valueDelta: number,
  avgNetUsdc: number,
  traderCount: number,
  avgQuality: number,
  counterTraderCount: number = 0,
  relBetSize: number = 1,           // how many × normal bet size this play is (conviction multiplier)
): { score: number; breakdown: Record<string, number> } {
  // ROI scale: 25% ROI = full 40 pts. Reflects real sports betting alpha distribution.
  // (was 60 — made 11% ROI look like ~7/40 despite being elite-tier performance)
  const roiPct = Math.round(Math.min(Math.max(avgROI / 25, 0), 1) * 100 * 0.40);

  // Counter-trader penalty: each tracked trader on opposite side reduces conviction
  const counterPenalty = counterTraderCount > 0 ? Math.min(counterTraderCount * 20, 40) : 0;
  const adjustedConsPct = Math.max(0, consensusPct - counterPenalty);
  // Single-trader consensus: only half weight (15 pts max) — one trader ≠ real consensus.
  // Multi-trader consensus earns full 30 pts.
  const consWeight = traderCount === 1 ? 0.15 : 0.30;
  const consPct = Math.round(Math.min(Math.max(adjustedConsPct - 50, 0) / 50, 1) * 100 * consWeight);

  // Value edge: continuous gradient from -5c (0 pts) through entry (10 pts) to +5c (20 pts).
  // Old binary cliff (negative = 0) penalised slightly-stale entries unfairly.
  const valuePct = Math.round(Math.min(Math.max((valueDelta + 0.05) / 0.10, 0), 1) * 100 * 0.20);
  const sizePct  = Math.round(Math.min(avgNetUsdc / 15_000, 1) * 100 * 0.10);

  // Relative bet size bonus (0–15 pts): the core conviction signal.
  // When a sharp bets 3x+ their normal, they have unusually high conviction — weight it heavily.
  // <2x = 0 (routine), 2x = 4pts, 3-4x = 7pts, 5-6x = 10pts, 7-9x = 13pts, 10x+ = 15pts
  const relSizePts = relBetSize >= 10 ? 15
                   : relBetSize >= 7  ? 13
                   : relBetSize >= 5  ? 10
                   : relBetSize >= 3  ? 7
                   : relBetSize >= 2  ? 4
                   : 0;

  // Tier bonus: more qualified traders = higher ceiling
  const tierBonus = traderCount >= 3 && avgQuality >= 50 ? 8
                  : traderCount >= 2 ? 4
                  : avgQuality >= 75 ? 3
                  : 0;
  // S-Tier visibility: boost confidence so high-quality (70+) signals rank above the crowd
  const qualityBoost = avgQuality >= 80 ? 6 : avgQuality >= 70 ? 4 : avgQuality >= 55 ? 2 : 0;

  const base = roiPct + consPct + valuePct + sizePct + relSizePts + qualityBoost;
  // Single-trader cap: dynamically raised when the trader is betting well above their normal.
  // A curated elite betting 5x their norm at 50¢ with no opposition deserves a high score.
  // After computeConfidence, the curated-elite post-hoc boost adds +8 per elite on top.
  const singleCap = relBetSize >= 5 ? 82
                  : relBetSize >= 3 ? 76
                  : relBetSize >= 2 ? 72
                  : 68;
  const score = traderCount === 1 ? Math.min(base + tierBonus, singleCap) : Math.min(base + tierBonus, 100);

  return {
    score: Math.max(score, 5),
    breakdown: { roiPct, consensusPct: consPct, valuePct, sizePct, relSizePts, tierBonus, qualityBoost },
  };
}

// ─── Canonical metrics loader ─────────────────────────────────────────────────
// Loads canonical DB metrics (roiBySport, overallROI, closedPositionCount, winRate)
// for all curated elite traders. Used by signal scoring for sport-specific ROI.
type CanonicalEntry = {
  overallROI: number;
  roiCapital: number;
  winRate: number;
  totalTrades: number;
  qualityScore: number;
  tags: string[];
  roiBySport: Record<string, { roi: number; tradeCount: number; winRate: number | null; avgBet: number; medianBet?: number; avgPositionSize?: number; medianPositionSize?: number }>;
  roiByMarketType: Record<string, { roi: number; tradeCount: number; winRate: number; avgBet?: number; medianBet?: number; avgPositionSize?: number; medianPositionSize?: number }>;
  // Per sport×marketType deep table — key: "NBA|moneyline", "Soccer|total", etc.
  roiBySportMarketType: Record<string, { roi: number; tradeCount: number; winRate: number; avgBet: number; medianBet: number; avgPositionSize?: number; medianPositionSize?: number }>;
  // Per price bucket — key: "Flip (40-60c)", "Underdog (20-40c)", etc.
  priceStats: Record<string, { roi: number; winRate: number; events: number }>;
  /** Account-wide median / avg stake from canonical closed-positions (metrics.medianBetSize / avgBetSize) */
  medianBetUSDC?: number;
  avgBetUSDC?: number;
  /**
   * Canonical PNL: per-sport buckets with `sizes` = total USDC invested **per event/game**
   * (moneyline+spread+O/U netted to one game), NOT per individual fill. Used so "normal" matches
   * whale reality (50×$50 adds to one position → one event size ~$2500).
   */
  closedByCategory?: Record<string, { sizes?: number[]; invested?: number; positions?: number }>;
};

function medianNumeric(values: number[]): number {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** p75 of positive values — median of event stakes often sits at tiny "probe" sizes while p75 tracks real conviction. */
function percentileNumeric(values: number[], p: number): number {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const idx = Math.min(v.length - 1, Math.max(0, Math.floor((v.length - 1) * p)));
  return v[idx]!;
}

/** Primary ordering for signal feeds: quality × confidence, then confidence. */
function compareSignalsQualityConfidence(a: { avgQuality?: number; confidence?: number }, b: { avgQuality?: number; confidence?: number }): number {
  const qa = (a.avgQuality ?? 0) * (a.confidence ?? 0);
  const qb = (b.avgQuality ?? 0) * (b.confidence ?? 0);
  if (qb !== qa) return qb - qa;
  return (b.confidence ?? 0) - (a.confidence ?? 0);
}

/** Pull median/avg position from a sport or sport×market bucket (CSV + canonical shapes). */
function bucketMed(x: { medianPositionSize?: number; medianBet?: number; avgPositionSize?: number; avgBet?: number } | undefined): number {
  if (!x) return 0;
  return (x.medianPositionSize ?? x.medianBet ?? 0) || 0;
}
function bucketAvg(x: { medianPositionSize?: number; medianBet?: number; avgPositionSize?: number; avgBet?: number } | undefined): number {
  if (!x) return 0;
  return (x.avgPositionSize ?? x.avgBet ?? 0) || 0;
}

/**
 * Baseline "normal" stake for rel-bet (×) scoring.
 * Prefer **event-level** stake from `closedByCategory.sizes` (canonical: total invested per game).
 * CSV sport×market medians can reflect **per-trade** fills ($50) — too small vs total position.
 * Sport-level: max(median,p75) on `closedByCategory.sizes`, then floor with **account** medianBetUSDC
 * so "× normal" is never vs a tiny bucket when the trader’s true typical stake is much larger.
 */
type SportBucket = NonNullable<CanonicalEntry["roiBySport"][string]>;
type SportMktBucket = NonNullable<CanonicalEntry["roiBySportMarketType"][string]>;

function effectiveNormalPositionUsd(
  cm: CanonicalEntry | undefined,
  smEntry: SportMktBucket | undefined,
  sEntry: SportBucket | undefined,
  fallbackSignalAvg: number,
  sportDetailed: string,
  sport: string,
): number {
  let n = 0;
  if (smEntry && bucketMed(smEntry) > 0) n = bucketMed(smEntry);
  else if (sEntry && bucketMed(sEntry) > 0) n = bucketMed(sEntry);
  else if (sEntry && bucketAvg(sEntry) > 0) n = bucketAvg(sEntry);
  else if (smEntry && bucketAvg(smEntry) > 0) n = bucketAvg(smEntry);

  const bucket = smEntry && bucketMed(smEntry) > 0 ? smEntry : sEntry;
  const med = bucket ? bucketMed(bucket) : 0;
  const avg = bucket ? bucketAvg(bucket) : 0;
  if (med > 0 && avg > 0 && avg >= med * 2.5) {
    n = Math.max(n, Math.round(Math.sqrt(med * avg)));
  }
  // Authoritative: distribution of **event** stakes in this sport (canonical closed positions).
  const bc = cm?.closedByCategory;
  if (bc) {
    const cat = bc[sportDetailed] ?? bc[sport];
    const sizes = cat?.sizes;
    if (Array.isArray(sizes) && sizes.length > 0) {
      const medEv = medianNumeric(sizes);
      const p75Ev = sizes.length >= 5 ? percentileNumeric(sizes, 0.75) : medEv;
      // Use max(med,p75): whales often have a mass of small events — median alone understates "normal" conviction.
      const dist = Math.max(medEv, p75Ev);
      if (dist > 0) n = Math.max(n, dist);
    }
  }
  // Account-wide typical stake — hard floor so we never divide by a $50 bucket when the trader's true median is $3k+.
  const accountMed = cm?.medianBetUSDC ?? 0;
  const accountAvg = cm?.avgBetUSDC ?? 0;
  if (accountMed > 0) {
    n = Math.max(n, accountMed);
  } else if (accountAvg > 0) {
    n = Math.max(n, accountAvg * 0.5);
  }
  if (n <= 0) n = Math.max(fallbackSignalAvg, 1);
  return n;
}

/** Rank open positions by USDC at risk vs lane-normal stake (outsized conviction first). */
function positionRelVsNormal(
  pm: { mInfo: any; costBasis: number },
  cm: CanonicalEntry | undefined,
): number {
  const mInfo = pm.mInfo;
  const signalSport = classifySport(mInfo.slug || "", mInfo.question || "");
  const signalSportDetailed = classifySportFull(signalSport, mInfo.question || "", mInfo.slug || "");
  const marketCategory = classifyMarketType(mInfo.question || "");
  const smk = `${signalSportDetailed}|${marketCategory}`;
  const psk = `${signalSport}|${marketCategory}`;
  const smEntry = cm?.roiBySportMarketType?.[smk] ?? cm?.roiBySportMarketType?.[psk];
  const sEntry = cm?.roiBySport?.[signalSportDetailed] ?? cm?.roiBySport?.[signalSport];
  const normal = effectiveNormalPositionUsd(cm, smEntry, sEntry, Math.max(pm.costBasis, 1), signalSportDetailed, signalSport);
  return pm.costBasis / Math.max(normal, 1);
}

// ─── VIP premium lane (never miss elite in their specialty + huge stake + near entry) ───
const VIP_PREMIUM_MIN_Q = 72;
const VIP_PREMIUM_MIN_USD_TRADES = 350;
const VIP_PREMIUM_MIN_USD_POS_SOLO = 3500;
const VIP_SPECIALTY_MIN_SMT = 20;
const VIP_SPECIALTY_MIN_SPORT = 20;
const VIP_SPECIALTY_ROI_MIN = 5;
const VIP_HUGE_STAKE_TRADES = 8000;
const VIP_ALT_ROI_FOR_HUGE = 3;
const VIP_HUGE_STAKE_POS = 15000;
/** If ≥ this fraction of USDC on the signal is from VIP-premium traders, relax noisy cluster gates. */
const VIP_DOMINATE_RISK_FRAC = 0.45;

/** Minimum closed trades in a sport or sport×market bucket before we trust lane ROI (all elite roster). */
const ELITE_LANE_SAMPLE_MIN = 12;

/**
 * CSV-derived `roiBySport` can show ROI>100% or ~100% WR (hedge netting, cost quirks).
 * Never use the old `overall >= -5` guard alone — that let impossible lane stats through.
 */
function sportLaneTrustworthy(
  overall: number,
  sportRoi: number,
  sportWr: number,
  sportTradeCount: number,
): boolean {
  if (sportTradeCount < ELITE_LANE_SAMPLE_MIN) return false;
  if (!Number.isFinite(sportRoi) || !Number.isFinite(sportWr)) return false;
  if (sportRoi > 100 || sportWr >= 97) return false;
  if (overall < -5 && (sportRoi > 90 || sportWr > 90)) return false;
  return true;
}

/** Sport or sport×marketType ROI with minimum sample — "great at this lane" for VIP detection. */
function traderSpecialtyLaneROI(
  cm: CanonicalEntry | undefined,
  sportMktKey: string,
  parentSportMktKey: string,
  sportDetailed: string,
  sport: string,
): { roi: number; sampleOk: boolean } {
  if (!cm) return { roi: 0, sampleOk: false };
  const minSmt = ELITE_LANE_SAMPLE_MIN;
  const minSp = ELITE_LANE_SAMPLE_MIN;
  const overall = cm.overallROI ?? 0;
  const smtExact = cm.roiBySportMarketType?.[sportMktKey];
  const smtParent = cm.roiBySportMarketType?.[parentSportMktKey];
  const sSport = cm.roiBySport?.[sportDetailed] ?? cm.roiBySport?.[sport];
  const sParent = cm.roiBySport?.[sport];
  let sportROI =
    (smtExact && smtExact.tradeCount >= minSmt) ? smtExact.roi
    : (smtParent && smtParent.tradeCount >= minSmt) ? smtParent.roi
    : (sSport && sSport.tradeCount >= minSp) ? sSport.roi
    : (sParent && sParent.tradeCount >= minSp) ? sParent.roi
    : overall;
  const sportWR = (sSport?.tradeCount ?? 0) >= minSp ? (sSport?.winRate ?? 0)
    : (sParent?.tradeCount ?? 0) >= minSp ? (sParent?.winRate ?? 0) : 0;
  const sampleOk = !!(
    (smtExact && smtExact.tradeCount >= minSmt)
    || (smtParent && smtParent.tradeCount >= minSmt)
    || (sSport && sSport.tradeCount >= minSp)
    || (sParent && sParent.tradeCount >= minSp)
  );
  if (!sampleOk) return { roi: overall, sampleOk: false };
  if (overall < -5 && (sportROI > 90 || sportWR > 90)) sportROI = overall;
  return { roi: sportROI, sampleOk: true };
}

/** Up/down-weight gate quality using lane ROI vs overall Q (emphasis on specialty). */
function eliteQualityForGate(
  qRaw: number,
  cm: CanonicalEntry | undefined,
  sportMktKey: string,
  parentSportMktKey: string,
  sportDetailed: string,
  sport: string,
): number {
  if (!cm) return qRaw;
  const { roi: laneRoi, sampleOk } = traderSpecialtyLaneROI(cm, sportMktKey, parentSportMktKey, sportDetailed, sport);
  let q = qRaw;
  if (sampleOk) {
    if (laneRoi >= 15) q = Math.max(q, qRaw + 12, 52);
    else if (laneRoi >= 8) q = Math.max(q, qRaw + 8, 48);
    else if (laneRoi >= 4) q = Math.max(q, qRaw + 4, 45);
    else if (laneRoi < -10) q = Math.min(q, Math.max(30, qRaw - 10));
  }
  if ((cm.qualityScore ?? 0) > 0 && q < 40) q = Math.max(q, 40);
  return Math.min(100, q);
}

/** Dollar-weight multiplier: strong lane ROI increases influence vs weak lanes. */
function laneQualityWeightMultiplier(
  cm: CanonicalEntry | undefined,
  sportMktKey: string,
  parentSportMktKey: string,
  sportDetailed: string,
  sport: string,
): number {
  const { roi: laneRoi, sampleOk } = traderSpecialtyLaneROI(cm, sportMktKey, parentSportMktKey, sportDetailed, sport);
  if (!sampleOk) return 1;
  if (laneRoi >= 20) return 1.45;
  if (laneRoi >= 12) return 1.3;
  if (laneRoi >= 6) return 1.15;
  if (laneRoi >= 0) return 1.05;
  if (laneRoi < -12) return 0.72;
  if (laneRoi < -5) return 0.88;
  return 0.95;
}

let _canonicalCache: Map<string, CanonicalEntry> | null = null;
let _canonicalCacheAt = 0; // set to 0 to force reload on first request

async function loadCanonicalMetricsFromDB(): Promise<Map<string, CanonicalEntry>> {
  if (_canonicalCache && Date.now() - _canonicalCacheAt < 10 * 60_000) return _canonicalCache;
  try {
    const { rows } = await elitePool.query(`
      SELECT wallet,
        quality_score,
        tags,
        (CASE
          WHEN NULLIF(TRIM(metrics->>'csvTier'), '') IS NOT NULL
            AND NULLIF(TRIM(metrics->>'csvDirectionalROI'), '') IS NOT NULL
          THEN NULLIF(metrics->>'csvDirectionalROI','')::float
          WHEN (metrics->>'rawRealizedPnl') IS NOT NULL AND (metrics->>'rawRealizedPnl') <> ''
            AND COALESCE(NULLIF(metrics->>'csvTotalRisked','')::float, 0) >= 500
          THEN ((metrics->>'rawRealizedPnl')::float / NULLIF(NULLIF(metrics->>'csvTotalRisked','')::float, 0) * 100)
          ELSE COALESCE(NULLIF(metrics->>'csvDirectionalROI',''), NULLIF(metrics->>'overallROI',''))::float
        END) AS overall_roi,
        COALESCE(NULLIF(metrics->>'capitalRoiPercent',''), NULLIF(metrics->>'overallROI',''))::float AS roi_capital,
        NULLIF(metrics->>'winRate','')::float                                              AS win_rate,
        (metrics->>'totalTrades')::int                  AS total_trades,
        NULLIF(metrics->>'medianBetSize','')::float     AS median_bet_usdc,
        NULLIF(metrics->>'avgBetSize','')::float        AS avg_bet_usdc,
        metrics->'roiBySport'                           AS roi_by_sport,
        metrics->'roiByMarketType'                      AS roi_by_market_type,
        metrics->'roiBySportMarketType'                 AS roi_by_sport_market_type,
        metrics->'csvPriceStats'                        AS price_stats,
        metrics->'closedByCategory'                     AS closed_by_category
      FROM elite_trader_profiles
      WHERE wallet IS NOT NULL
    `);
    const m = new Map<string, CanonicalEntry>();
    for (const r of rows) {
      m.set(r.wallet.toLowerCase(), {
        overallROI: parseFloat(r.overall_roi ?? "0") || 0,
        roiCapital: parseFloat(r.roi_capital ?? "0") || 0,
        winRate: parseFloat(r.win_rate ?? "0") || 0,
        totalTrades: parseInt(r.total_trades ?? "0") || 0,
        qualityScore: parseInt(r.quality_score ?? "0") || 0,
        tags: Array.isArray(r.tags) ? r.tags : [],
        roiBySport: r.roi_by_sport ?? {},
        roiByMarketType: r.roi_by_market_type ?? {},
        roiBySportMarketType: r.roi_by_sport_market_type ?? {},
        priceStats: r.price_stats ?? {},
        medianBetUSDC: Number.isFinite(r.median_bet_usdc) ? r.median_bet_usdc : undefined,
        avgBetUSDC: Number.isFinite(r.avg_bet_usdc) ? r.avg_bet_usdc : undefined,
        closedByCategory: (r.closed_by_category && typeof r.closed_by_category === "object")
          ? r.closed_by_category as CanonicalEntry["closedByCategory"]
          : undefined,
      });
    }
    _canonicalCache = m;
    _canonicalCacheAt = Date.now();
    return m;
  } catch {
    return _canonicalCache ?? new Map();
  }
}

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function fetchOfficialLeaderboard(timePeriod = "ALL", limit = 100, category = "", offset = 0): Promise<any[]> {
  const key = `lb-${timePeriod}-${limit}-${category}-${offset}`;
  const hit = getCache<any[]>(key);
  if (hit) return hit;
  const catParam = category ? `&category=${encodeURIComponent(category)}` : "";
  const offsetParam = offset > 0 ? `&offset=${offset}` : "";
  const res = await fetchWithRetry(
    `${DATA_API}/v1/leaderboard?window=${timePeriod.toLowerCase()}&limit=${limit}${catParam}${offsetParam}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  const traders: any[] = Array.isArray(data) ? data : data.data || [];
  setCache(key, traders, 10 * 60 * 1000);
  return traders;
}

/**
 * Paginated leaderboard fetch — loops until maxTraders unique wallets collected.
 * Uses batched parallel requests for speed. Returns deduped list sorted by rank.
 */
async function fetchPaginatedLeaderboard(timePeriod: string, maxTraders: number, category: string): Promise<any[]> {
  const PAGE_SIZE = 50;
  const pages = Math.ceil(maxTraders / PAGE_SIZE);
  // Fetch all pages in parallel for max speed
  const batches = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      fetchOfficialLeaderboard(timePeriod, PAGE_SIZE, category, i * PAGE_SIZE)
    )
  );
  const seen = new Set<string>();
  const result: any[] = [];
  for (const batch of batches) {
    for (const t of batch) {
      const w = (t.proxyWallet || "").toLowerCase();
      if (w && !seen.has(w)) { seen.add(w); result.push(t); }
    }
  }
  console.log(`[LB] Paginated fetch: ${timePeriod}/${category} → ${result.length} unique traders from ${pages} pages`);
  return result;
}

/** Combine ALL + WEEK + MONTH sports leaderboards, deduplicated by proxyWallet */
async function fetchMultiWindowSportsLB(): Promise<any[]> {
  const key = "lb-multi-sports";
  const hit = getCache<any[]>(key);
  if (hit) return hit;
  const [allW, weekW, monthW] = await Promise.all([
    fetchPaginatedLeaderboard("ALL",   500, "sports"), // paginated: up to 500 all-time sports traders
    fetchPaginatedLeaderboard("WEEK",  200, "sports"), // paginated: up to 200 this-week hot hands
    fetchPaginatedLeaderboard("MONTH", 200, "sports"), // paginated: up to 200 this-month traders
  ]);
  // Build per-wallet window membership for recency scoring
  const byWallet = new Map<string, any>();
  const windowFlags = new Map<string, { inAll: boolean; inWeek: boolean; inMonth: boolean }>();
  for (const t of allW) {
    const w = (t.proxyWallet || "").toLowerCase();
    if (!w) continue;
    byWallet.set(w, t);
    windowFlags.set(w, { inAll: true, inWeek: false, inMonth: false });
  }
  for (const t of weekW) {
    const w = (t.proxyWallet || "").toLowerCase();
    if (!w) continue;
    const flags = windowFlags.get(w) || { inAll: false, inWeek: false, inMonth: false };
    flags.inWeek = true;
    const existing = byWallet.get(w);
    if (!existing) { byWallet.set(w, t); windowFlags.set(w, flags); }
    else {
      // prefer higher PNL
      if (parseFloat(t.pnl || "0") > parseFloat(existing.pnl || "0")) byWallet.set(w, { ...t, ...flags });
      else windowFlags.set(w, flags);
    }
  }
  for (const t of monthW) {
    const w = (t.proxyWallet || "").toLowerCase();
    if (!w) continue;
    const flags = windowFlags.get(w) || { inAll: false, inWeek: false, inMonth: false };
    flags.inMonth = true;
    const existing = byWallet.get(w);
    if (!existing) { byWallet.set(w, t); windowFlags.set(w, flags); }
    else { windowFlags.set(w, flags); }
  }
  // Annotate each trader with their window flags for recency scoring downstream
  const merged = Array.from(byWallet.entries()).map(([w, t]) => ({
    ...t,
    _windows: windowFlags.get(w) || { inAll: false, inWeek: false, inMonth: false },
  }));
  setCache(key, merged, 10 * 60 * 1000);
  return merged;
}

/** Gamma's default ordering is popularity — the first 800 rows often omit today's games.
 *  Pull 3 pages (same as /api/markets/search) so upcoming/moneyline tabs include near-term sports. */
async function fetchSportsMarkets(_limit = 800): Promise<any[]> {
  const key = "sports-markets-wide-v3";
  const hit = getCache<any[]>(key);
  if (hit) return hit;
  const offsets = [0, 800, 1600];
  const batches = await Promise.all(
    offsets.map((offset) =>
      fetchWithRetry(`${GAMMA_API}/markets?active=true&closed=false&limit=800&offset=${offset}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((d: any) => (Array.isArray(d) ? d : d?.data ?? []))
        .catch(() => [])
    )
  );
  const seen = new Set<string>();
  const markets: any[] = [];
  for (const batch of batches) {
    for (const m of batch) {
      const id = String(m.conditionId || m.id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      markets.push(m);
    }
  }
  setCache(key, markets, 3 * 60 * 1000);
  return markets;
}

/** Enrich game market registry with volume/liquidity/price from Gamma API by conditionId.
 *  Called non-blocking after signal generation populates the registry. */
async function enrichGameMarketsFromGamma(): Promise<void> {
  const cKey = "gmr-enriched";
  if (getCache<boolean>(cKey)) return; // skip if enriched recently
  const ids = Array.from(gameMarketRegistry.keys());
  if (ids.length === 0) return;

  const BATCH = 20;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const query = batch.map(id => `condition_ids=${encodeURIComponent(id)}`).join("&");
    try {
      const res = await fetchWithRetry(`${GAMMA_API}/markets?${query}&limit=${BATCH + 5}`);
      if (!res.ok) continue;
      const data = await res.json();
      const markets: any[] = Array.isArray(data) ? data : data.data || [];
      for (const m of markets) {
        const condId = m.conditionId || m.id;
        if (!condId || !gameMarketRegistry.has(condId)) continue;
        const existing = gameMarketRegistry.get(condId)!;
        let outcomePrices: number[] = [];
        try { outcomePrices = JSON.parse(m.outcomePrices || "[]").map(parseFloat); } catch {}
        const volume    = parseFloat(m.volume    || m.volumeNum    || "0");
        const liquidity = parseFloat(m.liquidity || m.liquidityNum || "0");
        let enrichedGst: string | undefined = existing.gameStartTime;
        if (m.gameStartTime && !enrichedGst) {
          enrichedGst = String(m.gameStartTime).replace(" ", "T").replace("+00", "Z");
        }
        gameMarketRegistry.set(condId, {
          ...existing,
          volume:        volume    > 0 ? volume    : existing.volume,
          liquidity:     liquidity > 0 ? liquidity : existing.liquidity,
          currentPrice:  outcomePrices[0] > 0 ? outcomePrices[0] : existing.currentPrice,
          slug:          m.slug || existing.slug,
          gameStartTime: enrichedGst,
        });
      }
    } catch (e: any) {
      console.warn(`enrichGameMarketsFromGamma batch ${i} failed:`, e.message);
    }
  }
  setCache(cKey, true, 4 * 60_000);
}

async function fetchMidpoint(tokenId: string): Promise<number | null> {
  const key = `mid-${tokenId}`;
  const hit = getCache<number>(key);
  if (hit !== null) return hit;
  try {
    const res = await fetchWithRetry(`${CLOB_API}/midpoint?token_id=${tokenId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const mid = parseFloat(data.mid ?? data.midpoint ?? "0");
    if (!isNaN(mid) && mid > 0) { setCache(key, mid, 30_000); return mid; }
  } catch {}
  return null;
}

/** Uncached GET midpoint for signal gates — batch/snapshot + pos.curPrice can lag the book by 10¢+ on futures. */
async function fetchMidpointUncached(tokenId: string): Promise<number | null> {
  try {
    const res = await fetchWithRetry(`${CLOB_API}/midpoint?token_id=${tokenId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const mid = parseFloat(data.mid ?? data.midpoint ?? "0");
    if (!isNaN(mid) && mid > 0) return mid;
  } catch {}
  return null;
}

/** Batch fetch CLOB midpoints for many tokens in one or few requests. Rate limit: 500 req/10s for POST /midpoints. */
const MIDPOINT_BATCH_SIZE = 150;
async function fetchMidpointsBatch(tokenIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(tokenIds)].filter(Boolean);
  const out = new Map<string, number>();
  for (let i = 0; i < unique.length; i += MIDPOINT_BATCH_SIZE) {
    const chunk = unique.slice(i, i + MIDPOINT_BATCH_SIZE);
    try {
      const res = await fetchWithRetry(`${CLOB_API}/midpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chunk.map(id => ({ token_id: id }))),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && typeof data === "object") {
        for (const [id, val] of Object.entries(data)) {
          const mid = typeof val === "string" ? parseFloat(val) : Number(val);
          // Include 0 — losing side of a resolved market (e.g. Under 1.5 at 2-0) must not fall through
          // to stale pos.curPrice or avgEntry; we filter downstream with MIN_RESOLVED / MIN_LIVE_PRICE.
          if (Number.isFinite(mid) && mid >= 0) out.set(id, mid);
        }
      }
    } catch { /* skip chunk */ }
  }
  return out;
}

// ─── Curated elite sports traders ────────────────────────────────────────────
// Derived directly from CURATED_TRADERS (the single source of truth for all 42
// hand-picked elite traders). Used for BOTH the main signals function AND the
// elite analytics system — so updating CURATED_TRADERS in eliteAnalysis.ts
// automatically propagates to both systems.
/** Code-seeded elite traders (names + wallets). Merged with DB roster + discovered for signal sources. */
const CURATED_ELITES: Array<{ addr: string; name: string }> = CURATED_TRADERS
  .filter(t => t.wallet && t.wallet.length > 0 && !t.wallet.startsWith("pending-") && !MARKET_MAKER_WALLETS.has(t.wallet.toLowerCase()))
  .map(t => ({ addr: t.wallet, name: t.username }));

/** Discovered leaderboard wallets only join Live Signals after canonical qualityScore ≥ this (post-pipeline). */
const DISCOVERED_MIN_QUALITY_FOR_SIGNALS = 35;
/** Trade depth for vetted discovered wallets (below curated 4k cap). Kept for cache key compatibility; signals use ELITE_TRADES_PER_WALLET for all merged sources. */
const DISCOVERED_TRADES_PER_WALLET = 2500;

function resolveDiscoveredElitesForSignals(canonicalMap: Map<string, CanonicalEntry>): Array<{ addr: string; name: string }> {
  const curatedSet = new Set(
    CURATED_TRADERS.filter(
      t => t.wallet && t.wallet.length > 0 && !t.wallet.startsWith("pending-") && !MARKET_MAKER_WALLETS.has(t.wallet.toLowerCase())
    ).map(t => t.wallet.toLowerCase())
  );
  const out: Array<{ addr: string; name: string }> = [];
  for (const d of DISCOVERED_ELITES) {
    const w = d.wallet.toLowerCase();
    if (curatedSet.has(w)) continue;
    if (MARKET_MAKER_WALLETS.has(w)) continue;
    const cm = canonicalMap.get(w);
    const q = cm?.qualityScore ?? 0;
    if (q < DISCOVERED_MIN_QUALITY_FOR_SIGNALS) continue;
    out.push({ addr: d.wallet, name: d.username });
  }
  return out;
}

/** All rows in `elite_traders` (resolved roster) — same pool we track in the app; signals merge this with curated + discovered. */
async function loadEliteTraderWalletsFromDatabase(): Promise<Array<{ addr: string; name: string }>> {
  try {
    const { rows } = await elitePool.query<{ wallet: string; username: string }>(
      `SELECT wallet, username FROM elite_traders WHERE wallet NOT LIKE 'pending-%' ORDER BY wallet`,
    );
    const out: Array<{ addr: string; name: string }> = [];
    for (const r of rows) {
      const addr = (r.wallet || "").trim();
      if (!addr) continue;
      const w = addr.toLowerCase();
      if (MARKET_MAKER_WALLETS.has(w)) continue;
      out.push({ addr, name: (r.username || "").trim() || truncAddr(addr) });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Union: curated elites (names win) + DISCOVERED_ELITES passing Q gate + every wallet in `elite_traders`.
 * Ensures anyone we persist to the DB contributes trades/positions to Live Signals like a first-class tracked account.
 */
function mergeSignalSourceWallets(
  canonicalMap: Map<string, CanonicalEntry>,
  dbWallets: Array<{ addr: string; name: string }>,
): Array<{ addr: string; name: string }> {
  const byAddr = new Map<string, { addr: string; name: string }>();
  const add = (addr: string, name: string, forceName: boolean) => {
    const w = addr.toLowerCase();
    if (!addr || MARKET_MAKER_WALLETS.has(w)) return;
    const nm = name || truncAddr(addr);
    const cur = byAddr.get(w);
    if (!cur) {
      byAddr.set(w, { addr, name: nm });
      return;
    }
    if (forceName) byAddr.set(w, { addr, name: nm });
  };
  for (const e of CURATED_ELITES) add(e.addr, e.name, true);
  for (const d of resolveDiscoveredElitesForSignals(canonicalMap)) add(d.addr, d.name, false);
  for (const r of dbWallets) add(r.addr, r.name, false);
  return [...byAddr.values()];
}

// ─── Shared trader intelligence store ─────────────────────────────────────────
// Populated during signal computation and shared with /api/traders.
// Contains ALL tracked traders from every source — leaderboard, curated, discovered.
export type SharedTraderEntry = {
  name: string;
  pnl: number;
  roi: number;
  volume: number;
  qualityScore: number;
  isLeaderboard: boolean;
  isSportsLb: boolean;
  source: "sports_lb" | "general_lb" | "curated" | "discovered";
};
export const sharedTraderMap = new Map<string, SharedTraderEntry>();
let sharedTraderMapUpdatedAt = 0;

// Shared market DB — populated by signals route, used by alerts functions
const sharedMarketDb = new Map<string, { question: string; slug?: string; endDate?: string; gameStartTime?: string; active: boolean; tokenIds?: string[] }>();

// ESPN live-status background cache: slug → isCurrentlyLive (true = IN_PROGRESS)
// Refreshed every 90s so categoriseMarket can use it as a fallback when Polymarket
// doesn't supply gameStartTime for a market we know has started.
const espnLiveGames = new Map<string, boolean>();
// Collects event slugs seen by categoriseMarket so refreshESPNLiveGames can check them.
// sharedMarketDb uses CLOB market_slug (not event slug), so this is the only reliable way
// to collect the sports event slugs that ESPN needs to check.
const seenEventSlugs = new Set<string>();
// Slug-keyed gameStartTime lookup — covers O/U and spread market variants that share
// a base game slug but don't have their own gameStartTime field.
const gameSlugToGST = new Map<string, string>();

// ── Live position cache ────────────────────────────────────────────────────────
// Holds ALL open positions for every curated trader, refreshed every 60 seconds
// via paginated background fetch. Keyed by wallet address (lowercased).
// Using this avoids blocking signal requests on live position fetches and
// captures the full position history (>500 positions for heavy traders).
const livePositionCache = new Map<string, any[]>();
let livePositionCacheUpdatedAt = 0;

async function refreshESPNLiveGames(): Promise<void> {
  const now = Date.now();

  // ── Collect all candidate slugs ──────────────────────────────────────────
  const toCheck = new Set<string>();

  // From seenEventSlugs (true Polymarket event slugs, e.g. "nhl-ana-ott-2026-03-14-total-6pt5")
  for (const slug of seenEventSlugs) {
    if (!/^(nba|nhl|nfl|mlb|ncaab|ncaaf)-/.test(slug)) continue;
    const dm = slug.match(/-(\d{4}-\d{2}-\d{2})/);
    if (!dm) continue;
    const endMs = new Date(dm[1] + "T23:59:59Z").getTime();
    if (endMs < now - 6 * 3600_000 || endMs > now + 24 * 3600_000) continue;
    toCheck.add(slug);
  }

  // Also from sharedMarketDb (CLOB slugs, for markets fetched via CLOB API)
  for (const entry of [...sharedMarketDb.values(), ...gameMarketRegistry.values()]) {
    const slug = entry.slug;
    if (!slug || !/^(nba|nhl|nfl|mlb|ncaab|ncaaf)-/.test(slug)) continue;
    let shouldCheck = false;
    if (entry.gameStartTime) {
      const startMs = new Date(entry.gameStartTime).getTime();
      shouldCheck = (now - startMs) < 14 * 3600_000 && (startMs - now) < 24 * 3600_000;
    } else if (entry.endDate) {
      const rawEnd = entry.endDate.trim();
      const endMs = /^\d{4}-\d{2}-\d{2}$/.test(rawEnd)
        ? new Date(rawEnd + "T23:59:59Z").getTime()
        : new Date(rawEnd).getTime();
      shouldCheck = endMs > now - 6 * 3600_000 && endMs < now + 24 * 3600_000;
    }
    if (shouldCheck) toCheck.add(slug);
  }

  if (toCheck.size === 0) return;

  // ── Group slugs by (sportPath, date) ─────────────────────────────────────
  // Make ONE ESPN scoreboard API call per sport+date instead of per-slug calls.
  // This reduces 60+ sequential calls to ~3-5 parallel calls.
  type SportGroup = { sportPath: string; date: string; slugs: string[] };
  const groups = new Map<string, SportGroup>();
  for (const slug of toCheck) {
    const parsed = parseSlugForESPN(slug);
    if (!parsed) continue;
    const key = `${parsed.sportPath}|${parsed.date}`;
    if (!groups.has(key)) groups.set(key, { sportPath: parsed.sportPath, date: parsed.date, slugs: [] });
    groups.get(key)!.slugs.push(slug);
  }
  // ── Fetch each group in parallel ─────────────────────────────────────────
  await Promise.all([...groups.values()].map(async (group) => {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${group.sportPath}/scoreboard?dates=${group.date}`;
      const res = await fetchWithRetry(url, {}, 2);
      if (!res.ok) return;
      const data = await res.json();
      const events: any[] = data.events || [];

      function teamsMatch(s: string, e: string): boolean {
        if (e === s) return true;
        const overlap = Math.min(s.length, e.length, 3);
        if (overlap < 3) return false;
        return e.startsWith(s.slice(0, overlap)) || s.startsWith(e.slice(0, overlap));
      }

      for (const slug of group.slugs) {
        const parsed = parseSlugForESPN(slug);
        if (!parsed) continue;
        const slugTeams = [
          POLY_TO_ESPN[parsed.t1.toLowerCase()] || parsed.t1.toLowerCase(),
          POLY_TO_ESPN[parsed.t2.toLowerCase()] || parsed.t2.toLowerCase(),
        ];
        let matched = false;
        for (const event of events) {
          const comp = (event.competitions || [])[0];
          if (!comp) continue;
          const home = (comp.competitors || []).find((c: any) => c.homeAway === "home");
          const away = (comp.competitors || []).find((c: any) => c.homeAway === "away");
          if (!home || !away) continue;
          const espnAbbrs = [
            (home.team?.abbreviation || "").toLowerCase(),
            (away.team?.abbreviation || "").toLowerCase(),
          ];
          const matchCount = slugTeams.filter(s => espnAbbrs.some(e => teamsMatch(s, e))).length;
          if (matchCount < 2) continue;
          const st = event.status?.type || {};
          const period = event.status?.period || 0;
          const isLive = !st.completed && (
            st.name === "STATUS_IN_PROGRESS" ||
            /in.progress|in progress|live|progress/i.test(st.name || "") ||
            (period > 0 && !st.completed)
          );
          espnLiveGames.set(slug, isLive);
          matched = true;
          break;
        }
        // If no ESPN event matched, mark as not live (pregame or finished)
        if (!matched) espnLiveGames.set(slug, false);
      }
    } catch { /* ESPN unavailable, skip this group */ }
  }));
}

/**
 * Polymarket /trades: `timestamp` is unix seconds (sometimes float). Rarely already ms.
 * Never fall back to `Date.now()` — missing timestamps are not "now" (causes "just now" on cards and
 * identical fake times for multiple traders in the same request).
 */
function tradeTimestampMs(trade: { timestamp?: number | string; createdAt?: string }): number {
  const raw = trade.timestamp != null && trade.timestamp !== "" ? Number(trade.timestamp) : NaN;
  if (Number.isFinite(raw) && raw !== 0) {
    if (raw > 1e12) return Math.round(raw);
    return Math.round(raw * 1000);
  }
  if (trade.createdAt) {
    const t = new Date(trade.createdAt).getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
}

/** Max |avg entry − live midpoint| (0.05 = 5¢). Applied on trades, positions, cluster, and /signals/fast emitters. */
const ENTRY_VS_LIVE_MAX = 0.05;
/** In-play books move fast; one request can drift past 5¢. Stricter band when categoriseMarket === "live". */
const ENTRY_VS_LIVE_MAX_INPLAY = 0.03;

/** Known futures-heavy curated wallet(s) — large stake on macro futures gets a UI highlight (see signals.push). */
const FUTURES_EXPERT_LARGE_STAKE_WALLET = "0x53ecc53e7a69aad0e6dda60264cc2e363092df91";
const FUTURES_EXPERT_LARGE_STAKE_MIN_USD = 5000;

/** Polymarket /trades returns max 1000 per request — paginate with offset to go deeper per wallet. */
const ELITE_TRADES_PAGE_SIZE = 1000;
/** Single depth for every wallet on the elite roster (no curated vs non-curated split). */
const UNIFIED_SIGNAL_TRADES_DEPTH = 15000;
const ELITE_TRADES_PER_WALLET = UNIFIED_SIGNAL_TRADES_DEPTH;

function dedupeTradesByTx(trades: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const t of trades) {
    const id = String(t.transactionHash || t.id || `${t.conditionId}|${t.timestamp}|${t.proxyWallet}|${t.side}`);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(t);
  }
  return out;
}

/**
 * Fetch recent trades for one wallet, paginated up to `limit` (default 15k for elite roster).
 * Same shape as global fetchRecentTrades — use for signal aggregation (oldest→newest sort applied by caller).
 */
async function fetchEliteTraderTrades(wallet: string, limit = ELITE_TRADES_PER_WALLET): Promise<any[]> {
  const w = wallet.toLowerCase();
  const key = `elite-trades-${w}-${limit}`;
  const hit = getCache<any[]>(key);
  if (hit) return hit;
  const all: any[] = [];
  try {
    let offset = 0;
    while (all.length < limit) {
      const page = Math.min(ELITE_TRADES_PAGE_SIZE, limit - all.length);
      const r = await fetchWithRetry(`${DATA_API}/trades?user=${w}&limit=${page}&offset=${offset}`);
      if (!r.ok) break;
      const d = await r.json();
      const chunk: any[] = Array.isArray(d) ? d : d.data || [];
      if (chunk.length === 0) break;
      all.push(...chunk);
      offset += chunk.length;
      if (chunk.length < page) break;
    }
    const deduped = dedupeTradesByTx(all);
    deduped.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    setCache(key, deduped, 3 * 60_000);
    return deduped;
  } catch {
    return [];
  }
}

/**
 * Merge trades from every curated elite (same per-wallet cap each).
 * Replaces global fetchRecentTrades(N) for feeds where we care about *each* insider's book, not platform-wide volume ranking.
 */
/** Merge /trades for the full elite roster (code list + DB + discovered Q-gated), same as signals Phase 1. */
async function fetchMergedEliteRosterTrades(limitPerWallet = UNIFIED_SIGNAL_TRADES_DEPTH): Promise<any[]> {
  const key = `merged-elite-trades-v3-roster-${limitPerWallet}`;
  const hit = getCache<any[]>(key);
  if (hit) return hit;
  const [canonicalMap, dbWallets] = await Promise.all([
    loadCanonicalMetricsFromDB(),
    loadEliteTraderWalletsFromDatabase(),
  ]);
  const merged = mergeSignalSourceWallets(canonicalMap, dbWallets);
  const batches = await Promise.all(merged.map(e => fetchEliteTraderTrades(e.addr, limitPerWallet)));
  const flat = dedupeTradesByTx(batches.flat());
  flat.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  setCache(key, flat, 2 * 60_000);
  return flat;
}

/**
 * Curated + discovered wallets — used only by /api/alerts/live (Sharp Moves) so the strip is not
 * limited to 42 wallets; still capped per-wallet fetch depth for API load.
 */
async function fetchMergedAlertsTradeFeed(): Promise<any[]> {
  const key = `merged-alerts-feed-v5-unified-${UNIFIED_SIGNAL_TRADES_DEPTH}`;
  const hit = getCache<any[]>(key);
  if (hit) return hit;
  const [canonicalMap, dbWallets] = await Promise.all([
    loadCanonicalMetricsFromDB(),
    loadEliteTraderWalletsFromDatabase(),
  ]);
  const merged = mergeSignalSourceWallets(canonicalMap, dbWallets);
  const batches = await runWithConcurrency(
    merged.map(w => () => fetchEliteTraderTrades(w.addr, UNIFIED_SIGNAL_TRADES_DEPTH)),
    8,
  );
  const flat = dedupeTradesByTx(batches.flat());
  flat.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  setCache(key, flat, 90_000);
  return flat;
}

/** Prefer showing different wallets back-to-back instead of many rows from the same primary stake leader. */
function interleaveSignalsByPrimaryWallet(signals: any[]): any[] {
  if (signals.length <= 1) return signals;
  const byPrimary = new Map<string, any[]>();
  for (const s of signals) {
    const primary = String(
      (s.traders?.[0] as any)?.address ?? (s.traders?.[0] as any)?.wallet ?? "_unknown"
    ).toLowerCase();
    if (!byPrimary.has(primary)) byPrimary.set(primary, []);
    byPrimary.get(primary)!.push(s);
  }
  const maxAvgQ = (list: any[]) => Math.max(0, ...list.map((x: any) => x.avgQuality ?? 0));
  // Ascending signal count per primary so the feed round-robins across wallets (diversity).
  const wallets = [...byPrimary.keys()].sort((a, b) => {
    const listA = byPrimary.get(a)!;
    const listB = byPrimary.get(b)!;
    const lenA = listA.length;
    const lenB = listB.length;
    if (lenA !== lenB) return lenA - lenB;
    const qA = maxAvgQ(listA);
    const qB = maxAvgQ(listB);
    if (qB !== qA) return qB - qA;
    const vpA = listA.some((x: any) => x.vipPremium) ? 1 : 0;
    const vpB = listB.some((x: any) => x.vipPremium) ? 1 : 0;
    if (vpB !== vpA) return vpB - vpA;
    const bestA = Math.max(...listA.map((x: any) => x.confidence ?? 0));
    const bestB = Math.max(...listB.map((x: any) => x.confidence ?? 0));
    return bestB - bestA;
  });
  for (const w of wallets) {
    byPrimary.get(w)!.sort((a: any, b: any) => {
      const vpa = a.vipPremium === true ? 1 : 0;
      const vpb = b.vipPremium === true ? 1 : 0;
      if (vpb !== vpa) return vpb - vpa;
      return (b.confidence - a.confidence) || ((b.avgQuality ?? 0) - (a.avgQuality ?? 0));
    });
  }
  const out: any[] = [];
  let round = 0;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const w of wallets) {
      const list = byPrimary.get(w)!;
      if (round < list.length) {
        out.push(list[round]);
        progressed = true;
      }
    }
    round++;
  }
  return out;
}

/** Sharp Moves: recency-first with a per-wallet cap so one wallet cannot own the strip. */
function diversifyLiveAlertsByWallet(alerts: any[], maxTotal: number, maxPerWallet: number): any[] {
  const byTime = [...alerts].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const counts = new Map<string, number>();
  const out: any[] = [];
  const ids = new Set<string>();
  for (const a of byTime) {
    const w = (a.wallet || "").toLowerCase();
    if ((counts.get(w) || 0) >= maxPerWallet) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
    out.push(a);
    ids.add(String(a.id));
    if (out.length >= maxTotal) return out;
  }
  for (const a of byTime) {
    if (out.length >= maxTotal) break;
    const id = String(a.id);
    if (ids.has(id)) continue;
    out.push(a);
    ids.add(id);
  }
  return out;
}

async function fetchRecentTrades(limit = 4000): Promise<any[]> {
  const key = `trades-${limit}`;
  const hit = getCache<any[]>(key);
  if (hit) return hit;
  // Polymarket API is capped at 1000 per call — paginate in chunks of 1000
  const PAGE_SIZE = 1000;
  const pages = Math.ceil(limit / PAGE_SIZE);
  const fetches = Array.from({ length: pages }, (_, i) =>
    fetchWithRetry(`${DATA_API}/trades?limit=${PAGE_SIZE}&offset=${i * PAGE_SIZE}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d ? (Array.isArray(d) ? d : d.data || []) : [])
      .catch(() => [] as any[])
  );
  const chunks = await Promise.all(fetches);
  const trades: any[] = chunks.flat();
  setCache(key, trades, 2 * 60 * 1000);
  return trades;
}

/** Fetch current open positions for a wallet address */
async function fetchTraderPositions(wallet: string): Promise<any[]> {
  const key = `pos-${wallet}`;
  const hit = getCache<any[]>(key);
  if (hit) return hit;
  try {
    const r = await fetchWithRetry(`${DATA_API}/positions?user=${wallet}&limit=500&sizeThreshold=0`);
    if (!r.ok) return [];
    const d = await r.json();
    const positions: any[] = Array.isArray(d) ? d : d.data || [];
    setCache(key, positions, 8 * 60_000); // 8 min cache for positions
    return positions;
  } catch { return []; }
}

/** Fetch ALL open positions for a wallet by paginating the positions endpoint.
 *  Uses limit=500 per page, up to 100 pages (50k positions) so whale traders (e.g. 0p0jogggg,
 *  LynxTitan) are fully covered and graded. Matches eliteAnalysis syncTraderPositions cap. */
const MAX_POSITION_PAGES = 100; // 100 * 500 = 50,000 positions per wallet
async function fetchAllPositionsFull(wallet: string): Promise<any[]> {
  const all: any[] = [];
  const limit = 500;
  let offset = 0;
  for (let page = 0; page < MAX_POSITION_PAGES; page++) {
    try {
      const r = await fetchWithRetry(
        `${DATA_API}/positions?user=${wallet.toLowerCase()}&limit=${limit}&offset=${offset}&sizeThreshold=0`
      );
      if (!r.ok) break;
      const d = await r.json();
      const batch: any[] = Array.isArray(d) ? d : (d.data || []);
      if (batch.length === 0) break;
      all.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
      if (offset >= 50_000) break;
      await new Promise(r => setTimeout(r, 40)); // gentle throttle between pages
    } catch { break; }
  }
  return all;
}

/** Run an async task list with at most `concurrency` running at the same time. */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

/** Refresh open positions for merged elite roster (curated + DB + discovered Q-gated), 30s interval.
 *  Matches /api/signals sources so confirmation gates see current books for every tracked wallet. */
async function refreshLivePositions(): Promise<void> {
  try {
    const [canonicalMap, dbWallets] = await Promise.all([
      loadCanonicalMetricsFromDB(),
      loadEliteTraderWalletsFromDatabase(),
    ]);
    const merged = mergeSignalSourceWallets(canonicalMap, dbWallets);
    const tasks = merged.map(
      e => async () => {
        const positions = await fetchAllPositionsFull(e.addr);
        return { wallet: e.addr.toLowerCase(), positions };
      },
    );
    const results = await runWithConcurrency(tasks, 8);
    for (const { wallet, positions } of results) {
      livePositionCache.set(wallet, positions);
    }
    livePositionCacheUpdatedAt = Date.now();
    const total = [...livePositionCache.values()].reduce((s, p) => s + p.length, 0);
    console.log(`[LivePos] Refreshed ${merged.length} roster wallets: ${total} open positions cached`);
  } catch (err: any) {
    console.error(`[LivePos] Refresh failed: ${err.message}`);
  }
}

/** Detect Polymarket auto-generated pseudonyms ("Adjective-Noun" pattern) */
function isAutoPseudonym(name: string): boolean {
  if (!name) return true;
  return /^[A-Z][a-z]+-[A-Z][a-z]+$/.test(name);
}

/** Detect the hex+timestamp auto-username Polymarket assigns to wallets without a display name */
function isHexTimestampUsername(name: string): boolean {
  return /^0x[a-fA-F0-9]{10,}-\d{9,}$/.test(name);
}

/**
 * Compute a human-readable outcome label for a market + side.
 * e.g. "Warriors vs. Jazz" + YES  →  "Warriors WIN"
 *      "Warriors vs. Jazz: O/U 225.5" + NO  →  "Under 225.5"
 *      "Spread: Warriors (-6.5)" + YES  →  "Warriors -6.5 covers"
 *      "Will the Celtics win the 2026 NBA Finals?" + YES  →  "Celtics WIN"
 */
/** Strip BO-series notation and tournament context suffix from a raw team name.
 *  e.g. "Spirit (BO3) - ESL Pro League Playoffs" → "Spirit" */
function cleanTeamName(raw: string): string {
  return raw
    .replace(/\s*\(BO\d+\)\s*/gi, "")   // "(BO3)", "(BO5)" etc.
    .replace(/\s*[-–]\s*.+$/, "")        // "- ESL Pro League Playoffs" suffix
    .replace(/\?$/, "")
    .trim();
}

// Resolves side ("YES"|"NO") from raw trade/position outcome data.
// For O/U markets, Polymarket doesn't guarantee token 0 = Over, so we must
// check the actual outcome string ("Over"/"Under") before falling back to index.
function resolveSide(outcome: string | undefined | null, outcomeIndex: number | undefined | null): "YES" | "NO" {
  const lo = (outcome || "").toLowerCase().trim();
  if (lo === "over")  return "YES"; // Over → YES → label "Over X"
  if (lo === "under") return "NO";  // Under → NO  → label "Under X"
  if (lo === "yes")   return "YES";
  if (lo === "no")    return "NO";
  // Fall back to token index (0 = YES, 1 = NO)
  return (outcomeIndex ?? 1) === 0 ? "YES" : "NO";
}

function computeOutcomeLabel(title: string, side: "YES" | "NO"): string {
  const t = title.trim();
  // O/U totals: "O/U 225.5" or "total 225.5"
  const ouMatch = t.match(/o\/?u\s+([\d.]+)/i) || t.match(/total[:\s]+([\d.]+)/i);
  if (ouMatch) return side === "YES" ? `Over ${ouMatch[1]}` : `Under ${ouMatch[1]}`;
  // Spread markets: "Spread: Team (-6.5)"
  const spreadMatch = t.match(/spread[:\s]+([A-Za-z].+?)\s*\(([+-]?\d+\.?\d*)\)/i);
  if (spreadMatch) {
    const team = spreadMatch[1].trim();
    const spd  = spreadMatch[2];
    return side === "YES" ? `${team} ${spd} covers` : `${team} doesn't cover`;
  }
  // DRAW markets: "Will X vs Y end in a draw?" OR "X vs Y: draw" OR "draw"
  if (/end(s)?\s+in\s+a\s+draw|result.*draw|draw.*result/i.test(t)) {
    return side === "YES" ? "DRAW" : "No Draw";
  }
  if (/:\s*draw\s*$/i.test(t)) {
    return side === "YES" ? "DRAW" : "No Draw";
  }
  // BTTS: "Both Teams to Score" or "BTTS"
  if (/both\s+teams?\s+to\s+score|\bbtts\b/i.test(t)) {
    return side === "YES" ? "BTTS — Yes" : "BTTS — No";
  }
  // "Will [the] Team win ..." futures — but NOT "Will X vs Y ...end in..."
  // Must not have "vs" to avoid matching draw/head-to-head markets
  const willMatch = t.match(/^will\s+(?:the\s+)?(.+?)\s+win/i);
  if (willMatch && !willMatch[1].match(/\s+vs\.?\s+/i)) {
    const team = willMatch[1].trim();
    return side === "YES" ? `${team} WIN` : `${team} won't win`;
  }
  // "Team1 vs. Team2" game winner (no colon = head-to-head winner market)
  if (!t.includes(":")) {
    // Strip leading "Will " prefix if present
    const clean = t.replace(/^will\s+/i, "");
    const vsMatch = clean.match(/^(.+?)\s+vs\.?\s+([^?]+)/i);
    if (vsMatch) {
      const t1 = vsMatch[1].trim().replace(/\s+(win|beat|cover).*$/i, "");
      const t2 = vsMatch[2].trim().replace(/\s+(win|beat|cover).*$/i, "").replace(/\?$/, "");
      return side === "YES" ? `${t1} WIN` : `${t2} WIN`;
    }
  }
  // "Team1 vs. Team2: Sub-market" — e.g. "Warriors vs. Jazz: O/U 225.5"
  const colonAfterVs = t.match(/^(.+?)\s+vs\.?\s+([^:]+):\s*(.+)$/i);
  if (colonAfterVs) {
    const sub = colonAfterVs[3].trim();
    const subOu = sub.match(/o\/?u\s*([\d.]+)/i);
    if (subOu) return side === "YES" ? `Over ${subOu[1]}` : `Under ${subOu[1]}`;
    if (/draw/i.test(sub)) return side === "YES" ? "DRAW" : "No Draw";
    if (/btts|both\s+teams/i.test(sub)) return side === "YES" ? "BTTS — Yes" : "BTTS — No";
    return `${sub} — ${side}`;
  }
  // "Tournament: Player1 vs. Player2" — colon before vs (tennis, soccer, esports)
  // Also handles "Sport: Team1 vs Team2 (BO3) - Tournament Context"
  const tourneyVs = t.match(/^.+?:\s*(.+?)\s+vs\.?\s+(.+)$/i);
  if (tourneyVs) {
    const p1 = cleanTeamName(tourneyVs[1]);
    const p2 = cleanTeamName(tourneyVs[2]);
    return side === "YES" ? `${p1} WIN` : `${p2} WIN`;
  }
  return side;
}

/** Return a display name — wallet address if auto-pseudonym */
function displayName(name: string, wallet: string): string {
  if (!name || isAutoPseudonym(name)) return truncAddr(wallet);
  return name;
}

/**
 * Build a conditionId → market info map from the Gamma markets database.
 * Used to filter expired/inactive markets and get live tokenIds for CLOB midpoints.
 */
async function buildMarketDatabase(limit = 800): Promise<Map<string, {
  question: string; slug?: string; endDate?: string; gameStartTime?: string;
  active: boolean; tokenIds: string[]; category: string;
}>> {
  const key = `market-db-${limit}`;
  const hit = getCache<Map<string, any>>(key);
  if (hit) return hit;

  const now = Date.now();
  const raw = await fetchSportsMarkets(limit);
  const db = new Map<string, any>();

  for (const m of raw) {
    const condId = m.conditionId || m.id;
    if (!condId) continue;

    // Skip markets that ended more than 30 minutes ago
    const endMs = m.endDate ? new Date(m.endDate).getTime() : Infinity;
    if (endMs < now - 30 * 60_000) continue;

    let tokens: any[] = [];
    if (typeof m.tokens === "string") { try { tokens = JSON.parse(m.tokens); } catch {} }
    else if (Array.isArray(m.tokens)) tokens = m.tokens;
    if (!tokens.length && Array.isArray(m.clobTokenIds)) {
      tokens = m.clobTokenIds.map((id: string, idx: number) => ({ token_id: id, outcome: idx === 0 ? "Yes" : "No" }));
    }
    const tIds = tokens.map((t: any) => String(t.token_id || t.tokenId || "")).filter(Boolean);

    let gst: string | undefined;
    if (m.gameStartTime) gst = String(m.gameStartTime).replace(" ", "T").replace("+00", "Z");
    db.set(condId, {
      question: m.question || m.title || condId,
      slug: m.slug,
      endDate: m.endDate,
      gameStartTime: gst,
      active: m.active !== false && m.closed !== true,
      tokenIds: tIds,
      category: m.groupItemTagSlug || m.category || "other",
    });
  }

  setCache(key, db, 4 * 60_000);
  return db;
}

/**
 * Enrich a marketDb with data from CLOB API for conditionIds not already present.
 * The CLOB API uses end_date_iso / game_start_time (vs Gamma's endDate / gameStartTime).
 * Runs batches of parallel CLOB lookups for unknown markets found in positions data.
 */
async function enrichMarketDbFromClob(
  marketDb: Map<string, any>,
  conditionIds: string[],
): Promise<void> {
  const unknown = conditionIds.filter(id => id && !marketDb.has(id));
  if (unknown.length === 0) return;
  const BATCH = 8;
  for (let i = 0; i < Math.min(unknown.length, 40); i += BATCH) {
    const batch = unknown.slice(i, i + BATCH);
    await Promise.all(batch.map(async condId => {
      const cKey = `clob-market-${condId}`;
      const cached = getCache<any>(cKey);
      if (cached) { marketDb.set(condId, cached); return; }
      try {
        const url = `https://clob.polymarket.com/markets/${condId}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (!r.ok) return;
        const m = await r.json() as any;
        if (!m || !m.question) return;
        const endDate = m.end_date_iso || m.endDate;
        let gst: string | undefined;
        if (m.game_start_time) gst = String(m.game_start_time).replace(" ", "T").replace("+00", "Z");
        const isActive = m.active !== false && m.closed !== true;
        let tokenIds: string[] = [];
        if (Array.isArray(m.tokens)) tokenIds = m.tokens.map((t: any) => String(t.token_id || "")).filter(Boolean);
        const entry = {
          question: m.question,
          slug: m.market_slug || m.slug,
          endDate,
          gameStartTime: gst,
          active: isActive,
          tokenIds,
          category: "sports",
        };
        setCache(cKey, entry, 5 * 60_000);
        marketDb.set(condId, entry);
      } catch { /* non-fatal */ }
    }));
  }
}

/**
 * Fetch the largest open positions globally from the subgraph,
 * ordered by amount descending. This surfaces the most committed traders
 * regardless of leaderboard status. Uses pagination for broader coverage.
 * min_amount: ~$100 in base units (100 * 1e6 = 1e8) to filter tiny positions.
 */
async function fetchTopOpenPositions(minAmountBase = 50_000_000): Promise<any[]> {
  const key = `sg-top-pos-${minAmountBase}`;
  const hit = getCache<any[]>(key);
  if (hit) return hit;

  const all: any[] = [];
  const PAGE = 1000;
  let skip = 0;
  for (let page = 0; page < 3; page++) {
    const query = `{
      userPositions(
        first: ${PAGE}, skip: ${skip},
        orderBy: amount, orderDirection: desc,
        where: { amount_gt: "${minAmountBase}" }
      ) {
        user tokenId amount avgPrice realizedPnl totalBought
      }
    }`;
    const resp = await graphqlQuery(query);
    const rows: any[] = resp?.data?.userPositions || [];
    all.push(...rows);
    if (rows.length < PAGE) break;
    skip += PAGE;
  }
  setCache(key, all, 8 * 60 * 1000);
  return all;
}

/**
 * Reverse-lookup: given tokenIds from subgraph positions, fetch the
 * corresponding Polymarket market data from the Gamma API.
 * Returns a Map: tokenId → market info.
 */
async function fetchMarketsByTokenIds(tokenIds: string[]): Promise<Map<string, {
  conditionId: string; question: string; slug?: string;
  outcomeIndex: number; outcome: string; currentPrice: number;
  volume: number; category: string; tokenIds: string[]; endDate?: string;
}>> {
  const result = new Map<string, any>();
  if (tokenIds.length === 0) return result;

  const BATCH = 60;
  for (let i = 0; i < tokenIds.length; i += BATCH) {
    const batch = tokenIds.slice(i, i + BATCH);
    const idsParam = encodeURIComponent(batch.join(","));
    try {
      const res = await fetchWithRetry(`${GAMMA_API}/markets?clob_token_ids=${idsParam}&limit=${BATCH}`);
      if (!res.ok) continue;
      const data = await res.json();
      const markets: any[] = Array.isArray(data) ? data : (data.data || data.markets || []);

      for (const m of markets) {
        let tokens: any[] = [];
        if (typeof m.tokens === "string") { try { tokens = JSON.parse(m.tokens); } catch {} }
        else if (Array.isArray(m.tokens)) { tokens = m.tokens; }

        // Fallback: clobTokenIds field
        if (tokens.length === 0 && Array.isArray(m.clobTokenIds)) {
          tokens = m.clobTokenIds.map((id: string, idx: number) => ({
            token_id: id, outcome: idx === 0 ? "Yes" : "No",
          }));
        }

        let prices: number[] = [];
        try { prices = JSON.parse(m.outcomePrices || "[]").map(parseFloat); } catch {}
        if (prices.length === 0 && m.outcomePrices && typeof m.outcomePrices === "object") {
          prices = Object.values(m.outcomePrices).map(Number);
        }

        const tIds = tokens.map((t: any) => String(t.token_id || t.tokenId || "")).filter(Boolean);

        for (let j = 0; j < tokens.length; j++) {
          const tokenId = String(tokens[j].token_id || tokens[j].tokenId || "");
          if (!tokenId) continue;
          result.set(tokenId, {
            conditionId: m.conditionId || m.id || "",
            question: m.question || m.title || "",
            slug: m.slug,
            outcomeIndex: j,
            outcome: tokens[j].outcome || (j === 0 ? "Yes" : "No"),
            currentPrice: prices[j] ?? (j === 0 ? 0.5 : 0.5),
            volume: parseFloat(m.volume || m.volumeNum || "0"),
            category: m.groupItemTagSlug || m.category || "sports",
            tokenIds: tIds,
            endDate: m.endDate,
            active: m.active !== false && m.closed !== true,
          });
        }
      }
    } catch (err: any) {
      console.warn(`fetchMarketsByTokenIds batch failed: ${err.message}`);
    }
  }
  return result;
}

/**
 * Build token map from a batch of raw Gamma markets.
 * Handles both JSON-string and already-parsed formats.
 */
function buildTokenMapFromRaw(markets: any[]): Map<string, {
  conditionId: string; question: string; slug?: string;
  outcomeIndex: number; outcome: string; currentPrice: number;
  volume: number; category: string; tokenIds: string[]; endDate?: string;
}> {
  const map = new Map();
  for (const m of markets) {
    let tokens: any[] = [];
    if (typeof m.tokens === "string") { try { tokens = JSON.parse(m.tokens); } catch {} }
    else if (Array.isArray(m.tokens)) { tokens = m.tokens; }
    if (tokens.length === 0 && Array.isArray(m.clobTokenIds)) {
      tokens = m.clobTokenIds.map((id: string, idx: number) => ({ token_id: id, outcome: idx === 0 ? "Yes" : "No" }));
    }

    let prices: number[] = [];
    try { prices = JSON.parse(m.outcomePrices || "[]").map(parseFloat); } catch {}

    const tIds = tokens.map((t: any) => String(t.token_id || t.tokenId || "")).filter(Boolean);

    for (let i = 0; i < tokens.length; i++) {
      const tokenId = String(tokens[i].token_id || tokens[i].tokenId || "");
      if (!tokenId) continue;
      map.set(tokenId, {
        conditionId: m.conditionId || m.id || "",
        question: m.question || m.title || "",
        slug: m.slug,
        outcomeIndex: i,
        outcome: tokens[i].outcome || (i === 0 ? "Yes" : "No"),
        currentPrice: prices[i] ?? 0.5,
        volume: parseFloat(m.volume || m.volumeNum || "0"),
        category: m.groupItemTagSlug || m.category || "sports",
        tokenIds: tIds,
        endDate: m.endDate,
        active: m.active !== false && m.closed !== true,
      });
    }
  }
  return map;
}

async function fetchSubgraphROI(addresses: string[]): Promise<Record<string, { roi: number; positionCount: number }>> {
  if (addresses.length === 0) return {};
  const key = `sg-roi-${addresses.slice(0, 3).join("-")}-${addresses.length}`;
  const hit = getCache<Record<string, { roi: number; positionCount: number }>>(key);
  if (hit) return hit;

  const BATCH = 30;
  const agg: Record<string, { pnl: number; bought: number; count: number }> = {};

  for (let i = 0; i < addresses.length; i += BATCH) {
    const batch = addresses.slice(i, i + BATCH);
    const addrList = batch.map(a => `"${a}"`).join(",");
    const resp = await graphqlQuery(`{
      userPositions(first:1000, where:{user_in:[${addrList}]}) {
        user realizedPnl totalBought
      }
    }`);
    const rows: any[] = resp?.data?.userPositions || [];
    for (const r of rows) {
      const addr = (r.user || "").toLowerCase();
      if (!agg[addr]) agg[addr] = { pnl: 0, bought: 0, count: 0 };
      agg[addr].pnl   += parseFloat(r.realizedPnl || "0");
      agg[addr].bought += parseFloat(r.totalBought || "0");
      agg[addr].count++;
    }
  }

  const result: Record<string, { roi: number; positionCount: number }> = {};
  for (const [addr, s] of Object.entries(agg)) {
    result[addr] = { roi: s.bought > 0 ? (s.pnl / s.bought) * 100 : 0, positionCount: s.count };
  }
  setCache(key, result, 15 * 60 * 1000);
  return result;
}

// ─── Trader filters ───────────────────────────────────────────────────────────
function isLikelyBot(t: any): boolean {
  const name = (t.userName || "").toLowerCase();
  const vol  = parseFloat(t.vol || "0");
  const pnl  = parseFloat(t.pnl || "0");
  if (name.startsWith("0x") && name.length > 30) return true;
  if (/^\d{10,}$/.test(name)) return true;
  if (vol > 2_000_000_000) return true;
  // Arbitrageur: <2% ROI on >$20M volume
  if (vol > 20_000_000 && pnl / vol < 0.02) return true;
  return false;
}

// ─── Market parser ────────────────────────────────────────────────────────────
function parseMarket(m: any) {
  let outcomePrices: number[] = [];
  let tokenIds: string[] = [];
  try { outcomePrices = JSON.parse(m.outcomePrices || "[]").map(parseFloat); } catch {}
  try {
    const toks = JSON.parse(m.tokens || "[]");
    tokenIds = toks.map((t: any) => String(t.token_id || t.tokenId)).filter(Boolean);
  } catch {}
  if (tokenIds.length === 0) {
    try {
      // clobTokenIds may be a JSON string OR an array
      const raw = m.clobTokenIds;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) tokenIds = parsed.map(String).filter(Boolean);
    } catch {}
  }
  // gameStartTime: Polymarket's exact game start (ISO UTC). Format varies: "2026-03-11 00:30:00+00"
  // Normalize to standard ISO so Date() can parse it reliably
  let gameStartTime: string | undefined;
  const rawGST = m.gameStartTime;
  if (rawGST) {
    const normalized = String(rawGST).replace(" ", "T").replace("+00", "Z");
    gameStartTime = normalized;
  }
  return {
    id: m.id || m.conditionId || "",
    question: m.question || m.title || "",
    slug: m.slug,
    category: m.groupItemTagSlug || m.category || "other",
    currentPrice: outcomePrices[0] ?? 0.5,
    volume: parseFloat(m.volume || m.volumeNum || "0"),
    liquidity: parseFloat(m.liquidity || m.liquidityNum || "0"),
    endDate: m.endDate,
    gameStartTime,
    active: m.active !== false && m.closed !== true,
    traderCount: parseInt(m.uniqueTraders || m.traderCount || "0"),
    conditionId: m.conditionId || m.id || "",
    tokenIds,
  };
}

// ─── ESPN live-score helpers ─────────────────────────────────────────────────
const SPORT_PATH_MAP: Record<string, string> = {
  nba:   "basketball/nba",
  nfl:   "football/nfl",
  nhl:   "hockey/nhl",
  mlb:   "baseball/mlb",
  ncaab: "basketball/mens-college-basketball",
  ncaaf: "football/college-football",
  ucl:   "soccer/uefa.champions",
  uel:   "soccer/uefa.europa",
  epl:   "soccer/eng.1",
  lal:   "soccer/esp.1",
  bun:   "soccer/ger.1",
  sea:   "soccer/ita.1",
  fl1:   "soccer/fra.1",
  elc:   "soccer/eng.2",
  mls:   "soccer/usa.1",
  nwsl:  "soccer/usa.nwsl",
};

interface GameScore {
  homeTeam: string; awayTeam: string;
  homeAbbr: string; awayAbbr: string;
  homeScore: number; awayScore: number;
  status: string; detail: string;
  period: number; clock: string; completed: boolean;
}

function parseSlugForESPN(slug: string): { sportPath: string; t1: string; t2: string; date: string } | null {
  const m = slug.match(/^([a-z]+)-([a-z]{2,4})-([a-z]{2,4})-(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  const [, sport, t1, t2, dateStr] = m;
  const sportPath = SPORT_PATH_MAP[sport];
  if (!sportPath) return null;
  return { sportPath, t1, t2, date: dateStr.replace(/-/g, "") };
}

/** Polymarket team abbreviations that differ from ESPN */
const POLY_TO_ESPN: Record<string, string> = {
  sas: "sa",    // San Antonio Spurs (ESPN: "SA")
  las: "vgk",   // Vegas Golden Knights (ESPN: "VGK")
  nyk: "ny",    // New York Knicks (ESPN: "NY")
  nyj: "nyj",
  nyg: "nyg",
  nyr: "nyr",   // NY Rangers
  nym: "nym",
  lak: "lak",   // LA Kings (sometimes ESPN "LA")
  lac: "lac",   // LA Clippers
  nob: "no",    // New Orleans
  gsw: "gs",    // Golden State Warriors (ESPN: "GS")
  phx: "phx",   // Phoenix Suns stays "PHX" in ESPN
  phf: "phi",   // Philly
  sea: "sea",
  mon: "mtl",   // Montréal Canadiens (Polymarket "mon" → ESPN "MTL")
  cal: "cgy",   // Calgary Flames (Polymarket "cal" → ESPN "CGY")
  was: "wsh",   // Washington (NBA: "WAS" → ESPN "WSH")
  utah: "uta",  // Utah Jazz/Hockey Club (Polymarket "utah" → ESPN "UTA")
};

async function fetchESPNGameScore(slug: string): Promise<GameScore | null> {
  const parsed = parseSlugForESPN(slug);
  if (!parsed) return null;
  const cKey = `espn-score-${slug}`;
  const hit = getCache<GameScore | null>(cKey);
  if (hit !== undefined && hit !== null) return hit;
  const { sportPath, t1, t2, date } = parsed;
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${date}`;
  try {
    const res = await fetchWithRetry(url, {}, 2);
    if (!res.ok) { setCache(cKey, null, 60_000); return null; }
    const data = await res.json();
    const events: any[] = data.events || [];
    for (const event of events) {
      const comp = (event.competitions || [])[0];
      if (!comp) continue;
      const competitors: any[] = comp.competitors || [];
      const home = competitors.find((c: any) => c.homeAway === "home");
      const away = competitors.find((c: any) => c.homeAway === "away");
      if (!home || !away) continue;
      const homeAbbr = (home.team?.abbreviation || "").toLowerCase();
      const awayAbbr = (away.team?.abbreviation || "").toLowerCase();
      // Fuzzy match: slug teams (2-3 chars) vs ESPN abbreviations
      // Translate known Polymarket→ESPN mismatches first
      const slugTeams = [
        POLY_TO_ESPN[t1.toLowerCase()] || t1.toLowerCase(),
        POLY_TO_ESPN[t2.toLowerCase()] || t2.toLowerCase(),
      ];
      const espnAbbrs = [homeAbbr.toLowerCase(), awayAbbr.toLowerCase()];
      function teamsMatch(slug3: string, espn: string): boolean {
        if (espn === slug3) return true;
        const overlap = Math.min(slug3.length, espn.length, 3);
        if (overlap < 3) return false;
        return espn.startsWith(slug3.slice(0, overlap)) || slug3.startsWith(espn.slice(0, overlap));
      }
      const matchCount = slugTeams.filter(s => espnAbbrs.some(e => teamsMatch(s, e))).length;
      if (matchCount < 2) continue;
      const status = event.status || {};
      const st = status.type || {};
      const result: GameScore = {
        homeTeam: home.team?.displayName || homeAbbr.toUpperCase(),
        awayTeam: away.team?.displayName || awayAbbr.toUpperCase(),
        homeAbbr: home.team?.abbreviation || homeAbbr.toUpperCase(),
        awayAbbr: away.team?.abbreviation || awayAbbr.toUpperCase(),
        homeScore: parseInt(home.score || "0"),
        awayScore: parseInt(away.score || "0"),
        status: st.name || "",
        detail: st.shortDetail || st.detail || "",
        period: status.period || 0,
        clock: status.displayClock || "",
        completed: !!(st.completed),
      };
      setCache(cKey, result, result.completed ? 10 * 60_000 : 30_000);
      return result;
    }
  } catch { /* ESPN unavailable */ }
  setCache(cKey, null, 60_000);
  return null;
}


// ─── Incremental activity sync helper ────────────────────────────────────────
// Fetches only NEW events since last known timestamp — safe to call on every restart
async function runActivitySyncForAll(wallets: string[], label = "Activity") {
  const CONCURRENCY = 8;
  let done = 0;
  const total = wallets.length;
  console.log(`[${label}] Starting full analysis for ${total} wallets (concurrency=${CONCURRENCY})`);

  const processWallet = async (wallet: string) => {
    try {
      // runAnalysisForTrader runs the FULL correct pipeline:
      //   1. fetchFullTradeHistory (offset-based pagination — works for 3000+ trades)
      //   2. fetchAllActivity (first page only — for recent REDEEM events)
      //   3. settleUnresolvedTrades (Gamma API settlement with correct PNL formula)
      //   4. computeTraderProfile (aggregates stats from settled trades)
      await runAnalysisForTrader(wallet);
      done++;
      console.log(`[${label}] ${done}/${total} ${wallet.slice(0, 8)}: full analysis complete`);
    } catch (e: any) {
      done++;
      console.error(`[${label}] Failed for ${wallet.slice(0, 8)}:`, e.message);
    }
  };

  // Process in parallel batches of CONCURRENCY
  for (let i = 0; i < wallets.length; i += CONCURRENCY) {
    const batch = wallets.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processWallet));
  }
  console.log(`[${label}] Sync complete: ${done}/${total} traders`);
}

// ─── Route registration ───────────────────────────────────────────────────────
export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ── Elite trader seeding + periodic refresh ───────────────────────────────
  seedCuratedTraders().then(async (newWallets) => {
    console.log(`[Elite] Curated traders seeded${newWallets.length ? ` (${newWallets.length} new: ${newWallets.map(w => w.slice(0, 8)).join(", ")})` : ""}`);

    // Immediately kick off full analysis for any brand-new traders so their
    // PNL/signals are populated without waiting for the periodic refresh cycle.
    if (newWallets.length > 0) {
      console.log(`[Startup] Triggering full refresh for ${newWallets.length} newly added traders...`);
      setImmediate(() =>
        runActivitySyncForAll(newWallets, "NewTrader").catch((e: Error) =>
          console.error("[Startup] New-trader refresh error:", e.message)
        )
      );
    }

    // startPeriodicRefresh() intentionally disabled — CSV analysis is the ONLY source of truth
    startCanonicalPNLRefresh(); // runs 30s after startup, then every 24h (canonical PNL only)
    scheduleDailyRefresh();     // armed: runs full incremental analysis at 3 AM UTC daily

    // Auto-sync activity for all wallets on every server start (incremental, safe)
    try {
      const { rows } = await elitePool.query(
        `SELECT wallet FROM elite_traders WHERE wallet NOT LIKE 'pending-%' ORDER BY wallet`
      );
      if (rows.length > 0) {
        console.log(`[Startup] Syncing activity for ${rows.length} wallets...`);
        runActivitySyncForAll(rows.map((r: any) => r.wallet), "Startup").catch((e: Error) =>
          console.error("[Startup] Activity sync error:", e.message)
        );
      }
    } catch (e: any) {
      console.error("[Startup] Failed to start activity sync:", e?.message ?? e);
    }
  }).catch((e: Error) => console.error("[Elite] Seed error:", e?.message ?? e));

  // ── GET /api/elite/traders ─────────────────────────────────────────────────
  app.get("/api/elite/traders", async (_req, res) => {
    try {
      const { rows } = await elitePool.query(`
        SELECT t.wallet, t.username, t.added_at, t.last_analyzed_at, t.wallet_resolved,
               t.polymarket_url, t.notes,
               p.quality_score, p.tags, p.computed_at,
               p.metrics->>'totalTrades' as total_trades,
               CASE
                 WHEN NULLIF(TRIM(p.metrics->>'csvTier'), '') IS NOT NULL
                   AND NULLIF(TRIM(p.metrics->>'csvDirectionalROI'), '') IS NOT NULL
                 THEN p.metrics->>'csvDirectionalROI'
                 WHEN (p.metrics->>'rawRealizedPnl') IS NOT NULL AND (p.metrics->>'rawRealizedPnl') <> ''
                   AND COALESCE(NULLIF(p.metrics->>'csvTotalRisked','')::float, 0) >= 500
                 THEN (((p.metrics->>'rawRealizedPnl')::float) / NULLIF(NULLIF(p.metrics->>'csvTotalRisked','')::float, 0) * 100)::text
                 ELSE COALESCE(NULLIF(p.metrics->>'csvDirectionalROI',''), NULLIF(p.metrics->>'overallROI',''))
               END as overall_roi,
               COALESCE(NULLIF(p.metrics->>'capitalRoiPercent',''), NULLIF(p.metrics->>'overallROI','')) as roi_capital,
               p.metrics->>'last90dROI' as last90d_roi,
               COALESCE(NULLIF(p.metrics->>'csvWinRate',''), NULLIF(p.metrics->>'winRate','')) as win_rate,
               COALESCE(NULLIF(p.metrics->>'csvPseudoSharpe',''), p.metrics->>'sharpeScore') as sharpe_score,
               COALESCE(NULLIF(p.metrics->>'csvAvgBetSize',''), p.metrics->>'avgBetSize') as avg_bet_size,
               NULLIF(TRIM(p.metrics->>'csvMedianMarketStake'), '') as median_market_stake,
               NULLIF(TRIM(p.metrics->>'csvMarketsTraded'), '') as markets_traded,
               COALESCE(NULLIF(p.metrics->>'csvTradesPerDay',''), p.metrics->>'tradesPerDay') as trades_per_day,
               COALESCE(NULLIF(p.metrics->>'csvTopSport',''), p.metrics->>'topSport') as top_sport,
               p.metrics->>'topMarketType' as top_market_type,
               p.metrics->>'consistencyRating' as consistency_rating,
               COALESCE(NULLIF(p.metrics->>'rawRealizedPnl',''), NULLIF(p.metrics->>'csvDirectionalPNL',''), p.metrics->>'overallPNL') as overall_pnl,
               p.metrics->>'totalUSDC' as total_usdc,
               p.metrics->>'csvTier' as csv_tier,
               p.metrics->>'csvQualityScore' as csv_quality_score,
               p.metrics->>'csvTailGuide' as csv_tail_guide
        FROM elite_traders t
        LEFT JOIN elite_trader_profiles p ON LOWER(p.wallet) = LOWER(t.wallet)
        ORDER BY COALESCE(p.quality_score, 0) DESC
      `);
      res.json({ traders: rows, fetchedAt: Date.now() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/elite/traders/:wallet ────────────────────────────────────────
  app.get("/api/elite/traders/:wallet", async (req, res) => {
    try {
      const wallet = req.params.wallet.toLowerCase();
      const [traderRow, profileRow, tradeCount] = await Promise.all([
        elitePool.query(`SELECT * FROM elite_traders WHERE wallet = $1`, [wallet]),
        elitePool.query(`SELECT * FROM elite_trader_profiles WHERE wallet = $1`, [wallet]),
        elitePool.query(`SELECT COUNT(*) as cnt FROM elite_trader_trades WHERE wallet = $1 AND is_buy = TRUE`, [wallet]),
      ]);
      if (!traderRow.rows[0]) return res.status(404).json({ error: "Trader not found" });
      res.json({
        trader: traderRow.rows[0],
        profile: profileRow.rows[0] || null,
        rawTradeCount: parseInt(tradeCount.rows[0]?.cnt || "0"),
        fetchedAt: Date.now(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/elite/traders ────────────────────────────────────────────────
  app.post("/api/elite/traders", async (req, res) => {
    try {
      const { url, wallet: rawWallet, username: rawUsername } = req.body || {};

      let wallet = "";
      let username = rawUsername || "";

      // Extract from URL
      if (url) {
        const urlMatch = url.match(/polymarket\.com\/@([^/\s?]+)/);
        if (urlMatch) {
          const handle = urlMatch[1];
          if (/^0x[a-fA-F0-9]{40}/.test(handle)) {
            wallet = handle.toLowerCase().slice(0, 42);
            username = username || handle;
          } else {
            username = username || handle;
          }
        }
      }
      if (!wallet && rawWallet) wallet = rawWallet.toLowerCase().slice(0, 42);

      // Attempt resolution if no wallet yet
      let resolved = !!wallet;
      if (!wallet && username) {
        const found = await resolveUsernameToWallet(username);
        if (found) { wallet = found; resolved = true; }
      }

      const effectiveWallet = resolved ? wallet : `pending-${(username || "unknown").toLowerCase()}-${Date.now()}`;

      await elitePool.query(`
        INSERT INTO elite_traders (wallet, username, wallet_resolved, polymarket_url)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (wallet) DO UPDATE SET username = EXCLUDED.username, polymarket_url = EXCLUDED.polymarket_url
      `, [effectiveWallet, username || effectiveWallet.slice(0, 12), resolved, url || null]);

      if (resolved) {
        curatedWalletSet.add(wallet);
        curatedWalletToUsername.set(wallet, username || wallet);
        // Kick off background analysis
        setImmediate(() => runAnalysisForTrader(wallet));
      }

      res.json({
        wallet: effectiveWallet,
        username,
        resolved,
        message: resolved
          ? "Trader added — analysis starting in background"
          : "Trader added — wallet not resolved. Use PATCH to provide wallet address.",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PATCH /api/elite/traders/:wallet ─ Set wallet for unresolved traders ─
  app.patch("/api/elite/traders/:wallet", async (req, res) => {
    try {
      const oldKey = req.params.wallet;
      const { newWallet, username } = req.body || {};
      const cleanWallet = (newWallet || "").toLowerCase();

      if (!cleanWallet || !/^0x[a-fA-F0-9]{40}$/.test(cleanWallet)) {
        return res.status(400).json({ error: "Invalid wallet address" });
      }

      // Move old record to new wallet key
      await elitePool.query(`
        UPDATE elite_traders SET wallet = $1, wallet_resolved = TRUE, username = COALESCE($2, username)
        WHERE wallet = $3
      `, [cleanWallet, username || null, oldKey]);

      curatedWalletSet.add(cleanWallet);
      const { rows } = await elitePool.query(`SELECT username FROM elite_traders WHERE wallet = $1`, [cleanWallet]);
      curatedWalletToUsername.set(cleanWallet, rows[0]?.username || cleanWallet);

      setImmediate(() => runAnalysisForTrader(cleanWallet));
      res.json({ wallet: cleanWallet, resolved: true, message: "Wallet updated — analysis starting" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /api/elite/traders/:wallet ─────────────────────────────────────
  app.delete("/api/elite/traders/:wallet", async (req, res) => {
    try {
      const wallet = req.params.wallet.toLowerCase();
      await elitePool.query(`DELETE FROM elite_traders WHERE wallet = $1`, [wallet]);
      await elitePool.query(`DELETE FROM elite_trader_profiles WHERE wallet = $1`, [wallet]);
      curatedWalletSet.delete(wallet);
      curatedWalletToUsername.delete(wallet);
      res.json({ deleted: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/elite/traders/:wallet/refresh ───────────────────────────────
  app.post("/api/elite/traders/:wallet/refresh", async (req, res) => {
    try {
      const wallet = req.params.wallet.toLowerCase();
      const { rows } = await elitePool.query(`SELECT wallet FROM elite_traders WHERE wallet = $1`, [wallet]);
      if (!rows.length) return res.status(404).json({ error: "Trader not found" });
      setImmediate(() => runAnalysisForTrader(wallet));
      res.json({ message: "Refresh started", wallet });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/elite/admin/settle-all ─────────────────────────────────────
  // Settles all unsettled trades for EVERY trader globally using Gamma API.
  // Uses global settlement: one pass over all unique condition IDs (much faster).
  app.post("/api/elite/admin/settle-all", async (_req, res) => {
    try {
      const { rows } = await elitePool.query(
        `SELECT wallet FROM elite_traders WHERE wallet NOT LIKE 'pending-%' ORDER BY wallet`
      );
      res.json({ message: "Settlement started", wallets: rows.length });
      // Run global settlement in background, then recompute all profiles
      setImmediate(async () => {
        try {
          const totalSettled = await settleAllUnresolvedTradesGlobal();
          console.log(`[Admin] Global settlement complete: ${totalSettled} trades settled`);
          // Now recompute profiles for all wallets that have trades
          for (const r of rows) {
            try {
              await computeTraderProfile(r.wallet);
            } catch (e: any) {
              console.error(`[Admin] Profile compute failed for ${r.wallet}:`, e.message);
            }
          }
          console.log(`[Admin] All profiles recomputed`);
        } catch (e: any) {
          console.error(`[Admin] settle-all error:`, e.message);
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/elite/admin/reset-pnl ──────────────────────────────────────
  // Clears ALL settled PNL data and re-settles with the CORRECT formula:
  //   WIN: size * (1 - price)   [profit = payout - cost = shares - shares*price]
  //   LOSS: -(size * price)     [cost paid = shares * price per share]
  // This fixes the prior bug where size was mistakenly treated as USDC, not shares.
  app.post("/api/elite/admin/reset-pnl", async (_req, res) => {
    try {
      res.json({ message: "PNL reset and re-settlement started" });
      setImmediate(async () => {
        try {
          // Step 1: Clear ALL settled data so re-settlement runs on every trade
          const { rowCount: cleared } = await elitePool.query(`
            UPDATE elite_trader_trades
            SET settled_outcome = NULL, settled_pnl = NULL, settled_at = NULL
            WHERE is_buy = TRUE
          `);
          console.log(`[Admin/reset-pnl] Cleared ${cleared} settled trades`);

          // Step 2: Re-settle with correct formula
          const totalSettled = await settleAllUnresolvedTradesGlobal();
          console.log(`[Admin/reset-pnl] Re-settled ${totalSettled} trades with correct formula`);

          // Step 3: Recompute all trader profiles
          const { rows } = await elitePool.query(
            `SELECT wallet FROM elite_traders WHERE wallet NOT LIKE 'pending-%' ORDER BY wallet`
          );
          for (const r of rows) {
            try { await computeTraderProfile(r.wallet); } catch {}
          }
          console.log(`[Admin/reset-pnl] Done — recomputed ${rows.length} trader profiles`);
        } catch (e: any) {
          console.error(`[Admin/reset-pnl] error:`, e.message);
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/elite/admin/refresh-canonical-pnl/:wallet ─────────────────
  // Refresh canonical PNL for a single wallet synchronously.
  app.post("/api/elite/admin/refresh-canonical-pnl/:wallet", async (req, res) => {
    try {
      const wallet = req.params.wallet.toLowerCase();
      const result = await patchProfileWithCanonicalPNL(wallet);
      res.json({ message: "Canonical PNL refresh complete", wallet, result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/elite/admin/refresh-canonical-pnl ─────────────────────────
  // Refresh canonical PNL for ALL wallets. Only updates canonical PNL
  // metrics. Fast: no activity fetch, no recompute.
  app.post("/api/elite/admin/refresh-canonical-pnl", async (_req, res) => {
    try {
      const { rows } = await elitePool.query(
        `SELECT COUNT(*) as cnt FROM elite_traders WHERE wallet NOT LIKE 'pending-%'`
      );
      const count = parseInt(rows[0]?.cnt ?? "0");
      res.json({ message: "Canonical PNL refresh started", wallets: count });
      // Uses the same mutex as the auto-refresh — blocks concurrent runs
      setImmediate(() => runCanonicalPNLRefreshForAll());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/elite/refresh-status ───────────────────────────────────────
  // Returns the current state of the daily incremental refresh job and each
  // trader's last_analyzed_at timestamp.
  app.get("/api/elite/refresh-status", async (_req, res) => {
    try {
      const state = getDailyRefreshState();
      const { rows } = await elitePool.query<{ wallet: string; username: string; last_analyzed_at: string | null; quality_score: number | null }>(
        `SELECT t.wallet, t.username, t.last_analyzed_at, p.quality_score
        FROM elite_traders t
        LEFT JOIN elite_trader_profiles p ON LOWER(p.wallet) = LOWER(t.wallet)
        WHERE t.wallet NOT LIKE 'pending-%'
        ORDER BY COALESCE(t.last_analyzed_at, '2000-01-01') ASC`
      );
      const now = Date.now();
      const staleCount = rows.filter(r => {
        if (!r.last_analyzed_at) return true;
        return (now - new Date(r.last_analyzed_at).getTime()) > 20 * 60 * 60 * 1000;
      }).length;
      res.json({
        ...state,
        traderCount:   rows.length,
        staleCount,
        nextRunUTC:    "03:00",
        traders:       rows.map(r => ({
          wallet: r.wallet, username: r.username,
          lastRefreshed: r.last_analyzed_at,
          isStale: !r.last_analyzed_at || (now - new Date(r.last_analyzed_at).getTime()) > 20 * 60 * 60 * 1000,
          qualityScore: r.quality_score,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/elite/admin/daily-refresh ──────────────────────────────────
  // Manually trigger the daily incremental refresh for all stale traders.
  // Fetches new trades/activity since last update, re-computes all analytics.
  // Runs in background — check /api/elite/refresh-status for progress.
  app.post("/api/elite/admin/daily-refresh", async (_req, res) => {
    const current = getDailyRefreshState();
    if (current.running) {
      return res.json({
        message: "Daily refresh already in progress",
        startedAt: current.startedAt,
        ranCount:  current.ranCount,
        totalCount: current.totalCount,
      });
    }
    const { rows } = await elitePool.query(
      `SELECT COUNT(*) as cnt FROM elite_traders WHERE wallet NOT LIKE 'pending-%' AND (last_analyzed_at IS NULL OR last_analyzed_at < NOW() - INTERVAL '20 hours')`
    );
    const staleCount = parseInt(rows[0]?.cnt ?? "0");
    res.json({ message: "Daily refresh started", staleTraders: staleCount, note: "Fetches new trades since last update, re-scores all analytics. Check /api/elite/refresh-status for progress." });
    setImmediate(() => runDailyRefreshForCurated().catch((e: Error) =>
      console.error("[DailyRefresh] Manual trigger error:", e.message)
    ));
  });

  // ── GET /api/elite/canonical-pnl/:wallet ────────────────────────────────
  // Live fetch of canonical PNL for a single trader (no DB cache).
  // Note: sum(realizedPnl) matches Polymarket's profile P&L for most traders,
  // but may diverge for active multi-side traders (e.g. TheMangler).
  app.get("/api/elite/canonical-pnl/:wallet", async (req, res) => {
    try {
      const wallet = req.params.wallet.toLowerCase();
      const canonical = await fetchCanonicalPNL(wallet);
      res.json(canonical);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/elite/market-ofi ────────────────────────────────────────────
  // Order Flow Imbalance: elite buy vs sell pressure per market (last 7 days).
  // OFI > 0 = sharp money flowing in; OFI < 0 = smart money exiting.
  app.get("/api/elite/market-ofi", async (req, res) => {
    try {
      const days = Math.min(30, Math.max(1, parseInt(req.query.days as string) || 7));
      const ofiData = await computeMarketOFI(days);
      res.json(ofiData);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/elite/admin/set-manual-pnl ────────────────────────────────
  // Manually override a trader's displayed PnL (protects against auto-refresh).
  // Body: { wallet: string, overallPNL: number, note?: string }
  app.post("/api/elite/admin/set-manual-pnl", async (req, res) => {
    try {
      const { wallet, overallPNL, note } = req.body;
      if (!wallet || overallPNL === undefined) {
        return res.status(400).json({ error: "wallet and overallPNL required" });
      }
      const w = wallet.toLowerCase();
      await elitePool.query(`
        UPDATE elite_trader_profiles
        SET metrics = metrics || $2::jsonb, computed_at = NOW()
        WHERE wallet = $1
      `, [w, JSON.stringify({
        overallPNL: Number(overallPNL),
        manualPnlOverride: true,
        manualPnlNote: note || "Manually set via admin API",
        pnlSource: "polymarket_profile_manual",
        pnlUpdatedAt: new Date().toISOString(),
      })]);
      res.json({ success: true, wallet: w, overallPNL: Number(overallPNL) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/elite/admin/clear-manual-pnl ──────────────────────────────
  // Remove manual PnL override so auto-refresh resumes for a trader.
  app.post("/api/elite/admin/clear-manual-pnl", async (req, res) => {
    try {
      const { wallet } = req.body;
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      const w = wallet.toLowerCase();
      await elitePool.query(`
        UPDATE elite_trader_profiles
        SET metrics = metrics - 'manualPnlOverride' - 'manualPnlNote' - 'pnlSource' || '{"pnlSource":"closed_positions_api"}'::jsonb
        WHERE wallet = $1
      `, [w]);
      res.json({ success: true, wallet: w });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/elite/admin/remove-trader ────────────────────────────────────
  // Permanently remove a trader from elite roster and profiles (e.g. swisstony).
  // Body: { "wallet": "0x..." }. Call after removing from pipeline ALL_TRADERS.
  app.post("/api/elite/admin/remove-trader", async (req, res) => {
    try {
      const { wallet } = req.body;
      if (!wallet) return res.status(400).json({ error: "wallet required" });
      const w = wallet.toLowerCase();
      await elitePool.query(`DELETE FROM elite_trader_profiles WHERE wallet = $1`, [w]);
      const del = await elitePool.query(`DELETE FROM elite_traders WHERE wallet = $1 RETURNING username`, [w]);
      const username = del.rows[0]?.username;
      // Clear cached lists so UI/signals stop including this trader
      delete cache["traders-curated-v2-sports"];
      delete cache["traders-curated-v2-all"];
      res.json({ success: true, wallet: w, removed: username ?? w });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/elite/admin/refetch-all ────────────────────────────────────
  // Clears and re-fetches ALL activity history for every trader (full refresh)
  app.post("/api/elite/admin/refetch-all", async (_req, res) => {
    try {
      const { rows } = await elitePool.query(
        `SELECT wallet FROM elite_traders WHERE wallet NOT LIKE 'pending-%' ORDER BY wallet`
      );
      res.json({ message: "Full re-fetch started (activity + trades)", wallets: rows.length });
      setImmediate(async () => {
        for (const r of rows) {
          try {
            // Clear existing data for full fresh fetch
            await elitePool.query(`DELETE FROM elite_trader_activity WHERE wallet = $1`, [r.wallet]);
            await elitePool.query(`DELETE FROM elite_trader_trades WHERE wallet = $1`, [r.wallet]);
            await elitePool.query(`UPDATE elite_traders SET last_analyzed_at = NULL WHERE wallet = $1`, [r.wallet]);
            // Fetch activity (accurate PNL via REDEEM events + cursor pagination)
            const actCount = await fetchAllActivity(r.wallet);
            // Fetch trades (for signal detection)
            await fetchFullTradeHistory(r.wallet);
            // Settle trades and compute profile
            await settleUnresolvedTrades(r.wallet);
            await computeTraderProfile(r.wallet);
            await elitePool.query(`UPDATE elite_traders SET last_analyzed_at = NOW() WHERE wallet = $1`, [r.wallet]);
            console.log(`[Admin] Re-fetched & analyzed ${r.wallet}: ${actCount} activity events`);
          } catch (e: any) {
            console.error(`[Admin] Re-fetch failed for ${r.wallet}:`, e.message);
          }
          await new Promise(res => setTimeout(res, 1500));
        }
        console.log(`[Admin] refetch-all complete`);
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/elite/admin/refetch-activity ─────────────────────────────────
  // Incrementally fetches activity for all wallets (no delete = survives restarts)
  app.post("/api/elite/admin/refetch-activity", async (_req, res) => {
    try {
      const { rows } = await elitePool.query(
        `SELECT wallet FROM elite_traders WHERE wallet NOT LIKE 'pending-%' ORDER BY wallet`
      );
      res.json({ message: "Activity re-fetch started", wallets: rows.length });
      setImmediate(() => runActivitySyncForAll(rows.map((r: any) => r.wallet)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/elite/traders/:wallet/csv ────────────────────────────────────
  app.get("/api/elite/traders/:wallet/csv", async (req, res) => {
    try {
      const wallet = req.params.wallet.toLowerCase();
      const csv = await generateTraderCSV(wallet);
      const { rows } = await elitePool.query(`SELECT username FROM elite_traders WHERE wallet = $1`, [wallet]);
      const name = rows[0]?.username || wallet.slice(0, 8);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${name}-trades.csv"`);
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/stream ─── Server-Sent Events push channel ──────────────────
  // Subscribe: `new EventSource('/api/stream?channel=alerts')`
  // Events: `alerts` (same shape as /api/alerts/live)
  // Price stream: `new EventSource('/api/stream?channel=price&conditionId=X')`
  // Events: `price` { conditionId, currentPrice, americanOdds, fetchedAt }
  app.get("/api/stream", (req, res) => {
    const channel = (req.query.channel as string) || "alerts";
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
    res.flushHeaders();
    res.write(": connected\n\n");

    if (channel === "price") {
      // Real-time price stream for a specific conditionId — polls every 2s
      const conditionId = (req.query.conditionId as string) || "";
      let closed = false;
      const pushPrice = async () => {
        if (closed) return;
        try {
          const sig = signalsByMarket.get(conditionId);
          let price: number | null = sig?.currentPrice ?? null;
          let source = "signal_cache";
          if (!price) {
            const entry = gameMarketRegistry.get(conditionId);
            if (entry?.currentPrice) { price = entry.currentPrice; source = "market_registry"; }
          }
          if (!price) {
            const gmRes = await fetch(`${GAMMA_API}/markets?condition_id=${conditionId}&limit=1`);
            if (gmRes.ok) {
              const gm = await gmRes.json();
              const m = Array.isArray(gm) ? gm[0] : gm?.markets?.[0];
              const p = m && parseFloat(m.lastTradePrice || m.bestAsk || m.midpoint || "0");
              if (p && p > 0) { price = p; source = "gamma"; }
            }
          }
          if (price && !closed) {
            const payload = JSON.stringify({ conditionId, currentPrice: price, americanOdds: toAmericanOdds(price), fetchedAt: Date.now(), source });
            res.write(`event: price\ndata: ${payload}\n\n`);
          }
        } catch { /* non-fatal */ }
        if (!closed) setTimeout(pushPrice, 2000);
      };
      req.on("close", () => { closed = true; });
      pushPrice();
      return;
    }

    const client: SseClient = { res, channel };
    sseClients.add(client);

    // Push current cached alerts immediately if available
    const cached = getCache<unknown>("live-alerts-v2");
    if (cached) res.write(`event: alerts\ndata: ${JSON.stringify(cached)}\n\n`);

    req.on("close", () => { sseClients.delete(client); });
  });

  // Background task: refresh live alerts every 15s and push to all SSE clients
  async function refreshAndBroadcastAlerts() {
    try {
      const now = Date.now();
      const [allTrades, allSportsLb, curatedRows] = await Promise.all([
        fetchMergedEliteRosterTrades(UNIFIED_SIGNAL_TRADES_DEPTH),
        fetchMultiWindowSportsLB(),
        elitePool.query(`SELECT wallet FROM elite_traders`).catch(() => ({ rows: [] as any[] })),
      ]);
      const curatedSet = new Set<string>((curatedRows.rows || []).map((r: any) => r.wallet.toLowerCase()));
      // Authoritative curated names (takes priority over LB names)
      const curatedNamesSSE = new Map<string, string>(
        CURATED_ELITES.map(e => [e.addr.toLowerCase(), e.name])
      );
      const lbMap = new Map<string, { name: string; pnl: number; isSportsLb: boolean }>();
      for (const t of allSportsLb) {
        const w = (t.proxyWallet || "").toLowerCase();
        if (!w || lbMap.has(w)) continue;
        lbMap.set(w, { name: t.userName || truncAddr(w), pnl: parseFloat(t.pnl || "0"), isSportsLb: true });
      }
      const alerts: any[] = [];
      const seen = new Set<string>();
      let bustSignalsCache = false;
      // Newest first so $1K+ curated buys surface before older rows (merged feed is time-ordered asc)
      const alertScan = [...allTrades].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      for (const trade of alertScan) {
        const wallet = (trade.proxyWallet || "").toLowerCase();
        if (MARKET_MAKER_WALLETS.has(wallet)) continue;
        const isCurated = curatedSet.has(wallet);
        const size = parseFloat(trade.size || trade.amount || "0");
        // Sharp Moves = curated elite traders only
        if (!isCurated) continue;
        if (size < 1000) continue; // minimum $1K plays only
        {
          const tSide = (trade.side || "").toUpperCase();
          if (tSide === "SELL") continue;
          if (tSide !== "BUY") continue;
        }
        const title = trade.title || trade.market || "";
        if (!isSportsRelated(title) || !title) continue;
        const price = parseFloat(trade.price || "0.5");
        if (price < 0.10 || price > 0.90) continue; // filter extreme prices
        const key = `${trade.conditionId || "?"}-${wallet}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const trader = lbMap.get(wallet);
        const displayNameSSE = curatedNamesSSE.get(wallet) || trader?.name || truncAddr(wallet);
        const side = resolveSide(trade.outcome, trade.outcomeIndex);
        const ts = tradeTimestampMs(trade);
        if (ts <= 0) continue;
        const condId = trade.conditionId || "";
        const dbEntry = sharedMarketDb.get(condId);
        // Skip postponed/inactive markets
        if (dbEntry && !dbEntry.active) continue;
        if (isPostponedOrCancelled(title, true, false)) continue;
        const mEndDate = trade.endDate || dbEntry?.endDate;
        const gameStatus = categoriseMarket(title, mEndDate, dbEntry?.gameStartTime, trade.slug || dbEntry?.slug);
        // Fresh curated buy while the game is in progress → drop signals cache so /api/signals
        // recomputes on the next poll (positions + prices) instead of waiting up to the old 90s TTL.
        if (gameStatus === "live" && now - ts < 3 * 60_000) bustSignalsCache = true;
        alerts.push({
          id: `alert-${trade.id || key}`,
          trader: displayNameSSE,
          wallet, isTracked: true, isSportsLb: trader?.isSportsLb ?? false, isCurated: true,
          market: title.slice(0, 80), slug: trade.slug, conditionId: condId,
          side, size: Math.round(size), price: Math.round(price * 1000) / 1000,
          americanOdds: toAmericanOdds(price),
          gameStatus,
          endDate: mEndDate,
          timestamp: ts, minutesAgo: Math.round((now - ts) / 60_000),
          sharpAction: signalsByMarket.get(condId) ?? null,
        });
        if (alerts.length >= 40) break;
      }
      if (bustSignalsCache) invalidateEliteSignalsCache();
      alerts.sort((a, b) => b.size - a.size);
      const result = { alerts: alerts.slice(0, 30), fetchedAt: now };
      setCache("live-alerts-v2", result, 20_000);
      if (sseClients.size > 0) broadcastSSE("alerts", "alerts", result);
    } catch { /* non-fatal */ }
  }
  setInterval(refreshAndBroadcastAlerts, 15_000);

  // ESPN live-status background refresh — updates every 90s during game hours
  // so that categoriseMarket() can correctly identify in-progress games even
  // when Polymarket doesn't supply gameStartTime for a given market.
  refreshESPNLiveGames().catch(() => {});
  setInterval(() => { refreshESPNLiveGames().catch(() => {}); }, 90_000);

  // Live position cache — fetches ALL open positions for all curated traders
  // via paginated API calls, 8 traders at a time. 30s cadence so in-play signals surface faster.
  refreshLivePositions().catch(() => {});
  setInterval(() => { refreshLivePositions().catch(() => {}); }, 30_000);

  // ── GET /api/_debug/espn (temp debug — shows ESPN live cache state) ──────────
  app.get("/api/_debug/espn", (_req, res) => {
    const cache: Record<string, boolean> = {};
    for (const [k, v] of espnLiveGames) cache[k] = v;
    const gst: Record<string, string> = {};
    for (const [k, v] of gameSlugToGST) gst[k] = v;
    // Show all NHL/NBA slugs from sharedMarketDb for debugging
    const seenSlugsList = [...seenEventSlugs].sort();
    res.json({ espnLiveGames: cache, gameSlugToGST: gst, sharedMarketDbSize: sharedMarketDb.size, seenEventSlugsCount: seenEventSlugs.size, seenEventSlugs: seenSlugsList.filter(s => /^(nba|nhl|nfl|mlb|ncaab|ncaaf)-/.test(s)) });
  });

  // ── POST /api/elite/traders/ingest-analysis ────────────────────────────────
  // Accepts JSON output from pnl_analysis/run_full_pipeline.py and updates
  // every trader's quality_score, tier, tags, and analysis metrics in the DB.
  app.post("/api/elite/traders/ingest-analysis", async (req, res) => {
    try {
      const { traders } = req.body as { traders: any[] };
      if (!Array.isArray(traders) || traders.length === 0) {
        res.status(400).json({ error: "Expected { traders: [...] }" });
        return;
      }

      let updated = 0;
      const summary: any[] = [];

      for (const t of traders) {
        const wallet = (t.wallet || "").toLowerCase();
        if (!wallet) continue;

        // ── Alias guard: reject known alt-accounts so they can't pollute the oracle ──
        const usernameKey = (t.username || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (KNOWN_ALIASES[usernameKey]) {
          const alias = KNOWN_ALIASES[usernameKey];
          console.warn(`[Ingest] Skipping known alias "${t.username}" → canonical: ${alias.canonicalUsername} | ${alias.reason}`);
          summary.push({ username: t.username, status: "skipped_alias", canonical: alias.canonicalUsername });
          continue;
        }

        // Python sport keys -> routes keys (for csvDoNotTail/csvAutoTail and roiBySport)
        const pythonToRoutesSport: Record<string, string> = {
          "NBA": "NBA", "WNBA": "WNBA", "NFL": "NFL", "NHL": "NHL", "MLB": "MLB",
          "TENNIS": "Tennis", "UFC/MMA": "UFC/MMA", "ESPORTS": "eSports",
          "POLITICS": "Politics", "OTHER": "Other",
          "SOCCER (EPL)": "Soccer", "SOCCER (LaLiga)": "Soccer",
          "SOCCER (SerieA)": "Soccer", "SOCCER (Other)": "Soccer",
          "SOCCER (UCL)": "UCL", "SOCCER (UEL)": "UEL",
        };

        // Build the analysis metrics object to merge into the DB metrics JSONB
        const analysisMeta: Record<string, any> = {
          // Directional (bond-filtered) stats — the true edge
          csvDirectionalROI:    t.overall_roi,
          csvDirectionalPNL:    t.total_profit,
          rawRealizedPnl:       t.raw_realized_pnl ?? t.total_profit,  // true PNL (matches Polymarket); display only
          roiCapital:           t.total_risked,  // so display ROI = (rawRealizedPnl / roiCapital) * 100 is sensible
          csvTotalRisked:       t.total_risked,
          csvWinRate:           t.win_rate,
          csvTradesPerDay: (() => {
            const td = Number(t.total_days) || 0;
            const te = Number(t.total_events) || 0;
            return td > 0 ? Math.round((100 * te) / td) / 100 : 0;
          })(),
          csvAvgBetSize:        t.avg_bet_size,
          csvMedianMarketStake: t.median_market_stake ?? t.avg_bet_size,
          csvMeanMarketStake:   t.mean_market_stake ?? t.avg_bet_size,
          csvMarketsTraded:     t.markets_traded ?? 0,
          csvPseudoSharpe:      t.pseudo_sharpe,
          csvTotalEvents:       t.total_events,
          csvProfitableDays:    t.profitable_days,
          csvTotalDays:         t.total_days,
          csvBondCount:         t.bond_count,
          csvBondRisk:          t.bond_risk,
          csvOpenCount:         t.open_count,
          csvOpenRisk:          t.open_risk,
          csvOpenPnl:           t.open_pnl,
          csvTopSport:          t.top_sport,
          csvBestPriceBucket:   t.best_price_bucket,
          csvBestMarketType:    t.best_market,
          csvTier:              t.tier,
          csvQualityScore:      t.quality_score,
          csvSportStats:        t.sport_stats,
          csvMarketStats:       t.market_stats,
          csvPriceStats:        t.price_stats,
          csvSideStats:         t.side_stats,
          csvMonthlyPnl:        t.monthly_pnl,
          csvTopWins:           t.top_wins,
          csvTopLosses:         t.top_losses,
          csvTailGuide:         t.tail_guide,
          csvAnalyzedAt:        new Date().toISOString(),
          // CSV-derived do-not-tail / tail-for-sure (re-analyzed each run; used by signals when present)
          csvDoNotTailSports:       (t.do_not_tail_sports || []).map((s: string) => pythonToRoutesSport[s] ?? s),
          csvAutoTailSports:       (t.auto_tail_sports || []).map((s: string) => pythonToRoutesSport[s] ?? s),
          csvDoNotTailMarketTypes:  (t.do_not_tail_market_types || []).map((m: string) => m === "Spread" ? "spread" : m === "Totals (O/U)" ? "total" : m.toLowerCase()),
          csvDoNotTailSides:        t.do_not_tail_sides || [],
        };

        // ── Build roiBySport (normalized keys matching classifySportFull output) ──
        // CRITICAL: this is what loadCanonicalMetricsFromDB queries — must be populated.
        const roiBySportAgg: Record<string, { roi: number; tradeCount: number; winRate: number;
          avgBet: number; medianBet: number; netProfit: number; totalCost: number }> = {};
        for (const [pythonSport, stat] of Object.entries(t.sport_stats || {}) as [string, any][]) {
          const routesSport = pythonToRoutesSport[pythonSport] ?? "Other";
          if (!roiBySportAgg[routesSport]) {
            roiBySportAgg[routesSport] = { roi: 0, tradeCount: 0, winRate: 0, avgBet: 0, medianBet: 0, netProfit: 0, totalCost: 0 };
          }
          const agg = roiBySportAgg[routesSport];
          // Weighted aggregation for soccer leagues that share the "Soccer" bucket
          const prevCost = agg.totalCost;
          const thisCost = (stat.avg_bet || 0) * (stat.events || 0);
          const totalCost = prevCost + thisCost;
          agg.netProfit  += (stat.net_profit || 0);
          agg.totalCost  = totalCost;
          agg.tradeCount += (stat.events   || 0);
          agg.avgBet     = totalCost > 0 ? totalCost / Math.max(agg.tradeCount, 1) : 0;
          // For median: use the sub-league with most events as the representative
          if (stat.events > (agg.tradeCount - stat.events)) {
            agg.medianBet = stat.median_bet || stat.avg_bet || 0;
            agg.winRate   = stat.win_rate || 0;
          }
          agg.roi = agg.totalCost > 0 ? (agg.netProfit / agg.totalCost) * 100 : 0;
        }
        // No caps: store actual ROI/win rate from CSV analysis. Python aggregates by event (position-level).
        const roiBySport: Record<string, any> = {};
        for (const [sport, agg] of Object.entries(roiBySportAgg)) {
          const avgPos = Math.round(agg.avgBet);
          const medPos = Math.round(agg.medianBet || agg.avgBet || 0);
          roiBySport[sport] = {
            roi:        Math.round(agg.roi * 10) / 10,
            tradeCount: agg.tradeCount,
            winRate:    Math.round(agg.winRate * 10) / 10,
            avgBet:     avgPos,
            medianBet:  medPos,
            avgPositionSize: avgPos,
            medianPositionSize: medPos,
          };
        }
        analysisMeta.roiBySport = roiBySport;

        // ── Build roiByMarketType (normalized keys) ───────────────────────────────
        // Python types: "Moneyline / Match", "Totals (O/U)", "Spread", "Futures"
        // Routes types: "moneyline",           "total",        "spread", "futures"
        const pythonToRoutesMkt: Record<string, string> = {
          "Moneyline / Match": "moneyline",
          "Totals (O/U)":      "total",
          "Spread":            "spread",
          "Futures":           "futures",
        };
        const roiByMarketType: Record<string, any> = {};
        for (const [pythonMkt, stat] of Object.entries(t.market_stats || {}) as [string, any][]) {
          const routesMkt = pythonToRoutesMkt[pythonMkt] ?? pythonMkt;
          roiByMarketType[routesMkt] = {
            roi:        stat.roi ?? 0,
            tradeCount: stat.events ?? 0,
            winRate:    stat.win_rate ?? 0,
            avgBet:     stat.avg_bet ?? 0,
            medianBet:  stat.median_bet ?? stat.avg_bet ?? 0,
          };
        }
        analysisMeta.roiByMarketType = roiByMarketType;

        // ── Store sport×marketType deep table (normalized keys) ───────────────────
        // Keys already normalized by Python: "NBA|Moneyline / Match", "Soccer|Totals (O/U)", etc.
        // Translate the market-type portion to routes format for easy lookup.
        if (t.sport_market_stats) {
          const roiBySportMarketType: Record<string, any> = {};
          for (const [key, stat] of Object.entries(t.sport_market_stats) as [string, any][]) {
            const [sport, pythonMkt] = key.split("|");
            const routesMkt = pythonToRoutesMkt[pythonMkt] ?? pythonMkt;
            roiBySportMarketType[`${sport}|${routesMkt}`] = {
              roi:        stat.roi ?? 0,
              tradeCount: stat.events ?? 0,
              winRate:    stat.win_rate ?? 0,
              avgBet:     Math.round(stat.avg_bet ?? 0),
              medianBet:  Math.round(stat.median_bet ?? stat.avg_bet ?? 0),
              avgPositionSize:  Math.round(stat.avg_bet ?? 0),
              medianPositionSize: Math.round(stat.median_bet ?? stat.avg_bet ?? 0),
            };
          }
          analysisMeta.roiBySportMarketType = roiBySportMarketType;
        }

        // Use the Python-computed quality score (Gemini Copy-Trade Metric v2).
        // Python is the authoritative scorer — it includes the Flip/Underdog bonus
        // and Leakage Penalty which cannot be replicated here without full price/sport data.
        // Fall back to re-computing a simplified v2 score only if Python didn't supply one.
        let newQuality: number;
        if (typeof t.quality_score === "number" && t.quality_score > 0) {
          newQuality = t.quality_score;
        } else {
          // v2 simplified fallback (no flip bonus / leakage — treat as conservative floor)
          const roi      = t.overall_roi    || 0;
          const sharpe   = t.pseudo_sharpe  || 0;
          const wr       = t.win_rate       || 0;
          const risked   = t.total_risked   || 0;
          const profDays = t.profitable_days || 0;
          const totDays  = t.total_days      || 1;
          const sharpeScr  = Math.min(Math.max(sharpe / 8  * 30, 0), 30);
          const roiScore   = Math.min(Math.max(roi    / 15 * 25, 0), 25);
          const wrScore    = Math.min(Math.max((wr - 50) / 15 * 15, 0), 15);
          const consScore  = Math.min(Math.max((profDays / totDays) * 10, 0), 10);
          const volScore   = Math.min(Math.max(Math.log10(Math.max(risked, 1)) / Math.log10(5_000_000) * 5, 0), 5);
          newQuality = Math.round(sharpeScr + roiScore + wrScore + consScore + volScore);
        }

        // Store score breakdown if present
        if (t.score_breakdown) analysisMeta.csvScoreBreakdown = t.score_breakdown;

        // Tags from Python — store as-is
        const newTags: string[] = t.tags || [];

        // Upsert profile so traders without a row get one (fixes "Analysis pending")
        await elitePool.query(`
          INSERT INTO elite_trader_profiles (wallet, username, quality_score, tags, metrics, computed_at)
          VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
          ON CONFLICT (wallet) DO UPDATE SET
            username     = EXCLUDED.username,
            quality_score = EXCLUDED.quality_score,
            tags         = EXCLUDED.tags,
            metrics      = COALESCE(elite_trader_profiles.metrics, '{}'::jsonb) || EXCLUDED.metrics,
            computed_at  = NOW()
        `, [wallet, t.username || wallet.slice(0, 10), newQuality, newTags, JSON.stringify(analysisMeta)]);

        // Keep elite_traders.last_analyzed_at in sync so UI and refresh-status show analyzed
        await elitePool.query(
          `UPDATE elite_traders SET last_analyzed_at = NOW() WHERE wallet = $1`,
          [wallet]
        );

        updated++;
        summary.push({
          username:      t.username,
          wallet:        wallet.slice(0, 10),
          tier:          t.tier,
          quality_score: newQuality,
          roi:           t.overall_roi,
          pnl:           t.total_profit,
        });
      }

      // Clear cached trader lists and canonical metrics so signals use new roiBySport/quality
      delete cache["traders-curated-v2-sports"];
      delete cache["traders-curated-v2-all"];
      _canonicalCache = null;
      _canonicalCacheAt = 0;
      invalidateEliteSignalsCache();

      const ranked = summary.sort((a, b) => b.quality_score - a.quality_score);
      console.log(`[IngestAnalysis] Updated ${updated} traders`);
      ranked.forEach((r, i) => console.log(`  #${i+1} ${r.username} — ${r.tier} (Q=${r.quality_score}) ROI=${r.roi?.toFixed(1)}% PnL=$${Math.round(r.pnl || 0).toLocaleString()}`));

      res.json({ updated, summary: ranked });
    } catch (err: any) {
      console.error("[IngestAnalysis] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/traders ────────────────────────────────────────────────────────
  app.get("/api/traders", async (req, res) => {
    try {
      const category = (req.query.category as string) || "sports";
      const cKey     = `traders-curated-v2-${category}`;
      const hit      = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      // ── Curated-only: Return ALL 42 hand-picked elite traders from DB ──────
      // Query every profile in elite_trader_profiles — these are all curated.
      const profileRows = await elitePool.query<{
        wallet: string; username: string; metrics: any; quality_score: number;
      }>(`SELECT wallet, username, metrics, quality_score FROM elite_trader_profiles ORDER BY (metrics->>'overallPNL')::numeric DESC NULLS LAST`);

      const traders: any[] = [];
      for (let i = 0; i < profileRows.rows.length; i++) {
        const row  = profileRows.rows[i];
        const m    = row.metrics ?? {};
        const addr = row.wallet;

        // All metrics from canonical source (closed_positions_api) — accurate and complete
        const pnl         = parseFloat(m.overallPNL    ?? "0");
        const realizedPNL = m.realizedPNL   != null ? parseFloat(m.realizedPNL)    : undefined;
        const unrealizedPNL       = m.unrealizedPNL != null ? parseFloat(m.unrealizedPNL)  : undefined;
        const activeUnrealizedPNL = m.activeUnrealizedPNL != null ? parseFloat(m.activeUnrealizedPNL) : undefined;
        const roi         = parseFloat(m.overallROI   ?? "0");
        const last30dROI  = parseFloat(m.last30dROI   ?? "0");
        const last90dROI  = parseFloat(m.last90dROI   ?? "0");
        const last30dPNL  = parseFloat(m.last30dPNL   ?? "0");
        const last90dPNL  = parseFloat(m.last90dPNL   ?? "0");
        const last30dCount = parseInt(m.last30dCount  ?? "0");
        const last90dCount = parseInt(m.last90dCount  ?? "0");
        const winRate     = parseFloat(m.winRate      ?? m.pnlWinRate ?? "0");
        const winRate30   = parseFloat(m.winRate30    ?? "0");
        const winRate90   = parseFloat(m.winRate90    ?? "0");
        const avgSize     = parseFloat(m.avgBetSize   ?? "0");
        const medianSize  = parseFloat(m.medianBetSize ?? "0");
        const totalInvested = parseFloat(m.totalInvested ?? "0");
        const totalTrades = parseInt(m.totalTrades    ?? m.closedPositionCount ?? "0");
        const pnlSource   = m.pnlSource ?? undefined;
        const closedPositionCount   = m.closedPositionCount  != null ? parseInt(m.closedPositionCount)  : undefined;
        const activeOpenCount       = m.activeOpenCount      != null ? parseInt(m.activeOpenCount)      : undefined;
        const redeemableCount       = m.redeemableCount      != null ? parseInt(m.redeemableCount)      : undefined;
        const redeemableValue       = m.redeemableValue      != null ? parseFloat(m.redeemableValue)    : undefined;
        const monthlyROI  = m.monthlyROI ?? undefined;
        const closedByCategory = m.closedByCategory ?? undefined;
        const qualityScore = row.quality_score ?? 1;
        const tier = pnl >= 500_000 ? "elite" : pnl >= 100_000 ? "pro" : "active";

        traders.push({
          address: addr,
          name: row.username,
          verifiedBadge: true,
          pnl, realizedPNL, unrealizedPNL, activeUnrealizedPNL,
          pnlSource, closedPositionCount, activeOpenCount, redeemableCount, redeemableValue,
          roi, last30dROI, last90dROI, last30dPNL, last90dPNL, last30dCount, last90dCount,
          winRate, winRate30, winRate90,
          avgSize, medianSize, totalInvested,
          positionCount: activeOpenCount ?? 0,
          totalTrades,
          monthlyROI, closedByCategory,
          rank: i + 1,
          qualityScore,
          tier,
          recentForm: "📌 Curated",
          source: "curated",
          polyAnalyticsUrl: `https://polymarketanalytics.com/traders/${addr}`,
        });
      }

      const sorted = traders;

      const result = {
        traders: sorted,
        fetchedAt: Date.now(),
        window: "ALL",
        category,
        source: "curated_elites_v1",
        breakdown: { curated: sorted.length },
      };
      setCache(cKey, result, 5 * 60 * 1000);
      res.json(result);
    } catch (err: any) {
      const msg = formatApiError(err);
      console.error("Traders error:", msg);
      res.status(503).json({ error: msg, traders: [], fetchedAt: Date.now(), window: "ALL", category: "sports" });
    }
  });

  // ── GET /api/markets ────────────────────────────────────────────────────────
  app.get("/api/markets", async (req, res) => {
    try {
      const limit      = Math.min(parseInt((req.query.limit as string) || "150"), 300);
      const type       = (req.query.type as string) || "upcoming"; // upcoming|all|moneyline|spread|total|futures
      const days       = parseInt((req.query.days as string) || "30"); // wider window — game markets are near-term
      const sportsOnly = req.query.sports !== "false";
      const raw = await fetchSportsMarkets();
      const now = Date.now();
      const maxEndMs = now + days * 24 * 3600_000;

      // ── Build markets from Gamma API ─────────────────────────────────────────
      let markets = raw.map(m => {
        const parsed = parseMarket(m);
        const mType  = classifyMarketType(parsed.question);
        const gameStatus = categoriseMarket(parsed.question, parsed.endDate, parsed.gameStartTime, parsed.slug);
        const sharpAction = signalsByMarket.get(parsed.id || parsed.conditionId || "") ?? null;
        return { ...parsed, marketType: mType, gameStatus, sharpAction };
      }).filter(m => {
        if (!m.id || !m.question || !m.active) return false;
        if (sportsOnly && !isSportsRelated(m.question)) return false;
        // Exclude postponed/cancelled/voided markets
        if (isPostponedOrCancelled(m.question, m.active, false)) return false;
        const endMs = m.endDate ? new Date(m.endDate).getTime() : Infinity;
        if (endMs < now - 30 * 60_000) return false; // ended 30+ min ago

        if (type === "futures") {
          return endMs > maxEndMs || isFuturesMarket(m.question);
        } else if (type === "upcoming") {
          if (isFuturesMarket(m.question) && endMs > now + 7 * 24 * 3600_000) return false;
          if (endMs > now + 7 * 24 * 3600_000) return false;
          return true;
        } else if (type === "all") {
          return true;
        } else {
          // moneyline / spread / total — wide window (7 days)
          if (endMs > now + 7 * 24 * 3600_000) return false;
          return true;
        }
      });

      // ── Supplement with game markets from position registry ──────────────────
      // The Gamma API sorts by popularity; today's game markets often don't appear.
      // The game market registry is populated from elite trader positions (see signals route).
      if (type !== "futures" && gameMarketRegistry.size > 0) {
        const existingIds = new Set(markets.map(m => m.id));
        for (const [condId, entry] of gameMarketRegistry.entries()) {
          if (existingIds.has(condId)) continue;
          const endMs = entry.endDate ? new Date(entry.endDate).getTime() : Infinity;
          if (endMs < now - 30 * 60_000) continue;
          if (sportsOnly && !isSportsRelated(entry.question)) continue;

          // For upcoming/game tabs, only include near-term markets
          if (type === "upcoming" && endMs > now + 7 * 24 * 3600_000) continue;
          if ((type === "moneyline" || type === "spread" || type === "total") && endMs > now + 7 * 24 * 3600_000) continue;

          // Apply market type filter
          if (type === "moneyline" && entry.marketType !== "moneyline") continue;
          if (type === "spread" && entry.marketType !== "spread") continue;
          if (type === "total" && entry.marketType !== "total") continue;

          const sharpForReg = signalsByMarket.get(condId);
          markets.push({
            id: condId,
            question: entry.question,
            slug: entry.slug,
            endDate: entry.endDate,
            gameStartTime: entry.gameStartTime,
            currentPrice: entry.currentPrice ?? 0.5,
            volume: entry.volume ?? 0,
            liquidity: entry.liquidity ?? 0,
            active: entry.active,
            marketType: entry.marketType,
            gameStatus: entry.gameStatus,
            category: "sports",
            sharpAction: sharpForReg ?? null,
          } as any);
        }
      }

      // Apply specific market type filter (Gamma API results only — registry already filtered above)
      if (type === "moneyline") markets = markets.filter(m => m.marketType === "moneyline");
      else if (type === "spread")    markets = markets.filter(m => m.marketType === "spread");
      else if (type === "total")     markets = markets.filter(m => m.marketType === "total");

      // Sort by soonest game start (or endDate fallback). Many sports markets use endDate = midnight
      // after the game — sorting by endDate alone pushes "today" games behind unrelated markets.
      const soonestMs = (m: { gameStartTime?: string; endDate?: string }) => {
        if (m.gameStartTime) {
          const t = new Date(m.gameStartTime).getTime();
          if (!Number.isNaN(t)) return t;
        }
        if (m.endDate) {
          const t = new Date(m.endDate).getTime();
          if (!Number.isNaN(t)) return t;
        }
        return Infinity;
      };
      if (type === "upcoming" || type === "moneyline" || type === "spread" || type === "total") {
        markets.sort((a, b) => {
          const aT = soonestMs(a);
          const bT = soonestMs(b);
          if (aT === Infinity && bT === Infinity) return (b.volume || 0) - (a.volume || 0);
          return aT - bT;
        });
      } else {
        markets.sort((a, b) => (b.volume || 0) - (a.volume || 0));
      }

      res.json({ markets: markets.slice(0, limit), fetchedAt: Date.now(), total: markets.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message, markets: [], fetchedAt: Date.now(), total: 0 });
    }
  });

  // ── GET /api/markets/search ── Full Polymarket text search ──────────────────
  // Fetches a wider market pool (3 parallel Gamma batches = up to 2400 markets)
  // and does local text filtering. Gamma's q= param is not reliable for search.
  app.get("/api/markets/search", async (req, res) => {
    try {
      const q = ((req.query.q as string) || "").trim();
      if (q.length < 2) { res.json({ markets: [], fetchedAt: Date.now(), total: 0 }); return; }

      // Fetch wider pool: 3 parallel batches with offset. Cache for 10 min.
      const cacheKey = "markets-search-pool";
      let pool = getCache<any[]>(cacheKey);
      if (!pool) {
        const offsets = [0, 800, 1600];
        const batches = await Promise.all(
          offsets.map(offset =>
            fetchWithRetry(`${GAMMA_API}/markets?active=true&closed=false&limit=800&offset=${offset}`)
              .then(r => r.ok ? r.json() : [])
              .then((d: any) => Array.isArray(d) ? d : (d?.data ?? []))
              .catch(() => [])
          )
        );
        // Deduplicate by conditionId
        const seen = new Set<string>();
        pool = [];
        for (const batch of batches) {
          for (const m of batch) {
            const id = m.conditionId || m.id;
            if (id && !seen.has(id)) { seen.add(id); pool.push(m); }
          }
        }
        setCache(cacheKey, pool, 10 * 60_000);
      }

      const now = Date.now();
      const lq = q.toLowerCase();
      const results: any[] = [];
      for (const m of pool) {
        const question = m.question || m.title || "";
        if (!question.toLowerCase().includes(lq)) continue;
        if (m.active === false || m.closed === true) continue;
        const endMs = m.endDate ? new Date(m.endDate).getTime() : Infinity;
        if (endMs < now - 30 * 60_000) continue;
        const parsed = parseMarket(m);
        const mType = classifyMarketType(parsed.question);
        const gameStatus = categoriseMarket(parsed.question, parsed.endDate, parsed.gameStartTime, parsed.slug);
        const sharpAction = signalsByMarket.get(parsed.id || parsed.conditionId || "") ?? null;
        results.push({ ...parsed, marketType: mType, gameStatus, sharpAction });
        if (results.length >= 60) break;
      }
      results.sort((a, b) => (b.volume || 0) - (a.volume || 0));
      res.json({ markets: results, fetchedAt: Date.now(), total: results.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message, markets: [], fetchedAt: Date.now(), total: 0 });
    }
  });

  // ── GET /api/orderbook ─── Live CLOB order book for a token ────────────────
  app.get("/api/orderbook", async (req, res) => {
    try {
      const tokenId = req.query.tokenId as string;
      if (!tokenId) { res.status(400).json({ error: "tokenId required" }); return; }
      const cKey = `ob-${tokenId}`;
      const hit  = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }
      const r = await fetchWithRetry(`${CLOB_API}/book?token_id=${tokenId}`);
      if (!r.ok) { res.status(r.status).json({ error: "No orderbook for this token" }); return; }
      const data = await r.json();
      setCache(cKey, data, 15_000); // 15s cache
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/alerts/live ─── Recent big trades from tracked traders ──────────
  app.get("/api/alerts/live", async (req, res) => {
    try {
      const cKey = "live-alerts-v3";
      const hit  = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      const now = Date.now();
      const [allTrades, allSportsLb, curatedRowsHttp] = await Promise.all([
        fetchMergedAlertsTradeFeed(),
        fetchMultiWindowSportsLB(),
        elitePool.query(`SELECT wallet FROM elite_traders`).catch(() => ({ rows: [] as any[] })),
      ]);
      const curatedSetHttp = new Set<string>((curatedRowsHttp.rows || []).map((r: any) => r.wallet.toLowerCase()));

      // Build name map from curated + discovered (takes priority over LB names)
      const curatedNameMap = new Map<string, string>([
        ...CURATED_ELITES.map(e => [e.addr.toLowerCase(), e.name] as [string, string]),
        ...DISCOVERED_ELITES.filter(d => d.wallet).map(d => [d.wallet.toLowerCase(), d.username] as [string, string]),
      ]);

      const lbMap = new Map<string, { name: string; pnl: number; roi: number; qualityScore: number; isSportsLb: boolean }>();
      for (const t of allSportsLb) {
        const w = (t.proxyWallet || "").toLowerCase();
        if (!w || lbMap.has(w)) continue;
        const roi = parseFloat(t.roi ?? t.profit ?? "0");
        lbMap.set(w, {
          name: t.userName || truncAddr(w),
          pnl: parseFloat(t.pnl || "0"),
          roi,
          qualityScore: Math.min(60, Math.max(10, Math.floor(roi))),
          isSportsLb: true,
        });
      }

      const alerts: any[] = [];
      const seen = new Set<string>();
      const alertScanHttp = [...allTrades].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      for (const trade of alertScanHttp) {
        const wallet = (trade.proxyWallet || "").toLowerCase();
        if (MARKET_MAKER_WALLETS.has(wallet)) continue;
        const isCuratedHttp = curatedSetHttp.has(wallet);
        const size = parseFloat(trade.size || trade.amount || "0");

        // Must be in elite_traders (curated + discovered seeds); no random anonymous whales
        if (!isCuratedHttp) continue;
        if (size < 1000) continue; // minimum $1K plays
        const tradeSide = (trade.side || "").toUpperCase();
        if (tradeSide === "SELL") continue; // exits / closing — not new conviction
        // Only explicit BUY adds to a position. Missing/unknown side can be merges or odd API rows.
        if (tradeSide !== "BUY") continue;

        const title = trade.title || trade.market || "";
        if (!isSportsRelated(title)) continue;
        if (!title) continue;

        const price = parseFloat(trade.price || "0.5");
        if (price < 0.10 || price > 0.90) continue; // skip extreme/junk prices

        const key = `${trade.conditionId || "?"}-${wallet}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const trader = lbMap.get(wallet);
        const side = resolveSide(trade.outcome, trade.outcomeIndex);
        const ts    = tradeTimestampMs(trade);
        if (ts <= 0) continue;
        const alertCondId = trade.conditionId || "";
        const alertDbEntry = sharedMarketDb.get(alertCondId);
        // Skip postponed/inactive markets
        if (alertDbEntry && !alertDbEntry.active) continue;
        if (isPostponedOrCancelled(title, true, false)) continue;
        const alertEndDate = trade.endDate || alertDbEntry?.endDate;

        const displayName = curatedNameMap.get(wallet) || trader?.name || truncAddr(wallet);
        alerts.push({
          id: `alert-${trade.id || key}`,
          trader: displayName,
          wallet,
          isTracked: true, // all alerts are now curated elites
          isSportsLb: trader?.isSportsLb ?? false,
          isCurated: true,
          qualityScore: trader?.qualityScore ?? 0,
          roi: trader?.roi ?? 0,
          market: title.slice(0, 80),
          slug: trade.slug,
          conditionId: alertCondId,
          side,
          size: Math.round(size),
          price: Math.round(price * 1000) / 1000,
          americanOdds: toAmericanOdds(price),
          gameStatus: categoriseMarket(title, alertEndDate, alertDbEntry?.gameStartTime, trade.slug || alertDbEntry?.slug),
          gameStartTime: alertDbEntry?.gameStartTime,
          endDate: alertEndDate,
          timestamp: ts,
          minutesAgo: Math.round((now - ts) / 60_000),
          outcomeLabel: computeOutcomeLabel(title, side),
          // One registry entry per marketId = ONE side's consensus. Do not attach to trades on the opposite side.
          sharpAction: (() => {
            const sa = signalsByMarket.get(alertCondId) ?? null;
            if (!sa) return null;
            return sa.side === side ? sa : null;
          })(),
        });

        if (alerts.length >= 40) break;
      }

      // Recency-first + max 3 rows per wallet in the top 30 — old behavior sorted by $ size so the same
      // whales (largest stakes) always floated to the top and looked like "only those traders exist."
      const diversified = diversifyLiveAlertsByWallet(alerts, 30, 3);
      console.log(`[LiveAlerts] ${alerts.length} candidates → ${diversified.length} after diversify (max 3/wallet, recency-priority)`);

      const result = { alerts: diversified, fetchedAt: now };
      setCache(cKey, result, 20_000); // 20s cache — keeps it near-live
      res.json(result);
    } catch (err: any) {
      console.error("Live alerts error:", err.message);
      res.status(500).json({ alerts: [], fetchedAt: Date.now(), error: err.message });
    }
  });

  // ── GET /api/signals ─── Elite signals v11: verified sports traders only ────
  // Query: sports (default true), minConfidence (e.g. 70 = best-of-best), minQuality, tier (HIGH|MED|SINGLE)
  app.get("/api/signals", async (req, res) => {
    try {
      const sportsOnly = req.query.sports !== "false";
      const minConfidence = req.query.minConfidence != null ? parseInt(String(req.query.minConfidence), 10) : undefined;
      const minQuality = req.query.minQuality != null ? parseInt(String(req.query.minQuality), 10) : undefined;
      const tierFilter = (req.query.tier as string)?.toUpperCase(); // HIGH | MED | SINGLE
      const hasFilter = minConfidence != null || minQuality != null || (tierFilter && ["HIGH", "MED", "SINGLE"].includes(tierFilter));
      const cKey = hasFilter ? null : `signals-elite-v56-vip-premium-${sportsOnly ? "sp" : "all"}`;
      const hit  = cKey ? getCache<unknown>(cKey) : null;
      if (hit) { res.json(hit); return; }

      const now = Date.now();

      // ── Phase 1: curated + DISCOVERED_ELITES (Q-gated) + every wallet in elite_traders (DB roster) ──
      const [allSportsLb, marketDb, canonicalMap, dbRosterWallets] = await Promise.all([
        fetchMultiWindowSportsLB().catch(() => [] as any[]),
        buildMarketDatabase(800),
        loadCanonicalMetricsFromDB(),
        loadEliteTraderWalletsFromDatabase(),
      ]);
      const signalSourceWallets = mergeSignalSourceWallets(canonicalMap, dbRosterWallets);
      const signalRosterSet = new Set(signalSourceWallets.map(w => w.addr.toLowerCase()));
      const tradeBatches = await runWithConcurrency(
        signalSourceWallets.map(w => () => fetchEliteTraderTrades(w.addr, UNIFIED_SIGNAL_TRADES_DEPTH)),
        8,
      );
      // Ensure positions exist for confirmation gate (cold start / new LB wallet before interval refresh).
      const missingPosWallets = signalSourceWallets.filter(w => !livePositionCache.has(w.addr.toLowerCase()));
      if (missingPosWallets.length > 0) {
        const filled = await runWithConcurrency(
          missingPosWallets.map(w => async () => {
            const positions = await fetchAllPositionsFull(w.addr);
            return { wallet: w.addr.toLowerCase(), positions };
          }),
          8
        );
        for (const { wallet, positions } of filled) livePositionCache.set(wallet, positions);
      }
      const curatedPositionBatches: any[][] = signalSourceWallets.map(
        e => livePositionCache.get(e.addr.toLowerCase()) || []
      );

      // Build position lookup: wallet → asset_token_id → {shares, avgPrice, costBasis, side}
      // Keyed by TOKEN ASSET ID (not conditionId) because the conditionId in the positions API
      // differs from the conditionId in the trades API for the same market. The asset token ID
      // is consistent across both APIs and uniquely identifies each YES/NO token.
      // costBasis = initialValue = actual USDC spent to acquire these shares.
      type PosData = { shares: number; avgPrice: number; costBasis: number; side: "YES"|"NO" };
      const posLookup = new Map<string, Map<string, PosData>>();
      for (let pi = 0; pi < signalSourceWallets.length; pi++) {
        const wallet = signalSourceWallets[pi].addr.toLowerCase();
        const positions: any[] = curatedPositionBatches[pi] || [];
        const wMap = new Map<string, PosData>();
        for (const pos of positions) {
          const asset = String(pos.asset || "").trim();
          if (!asset) continue;
          const shares = parseFloat(pos.size || "0");
          if (shares <= 0) continue;
          const avgPrice = parseFloat(pos.avgPrice ?? "0") || 0.5;
          // initialValue = USDC cost basis (shares × avg price), most accurate risk figure
          const costBasis = parseFloat(pos.initialValue ?? "0") || shares * avgPrice;
          const side = resolveSide(pos.outcome, pos.outcomeIndex);
          wMap.set(asset, { shares, avgPrice, costBasis, side });
        }
        posLookup.set(wallet, wMap);
      }

      // allTrades = merged trades from curated + vetted discovered (deduplicated)
      const allTrades: any[] = [];
      const seenTxHashes = new Set<string>();
      for (const batch of tradeBatches) {
        for (const trade of (batch as any[])) {
          const txHash = trade.transactionHash;
          if (txHash && seenTxHashes.has(txHash)) continue;
          if (txHash) seenTxHashes.add(txHash);
          allTrades.push(trade);
        }
      }
      // Sort oldest→newest so sells always come AFTER the buys they offset
      allTrades.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      type TraderInfo = { name: string; pnl: number; roi: number; volume: number; qualityScore: number; isLeaderboard: boolean; isSportsLb: boolean; source: SharedTraderEntry["source"] };
      const lbMap = new Map<string, TraderInfo>();

      // ── Elite roster (merged list): quality from canonical DB; specialty weighting applied later in gates ──
      for (const s of signalSourceWallets) {
        const addr = s.addr.toLowerCase();
        const dbQuality = canonicalMap.get(addr)?.qualityScore ?? 0;
        const qualityScore = dbQuality > 0 ? dbQuality : 45;
        lbMap.set(addr, {
          name: s.name,
          pnl: 0,
          roi: 0,
          volume: 0,
          qualityScore,
          isLeaderboard: true,
          isSportsLb: true,
          source: "discovered",
        });
      }

      // ── Add sports LB traders to lbMap for cluster detection ─────────────────
      // These are NOT curated but ARE tracked; needed so cluster detection can
      // find 2+ non-curated LB traders co-investing in the same market.
      for (const t of allSportsLb) {
        const w = (t.proxyWallet || "").toLowerCase();
        if (!w || lbMap.has(w)) continue; // don't overwrite curated traders
        const roi = parseFloat(t.roi ?? t.profit ?? "0");
        lbMap.set(w, {
          name: t.userName || truncAddr(w),
          pnl: parseFloat(t.pnl || "0"),
          roi,
          volume: 0,
          qualityScore: Math.min(60, Math.max(10, Math.floor(roi))),
          isLeaderboard: true,
          isSportsLb: true,
          source: "sports_lb",
        });
      }

      // recentSportsBettors — empty since we don't scan 20K random trades anymore
      const recentSportsBettors = new Map<string, { count: number; totalSize: number; name: string; source?: string }>();

      console.log(
        `[Elite v11] ${lbMap.size} tracked traders | signal sources: ${signalSourceWallets.length} merged (curated + DB roster + discovered Q≥${DISCOVERED_MIN_QUALITY_FOR_SIGNALS}) | ${allTrades.length} trades | ${marketDb.size} markets`,
      );

      // Populate module-level sharedMarketDb for alerts functions (non-blocking, best-effort)
      sharedMarketDb.clear();
      for (const [k, v] of marketDb) {
        sharedMarketDb.set(k, v);
        // Also populate the slug→GST lookup so O/U and spread market variants can
        // inherit gameStartTime from their base game slug.
        if (v.slug && v.gameStartTime) {
          const bs = baseGameSlug(v.slug);
          gameSlugToGST.set(v.slug, v.gameStartTime);
          if (bs !== v.slug) gameSlugToGST.set(bs, v.gameStartTime); // index by base too
        }
      }
      // Trigger ESPN refresh now that sharedMarketDb has slugs populated.
      // This ensures ESPN live-status is current for the NEXT signal generation
      // cycle (after the 2-min cache expires), especially important on startup
      // where the initial ESPN refresh runs before market data is loaded.
      refreshESPNLiveGames().catch(() => {});

      // Populate module-level sharedTraderMap for /api/traders endpoint.
      // Refresh if stale (older than 10 min) or if we have more traders now.
      if (Date.now() - sharedTraderMapUpdatedAt > 10 * 60_000 || lbMap.size > sharedTraderMap.size) {
        sharedTraderMap.clear();
        for (const [addr, info] of lbMap) {
          sharedTraderMap.set(addr, {
            name: info.name, pnl: info.pnl, roi: info.roi,
            volume: info.volume, qualityScore: info.qualityScore,
            isLeaderboard: info.isLeaderboard, isSportsLb: info.isSportsLb,
            source: info.source,
          });
        }
        sharedTraderMapUpdatedAt = Date.now();
        console.log(`[SharedMap] Updated with ${sharedTraderMap.size} traders`);
      }

      // ── Phase 2: Aggregate positions ─────────────────────────────────────────
      // Tracked traders: include bets >= $200
      // Non-tracked wallets: include bets >= $500 (large enough to signal conviction)
      const LARGE_BET_THRESHOLD = 500;
      const MIN_POSITION_SIZE = 200; // minimum bet to include at all

      type WalletPos = {
        side: "YES"|"NO"; totalSize: number; prices: number[];
        name: string; traderInfo: TraderInfo; address: string;
        asset: string; lastTimestamp: number;
      };
      /** Extract "YYYY-MM-DD" from slugs like "nba-bos-mia-2026-03-10" — use as endDate fallback */
      function slugDateFallback(slug?: string): string | undefined {
        if (!slug) return undefined;
        const m = slug.match(/(\d{4}-\d{2}-\d{2})/);
        if (!m) return undefined;
        // Polymarket games end the day AFTER the slug date (resolution buffer)
        const d = new Date(m[1] + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString();
      }

      const marketWallets = new Map<string, {
        question: string; slug?: string; condId: string; endDate?: string;
        yesTokenId?: string; noTokenId?: string;
        wallets: Map<string, WalletPos>;
      }>();

      for (const trade of allTrades) {
        const size = parseFloat(trade.size || "0");
        if (size < MIN_POSITION_SIZE) continue;

        const title = (trade.title || trade.slug || "").toLowerCase();
        if (sportsOnly && !isSportsRelated(title)) continue;
        if (title.includes("up or down")) continue; // filter crypto noise
        if (/\d+m(in)?\.?\s*(up|down)/i.test(title)) continue; // crypto minute markets

        const condId = trade.conditionId || "";
        if (!condId) continue;

        // Collect sports event slugs for ESPN background refresh BEFORE any filtering.
        // trade.slug is the true Polymarket event slug (e.g. "nhl-ana-ott-2026-03-14-total-6pt5"),
        // which is what ESPN lookups need. Must be collected before the stale/closed-market gates.
        {
          const es = trade.slug || "";
          if (es && /^(nba|nhl|nfl|mlb|ncaab|ncaaf)-/.test(es)) {
            seenEventSlugs.add(es);
            const bs = baseGameSlug(es);
            if (bs !== es) seenEventSlugs.add(bs);
          }
        }

        // Use market DB for enrichment (tokenIds, slug, endDate)
        // NOT as a hard gate — game markets close quickly and won't be in active DB
        const mInfo = marketDb.get(condId);
        // Only skip if we KNOW the market is confirmed-closed
        if (mInfo && !mInfo.active) continue;

        const wallet = (trade.proxyWallet || "").toLowerCase();
        const isTracked = lbMap.has(wallet);

        // Gate: tracked trader OR large bet
        if (!isTracked && size < LARGE_BET_THRESHOLD) continue;

        const side: "YES"|"NO" = resolveSide(trade.outcome, trade.outcomeIndex);
        const price = parseFloat(trade.price || "0.5");
        const asset = String(trade.asset || "");

        const lb = lbMap.get(wallet);
        const traderInfo: TraderInfo = lb ?? {
          name: displayName(trade.pseudonym || trade.name || "", wallet),
          pnl: 0, roi: 0, volume: 0, isLeaderboard: false, isSportsLb: false,
          qualityScore: Math.min(35, Math.round(Math.log10(size + 1) * 7)),
          source: "curated",
        };

        if (!marketWallets.has(condId)) {
          const mSlug = mInfo?.slug || trade.slug;
          const mEndDate = mInfo?.endDate || trade.endDate || slugDateFallback(mSlug);
          // Skip markets whose end date has passed — these are resolved games
          if (mEndDate && new Date(mEndDate).getTime() < now) continue;
          marketWallets.set(condId, {
            question: mInfo?.question || trade.title || condId,
            slug: mSlug,
            condId,
            endDate: mEndDate,
            wallets: new Map(),
          });
        }
        const mw = marketWallets.get(condId)!;
        if (asset) {
          if (side === "YES" && !mw.yesTokenId) mw.yesTokenId = asset;
          if (side === "NO"  && !mw.noTokenId)  mw.noTokenId  = asset;
        }
        // Also try tokenIds from market DB
        if (mInfo?.tokenIds && mInfo.tokenIds.length >= 2) {
          if (!mw.yesTokenId) mw.yesTokenId = mInfo.tokenIds[0];
          if (!mw.noTokenId)  mw.noTokenId  = mInfo.tokenIds[1];
        }

        const tradeTs = tradeTimestampMs(trade);
        // "BUY" adds to net position; "SELL" reduces it (trader exiting)
        const isSellTrade = (trade.side || "").toUpperCase() === "SELL";
        const ex = mw.wallets.get(wallet);
        if (!ex) {
          if (!isSellTrade) {
            mw.wallets.set(wallet, { side, totalSize: size, prices: [price], name: traderInfo.name, traderInfo, address: wallet, asset, lastTimestamp: tradeTs });
          }
        } else {
          if (ex.side === side) {
            ex.totalSize += isSellTrade ? -size : size;
            if (!isSellTrade) { ex.prices.push(price); ex.lastTimestamp = Math.max(ex.lastTimestamp, tradeTs); }
          } else if (!isSellTrade && size > ex.totalSize) {
            // Flip side on new dominant buy
            ex.side = side; ex.totalSize = size; ex.prices = [price]; ex.lastTimestamp = tradeTs;
          }
        }
      }

      // Remove wallets that have fully exited (net position sold to zero or below)
      for (const mw of marketWallets.values()) {
        for (const [w, pos] of mw.wallets.entries()) {
          if (pos.totalSize <= 0) mw.wallets.delete(w);
        }
      }

      // ── Merge **all** qualifying open positions: sort each wallet by (stake ÷ lane-normal) so
      // outsized conviction surfaces first; no arbitrary "top 200 by $" cap.
      const tokenIdToCondId = new Map<string, string>();
      for (const [condId, mInfo] of marketDb) {
        if (mInfo?.tokenIds) for (const tid of mInfo.tokenIds) if (tid) tokenIdToCondId.set(tid, condId);
      }
      type PosMerge = { asset: string; posData: PosData; condId: string; mInfo: any; costBasis: number };
      const byWallet = new Map<string, PosMerge[]>();
      for (const [wallet, wMap] of posLookup) {
        const traderInfo = lbMap.get(wallet);
        if (!traderInfo) continue;
        const list: PosMerge[] = [];
        for (const [asset, posData] of wMap) {
          if (posData.shares <= 0) continue;
          const condId = tokenIdToCondId.get(asset);
          if (!condId) continue;
          const mInfo = marketDb.get(condId);
          if (!mInfo || (mInfo as any).active === false) continue;
          if (sportsOnly && !isSportsRelated((mInfo as any).question || "")) continue;
          if (mInfo.endDate && new Date(mInfo.endDate).getTime() < now) continue;
          const costBasis = posData.costBasis || posData.shares * posData.avgPrice;
          if (costBasis < MIN_POSITION_SIZE) continue;
          list.push({ asset, posData, condId, mInfo, costBasis });
        }
        if (list.length > 0) {
          const cm = canonicalMap.get(wallet);
          list.sort((a, b) => positionRelVsNormal(b, cm) - positionRelVsNormal(a, cm));
          byWallet.set(wallet, list);
        }
      }
      for (const [wallet, list] of byWallet) {
        const traderInfo = lbMap.get(wallet)!;
        for (const { asset, posData, condId, mInfo, costBasis } of list) {
          if (!marketWallets.has(condId)) {
            marketWallets.set(condId, {
              question: (mInfo as any).question || condId,
              slug: (mInfo as any).slug,
              condId,
              endDate: (mInfo as any).endDate,
              yesTokenId: (mInfo as any).tokenIds?.[0],
              noTokenId: (mInfo as any).tokenIds?.[1],
              wallets: new Map(),
            });
          }
          const mw = marketWallets.get(condId)!;
          const existing = mw.wallets.get(wallet);
          if (existing) {
            existing.totalSize = costBasis;
            existing.prices = [posData.avgPrice];
            existing.side = posData.side;
            existing.asset = asset;
            // Keep lastTimestamp from the trades ingest pass — it reflects real fill time.
            // (Using `now` here made every trader show "entered ~1m ago" on each /api/signals refresh.)
          } else {
            mw.wallets.set(wallet, {
              side: posData.side,
              totalSize: costBasis,
              prices: [posData.avgPrice],
              name: traderInfo.name,
              traderInfo,
              address: wallet,
              asset,
              // No trade row for this market in the recent batch — we don't have a true entry time from the API here.
              lastTimestamp: 0,
            });
          }
        }
      }

      console.log(`[Elite v11] ${marketWallets.size} markets with qualified trades/positions`);

      // Load profile metrics for CSV-derived doNotTail/autoTail (re-analyzed each run)
      const metricsByWallet = new Map<string, Record<string, any>>();
      try {
        const profileRows = await elitePool.query<{ wallet: string; metrics: Record<string, any> }>(
          `SELECT wallet, metrics FROM elite_trader_profiles`,
        );
        for (const r of profileRows.rows) metricsByWallet.set(r.wallet.toLowerCase(), r.metrics || {});
      } catch (e) {
        console.warn("[signals] elite_trader_profiles unavailable (category filters degraded):", formatApiError(e));
      }

      // ── Phase 3: Generate signals with strict quality gates ──────────────────
      const signals: any[] = [];
      const SLIPPAGE = 0.02;
      const MIN_LIVE_PRICE  = 0.10;
      const MAX_LIVE_PRICE  = 0.90;
      const MIN_RESOLVED    = 0.02;  // below 2¢ or above 98¢ = market resolved / dead
      const MAX_RESOLVED    = 0.98;

      // Batch-fetch all CLOB midpoints (one/few POSTs instead of N GETs) — faster and under rate limit.
      const allTokenIds = new Set<string>();
      for (const mw of marketWallets.values()) {
        if (mw.yesTokenId) allTokenIds.add(mw.yesTokenId);
        if (mw.noTokenId) allTokenIds.add(mw.noTokenId);
      }
      const midpointMap = allTokenIds.size > 0 ? await fetchMidpointsBatch([...allTokenIds]) : new Map<string, number>();

      for (const [condId, mw] of marketWallets.entries()) {
        if (!mw.question || mw.question === condId) continue;

        const mInfoBand = marketDb.get(condId);
        const mTypeBand = categoriseMarket(mw.question, mw.endDate || mInfoBand?.endDate, mInfoBand?.gameStartTime, mw.slug || mInfoBand?.slug);
        const entryVsLiveBand = mTypeBand === "live" ? ENTRY_VS_LIVE_MAX_INPLAY : ENTRY_VS_LIVE_MAX;

        const entries = Array.from(mw.wallets.values());
        if (entries.length === 0) continue;

        // ── Apply category filters (CSV-derived when present, else hardcoded) before forming dominant ──
        const signalSportEarly = classifySport(mw.slug || "", mw.question || "");
        const signalSportDetailedEarly = classifySportFull(signalSportEarly, mw.question || "", mw.slug || "");
        const marketCategoryEarly = classifyMarketType(mw.question || "");
        const qLower = (mw.question || "").toLowerCase();
        const filteredEntries = entries.filter(e => {
          const cat = getEffectiveCategoryFilter(e.address.toLowerCase(), metricsByWallet.get(e.address.toLowerCase()));
          if (!cat) return true;
          if (cat.doNotTail?.length && (cat.doNotTail.includes(signalSportDetailedEarly) || cat.doNotTail.includes(signalSportEarly))) return false;
          if (cat.doNotTailMarketTypes?.length && cat.doNotTailMarketTypes.includes(marketCategoryEarly)) return false;
          if (cat.doNotTailTitleKeywords?.length && cat.doNotTailTitleKeywords.some(kw => qLower.includes(kw.toLowerCase()))) return false;
          return true;
        });
        if (filteredEntries.length === 0) continue;

        const yesE = filteredEntries.filter(e => e.side === "YES");
        const noE  = filteredEntries.filter(e => e.side === "NO");
        let dominant = yesE.length >= noE.length ? yesE : noE;
        const counterEntries = yesE.length >= noE.length ? noE : yesE;
        const side: "YES"|"NO" = yesE.length >= noE.length ? "YES" : "NO";
        // Exclude traders who have no edge on this side (e.g. 0p0joggg doNotTailSides: Yes)
        dominant = dominant.filter(e => {
          const cat = getEffectiveCategoryFilter(e.address.toLowerCase(), metricsByWallet.get(e.address.toLowerCase()));
          if (!cat?.doNotTailSides?.length) return true;
          const norm = side === "YES" ? "Yes" : "No";
          return !cat.doNotTailSides.includes(norm);
        });
        if (dominant.length === 0) continue;

        // ── Enrich each dominant entry with actual open-position data ────────────
        // The trades path only captures recent trades; positions API has exact current holdings.
        // We require at least one dominant entry to have a current position (same side, shares > 0)
        // so we never alert on the wrong side or after the trader has sold.
        type PosEnriched = (typeof dominant[0]) & { actualShares: number; actualAvgPrice: number; actualRisk: number; positionConfirmed: boolean };
        let dominantEnriched: PosEnriched[] = dominant.map(e => {
          const wPos = posLookup.get(e.address.toLowerCase());
          const pos  = wPos?.get(String(e.asset));
          const confirmed = !!(pos && pos.side === e.side && pos.shares > 0);
          if (confirmed) {
            return { ...e, actualShares: pos!.shares, actualAvgPrice: pos!.avgPrice, actualRisk: pos!.costBasis, positionConfirmed: true };
          }
          const tradeAvgP = e.prices.reduce((a, b) => a + b, 0) / Math.max(e.prices.length, 1);
          return { ...e, actualShares: e.totalSize / Math.max(tradeAvgP, 0.01), actualAvgPrice: tradeAvgP, actualRisk: e.totalSize, positionConfirmed: false };
        });

        // Only emit signal if at least one dominant trader still holds this position (correct side, not sold).
        const positionConfirmedCount = dominantEnriched.filter(e => e.positionConfirmed).length;
        if (positionConfirmedCount === 0) continue;

        // Live midpoint: drop any trader whose avg entry is >5¢ from the CURRENT book (legacy stacks at 7¢/29¢ when the token is 40¢+).
        const liveTokenId = side === "YES" ? mw.yesTokenId : mw.noTokenId;
        if (!liveTokenId) continue;
        const midFresh = await fetchMidpointUncached(liveTokenId);
        const midRaw = midFresh !== null && Number.isFinite(midFresh) ? midFresh : midpointMap.get(liveTokenId);
        if (midRaw === undefined) continue;
        let currentPrice = midRaw;
        if (currentPrice < MIN_RESOLVED || currentPrice > MAX_RESOLVED) continue;
        currentPrice = Math.min(0.99, Math.max(0.01, currentPrice));
        if (currentPrice < MIN_LIVE_PRICE || currentPrice > MAX_LIVE_PRICE) continue;

        dominantEnriched = dominantEnriched.filter(e => Math.abs(e.actualAvgPrice - currentPrice) <= entryVsLiveBand);
        if (dominantEnriched.length === 0) continue;
        const keepVsLive = new Set(dominantEnriched.map(e => e.address.toLowerCase()));
        dominant = dominant.filter(e => keepVsLive.has(e.address.toLowerCase()));
        if (dominantEnriched.filter(e => e.positionConfirmed).length === 0) continue;

        const totalDominantSize = dominantEnriched.reduce((s, e) => s + e.actualRisk, 0);
        const lbCount     = dominant.filter(e => e.traderInfo.isLeaderboard).length;
        const sportsLbCount = dominant.filter(e => (e.traderInfo as any).isSportsLb).length;

        // VIP premium: high-Q + confirmed book + strong lane ROI + size — do not drop on noisy cluster stats.
        const sportMktEarly = `${signalSportDetailedEarly}|${marketCategoryEarly}`;
        const parentSportMktEarly = `${signalSportEarly}|${marketCategoryEarly}`;
        let vipPremiumStake = 0;
        let vipPremiumRaw = false;
        for (const e of dominantEnriched) {
          const cm = canonicalMap.get(e.address.toLowerCase());
          const q = (cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : 0;
          if (q < VIP_PREMIUM_MIN_Q || !e.positionConfirmed || e.actualRisk < VIP_PREMIUM_MIN_USD_TRADES) continue;
          const catV = getEffectiveCategoryFilter(e.address.toLowerCase(), metricsByWallet.get(e.address.toLowerCase()));
          if (catV?.doNotTail?.length && (catV.doNotTail.includes(signalSportDetailedEarly) || catV.doNotTail.includes(signalSportEarly))) continue;
          const { roi: laneRoi, sampleOk } = traderSpecialtyLaneROI(cm, sportMktEarly, parentSportMktEarly, signalSportDetailedEarly, signalSportEarly);
          if (!sampleOk) continue;
          const meetsEdge = laneRoi >= VIP_SPECIALTY_ROI_MIN
            || (laneRoi >= VIP_ALT_ROI_FOR_HUGE && e.actualRisk >= VIP_HUGE_STAKE_TRADES);
          if (meetsEdge) {
            vipPremiumRaw = true;
            vipPremiumStake += e.actualRisk;
          }
        }
        const vipPremiumDominates = totalDominantSize > 0 && (vipPremiumStake / totalDominantSize) >= VIP_DOMINATE_RISK_FRAC;
        const vipPremiumHuge = vipPremiumRaw && vipPremiumStake >= VIP_HUGE_STAKE_TRADES;
        const vipBypassCluster = vipPremiumDominates || vipPremiumHuge;
        const vipPassMinGate = vipPremiumRaw && totalDominantSize >= VIP_PREMIUM_MIN_USD_TRADES;

        // ── Stale market filter: skip near-certainty bets ─────────────────────
        // If all dominant trades have avg entry > 0.88, market is near resolution
        const avgEntryCheck = dominantEnriched.reduce((s, e) => s + e.actualAvgPrice, 0) / dominantEnriched.length;
        if (avgEntryCheck > 0.88) continue; // stale/near-resolution bets

        // ── Quality gate ───────────────────────────────────────────────────────
        // Must pass at least one of:
        // (1) Has a verified sports leaderboard trader + any $500+ position
        // (2) 2+ tracked traders with $1K+ total
        // (3) Big single bet ($5K+) — any trader incl. anonymous whales
        // (4) 3+ traders (any) with $1.5K+ total — strong anonymous consensus in game markets
        // (5) 2+ tracked traders with $800+ each
        const hasVerifiedSports  = sportsLbCount >= 1 && totalDominantSize >= 500;
        const hasMultiTracked    = dominant.length >= 2 && totalDominantSize >= 1000 && lbCount >= 1;
        const isBigWhaleBet      = dominant.length === 1 && totalDominantSize >= 5000;
        const hasStrongConsensus = dominant.length >= 3 && totalDominantSize >= 1500;
        const hasTrackedConsensus = dominant.length >= 2 && lbCount >= 2 && totalDominantSize >= 800;

        if (!hasVerifiedSports && !hasMultiTracked && !isBigWhaleBet && !hasStrongConsensus && !hasTrackedConsensus && !vipPassMinGate) continue;

        const consensusPct = filteredEntries.length > 1
          ? (dominant.length / filteredEntries.length) * 100 : 100;
        if (filteredEntries.length > 1 && consensusPct < 50 && !vipBypassCluster) continue; // allow VIP lane through weak headline consensus

        // ── Counter-trader count (computed BEFORE confidence so it can penalize consensus) ──
        const counterTraderCount = filteredEntries.length - dominant.length;

        // ── Detect sport for sport-specific canonical ROI ──────────────────────
        const signalSport = classifySport(mw.slug || "", mw.question || "");
        const marketCategory = classifyMarketType(mw.question);
        const signalSportDetailed = classifySportFull(signalSport, mw.question || "", mw.slug || "");
        const sportMktKey = `${signalSportDetailed}|${marketCategory}`;
        const parentSportMktKey = `${signalSport}|${marketCategory}`;

        // Dollar-weighted avg quality (only traders allowed for this sport).
        // Simple average let a $500k C-Tier + $5k S-Tier read as "50" and pass gates — the whale
        // dominated the book but the score looked elite. Weight by USDC at risk (same idea as avgROI).
        const allowedForQualityGate = dominantEnriched.filter(e => {
          const cat = getEffectiveCategoryFilter(e.address.toLowerCase(), metricsByWallet.get(e.address.toLowerCase()));
          if (!cat?.doNotTail?.length) return true;
          return !cat.doNotTail.includes(signalSportDetailed) && !cat.doNotTail.includes(signalSport);
        });
        if (allowedForQualityGate.length === 0) continue;
        const qualityRiskSum = allowedForQualityGate.reduce((s, e) => s + e.actualRisk, 0) || 1;
        const avgQuality = Math.round(
          allowedForQualityGate.reduce((s, e) => {
            const cm = canonicalMap.get(e.address.toLowerCase());
            const q = ((cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : e.traderInfo.qualityScore);
            return s + q * e.actualRisk;
          }, 0) / qualityRiskSum
        );
        // Gate: overall Q adjusted by lane ROI (sport / submarket) in eliteQualityForGate.
        const avgQualityForGate = Math.round(
          allowedForQualityGate.reduce((s, e) => {
            const cm = canonicalMap.get(e.address.toLowerCase());
            const qRaw = ((cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : e.traderInfo.qualityScore);
            const q = eliteQualityForGate(qRaw, cm, sportMktKey, parentSportMktKey, signalSportDetailed, signalSport);
            return s + q * e.actualRisk;
          }, 0) / qualityRiskSum
        );

        // Weighted avg entry price: weight each trader's actual avg price by their actual risk
        const totalDominantWeight = dominantEnriched.reduce((s, e) => s + e.actualRisk, 0) || 1;
        const avgEntry   = dominantEnriched.reduce((s, e) => s + e.actualAvgPrice * e.actualRisk, 0) / totalDominantWeight;
        const avgSize    = totalDominantSize / dominantEnriched.length;

        // ── avgROI: sport- and submarket-specific ROI per trader ──────────────
        // Priority chain (minimum sample gates prevent tiny samples from inflating scores):
        //   1. sport×marketType exact   (e.g. "eSports|moneyline", ≥20 trades)
        //   2. parent sport×marketType  (e.g. "eSports|moneyline" for Dota2, ≥20 trades)
        //   3. detailed sport level     (e.g. "Dota2" or "eSports",  ≥20 trades)
        //   4. parent sport level       (e.g. "eSports",             ≥20 trades)
        //   5. canonical overallROI     (always available)
        // This correctly weights UAEVALORANTFAN's 9.91% eSports|moneyline ROI instead of
        // their 3.0% overall (dragged by NCAAB), and 9sh8f's 8.76% Dota2 moneyline vs 6.5%.
        // Quality weight: strongest traders (high qualityScore) get heaviest weight so weak traders don't inflate grades.
        const qualityWeight = (e: PosEnriched) => {
          const cm = canonicalMap.get(e.address.toLowerCase());
          const q = (cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : e.traderInfo.qualityScore ?? 50;
          const laneMul = laneQualityWeightMultiplier(cm, sportMktKey, parentSportMktKey, signalSportDetailed, signalSport);
          return e.actualRisk * Math.min(2.5, Math.max(0.2, (q / 50) * laneMul));
        };
        const totalQualityWeight = dominantEnriched.reduce((s, e) => s + qualityWeight(e), 0) || 1;
        const avgROI = dominantEnriched.reduce((s, e) => {
          const cm = canonicalMap.get(e.address.toLowerCase());
          const overall = cm?.overallROI ?? e.traderInfo.roi ?? 0;
          const smtExact   = cm?.roiBySportMarketType?.[sportMktKey];
          const smtParent  = cm?.roiBySportMarketType?.[parentSportMktKey];
          const sSport     = cm?.roiBySport?.[signalSportDetailed] ?? cm?.roiBySport?.[signalSport];
          const sParent    = cm?.roiBySport?.[signalSport];
          const minSmt = ELITE_LANE_SAMPLE_MIN;
          const minSp = ELITE_LANE_SAMPLE_MIN;
          let sportROI =
            (smtExact  && smtExact.tradeCount  >= minSmt)  ? smtExact.roi
          : (smtParent && smtParent.tradeCount >= minSmt)  ? smtParent.roi
          : (sSport    && sSport.tradeCount    >= minSp) ? sSport.roi
          : (sParent   && sParent.tradeCount   >= minSp) ? sParent.roi
          : overall;
          const sportWR = (sSport?.tradeCount ?? 0) >= minSp ? (sSport?.winRate ?? 0) : (sParent?.tradeCount ?? 0) >= minSp ? (sParent?.winRate ?? 0) : 0;
          const laneForRoi =
            (smtExact && smtExact.tradeCount >= minSmt) ? smtExact
            : (smtParent && smtParent.tradeCount >= minSmt) ? smtParent
            : (sSport && sSport.tradeCount >= minSp) ? sSport
            : (sParent && sParent.tradeCount >= minSp) ? sParent
            : null;
          const laneN = laneForRoi?.tradeCount ?? 0;
          if (!sportLaneTrustworthy(overall, sportROI, sportWR, laneN)) sportROI = overall;
          return s + sportROI * qualityWeight(e);
        }, 0) / totalQualityWeight;

        // ── Minimum sport-ROI gate: do not emit when "insiders" are net losers in this sport ──
        if (avgROI < 0 && !vipBypassCluster) continue;
        // Require B-Tier+ dollar-weighted quality on capital at risk (curated uses avgQualityForGate)
        if (avgQualityForGate < 40 && !vipBypassCluster) continue;

        // Defensive: do not emit if the largest-stake trader is doNotTail for this sport
        const primaryByRisk = [...dominantEnriched].sort((a, b) => b.actualRisk - a.actualRisk)[0];
        const primaryAddr = primaryByRisk?.address?.toLowerCase();
        if (primaryAddr) {
          const cat = getEffectiveCategoryFilter(primaryAddr, metricsByWallet.get(primaryAddr));
          if (cat?.doNotTail?.length && (cat.doNotTail.includes(signalSportDetailed) || cat.doNotTail.includes(signalSport))) continue;
        }

        // currentPrice resolved earlier (entry-vs-live gate). Midpoint = token for this side.
        // Both YES and NO use identical formula: currentPrice is already the token price
        // for the relevant side (YES token midpoint for YES, NO token midpoint for NO).
        // Positive = sharps got in at a higher price = you can enter cheaper = value edge.
        const valueDelta = avgEntry - currentPrice - SLIPPAGE;

        // ── Insider Stats: relBetSize = this position vs "normal" (aggregated median/avg position in sport)
        // Normal = median/avg POSITION per event from canonical; fallback = this signal's avg position size (not 1).
        const relBetSize = (() => {
          const w = dominantEnriched.reduce((s, e) => s + e.actualRisk, 0) || 1;
          const fallbackNormal = Math.max(avgSize, 1);
          return Math.round(dominantEnriched.reduce((s, e) => {
            const cm = canonicalMap.get(e.address.toLowerCase());
            const smEntry = cm?.roiBySportMarketType?.[sportMktKey];
            const sEntry  = cm?.roiBySport?.[signalSportDetailed] ?? cm?.roiBySport?.[signalSport];
            const normalPosition = effectiveNormalPositionUsd(cm, smEntry, sEntry, fallbackNormal, signalSportDetailed, signalSport);
            const ratio = Math.min(e.actualRisk / Math.max(normalPosition, 1), 20);
            return s + ratio * (e.actualRisk / w);
          }, 0) * 10) / 10;
        })();

        // ── Price range bonus: is the current price in their winning zone? ─────
        // Uses per-trader price-bucket stats from CSV analysis (csvPriceStats in DB).
        // -8 to +8 pts applied after computeConfidence.
        const priceBucket = currentPrice < 0.20 ? "Longshot (0-20c)"
          : currentPrice < 0.40 ? "Underdog (20-40c)"
          : currentPrice < 0.60 ? "Flip (40-60c)"
          : currentPrice < 0.80 ? "Favorite (60-80c)"
          : "Safe (80-100c)";
        const priceRangeAdj = (() => {
          let pts = 0, count = 0;
          for (const e of dominant) {
            const cm = canonicalMap.get(e.address.toLowerCase());
            const stat = (cm?.priceStats as any)?.[priceBucket] as { roi?: number; events?: number } | undefined;
            if (!stat || !stat.events || stat.events < 8) continue;
            const roi = stat.roi ?? 0;
            if (roi > 15) pts += 8; else if (roi > 8) pts += 5; else if (roi > 3) pts += 2;
            else if (roi < -15) pts -= 8; else if (roi < -8) pts -= 5; else if (roi < -3) pts -= 2;
            count++;
          }
          return count > 0 ? Math.max(-8, Math.min(8, Math.round(pts / count))) : 0;
        })();

        // Calendar bucket (pregame / live / futures) — must be computed before confidence so
        // we don't apply the long-dated "futures staleness" ladder to markets that are
        // keyword-classified as futures but resolve soon (e.g. division races in March).
        const mInfo = marketDb.get(condId);
        const mTypeRaw2 = categoriseMarket(mw.question, mw.endDate || mInfo?.endDate, mInfo?.gameStartTime, mw.slug || mInfo?.slug);

        // For futures markets the price-vs-entry delta is misleading: it reflects whether
        // the bet has moved in/against their favour since they opened months ago, which has
        // zero relevance for a new entrant today. Zero it out before scoring.
        // Only treat as "macro futures" for staleness if BOTH the title looks like a season bet
        // AND the resolution is far out (categoriseMarket === "futures"). Otherwise near-term
        // keyword futures (division winner this week) use full game scoring — avoids a bogus 62 rail.
        const isFuturesMkt = marketCategory === "futures" && mTypeRaw2 === "futures";
        const effectiveValueDelta = isFuturesMkt ? 0 : valueDelta;

        const { score: rawConf, breakdown } = computeConfidence(
          avgROI, consensusPct, effectiveValueDelta, avgSize, dominant.length, avgQuality, counterTraderCount, relBetSize
        );

        // Futures confidence ceiling scales with recency of the entry.
        // A fresh futures bet (< 1 day) can still reach near-100 — the edge is real and
        // the opportunity window is open. A bet made 3 months ago is stale information:
        // the market has repriced, the edge (if any) has already been baked in.
        // No timestamp → conservative 70 (could be very old).
        const futuresCap = (() => {
          if (!isFuturesMkt) return 100;
          const avgTs = dominant.length > 0
            ? dominant.reduce((s, e) => s + ((e as any).lastTimestamp || 0), 0) / dominant.length
            : 0;
          if (avgTs === 0) return 70;
          const d = (Date.now() - avgTs) / 86_400_000; // age in days
          return d < 1 ? 95 : d < 3 ? 88 : d < 7 ? 80 : d < 30 ? 72 : d < 60 ? 62 : 55;
        })();
        let confidence = Math.max(5, Math.min(futuresCap, rawConf + priceRangeAdj));
        if (vipBypassCluster) confidence = Math.min(100, confidence + 7);
        // Strong lane specialist (canonical roiBySport / roiBySportMarketType): boost so outsized sharp plays surface.
        let specialtyLaneBoost = 0;
        for (const e of dominantEnriched) {
          if (!e.positionConfirmed) continue;
          const cm = canonicalMap.get(e.address.toLowerCase());
          const { roi: lr, sampleOk } = traderSpecialtyLaneROI(cm, sportMktKey, parentSportMktKey, signalSportDetailed, signalSport);
          if (!sampleOk) continue;
          if (lr >= 12) specialtyLaneBoost = Math.max(specialtyLaneBoost, 6);
          else if (lr >= 8) specialtyLaneBoost = Math.max(specialtyLaneBoost, 4);
          else if (lr >= 5) specialtyLaneBoost = Math.max(specialtyLaneBoost, 2);
        }
        confidence = Math.min(100, confidence + specialtyLaneBoost);

        const tier = dominant.length >= 3 && avgQuality >= 45 ? "HIGH"
                   : dominant.length >= 2 ? "MED" : "SINGLE";

        const id    = `elite-${condId}-${side}`;
        const isNew = !seenSignalIds.has(id) && confidence >= 55;
        seenSignalIds.add(id);

        const isSports = isSportsRelated(mw.question);
        // mInfo / mTypeRaw2: computed above (before confidence) for calendar + futures staleness
        // Specific game markets (moneyline/spread/total) should show as PREGAME, not FUTURES
        const mType = (mTypeRaw2 === "futures" && marketCategory !== "futures") ? "pregame" : mTypeRaw2;
        const priceTiming = mType === "live" ? "live" : "pregame";
        const priceStatus  = computePriceStatus(currentPrice, avgEntry, side, priceTiming);
        // Stale signal filter: hide if price moved against entry. Elite roster traders still surface — we trust the book.
        const hasEliteRosterDominant = dominantEnriched.some(e => signalRosterSet.has(e.address.toLowerCase()));
        if (priceStatus === "moved" && !hasEliteRosterDominant) continue;
        const isActionable = priceStatus === "actionable" || priceStatus === "dip";
        const bigPlayScore = computeBigPlayScore(totalDominantSize, dominant.length, relBetSize);
        // slippagePct: how much did the price move after the insiders bought (conviction indicator)
        const slippagePct = Math.round((side === "YES"
          ? (currentPrice - avgEntry) * 100
          : (avgEntry - currentPrice) * 100) * 10) / 10;
        // insiderSportsROI: quality-weighted so strong traders dominate
        const rawInsiderROI = dominantEnriched.reduce((s, e) => {
          const cm = canonicalMap.get(e.address.toLowerCase());
          const overall = cm?.overallROI ?? e.traderInfo.roi ?? 0;
          const sportEntry = cm?.roiBySport?.[signalSportDetailed] ?? cm?.roiBySport?.[signalSport];
          const minSp = ELITE_LANE_SAMPLE_MIN;
          let roiUsed = (sportEntry && (sportEntry.tradeCount ?? 0) >= minSp)
            ? sportEntry.roi
            : overall;
          if (
            sportEntry && (sportEntry.tradeCount ?? 0) >= minSp
            && !sportLaneTrustworthy(overall, sportEntry.roi, sportEntry.winRate ?? 0, sportEntry.tradeCount ?? 0)
          ) roiUsed = overall;
          return s + roiUsed * qualityWeight(e);
        }, 0) / totalQualityWeight;
        const insiderSportsROI = Math.round(rawInsiderROI * 10) / 10;
        // insiderTrades: sport-specific closed position count from canonical API
        const insiderTrades = dominantEnriched.reduce((s, e) => {
          const cm = canonicalMap.get(e.address.toLowerCase());
          const sportEntry = cm?.roiBySport?.[signalSportDetailed] ?? cm?.roiBySport?.[signalSport];
          const minSp = ELITE_LANE_SAMPLE_MIN;
          const sportCount = (sportEntry && (sportEntry.tradeCount ?? 0) >= minSp) ? sportEntry.tradeCount : 0;
          return s + (sportCount > 0 ? sportCount : ((cm?.totalTrades ?? 0) > 0 ? cm!.totalTrades : 1));
        }, 0);
        // insiderWinRate: quality-weighted so strong traders dominate
        const rawInsiderWR = dominantEnriched.reduce((s, e) => {
          const cm = canonicalMap.get(e.address.toLowerCase());
          const overall = cm?.overallROI ?? e.traderInfo.roi ?? 0;
          const sportEntry = cm?.roiBySport?.[signalSportDetailed] ?? cm?.roiBySport?.[signalSport];
          const minSp = ELITE_LANE_SAMPLE_MIN;
          let wr = (sportEntry && (sportEntry.tradeCount ?? 0) >= minSp)
            ? (sportEntry.winRate ?? 0)
            : (cm?.winRate ?? 0);
          if (
            sportEntry && (sportEntry.tradeCount ?? 0) >= minSp
            && !sportLaneTrustworthy(overall, sportEntry.roi ?? 0, wr, sportEntry.tradeCount ?? 0)
          ) wr = (cm?.winRate ?? 0);
          return s + wr * qualityWeight(e);
        }, 0) / totalQualityWeight;
        const insiderWinRate = Math.round(rawInsiderWR * 10) / 10;

        // Sort by actual risk (largest position first)
        const dominantEnrichedSorted = [...dominantEnriched].sort((a, b) => b.actualRisk - a.actualRisk);
        // Display only traders allowed for this sport (doNotTail) so weak/wrong-sport traders don't appear in the list
        const allowedForDisplay = dominantEnrichedSorted.filter(e => {
          const cat = getEffectiveCategoryFilter(e.address.toLowerCase(), metricsByWallet.get(e.address.toLowerCase()));
          if (!cat?.doNotTail?.length) return true;
          return !cat.doNotTail.includes(signalSportDetailed) && !cat.doNotTail.includes(signalSport);
        });
        if (allowedForDisplay.length === 0) continue; // no trader allowed for this sport — skip signal

        const futuresExpertStakeUsd = isFuturesMkt
          ? allowedForDisplay.reduce((s, e) => {
              if (e.address.toLowerCase() !== FUTURES_EXPERT_LARGE_STAKE_WALLET) return s;
              return s + e.actualRisk;
            }, 0)
          : 0;
        const futuresExpertLargeStakeUsd =
          isFuturesMkt && futuresExpertStakeUsd >= FUTURES_EXPERT_LARGE_STAKE_MIN_USD
            ? Math.round(futuresExpertStakeUsd)
            : undefined;

        // Macro futures: entry-vs-live drift over weeks/months is not a tailing signal; we already use
        // effectiveValueDelta=0 for confidence — omit raw valueDelta in the payload so the UI doesn't
        // show a huge "¢ below live" line that contradicts the ±5¢ tailing rule.
        const valueDeltaOut = isFuturesMkt ? 0 : Math.round(valueDelta * 1000) / 1000;

        // Final guard: long /api/signals loops can let mid drift vs entry; drop if no longer within band (stricter for live).
        const pxLastTrades = await fetchMidpointUncached(liveTokenId);
        if (mType === "live" && (pxLastTrades === null || !Number.isFinite(pxLastTrades))) continue;
        const pxUseTrades = pxLastTrades !== null && Number.isFinite(pxLastTrades) ? pxLastTrades : currentPrice;
        const bandLastTrades = mType === "live" ? ENTRY_VS_LIVE_MAX_INPLAY : ENTRY_VS_LIVE_MAX;
        if (allowedForDisplay.some(e => Math.abs(e.actualAvgPrice - pxUseTrades) > bandLastTrades)) continue;

        signals.push({
          id, marketId: condId,
          marketQuestion: mw.question,
          slug: mw.slug,
          endDate: mw.endDate || mInfo?.endDate,
          gameStartTime: mInfo?.gameStartTime,
          outcome: side, side,
          confidence, tier, marketType: mType, isSports,
          marketCategory,
          vipPremium: vipBypassCluster,
          isActionable,
          priceStatus,
          priceRangeAdj,
          priceBucket,
          bigPlayScore,
          consensusPct: Math.round(consensusPct),
          valueDelta: valueDeltaOut,
          currentPrice: Math.round(currentPrice * 1000) / 1000,
          avgEntryPrice: Math.round(avgEntry * 1000) / 1000,
          totalNetUsdc: Math.round(totalDominantSize),
          avgNetUsdc: Math.round(avgSize),
          totalRiskUsdc: Math.round(totalDominantSize),
          avgRiskUsdc: Math.round(totalDominantSize / Math.max(allowedForDisplay.length, 1)),
          traderCount: allowedForDisplay.length,
          lbTraderCount: lbCount,
          sportsLbCount,
          counterTraderCount,
          avgQuality: Math.round(avgQuality),
          scoreBreakdown: breakdown,
          relBetSize, slippagePct, insiderSportsROI, insiderTrades, insiderWinRate,
          traders: allowedForDisplay.slice(0, 8).map(e => {
            const cm = canonicalMap.get(e.address.toLowerCase());
            const displayROI = cm?.overallROI ?? e.traderInfo.roi;
            const displayQuality = (cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : e.traderInfo.qualityScore;
            const sportEntry = cm?.roiBySport?.[signalSportDetailed] ?? cm?.roiBySport?.[signalSport];
            const smEntryT = cm?.roiBySportMarketType?.[sportMktKey];
            const sEntryT  = cm?.roiBySport?.[signalSportDetailed] ?? cm?.roiBySport?.[signalSport];
            const normalBetT = effectiveNormalPositionUsd(cm, smEntryT, sEntryT ?? undefined, Math.max(avgSize, 1), signalSportDetailed, signalSport);
            const traderRelSize = Math.round(Math.min(e.actualRisk / Math.max(normalBetT, 1), 20) * 10) / 10;
            const overallT = cm?.overallROI ?? e.traderInfo.roi ?? 0;
            const sportRoiT = sportEntry?.roi ?? null;
            const sportWrT = sportEntry?.winRate ?? null;
            const sportNT = sportEntry?.tradeCount ?? 0;
            const laneOk =
              sportRoiT != null
              && sportWrT != null
              && sportLaneTrustworthy(overallT, sportRoiT, sportWrT, sportNT);
            const cappedSportRoi = laneOk ? sportRoiT : (sportRoiT != null ? overallT : null);
            const cappedSportWr = laneOk ? sportWrT : (sportWrT != null ? (cm?.winRate ?? null) : null);
            return {
              address: e.address,
              name: e.traderInfo.name,
              side: e.side,
              entryPrice: Math.round(e.actualAvgPrice * 1000) / 1000,
              size: Math.round(e.actualShares),
              netUsdc: Math.round(e.actualRisk),
              riskUsdc: Math.round(e.actualRisk),
              roi: Math.round(displayROI * 10) / 10,
              qualityScore: displayQuality,
              pnl: Math.round(e.traderInfo.pnl),
              isLeaderboard: e.traderInfo.isLeaderboard,
              isSportsLb: (e.traderInfo as any).isSportsLb ?? false,
              tradeTime: (e as any).lastTimestamp || 0,
                winRate: cm?.winRate ?? 0,
              totalTrades: cm?.totalTrades ?? 0,
              sportRoi: cappedSportRoi,
              sportTradeCount: sportEntry?.tradeCount ?? null,
              sportWinRate: cappedSportWr,
              sportAvgBet: sportEntry?.avgBet ?? null,
              tags: cm?.tags ?? [],
              traderRelSize,
            };
          }),
          counterTraders: counterEntries.slice(0, 4).map(e => {
            const cm = canonicalMap.get(e.address.toLowerCase());
            const sportEntry = cm?.roiBySport?.[signalSportDetailed] ?? cm?.roiBySport?.[signalSport];
            return {
              address: e.address,
              name: e.traderInfo.name,
              entryPrice: Math.round((e.prices.reduce((a,b)=>a+b,0)/e.prices.length) * 100) / 100,
              netUsdc: Math.round(e.totalSize),
              qualityScore: (cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : e.traderInfo.qualityScore,
              isSportsLb: (e.traderInfo as any).isSportsLb ?? false,
              sportRoi: (() => {
                const se = sportEntry;
                if (!se || !Number.isFinite(se.roi)) return null;
                return sportLaneTrustworthy(cm?.overallROI ?? 0, se.roi, se.winRate ?? 0, se.tradeCount ?? 0)
                  ? se.roi
                  : (cm?.overallROI ?? null);
              })(),
              tradeTime: (e as any).lastTimestamp || 0,
            };
          }),
          category: isSports ? "sports" : "other",
          sport: signalSport,
          volume: 0,
          generatedAt: now,
          isValue: !isFuturesMkt && valueDelta > 0, isNew,
          futuresCap: isFuturesMkt ? futuresCap : undefined,
          futuresExpertLargeStakeUsd,
          source: "trades",
          outcomeLabel: computeOutcomeLabel(mw.question, side),
          yesTokenId: mw.yesTokenId,
          noTokenId: mw.noTokenId,
        });
      }

      // ── Phase 4: Positions-based signals from verified sports traders ──────────
      // Full elite roster (same merge as Phase 1). Uses livePositionCache (refreshed on interval).
      const topSportsWallets = [...new Set(signalSourceWallets.map(w => w.addr.toLowerCase()))];
      const positionsAge = livePositionCacheUpdatedAt > 0
        ? Math.round((Date.now() - livePositionCacheUpdatedAt) / 1000) + "s ago"
        : "not yet loaded";
      console.log(`[Positions] Scanning ${topSportsWallets.length} elite roster traders for open positions (cache: ${positionsAge})`);
      if (topSportsWallets.length > 0) {
        const positionBatches = topSportsWallets.map(w => livePositionCache.get(w.toLowerCase()) || []);
        // Map: conditionId+outcomeIndex → position aggregation
        type PosGroup = {
          conditionId: string; side: "YES"|"NO";
          question: string; slug?: string; endDate?: string;
          traders: { name: string; wallet: string; entryPrice: number; curPrice: number; currentValue: number; costBasis: number; shares: number; isSportsLb: boolean }[];
          totalValue: number;
          yesAsset?: string; noAsset?: string;
        };
        const posMap = new Map<string, PosGroup>();

        for (let i = 0; i < topSportsWallets.length; i++) {
          const wallet = topSportsWallets[i];
          const traderMeta = lbMap.get(wallet);
          const traderName = traderMeta?.name || truncAddr(wallet);
          for (const pos of positionBatches[i]) {
            // Filter: must be sports, not worthless, curPrice in range
            const curPrice = parseFloat(pos.curPrice || "0");
            const val = parseFloat(pos.currentValue || "0");
            if (val < 50) continue; // skip positions < $50
            if (curPrice < 0.08 || curPrice > 0.90) continue; // extended range for futures, max 90¢
            const title = pos.title || pos.market || "";
            if (!isSportsRelated(title.toLowerCase())) continue;
            const condId = pos.conditionId || "";
            if (!condId) continue;
            // Collect sports event slugs BEFORE any filtering (for ESPN background refresh)
            {
              const es = pos.slug || pos.eventSlug || "";
              if (es && /^(nba|nhl|nfl|mlb|ncaab|ncaaf)-/.test(es)) {
                seenEventSlugs.add(es);
                const bs = baseGameSlug(es);
                if (bs !== es) seenEventSlugs.add(bs);
              }
            }
            const side: "YES"|"NO" = resolveSide(pos.outcome, pos.outcomeIndex);
            const mapKey = `${condId}-${side}`;
            // Asset IDs from position data: YES token = asset when side=YES
            const isYesToken = side === "YES";
            const yesAssetFromPos = isYesToken ? String(pos.asset || "") : String(pos.oppositeAsset || "");
            const noAssetFromPos  = isYesToken ? String(pos.oppositeAsset || "") : String(pos.asset || "");

            if (!posMap.has(mapKey)) {
              // Fall back to marketDb endDate if pos.endDate is missing, then slug date
              const dbEntry = marketDb.get(condId);
              // Skip positions on inactive/postponed/cancelled markets
              if (dbEntry && !dbEntry.active) continue;
              if (isPostponedOrCancelled(title, true, false)) continue;
              const mSlug = pos.slug || pos.eventSlug || "";
              const resolvedEndDate = pos.endDate || dbEntry?.endDate || slugDateFallback(mSlug);
              // Skip positions for markets that have already ended (resolved games)
              if (resolvedEndDate && new Date(resolvedEndDate).getTime() < now) continue;
              posMap.set(mapKey, {
                conditionId: condId, side,
                question: title,
                slug: pos.slug || pos.eventSlug,
                endDate: resolvedEndDate,
                traders: [], totalValue: 0,
                yesAsset: yesAssetFromPos || undefined,
                noAsset:  noAssetFromPos  || undefined,
              });
              // Register in shared game market registry for /api/markets
              upsertGameMarket(condId, {
                question: title,
                slug: pos.slug || pos.eventSlug,
                endDate: resolvedEndDate,
                currentPrice: curPrice,
                volume: 0, liquidity: 0, active: true,
                marketType: classifyMarketType(title),
                gameStatus: categoriseMarket(title, resolvedEndDate, marketDb.get(condId)?.gameStartTime, pos.slug || pos.eventSlug || marketDb.get(condId)?.slug),
              });
            }
            const pg = posMap.get(mapKey)!;
            const posShares  = parseFloat(pos.size || "0");
            const posEntry   = parseFloat(pos.avgPrice || "0");
            // costBasis = initialValue = actual USDC spent (shares × avgPrice), most accurate risk
            const posCostBasis = parseFloat(pos.initialValue || "0") || posShares * posEntry;
            pg.traders.push({
              name: traderName, wallet,
              entryPrice: posEntry,
              curPrice, currentValue: val,
              costBasis: posCostBasis,
              shares: posShares,
              isSportsLb: traderMeta?.isSportsLb ?? false,
            });
            pg.totalValue += val;
          }
        }

        // ── Enrich marketDb with CLOB data for position markets not in Gamma top-800 ──
        // This fills in endDate / gameStartTime / active for rescheduled or niche markets.
        const unknownCondIds = [...posMap.keys()].map(k => k.replace(/-YES$|-NO$/, ""));
        await enrichMarketDbFromClob(marketDb, [...new Set(unknownCondIds)]);

        // ── Conflict detection: if both YES and NO have verified positions on same
        //    conditionId, only keep the clearly dominant side. If split, skip both.
        const condSideMap = new Map<string, { YES?: { val: number; cnt: number }; NO?: { val: number; cnt: number } }>();
        for (const pg of posMap.values()) {
          const cs = condSideMap.get(pg.conditionId) || {};
          cs[pg.side] = { val: pg.totalValue, cnt: pg.traders.length };
          condSideMap.set(pg.conditionId, cs);
        }
        const conflictedConds = new Set<string>();
        const suppressedSides = new Set<string>(); // "condId-SIDE" → weaker side to hide
        for (const [condId, cs] of condSideMap.entries()) {
          if (!cs.YES || !cs.NO) continue; // only one side, no conflict
          const yVal = cs.YES.val, nVal = cs.NO.val;
          const dominantSide = yVal >= nVal ? "YES" : "NO";
          const weakerSide   = dominantSide === "YES" ? "NO" : "YES";
          const dominantVal  = Math.max(yVal, nVal);
          const otherVal     = Math.min(yVal, nVal);
          const ratio = otherVal > 0 ? dominantVal / otherVal : 10;
          if (ratio >= 3.0) {
            // Clear winner — suppress weaker side only
            suppressedSides.add(`${condId}-${weakerSide}`);
            console.log(`[Positions] Conflict on ${condId.slice(0,10)}: ${dominantSide} (${dominantVal.toFixed(0)}) dominates ${weakerSide} (${otherVal.toFixed(0)}) — suppressing ${weakerSide}`);
          } else {
            // Close split — both sides invalid as signals
            conflictedConds.add(condId);
            console.log(`[Positions] Conflicted market ${condId.slice(0,10)}: YES $${yVal.toFixed(0)} vs NO $${nVal.toFixed(0)} — suppressing both`);
          }
        }

        const existingIds = new Set(signals.map(s => `${s.marketId}-${s.side}`));
        // Position-only markets: outcome tokens are not in the Phase-3 midpoint batch. Fetch
        // CLOB mid for each — pos.curPrice often lags the book (e.g. Under 1.5 at 0¢ after goals).
        {
          const extraIds = new Set<string>();
          for (const pg of posMap.values()) {
            const tid = pg.side === "YES" ? pg.yesAsset : pg.noAsset;
            if (tid && !midpointMap.has(tid)) extraIds.add(tid);
          }
          if (extraIds.size > 0) {
            const extraMid = await fetchMidpointsBatch([...extraIds]);
            for (const [tid, px] of extraMid) midpointMap.set(tid, px);
          }
        }
        const positionLiveMidCache = new Map<string, number | null>();
        async function liveMidForPositions(tokenId: string): Promise<number | null> {
          if (positionLiveMidCache.has(tokenId)) return positionLiveMidCache.get(tokenId)!;
          const m = await fetchMidpointUncached(tokenId);
          positionLiveMidCache.set(tokenId, m);
          return m;
        }
        for (const pg of posMap.values()) {
          const pgMarketPre = marketDb.get(pg.conditionId);
          const pgSportEarly = classifySport(pg.slug || pgMarketPre?.slug || "", pg.question || "");
          const pgMarketCategoryEarly = classifyMarketType(pg.question);
          const pgSportDetailedEarly = classifySportFull(pgSportEarly, pg.question || "", pg.slug || pgMarketPre?.slug || "");
          const pgSportMktKeyEarly = `${pgSportDetailedEarly}|${pgMarketCategoryEarly}`;
          const pgParentSportMktKeyEarly = `${pgSportEarly}|${pgMarketCategoryEarly}`;

          // Avoid duplicating markets already in trades-based signals
          const dedupeKey = `${pg.conditionId}-${pg.side}`;
          if (existingIds.has(dedupeKey)) continue;

          // Skip conflicted markets (smart money is split — no actionable signal)
          if (conflictedConds.has(pg.conditionId)) continue;
          if (suppressedSides.has(dedupeKey)) continue;

          // Resolve enriched market data (CLOB enrichment may have filled in missing fields)
          const pgMarket = marketDb.get(pg.conditionId);
          const resolvedEndDate = pg.endDate || pgMarket?.endDate;
          const resolvedGameStartTime = pgMarket?.gameStartTime;
          // Also check if market became inactive after CLOB enrichment
          if (pgMarket && !pgMarket.active) continue;

          // Skip positions for markets whose end date has already passed
          const endMs = resolvedEndDate ? new Date(resolvedEndDate).getTime() : Infinity;
          if (resolvedEndDate && endMs < now) continue;

          // Live reference MUST be CLOB mid for the ±5¢ gate — never avg(pos.curPrice): Polymarket position
          // marks can sit at 4–5¢ while the real book is 15¢+ on long-dated / thin futures.
          const tokenForSide = pg.side === "YES" ? pg.yesAsset : pg.noAsset;
          if (!tokenForSide) continue;
          const clobMid = midpointMap.get(tokenForSide);
          const freshMid = await liveMidForPositions(tokenForSide);
          let avgCurPrice: number;
          if (freshMid !== null && Number.isFinite(freshMid)) avgCurPrice = freshMid;
          else if (clobMid !== undefined && Number.isFinite(clobMid)) avgCurPrice = clobMid;
          else continue;
          const isFutures = endMs - now > 14 * 24 * 3600_000; // more than 14 days out
          const minPrice = isFutures ? 0.05 : 0.10;
          if (avgCurPrice < minPrice || avgCurPrice > 0.95) continue;

          const mTypeBandPos = categoriseMarket(pg.question, resolvedEndDate, resolvedGameStartTime, pg.slug || pgMarket?.slug);
          const entryVsLiveBandPos = mTypeBandPos === "live" ? ENTRY_VS_LIVE_MAX_INPLAY : ENTRY_VS_LIVE_MAX;
          // Same as trades path: only include traders whose avg entry is within band of live midpoint
          const posTraders = pg.traders.filter(t => Math.abs(t.entryPrice - avgCurPrice) <= entryVsLiveBandPos);
          if (posTraders.length === 0) continue;
          const posTotalValue = posTraders.reduce((s, t) => s + t.currentValue, 0);

          let pgVipStake = 0;
          let pgVipRaw = false;
          for (const t of posTraders) {
            const cm = canonicalMap.get(t.wallet.toLowerCase());
            const q = (cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : 0;
            const minUsd = posTraders.length === 1 ? VIP_PREMIUM_MIN_USD_POS_SOLO : VIP_PREMIUM_MIN_USD_TRADES;
            if (q < VIP_PREMIUM_MIN_Q || t.costBasis < minUsd) continue;
            const catV = getEffectiveCategoryFilter(t.wallet.toLowerCase(), metricsByWallet.get(t.wallet.toLowerCase()));
            if (catV?.doNotTail?.length && (catV.doNotTail.includes(pgSportDetailedEarly) || catV.doNotTail.includes(pgSportEarly))) continue;
            const { roi: laneRoi, sampleOk } = traderSpecialtyLaneROI(cm, pgSportMktKeyEarly, pgParentSportMktKeyEarly, pgSportDetailedEarly, pgSportEarly);
            if (!sampleOk) continue;
            const meetsEdge = laneRoi >= VIP_SPECIALTY_ROI_MIN
              || (laneRoi >= VIP_ALT_ROI_FOR_HUGE && t.costBasis >= VIP_HUGE_STAKE_POS);
            if (meetsEdge) {
              pgVipRaw = true;
              pgVipStake += t.costBasis;
            }
          }
          const pgTotalCost = posTraders.reduce((s, t) => s + t.costBasis, 0);
          const pgVipDominates = pgTotalCost > 0 && (pgVipStake / pgTotalCost) >= VIP_DOMINATE_RISK_FRAC;
          const pgVipHuge = pgVipRaw && pgVipStake >= VIP_HUGE_STAKE_POS;
          const pgVipBypass = pgVipDominates || pgVipHuge;
          const pgVipSoloFloor = posTraders.length === 1 && pgVipRaw;

          // Quality gate: meaningful capital after entry-vs-live filter
          if (posTraders.length >= 2 && posTotalValue < 1000) continue;
          if (posTraders.length < 2 && posTotalValue < 50000 && !pgVipSoloFloor) continue;

          // Weighted avg entry price: weight each trader's entry by their cost basis (USDC spent)
          const totalCostBasis = posTraders.reduce((s, t) => s + t.costBasis, 0) || 1;
          const avgEntry = posTraders.reduce((s, t) => s + t.entryPrice * t.costBasis, 0) / totalCostBasis;
          const avgSize  = totalCostBasis / posTraders.length;
          // Positive = sharps paid more than live = you enter cheaper = value edge.
          // avgEntry and avgCurPrice are both the same-side token price, so formula is symmetric.
          const valueDelta = avgEntry - avgCurPrice - 0.02;

          const consensusPct = 100; // all are on same side by construction
          // Counter-trader count (computed BEFORE confidence so it can penalize consensus)
          const oppositeKey = `${pg.conditionId}-${pg.side === "YES" ? "NO" : "YES"}`;
          const counterTraderCount = posMap.get(oppositeKey)?.traders.length ?? 0;

          // Detect sport for sport-specific canonical ROI
          const pgSport = classifySport(pg.slug || pgMarket?.slug || "", pg.question || "");
          // Compute market category and detailed sport key early — needed for avgROI priority chain
          const pgMarketCategory = classifyMarketType(pg.question);
          const pgSportDetailed = classifySportFull(pgSport, pg.question || "", pg.slug || pgMarket?.slug || "");
          const pgSportMktKey = `${pgSportDetailed}|${pgMarketCategory}`;
          // Skip position-group signal if primary trader (by value) is doNotTail for this sport
          const pgPrimary = posTraders.length ? posTraders.reduce((a, b) => a.currentValue >= b.currentValue ? a : b) : null;
          if (pgPrimary) {
            const catPg = getEffectiveCategoryFilter(pgPrimary.wallet.toLowerCase(), metricsByWallet.get(pgPrimary.wallet.toLowerCase()));
            if (catPg?.doNotTail?.length && (catPg.doNotTail.includes(pgSportDetailed) || catPg.doNotTail.includes(pgSport))) continue;
          }
          // Quality weight for position-group: strongest traders get heaviest weight (same as Phase 1).
          const pgQualityWeight = (t: { wallet: string; currentValue: number }) => {
            const cm = canonicalMap.get(t.wallet.toLowerCase());
            const q = (cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : (lbMap.get(t.wallet)?.qualityScore ?? 50);
            const laneMul = laneQualityWeightMultiplier(cm, pgSportMktKey, `${pgSport}|${pgMarketCategory}`, pgSportDetailed, pgSport);
            return (t.currentValue || 0) * Math.min(2.5, Math.max(0.2, (q / 50) * laneMul));
          };
          const pgTotalQualityWeight = posTraders.reduce((s, t) => s + pgQualityWeight(t), 0) || 1;

          // avgROI: quality-weighted so strong traders dominate; reject implausible 90%+ when overall negative.
          const avgROI = posTraders.reduce((s, t) => {
            const cm = canonicalMap.get(t.wallet.toLowerCase());
            const overall = cm?.overallROI ?? lbMap.get(t.wallet)?.roi ?? 0;
            const smtExact  = cm?.roiBySportMarketType?.[pgSportMktKey];
            const smtParent = cm?.roiBySportMarketType?.[`${pgSport}|${pgMarketCategory}`];
            const sSport    = cm?.roiBySport?.[pgSportDetailed] ?? cm?.roiBySport?.[pgSport];
            const sParent   = cm?.roiBySport?.[pgSport];
            const minSmt = ELITE_LANE_SAMPLE_MIN;
            const minSp = ELITE_LANE_SAMPLE_MIN;
            let sportROI  = (smtExact && smtExact.tradeCount >= minSmt) ? smtExact.roi
                          : (smtParent && smtParent.tradeCount >= minSmt) ? smtParent.roi
                          : (sSport   && sSport.tradeCount   >= minSp) ? sSport.roi
                          : (sParent && sParent.tradeCount >= minSp) ? sParent.roi
                          : overall;
            const sportWR = (sSport?.tradeCount ?? 0) >= minSp ? (sSport?.winRate ?? 0)
              : (sParent?.tradeCount ?? 0) >= minSp ? (sParent?.winRate ?? 0) : 0;
            const laneForPg =
              (smtExact && smtExact.tradeCount >= minSmt) ? smtExact
              : (smtParent && smtParent.tradeCount >= minSmt) ? smtParent
              : (sSport && sSport.tradeCount >= minSp) ? sSport
              : (sParent && sParent.tradeCount >= minSp) ? sParent
              : null;
            const laneNPg = laneForPg?.tradeCount ?? 0;
            if (!sportLaneTrustworthy(overall, sportROI, sportWR, laneNPg)) sportROI = overall;
            return s + sportROI * pgQualityWeight(t);
          }, 0) / pgTotalQualityWeight;

          // Minimum sport-ROI gate: do not emit when insiders are net losers in this sport
          if (avgROI < 0 && !pgVipBypass) continue;

          // Dollar-weighted quality (current position value) — same fix as trades path: no piggybacking
          const pgAllowedForQ = posTraders.filter(t => {
            const cat = getEffectiveCategoryFilter(t.wallet.toLowerCase(), metricsByWallet.get(t.wallet.toLowerCase()));
            if (!cat?.doNotTail?.length) return true;
            return !cat.doNotTail.includes(pgSportDetailed) && !cat.doNotTail.includes(pgSport);
          });
          if (pgAllowedForQ.length === 0) continue;
          const pgQValSum = pgAllowedForQ.reduce((s, t) => s + t.currentValue, 0) || 1;
          const avgQualityForScore = Math.round(
            pgAllowedForQ.reduce((s, t) => {
              const cm = canonicalMap.get(t.wallet.toLowerCase());
              const qRaw = ((cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : (lbMap.get(t.wallet)?.qualityScore ?? 20));
              const q = eliteQualityForGate(qRaw, cm, pgSportMktKey, `${pgSport}|${pgMarketCategory}`, pgSportDetailed, pgSport);
              return s + q * t.currentValue;
            }, 0) / pgQValSum
          );
          if (avgQualityForScore < 40 && !pgVipBypass) continue; // require B-Tier+ on weighted capital

          // pgRelBetSize: normal = median/avg from canonical; fallback = this signal's avg position size
          const pgTotalWeight = posTotalValue || 1;
          const pgFallbackNormal = Math.max(avgSize, 1);
          const pgRelBetSize = (() => {
            return Math.round(posTraders.reduce((s, t) => {
              const cm = canonicalMap.get(t.wallet.toLowerCase());
              const smEntry = cm?.roiBySportMarketType?.[pgSportMktKey];
              const sEntry  = cm?.roiBySport?.[pgSportDetailed] ?? cm?.roiBySport?.[pgSport];
              const normalPosition = effectiveNormalPositionUsd(cm, smEntry, sEntry, pgFallbackNormal, pgSportDetailed, pgSport);
              const ratio = Math.min(t.currentValue / Math.max(normalPosition, 1), 20);
              return s + ratio * (t.currentValue / pgTotalWeight);
            }, 0) * 10) / 10;
          })();

          // ── Price range bonus for positions path ─────────────────────────────
          const pgPriceBucket = avgCurPrice < 0.20 ? "Longshot (0-20c)"
            : avgCurPrice < 0.40 ? "Underdog (20-40c)"
            : avgCurPrice < 0.60 ? "Flip (40-60c)"
            : avgCurPrice < 0.80 ? "Favorite (60-80c)"
            : "Safe (80-100c)";
          const pgPriceRangeAdj = (() => {
            let pts = 0, count = 0;
            for (const t of posTraders) {
              const cm = canonicalMap.get(t.wallet.toLowerCase());
              const stat = (cm?.priceStats as any)?.[pgPriceBucket] as { roi?: number; events?: number } | undefined;
              if (!stat || !stat.events || stat.events < 8) continue;
              const roi = stat.roi ?? 0;
              if (roi > 15) pts += 8; else if (roi > 8) pts += 5; else if (roi > 3) pts += 2;
              else if (roi < -15) pts -= 8; else if (roi < -8) pts -= 5; else if (roi < -3) pts -= 2;
              count++;
            }
            return count > 0 ? Math.max(-8, Math.min(8, Math.round(pts / count))) : 0;
          })();

          // Futures: zero out value delta (stale price info) and apply a recency-based cap.
          // Positions path has no trade timestamps, so we default to 70 — conservative
          // since these positions could be days or months old.
          const pgIsFutures = pgMarketCategory === "futures";
          const pgEffectiveValueDelta = pgIsFutures ? 0 : valueDelta;

          const { score: pgRawConf, breakdown } = computeConfidence(
            avgROI, consensusPct, pgEffectiveValueDelta, avgSize, posTraders.length, avgQualityForScore, counterTraderCount, pgRelBetSize
          );
          // Positions path: no timestamp → cap at 70 (unknown age, could be months old)
          const pgConfCap = pgIsFutures ? 70 : 100;
          let confidence = Math.max(5, Math.min(pgConfCap, pgRawConf + pgPriceRangeAdj));
          if (pgVipBypass) confidence = Math.min(100, confidence + 7);

          const mTypeRaw = categoriseMarket(pg.question, resolvedEndDate, resolvedGameStartTime, pg.slug || pgMarket?.slug);
          // pgMarketCategory already computed above
          // Specific game markets (moneyline/spread/total) should show as PREGAME, not FUTURES
          // even if the game is > 7 days away. FUTURES badge is reserved for season/championship bets.
          const mType = (mTypeRaw === "futures" && pgMarketCategory !== "futures") ? "pregame" : mTypeRaw;
          const pgPriceTiming = mType === "live" ? "live" : "pregame";
          const priceStatus  = computePriceStatus(avgCurPrice, avgEntry, pg.side, pgPriceTiming);
          // Stale signal filter: any "moved" status means price is worse for new buyers — hide it.
          if (priceStatus === "moved") continue;
          const isActionable = priceStatus === "actionable" || priceStatus === "dip";
          const bigPlayScore = computeBigPlayScore(posTotalValue, posTraders.length, pgRelBetSize);
          const id = `pos-${pg.conditionId}-${pg.side}`;
          const isNew = !seenSignalIds.has(id);
          seenSignalIds.add(id);
          const pgYesTokenId = pg.yesAsset || pgMarket?.tokenIds?.[0];
          const pgNoTokenId  = pg.noAsset  || pgMarket?.tokenIds?.[1];
          const tradersSorted = [...posTraders]
            .filter(t => {
              const cat = getEffectiveCategoryFilter(t.wallet.toLowerCase(), metricsByWallet.get(t.wallet.toLowerCase()));
              if (!cat?.doNotTail?.length) return true;
              return !cat.doNotTail.includes(pgSportDetailed) && !cat.doNotTail.includes(pgSport);
            })
            .sort((a, b) => b.currentValue - a.currentValue);
          if (tradersSorted.length === 0) continue; // all traders doNotTail for this sport — skip signal
          const pgSlippagePct = Math.round((pg.side === "YES"
            ? (avgCurPrice - avgEntry) * 100
            : (avgEntry - avgCurPrice) * 100) * 10) / 10;
          const rawPgROI = posTraders.reduce((s, t) => {
            const cm = canonicalMap.get(t.wallet.toLowerCase());
            const overall = cm?.overallROI ?? lbMap.get(t.wallet)?.roi ?? 0;
            const sportEntry = cm?.roiBySport?.[pgSportDetailed] ?? cm?.roiBySport?.[pgSport];
            const minSp = ELITE_LANE_SAMPLE_MIN;
            let roi = (sportEntry && sportEntry.tradeCount >= minSp)
              ? sportEntry.roi
              : overall;
            if (
              sportEntry && (sportEntry.tradeCount ?? 0) >= minSp
              && !sportLaneTrustworthy(overall, roi, sportEntry.winRate ?? 0, sportEntry.tradeCount ?? 0)
            ) roi = overall;
            return s + roi * pgQualityWeight(t);
          }, 0) / pgTotalQualityWeight;
          const pgInsiderSportsROI = Math.round(rawPgROI * 10) / 10;
          const pgInsiderTrades = posTraders.reduce((s, t) => {
            const cm = canonicalMap.get(t.wallet.toLowerCase());
            const sportEntry = cm?.roiBySport?.[pgSportDetailed] ?? cm?.roiBySport?.[pgSport];
            const minSp = ELITE_LANE_SAMPLE_MIN;
            const sportCount = (sportEntry && (sportEntry.tradeCount ?? 0) >= minSp) ? sportEntry.tradeCount : 0;
            return s + (sportCount > 0 ? sportCount : ((cm?.totalTrades ?? 0) > 0 ? cm!.totalTrades : 1));
          }, 0);
          const rawPgWR = posTraders.reduce((s, t) => {
            const cm = canonicalMap.get(t.wallet.toLowerCase());
            const overall = cm?.overallROI ?? lbMap.get(t.wallet)?.roi ?? 0;
            const sportEntry = cm?.roiBySport?.[pgSportDetailed] ?? cm?.roiBySport?.[pgSport];
            const minSp = ELITE_LANE_SAMPLE_MIN;
            let wr = (sportEntry && (sportEntry.tradeCount ?? 0) >= minSp)
              ? (sportEntry.winRate ?? 0)
              : (cm?.winRate ?? 0);
            if (
              sportEntry && (sportEntry.tradeCount ?? 0) >= minSp
              && !sportLaneTrustworthy(overall, sportEntry.roi ?? 0, wr, sportEntry.tradeCount ?? 0)
            ) wr = (cm?.winRate ?? 0);
            return s + wr * pgQualityWeight(t);
          }, 0) / pgTotalQualityWeight;
          const pgInsiderWinRate = Math.round(rawPgWR * 10) / 10;

          const tokenForFinalPos = pg.side === "YES" ? pg.yesAsset : pg.noAsset;
          if (tokenForFinalPos) {
            const pxLastPos = mType === "live" ? await fetchMidpointUncached(tokenForFinalPos) : null;
            if (mType === "live" && (pxLastPos === null || !Number.isFinite(pxLastPos))) continue;
            const pxUsePos = pxLastPos !== null && Number.isFinite(pxLastPos) ? pxLastPos : avgCurPrice;
            const bandLastPos = mType === "live" ? ENTRY_VS_LIVE_MAX_INPLAY : ENTRY_VS_LIVE_MAX;
            if (tradersSorted.some(t => Math.abs(t.entryPrice - pxUsePos) > bandLastPos)) continue;
          }

          signals.push({
            id, marketId: pg.conditionId,
            marketQuestion: pg.question,
            slug: pg.slug || pgMarket?.slug,
            endDate: resolvedEndDate,
            gameStartTime: resolvedGameStartTime,
            outcome: pg.side, side: pg.side,
            confidence, tier: posTraders.length >= 3 ? "HIGH" : "MED",
            marketType: mType, isSports: true,
            marketCategory: pgMarketCategory,
            vipPremium: pgVipBypass,
            isActionable,
            priceStatus,
            priceRangeAdj: pgPriceRangeAdj,
            priceBucket: pgPriceBucket,
            bigPlayScore,
            consensusPct: 100,
            valueDelta: pgIsFutures ? 0 : Math.round(valueDelta * 1000) / 1000,
            currentPrice: Math.round(avgCurPrice * 1000) / 1000,
            avgEntryPrice: Math.round(avgEntry * 1000) / 1000,
            totalNetUsdc: Math.round(posTotalValue),
            avgNetUsdc: Math.round(avgSize),
            totalRiskUsdc: Math.round(posTraders.reduce((s, t) => s + t.costBasis, 0)),
            avgRiskUsdc: Math.round(posTraders.reduce((s, t) => s + t.costBasis, 0) / Math.max(tradersSorted.length, 1)),
            traderCount: tradersSorted.length,
            lbTraderCount: posTraders.filter(t => lbMap.get(t.wallet)?.isLeaderboard).length,
            sportsLbCount: posTraders.filter(t => t.isSportsLb).length,
            counterTraderCount,
            avgQuality: avgQualityForScore,
            scoreBreakdown: breakdown,
            relBetSize: pgRelBetSize, slippagePct: pgSlippagePct,
            insiderSportsROI: pgInsiderSportsROI, insiderTrades: pgInsiderTrades, insiderWinRate: pgInsiderWinRate,
            traders: tradersSorted.slice(0, 8).map(t => {
              const tm = lbMap.get(t.wallet);
              const cm = canonicalMap.get(t.wallet.toLowerCase());
              const displayROI = cm?.overallROI ?? tm?.roi ?? 0;
              const displayQuality = (cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : (tm?.qualityScore ?? 20);
              const sportEntry = cm?.roiBySport?.[pgSportDetailed] ?? cm?.roiBySport?.[pgSport];
              const smEntryPg = cm?.roiBySportMarketType?.[pgSportMktKey];
              const sEntryPg  = cm?.roiBySport?.[pgSportDetailed] ?? cm?.roiBySport?.[pgSport];
              const normalBetPg = effectiveNormalPositionUsd(cm, smEntryPg, sEntryPg, Math.max(avgSize, 1), pgSportDetailed, pgSport);
              const traderRelSize = Math.round(Math.min(t.costBasis / Math.max(normalBetPg, 1), 20) * 10) / 10;
              const sportRoiPg = sportEntry?.roi ?? null;
              const sportWrPg = sportEntry?.winRate ?? null;
              const sportNPg = sportEntry?.tradeCount ?? 0;
              const pgLaneOk =
                sportRoiPg != null
                && sportWrPg != null
                && sportLaneTrustworthy(displayROI, sportRoiPg, sportWrPg, sportNPg);
              const capRoi = pgLaneOk ? sportRoiPg : (sportRoiPg != null ? displayROI : null);
              const capWr = pgLaneOk ? sportWrPg : (sportWrPg != null ? (cm?.winRate ?? null) : null);
              return {
                address: t.wallet,
                name: t.name,
                entryPrice: Math.round(t.entryPrice * 1000) / 1000,
                size: Math.round(t.shares),
                netUsdc: Math.round(t.costBasis),
                riskUsdc: Math.round(t.costBasis),
                roi: Math.round(displayROI * 10) / 10,
                qualityScore: displayQuality,
                pnl: tm?.pnl ?? 0,
                isLeaderboard: tm?.isLeaderboard ?? false,
                isSportsLb: t.isSportsLb,
                winRate: cm?.winRate ?? 0,
                totalTrades: cm?.totalTrades ?? 0,
                sportRoi: capRoi,
                sportTradeCount: sportEntry?.tradeCount ?? null,
                sportWinRate: capWr,
                sportAvgBet: sportEntry?.avgBet ?? null,
                tags: cm?.tags ?? [],
                tradeTime: 0,
                traderRelSize,
              };
            }),
            counterTraders: (() => {
              const oppPg = posMap.get(oppositeKey);
              if (!oppPg?.traders?.length) return [];
              return oppPg.traders.slice(0, 4).map(t => {
                const cm = canonicalMap.get(t.wallet.toLowerCase());
                const sportEntry = cm?.roiBySport?.[pgSportDetailed] ?? cm?.roiBySport?.[pgSport];
                return {
                  address: t.wallet,
                  name: t.name,
                  entryPrice: Math.round(t.entryPrice * 100) / 100,
                  netUsdc: Math.round(t.costBasis),
                  qualityScore: (cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : (lbMap.get(t.wallet)?.qualityScore ?? 20),
                  isSportsLb: t.isSportsLb,
                  sportRoi: (() => {
                    const se = sportEntry;
                    if (!se || !Number.isFinite(se.roi)) return null;
                    return sportLaneTrustworthy(cm?.overallROI ?? 0, se.roi, se.winRate ?? 0, se.tradeCount ?? 0)
                      ? se.roi
                      : (cm?.overallROI ?? null);
                  })(),
                  tradeTime: 0,
                };
              });
            })(),
            category: "sports",
            sport: pgSport,
            volume: 0,
            generatedAt: now,
            isValue: !pgIsFutures && valueDelta > 0,
            isNew,
            futuresCap: pgIsFutures ? pgConfCap : undefined,
            source: "positions",
            outcomeLabel: computeOutcomeLabel(pg.question, pg.side),
            yesTokenId: pgYesTokenId,
            noTokenId: pgNoTokenId,
          });
        }
        console.log(`[Elite v11] Added ${signals.length - (signals.length - posMap.size)} positions-based signals from top sports traders`);
      }

      // Filter out any signals for postponed, cancelled, inactive, or voided markets
      const beforeFilter = signals.length;
      for (let i = signals.length - 1; i >= 0; i--) {
        const sig = signals[i];
        const mdbEntry = marketDb.get(sig.marketId);
        // Remove if market is explicitly inactive in Polymarket (postponed/cancelled)
        const isInactive = mdbEntry && !mdbEntry.active;
        if (isInactive || isPostponedOrCancelled(sig.marketQuestion || "", true, false)) {
          signals.splice(i, 1);
        }
      }
      if (signals.length < beforeFilter) {
        console.log(`[PostponedFilter] Removed ${beforeFilter - signals.length} cancelled/postponed/inactive signals`);
      }

      // ── Cross-O/U conflict detection ──────────────────────────────────────────
      // If sharps are on OVER at line X AND UNDER at line Y for the same game,
      // the signals are directionally conflicting even though the conditionIds differ.
      // Flag both with splitOU=true so the UI can show a SPLIT badge and lower confidence.
      {
        const ouGameMap = new Map<string, { overSigs: any[]; underSigs: any[] }>();
        function extractGameKey(q: string): string {
          // Strip the O/U line from a question like "Timberwolves vs. Lakers: Over/Under 232.5"
          return q.replace(/[\s:]+(?:over\/?under|o\/u|total)[\s\d.?]+$/i, "").trim().toLowerCase();
        }
        for (const sig of signals) {
          if (sig.marketCategory !== "total") continue;
          const key = extractGameKey(sig.marketQuestion || "");
          if (!key) continue;
          const entry = ouGameMap.get(key) || { overSigs: [], underSigs: [] };
          if (sig.side === "YES") entry.overSigs.push(sig);
          else entry.underSigs.push(sig);
          ouGameMap.set(key, entry);
        }
        for (const { overSigs, underSigs } of ouGameMap.values()) {
          if (overSigs.length === 0 || underSigs.length === 0) continue;
          // Both Over and Under signals exist for the same game — flag all of them
          for (const s of [...overSigs, ...underSigs]) {
            s.splitOU = true;
            // Reduce confidence by 12 pts to reflect uncertainty
            s.confidence = Math.max(s.confidence - 12, 30);
          }
          const lines = [...overSigs, ...underSigs].map(s => s.marketQuestion?.match(/[\d.]+\??$/)?.[0] || "?");
          console.log(`[CrossOU] Split O/U on same game (${extractGameKey(overSigs[0].marketQuestion || "")}): lines ${lines.join(", ")} — flagging ${overSigs.length + underSigs.length} signals`);
        }
      }

      // ── Elite trader detection (T005) ────────────────────────────────────────
      // Post-process: elite roster traders on either side (same merge as Phase 1)
      if (signalRosterSet.size > 0) {
        // Build a market → { YES: elites[], NO: elites[] } index
        const mktEliteMap = new Map<string, { yes: {wallet:string;username:string}[]; no: {wallet:string;username:string}[] }>();
        for (const sig of signals) {
          const mid = sig.marketId;
          if (!mktEliteMap.has(mid)) mktEliteMap.set(mid, { yes: [], no: [] });
          const bucket = mktEliteMap.get(mid)!;
          const sigSportFull = classifySportFull(sig.sport || "", sig.marketQuestion || "", (sig as any).slug || "");
          for (const t of (sig.traders || [])) {
            const w = (t.address || "").toLowerCase();
            if (!signalRosterSet.has(w)) continue;
            // Skip this trader's vote if the signal's sport or market type is filtered (CSV-derived when present)
            const catFilter = getEffectiveCategoryFilter(w, metricsByWallet.get(w));
            if (catFilter && catFilter.doNotTail.includes(sigSportFull)) continue;
            if (catFilter?.doNotTailMarketTypes?.length) {
              const mktType = classifyMarketType(sig.marketQuestion || "");
              if (catFilter.doNotTailMarketTypes.includes(mktType)) continue;
            }
            // doNotTailSides: skip this trader's vote when the signal side is one they have no edge on
            // e.g. grinders who only add value buying YES underdogs — their NO votes are noise
            if (catFilter?.doNotTailSides?.length) {
              const normalizedSide = sig.side === "YES" ? "Yes" : "No";
              if (catFilter.doNotTailSides.includes(normalizedSide)) continue;
            }
            // doNotTailTitleKeywords: block specific market types by title substring (case-insensitive)
            // e.g. ["draw"] for traders who reliably lose on draw-outcome markets
            if (catFilter?.doNotTailTitleKeywords?.length) {
              const q = (sig.marketQuestion || "").toLowerCase();
              if (catFilter.doNotTailTitleKeywords.some(kw => q.includes(kw.toLowerCase()))) continue;
            }
            const username = curatedWalletToUsername.get(w) || lbMap.get(w)?.name || t.name || w.slice(0, 8);
            (sig.side === "YES" ? bucket.yes : bucket.no).push({ wallet: w, username });
          }
        }
        // Enrich signals
        for (const sig of signals) {
          const mid = sig.marketId;
          const bucket = mktEliteMap.get(mid) || { yes: [], no: [] };
          const sideElites = sig.side === "YES" ? bucket.yes : bucket.no;
          const oppElites  = sig.side === "YES" ? bucket.no  : bucket.yes;
          const hasSplit = sideElites.length > 0 && oppElites.length > 0;
          if (sideElites.length > 0 || hasSplit) {
            (sig as any).hasEliteRoster = sideElites.length > 0;
            (sig as any).hasCuratedElite = sideElites.length > 0; // alias for older clients
            (sig as any).curatedEliteSplit = hasSplit;
            (sig as any).curatedElites = sideElites;
            if (hasSplit) {
              (sig as any).curatedEliteSplitNote = `⚡ ELITE SPLIT: ${sideElites.map(e => e.username).join(",")} ${sig.side} vs ${oppElites.map(e => e.username).join(",")} ${sig.side === "YES" ? "NO" : "YES"}`;
              sig.confidence = Math.max(sig.confidence - 15, 20);
            } else {
              // Boost confidence +8pts per curated elite, respecting the recency-based
              // futuresCap stored at signal creation time (95 for same-day futures down
              // to 55 for 60+ day old positions). Game signals always cap at 100.
              const eliteBoostCap = (sig as any).futuresCap ?? 100;
              sig.confidence = Math.min(eliteBoostCap, sig.confidence + sideElites.length * 8);
            }
          }
        }
      }

      // ── Cluster detection: sports-LB traders not on the elite roster ─────────
      // When 2+ such traders co-invest same direction within 60 min with combined size ≥ $5K → boost or create a signal.
      {
        const sixtyMinAgo = now - 60 * 60_000;
        type ClusterEntry = { wallet:string; name:string; size:number; price:number; ts:number; title:string; slug:string; roi:number; isSportsLb:boolean };
        const clusterMap = new Map<string, ClusterEntry[]>();

        for (const trade of allTrades) {
          const wallet = (trade.proxyWallet || "").toLowerCase();
          if (!lbMap.has(wallet)) continue;
          if (signalRosterSet.has(wallet)) continue;
          const ts = tradeTimestampMs(trade);
          if (ts < sixtyMinAgo) continue;
          const size = parseFloat(trade.size || trade.amount || "0");
          if (size < 500) continue;
          const title = trade.title || trade.market || "";
          if (!isSportsRelated(title)) continue;
          const price = parseFloat(trade.price || "0.5");
          if (price < 0.05 || price > 0.95) continue;
          const condId = trade.conditionId || "";
          if (!condId) continue;
          const side = resolveSide(trade.outcome, trade.outcomeIndex);
          const key = `${condId}|${side}`;
          if (!clusterMap.has(key)) clusterMap.set(key, []);
          const lbInfo = lbMap.get(wallet);
          clusterMap.get(key)!.push({
            wallet, name: lbInfo?.name || wallet.slice(0, 8),
            size, price, ts, title, slug: trade.slug || "",
            roi: lbInfo?.roi ?? 0, isSportsLb: lbInfo?.isSportsLb ?? false,
          });
        }

        for (const [key, clusterTrades] of clusterMap) {
          const [condId, side] = key.split("|") as [string, "YES"|"NO"];
          // Deduplicate by wallet, keep largest trade per wallet
          const byWallet = new Map<string, ClusterEntry>();
          for (const t of clusterTrades) {
            const ex = byWallet.get(t.wallet);
            if (!ex || t.size > ex.size) byWallet.set(t.wallet, t);
          }
          const unique = [...byWallet.values()];
          if (unique.length < 2) continue;

          const dbEntry = sharedMarketDb.get(condId);
          if (dbEntry && !dbEntry.active) continue;

          const tokenIds = dbEntry?.tokenIds as string[] | undefined;
          const tokenId = tokenIds && tokenIds.length >= 2
            ? (side === "YES" ? tokenIds[0] : tokenIds[1])
            : (tokenIds?.[0] ?? "");
          const repForCat = clusterTrades[0];
          const mTypeBandCluster = categoriseMarket(repForCat.title, dbEntry?.endDate, dbEntry?.gameStartTime, repForCat.slug);
          const entryVsLiveBandCluster = mTypeBandCluster === "live" ? ENTRY_VS_LIVE_MAX_INPLAY : ENTRY_VS_LIVE_MAX;
          let liveMid: number | null = null;
          if (tokenId) {
            if (mTypeBandCluster === "live") {
              const mid = await fetchMidpointUncached(tokenId);
              if (mid !== null && Number.isFinite(mid)) {
                liveMid = mid;
                midpointMap.set(tokenId, mid);
              }
            } else {
              const cached = midpointMap.get(tokenId);
              if (cached !== undefined && Number.isFinite(cached)) liveMid = cached;
              else {
                const mid = await fetchMidpoint(tokenId);
                if (mid !== null) {
                  liveMid = mid;
                  midpointMap.set(tokenId, mid);
                }
              }
            }
          }
          if (liveMid === null) continue;

          const uniqueFiltered = unique.filter(t => Math.abs(t.price - liveMid) <= entryVsLiveBandCluster);
          if (uniqueFiltered.length < 2) continue;
          const totalSize = uniqueFiltered.reduce((s, t) => s + t.size, 0);
          if (totalSize < 5000) continue;

          // Check for an existing curated signal for this conditionId + side
          const existingIdx = signals.findIndex(s => s.marketId === condId && s.side === side);
          if (existingIdx >= 0) {
            const boost = Math.min(12, uniqueFiltered.length * 5);
            signals[existingIdx].confidence = Math.min(100, signals[existingIdx].confidence + boost);
            (signals[existingIdx] as any).clusterBoost = { traders: uniqueFiltered.length, combinedSize: Math.round(totalSize) };
            continue;
          }

          // No curated signal exists → create a standalone cluster signal
          const rep = uniqueFiltered.sort((a, b) => b.ts - a.ts)[0];
          if (isPostponedOrCancelled(rep.title, true, false)) continue;

          const avgPrice = uniqueFiltered.reduce((s, t) => s + t.price * t.size, 0) / totalSize;
          const avgRoi = uniqueFiltered.reduce((s, t) => s + t.roi, 0) / uniqueFiltered.length;
          const mType = categoriseMarket(rep.title, dbEntry?.endDate, dbEntry?.gameStartTime, rep.slug);
          const sport = classifySport(rep.slug, rep.title);
          const mCategory = classifyMarketType(rep.title);

          const roiPct = Math.min(20, Math.floor(avgRoi / 5));
          const sizePct = Math.min(15, Math.floor(totalSize / 2000));
          const countBonus = Math.min(10, (uniqueFiltered.length - 1) * 5);
          const clusterConf = Math.min(82, 40 + roiPct + sizePct + countBonus);

          const cSignalId = `cluster-${condId}-${side}`;
          const isNew = !seenSignalIds.has(cSignalId);
          seenSignalIds.add(cSignalId);

          signals.push({
            id: cSignalId,
            marketId: condId,
            marketQuestion: rep.title,
            slug: rep.slug,
            endDate: dbEntry?.endDate || "",
            outcome: side,
            side,
            confidence: clusterConf,
            tier: uniqueFiltered.length >= 3 ? "HIGH" : "MED",
            marketType: mType,
            isSports: true,
            marketCategory: mCategory,
            isActionable: true,
            priceStatus: "cluster",
            bigPlayScore: computeBigPlayScore(totalSize, uniqueFiltered.length),
            consensusPct: 100,
            valueDelta: 0,
            currentPrice: Math.round(liveMid * 1000) / 1000,
            avgEntryPrice: Math.round(avgPrice * 1000) / 1000,
            totalNetUsdc: Math.round(totalSize),
            avgNetUsdc: Math.round(totalSize / uniqueFiltered.length),
            totalRiskUsdc: Math.round(totalSize * avgPrice),
            avgRiskUsdc: Math.round(totalSize * avgPrice / uniqueFiltered.length),
            traderCount: uniqueFiltered.length,
            lbTraderCount: uniqueFiltered.length,
            sportsLbCount: uniqueFiltered.filter(t => t.isSportsLb).length,
            counterTraderCount: 0,
            avgQuality: Math.min(90, 50 + avgRoi * 2),
            scoreBreakdown: { roiPct, consensusPct: countBonus, valuePct: 0, sizePct, tierBonus: 0 },
            relBetSize: totalSize / 2000,
            slippagePct: 0,
            insiderSportsROI: avgRoi,
            insiderTrades: 0,
            insiderWinRate: 0,
            traders: uniqueFiltered.map(t => ({
              address: t.wallet, name: t.name,
              entryPrice: t.price, size: t.size, netUsdc: t.size,
              riskUsdc: Math.round(t.size * t.price),
              roi: t.roi, qualityScore: 60, pnl: 0,
              isLeaderboard: true, isSportsLb: t.isSportsLb,
              tradeTime: t.ts, winRate: 0, totalTrades: 0,
              sportRoi: t.roi, sportTradeCount: 0, sportWinRate: 0, sportAvgBet: t.size,
              tags: ["🎯 Cluster Play"],
            })),
            counterTraders: [],
            category: "sports",
            sport,
            volume: 0,
            generatedAt: now,
            isValue: false,
            isNew,
            source: "cluster",
            outcomeLabel: side,
            hasCuratedElite: false,
            curatedEliteSplit: false,
            curatedElites: [],
          } as any);
        }
        console.log(`[Cluster] detected ${[...clusterMap.values()].filter(v => [...new Map(v.map(t=>[t.wallet,t])).values()].length >= 2).length} cluster plays from non-curated tracked traders`);
      }

      signals.sort(compareSignalsQualityConfidence);

      // ── Best-of-best filters (query params); default minQuality 40 aligns with in-loop B-Tier floor (avgQuality<40 drops unless VIP).
      // Old default 50 hid many valid multi-trader / futures plays where dollar-weighted quality sits in the 40s.
      let outSignals = signals;
      const effectiveMinQuality = minQuality != null && !isNaN(minQuality) ? minQuality : 40;
      outSignals = outSignals.filter(s =>
        (s.avgQuality ?? 0) >= effectiveMinQuality
        || s.vipPremium === true
        || (s as any).hasCuratedElite === true
      );
      if (minConfidence != null && !isNaN(minConfidence)) {
        outSignals = outSignals.filter(s => s.confidence >= minConfidence);
      }
      if (tierFilter === "HIGH" || tierFilter === "MED" || tierFilter === "SINGLE") {
        outSignals = outSignals.filter(s => s.tier === tierFilter);
      }
      // Diversity cap: max N signals per primary so one wallet does not own the list. Low Q (<40): tighter cap.
      const MAX_SIGNALS_PER_PRIMARY_IN_FEED = 5;
      const MAX_SIGNALS_PER_LOW_Q_PRIMARY = 2;
      const byPrimaryTrader = new Map<string, typeof outSignals>();
      for (const s of outSignals) {
        const primary = (s.traders?.[0] as any)?.address ?? (s.traders?.[0] as any)?.wallet ?? "";
        if (!primary) { byPrimaryTrader.set("_unknown", [...(byPrimaryTrader.get("_unknown") || []), s]); continue; }
        const list = byPrimaryTrader.get(primary) || [];
        list.push(s);
        byPrimaryTrader.set(primary, list);
      }
      outSignals = [];
      for (const [pwallet, list] of byPrimaryTrader.entries()) {
        list.sort((a, b) => {
          const vpa = a.vipPremium === true ? 1 : 0;
          const vpb = b.vipPremium === true ? 1 : 0;
          if (vpb !== vpa) return vpb - vpa;
          return (b.confidence - a.confidence) || ((b.avgQuality ?? 0) - (a.avgQuality ?? 0));
        });
        const pq = pwallet === "_unknown" ? 100 : (canonicalMap.get(pwallet.toLowerCase())?.qualityScore ?? 0);
        const cap = pq > 0 && pq < 40
          ? MAX_SIGNALS_PER_LOW_Q_PRIMARY
          : MAX_SIGNALS_PER_PRIMARY_IN_FEED;
        outSignals.push(...list.slice(0, cap));
      }
      outSignals = interleaveSignalsByPrimaryWallet(outSignals);
      console.log(`[Elite v16] ${signals.length} signals total (trades + positions)${hasFilter ? ` → filtered` : ""} → ${outSignals.length} after diversity cap + interleave`);

      // ── Populate signal-per-market registry for /api/markets sharp overlay ────
      signalsByMarket.clear();
      for (const s of outSignals) {
        const existing = signalsByMarket.get(s.marketId);
        // Cap overlay score: stacked ROI + elite +8 boosts can hit 100 without implying "perfect" reads;
        // sport-specific weakness (e.g. MLB) is not modeled per-market here.
        const cappedConf = Math.min(95, s.confidence);
        if (!existing || cappedConf > existing.confidence) {
          signalsByMarket.set(s.marketId, {
            side: s.side as "YES" | "NO",
            confidence: cappedConf,
            traderCount: s.traderCount,
            totalUsdc: s.totalNetUsdc,
            isActionable: s.isActionable,
            bigPlayScore: s.bigPlayScore,
            avgEntry: s.avgEntryPrice,
            currentPrice: s.currentPrice,
            marketCategory: s.marketCategory,
          });
        }
      }

      const response = {
        signals: outSignals,
        topTraderCount: canonicalMap.size || CURATED_ELITES.length,
        marketsScanned: marketDb.size,
        newSignalCount: outSignals.filter(s => s.isNew).length,
        fetchedAt: now,
        source: "verified_sports_v11",
      };
      // Shorter TTL so live/in-play rows refresh before prices move multiple cents off entry.
      if (cKey) setCache(cKey, response, 30 * 1000);

      // ── SSE push: broadcast new high-confidence signals to connected clients ──
      {
        const newHighConf = signals.filter(s => {
          if (!s.isNew || !s.isActionable) return false;
          // In-play: alert sooner (lower bar) so users can tail before the line moves.
          if (s.marketType === "live") return s.confidence >= 68;
          return s.confidence >= 80;
        });
        if (newHighConf.length > 0 && sseClients.size > 0) {
          broadcastSSE("signals", "new_signals", {
            signals: newHighConf.slice(0, 5).map(s => ({
              id: s.id, confidence: s.confidence, sport: s.sport,
              marketQuestion: s.marketQuestion, side: s.side,
              marketType: s.marketType, totalNetUsdc: s.totalNetUsdc,
            })),
            count: newHighConf.length,
            fetchedAt: now,
          });
          console.log(`[SSE] Pushed ${newHighConf.length} new high-confidence signals to ${sseClients.size} clients`);
        }
      }

      // Enrich game market registry non-blocking (fills volume/liquidity for /api/markets)
      enrichGameMarketsFromGamma().catch(e => console.warn("enrichGMR:", e.message));

      res.json(response);
    } catch (err: any) {
      const msg = formatApiError(err);
      console.error("Signals error:", msg);
      res.status(503).json({
        error: msg, signals: [], topTraderCount: 0,
        marketsScanned: 0, fetchedAt: Date.now(),
      });
    }
  });

  // ── GET /api/signals/fast ─── Live feed: stricter quality gates ──────────────
  app.get("/api/signals/fast", async (req, res) => {
    try {
      const cKey = "signals-fast-v12-elite-roster-unified";
      const hit  = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      const now = Date.now();
      const [rawFastTrades, marketDb, canonicalFast] = await Promise.all([
        fetchMergedEliteRosterTrades(UNIFIED_SIGNAL_TRADES_DEPTH),
        buildMarketDatabase(800).catch(() => new Map() as any),
        loadCanonicalMetricsFromDB(),
      ]);
      // Sort oldest→newest so sells always follow their buys in aggregation
      const allTrades = [...rawFastTrades].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      type WalletPos = { side: "YES"|"NO"; totalSize: number; prices: number[]; name: string; wallet: string };
      const marketWallets = new Map<string, {
        info: any;
        wallets: Map<string, WalletPos>;
      }>();

      for (const trade of allTrades) {
        const title = (trade.title || trade.slug || "").toLowerCase();
        if (!isSportsRelated(title)) continue;
        if (title.includes("up or down")) continue;
        if (/\d+m(in)?\.?\s*(up|down)/i.test(title)) continue;

        const condId = trade.conditionId || "";
        if (!condId) continue;

        // Market DB used for enrichment only — game markets close quickly and won't be in active DB
        const mInfo = marketDb.get(condId);
        // Skip only if market is confirmed-closed in our DB
        if (mInfo && !mInfo.active) continue;

        const wallet = trade.proxyWallet || "";
        if (!wallet) continue;

        const side: "YES"|"NO" = resolveSide(trade.outcome, trade.outcomeIndex);
        const price = parseFloat(trade.price || "0.5");
        const size  = parseFloat(trade.size  || "0");
        if (size < 150) continue; // skip tiny trades

        const infoObj = mInfo || {
          question: trade.title || condId,
          slug: trade.slug,
          endDate: undefined,
          active: true,
          tokenIds: trade.asset ? [String(trade.asset)] : [],
          category: "sports",
        };

        if (!marketWallets.has(condId)) {
          marketWallets.set(condId, { info: infoObj, wallets: new Map() });
        }
        const mw = marketWallets.get(condId)!;
        const isSellTrade = (trade.side || "").toUpperCase() === "SELL";
        const ex = mw.wallets.get(wallet);
        const name = displayName(trade.name || trade.pseudonym || "", wallet);
        if (!ex) {
          if (!isSellTrade) mw.wallets.set(wallet, { side, totalSize: size, prices: [price], name, wallet });
        } else {
          if (ex.side === side) {
            ex.totalSize += isSellTrade ? -size : size;
            if (!isSellTrade) ex.prices.push(price);
          } else if (!isSellTrade && size > ex.totalSize) {
            ex.side = side; ex.totalSize = size; ex.prices = [price];
          }
        }
      }

      // Remove fully-exited wallets (net sold to zero or below)
      for (const mw of marketWallets.values()) {
        for (const [w, pos] of mw.wallets.entries()) {
          if (pos.totalSize <= 0) mw.wallets.delete(w);
        }
      }

      const signals: any[] = [];
      const SLIPPAGE = 0.02;

      for (const [condId, mw] of marketWallets.entries()) {
        const entries = Array.from(mw.wallets.values());
        if (entries.length < 2) continue; // REQUIRE at least 2 traders

        const yesE = entries.filter(e => e.side === "YES");
        const noE  = entries.filter(e => e.side === "NO");
        const dominant = yesE.length >= noE.length ? yesE : noE;
        const side: "YES"|"NO" = yesE.length >= noE.length ? "YES" : "NO";
        if (dominant.length < 2) continue; // 2+ on dominant side

        const info = mw.info;
        const mTypeBandFast = categoriseMarket(info.question || condId, info.endDate, info.gameStartTime, info.slug);
        const entryVsLiveBandFast = mTypeBandFast === "live" ? ENTRY_VS_LIVE_MAX_INPLAY : ENTRY_VS_LIVE_MAX;
        const avgEntryPre = dominant.reduce((s, e) => s + (e.prices.reduce((a, b) => a + b, 0) / e.prices.length), 0) / dominant.length;
        let currentPrice = avgEntryPre;
        let tokenIdFast: string | undefined;
        if (info.tokenIds?.length > 0) {
          const tid = info.tokenIds[side === "YES" ? 0 : 1] ?? info.tokenIds[0];
          if (!tid) continue;
          tokenIdFast = tid;
          const mid = mTypeBandFast === "live" ? await fetchMidpointUncached(tid) : await fetchMidpoint(tid);
          if (mid !== null && Number.isFinite(mid)) {
            currentPrice = mid;
          } else {
            continue;
          }
        }

        if (currentPrice < 0.02 || currentPrice > 0.98) continue;

        currentPrice = Math.min(0.99, Math.max(0.01, currentPrice));

        if (currentPrice < 0.10 || currentPrice > 0.90) continue;

        // Same entry-vs-live gate as main /api/signals (3¢ in-play, 5¢ pregame when we have a CLOB midpoint)
        const dominantNear = info.tokenIds?.length
          ? dominant.filter(e => {
              const avgE = e.prices.reduce((a, b) => a + b, 0) / Math.max(e.prices.length, 1);
              return Math.abs(avgE - currentPrice) <= entryVsLiveBandFast;
            })
          : dominant;
        if (dominantNear.length < 2) continue;

        const totalDominantSize = dominantNear.reduce((s, e) => s + e.totalSize, 0);
        if (totalDominantSize < 500) continue; // minimum $500 aggregate position

        const avgEntryCheck2 = dominantNear.reduce((s, e) =>
          s + (e.prices.reduce((a, b) => a + b, 0) / e.prices.length), 0) / dominantNear.length;
        if (avgEntryCheck2 > 0.88) continue;

        const consensusPct = (dominantNear.length / entries.length) * 100;
        if (consensusPct < 50) continue;

        const avgEntry = dominantNear.reduce((s, e) => s + (e.prices.reduce((a, b) => a + b, 0) / e.prices.length), 0) / dominantNear.length;
        const avgSize  = totalDominantSize / dominantNear.length;

        // Positive = sharps paid more than live = you enter cheaper = value edge.
        const valueDelta = avgEntry - currentPrice - SLIPPAGE;

        // Real dollar-weighted quality from curated profiles — was hardcoded 40 so high-volume
        // traders (e.g. 0p0jogggg) dominated /api/signals/fast with no quality gate.
        const fastRisk = totalDominantSize || 1;
        const fastAvgQuality = Math.round(
          dominantNear.reduce((s, e) => {
            const cm = canonicalFast.get(e.wallet.toLowerCase());
            const q = (cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : 0;
            return s + q * e.totalSize;
          }, 0) / fastRisk
        );
        if (fastAvgQuality < 40) continue;

        const { score: confidence, breakdown } = computeConfidence(
          15, consensusPct, valueDelta, avgSize, dominantNear.length, fastAvgQuality
        );

        const tier = dominantNear.length >= 3 ? "HIGH" : "MED";
        const marketTypeRaw = categoriseMarket(info.question || condId, info.endDate, info.gameStartTime, info.slug);
        const marketCategory = classifyMarketType(info.question || condId);
        // Specific game markets should be PREGAME, not FUTURES regardless of time horizon
        const marketType = (marketTypeRaw === "futures" && marketCategory !== "futures") ? "pregame" : marketTypeRaw;
        const isActionable = computeIsActionable(currentPrice, avgEntry, side, marketType === "live" ? "live" : "pregame");
        const bigPlayScore = computeBigPlayScore(totalDominantSize, dominantNear.length);

        if (tokenIdFast) {
          const pxLastFast = await fetchMidpointUncached(tokenIdFast);
          if (marketType === "live" && (pxLastFast === null || !Number.isFinite(pxLastFast))) continue;
          const pxUseFast = pxLastFast !== null && Number.isFinite(pxLastFast) ? pxLastFast : currentPrice;
          const bandLastFast = marketType === "live" ? ENTRY_VS_LIVE_MAX_INPLAY : ENTRY_VS_LIVE_MAX;
          if (dominantNear.some(e => {
            const avgE = e.prices.reduce((a, b) => a + b, 0) / Math.max(e.prices.length, 1);
            return Math.abs(avgE - pxUseFast) > bandLastFast;
          })) continue;
        }

        signals.push({
          id: `fast-${condId}-${side}`,
          marketId: condId,
          marketQuestion: info.question || condId,
          slug: info.slug,
          outcome: side, side,
          confidence, tier, marketType, marketCategory,
          isActionable, bigPlayScore,
          consensusPct: Math.round(consensusPct),
          valueDelta: Math.round(valueDelta * 1000) / 1000,
          currentPrice: Math.round(currentPrice * 1000) / 1000,
          avgEntryPrice: Math.round(avgEntry * 1000) / 1000,
          totalNetUsdc: Math.round(totalDominantSize),
          avgNetUsdc: Math.round(avgSize),
          totalRiskUsdc: Math.round(dominantNear.reduce((s, e) => { const p = e.prices.reduce((a,b)=>a+b,0)/e.prices.length; return s + e.totalSize * p; }, 0)),
          avgRiskUsdc: Math.round(dominantNear.reduce((s, e) => { const p = e.prices.reduce((a,b)=>a+b,0)/e.prices.length; return s + e.totalSize * p; }, 0) / Math.max(dominantNear.length, 1)),
          traderCount: dominantNear.length,
          avgQuality: fastAvgQuality,
          scoreBreakdown: breakdown,
          traders: dominantNear.slice(0, 8).map(e => {
            const avgEP2 = e.prices.reduce((a, b) => a + b, 0) / e.prices.length;
            const cm = canonicalFast.get(e.wallet.toLowerCase());
            const q = (cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : 0;
            return {
              address: e.wallet,
              name: e.name,
              entryPrice: Math.round(avgEP2 * 1000) / 1000,
              size: Math.round(e.totalSize),
              netUsdc: Math.round(e.totalSize),
              riskUsdc: Math.round(e.totalSize * avgEP2),
              roi: cm?.overallROI ?? 0,
              qualityScore: q,
            };
          }),
          category: info.category || "sports",
          sport: classifySport(info.slug || "", info.question || condId),
          volume: info.volume || 0,
          generatedAt: now,
          isValue: valueDelta > 0,
          isNew: false,
          source: "trades",
          outcomeLabel: computeOutcomeLabel(info.question || condId, side),
        });
      }

      signals.sort(compareSignalsQualityConfidence);

      const response = {
        signals,
        topTraderCount: CURATED_ELITES.length,
        marketsScanned: marketDb.size,
        newSignalCount: 0,
        fetchedAt: now,
        source: "live_activity_v5",
      };
      setCache(cKey, response, 90_000);
      res.json(response);
    } catch (err: any) {
      console.error("Fast signals error:", err.message);
      res.status(500).json({ error: err.message, signals: [], topTraderCount: 0, marketsScanned: 0, fetchedAt: Date.now() });
    }
  });

  // ── GET /api/trader/:address/positions ─────────────────────────────────────
  app.get("/api/trader/:address/positions", async (req, res) => {
    try {
      const addr = req.params.address.toLowerCase();
      const cKey = `trader-pos-${addr}`;
      const hit  = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      const rows = await fetchTraderPositions(addr);
      if (rows.length === 0) { res.json({ address: addr, positions: [], fetchedAt: Date.now() }); return; }

      const tokenIds = [...new Set(rows.map(r => String(r.tokenId)))];
      const rawMarkets = await fetchSportsMarkets();
      let tokenMap = buildTokenMapFromRaw(rawMarkets);
      const missing = tokenIds.filter(id => !tokenMap.has(id));
      if (missing.length > 0) {
        const extra = await fetchMarketsByTokenIds(missing);
        for (const [k, v] of extra) tokenMap.set(k, v);
      }

      const positions = rows.map(row => {
        const tokenId  = String(row.tokenId);
        const mInfo    = tokenMap.get(tokenId);
        const netShares = parseFloat(row.amount) / AMOUNT_SCALE;
        const avgPrice  = parseFloat(row.avgPrice) / PRICE_SCALE;
        const netUsdc   = netShares * avgPrice;
        return {
          tokenId,
          conditionId: mInfo?.conditionId || "",
          question: mInfo?.question || tokenId,
          slug: mInfo?.slug,
          side: resolveSide(mInfo?.outcome, mInfo?.outcomeIndex),
          outcome: mInfo?.outcome || "Yes",
          netShares: Math.round(netShares),
          avgPrice: Math.round(avgPrice * 1000) / 1000,
          netUsdc: Math.round(netUsdc),
          currentPrice: mInfo?.currentPrice || 0.5,
          realizedPnl: Math.round(parseFloat(row.realizedPnl || "0") / AMOUNT_SCALE),
          category: mInfo?.category || "sports",
        };
      }).filter(p => p.netShares >= 1);

      const result = { address: addr, positions, fetchedAt: Date.now() };
      setCache(cKey, result, 3 * 60 * 1000);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message, positions: [], fetchedAt: Date.now() });
    }
  });

  // ── GET /api/market/:tokenId/price ─────────────────────────────────────────
  app.get("/api/market/:tokenId/price", async (req, res) => {
    try {
      const mid = await fetchMidpoint(req.params.tokenId);
      res.json({ tokenId: req.params.tokenId, midpoint: mid, fetchedAt: Date.now() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/market/price-by-condition/:conditionId ──────────────────────────
  // Returns the current live YES price for a condition ID by looking up the
  // signal cache or fetching fresh from Gamma API.
  app.get("/api/market/price-by-condition/:conditionId", async (req, res) => {
    try {
      const condId = req.params.conditionId;
      // 1. Check signal registry first (most up-to-date)
      const sig = signalsByMarket.get(condId);
      if (sig) {
        return res.json({
          conditionId: condId,
          currentPrice: sig.currentPrice,
          americanOdds: toAmericanOdds(sig.currentPrice),
          side: sig.side,
          fetchedAt: Date.now(),
          source: "signal_cache",
        });
      }
      // 2. Check game market registry
      const entry = gameMarketRegistry.get(condId);
      if (entry?.currentPrice) {
        return res.json({
          conditionId: condId,
          currentPrice: entry.currentPrice,
          americanOdds: toAmericanOdds(entry.currentPrice),
          fetchedAt: Date.now(),
          source: "market_registry",
        });
      }
      // 3. Hit Gamma API to get tokens
      const gmRes = await fetch(`${GAMMA_API}/markets?condition_id=${condId}&limit=1`);
      if (gmRes.ok) {
        const gmData = await gmRes.json();
        const mkt = Array.isArray(gmData) ? gmData[0] : gmData?.markets?.[0];
        if (mkt) {
          const priceStr = mkt.lastTradePrice || mkt.bestAsk || mkt.midpoint;
          const price = priceStr ? parseFloat(priceStr) : null;
          if (price && price > 0) {
            return res.json({
              conditionId: condId,
              currentPrice: price,
              americanOdds: toAmericanOdds(price),
              fetchedAt: Date.now(),
              source: "gamma",
            });
          }
        }
      }
      res.status(404).json({ error: "Price not found", conditionId: condId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/trader/quick/:wallet ─────────────────────────────────────────────
  // Returns quick stats for any trader — checks elite DB first, falls back to Polymarket API
  app.get("/api/trader/quick/:wallet", async (req, res) => {
    try {
      const raw = req.params.wallet;
      const wallet = raw.toLowerCase().slice(0, 42); // strip any -timestamp suffix

      // 1. Check elite_traders DB first (instant)
      const eliteRow = await elitePool.query(
        `SELECT et.wallet, et.polymarket_url,
                etp.quality_score,
                etp.tags,
                etp.metrics->>'overallROI'   AS roi,
                etp.metrics->>'winRate'      AS win_rate,
                etp.metrics->>'totalBets'    AS total_bets,
                etp.metrics->>'topSport'     AS top_sport,
                etp.metrics->'roiBySport'    AS roi_by_sport
         FROM elite_traders et
         LEFT JOIN elite_trader_profiles etp ON LOWER(etp.wallet) = LOWER(et.wallet)
         WHERE LOWER(et.wallet) = LOWER($1)`,
        [wallet]
      );
      if (eliteRow.rows[0]) {
        const r = eliteRow.rows[0];
        const roiBySport: Record<string, any> = r.roi_by_sport ?? {};
        const topSport: string | null = r.top_sport ?? null;
        const sportEntry = topSport ? roiBySport[topSport] : null;
        const overallRoiQuick = r.roi !== null && r.roi !== undefined ? parseFloat(r.roi) : 0;
        const sportRoiQuick =
          sportEntry && sportEntry.roi != null && Number.isFinite(sportEntry.roi)
            ? (sportLaneTrustworthy(
                overallRoiQuick,
                sportEntry.roi,
                sportEntry.winRate ?? 0,
                sportEntry.tradeCount ?? 0,
              )
                ? sportEntry.roi
                : overallRoiQuick)
            : null;
        return res.json({
          source: "elite",
          wallet,
          username: r.polymarket_url?.split("@")[1] || null,
          qualityScore: r.quality_score ?? null,
          roi: r.roi !== null && r.roi !== undefined ? parseFloat(r.roi) : null,
          sportRoi: sportRoiQuick,
          winRate: r.win_rate !== null && r.win_rate !== undefined ? parseFloat(r.win_rate) : null,
          totalBets: r.total_bets !== null && r.total_bets !== undefined ? parseInt(r.total_bets) : null,
          sport: topSport,
          tags: r.tags ?? [],
          isElite: true,
          roiBySport,
        });
      }

      // 2. Fall back to live Polymarket activity fetch
      const actUrl = `https://data-api.polymarket.com/activity?user=${wallet}&limit=500&type=TRADE`;
      const actRes = await fetch(actUrl, { headers: { "Accept": "application/json" } });
      if (!actRes.ok) return res.status(502).json({ error: "Polymarket API error", status: actRes.status });
      const activity: any[] = await actRes.json();

      // Only look at BUY side (entries), filter to resolved markets for win/loss calc
      const buys = activity.filter((a: any) => a.side === "BUY" && a.type === "TRADE");
      const resolved = buys.filter((a: any) => a.resolved === true || a.pnl !== undefined);
      const wins = resolved.filter((a: any) => (a.pnl ?? 0) > 0);
      const totalVolume = buys.reduce((s: number, a: any) => s + (parseFloat(a.size) || 0), 0);
      const totalPnl = resolved.reduce((s: number, a: any) => s + (parseFloat(a.pnl) || 0), 0);
      const winRate = resolved.length > 0 ? Math.round(wins.length / resolved.length * 100) : null;
      const roi = totalVolume > 0 && resolved.length > 0 ? Math.round(totalPnl / totalVolume * 100) : null;

      // Detect sport tendencies from market titles
      const titles = buys.map((a: any) => (a.title || "").toLowerCase()).join(" ");
      const sportCounts: Record<string, number> = {};
      const sportKeywords: Record<string, string[]> = {
        NBA: ["nba", "lakers", "celtics", "warriors", "76ers", "heat", "bucks", "nuggets"],
        NFL: ["nfl", "super bowl", "chiefs", "eagles", "cowboys", "patriots", "49ers"],
        NHL: ["nhl", "stanley cup", "bruins", "leafs", "penguins", "oilers"],
        MLB: ["mlb", "world series", "yankees", "dodgers", "red sox", "astros"],
        Soccer: ["premier league", "mls", "champions league", "world cup", "bundesliga", "la liga"],
      };
      for (const [sport, kws] of Object.entries(sportKeywords)) {
        sportCounts[sport] = kws.filter(kw => titles.includes(kw)).length;
      }
      const topSport = Object.entries(sportCounts).sort(([, a], [, b]) => b - a)[0];
      const detectedSport = topSport && topSport[1] > 0 ? topSport[0] : null;

      res.json({
        source: "polymarket",
        wallet,
        username: null,
        qualityScore: null,
        roi,
        sportRoi: null,
        winRate,
        totalBets: buys.length,
        resolvedBets: resolved.length,
        totalVolume: Math.round(totalVolume),
        totalPnl: Math.round(totalPnl),
        sport: detectedSport,
        tags: detectedSport ? [detectedSport] : [],
        isElite: false,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/market/resolve/:conditionId ─────────────────────────────────────
  // Auto-grading endpoint: returns market resolution status for open bets.
  // IMPORTANT: Gamma API's condition_id query param maps to a different internal
  // field and returns wrong markets. The ONLY reliable lookup is by slug.
  // Pass ?slug=nba-bos-mia-2026-03-10 for correct resolution.
  app.get("/api/market/resolve/:conditionId", async (req, res) => {
    try {
      const condId = req.params.conditionId;
      const slug = (req.query.slug as string || "").trim().toLowerCase();
      if (!condId) return res.status(400).json({ error: "conditionId required" });

      function parseResolutionPrice(mkt: any): number | null {
        const raw = mkt.outcomePrices;
        if (!raw) return null;
        const arr = Array.isArray(raw) ? raw : (() => { try { return JSON.parse(raw); } catch { return null; } })();
        if (!arr || !arr.length) return null;
        return parseFloat(arr[0]);
      }

      function buildResult(mkt: any, condId: string, source: string) {
        const closed = mkt.closed === true || mkt.active === false;
        const resolutionPrice = parseResolutionPrice(mkt);
        if (resolutionPrice === null) return { conditionId: condId, resolved: false, outcome: null, finalPrice: null };

        // Formally closed — use standard threshold
        if (closed) {
          const outcome = resolutionPrice >= 0.99 ? "YES" : resolutionPrice <= 0.01 ? "NO" : null;
          return { conditionId: condId, resolved: !!outcome, outcome, finalPrice: resolutionPrice, source };
        }

        // Not formally closed yet — but price has fully settled at ≥0.999 or ≤0.001.
        // Polymarket admin hasn't closed the market yet but the event is definitively over.
        // Use 0.999 threshold (not 0.99) to be safer against live in-game price spikes.
        if (resolutionPrice >= 0.999 || resolutionPrice <= 0.001) {
          const outcome = resolutionPrice >= 0.999 ? "YES" : "NO";
          return { conditionId: condId, resolved: true, outcome, finalPrice: resolutionPrice, source: `${source}-price-settled` };
        }

        // Still genuinely open (price between 0 and 1) — not near resolution
        return { conditionId: condId, resolved: false, outcome: null, finalPrice: null, marketOpen: true };
      }

      // 1. Slug-based lookup (REQUIRED — conditionId query param returns wrong markets)
      if (slug) {
        const gmRes = await fetch(`${GAMMA_API}/markets?slug=${encodeURIComponent(slug)}&limit=1`);
        if (gmRes.ok) {
          const gmData = await gmRes.json();
          const mkt = Array.isArray(gmData) ? gmData[0] : gmData?.markets?.[0];
          if (mkt) {
            const result = buildResult(mkt, condId, "gamma-slug");
            return res.json(result);
          }
        }
      }

      // 2. Fallback: try Gamma API markets list filtered by the conditionId stored
      //    in the market's actual conditionId field (not the query param — use a scan)
      //    This is a last resort for bets without slugs.
      res.json({ conditionId: condId, resolved: false, outcome: null, finalPrice: null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/game-score?slug=nba-bos-mia-2026-03-10 ─────────────────────────
  // Returns live score, period, clock from ESPN for a given Polymarket slug
  app.get("/api/game-score", async (req, res) => {
    const slug = (req.query.slug as string || "").toLowerCase();
    if (!slug) return res.status(400).json({ error: "slug required" });
    try {
      const score = await fetchESPNGameScore(slug);
      if (!score) return res.status(404).json({ error: "Game not found", slug });
      res.json(score);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/price-history?conditionId=0x... ─────────────────────────────────
  // Returns price chart data for a market using recent trade prices.
  // Each point = { t: ms_timestamp, p: price 0-1 }
  // Sports markets (AMM-based) don't have CLOB order book data, so we build the
  // chart from actual trade prices which shows exactly when sharp money moved.
  app.get("/api/price-history", async (req, res) => {
    const conditionId = (req.query.conditionId as string || "");
    const tokenId     = (req.query.tokenId as string || "").toLowerCase();
    if (!conditionId && !tokenId) return res.status(400).json({ error: "conditionId or tokenId required" });

    const cKey = `trade-history-${conditionId || ""}-${tokenId || ""}`;
    const hit = getCache<{ t: number; p: number }[]>(cKey);
    if (hit) return res.json({ history: hit });

    try {
      // Fetch market-specific trades using the Polymarket data API's `market` filter.
      // `market=conditionId` returns only trades for that market (confirmed working).
      // Fall back to slug or token-based filtering when needed.
      let mTrades: any[] = [];
      if (conditionId) {
        const pages = await Promise.all([
          fetchWithRetry(`${DATA_API}/trades?market=${encodeURIComponent(conditionId)}&limit=1000`)
            .then(r => r.ok ? r.json() : []).then(d => Array.isArray(d) ? d : d.data || []).catch(() => []),
          fetchWithRetry(`${DATA_API}/trades?market=${encodeURIComponent(conditionId)}&limit=1000&offset=1000`)
            .then(r => r.ok ? r.json() : []).then(d => Array.isArray(d) ? d : d.data || []).catch(() => []),
        ]);
        mTrades = pages.flat();
      } else if (tokenId) {
        // Fallback: filter global pool by asset token ID
        const all = await fetchRecentTrades(10000);
        const needleTok = tokenId.toLowerCase();
        mTrades = all.filter(t => String(t.asset || "").toLowerCase() === needleTok);
      }

      // Sort ascending by time and build price series
      const sorted = mTrades
        .map(t => ({
          t: tradeTimestampMs(t),
          p: parseFloat(t.price || "0.5"),
          side: resolveSide(t.outcome, t.outcomeIndex),
        }))
        .filter(x => x.t > 0 && x.p > 0 && x.p < 1)
        .sort((a, b) => a.t - b.t);

      // Return YES prices (0-1 scale); if side is NO, invert the price
      // Downsample to max 200 points for chart performance
      const allHistory = sorted.map(x => ({
        t: x.t,
        p: x.side === "YES" ? x.p : (1 - x.p),
      }));
      const MAX_POINTS = 200;
      const history = allHistory.length > MAX_POINTS
        ? allHistory.filter((_, i) => i % Math.ceil(allHistory.length / MAX_POINTS) === 0)
        : allHistory;

      setCache(cKey, history, 60_000);
      res.json({ history });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Bets CRUD ─── Persist tracked bets to the database ──────────────────────
  // Create table on startup
  elitePool.query(`
    CREATE TABLE IF NOT EXISTS tracked_bets (
      id TEXT PRIMARY KEY,
      market_question TEXT NOT NULL,
      outcome_label TEXT,
      side TEXT NOT NULL,
      condition_id TEXT,
      slug TEXT,
      entry_price NUMERIC,
      bet_amount NUMERIC DEFAULT 0,
      bet_date BIGINT,
      status TEXT NOT NULL DEFAULT 'open',
      resolved_price NUMERIC,
      resolved_date BIGINT,
      pnl NUMERIC,
      notes TEXT,
      book TEXT,
      american_odds INTEGER,
      polymarket_price NUMERIC,
      sport TEXT,
      created_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::BIGINT
    )
  `).catch(e => console.error("[Bets] Table init error:", e?.message ?? e));

  app.get("/api/bets", async (_req, res) => {
    try {
      const { rows } = await elitePool.query(
        `SELECT * FROM tracked_bets ORDER BY created_at DESC`
      );
      const bets = rows.map(r => ({
        id: r.id,
        marketQuestion: r.market_question,
        outcomeLabel: r.outcome_label,
        side: r.side,
        conditionId: r.condition_id,
        slug: r.slug,
        entryPrice: r.entry_price ? parseFloat(r.entry_price) : 0,
        betAmount: r.bet_amount ? parseFloat(r.bet_amount) : 0,
        betDate: r.bet_date ? parseInt(r.bet_date) : 0,
        status: r.status,
        resolvedPrice: r.resolved_price ? parseFloat(r.resolved_price) : undefined,
        resolvedDate: r.resolved_date ? parseInt(r.resolved_date) : undefined,
        pnl: r.pnl ? parseFloat(r.pnl) : undefined,
        notes: r.notes,
        book: r.book,
        americanOdds: r.american_odds,
        polymarketPrice: r.polymarket_price ? parseFloat(r.polymarket_price) : undefined,
        sport: r.sport,
      }));
      res.json(bets);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/bets", async (req, res) => {
    try {
      const b = req.body;
      if (!b.id || !b.marketQuestion || !b.side) {
        return res.status(400).json({ error: "id, marketQuestion, side required" });
      }
      await elitePool.query(`
        INSERT INTO tracked_bets
          (id, market_question, outcome_label, side, condition_id, slug, entry_price,
           bet_amount, bet_date, status, notes, book, american_odds, polymarket_price, sport)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (id) DO NOTHING
      `, [
        b.id, b.marketQuestion, b.outcomeLabel ?? null, b.side,
        b.conditionId ?? null, b.slug ?? null, b.entryPrice ?? 0,
        b.betAmount ?? 0, b.betDate ?? Date.now(), b.status ?? "open",
        b.notes ?? null, b.book ?? null, b.americanOdds ?? null,
        b.polymarketPrice ?? null, b.sport ?? null,
      ]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/bets/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const b = req.body;
      await elitePool.query(`
        UPDATE tracked_bets SET
          status = COALESCE($1, status),
          resolved_price = COALESCE($2, resolved_price),
          resolved_date = COALESCE($3, resolved_date),
          pnl = COALESCE($4, pnl),
          notes = COALESCE($5, notes),
          bet_amount = COALESCE($6, bet_amount),
          book = COALESCE($7, book),
          american_odds = COALESCE($8, american_odds)
        WHERE id = $9
      `, [
        b.status ?? null, b.resolvedPrice ?? null, b.resolvedDate ?? null,
        b.pnl ?? null, b.notes ?? null, b.betAmount ?? null,
        b.book ?? null, b.americanOdds ?? null, id,
      ]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/bets/:id", async (req, res) => {
    try {
      await elitePool.query(`DELETE FROM tracked_bets WHERE id = $1`, [req.params.id]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return httpServer;
}
