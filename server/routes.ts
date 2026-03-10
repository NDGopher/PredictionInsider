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
function categoriseMarket(question: string, endDate?: string): "live" | "pregame" | "futures" {
  const q = (question || "").toLowerCase();
  // Live signals: in-game phrases
  if (/(lead|trailing|winning|losing|currently|live|in-game|halftime|first half|second half|quarter|overtime|period)/.test(q)) return "live";
  if (!endDate) return "pregame";
  const ms = new Date(endDate).getTime() - Date.now();
  if (ms < 0) return "pregame";          // already ended → still show, was recent
  if (ms < 4 * 3600 * 1000) return "live";     // ending within 4h
  if (ms < 7 * 24 * 3600 * 1000) return "pregame"; // ending within 7 days
  return "futures";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function truncAddr(addr: string) {
  if (!addr || addr.length < 10) return addr || "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const PRICE_SCALE  = 1_000_000;
const AMOUNT_SCALE = 1_000_000;

/** Trader quality 0–100 */
function traderQualityScore(pnl: number, roi: number, positionCount: number): number {
  const pnlScore   = Math.min(pnl / 2_000_000, 1) * 100;         // max at $2M PNL
  const roiScore   = Math.min(Math.max(roi, 0) / 60, 1) * 100;   // max at 60% ROI
  const countScore = Math.min(positionCount / 15, 1) * 100;       // max at 15 positions
  return Math.round(pnlScore * 0.35 + roiScore * 0.45 + countScore * 0.20);
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
    `${DATA_API}/v1/leaderboard?window=all&limit=${limit}${catParam}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  const traders: any[] = Array.isArray(data) ? data : data.data || [];
  setCache(key, traders, 10 * 60 * 1000);
  return traders;
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

async function fetchMidpoint(tokenId: string): Promise<number | null> {
  const key = `mid-${tokenId}`;
  const hit = getCache<number>(key);
  if (hit !== null) return hit;
  try {
    const res = await fetchWithRetry(`${CLOB_API}/midpoint?token_id=${tokenId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const mid = parseFloat(data.mid ?? data.midpoint ?? "0");
    if (!isNaN(mid) && mid > 0) { setCache(key, mid, 60_000); return mid; }
  } catch {}
  return null;
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

    db.set(condId, {
      question: m.question || m.title || condId,
      slug: m.slug,
      endDate: m.endDate,
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
  if (tokenIds.length === 0 && Array.isArray(m.clobTokenIds)) tokenIds = m.clobTokenIds.map(String);
  return {
    id: m.id || m.conditionId || "",
    question: m.question || m.title || "",
    slug: m.slug,
    category: m.groupItemTagSlug || m.category || "other",
    currentPrice: outcomePrices[0] ?? 0.5,
    volume: parseFloat(m.volume || m.volumeNum || "0"),
    liquidity: parseFloat(m.liquidity || m.liquidityNum || "0"),
    endDate: m.endDate,
    active: m.active !== false && m.closed !== true,
    traderCount: parseInt(m.uniqueTraders || m.traderCount || "0"),
    conditionId: m.conditionId || m.id || "",
    tokenIds,
  };
}

// ─── Route registration ───────────────────────────────────────────────────────
export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // ── GET /api/traders ────────────────────────────────────────────────────────
  app.get("/api/traders", async (req, res) => {
    try {
      const category = (req.query.category as string) || "sports";
      const limit    = Math.min(parseInt((req.query.limit as string) || "50"), 100);
      const cKey     = `traders-v4-${category}-${limit}`;
      const hit      = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      const raw = await fetchOfficialLeaderboard("ALL", limit * 3, category === "all" ? "" : category);

      // Filter out bot-like entries and low-quality arb traders
      const filtered = raw.filter((t: any) => {
        const name = t.userName || "";
        const vol  = parseFloat(t.vol || "0");
        const pnl  = parseFloat(t.pnl || "0");
        // Remove hex-wallet usernames (auto-generated names like "0x6a57D263...-timestamp")
        if (name.startsWith("0x") && name.length > 20) return false;
        // Remove entries where username contains a long hex+timestamp pattern
        if (/^0x[a-fA-F0-9]{10,}-\d{10,}$/.test(name)) return false;
        // Remove pure arbitrageurs: high volume but near-zero profit ratio
        if (vol > 500_000 && pnl / vol < 0.025) return false;
        // Require some minimum PNL for quality
        if (pnl < 1000) return false;
        return true;
      });

      const traders = filtered
        .map((t: any, i: number) => {
          const pnl = parseFloat(t.pnl || "0");
          const vol = parseFloat(t.vol || "0");
          const roi = vol > 0 ? (pnl / vol) * 100 : 0;
          const qualityScore = traderQualityScore(pnl, roi, 0);
          const tier =
            pnl >= 100_000 ? "elite"
            : pnl >= 30_000 ? "pro"
            : "active";
          return {
            address:       t.proxyWallet || "",
            name:          t.userName || truncAddr(t.proxyWallet || ""),
            xUsername:     t.xUsername || undefined,
            verifiedBadge: t.verifiedBadge || false,
            pnl, roi,
            positionCount: 0,
            winRate:       0,
            avgSize:       0,
            volume:        vol,
            rank:          parseInt(t.rank || String(i + 1)),
            qualityScore,
            tier,
            polyAnalyticsUrl: `https://polymarketanalytics.com/traders/${t.proxyWallet || ""}`,
          };
        })
        .slice(0, limit);

      const result = { traders, fetchedAt: Date.now(), window: "ALL", category, source: "sports_leaderboard_v4" };
      setCache(cKey, result, 10 * 60 * 1000);
      res.json(result);
    } catch (err: any) {
      console.error("Traders error:", err.message);
      res.status(500).json({ error: err.message, traders: [], fetchedAt: Date.now(), window: "ALL", category: "sports" });
    }
  });

  // ── GET /api/markets ────────────────────────────────────────────────────────
  app.get("/api/markets", async (req, res) => {
    try {
      const limit      = Math.min(parseInt((req.query.limit as string) || "100"), 200);
      const sportsOnly = req.query.sports !== "false";
      const raw = await fetchSportsMarkets();
      const markets = raw
        .map(parseMarket)
        .filter(m => m.id && m.question && m.active && (!sportsOnly || isSportsRelated(m.question)));
      res.json({ markets: markets.slice(0, limit), fetchedAt: Date.now(), total: markets.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message, markets: [], fetchedAt: Date.now(), total: 0 });
    }
  });

  // ── GET /api/signals ─── Elite signals v11: verified sports traders only ────
  app.get("/api/signals", async (req, res) => {
    try {
      const sportsOnly = req.query.sports !== "false";
      const cKey = `signals-elite-v11-${sportsOnly ? "sp" : "all"}`;
      const hit  = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      const now = Date.now();

      // ── Phase 1: Build verified trader quality map ───────────────────────────
      // Pull from: sports leaderboard (category=sports) + general leaderboard
      const [rawSportsLb, rawGeneralLb, rawSportsMonth, allTrades, marketDb] = await Promise.all([
        fetchOfficialLeaderboard("ALL", 100, "sports"),
        fetchOfficialLeaderboard("ALL", 100, ""),
        fetchOfficialLeaderboard("MONTH", 50, "sports"),
        fetchRecentTrades(5000),
        buildMarketDatabase(800),
      ]);

      type TraderInfo = { name: string; pnl: number; roi: number; qualityScore: number; isLeaderboard: boolean; isSportsLb: boolean };
      const lbMap = new Map<string, TraderInfo>();

      // Add sports leaderboard traders (highest quality for sports)
      for (const t of [...rawSportsLb, ...rawSportsMonth]) {
        const addr = (t.proxyWallet || "").toLowerCase();
        if (!addr || lbMap.has(addr)) continue;
        const pnl = parseFloat(t.pnl || "0");
        const vol = parseFloat(t.vol || "0");
        const roi = vol > 0 ? (pnl / vol) * 100 : 0;
        const name = t.userName || truncAddr(addr);
        lbMap.set(addr, {
          name, pnl, roi,
          qualityScore: traderQualityScore(pnl, roi, 10),
          isLeaderboard: true,
          isSportsLb: true,
        });
      }
      // Add general leaderboard traders (still quality traders)
      for (const t of rawGeneralLb) {
        const addr = (t.proxyWallet || "").toLowerCase();
        if (!addr || lbMap.has(addr)) continue;
        const pnl = parseFloat(t.pnl || "0");
        const vol = parseFloat(t.vol || "0");
        const roi = vol > 0 ? (pnl / vol) * 100 : 0;
        const name = t.userName || truncAddr(addr);
        if (isAutoPseudonym(name)) continue; // skip anonymous from general LB
        lbMap.set(addr, {
          name, pnl, roi,
          qualityScore: traderQualityScore(pnl, roi, 10),
          isLeaderboard: true,
          isSportsLb: false,
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
      // Add frequent recent sports bettors as secondary tracked traders
      for (const [addr, info] of recentSportsBettors) {
        if (info.count >= 5 && info.totalSize >= 500) {
          lbMap.set(addr, {
            name: displayName(info.name, addr),
            pnl: 0, roi: 0,
            qualityScore: Math.min(35, Math.round(Math.log10(info.totalSize + 1) * 7)),
            isLeaderboard: false,
            isSportsLb: false,
          });
        }
      }

      console.log(`[Elite v11] ${lbMap.size} tracked traders | ${allTrades.length} trades | ${marketDb.size} markets`);

      // ── Phase 2: Aggregate positions ─────────────────────────────────────────
      // Tracked traders: include bets >= $200
      // Non-tracked wallets: include bets >= $500 (large enough to signal conviction)
      const LARGE_BET_THRESHOLD = 500;
      const MIN_POSITION_SIZE = 200; // minimum bet to include at all

      type WalletPos = {
        side: "YES"|"NO"; totalSize: number; prices: number[];
        name: string; traderInfo: TraderInfo; address: string;
        asset: string;
      };
      const marketWallets = new Map<string, {
        question: string; slug?: string; condId: string;
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
          marketWallets.set(condId, {
            question: mInfo?.question || trade.title || condId,
            slug: mInfo?.slug || trade.slug,
            condId,
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

        const ex = mw.wallets.get(wallet);
        if (!ex) {
          mw.wallets.set(wallet, { side, totalSize: size, prices: [price], name: traderInfo.name, traderInfo, address: wallet, asset });
        } else {
          if (ex.side === side) { ex.totalSize += size; ex.prices.push(price); }
          else if (size > ex.totalSize) { ex.side = side; ex.totalSize = size; ex.prices = [price]; }
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
          if (mid !== null && mid > 0.01 && mid < 0.99) currentPrice = mid;
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
        const mType = categoriseMarket(mw.question, mInfo?.endDate);

        signals.push({
          id, marketId: condId,
          marketQuestion: mw.question,
          slug: mw.slug,
          outcome: side, side,
          confidence, tier, marketType: mType, isSports,
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
          })),
          category: isSports ? "sports" : "other",
          volume: 0,
          generatedAt: now,
          isValue: valueDelta > 0, isNew,
        });
      }

      // ── Phase 4: Positions-based signals from verified sports traders ──────────
      // Pull current open positions from top sports leaderboard traders.
      // These reflect actual money they have deployed RIGHT NOW.
      const topSportsWallets = rawSportsLb.slice(0, 30).map((t: any) => (t.proxyWallet || "").toLowerCase()).filter(Boolean);
      if (topSportsWallets.length > 0) {
        const positionBatches = await Promise.all(topSportsWallets.map(w => fetchTraderPositions(w)));
        // Map: conditionId+outcomeIndex → position aggregation
        type PosGroup = {
          conditionId: string; side: "YES"|"NO";
          question: string; slug?: string; endDate?: string;
          traders: { name: string; wallet: string; entryPrice: number; curPrice: number; currentValue: number; isSportsLb: boolean }[];
          totalValue: number;
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
            if (curPrice < 0.08 || curPrice > 0.95) continue; // extended range for futures
            const title = pos.title || pos.market || "";
            if (!isSportsRelated(title.toLowerCase())) continue;
            const condId = pos.conditionId || "";
            if (!condId) continue;
            const outcomeIdx = pos.outcomeIndex ?? (pos.outcome === "Yes" ? 0 : 1);
            const side: "YES"|"NO" = outcomeIdx === 0 ? "YES" : "NO";
            const mapKey = `${condId}-${side}`;

            if (!posMap.has(mapKey)) {
              posMap.set(mapKey, {
                conditionId: condId, side,
                question: title,
                slug: pos.slug || pos.eventSlug,
                endDate: pos.endDate,
                traders: [], totalValue: 0,
              });
            }
            const pg = posMap.get(mapKey)!;
            pg.traders.push({
              name: traderName, wallet,
              entryPrice: parseFloat(pos.avgPrice || "0"),
              curPrice, currentValue: val,
              isSportsLb: true,
            });
            pg.totalValue += val;
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

          // Check price range strictly for game-day markets, loosely for futures
          const avgCurPrice = pg.traders.reduce((s, t) => s + t.curPrice, 0) / pg.traders.length;
          const endMs = pg.endDate ? new Date(pg.endDate).getTime() : Infinity;
          const isFutures = endMs - now > 14 * 24 * 3600_000; // more than 14 days out
          const minPrice = isFutures ? 0.05 : 0.10;
          if (avgCurPrice < minPrice || avgCurPrice > 0.95) continue;

          const avgEntry = pg.traders.reduce((s, t) => s + t.entryPrice, 0) / pg.traders.length;
          const avgSize  = pg.totalValue / pg.traders.length;
          const valueDelta = pg.side === "YES"
            ? (avgEntry - avgCurPrice - 0.02)
            : ((1 - avgEntry) - (1 - avgCurPrice) - 0.02);

          const consensusPct = 100; // all are on same side by construction
          const avgROI = 0; // unknown for positions
          const { score: confidence, breakdown } = computeConfidence(
            avgROI, consensusPct, valueDelta, avgSize, pg.traders.length, 70
          );

          const mType = categoriseMarket(pg.question, pg.endDate);
          const id = `pos-${pg.conditionId}-${pg.side}`;
          const isNew = !seenSignalIds.has(id);
          seenSignalIds.add(id);

          signals.push({
            id, marketId: pg.conditionId,
            marketQuestion: pg.question,
            slug: pg.slug,
            outcome: pg.side, side: pg.side,
            confidence, tier: pg.traders.length >= 3 ? "HIGH" : "MED",
            marketType: mType, isSports: true,
            consensusPct: 100,
            valueDelta: Math.round(valueDelta * 1000) / 1000,
            currentPrice: Math.round(avgCurPrice * 1000) / 1000,
            avgEntryPrice: Math.round(avgEntry * 1000) / 1000,
            totalNetUsdc: Math.round(pg.totalValue),
            avgNetUsdc: Math.round(avgSize),
            traderCount: pg.traders.length,
            lbTraderCount: pg.traders.length,
            sportsLbCount: pg.traders.length,
            avgQuality: 75,
            scoreBreakdown: breakdown,
            traders: pg.traders.slice(0, 8).map(t => ({
              address: t.wallet,
              name: t.name,
              entryPrice: Math.round(t.entryPrice * 1000) / 1000,
              size: Math.round(t.currentValue),
              netUsdc: Math.round(t.currentValue),
              roi: 0,
              qualityScore: 75,
              pnl: 0,
              isLeaderboard: true,
              isSportsLb: true,
            })),
            category: "sports",
            volume: 0,
            generatedAt: now,
            isValue: valueDelta > 0,
            isNew,
            source: "positions",
          });
        }
        console.log(`[Elite v11] Added ${signals.length - (signals.length - posMap.size)} positions-based signals from top sports traders`);
      }

      signals.sort((a, b) => b.confidence - a.confidence);
      console.log(`[Elite v11] ${signals.length} signals total (trades + positions)`);

      const response = {
        signals,
        topTraderCount: lbMap.size,
        marketsScanned: marketDb.size,
        newSignalCount: signals.filter(s => s.isNew).length,
        fetchedAt: now,
        source: "verified_sports_v11",
      };
      setCache(cKey, response, 5 * 60 * 1000);
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
        const marketType = categoriseMarket(info.question || condId, info.endDate);

        signals.push({
          id: `fast-${condId}-${side}`,
          marketId: condId,
          marketQuestion: info.question || condId,
          slug: info.slug,
          outcome: side, side,
          confidence, tier, marketType,
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

      const rows = await fetchAllElitePositions([addr]);
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

  return httpServer;
}
