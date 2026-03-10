import type { Express } from "express";
import { createServer, type Server } from "http";

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
];
function isSportsRelated(text: string): boolean {
  const t = (text || "").toLowerCase();
  return SPORTS_KW.some(k => t.includes(k));
}

// ─── Categorise as Pregame / Live / Futures ───────────────────────────────────
/**
 * Categorise a market as live / pregame / futures.
 * Uses Polymarket's own `gameStartTime` when available — this is the most accurate method.
 * Falls back to simple endDate heuristics only when gameStartTime is unknown.
 */
function categoriseMarket(question: string, endDate?: string, gameStartTime?: string): "live" | "pregame" | "futures" {
  const q = (question || "").toLowerCase();
  // Definitive live signals from question text (e.g. in-play markets)
  if (/(lead|trailing|winning|losing|currently|live|in-game|halftime|first half|second half|quarter|overtime|period|inning)/.test(q)) return "live";
  if (!endDate) return "pregame";
  const now = Date.now();
  const endMs = new Date(endDate).getTime();
  const ms = endMs - now;

  // Market has already ended → pregame (resolved/expired, not live)
  if (ms < 0) return "pregame";
  // Far future → futures
  if (ms > 7 * 24 * 3600_000) return "futures";

  // ── Best path: Polymarket's actual game start time ─────────────────────────
  // gameStartTime = when the game actually tips off / kicks off.
  // If now < gameStartTime: hasn't started yet = PREGAME
  // If now >= gameStartTime (and market not ended): in progress = LIVE
  if (gameStartTime) {
    const startMs = new Date(gameStartTime).getTime();
    if (now < startMs) return "pregame";
    return "live"; // started but not yet resolved
  }

  // ── Fallback: no gameStartTime available ───────────────────────────────────
  // Default to pregame — never falsely mark a market as LIVE without evidence
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
function computeIsActionable(currentPrice: number, avgEntry: number, side: "YES" | "NO"): boolean {
  if (currentPrice < 0.08 || currentPrice > 0.92) return false; // out of actionable range
  const refPrice = Math.min(avgEntry, currentPrice); // use lower as reference
  const maxDelta = refPrice < 0.30 || refPrice > 0.70 ? 0.02 : 0.03;
  const priceDiff = Math.abs(currentPrice - avgEntry);
  // Price moved against you (more expensive than what sharps paid for YES) = too late
  if (side === "YES" && currentPrice > avgEntry + maxDelta) return false;
  if (side === "NO"  && currentPrice < avgEntry - maxDelta) return false;
  return priceDiff <= maxDelta;
}

/** Score for "big play": how large is this bet */
function computeBigPlayScore(totalUsdc: number, traderCount: number): number {
  const avg = totalUsdc / Math.max(traderCount, 1);
  if (totalUsdc >= 30_000 || avg >= 15_000) return 3; // huge
  if (totalUsdc >= 10_000 || avg >= 5_000)  return 2; // big
  if (totalUsdc >= 3_000  || avg >= 1_500)  return 1; // notable
  return 0;
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
 */
function computeConfidence(
  avgROI: number,
  consensusPct: number,
  valueDelta: number,
  avgNetUsdc: number,
  traderCount: number,
  avgQuality: number,
): { score: number; breakdown: Record<string, number> } {
  const roiPct      = Math.round(Math.min(Math.max(avgROI / 60, 0), 1) * 100 * 0.40);
  const consPct     = Math.round(Math.min(Math.max(consensusPct - 50, 0) / 50, 1) * 100 * 0.30);
  const valuePct    = valueDelta > 0 ? Math.round(Math.min(valueDelta * 600, 1) * 100 * 0.20) : 0;
  const sizePct     = Math.round(Math.min(avgNetUsdc / 15_000, 1) * 100 * 0.10);

  // Tier bonus: more qualified traders = higher ceiling
  const tierBonus   = traderCount >= 3 && avgQuality >= 50 ? 8
                    : traderCount >= 2 ? 4
                    : avgQuality >= 75 ? 3
                    : 0;

  const base = roiPct + consPct + valuePct + sizePct;
  // Single-trader signals: cap at 62 regardless of formula
  const score = traderCount === 1 ? Math.min(base + tierBonus, 62) : Math.min(base + tierBonus, 95);

  return {
    score: Math.max(score, 5),
    breakdown: { roiPct, consensusPct: consPct, valuePct, sizePct, tierBonus },
  };
}

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function fetchOfficialLeaderboard(timePeriod = "ALL", limit = 100, category = ""): Promise<any[]> {
  const key = `lb-${timePeriod}-${limit}-${category}`;
  const hit = getCache<any[]>(key);
  if (hit) return hit;
  const catParam = category ? `&category=${encodeURIComponent(category)}` : "";
  const res = await fetchWithRetry(
    `${DATA_API}/v1/leaderboard?window=${timePeriod.toLowerCase()}&limit=${limit}${catParam}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  const traders: any[] = Array.isArray(data) ? data : data.data || [];
  setCache(key, traders, 10 * 60 * 1000);
  return traders;
}

/** Combine ALL + WEEK + MONTH sports leaderboards, deduplicated by proxyWallet */
async function fetchMultiWindowSportsLB(): Promise<any[]> {
  const key = "lb-multi-sports";
  const hit = getCache<any[]>(key);
  if (hit) return hit;
  const [allW, weekW, monthW] = await Promise.all([
    fetchOfficialLeaderboard("ALL",   200, "sports"), // was 50 — more all-time winners
    fetchOfficialLeaderboard("WEEK",  100, "sports"), // was 50 — current hot hands
    fetchOfficialLeaderboard("MONTH", 100, "sports"), // was 50 — recent form
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
// Known high-calibre sports traders who may not appear in the official
// Polymarket sports leaderboard due to API caps or category differences.
// Quality scores computed DYNAMICALLY from actual trade history — no hardcoded values.
// Only add wallets verified on Polymarket. No fake/placeholder entries.
const CURATED_ELITES: Array<{ addr: string; name: string }> = [
  { addr: "0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee", name: "kch123" },
];

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
    const r = await fetchWithRetry(`${DATA_API}/positions?user=${wallet}&limit=500`);
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
  // "Tournament: Player1 vs. Player2" — colon before vs (tennis, soccer, etc.)
  const tourneyVs = t.match(/^.+?:\s*(.+?)\s+vs\.?\s+(.+)$/i);
  if (tourneyVs) {
    const p1 = tourneyVs[1].trim();
    const p2 = tourneyVs[2].trim().replace(/\?$/, "");
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
    const res = await fetchWithRetry(url, 2, 6000);
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


// ─── Route registration ───────────────────────────────────────────────────────
export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

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
      const [allTrades, allSportsLb] = await Promise.all([
        fetchRecentTrades(3000),
        fetchMultiWindowSportsLB(),
      ]);
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
        const isTracked = lbMap.has(wallet);
        const size = parseFloat(trade.size || trade.amount || "0");
        if (!isTracked && size < 5000) continue;
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
        const dbEntry = marketDb.get(condId);
        const mEndDate = trade.endDate || dbEntry?.endDate;
        alerts.push({
          id: `alert-${trade.id || key}`,
          trader: trader?.name || truncAddr(wallet),
          wallet, isTracked, isSportsLb: trader?.isSportsLb ?? false,
          market: title.slice(0, 80), slug: trade.slug, conditionId: condId,
          side, size: Math.round(size), price: Math.round(price * 1000) / 1000,
          americanOdds: toAmericanOdds(price),
          gameStatus: categoriseMarket(title, mEndDate, dbEntry?.gameStartTime),
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

  // ── GET /api/traders ────────────────────────────────────────────────────────
  app.get("/api/traders", async (req, res) => {
    try {
      const category = (req.query.category as string) || "sports";
      const limit    = Math.min(parseInt((req.query.limit as string) || "150"), 500);
      const cKey     = `traders-v6-${category}-${limit}`;
      const hit      = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      // ── Step 1: Fetch the primary leaderboard for this category ──────────────
      let raw: any[];
      if (category === "sports") {
        raw = await fetchMultiWindowSportsLB();
      } else {
        const [allW, weekW] = await Promise.all([
          fetchOfficialLeaderboard("ALL",  100, category === "all" ? "" : category),
          fetchOfficialLeaderboard("WEEK", 50,  "sports"),
        ]);
        const seen = new Set<string>();
        raw = [];
        for (const t of [...allW, ...weekW]) {
          const w = (t.proxyWallet || "").toLowerCase();
          if (!w || seen.has(w)) continue;
          seen.add(w); raw.push(t);
        }
      }

      // ── Step 2: Build verified trader set from the leaderboard ───────────────
      const seenAddrs = new Set<string>();
      const traders: any[] = [];

      const addLbTrader = (t: any, idx: number) => {
        const addr = (t.proxyWallet || "").toLowerCase();
        if (!addr || seenAddrs.has(addr)) return;
        const pnl = parseFloat(t.pnl || "0");
        const vol = parseFloat(t.vol || "0");
        if (vol > 500_000 && pnl / vol < 0.025) return; // skip arb bots
        if (pnl < 500) return; // skip low-PNL
        seenAddrs.add(addr);
        const roi = vol > 0 ? (pnl / vol) * 100 : 0;
        const windows = t._windows as { inAll?: boolean; inWeek?: boolean; inMonth?: boolean } | undefined;
        const qualityScore = traderQualityScore(pnl, roi, 0, windows);
        const tier = pnl >= 100_000 ? "elite" : pnl >= 30_000 ? "pro" : "active";
        const recentForm = windows?.inWeek && windows?.inMonth ? "🔥 Hot"
          : windows?.inWeek ? "⚡ This week"
          : windows?.inMonth ? "📈 This month"
          : "all-time";
        const rawName = t.userName || "";
        const displayedName = isHexTimestampUsername(rawName) || !rawName
          ? truncAddr(t.proxyWallet || "") : rawName;
        traders.push({
          address: t.proxyWallet || "", name: displayedName,
          xUsername: t.xUsername || undefined,
          verifiedBadge: t.verifiedBadge || false,
          pnl, roi, positionCount: 0, winRate: 0, avgSize: 0, volume: vol,
          rank: parseInt(t.rank || String(idx + 1)),
          qualityScore, tier, recentForm,
          source: "sports_lb",
          polyAnalyticsUrl: `https://polymarketanalytics.com/traders/${t.proxyWallet || ""}`,
        });
      };

      for (let i = 0; i < raw.length; i++) addLbTrader(raw[i], i);

      // ── Step 3: Merge curated and discovered traders from sharedTraderMap ──────
      // These are populated during signal computation and shared here.
      // Show curated traders always; show discovered/general LB if they have quality score.
      if (sharedTraderMap.size > 0) {
        for (const [addr, info] of sharedTraderMap) {
          if (seenAddrs.has(addr)) continue; // already in leaderboard list
          // Only show non-LB traders if they have meaningful quality
          if (info.source === "discovered" && info.qualityScore < 10) continue;
          if (info.source === "general_lb" && info.pnl < 500) continue;
          seenAddrs.add(addr);
          const tier = info.pnl >= 100_000 ? "elite" : info.pnl >= 30_000 ? "pro" : "active";
          const recentForm = info.source === "curated" ? "📌 Curated"
            : info.source === "discovered" ? "🔍 Discovered"
            : "all-time";
          traders.push({
            address: addr,
            name: info.name,
            xUsername: undefined,
            verifiedBadge: info.source === "curated",
            pnl: info.pnl,
            roi: info.roi,
            positionCount: 0,
            winRate: 0,
            avgSize: 0,
            volume: info.volume,
            rank: 999,
            qualityScore: info.qualityScore,
            tier,
            recentForm,
            source: info.source,
            polyAnalyticsUrl: `https://polymarketanalytics.com/traders/${addr}`,
          });
        }
      }

      const sorted = traders
        .sort((a, b) => b.qualityScore - a.qualityScore)
        .slice(0, limit);

      const bySource = sorted.reduce((acc: any, t: any) => {
        acc[t.source || "sports_lb"] = (acc[t.source || "sports_lb"] || 0) + 1;
        return acc;
      }, {});

      const result = {
        traders: sorted,
        fetchedAt: Date.now(),
        window: "ALL+WEEK+MONTH",
        category,
        source: "unified_trader_pool_v6",
        breakdown: bySource,
        sharedMapAge: sharedTraderMapUpdatedAt ? Math.round((Date.now() - sharedTraderMapUpdatedAt) / 1000) + "s ago" : "not yet populated",
      };
      setCache(cKey, result, 5 * 60 * 1000); // 5-min cache (shorter since pool is richer now)
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
        const gameStatus = categoriseMarket(parsed.question, parsed.endDate, parsed.gameStartTime);
        const sharpAction = signalsByMarket.get(parsed.id || parsed.conditionId || "") ?? null;
        return { ...parsed, marketType: mType, gameStatus, sharpAction };
      }).filter(m => {
        if (!m.id || !m.question || !m.active) return false;
        if (sportsOnly && !isSportsRelated(m.question)) return false;
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
      const [allTrades, allSportsLb] = await Promise.all([
        fetchRecentTrades(3000),
        fetchMultiWindowSportsLB(),
      ]);

      const lbMap = new Map<string, { name: string; pnl: number; isSportsLb: boolean }>();
      for (const t of allSportsLb) {
        const w = (t.proxyWallet || "").toLowerCase();
        if (!w || lbMap.has(w)) continue;
        lbMap.set(w, {
          name: t.userName || truncAddr(w),
          pnl: parseFloat(t.pnl || "0"),
          isSportsLb: true,
        });
      }

      const alerts: any[] = [];
      const seen = new Set<string>();

      for (const trade of allTrades) {
        const wallet = (trade.proxyWallet || "").toLowerCase();
        const isTracked = lbMap.has(wallet);
        const size = parseFloat(trade.size || trade.amount || "0");

        // Only tracked traders OR very large anonymous bets ($5K+)
        if (!isTracked && size < 5000) continue;
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
        const alertDbEntry = marketDb.get(alertCondId);
        const alertEndDate = trade.endDate || alertDbEntry?.endDate;

        alerts.push({
          id: `alert-${trade.id || key}`,
          trader: trader?.name || truncAddr(wallet),
          wallet,
          isTracked,
          isSportsLb: trader?.isSportsLb ?? false,
          market: title.slice(0, 80),
          slug: trade.slug,
          conditionId: alertCondId,
          side,
          size: Math.round(size),
          price: Math.round(price * 1000) / 1000,
          americanOdds: toAmericanOdds(price),
          gameStatus: categoriseMarket(title, alertEndDate, alertDbEntry?.gameStartTime),
          endDate: alertEndDate,
          timestamp: ts,
          minutesAgo: Math.round((now - ts) / 60_000),
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
      const cKey = `signals-elite-v15-${sportsOnly ? "sp" : "all"}`;
      const hit  = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      const now = Date.now();

      // ── Phase 1: Build verified trader quality map ───────────────────────────
      // Pull from: sports leaderboard (category=sports) + general leaderboard + curated elites
      const [allSportsLb, rawGeneralLb, generalWeek, generalMonth, allTrades, marketDb, ...curatedTradeBatches] = await Promise.all([
        fetchMultiWindowSportsLB(),                    // ALL + WEEK + MONTH sports, deduped
        fetchOfficialLeaderboard("ALL",   150, ""),    // top 150 all-time general
        fetchOfficialLeaderboard("WEEK",  100, ""),    // top 100 weekly general
        fetchOfficialLeaderboard("MONTH", 100, ""),    // top 100 monthly general
        fetchRecentTrades(20000),                      // 20K trades for broad wallet discovery
        buildMarketDatabase(800),
        // Fetch recent trades for each curated elite in parallel
        ...CURATED_ELITES.map(e => fetchEliteTraderTrades(e.addr, 100)),
      ]);
      const rawSportsLb = allSportsLb; // keep alias for positions section

      // Merge curated elite trades into allTrades (deduplicate by transactionHash)
      const seenTxHashes = new Set<string>(allTrades.map((t: any) => t.transactionHash).filter(Boolean));
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
        console.log(`[Curated] ${elite.name}: ${sportsCount} sports trades, $${Math.round(sportsVol)} vol, quality=${qualityScore}`);
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

      // Add sports leaderboard traders (ALL + WEEK + MONTH windows combined)
      for (const t of allSportsLb) {
        const addr = (t.proxyWallet || "").toLowerCase();
        if (!addr || lbMap.has(addr)) continue;
        const pnl = parseFloat(t.pnl || "0");
        const vol = parseFloat(t.vol || "0");
        const roi = vol > 0 ? (pnl / vol) * 100 : 0;
        const name = t.userName || truncAddr(addr);
        const windows = t._windows as { inAll?: boolean; inWeek?: boolean; inMonth?: boolean } | undefined;
        lbMap.set(addr, {
          name, pnl, roi, volume: vol,
          qualityScore: traderQualityScore(pnl, roi, 10, windows),
          isLeaderboard: true,
          isSportsLb: true,
          source: "sports_lb",
        });
      }
      // Add general leaderboard traders (ALL + WEEK + MONTH windows)
      for (const t of [...rawGeneralLb, ...generalWeek, ...generalMonth]) {
        const addr = (t.proxyWallet || "").toLowerCase();
        if (!addr || lbMap.has(addr)) continue;
        const pnl = parseFloat(t.pnl || "0");
        const vol = parseFloat(t.vol || "0");
        const roi = vol > 0 ? (pnl / vol) * 100 : 0;
        const name = t.userName || truncAddr(addr);
        if (isAutoPseudonym(name)) continue;
        lbMap.set(addr, {
          name, pnl, roi, volume: vol,
          qualityScore: traderQualityScore(pnl, roi, 10),
          isLeaderboard: true,
          isSportsLb: false,
          source: "general_lb",
        });
      }

      // Also identify active sports bettors from recent trades (5+ sports bets)
      const recentSportsBettors = new Map<string, { count: number; totalSize: number; name: string }>();
      for (const trade of allTrades) {
        const title = (trade.title || trade.slug || "").toLowerCase();
        if (!isSportsRelated(title)) continue;
        const wallet = (trade.proxyWallet || "").toLowerCase();
        if (!wallet || lbMap.has(wallet)) continue; // already covered
        const name = trade.name || trade.pseudonym || "";
        const size = parseFloat(trade.size || "0");
        const ex = recentSportsBettors.get(wallet);
        if (!ex) recentSportsBettors.set(wallet, { count: 1, totalSize: size, name });
        else { ex.count++; ex.totalSize += size; if (!ex.name) ex.name = name; }
      }
      // Add active sports bettors from recent trades as secondary tracked traders.
      // Lower threshold: even a single $500+ bet is worth tracking for positions.
      // Quality score is computed from real observed activity — no hardcoded values.
      for (const [addr, info] of recentSportsBettors) {
        if (info.count >= 3 && info.totalSize >= 300 || info.totalSize >= 500) {
          const avgBet = info.totalSize / info.count;
          const volScore   = Math.min(info.totalSize / 30_000, 1) * 40;
          const countScore = Math.min(info.count / 40, 1) * 30;
          const avgScore   = Math.min(avgBet / 1_000, 1) * 30;
          lbMap.set(addr, {
            name: displayName(info.name, addr),
            pnl: 0, roi: 0, volume: info.totalSize,
            qualityScore: Math.min(Math.round(volScore + countScore + avgScore), 65),
            isLeaderboard: false,
            isSportsLb: false,
            source: "discovered",
          });
        }
      }

      console.log(`[Elite v11] ${lbMap.size} tracked traders (${[...lbMap.values()].filter(t=>t.source==='sports_lb').length} sportsLB, ${[...lbMap.values()].filter(t=>t.source==='general_lb').length} generalLB, ${[...lbMap.values()].filter(t=>t.source==='curated').length} curated, ${[...lbMap.values()].filter(t=>t.source==='discovered').length} discovered) | ${allTrades.length} trades | ${marketDb.size} markets`);

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
          pnl: 0, roi: 0, isLeaderboard: false, isSportsLb: false,
          qualityScore: Math.min(35, Math.round(Math.log10(size + 1) * 7)),
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

      for (const [condId, mw] of marketWallets.entries()) {
        if (!mw.question || mw.question === condId) continue;

        const entries = Array.from(mw.wallets.values());
        if (entries.length === 0) continue;

        const yesE = entries.filter(e => e.side === "YES");
        const noE  = entries.filter(e => e.side === "NO");
        const dominant = yesE.length >= noE.length ? yesE : noE;
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

        const avgROI     = dominant.reduce((s, e) => s + e.traderInfo.roi, 0) / dominant.length;
        const avgQuality = dominant.reduce((s, e) => s + e.traderInfo.qualityScore, 0) / dominant.length;
        const avgEntry   = dominant.reduce((s, e) => s + (e.prices.reduce((a, b) => a + b, 0) / e.prices.length), 0) / dominant.length;
        const avgSize    = totalDominantSize / dominant.length;

        // ── Live price via CLOB ────────────────────────────────────────────────
        let currentPrice = avgEntry;
        const liveTokenId = side === "YES" ? mw.yesTokenId : mw.noTokenId;
        if (liveTokenId) {
          const mid = await fetchMidpoint(liveTokenId);
          if (mid !== null) currentPrice = mid; // accept ANY non-null price, including near-0/1 for resolved markets
        }
        currentPrice = Math.min(0.99, Math.max(0.01, currentPrice));

        // ── Strict price range filter (0.10–0.90) ─────────────────────────────
        if (currentPrice < MIN_LIVE_PRICE || currentPrice > MAX_LIVE_PRICE) continue;

        const valueDelta = side === "YES"
          ? (avgEntry - currentPrice - SLIPPAGE)
          : ((1 - avgEntry) - (1 - currentPrice) - SLIPPAGE);

        const { score: confidence, breakdown } = computeConfidence(
          avgROI, consensusPct, valueDelta, avgSize, dominant.length, avgQuality
        );

        const tier = dominant.length >= 3 && avgQuality >= 45 ? "HIGH"
                   : dominant.length >= 2 ? "MED" : "SINGLE";

        const mInfo = marketDb.get(condId);
        const id    = `elite-${condId}-${side}`;
        const isNew = !seenSignalIds.has(id) && confidence >= 55;
        seenSignalIds.add(id);

        const isSports = isSportsRelated(mw.question);
        const mTypeRaw2 = categoriseMarket(mw.question, mw.endDate || mInfo?.endDate, mInfo?.gameStartTime);
        const marketCategory = classifyMarketType(mw.question);
        // Specific game markets (moneyline/spread/total) should be PREGAME, not FUTURES
        const mType = (mTypeRaw2 === "futures" && marketCategory !== "futures") ? "pregame" : mTypeRaw2;
        const isActionable = computeIsActionable(currentPrice, avgEntry, side);
        const bigPlayScore = computeBigPlayScore(totalDominantSize, dominant.length);

        signals.push({
          id, marketId: condId,
          marketQuestion: mw.question,
          slug: mw.slug,
          outcome: side, side,
          confidence, tier, marketType: mType, isSports,
          marketCategory,
          isActionable,
          bigPlayScore,
          consensusPct: Math.round(consensusPct),
          valueDelta: Math.round(valueDelta * 1000) / 1000,
          currentPrice: Math.round(currentPrice * 1000) / 1000,
          avgEntryPrice: Math.round(avgEntry * 1000) / 1000,
          totalNetUsdc: Math.round(totalDominantSize),
          avgNetUsdc: Math.round(avgSize),
          traderCount: dominant.length,
          lbTraderCount: lbCount,
          sportsLbCount,
          avgQuality: Math.round(avgQuality),
          scoreBreakdown: breakdown,
          traders: dominant.slice(0, 8).map(e => ({
            address: e.address,
            name: e.traderInfo.name,
            entryPrice: Math.round((e.prices.reduce((a, b) => a + b, 0) / e.prices.length) * 1000) / 1000,
            size: Math.round(e.totalSize),
            netUsdc: Math.round(e.totalSize),
            roi: Math.round(e.traderInfo.roi * 10) / 10,
            qualityScore: e.traderInfo.qualityScore,
            pnl: Math.round(e.traderInfo.pnl),
            isLeaderboard: e.traderInfo.isLeaderboard,
            isSportsLb: (e.traderInfo as any).isSportsLb ?? false,
            tradeTime: (e as any).lastTimestamp || 0,
          })),
          category: isSports ? "sports" : "other",
          volume: 0,
          generatedAt: now,
          isValue: valueDelta > 0, isNew,
          outcomeLabel: computeOutcomeLabel(mw.question, side),
          yesTokenId: mw.yesTokenId,
          noTokenId: mw.noTokenId,
        });
      }

      // ── Phase 4: Positions-based signals from verified sports traders ──────────
      // Pull open positions from ALL tracked traders in the intelligence pool:
      // 1. Sports LB wallets (definitely sports bettors)
      // 2. Curated elites (verified manually)
      // 3. Discovered from trades scan (recently seen making sports bets)
      // 4. High-quality general LB traders who passed the sports activity filter
      const lbWallets = allSportsLb
        .slice(0, 150)
        .map((t: any) => (t.proxyWallet || "").toLowerCase())
        .filter(Boolean);
      const curatedWallets = CURATED_ELITES.map(e => e.addr.toLowerCase());
      // Include discovered traders from trade scan — any with $500+ sports volume
      // (single large bet OR multiple smaller ones)
      const allDiscoverable = [...recentSportsBettors.entries()];
      const passing = allDiscoverable.filter(([_, s]) =>
        s.totalSize >= 500 || (s.count >= 2 && s.totalSize >= 200)
      );
      console.log(`[Discovered] ${allDiscoverable.length} candidates, top5: ${
        allDiscoverable
          .sort((a, b) => b[1].totalSize - a[1].totalSize)
          .slice(0, 5)
          .map(([a, s]) => `${a.slice(0, 8)} cnt=${s.count} vol=${Math.round(s.totalSize)}`)
          .join(", ")
      }; passing (≥$500 vol OR ≥2 trades+$200): ${passing.length}`);
      const discoveredSportsWallets = passing
        .sort((a, b) => b[1].totalSize - a[1].totalSize)
        .slice(0, 150) // cap at 150 discovered wallets
        .map(([addr]) => addr);
      // Include general LB traders who also have sports activity in the scan window
      const generalSportsActive = [...lbMap.entries()]
        .filter(([addr, info]) => info.source === "general_lb" && recentSportsBettors.has(addr))
        .map(([addr]) => addr);
      const topSportsWallets = [...new Set([...lbWallets, ...curatedWallets, ...discoveredSportsWallets, ...generalSportsActive])];
      console.log(`[Positions] Scanning ${topSportsWallets.length} traders (${lbWallets.length} sportsLB + ${curatedWallets.length} curated + ${discoveredSportsWallets.length} discovered + ${generalSportsActive.length} genLB-active)`);
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
            const outcomeIdx = pos.outcomeIndex ?? (pos.outcome === "Yes" ? 0 : 1);
            const side: "YES"|"NO" = outcomeIdx === 0 ? "YES" : "NO";
            const mapKey = `${condId}-${side}`;
            // Asset IDs from position data (YES=asset, NO=oppositeAsset when outcomeIdx=0)
            const yesAssetFromPos = outcomeIdx === 0 ? String(pos.asset || "") : String(pos.oppositeAsset || "");
            const noAssetFromPos  = outcomeIdx === 0 ? String(pos.oppositeAsset || "") : String(pos.asset || "");

            if (!posMap.has(mapKey)) {
              // Fall back to marketDb endDate if pos.endDate is missing, then slug date
              const dbEntry = marketDb.get(condId);
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
                gameStatus: categoriseMarket(title, resolvedEndDate, marketDb.get(condId)?.gameStartTime),
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

          // Skip positions for markets whose end date has already passed
          const endMs = pg.endDate ? new Date(pg.endDate).getTime() : Infinity;
          if (pg.endDate && endMs < now) continue;

          // Check price range strictly for game-day markets, loosely for futures
          const avgCurPrice = pg.traders.reduce((s, t) => s + t.curPrice, 0) / pg.traders.length;
          const isFutures = endMs - now > 14 * 24 * 3600_000; // more than 14 days out
          const minPrice = isFutures ? 0.05 : 0.10;
          if (avgCurPrice < minPrice || avgCurPrice > 0.95) continue;

          const avgEntry = pg.traders.reduce((s, t) => s + t.entryPrice, 0) / pg.traders.length;
          const avgSize  = pg.totalValue / pg.traders.length;
          const valueDelta = pg.side === "YES"
            ? (avgEntry - avgCurPrice - 0.02)
            : ((1 - avgEntry) - (1 - avgCurPrice) - 0.02);

          const consensusPct = 100; // all are on same side by construction
          // Use actual ROI from lbMap — not zero. This unlocks the 40% ROI factor.
          // Traders like EIf (63% ROI), Herdonia (33%), tutedefore (54%) now score much higher.
          const avgROI = pg.traders.reduce((s, t) => s + (lbMap.get(t.wallet)?.roi ?? 0), 0) / pg.traders.length;
          const avgQualityForScore = pg.traders.length > 0
            ? Math.round(pg.traders.reduce((s, t) => s + (lbMap.get(t.wallet)?.qualityScore ?? 20), 0) / pg.traders.length)
            : 20;
          const { score: confidence, breakdown } = computeConfidence(
            avgROI, consensusPct, valueDelta, avgSize, pg.traders.length, avgQualityForScore
          );

          const mTypeRaw = categoriseMarket(pg.question, pg.endDate, marketDb.get(pg.conditionId)?.gameStartTime);
          const marketCategory = classifyMarketType(pg.question);
          // Specific game markets (moneyline/spread/total) should show as PREGAME, not FUTURES
          // even if the game is > 7 days away. FUTURES badge is reserved for season/championship bets.
          const mType = (mTypeRaw === "futures" && marketCategory !== "futures") ? "pregame" : mTypeRaw;
          const isActionable = computeIsActionable(avgCurPrice, avgEntry, pg.side);
          const bigPlayScore = computeBigPlayScore(pg.totalValue, pg.traders.length);
          const id = `pos-${pg.conditionId}-${pg.side}`;
          const isNew = !seenSignalIds.has(id);
          seenSignalIds.add(id);

          // Token IDs: prefer position's asset data (always available), fall back to marketDb
          const pgMarket = marketDb.get(pg.conditionId);
          const pgYesTokenId = pg.yesAsset || pgMarket?.tokenIds?.[0];
          const pgNoTokenId  = pg.noAsset  || pgMarket?.tokenIds?.[1];

          signals.push({
            id, marketId: pg.conditionId,
            marketQuestion: pg.question,
            slug: pg.slug,
            outcome: pg.side, side: pg.side,
            confidence, tier: pg.traders.length >= 3 ? "HIGH" : "MED",
            marketType: mType, isSports: true,
            marketCategory,
            isActionable,
            bigPlayScore,
            consensusPct: 100,
            valueDelta: Math.round(valueDelta * 1000) / 1000,
            currentPrice: Math.round(avgCurPrice * 1000) / 1000,
            avgEntryPrice: Math.round(avgEntry * 1000) / 1000,
            totalNetUsdc: Math.round(pg.totalValue),
            avgNetUsdc: Math.round(avgSize),
            traderCount: pg.traders.length,
            lbTraderCount: pg.traders.filter(t => lbMap.get(t.wallet)?.isLeaderboard).length,
            sportsLbCount: pg.traders.filter(t => t.isSportsLb).length,
            avgQuality: pg.traders.length > 0
              ? Math.round(pg.traders.reduce((s, t) => s + (lbMap.get(t.wallet)?.qualityScore ?? 20), 0) / pg.traders.length)
              : 20,
            scoreBreakdown: breakdown,
            traders: pg.traders.slice(0, 8).map(t => {
              const tm = lbMap.get(t.wallet);
              return {
                address: t.wallet,
                name: t.name,
                entryPrice: Math.round(t.entryPrice * 1000) / 1000,
                size: Math.round(t.currentValue),
                netUsdc: Math.round(t.currentValue),
                roi: tm?.roi ?? 0,
                qualityScore: tm?.qualityScore ?? 20,
                pnl: tm?.pnl ?? 0,
                isLeaderboard: tm?.isLeaderboard ?? false,
                isSportsLb: t.isSportsLb,
              };
            }),
            category: "sports",
            volume: 0,
            generatedAt: now,
            isValue: valueDelta > 0,
            isNew,
            source: "positions",
            outcomeLabel: computeOutcomeLabel(pg.question, pg.side),
            yesTokenId: pgYesTokenId,
            noTokenId: pgNoTokenId,
          });
        }
        console.log(`[Elite v11] Added ${signals.length - (signals.length - posMap.size)} positions-based signals from top sports traders`);
      }

      signals.sort((a, b) => b.confidence - a.confidence);
      console.log(`[Elite v11] ${signals.length} signals total (trades + positions)`);

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
        topTraderCount: lbMap.size,
        marketsScanned: marketDb.size,
        newSignalCount: signals.filter(s => s.isNew).length,
        fetchedAt: now,
        source: "verified_sports_v11",
      };
      setCache(cKey, response, 2 * 60 * 1000);

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
      const cKey = "signals-fast-v5";
      const hit  = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      const now = Date.now();
      const [allTrades, marketDb] = await Promise.all([
        fetchRecentTrades(4000),
        buildMarketDatabase(800),
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
          if (mid !== null && mid > 0.01 && mid < 0.99) currentPrice = mid;
        }
        currentPrice = Math.min(0.99, Math.max(0.01, currentPrice));

        // Enforce price range 0.10–0.90
        if (currentPrice < 0.10 || currentPrice > 0.90) continue;

        const valueDelta = side === "YES"
          ? (avgEntry - currentPrice - SLIPPAGE)
          : ((1 - avgEntry) - (1 - currentPrice) - SLIPPAGE);

        const { score: confidence, breakdown } = computeConfidence(
          15, consensusPct, valueDelta, avgSize, dominant.length, 40
        );

        const tier = dominant.length >= 3 ? "HIGH" : "MED";
        const marketTypeRaw = categoriseMarket(info.question || condId, info.endDate, info.gameStartTime);
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
          traderCount: dominant.length,
          avgQuality: 40,
          scoreBreakdown: breakdown,
          traders: dominant.slice(0, 8).map(e => ({
            address: e.wallet,
            name: e.name,
            entryPrice: Math.round((e.prices.reduce((a, b) => a + b, 0) / e.prices.length) * 1000) / 1000,
            size: Math.round(e.totalSize),
            netUsdc: Math.round(e.totalSize),
            roi: 0, qualityScore: 0,
          })),
          category: info.category || "sports",
          volume: info.volume || 0,
          generatedAt: now,
          isValue: valueDelta > 0,
          isNew: false,
          outcomeLabel: computeOutcomeLabel(info.question || condId, side),
        });
      }

      const uniqueTraders = new Set(allTrades.map((t: any) => t.proxyWallet).filter(Boolean)).size;
      signals.sort((a, b) => b.confidence - a.confidence);

      const response = {
        signals,
        topTraderCount: uniqueTraders,
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

  return httpServer;
}
