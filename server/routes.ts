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

async function fetchSportsMarkets(limit = 300): Promise<any[]> {
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

async function fetchRecentTrades(limit = 2000): Promise<any[]> {
  const key = `trades-${limit}`;
  const hit = getCache<any[]>(key);
  if (hit) return hit;
  const res = await fetchWithRetry(`${DATA_API}/trades?limit=${limit}`);
  if (!res.ok) return [];
  const data = await res.json();
  const trades: any[] = Array.isArray(data) ? data : data.data || [];
  setCache(key, trades, 2 * 60 * 1000);
  return trades;
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
      const raw = await fetchSportsMarkets(300);
      const markets = raw
        .map(parseMarket)
        .filter(m => m.id && m.question && m.active && (!sportsOnly || isSportsRelated(m.question)));
      res.json({ markets: markets.slice(0, limit), fetchedAt: Date.now(), total: markets.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message, markets: [], fetchedAt: Date.now(), total: 0 });
    }
  });

  // ── GET /api/signals ─── Elite signals: large-bet trades ($200+) with leaderboard enrichment ──
  app.get("/api/signals", async (req, res) => {
    try {
      const sportsOnly = req.query.sports !== "false";
      const cKey = `signals-elite-v10-${sportsOnly ? "sp" : "all"}`;
      const hit  = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      // ── Phase 1: Leaderboard quality map + large-bet trades ─────────────────
      // Elite signals = large recent bets ($500+) enriched with leaderboard PNL data.
      // This approach always has data and surfaces high-conviction trades.
      const [rawLbAll, rawLbMonth, allTrades] = await Promise.all([
        fetchOfficialLeaderboard("ALL",   200),
        fetchOfficialLeaderboard("MONTH", 100),
        fetchRecentTrades(8000),
      ]);

      type TraderInfo = { name: string; pnl: number; roi: number; qualityScore: number; isLeaderboard: boolean };
      const lbMap = new Map<string, TraderInfo>();
      for (const t of [...rawLbAll, ...rawLbMonth]) {
        const addr = (t.proxyWallet || "").toLowerCase();
        if (!addr || lbMap.has(addr)) continue;
        const pnl = parseFloat(t.pnl || "0");
        const vol = parseFloat(t.vol || "0");
        const roi = vol > 0 ? (pnl / vol) * 100 : 0;
        lbMap.set(addr, {
          name: t.userName || truncAddr(addr),
          pnl, roi,
          qualityScore: traderQualityScore(pnl, roi, 10),
          isLeaderboard: true,
        });
      }
      console.log(`[Elite] ${lbMap.size} leaderboard traders | ${allTrades.length} trades`);

      // ── Phase 2: Aggregate large bets per (conditionId, wallet) ─────────────
      // Min bet: $200 per trade. Higher threshold than fast signals ($0).
      const ELITE_MIN_BET = 200;

      type WalletPos = {
        side: "YES"|"NO"; totalSize: number; prices: number[];
        name: string; traderInfo: TraderInfo; address: string;
      };
      const marketWallets = new Map<string, {
        question: string; slug?: string; condId: string;
        endDate?: string;
        yesTokenId?: string; noTokenId?: string;
        wallets: Map<string, WalletPos>;
      }>();

      for (const trade of allTrades) {
        const size = parseFloat(trade.size || "0");
        if (size < ELITE_MIN_BET) continue; // large bets only

        const title = (trade.title || trade.slug || "").toLowerCase();
        if (sportsOnly && !isSportsRelated(title)) continue;
        // Filter noisy short-term crypto markets (minute/hour Up-or-Down markets)
        if (title.includes("up or down")) continue;

        const condId = trade.conditionId || "";
        if (!condId) continue;

        const wallet = (trade.proxyWallet || "").toLowerCase();
        const outcomeIdx = trade.outcomeIndex ?? (trade.outcome === "Yes" ? 0 : 1);
        const side: "YES"|"NO" = outcomeIdx === 0 ? "YES" : "NO";
        const price = parseFloat(trade.price || "0.5");
        const asset = String(trade.asset || "");

        // Quality info: leaderboard traders get full score; others get size-based score
        const lb = lbMap.get(wallet);
        const traderInfo: TraderInfo = lb ?? {
          name: trade.pseudonym || trade.name || truncAddr(wallet),
          pnl: 0, roi: 0, isLeaderboard: false,
          qualityScore: Math.min(40, Math.round(Math.log10(size + 1) * 9)),
        };

        if (!marketWallets.has(condId)) {
          marketWallets.set(condId, {
            question: trade.title || condId,
            slug: trade.slug,
            condId,
            endDate: undefined,
            wallets: new Map(),
          });
        }
        const mw = marketWallets.get(condId)!;
        // Store tokenId by side so we can fetch live midpoints later
        if (asset) {
          if (side === "YES" && !mw.yesTokenId) mw.yesTokenId = asset;
          if (side === "NO"  && !mw.noTokenId)  mw.noTokenId  = asset;
        }

        const ex = mw.wallets.get(wallet);
        if (!ex) {
          mw.wallets.set(wallet, { side, totalSize: size, prices: [price], name: traderInfo.name, traderInfo, address: wallet });
        } else {
          if (ex.side === side) { ex.totalSize += size; ex.prices.push(price); }
          else if (size > ex.totalSize) { ex.side = side; ex.totalSize = size; ex.prices = [price]; }
        }
      }

      console.log(`[Elite] ${marketWallets.size} markets with large bets`);

      // ── Phase 3: Generate signals ─────────────────────────────────────────
      const signals: any[] = [];
      const SLIPPAGE = 0.02;

      for (const [condId, mw] of marketWallets.entries()) {
        if (!mw.question || mw.question === condId) continue;

        const entries = Array.from(mw.wallets.values());
        if (entries.length === 0) continue;

        const yesE = entries.filter(e => e.side === "YES");
        const noE  = entries.filter(e => e.side === "NO");
        const dominant: typeof entries  = yesE.length >= noE.length ? yesE : noE;
        const side: "YES"|"NO" = yesE.length >= noE.length ? "YES" : "NO";

        if (dominant.length === 0) continue;

        // Quality gate: single-trader signals need either leaderboard status OR $2k+ bet
        if (dominant.length === 1) {
          const e = dominant[0];
          if (!e.traderInfo.isLeaderboard && e.totalSize < 2000) continue;
        }

        const consensusPct = entries.length > 1
          ? (dominant.length / entries.length) * 100 : 100;

        const avgROI     = dominant.reduce((s, e) => s + e.traderInfo.roi, 0) / dominant.length;
        const avgQuality = dominant.reduce((s, e) => s + e.traderInfo.qualityScore, 0) / dominant.length;
        const avgEntry   = dominant.reduce((s, e) => s + (e.prices.reduce((a, b) => a + b, 0) / e.prices.length), 0) / dominant.length;
        const avgSize    = dominant.reduce((s, e) => s + e.totalSize, 0) / dominant.length;
        const totalSize  = dominant.reduce((s, e) => s + e.totalSize, 0);
        const lbCount    = dominant.filter(e => e.traderInfo.isLeaderboard).length;

        // Fetch live CLOB midpoint using the tokenId from the trade's asset field
        let currentPrice = avgEntry; // fallback: use avg entry price
        const liveTokenId = side === "YES" ? mw.yesTokenId : mw.noTokenId;
        if (liveTokenId) {
          const mid = await fetchMidpoint(liveTokenId);
          if (mid !== null && mid > 0.01 && mid < 0.99) currentPrice = mid;
        }
        currentPrice = Math.min(0.99, Math.max(0.01, currentPrice));

        const valueDelta = side === "YES"
          ? (avgEntry - currentPrice - SLIPPAGE)
          : ((1 - avgEntry) - (1 - currentPrice) - SLIPPAGE);

        const { score: confidence, breakdown } = computeConfidence(
          avgROI, consensusPct, valueDelta, avgSize, dominant.length, avgQuality
        );

        const tier = dominant.length >= 3 && avgQuality >= 45 ? "HIGH"
                   : dominant.length >= 2 ? "MED" : "SINGLE";

        const id    = `elite-${condId}-${side}`;
        const isNew = !seenSignalIds.has(id) && confidence >= 55;
        seenSignalIds.add(id);

        const isSports = isSportsRelated(mw.question);
        const mType = categoriseMarket(mw.question, mw.endDate);

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
          totalNetUsdc: Math.round(totalSize),
          avgNetUsdc: Math.round(avgSize),
          traderCount: dominant.length,
          lbTraderCount: lbCount,
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
          })),
          category: isSports ? "sports" : "other",
          volume: 0,
          generatedAt: Date.now(),
          isValue: valueDelta > 0, isNew,
        });
      }

      signals.sort((a, b) => b.confidence - a.confidence);
      console.log(`[Elite] ${signals.length} signals (${signals.filter(s=>s.isSports).length} sports, ${signals.filter(s=>s.traderInfo?.isLeaderboard||s.lbTraderCount>0).length} lb-enriched)`);

      const response = {
        signals,
        topTraderCount: lbMap.size,
        marketsScanned: marketWallets.size,
        newSignalCount: signals.filter(s => s.isNew).length,
        fetchedAt: Date.now(),
        source: "large_bets_v10",
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

  // ── GET /api/signals/fast ─── Real-time consensus from recent trades ─────────
  app.get("/api/signals/fast", async (req, res) => {
    try {
      const cKey = "signals-fast-v4";
      const hit  = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      const [allTrades, rawMarkets] = await Promise.all([
        fetchRecentTrades(2000),
        fetchSportsMarkets(300),
      ]);

      // Build token map from raw markets (includes all token formats)
      const tokenMap = buildTokenMapFromRaw(rawMarkets);

      // Aggregate trades per conditionId+wallet
      type WalletPos = { side: "YES"|"NO"; totalSize: number; prices: number[]; name: string };
      const marketWallets = new Map<string, {
        info: ReturnType<typeof tokenMap.get>;
        wallets: Map<string, WalletPos>;
        endDate?: string;
      }>();

      for (const trade of allTrades) {
        const title = (trade.title || trade.slug || "").toLowerCase();
        if (!isSportsRelated(title)) continue;
        const condId = trade.conditionId || "";
        if (!condId) continue;
        const wallet = trade.proxyWallet || "";
        if (!wallet) continue;
        if (title.includes("up or down") && /\d+m/.test(title)) continue;

        const side: "YES"|"NO" = (trade.outcome === "Yes" || trade.outcomeIndex === 0) ? "YES" : "NO";
        const price = parseFloat(trade.price || "0.5");
        const size  = parseFloat(trade.size  || "0");

        if (!marketWallets.has(condId)) {
          let info: any = null;
          for (const [, mInfo] of tokenMap) {
            if (mInfo.conditionId === condId) { info = mInfo; break; }
          }
          marketWallets.set(condId, {
            info: info || { conditionId: condId, question: trade.title || condId, slug: trade.slug, currentPrice: 0.5, volume: 0, tokenIds: [] },
            wallets: new Map(),
            endDate: (info as any)?.endDate,
          });
        }
        const mw = marketWallets.get(condId)!;
        const ex  = mw.wallets.get(wallet);
        if (!ex) {
          mw.wallets.set(wallet, { side, totalSize: size, prices: [price], name: trade.pseudonym || truncAddr(wallet) });
        } else {
          if (ex.side === side) { ex.totalSize += size; ex.prices.push(price); }
          else if (size > ex.totalSize) { ex.side = side; ex.totalSize = size; ex.prices = [price]; }
        }
      }

      const signals: any[] = [];
      const SLIPPAGE = 0.02;

      for (const [condId, mw] of marketWallets.entries()) {
        const entries = Array.from(mw.wallets.values());
        if (entries.length === 0) continue;

        const yesE = entries.filter(e => e.side === "YES");
        const noE  = entries.filter(e => e.side === "NO");
        const dominant = yesE.length >= noE.length ? yesE : noE;
        const side: "YES"|"NO" = yesE.length >= noE.length ? "YES" : "NO";

        // Allow single-trader signals (lower confidence, still useful)
        if (dominant.length === 0) continue;
        const consensusPct = entries.length > 1
          ? (dominant.length / entries.length) * 100
          : 100; // single-trader: show as 100% but with reduced confidence

        // For single-trader: require decent trade size (>$100)
        if (dominant.length === 1) {
          const totalSize = dominant[0].totalSize;
          if (totalSize < 100) continue;
        }
        // For 2+ traders: no minimum size
        if (entries.length > 1 && dominant.length / entries.length < 0.5) continue;

        const avgEntry = dominant.reduce((s, e) => s + (e.prices.reduce((a, b) => a + b, 0) / e.prices.length), 0) / dominant.length;
        const avgSize  = dominant.reduce((s, e) => s + e.totalSize, 0) / dominant.length;

        const info = mw.info!;
        let currentPrice = (info as any).currentPrice ?? avgEntry;
        if ((info as any).tokenIds?.length > 0) {
          const mid = await fetchMidpoint((info as any).tokenIds[side === "YES" ? 0 : 1] || (info as any).tokenIds[0]);
          if (mid !== null && mid > 0) currentPrice = mid;
        }

        const valueDelta = side === "YES"
          ? (avgEntry - currentPrice - SLIPPAGE)
          : ((1 - avgEntry) - (1 - currentPrice) - SLIPPAGE);

        // Fast mode ROI is unknown — use 15% as proxy
        const { score: confidence, breakdown } = computeConfidence(
          15, consensusPct, valueDelta, avgSize, dominant.length, 40
        );

        const tier = dominant.length >= 3 ? "HIGH" : dominant.length >= 2 ? "MED" : "SINGLE";
        const marketType = categoriseMarket((info as any).question || condId, mw.endDate);

        signals.push({
          id: `fast-${condId}-${side}`,
          marketId: condId,
          marketQuestion: (info as any).question || condId,
          slug: (info as any).slug,
          outcome: side, side,
          confidence,
          tier,
          marketType,
          consensusPct: Math.round(consensusPct),
          valueDelta: Math.round(valueDelta * 1000) / 1000,
          currentPrice: Math.round(currentPrice * 1000) / 1000,
          avgEntryPrice: Math.round(avgEntry * 1000) / 1000,
          totalNetUsdc: Math.round(dominant.reduce((s, e) => s + e.totalSize * avgEntry, 0)),
          avgNetUsdc: Math.round(avgSize * avgEntry),
          traderCount: dominant.length,
          avgQuality: 40,
          scoreBreakdown: breakdown,
          traders: dominant.slice(0, 8).map(e => ({
            address: "",
            name: e.name,
            entryPrice: Math.round((e.prices.reduce((a, b) => a + b, 0) / e.prices.length) * 1000) / 1000,
            size: Math.round(e.totalSize),
            netUsdc: Math.round(e.totalSize * avgEntry),
            roi: 0, qualityScore: 0,
          })),
          category: (info as any).category || "sports",
          volume: (info as any).volume || 0,
          generatedAt: Date.now(),
          isValue: valueDelta > 0,
          isNew: false,
        });
      }

      const uniqueTraders = new Set(allTrades.map((t: any) => t.proxyWallet).filter(Boolean)).size;
      signals.sort((a, b) => b.confidence - a.confidence);

      const response = {
        signals,
        topTraderCount: uniqueTraders,
        marketsScanned: marketWallets.size,
        newSignalCount: 0,
        fetchedAt: Date.now(),
        source: "live_activity_v4",
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
      const rawMarkets = await fetchSportsMarkets(300);
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
