import type { Express } from "express";
import { createServer, type Server } from "http";
import { Pool } from "pg";
import {
  seedCuratedTraders, startPeriodicRefresh, startCanonicalPNLRefresh, runAnalysisForTrader,
  resolveUsernameToWallet, generateTraderCSV, curatedWalletSet, curatedWalletToUsername,
  settleUnresolvedTrades, fetchFullTradeHistory, computeTraderProfile,
  settleAllUnresolvedTradesGlobal, fetchAllActivity, computeTraderProfileFromActivity,
  CURATED_TRADERS, KNOWN_ALIASES, MARKET_MAKER_WALLETS, TRADER_CATEGORY_FILTERS, classifySport, classifySportFull, patchProfileWithCanonicalPNL, fetchCanonicalPNL,
  runCanonicalPNLRefreshForAll, computeMarketOFI, syncTraderPositions
} from "./eliteAnalysis";

const elitePool = new Pool({ connectionString: process.env.DATABASE_URL });

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
const seenSignalIds = new Set<string>();

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
  // Definitive live signals from question text (e.g. in-play markets)
  if (/(lead|trailing|winning|losing|currently|live|in-game|halftime|first half|second half|quarter|overtime|period|inning)/.test(q)) return "live";

  const now = Date.now();

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
function computePriceStatus(currentPrice: number, avgEntry: number, side: "YES" | "NO"): "actionable" | "dip" | "moved" {
  if (currentPrice < 0.08 || currentPrice > 0.92) return "moved";
  const refPrice = Math.min(avgEntry, currentPrice);
  const maxDelta = refPrice < 0.30 || refPrice > 0.70 ? 0.02 : 0.03;
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

function computeIsActionable(currentPrice: number, avgEntry: number, side: "YES" | "NO"): boolean {
  const status = computePriceStatus(currentPrice, avgEntry, side);
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

  const base = roiPct + consPct + valuePct + sizePct + relSizePts;
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
    breakdown: { roiPct, consensusPct: consPct, valuePct, sizePct, relSizePts, tierBonus },
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
  roiBySport: Record<string, { roi: number; tradeCount: number; winRate: number; avgBet: number; medianBet?: number }>;
  roiByMarketType: Record<string, { roi: number; tradeCount: number; winRate: number; avgBet?: number; medianBet?: number }>;
  // Per sport×marketType deep table — key: "NBA|moneyline", "Soccer|total", etc.
  roiBySportMarketType: Record<string, { roi: number; tradeCount: number; winRate: number; avgBet: number; medianBet: number }>;
  // Per price bucket — key: "Flip (40-60c)", "Underdog (20-40c)", etc.
  priceStats: Record<string, { roi: number; winRate: number; events: number }>;
};

let _canonicalCache: Map<string, CanonicalEntry> | null = null;
let _canonicalCacheAt = 0; // set to 0 to force reload on first request

async function loadCanonicalMetricsFromDB(): Promise<Map<string, CanonicalEntry>> {
  if (_canonicalCache && Date.now() - _canonicalCacheAt < 10 * 60_000) return _canonicalCache;
  try {
    const { rows } = await elitePool.query(`
      SELECT wallet,
        quality_score,
        tags,
        COALESCE(NULLIF(metrics->>'csvDirectionalROI',''), metrics->>'overallROI')::float  AS overall_roi,
        (metrics->>'roiCapital')::float                                                    AS roi_capital,
        COALESCE(NULLIF(metrics->>'csvWinRate',''), metrics->>'winRate')::float            AS win_rate,
        (metrics->>'totalTrades')::int                  AS total_trades,
        metrics->'roiBySport'                           AS roi_by_sport,
        metrics->'roiByMarketType'                      AS roi_by_market_type,
        metrics->'roiBySportMarketType'                 AS roi_by_sport_market_type,
        metrics->'csvPriceStats'                        AS price_stats
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

async function fetchSportsMarkets(limit = 800): Promise<any[]> {
  const key = `sports-markets-${limit}`;
  const hit = getCache<any[]>(key);
  if (hit) return hit;
  const res = await fetchWithRetry(`${GAMMA_API}/markets?active=true&closed=false&limit=${limit}`);
  if (!res.ok) return [];
  const data = await res.json();
  const markets: any[] = Array.isArray(data) ? data : data.data || [];
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

// ─── Curated elite sports traders ────────────────────────────────────────────
// Derived directly from CURATED_TRADERS (the single source of truth for all 42
// hand-picked elite traders). Used for BOTH the main signals function AND the
// elite analytics system — so updating CURATED_TRADERS in eliteAnalysis.ts
// automatically propagates to both systems.
const CURATED_ELITES: Array<{ addr: string; name: string }> = CURATED_TRADERS
  .filter(t => t.wallet && t.wallet.length > 0 && !t.wallet.startsWith("pending-") && !MARKET_MAKER_WALLETS.has(t.wallet.toLowerCase()))
  .map(t => ({ addr: t.wallet, name: t.username }));

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
 * Fetch recent trades for a specific wallet (curated elite trader).
 * Returns trades in the same format as fetchRecentTrades so they can be merged.
 */
async function fetchEliteTraderTrades(wallet: string, limit = 100): Promise<any[]> {
  const key = `elite-trades-${wallet.toLowerCase()}`;
  const hit = getCache<any[]>(key);
  if (hit) return hit;
  try {
    const r = await fetchWithRetry(`${DATA_API}/trades?user=${wallet.toLowerCase()}&limit=${limit}`);
    if (!r.ok) return [];
    const d = await r.json();
    const trades: any[] = Array.isArray(d) ? d : d.data || [];
    setCache(key, trades, 3 * 60_000);
    return trades;
  } catch { return []; }
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
  question: string; slug?: string; endDate?: string;
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
    startCanonicalPNLRefresh(); // runs 30s after startup, then every 24h

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
      console.error("[Startup] Failed to start activity sync:", e.message);
    }
  }).catch((e: Error) => console.error("[Elite] Seed error:", e.message));

  // ── GET /api/elite/traders ─────────────────────────────────────────────────
  app.get("/api/elite/traders", async (_req, res) => {
    try {
      const { rows } = await elitePool.query(`
        SELECT t.wallet, t.username, t.added_at, t.last_analyzed_at, t.wallet_resolved,
               t.polymarket_url, t.notes,
               p.quality_score, p.tags, p.computed_at,
               p.metrics->>'totalTrades' as total_trades,
               COALESCE(NULLIF(p.metrics->>'csvDirectionalROI',''), p.metrics->>'overallROI') as overall_roi,
               p.metrics->>'roiCapital' as roi_capital,
               p.metrics->>'last90dROI' as last90d_roi,
               COALESCE(NULLIF(p.metrics->>'csvWinRate',''), p.metrics->>'winRate') as win_rate,
               COALESCE(NULLIF(p.metrics->>'csvPseudoSharpe',''), p.metrics->>'sharpeScore') as sharpe_score,
               COALESCE(NULLIF(p.metrics->>'csvAvgBetSize',''), p.metrics->>'avgBetSize') as avg_bet_size,
               p.metrics->>'tradesPerDay' as trades_per_day,
               COALESCE(NULLIF(p.metrics->>'csvTopSport',''), p.metrics->>'topSport') as top_sport,
               p.metrics->>'topMarketType' as top_market_type,
               p.metrics->>'consistencyRating' as consistency_rating,
               COALESCE(NULLIF(p.metrics->>'csvDirectionalPNL',''), p.metrics->>'overallPNL') as overall_pnl,
               p.metrics->>'totalUSDC' as total_usdc,
               p.metrics->>'csvTier' as csv_tier,
               p.metrics->>'csvQualityScore' as csv_quality_score,
               p.metrics->>'csvTailGuide' as csv_tail_guide
        FROM elite_traders t
        LEFT JOIN elite_trader_profiles p ON p.wallet = t.wallet
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
      // Real-time price stream for a specific conditionId — polls every 3s
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
        if (!closed) setTimeout(pushPrice, 3000);
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
        fetchRecentTrades(3000),
        fetchMultiWindowSportsLB(),
        elitePool.query(`SELECT wallet FROM elite_traders`).catch(() => ({ rows: [] as any[] })),
      ]);
      const curatedSet = new Set<string>((curatedRows.rows || []).map((r: any) => r.wallet.toLowerCase()));
      const lbMap = new Map<string, { name: string; pnl: number; isSportsLb: boolean }>();
      for (const t of allSportsLb) {
        const w = (t.proxyWallet || "").toLowerCase();
        if (!w || lbMap.has(w)) continue;
        lbMap.set(w, { name: t.userName || truncAddr(w), pnl: parseFloat(t.pnl || "0"), isSportsLb: true });
      }
      const alerts: any[] = [];
      const seen = new Set<string>();
      for (const trade of allTrades) {
        const wallet = (trade.proxyWallet || "").toLowerCase();
        if (MARKET_MAKER_WALLETS.has(wallet)) continue; // exclude spread/arb bots
        const isTracked = lbMap.has(wallet);
        const isCurated = curatedSet.has(wallet);
        const size = parseFloat(trade.size || trade.amount || "0");
        if (!isTracked && !isCurated && size < 5000) continue;
        if (size < 1000) continue; // minimum $1K plays only
        const title = trade.title || trade.market || "";
        if (!isSportsRelated(title) || !title) continue;
        const price = parseFloat(trade.price || "0.5");
        if (price < 0.10 || price > 0.90) continue; // filter extreme prices
        const key = `${trade.conditionId || "?"}-${wallet}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const trader = lbMap.get(wallet);
        const side = (trade.outcomeIndex === 0 || trade.outcome === "Yes") ? "YES" : "NO";
        const ts = trade.timestamp ? trade.timestamp * 1000 : (trade.createdAt ? new Date(trade.createdAt).getTime() : now);
        const condId = trade.conditionId || "";
        const dbEntry = sharedMarketDb.get(condId);
        // Skip postponed/inactive markets
        if (dbEntry && !dbEntry.active) continue;
        if (isPostponedOrCancelled(title, true, false)) continue;
        const mEndDate = trade.endDate || dbEntry?.endDate;
        alerts.push({
          id: `alert-${trade.id || key}`,
          trader: trader?.name || truncAddr(wallet),
          wallet, isTracked, isSportsLb: trader?.isSportsLb ?? false, isCurated,
          market: title.slice(0, 80), slug: trade.slug, conditionId: condId,
          side, size: Math.round(size), price: Math.round(price * 1000) / 1000,
          americanOdds: toAmericanOdds(price),
          gameStatus: categoriseMarket(title, mEndDate, dbEntry?.gameStartTime, trade.slug || dbEntry?.slug),
          endDate: mEndDate,
          timestamp: ts, minutesAgo: Math.round((now - ts) / 60_000),
          sharpAction: signalsByMarket.get(condId) ?? null,
        });
        if (alerts.length >= 40) break;
      }
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

        // Build the analysis metrics object to merge into the DB metrics JSONB
        const analysisMeta: Record<string, any> = {
          // Directional (bond-filtered) stats — the true edge
          csvDirectionalROI:    t.overall_roi,
          csvDirectionalPNL:    t.total_profit,
          csvTotalRisked:       t.total_risked,
          csvWinRate:           t.win_rate,
          csvAvgBetSize:        t.avg_bet_size,
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
        };

        // ── Build roiBySport (normalized keys matching classifySportFull output) ──
        // CRITICAL: this is what loadCanonicalMetricsFromDB queries — must be populated.
        // Python sport keys: "NBA", "SOCCER (EPL)", "SOCCER (UCL)", "TENNIS", "ESPORTS", etc.
        // Routes keys:       "NBA",     "Soccer",       "UCL",       "Tennis", "eSports", etc.
        const pythonToRoutesSport: Record<string, string> = {
          "NBA": "NBA", "NFL": "NFL", "NHL": "NHL", "MLB": "MLB",
          "TENNIS": "Tennis", "UFC/MMA": "UFC/MMA", "ESPORTS": "eSports",
          "POLITICS": "Politics", "OTHER": "Other",
          "SOCCER (EPL)": "Soccer", "SOCCER (LaLiga)": "Soccer",
          "SOCCER (SerieA)": "Soccer", "SOCCER (Other)": "Soccer",
          "SOCCER (UCL)": "UCL", "SOCCER (UEL)": "UEL",
        };
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
        const roiBySport: Record<string, any> = {};
        for (const [sport, agg] of Object.entries(roiBySportAgg)) {
          roiBySport[sport] = {
            roi:        Math.round(agg.roi * 10) / 10,
            tradeCount: agg.tradeCount,
            winRate:    Math.round(agg.winRate * 10) / 10,
            avgBet:     Math.round(agg.avgBet),
            medianBet:  Math.round(agg.medianBet),
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

        await elitePool.query(`
          UPDATE elite_trader_profiles
          SET
            quality_score = $2,
            tags          = $3,
            metrics       = COALESCE(metrics, '{}'::jsonb) || $4::jsonb,
            computed_at   = NOW()
          WHERE wallet = $1
        `, [wallet, newQuality, newTags, JSON.stringify(analysisMeta)]);

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

      // Clear cached trader lists so next page load reflects new scores
      delete cache["traders-curated-v2-sports"];
      delete cache["traders-curated-v2-all"];

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
      console.error("Traders error:", err.message);
      res.status(500).json({ error: err.message, traders: [], fetchedAt: Date.now(), window: "ALL", category: "sports" });
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

      // Sort by soonest ending first for upcoming, then by volume
      if (type === "upcoming" || type === "moneyline" || type === "spread" || type === "total") {
        markets.sort((a, b) => {
          const aEnd = a.endDate ? new Date(a.endDate).getTime() : Infinity;
          const bEnd = b.endDate ? new Date(b.endDate).getTime() : Infinity;
          if (aEnd === Infinity && bEnd === Infinity) return (b.volume || 0) - (a.volume || 0);
          return aEnd - bEnd;
        });
      } else {
        markets.sort((a, b) => (b.volume || 0) - (a.volume || 0));
      }

      res.json({ markets: markets.slice(0, limit), fetchedAt: Date.now(), total: markets.length });
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
      const cKey = "live-alerts-v2";
      const hit  = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      const now = Date.now();
      const [allTrades, allSportsLb, curatedRowsHttp] = await Promise.all([
        fetchRecentTrades(3000),
        fetchMultiWindowSportsLB(),
        elitePool.query(`SELECT wallet FROM elite_traders`).catch(() => ({ rows: [] as any[] })),
      ]);
      const curatedSetHttp = new Set<string>((curatedRowsHttp.rows || []).map((r: any) => r.wallet.toLowerCase()));

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

      for (const trade of allTrades) {
        const wallet = (trade.proxyWallet || "").toLowerCase();
        if (MARKET_MAKER_WALLETS.has(wallet)) continue; // exclude spread/arb bots
        const isTracked = lbMap.has(wallet);
        const isCuratedHttp = curatedSetHttp.has(wallet);
        const size = parseFloat(trade.size || trade.amount || "0");

        // Only tracked LB traders, curated elites, OR very large anonymous bets ($5K+)
        if (!isTracked && !isCuratedHttp && size < 5000) continue;
        if (size < 1000) continue; // minimum $1K plays

        const title = trade.title || trade.market || "";
        if (!isSportsRelated(title)) continue;
        if (!title) continue;

        const price = parseFloat(trade.price || "0.5");
        if (price < 0.10 || price > 0.90) continue; // skip extreme/junk prices

        const key = `${trade.conditionId || "?"}-${wallet}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const trader = lbMap.get(wallet);
        const side = (trade.outcomeIndex === 0 || trade.outcome === "Yes") ? "YES" : "NO";
        const ts    = trade.timestamp ? trade.timestamp * 1000 : (trade.createdAt ? new Date(trade.createdAt).getTime() : now);
        const alertCondId = trade.conditionId || "";
        const alertDbEntry = sharedMarketDb.get(alertCondId);
        // Skip postponed/inactive markets
        if (alertDbEntry && !alertDbEntry.active) continue;
        if (isPostponedOrCancelled(title, true, false)) continue;
        const alertEndDate = trade.endDate || alertDbEntry?.endDate;

        alerts.push({
          id: `alert-${trade.id || key}`,
          trader: trader?.name || truncAddr(wallet),
          wallet,
          isTracked,
          isSportsLb: trader?.isSportsLb ?? false,
          isCurated: isCuratedHttp,
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
          sharpAction: signalsByMarket.get(alertCondId) ?? null,
        });

        if (alerts.length >= 40) break;
      }

      // Sort by size (largest first), then by time (most recent)
      alerts.sort((a, b) => b.size - a.size);

      const result = { alerts: alerts.slice(0, 30), fetchedAt: now };
      setCache(cKey, result, 20_000); // 20s cache — keeps it near-live
      res.json(result);
    } catch (err: any) {
      console.error("Live alerts error:", err.message);
      res.status(500).json({ alerts: [], fetchedAt: Date.now(), error: err.message });
    }
  });

  // ── GET /api/signals ─── Elite signals v11: verified sports traders only ────
  app.get("/api/signals", async (req, res) => {
    try {
      const sportsOnly = req.query.sports !== "false";
      const cKey = `signals-elite-v26-${sportsOnly ? "sp" : "all"}`;
      const hit  = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      const now = Date.now();

      // ── Phase 1: Build verified trader quality map ───────────────────────────
      // CURATED-ONLY: Use only our 42 hand-picked elite traders as the signal source.
      // Fetch market database + recent trades for each curated trader in parallel.
      const [allSportsLb, [marketDb, canonicalMap, ...curatedTradeBatches]] = await Promise.all([
        fetchMultiWindowSportsLB().catch(() => [] as any[]),
        Promise.all([
          buildMarketDatabase(800),
          loadCanonicalMetricsFromDB(),
          ...CURATED_ELITES.map(e => fetchEliteTraderTrades(e.addr, 100)),
        ]),
      ]) as [any[], [Map<string, any>, Map<string, CanonicalEntry>, ...any[]]];

      // allTrades = merged trades from all curated elite traders (deduplicated)
      const allTrades: any[] = [];
      const seenTxHashes = new Set<string>();
      for (const batch of curatedTradeBatches) {
        for (const trade of (batch as any[])) {
          const txHash = trade.transactionHash;
          if (txHash && seenTxHashes.has(txHash)) continue;
          if (txHash) seenTxHashes.add(txHash);
          allTrades.push(trade);
        }
      }

      type TraderInfo = { name: string; pnl: number; roi: number; volume: number; qualityScore: number; isLeaderboard: boolean; isSportsLb: boolean; source: SharedTraderEntry["source"] };
      const lbMap = new Map<string, TraderInfo>();

      // ── Add curated elite traders to lbMap (quality from actual trade data) ──
      for (let ci = 0; ci < CURATED_ELITES.length; ci++) {
        const elite = CURATED_ELITES[ci];
        const addr = elite.addr.toLowerCase();
        const eliteTrades: any[] = (curatedTradeBatches[ci] as any[]) || [];
        // Compute quality purely from their real sports trading activity
        const sportsTrades = eliteTrades.filter((t: any) => isSportsRelated(t.title || t.slug || ""));
        const sportsVol = sportsTrades.reduce((s: number, t: any) => s + parseFloat(t.size || "0"), 0);
        const sportsCount = sportsTrades.length;
        const avgBet = sportsCount > 0 ? sportsVol / sportsCount : 0;
        // Three-factor score: volume (how much $), count (how active), avg bet (conviction)
        const volScore   = Math.min(sportsVol / 80_000, 1) * 45;
        const countScore = Math.min(sportsCount / 80, 1) * 30;
        const avgScore   = Math.min(avgBet / 1_500, 1) * 25;
        const qualityScore = Math.min(Math.round(volScore + countScore + avgScore), 90);
        lbMap.set(addr, {
          name: elite.name,
          pnl: sportsVol * 0.1,
          roi: 0,
          volume: sportsVol,
          qualityScore,
          isLeaderboard: true,
          isSportsLb: true,
          source: "curated",
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

      console.log(`[Elite v11] ${lbMap.size} tracked traders (${[...lbMap.values()].filter(t=>t.source==='sports_lb').length} sportsLB, ${[...lbMap.values()].filter(t=>t.source==='general_lb').length} generalLB, ${[...lbMap.values()].filter(t=>t.source==='curated').length} curated, ${[...lbMap.values()].filter(t=>t.source==='discovered').length} discovered) | ${allTrades.length} trades | ${marketDb.size} markets`);

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

        const outcomeIdx = trade.outcomeIndex ?? (trade.outcome === "Yes" ? 0 : 1);
        const side: "YES"|"NO" = outcomeIdx === 0 ? "YES" : "NO";
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

        const tradeTs = trade.timestamp ? trade.timestamp * 1000 : (trade.createdAt ? new Date(trade.createdAt).getTime() : now);
        const ex = mw.wallets.get(wallet);
        if (!ex) {
          mw.wallets.set(wallet, { side, totalSize: size, prices: [price], name: traderInfo.name, traderInfo, address: wallet, asset, lastTimestamp: tradeTs });
        } else {
          if (ex.side === side) { ex.totalSize += size; ex.prices.push(price); ex.lastTimestamp = Math.max(ex.lastTimestamp, tradeTs); }
          else if (size > ex.totalSize) { ex.side = side; ex.totalSize = size; ex.prices = [price]; ex.lastTimestamp = tradeTs; }
        }
      }

      console.log(`[Elite v11] ${marketWallets.size} markets with qualified trades`);

      // ── Phase 3: Generate signals with strict quality gates ──────────────────
      const signals: any[] = [];
      const SLIPPAGE = 0.02;
      const MIN_LIVE_PRICE  = 0.10;
      const MAX_LIVE_PRICE  = 0.90;
      const MIN_RESOLVED    = 0.02;  // below 2¢ or above 98¢ = market resolved / dead
      const MAX_RESOLVED    = 0.98;

      for (const [condId, mw] of marketWallets.entries()) {
        if (!mw.question || mw.question === condId) continue;

        const entries = Array.from(mw.wallets.values());
        if (entries.length === 0) continue;

        const yesE = entries.filter(e => e.side === "YES");
        const noE  = entries.filter(e => e.side === "NO");
        const dominant = yesE.length >= noE.length ? yesE : noE;
        const counterEntries = yesE.length >= noE.length ? noE : yesE;
        const side: "YES"|"NO" = yesE.length >= noE.length ? "YES" : "NO";
        if (dominant.length === 0) continue;

        const totalDominantSize = dominant.reduce((s, e) => s + e.totalSize, 0);
        const lbCount     = dominant.filter(e => e.traderInfo.isLeaderboard).length;
        const sportsLbCount = dominant.filter(e => (e.traderInfo as any).isSportsLb).length;

        // ── Stale market filter: skip near-certainty bets ─────────────────────
        // If all dominant trades have avg entry > 0.88, market is near resolution
        const avgEntryCheck = dominant.reduce((s, e) =>
          s + (e.prices.reduce((a, b) => a + b, 0) / e.prices.length), 0) / dominant.length;
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

        if (!hasVerifiedSports && !hasMultiTracked && !isBigWhaleBet && !hasStrongConsensus && !hasTrackedConsensus) continue;

        const consensusPct = entries.length > 1
          ? (dominant.length / entries.length) * 100 : 100;
        if (entries.length > 1 && consensusPct < 55) continue; // < 55% consensus = skip

        // ── Counter-trader count (computed BEFORE confidence so it can penalize consensus) ──
        const counterTraderCount = entries.length - dominant.length;

        // ── Detect sport for sport-specific canonical ROI ──────────────────────
        const signalSport = classifySport(mw.slug || "", mw.question || "");

        // Use canonical DB quality score for each trader (consistent with Elite page)
        const avgQuality = dominant.reduce((s, e) => {
          const cm = canonicalMap.get(e.address.toLowerCase());
          return s + ((cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : e.traderInfo.qualityScore);
        }, 0) / dominant.length;

        // Weighted avg entry price: weight each trader's avg price by their total position size
        const totalDominantWeight = dominant.reduce((s, e) => s + e.totalSize, 0) || 1;
        const avgEntry   = dominant.reduce((s, e) => s + (e.prices.reduce((a, b) => a + b, 0) / e.prices.length) * e.totalSize, 0) / totalDominantWeight;
        const avgSize    = totalDominantSize / dominant.length;

        // avgROI: use canonical OVERALL ROI (not sport-specific) for confidence scoring.
        // Sport-specific ROI from our DB only counts SETTLED/CLOSED trades and misses
        // open winning positions — so it can falsely penalize traders with large unrealized gains.
        // Canonical overall ROI (from closed-positions API) is the ground truth.
        const avgROI = dominant.reduce((s, e) => {
          const cm = canonicalMap.get(e.address.toLowerCase());
          return s + (cm?.overallROI ?? e.traderInfo.roi);
        }, 0) / dominant.length;

        // ── Live price via CLOB ────────────────────────────────────────────────
        let currentPrice = avgEntry;
        const liveTokenId = side === "YES" ? mw.yesTokenId : mw.noTokenId;
        if (liveTokenId) {
          const mid = await fetchMidpoint(liveTokenId);
          if (mid !== null) {
            currentPrice = mid;
          } else {
            // CLOB null = no active orders → market is resolved, cancelled, or fully illiquid.
            // Skip rather than showing a stale registry price as if it were tradeable.
            continue;
          }
        }

        // ── Pre-clamp: reject near-resolved markets (<2¢ or >98¢) ────────────
        if (currentPrice < MIN_RESOLVED || currentPrice > MAX_RESOLVED) continue;

        currentPrice = Math.min(0.99, Math.max(0.01, currentPrice));

        // ── Strict price range filter (0.10–0.90) ─────────────────────────────
        if (currentPrice < MIN_LIVE_PRICE || currentPrice > MAX_LIVE_PRICE) continue;

        // Both YES and NO use identical formula: currentPrice is already the token price
        // for the relevant side (YES token midpoint for YES, NO token midpoint for NO).
        // Positive = sharps got in at a higher price = you can enter cheaper = value edge.
        const valueDelta = avgEntry - currentPrice - SLIPPAGE;

        // Compute market category early — needed for sport×mktType median bet lookup
        const marketCategory = classifyMarketType(mw.question);
        // Detailed sport key (resolves UCL/UEL from slug, LoL/CS2 from question title)
        const signalSportDetailed = classifySportFull(signalSport, mw.question || "", mw.slug || "");
        const sportMktKey = `${signalSportDetailed}|${marketCategory}`;

        // ── Insider Stats (OddsJam-style "WHY THIS BET?" metrics) ─────────────
        // relBetSize: weighted avg of (this_bet / trader_median_in_sport+mktType)
        // Priority: sport×mktType median → sport median → sport avg → volume fallback
        // Individual ratio is capped at 20x to prevent arb/market-maker wallets
        // (with near-zero median bets in a given sport) from inflating the aggregate.
        const relBetSize = (() => {
          const w = dominant.reduce((s, e) => s + e.totalSize, 0) || 1;
          return Math.round(dominant.reduce((s, e) => {
            const cm = canonicalMap.get(e.address.toLowerCase());
            const smEntry = cm?.roiBySportMarketType?.[sportMktKey];
            const sEntry  = cm?.roiBySport?.[signalSportDetailed] ?? cm?.roiBySport?.[signalSport];
            const medianBet = (smEntry?.medianBet && smEntry.medianBet > 0) ? smEntry.medianBet
              : (sEntry?.medianBet && sEntry.medianBet > 0)                  ? sEntry.medianBet
              : (sEntry?.avgBet    && sEntry.avgBet    > 0)                  ? sEntry.avgBet
              : Math.max(e.traderInfo.volume / 100, 200); // raised fallback floor
            // Cap at 20x per trader — prevents arb wallets with tiny median bets from skewing
            const ratio = Math.min(e.totalSize / Math.max(medianBet, 1), 20);
            return s + ratio * (e.totalSize / w);
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

        // For futures markets the price-vs-entry delta is misleading: it reflects whether
        // the bet has moved in/against their favour since they opened months ago, which has
        // zero relevance for a new entrant today. Zero it out before scoring.
        const isFuturesMkt = marketCategory === "futures";
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
        const confidence = Math.max(5, Math.min(futuresCap, rawConf + priceRangeAdj));

        const tier = dominant.length >= 3 && avgQuality >= 45 ? "HIGH"
                   : dominant.length >= 2 ? "MED" : "SINGLE";

        const mInfo = marketDb.get(condId);
        const id    = `elite-${condId}-${side}`;
        const isNew = !seenSignalIds.has(id) && confidence >= 55;
        seenSignalIds.add(id);

        const isSports = isSportsRelated(mw.question);
        const mTypeRaw2 = categoriseMarket(mw.question, mw.endDate || mInfo?.endDate, mInfo?.gameStartTime, mw.slug || mInfo?.slug);
        // marketCategory already computed above for sport×mktType lookup — reuse here
        // Specific game markets (moneyline/spread/total) should be PREGAME, not FUTURES
        const mType = (mTypeRaw2 === "futures" && marketCategory !== "futures") ? "pregame" : mTypeRaw2;
        const priceStatus  = computePriceStatus(currentPrice, avgEntry, side);
        // Stale signal filter: if price is ANY worse for new buyers than where sharps entered, hide it.
        // Even a small move against entry means the value proposition has shifted — not actionable.
        if (priceStatus === "moved") continue;
        const isActionable = priceStatus === "actionable" || priceStatus === "dip";
        const bigPlayScore = computeBigPlayScore(totalDominantSize, dominant.length, relBetSize);
        const dominantSorted = [...dominant].sort((a, b) => b.totalSize - a.totalSize);
        // slippagePct: how much did the price move after the insiders bought (conviction indicator)
        const slippagePct = Math.round((side === "YES"
          ? (currentPrice - avgEntry) * 100
          : (avgEntry - currentPrice) * 100) * 10) / 10;
        // insiderSportsROI: sport-specific canonical ROI — uses detailed sport key (UCL, LoL, etc.)
        // with fallback to generic sport, then overall ROI.
        const insiderSportsROI = Math.round(
          dominant.reduce((s, e) => {
            const cm = canonicalMap.get(e.address.toLowerCase());
            const sportEntry = cm?.roiBySport?.[signalSportDetailed] ?? cm?.roiBySport?.[signalSport];
            const roi = (sportEntry && (sportEntry.tradeCount ?? 0) >= 10)
              ? sportEntry.roi
              : (cm?.overallROI ?? e.traderInfo.roi);
            return s + roi * e.totalSize;
          }, 0) / (totalDominantWeight || 1) * 10
        ) / 10;
        // insiderTrades: sport-specific closed position count from canonical API
        const insiderTrades = dominant.reduce((s, e) => {
          const cm = canonicalMap.get(e.address.toLowerCase());
          const sportCount = (cm?.roiBySport?.[signalSportDetailed] ?? cm?.roiBySport?.[signalSport])?.tradeCount ?? 0;
          return s + (sportCount > 0 ? sportCount : ((cm?.totalTrades ?? 0) > 0 ? cm!.totalTrades : Math.max(Math.round(e.traderInfo.volume / 500), 1)));
        }, 0);
        // insiderWinRate: canonical win rate weighted by bet size
        const insiderWinRate = Math.round(
          dominant.reduce((s, e) => {
            const cm = canonicalMap.get(e.address.toLowerCase());
            const wr = (cm?.roiBySport?.[signalSportDetailed] ?? cm?.roiBySport?.[signalSport])?.winRate ?? cm?.winRate ?? 0;
            return s + wr * e.totalSize;
          }, 0) / (totalDominantWeight || 1) * 10
        ) / 10;

        signals.push({
          id, marketId: condId,
          marketQuestion: mw.question,
          slug: mw.slug,
          endDate: mw.endDate || mInfo?.endDate,
          gameStartTime: mInfo?.gameStartTime,
          outcome: side, side,
          confidence, tier, marketType: mType, isSports,
          marketCategory,
          isActionable,
          priceStatus,
          priceRangeAdj,
          priceBucket,
          bigPlayScore,
          consensusPct: Math.round(consensusPct),
          valueDelta: Math.round(valueDelta * 1000) / 1000,
          currentPrice: Math.round(currentPrice * 1000) / 1000,
          avgEntryPrice: Math.round(avgEntry * 1000) / 1000,
          totalNetUsdc: Math.round(totalDominantSize),
          avgNetUsdc: Math.round(avgSize),
          totalRiskUsdc: Math.round(dominant.reduce((s, e) => { const p = e.prices.reduce((a,b)=>a+b,0)/e.prices.length; return s + e.totalSize * p; }, 0)),
          avgRiskUsdc: Math.round(dominant.reduce((s, e) => { const p = e.prices.reduce((a,b)=>a+b,0)/e.prices.length; return s + e.totalSize * p; }, 0) / Math.max(dominant.length, 1)),
          traderCount: dominant.length,
          lbTraderCount: lbCount,
          sportsLbCount,
          counterTraderCount,
          avgQuality: Math.round(avgQuality),
          scoreBreakdown: breakdown,
          relBetSize, slippagePct, insiderSportsROI, insiderTrades, insiderWinRate,
          traders: dominantSorted.slice(0, 8).map(e => {
            const cm = canonicalMap.get(e.address.toLowerCase());
            // Display CSV-based ROI when available (strips wash trades / bond-yield farming).
            // Falls back to canonicalMap overallROI (already COALESCE-preferring CSV data),
            // then to live leaderboard ROI as last resort.
            const displayROI = cm?.overallROI ?? e.traderInfo.roi;
            const displayQuality = (cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : e.traderInfo.qualityScore;
            const sportEntry = cm?.roiBySport?.[signalSportDetailed] ?? cm?.roiBySport?.[signalSport];
            const avgEP = e.prices.reduce((a,b)=>a+b,0)/e.prices.length;
            const smEntryT = cm?.roiBySportMarketType?.[sportMktKey];
            const sEntryT  = cm?.roiBySport?.[signalSportDetailed] ?? cm?.roiBySport?.[signalSport];
            const medianBetT = (smEntryT?.medianBet && smEntryT.medianBet > 0) ? smEntryT.medianBet
              : (sEntryT?.medianBet && sEntryT.medianBet > 0) ? sEntryT.medianBet
              : (sEntryT?.avgBet    && sEntryT.avgBet    > 0) ? sEntryT.avgBet
              : Math.max(e.traderInfo.volume / 100, 200);
            const traderRelSize = Math.round(Math.min(e.totalSize / Math.max(medianBetT, 1), 20) * 10) / 10;
            return {
              address: e.address,
              name: e.traderInfo.name,
              side: e.side,
              entryPrice: Math.round(avgEP * 1000) / 1000,
              size: Math.round(e.totalSize),
              netUsdc: Math.round(e.totalSize),
              riskUsdc: Math.round(e.totalSize * avgEP),
              roi: Math.round(displayROI * 10) / 10,
              qualityScore: displayQuality,
              pnl: Math.round(e.traderInfo.pnl),
              isLeaderboard: e.traderInfo.isLeaderboard,
              isSportsLb: (e.traderInfo as any).isSportsLb ?? false,
              tradeTime: (e as any).lastTimestamp || 0,
              winRate: cm?.winRate ?? 0,
              totalTrades: cm?.totalTrades ?? 0,
              sportRoi: sportEntry?.roi ?? null,
              sportTradeCount: sportEntry?.tradeCount ?? null,
              sportWinRate: sportEntry?.winRate ?? null,
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
              sportRoi: sportEntry?.roi ?? null,
              tradeTime: (e as any).lastTimestamp || 0,
            };
          }),
          category: isSports ? "sports" : "other",
          sport: signalSport,
          volume: 0,
          generatedAt: now,
          isValue: valueDelta > 0, isNew,
          futuresCap: isFuturesMkt ? futuresCap : undefined,
          source: "trades",
          outcomeLabel: computeOutcomeLabel(mw.question, side),
          yesTokenId: mw.yesTokenId,
          noTokenId: mw.noTokenId,
        });
      }

      // ── Phase 4: Positions-based signals from verified sports traders ──────────
      // CURATED-ONLY: Scan only our 42 hand-picked elite traders for open positions.
      const curatedWallets = CURATED_ELITES.map(e => e.addr.toLowerCase());
      const topSportsWallets = [...new Set(curatedWallets)];
      console.log(`[Positions] Scanning ${topSportsWallets.length} curated traders for open positions`);
      if (topSportsWallets.length > 0) {
        const positionBatches = await Promise.all(topSportsWallets.map(w => fetchTraderPositions(w)));
        // Map: conditionId+outcomeIndex → position aggregation
        type PosGroup = {
          conditionId: string; side: "YES"|"NO";
          question: string; slug?: string; endDate?: string;
          traders: { name: string; wallet: string; entryPrice: number; curPrice: number; currentValue: number; isSportsLb: boolean }[];
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
            const outcomeIdx = pos.outcomeIndex ?? (pos.outcome === "Yes" ? 0 : 1);
            const side: "YES"|"NO" = outcomeIdx === 0 ? "YES" : "NO";
            const mapKey = `${condId}-${side}`;
            // Asset IDs from position data (YES=asset, NO=oppositeAsset when outcomeIdx=0)
            const yesAssetFromPos = outcomeIdx === 0 ? String(pos.asset || "") : String(pos.oppositeAsset || "");
            const noAssetFromPos  = outcomeIdx === 0 ? String(pos.oppositeAsset || "") : String(pos.asset || "");

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
            pg.traders.push({
              name: traderName, wallet,
              entryPrice: parseFloat(pos.avgPrice || "0"),
              curPrice, currentValue: val,
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
        for (const pg of posMap.values()) {
          // Quality gate: need meaningful capital committed
          // 2+ traders with $1K+ total, OR single trader with $50K+
          if (pg.traders.length >= 2 && pg.totalValue < 1000) continue;
          if (pg.traders.length < 2 && pg.totalValue < 50000) continue;

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

          // Check price range strictly for game-day markets, loosely for futures
          const avgCurPrice = pg.traders.reduce((s, t) => s + t.curPrice, 0) / pg.traders.length;
          const isFutures = endMs - now > 14 * 24 * 3600_000; // more than 14 days out
          const minPrice = isFutures ? 0.05 : 0.10;
          if (avgCurPrice < minPrice || avgCurPrice > 0.95) continue;

          // Weighted avg entry price: weight each trader's entry by their current position value
          const totalPosWeight = pg.traders.reduce((s, t) => s + t.currentValue, 0) || 1;
          const avgEntry = pg.traders.reduce((s, t) => s + t.entryPrice * t.currentValue, 0) / totalPosWeight;
          const avgSize  = pg.totalValue / pg.traders.length;
          // Positive = sharps paid more than live = you enter cheaper = value edge.
          // avgEntry and avgCurPrice are both the same-side token price, so formula is symmetric.
          const valueDelta = avgEntry - avgCurPrice - 0.02;

          const consensusPct = 100; // all are on same side by construction
          // Counter-trader count (computed BEFORE confidence so it can penalize consensus)
          const oppositeKey = `${pg.conditionId}-${pg.side === "YES" ? "NO" : "YES"}`;
          const counterTraderCount = posMap.get(oppositeKey)?.traders.length ?? 0;

          // Detect sport for sport-specific canonical ROI
          const pgSport = classifySport(pg.slug || pgMarket?.slug || "", pg.question || "");

          // avgROI: use canonical OVERALL ROI (not sport-specific settled ROI).
          // Sport-specific ROI misses open winning positions — canonical overall is the ground truth.
          const avgROI = pg.traders.reduce((s, t) => {
            const cm = canonicalMap.get(t.wallet.toLowerCase());
            return s + (cm?.overallROI ?? lbMap.get(t.wallet)?.roi ?? 0);
          }, 0) / pg.traders.length;

          // Use canonical DB quality score (consistent with Elite page display)
          const avgQualityForScore = pg.traders.length > 0
            ? Math.round(pg.traders.reduce((s, t) => {
                const cm = canonicalMap.get(t.wallet.toLowerCase());
                return s + ((cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : (lbMap.get(t.wallet)?.qualityScore ?? 20));
              }, 0) / pg.traders.length)
            : 20;
          // Compute market category early for sport×mktType lookup
          const pgMarketCategory = classifyMarketType(pg.question);
          const pgSportDetailed = classifySportFull(pgSport, pg.question || "", pg.slug || pgMarket?.slug || "");
          const pgSportMktKey = `${pgSportDetailed}|${pgMarketCategory}`;

          // ── Insider Stats (OddsJam-style "WHY THIS BET?" metrics) ───────────
          // pgRelBetSize: sport×mktType specific median bet — the conviction multiplier
          const pgTotalWeight = pg.totalValue || 1;
          const pgRelBetSize = (() => {
            return Math.round(pg.traders.reduce((s, t) => {
              const cm = canonicalMap.get(t.wallet.toLowerCase());
              const smEntry = cm?.roiBySportMarketType?.[pgSportMktKey];
              const sEntry  = cm?.roiBySport?.[pgSportDetailed] ?? cm?.roiBySport?.[pgSport];
              const medianBet = (smEntry?.medianBet && smEntry.medianBet > 0) ? smEntry.medianBet
                : (sEntry?.medianBet && sEntry.medianBet > 0)                  ? sEntry.medianBet
                : (sEntry?.avgBet    && sEntry.avgBet    > 0)                  ? sEntry.avgBet
                : Math.max((lbMap.get(t.wallet)?.volume ?? 1000) / 100, 200);
              // Cap at 20x to prevent arb wallets with near-zero sport medians from skewing
              const ratio = Math.min(t.currentValue / Math.max(medianBet, 1), 20);
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
            for (const t of pg.traders) {
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
            avgROI, consensusPct, pgEffectiveValueDelta, avgSize, pg.traders.length, avgQualityForScore, counterTraderCount, pgRelBetSize
          );
          // Positions path: no timestamp → cap at 70 (unknown age, could be months old)
          const pgConfCap = pgIsFutures ? 70 : 100;
          const confidence = Math.max(5, Math.min(pgConfCap, pgRawConf + pgPriceRangeAdj));

          const mTypeRaw = categoriseMarket(pg.question, resolvedEndDate, resolvedGameStartTime, pg.slug || pgMarket?.slug);
          // pgMarketCategory already computed above
          // Specific game markets (moneyline/spread/total) should show as PREGAME, not FUTURES
          // even if the game is > 7 days away. FUTURES badge is reserved for season/championship bets.
          const mType = (mTypeRaw === "futures" && pgMarketCategory !== "futures") ? "pregame" : mTypeRaw;
          const priceStatus  = computePriceStatus(avgCurPrice, avgEntry, pg.side);
          // Stale signal filter: any "moved" status means price is worse for new buyers — hide it.
          if (priceStatus === "moved") continue;
          const isActionable = priceStatus === "actionable" || priceStatus === "dip";
          const bigPlayScore = computeBigPlayScore(pg.totalValue, pg.traders.length, pgRelBetSize);
          const id = `pos-${pg.conditionId}-${pg.side}`;
          const isNew = !seenSignalIds.has(id);
          seenSignalIds.add(id);
          const pgYesTokenId = pg.yesAsset || pgMarket?.tokenIds?.[0];
          const pgNoTokenId  = pg.noAsset  || pgMarket?.tokenIds?.[1];
          const tradersSorted = [...pg.traders].sort((a, b) => b.currentValue - a.currentValue);
          const pgSlippagePct = Math.round((pg.side === "YES"
            ? (avgCurPrice - avgEntry) * 100
            : (avgEntry - avgCurPrice) * 100) * 10) / 10;
          // insiderSportsROI: detailed sport key (UCL, LoL, etc.) with fallback to generic sport
          const pgInsiderSportsROI = Math.round(
            pg.traders.reduce((s, t) => {
              const cm = canonicalMap.get(t.wallet.toLowerCase());
              const sportEntry = cm?.roiBySport?.[pgSportDetailed] ?? cm?.roiBySport?.[pgSport];
              const roi = (sportEntry && sportEntry.tradeCount >= 10)
                ? sportEntry.roi
                : (cm?.overallROI ?? lbMap.get(t.wallet)?.roi ?? 0);
              return s + roi * t.currentValue;
            }, 0) / pgTotalWeight * 10
          ) / 10;
          // insiderTrades: canonical closed position count (actual trades completed)
          const pgInsiderTrades = pg.traders.reduce((s, t) => {
            const cm = canonicalMap.get(t.wallet.toLowerCase());
            const sportCount = (cm?.roiBySport?.[pgSportDetailed] ?? cm?.roiBySport?.[pgSport])?.tradeCount ?? 0;
            return s + (sportCount > 0 ? sportCount : ((cm?.totalTrades ?? 0) > 0 ? cm!.totalTrades : Math.max(Math.round((lbMap.get(t.wallet)?.volume ?? 500) / 500), 1)));
          }, 0);
          // insiderWinRate: canonical win rate weighted by bet size
          const pgInsiderWinRate = Math.round(
            pg.traders.reduce((s, t) => {
              const cm = canonicalMap.get(t.wallet.toLowerCase());
              const wr = (cm?.roiBySport?.[pgSportDetailed] ?? cm?.roiBySport?.[pgSport])?.winRate ?? cm?.winRate ?? 0;
              return s + wr * t.currentValue;
            }, 0) / pgTotalWeight * 10
          ) / 10;

          signals.push({
            id, marketId: pg.conditionId,
            marketQuestion: pg.question,
            slug: pg.slug || pgMarket?.slug,
            endDate: resolvedEndDate,
            gameStartTime: resolvedGameStartTime,
            outcome: pg.side, side: pg.side,
            confidence, tier: pg.traders.length >= 3 ? "HIGH" : "MED",
            marketType: mType, isSports: true,
            marketCategory: pgMarketCategory,
            isActionable,
            priceStatus,
            priceRangeAdj: pgPriceRangeAdj,
            priceBucket: pgPriceBucket,
            bigPlayScore,
            consensusPct: 100,
            valueDelta: Math.round(valueDelta * 1000) / 1000,
            currentPrice: Math.round(avgCurPrice * 1000) / 1000,
            avgEntryPrice: Math.round(avgEntry * 1000) / 1000,
            totalNetUsdc: Math.round(pg.totalValue),
            avgNetUsdc: Math.round(avgSize),
            totalRiskUsdc: Math.round(pg.traders.reduce((s, t) => s + t.currentValue * t.entryPrice, 0)),
            avgRiskUsdc: Math.round(pg.traders.reduce((s, t) => s + t.currentValue * t.entryPrice, 0) / Math.max(pg.traders.length, 1)),
            traderCount: pg.traders.length,
            lbTraderCount: pg.traders.filter(t => lbMap.get(t.wallet)?.isLeaderboard).length,
            sportsLbCount: pg.traders.filter(t => t.isSportsLb).length,
            counterTraderCount,
            avgQuality: pg.traders.length > 0
              ? Math.round(pg.traders.reduce((s, t) => s + (lbMap.get(t.wallet)?.qualityScore ?? 20), 0) / pg.traders.length)
              : 20,
            scoreBreakdown: breakdown,
            relBetSize: pgRelBetSize, slippagePct: pgSlippagePct,
            insiderSportsROI: pgInsiderSportsROI, insiderTrades: pgInsiderTrades, insiderWinRate: pgInsiderWinRate,
            traders: tradersSorted.slice(0, 8).map(t => {
              const tm = lbMap.get(t.wallet);
              const cm = canonicalMap.get(t.wallet.toLowerCase());
              // Display canonical overall ROI for consistency with Elite page
              const displayROI = cm?.overallROI ?? tm?.roi ?? 0;
              const displayQuality = (cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : (tm?.qualityScore ?? 20);
              const sportEntry = cm?.roiBySport?.[pgSport];
              const smEntryPg = cm?.roiBySportMarketType?.[pgSportMktKey];
              const sEntryPg  = cm?.roiBySport?.[pgSportDetailed] ?? cm?.roiBySport?.[pgSport];
              const medianBetPg = (smEntryPg?.medianBet && smEntryPg.medianBet > 0) ? smEntryPg.medianBet
                : (sEntryPg?.medianBet && sEntryPg.medianBet > 0) ? sEntryPg.medianBet
                : (sEntryPg?.avgBet    && sEntryPg.avgBet    > 0) ? sEntryPg.avgBet
                : Math.max((lbMap.get(t.wallet)?.volume ?? 1000) / 100, 200);
              const traderRelSize = Math.round(Math.min(t.currentValue / Math.max(medianBetPg, 1), 20) * 10) / 10;
              return {
                address: t.wallet,
                name: t.name,
                entryPrice: Math.round(t.entryPrice * 1000) / 1000,
                size: Math.round(t.currentValue),
                netUsdc: Math.round(t.currentValue),
                riskUsdc: Math.round(t.currentValue * t.entryPrice),
                roi: Math.round(displayROI * 10) / 10,
                qualityScore: displayQuality,
                pnl: tm?.pnl ?? 0,
                isLeaderboard: tm?.isLeaderboard ?? false,
                isSportsLb: t.isSportsLb,
                winRate: cm?.winRate ?? 0,
                totalTrades: cm?.totalTrades ?? 0,
                sportRoi: sportEntry?.roi ?? null,
                sportTradeCount: sportEntry?.tradeCount ?? null,
                sportWinRate: sportEntry?.winRate ?? null,
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
                  netUsdc: Math.round(t.currentValue),
                  qualityScore: (cm?.qualityScore ?? 0) > 0 ? cm!.qualityScore : (lbMap.get(t.wallet)?.qualityScore ?? 20),
                  isSportsLb: t.isSportsLb,
                  sportRoi: sportEntry?.roi ?? null,
                  tradeTime: 0,
                };
              });
            })(),
            category: "sports",
            sport: pgSport,
            volume: 0,
            generatedAt: now,
            isValue: valueDelta > 0,
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
      // Post-process every signal to detect curated elite traders on either side
      if (curatedWalletSet.size > 0) {
        // Build a market → { YES: elites[], NO: elites[] } index
        const mktEliteMap = new Map<string, { yes: {wallet:string;username:string}[]; no: {wallet:string;username:string}[] }>();
        for (const sig of signals) {
          const mid = sig.marketId;
          if (!mktEliteMap.has(mid)) mktEliteMap.set(mid, { yes: [], no: [] });
          const bucket = mktEliteMap.get(mid)!;
          const sigSportFull = classifySportFull(sig.sport || "", sig.marketQuestion || "", (sig as any).slug || "");
          for (const t of (sig.traders || [])) {
            const w = (t.address || "").toLowerCase();
            if (!curatedWalletSet.has(w)) continue;
            // Skip this trader's vote if the signal's sport or market type is filtered
            const catFilter = TRADER_CATEGORY_FILTERS[w];
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
            const username = curatedWalletToUsername.get(w) || t.name || w.slice(0, 8);
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
            (sig as any).hasCuratedElite = sideElites.length > 0;
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

      // ── Cluster detection: tracked non-curated sports-LB traders ───────────
      // When 2+ tracked (but not curated) traders co-invest same direction
      // within 60 min with combined size ≥ $5K → boost or create a signal.
      {
        const curatedAddrs = new Set(CURATED_ELITES.map(e => e.addr.toLowerCase()));
        const sixtyMinAgo = now - 60 * 60_000;
        type ClusterEntry = { wallet:string; name:string; size:number; price:number; ts:number; title:string; slug:string; roi:number; isSportsLb:boolean };
        const clusterMap = new Map<string, ClusterEntry[]>();

        for (const trade of allTrades) {
          const wallet = (trade.proxyWallet || "").toLowerCase();
          if (!lbMap.has(wallet)) continue;
          if (curatedAddrs.has(wallet)) continue;
          const ts = (trade.timestamp || 0) * 1000;
          if (ts < sixtyMinAgo) continue;
          const size = parseFloat(trade.size || trade.amount || "0");
          if (size < 500) continue;
          const title = trade.title || trade.market || "";
          if (!isSportsRelated(title)) continue;
          const price = parseFloat(trade.price || "0.5");
          if (price < 0.05 || price > 0.95) continue;
          const condId = trade.conditionId || "";
          if (!condId) continue;
          const outcomeIdx = trade.outcomeIndex ?? (trade.outcome === "Yes" ? 0 : 1);
          const side = outcomeIdx === 0 ? "YES" : "NO";
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
          const totalSize = unique.reduce((s, t) => s + t.size, 0);
          if (totalSize < 5000) continue;

          // Check for an existing curated signal for this conditionId + side
          const existingIdx = signals.findIndex(s => s.marketId === condId && s.side === side);
          if (existingIdx >= 0) {
            const boost = Math.min(12, unique.length * 5);
            signals[existingIdx].confidence = Math.min(100, signals[existingIdx].confidence + boost);
            (signals[existingIdx] as any).clusterBoost = { traders: unique.length, combinedSize: Math.round(totalSize) };
            continue;
          }

          // No curated signal exists → create a standalone cluster signal
          const rep = unique.sort((a, b) => b.ts - a.ts)[0];
          const dbEntry = sharedMarketDb.get(condId);
          if (dbEntry && !dbEntry.active) continue;
          if (isPostponedOrCancelled(rep.title, true, false)) continue;

          const avgPrice = unique.reduce((s, t) => s + t.price * t.size, 0) / totalSize;
          const avgRoi = unique.reduce((s, t) => s + t.roi, 0) / unique.length;
          const mType = categoriseMarket(rep.title, dbEntry?.endDate, dbEntry?.gameStartTime, rep.slug);
          const sport = classifySport(rep.slug, rep.title);
          const mCategory = classifyMarketType(rep.title);

          const roiPct = Math.min(20, Math.floor(avgRoi / 5));
          const sizePct = Math.min(15, Math.floor(totalSize / 2000));
          const countBonus = Math.min(10, (unique.length - 1) * 5);
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
            tier: unique.length >= 3 ? "HIGH" : "MED",
            marketType: mType,
            isSports: true,
            marketCategory: mCategory,
            isActionable: true,
            priceStatus: "cluster",
            bigPlayScore: computeBigPlayScore(totalSize, unique.length),
            consensusPct: 100,
            valueDelta: 0,
            currentPrice: avgPrice,
            avgEntryPrice: avgPrice,
            totalNetUsdc: Math.round(totalSize),
            avgNetUsdc: Math.round(totalSize / unique.length),
            totalRiskUsdc: Math.round(totalSize * avgPrice),
            avgRiskUsdc: Math.round(totalSize * avgPrice / unique.length),
            traderCount: unique.length,
            lbTraderCount: unique.length,
            sportsLbCount: unique.filter(t => t.isSportsLb).length,
            counterTraderCount: 0,
            avgQuality: Math.min(90, 50 + avgRoi * 2),
            scoreBreakdown: { roiPct, consensusPct: countBonus, valuePct: 0, sizePct, tierBonus: 0 },
            relBetSize: totalSize / 2000,
            slippagePct: 0,
            insiderSportsROI: avgRoi,
            insiderTrades: 0,
            insiderWinRate: 0,
            traders: unique.map(t => ({
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

      signals.sort((a, b) => b.confidence - a.confidence);
      console.log(`[Elite v16] ${signals.length} signals total (trades + positions)`);

      // ── Populate signal-per-market registry for /api/markets sharp overlay ────
      signalsByMarket.clear();
      for (const s of signals) {
        const existing = signalsByMarket.get(s.marketId);
        if (!existing || s.confidence > existing.confidence) {
          signalsByMarket.set(s.marketId, {
            side: s.side as "YES" | "NO",
            confidence: s.confidence,
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
        signals,
        topTraderCount: canonicalMap.size || CURATED_ELITES.length,
        marketsScanned: marketDb.size,
        newSignalCount: signals.filter(s => s.isNew).length,
        fetchedAt: now,
        source: "verified_sports_v11",
      };
      setCache(cKey, response, 2 * 60 * 1000);

      // ── SSE push: broadcast new high-confidence signals to connected clients ──
      {
        const newHighConf = signals.filter(s => s.isNew && s.confidence >= 80 && s.isActionable);
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
      console.error("Signals error:", err.message);
      res.status(500).json({
        error: err.message, signals: [], topTraderCount: 0,
        marketsScanned: 0, fetchedAt: Date.now(),
      });
    }
  });

  // ── GET /api/signals/fast ─── Live feed: stricter quality gates ──────────────
  app.get("/api/signals/fast", async (req, res) => {
    try {
      const cKey = "signals-fast-v7";
      const hit  = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      const now = Date.now();
      const [allTrades, marketDb] = await Promise.all([
        fetchRecentTrades(4000),
        buildMarketDatabase(800).catch(() => new Map() as any),
      ]);

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

        const side: "YES"|"NO" = (trade.outcome === "Yes" || trade.outcomeIndex === 0) ? "YES" : "NO";
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
        const ex = mw.wallets.get(wallet);
        const name = displayName(trade.name || trade.pseudonym || "", wallet);
        if (!ex) {
          mw.wallets.set(wallet, { side, totalSize: size, prices: [price], name, wallet });
        } else {
          if (ex.side === side) { ex.totalSize += size; ex.prices.push(price); }
          else if (size > ex.totalSize) { ex.side = side; ex.totalSize = size; ex.prices = [price]; }
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

        const totalDominantSize = dominant.reduce((s, e) => s + e.totalSize, 0);
        if (totalDominantSize < 500) continue; // minimum $500 aggregate position

        // Skip near-resolution bets (avg entry > 0.88 = betting on near-certainties)
        const avgEntryCheck2 = dominant.reduce((s, e) =>
          s + (e.prices.reduce((a, b) => a + b, 0) / e.prices.length), 0) / dominant.length;
        if (avgEntryCheck2 > 0.88) continue;

        const consensusPct = (dominant.length / entries.length) * 100;
        if (consensusPct < 55) continue;

        const avgEntry = dominant.reduce((s, e) => s + (e.prices.reduce((a, b) => a + b, 0) / e.prices.length), 0) / dominant.length;
        const avgSize  = totalDominantSize / dominant.length;

        // Fetch live price
        const info = mw.info;
        let currentPrice = avgEntry;
        if (info.tokenIds?.length > 0) {
          const tokenId = info.tokenIds[side === "YES" ? 0 : 1] || info.tokenIds[0];
          const mid = await fetchMidpoint(tokenId);
          if (mid !== null) {
            currentPrice = mid;
          } else {
            // CLOB null = no active orders → resolved, cancelled, or fully illiquid.
            // Skip rather than using a stale registry price.
            continue;
          }
        }

        // Reject near-resolved markets (<2¢ or >98¢)
        if (currentPrice < 0.02 || currentPrice > 0.98) continue;

        currentPrice = Math.min(0.99, Math.max(0.01, currentPrice));

        // Enforce price range 0.10–0.90
        if (currentPrice < 0.10 || currentPrice > 0.90) continue;

        // Positive = sharps paid more than live = you enter cheaper = value edge.
        // currentPrice is already the correct-side token midpoint.
        const valueDelta = avgEntry - currentPrice - SLIPPAGE;

        const { score: confidence, breakdown } = computeConfidence(
          15, consensusPct, valueDelta, avgSize, dominant.length, 40
        );

        const tier = dominant.length >= 3 ? "HIGH" : "MED";
        const marketTypeRaw = categoriseMarket(info.question || condId, info.endDate, info.gameStartTime, info.slug);
        const marketCategory = classifyMarketType(info.question || condId);
        // Specific game markets should be PREGAME, not FUTURES regardless of time horizon
        const marketType = (marketTypeRaw === "futures" && marketCategory !== "futures") ? "pregame" : marketTypeRaw;
        const isActionable = computeIsActionable(currentPrice, avgEntry, side);
        const bigPlayScore = computeBigPlayScore(totalDominantSize, dominant.length);

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
          totalRiskUsdc: Math.round(dominant.reduce((s, e) => { const p = e.prices.reduce((a,b)=>a+b,0)/e.prices.length; return s + e.totalSize * p; }, 0)),
          avgRiskUsdc: Math.round(dominant.reduce((s, e) => { const p = e.prices.reduce((a,b)=>a+b,0)/e.prices.length; return s + e.totalSize * p; }, 0) / Math.max(dominant.length, 1)),
          traderCount: dominant.length,
          avgQuality: 40,
          scoreBreakdown: breakdown,
          traders: dominant.slice(0, 8).map(e => {
            const avgEP2 = e.prices.reduce((a, b) => a + b, 0) / e.prices.length;
            return {
              address: e.wallet,
              name: e.name,
              entryPrice: Math.round(avgEP2 * 1000) / 1000,
              size: Math.round(e.totalSize),
              netUsdc: Math.round(e.totalSize),
              riskUsdc: Math.round(e.totalSize * avgEP2),
              roi: 0, qualityScore: 0,
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

      signals.sort((a, b) => b.confidence - a.confidence);

      const response = {
        signals,
        topTraderCount: curatedSetHttp.size || CURATED_ELITES.length,
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
          side: (mInfo?.outcomeIndex === 0 ? "YES" : "NO") as "YES"|"NO",
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
         LEFT JOIN elite_trader_profiles etp ON et.wallet = etp.wallet
         WHERE et.wallet = $1`,
        [wallet]
      );
      if (eliteRow.rows[0]) {
        const r = eliteRow.rows[0];
        const roiBySport: Record<string, any> = r.roi_by_sport ?? {};
        const topSport: string | null = r.top_sport ?? null;
        const sportEntry = topSport ? roiBySport[topSport] : null;
        return res.json({
          source: "elite",
          wallet,
          username: r.polymarket_url?.split("@")[1] || null,
          qualityScore: r.quality_score ?? null,
          roi: r.roi !== null && r.roi !== undefined ? parseFloat(r.roi) : null,
          sportRoi: sportEntry?.roi ?? null,
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
          t: t.timestamp ? t.timestamp * 1000 : new Date(t.createdAt || 0).getTime(),
          p: parseFloat(t.price || "0.5"),
          side: (t.outcomeIndex ?? (t.outcome === "Yes" ? 0 : 1)) === 0 ? "YES" : "NO",
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
  `).catch(e => console.error("[Bets] Table init error:", e.message));

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
