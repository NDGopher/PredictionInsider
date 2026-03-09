import type { Express } from "express";
import { createServer, type Server } from "http";

const GAMMA_API = "https://gamma-api.polymarket.com";
const DATA_API = "https://data-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";
const SUBGRAPH_URL =
  "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn";

// ─── Shared in-memory cache ───────────────────────────────────────────────────
const cache: Record<string, { data: unknown; ts: number; ttl: number }> = {};
function getCache<T>(key: string): T | null {
  const e = cache[key];
  if (!e || Date.now() - e.ts > e.ttl) return null;
  return e.data as T;
}
function setCache(key: string, data: unknown, ttlMs: number) {
  cache[key] = { data, ts: Date.now(), ttl: ttlMs };
}

// ─── High-confidence signal history for alert diffing ─────────────────────────
const seenSignalIds = new Set<string>();

// ─── Fetch helpers ────────────────────────────────────────────────────────────
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = 3
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; PredictionInsider/2.0)",
          ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(12000),
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 2500 * (i + 1)));
        continue;
      }
      return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error(`Failed after ${retries} retries`);
}

async function graphqlQuery(query: string): Promise<any> {
  try {
    const res = await fetchWithRetry(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SPORTS_KEYWORDS = [
  "nfl","nba","mlb","nhl","mls","ncaa","super bowl","world cup",
  "champions league","premier league","bundesliga","la liga","serie a",
  "playoff","championship","stanley cup","finals","semifinal","tournament",
  "ufc","boxing","tennis","golf","pga","wimbledon","us open",
  "f1","formula 1","nascar","olympics","world series",
  " vs "," vs.","match ","game ","season ","league ","draft ","transfer ",
  "quarterback","pitcher","goalkeeper","mvp","title bet","winner","beat the",
  "score ","goals ","touchdown","points ","atp","wta","bnp",
  "super bowl","stanley cup","nba finals","world series","champions league final",
];
function isSportsRelated(text: string): boolean {
  const t = (text || "").toLowerCase();
  return SPORTS_KEYWORDS.some((k) => t.includes(k));
}

function truncAddr(addr: string) {
  if (!addr || addr.length < 10) return addr || "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// Subgraph scale: avgPrice in 0–1_000_000 range; amount in 1e6 share units
const PRICE_SCALE = 1_000_000;
const AMOUNT_SCALE = 1_000_000;

/** Compute a quality score 0–100 for a leaderboard trader.
 *  Penalises: very low ROI (arbs), tiny PNL, single-position wonders.
 */
function traderQualityScore(pnl: number, roi: number, positionCount: number): number {
  const pnlScore = Math.min(pnl / 5_000_000, 1) * 100;   // max at $5M PNL
  const roiScore = Math.min(Math.max(roi, 0) / 80, 1) * 100; // max at 80% ROI
  const countScore = Math.min(positionCount / 20, 1) * 100;  // max at 20 positions
  return Math.round(pnlScore * 0.35 + roiScore * 0.45 + countScore * 0.20);
}

/** Confidence formula (spec-aligned):
 *  40% avg trader ROI, 30% consensus %, 20% value delta, 10% avg net size
 */
function computeConfidence(avgROI: number, consensusPct: number, valueDelta: number, avgNetUsdc: number): number {
  const roiScore   = Math.min(Math.max(avgROI / 80, 0), 1) * 100;
  const consScore  = Math.min(Math.max(consensusPct, 50), 100);
  const valueScore = valueDelta > 0 ? Math.min(valueDelta * 500, 100) : 0;
  const sizeScore  = Math.min(avgNetUsdc / 20_000, 1) * 100;  // max at $20k net
  return Math.round(roiScore * 0.40 + consScore * 0.30 + valueScore * 0.20 + sizeScore * 0.10);
}

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function fetchOfficialLeaderboard(timePeriod = "ALL", limit = 100): Promise<any[]> {
  const key = `lb-${timePeriod}-${limit}`;
  const hit = getCache<any[]>(key);
  if (hit) return hit;
  const res = await fetchWithRetry(
    `${DATA_API}/v1/leaderboard?timePeriod=${timePeriod}&orderBy=PNL&limit=${limit}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  const traders: any[] = Array.isArray(data) ? data : data.data || [];
  setCache(key, traders, 10 * 60 * 1000);
  return traders;
}

async function fetchSportsMarkets(limit = 200): Promise<any[]> {
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

async function fetchRecentTrades(limit = 1000): Promise<any[]> {
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
 * Build a map from tokenId (string) → market info for all sports markets.
 * Each token knows its conditionId, which outcome it is (Yes/No), and which index.
 */
function buildTokenMap(markets: any[]): Map<string, {
  conditionId: string; question: string; slug?: string;
  outcomeIndex: number; outcome: string; currentPrice: number;
  volume: number; category: string; tokenIds: string[];
}> {
  const map = new Map();
  for (const m of markets) {
    if (!isSportsRelated(m.question || m.title || "")) continue;
    let tokens: any[] = [];
    let prices: number[] = [];
    try { tokens = JSON.parse(m.tokens || "[]"); } catch {}
    try { prices = JSON.parse(m.outcomePrices || "[]").map(parseFloat); } catch {}
    const tokenIds = tokens.map((t: any) => String(t.token_id || t.tokenId)).filter(Boolean);
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
        tokenIds,
      });
    }
  }
  return map;
}

/**
 * Query subgraph for OPEN (amount > 0) positions in the given tokenIds
 * for the given elite trader addresses. Returns raw subgraph rows.
 */
async function fetchSubgraphPositions(
  addresses: string[],
  tokenIds: string[]
): Promise<any[]> {
  if (addresses.length === 0 || tokenIds.length === 0) return [];

  // Subgraph has a field size limit — split token IDs into batches of 200
  const TOKEN_BATCH = 200;
  const all: any[] = [];
  for (let i = 0; i < tokenIds.length; i += TOKEN_BATCH) {
    const batch = tokenIds.slice(i, i + TOKEN_BATCH);
    const addrList = addresses.map(a => `"${a.toLowerCase()}"`).join(",");
    const tokenList = batch.map(t => `"${t}"`).join(",");
    const query = `{
      userPositions(
        first: 1000,
        where: {
          user_in: [${addrList}],
          tokenId_in: [${tokenList}],
          amount_gt: "0"
        }
      ) {
        user tokenId amount avgPrice realizedPnl totalBought
      }
    }`;
    const resp = await graphqlQuery(query);
    const rows: any[] = resp?.data?.userPositions || [];
    all.push(...rows);
  }
  return all;
}

/**
 * Enriched per-trader ROI/count from subgraph (all their positions).
 */
async function fetchSubgraphROI(
  addresses: string[]
): Promise<Record<string, { roi: number; positionCount: number }>> {
  if (addresses.length === 0) return {};
  const key = `sg-roi-${addresses.slice(0, 3).join("-")}`;
  const hit = getCache<Record<string, { roi: number; positionCount: number }>>(key);
  if (hit) return hit;

  const addrList = addresses.slice(0, 40).map(a => `"${a.toLowerCase()}"`).join(",");
  const resp = await graphqlQuery(`{
    userPositions(first:1000, where:{user_in:[${addrList}]}) {
      user realizedPnl totalBought
    }
  }`);
  const rows: any[] = resp?.data?.userPositions || [];
  const agg: Record<string, { pnl: number; bought: number; count: number }> = {};
  for (const r of rows) {
    const addr = (r.user || "").toLowerCase();
    if (!agg[addr]) agg[addr] = { pnl: 0, bought: 0, count: 0 };
    agg[addr].pnl += parseFloat(r.realizedPnl || "0");
    agg[addr].bought += parseFloat(r.totalBought || "0");
    agg[addr].count++;
  }
  const result: Record<string, { roi: number; positionCount: number }> = {};
  for (const [addr, s] of Object.entries(agg)) {
    result[addr] = {
      roi: s.bought > 0 ? (s.pnl / s.bought) * 100 : 0,
      positionCount: s.count,
    };
  }
  setCache(key, result, 15 * 60 * 1000);
  return result;
}

// ─── Trader quality filtering ─────────────────────────────────────────────────

function isArbitrageur(pnl: number, vol: number): boolean {
  if (vol === 0) return false;
  const roiOnVol = pnl / vol;
  // Near-riskless ROI <2% on huge volume = likely arbitrageur
  return roiOnVol < 0.02 && vol > 5_000_000;
}

function isOneHitWonder(positionCount: number, pnl: number): boolean {
  // Only 1-2 subgraph positions but huge PNL = one lucky bet, not skilled
  return positionCount <= 2 && pnl > 2_000_000;
}

function isLikelyBot(t: any): boolean {
  const name = (t.userName || "").toLowerCase();
  const vol = parseFloat(t.vol || "0");
  const pnl = parseFloat(t.pnl || "0");
  if (name.startsWith("0x") && name.length > 30) return true;
  if (/^\d{10,}$/.test(name)) return true;
  if (vol > 2_000_000_000) return true;
  if (isArbitrageur(pnl, vol)) return true;
  return false;
}

// ─── Shared market parser ─────────────────────────────────────────────────────
function parseMarket(m: any) {
  let outcomePrices: number[] = [];
  let tokenIds: string[] = [];
  try { outcomePrices = JSON.parse(m.outcomePrices || "[]").map(parseFloat); } catch {}
  try {
    const toks = JSON.parse(m.tokens || "[]");
    tokenIds = toks.map((t: any) => String(t.token_id || t.tokenId)).filter(Boolean);
  } catch {}
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
      const period = (req.query.period as string) || "ALL";
      const limit  = Math.min(parseInt((req.query.limit as string) || "100"), 200);
      const cKey   = `traders-full-${period}-${limit}`;
      const hit    = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      const raw = await fetchOfficialLeaderboard(period, limit * 2);
      const addresses = raw.map((t: any) => (t.proxyWallet || "").toLowerCase()).filter(Boolean);
      const sgData = await fetchSubgraphROI(addresses);

      const traders = raw
        .filter((t: any) => !isLikelyBot(t))
        .map((t: any, i: number) => {
          const addr  = (t.proxyWallet || "").toLowerCase();
          const pnl   = parseFloat(t.pnl || "0");
          const vol   = parseFloat(t.vol || "0");
          const sg    = sgData[addr];
          const roi   = sg ? sg.roi : (vol > 0 ? (pnl / vol) * 100 : 0);
          const posC  = sg?.positionCount ?? 0;

          // Filter after enrichment
          if (isOneHitWonder(posC, pnl)) return null;

          const qualityScore = traderQualityScore(pnl, roi, posC);
          return {
            address: t.proxyWallet || "",
            name: t.userName || truncAddr(t.proxyWallet || ""),
            xUsername: t.xUsername || undefined,
            verifiedBadge: t.verifiedBadge || false,
            pnl,
            roi,
            positionCount: posC,
            winRate: 0,
            avgSize: posC > 0 ? vol / posC : 0,
            volume: vol,
            rank: parseInt(t.rank || String(i + 1)),
            qualityScore,
          };
        })
        .filter(Boolean)
        .slice(0, limit);

      const result = { traders, fetchedAt: Date.now(), window: period, source: "official_leaderboard_v2" };
      setCache(cKey, result, 10 * 60 * 1000);
      res.json(result);
    } catch (err: any) {
      console.error("Traders error:", err.message);
      res.status(500).json({ error: err.message, traders: [], fetchedAt: Date.now(), window: "ALL" });
    }
  });

  // ── GET /api/markets ────────────────────────────────────────────────────────
  app.get("/api/markets", async (req, res) => {
    try {
      const limit      = Math.min(parseInt((req.query.limit as string) || "100"), 200);
      const sportsOnly = req.query.sports !== "false";
      const raw = await fetchSportsMarkets(200);
      const markets = raw
        .map(parseMarket)
        .filter((m) => m.id && m.question && m.active && (!sportsOnly || isSportsRelated(m.question)));
      res.json({ markets: markets.slice(0, limit), fetchedAt: Date.now(), total: markets.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message, markets: [], fetchedAt: Date.now(), total: 0 });
    }
  });

  // ── GET /api/signals ─── Elite leaderboard signals via subgraph positions ───
  app.get("/api/signals", async (req, res) => {
    try {
      const cKey = "signals-elite-v4";
      const hit  = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      // 1. Top 50 elite traders
      const [rawLb, rawMarkets] = await Promise.all([
        fetchOfficialLeaderboard("ALL", 100),
        fetchSportsMarkets(200),
      ]);

      const addresses = rawLb
        .filter((t: any) => !isLikelyBot(t))
        .map((t: any) => (t.proxyWallet || "").toLowerCase())
        .filter(Boolean)
        .slice(0, 50);

      const sgROI = await fetchSubgraphROI(addresses);

      // Build trader map with quality scores
      const traderMap: Record<string, { name: string; pnl: number; roi: number; positionCount: number; qualityScore: number }> = {};
      for (const t of rawLb) {
        const addr  = (t.proxyWallet || "").toLowerCase();
        if (!addresses.includes(addr)) continue;
        const pnl   = parseFloat(t.pnl || "0");
        const vol   = parseFloat(t.vol || "0");
        const sg    = sgROI[addr];
        const roi   = sg ? sg.roi : (vol > 0 ? (pnl / vol) * 100 : 0);
        const posC  = sg?.positionCount ?? 0;
        if (isOneHitWonder(posC, pnl)) continue;
        traderMap[addr] = {
          name: t.userName || truncAddr(t.proxyWallet || ""),
          pnl,
          roi,
          positionCount: posC,
          qualityScore: traderQualityScore(pnl, roi, posC),
        };
      }

      // 2. Build token → market info map for all sports markets
      const tokenMap = buildTokenMap(rawMarkets);
      const allTokenIds = Array.from(tokenMap.keys());
      const qualifiedAddresses = Object.keys(traderMap);

      // 3. Query subgraph for open sports positions held by elite traders
      const subgraphRows = await fetchSubgraphPositions(qualifiedAddresses, allTokenIds);

      // 4. Aggregate: per (conditionId, user, side) → net position
      // The subgraph already aggregates per tokenId, so we just group by conditionId+user
      type AggPosition = {
        netShares: number;   // shares held (amount / AMOUNT_SCALE)
        avgPrice: number;    // cost basis (avgPrice / PRICE_SCALE)
        netUsdc: number;     // approximate net USDC invested
        side: "YES" | "NO";
        traderInfo: typeof traderMap[string];
        address: string;
      };

      const marketPositions = new Map<string, {
        info: ReturnType<typeof tokenMap.get>;
        yesPositions: AggPosition[];
        noPositions: AggPosition[];
      }>();

      for (const row of subgraphRows) {
        const tokenId   = String(row.tokenId);
        const mInfo     = tokenMap.get(tokenId);
        if (!mInfo) continue;

        const addr      = (row.user || "").toLowerCase();
        const trader    = traderMap[addr];
        if (!trader) continue;

        const netShares = parseFloat(row.amount) / AMOUNT_SCALE;
        const avgPrice  = parseFloat(row.avgPrice) / PRICE_SCALE;
        const netUsdc   = netShares * avgPrice; // USDC invested in this position

        if (netShares < 1 || avgPrice < 0.01 || avgPrice > 0.99) continue; // dust / invalid

        const side: "YES" | "NO" = mInfo.outcomeIndex === 0 ? "YES" : "NO";
        const condId = mInfo.conditionId;

        if (!marketPositions.has(condId)) {
          marketPositions.set(condId, { info: mInfo, yesPositions: [], noPositions: [] });
        }
        const mp = marketPositions.get(condId)!;
        const pos: AggPosition = { netShares, avgPrice, netUsdc, side, traderInfo: trader, address: addr };
        if (side === "YES") mp.yesPositions.push(pos);
        else mp.noPositions.push(pos);
      }

      // 5. Generate signals
      const signals: any[] = [];
      const newSignalIds: string[] = [];

      for (const [condId, mp] of marketPositions.entries()) {
        const total    = mp.yesPositions.length + mp.noPositions.length;
        if (total < 2) continue;

        const yPct = (mp.yesPositions.length / total) * 100;
        const nPct = (mp.noPositions.length / total) * 100;
        const dominant = yPct >= nPct ? mp.yesPositions : mp.noPositions;
        const side: "YES" | "NO" = yPct >= nPct ? "YES" : "NO";
        const consensusPct = Math.max(yPct, nPct);

        if (consensusPct < 55 || dominant.length < 2) continue;

        const avgROI       = dominant.reduce((s, p) => s + p.traderInfo.roi, 0) / dominant.length;
        const avgEntryPrice = dominant.reduce((s, p) => s + p.avgPrice, 0) / dominant.length;
        const totalNetUsdc = dominant.reduce((s, p) => s + p.netUsdc, 0);
        const avgNetUsdc   = totalNetUsdc / dominant.length;

        const info = mp.info!;
        let currentPrice = info.currentPrice ?? 0.5;

        // Fetch live midpoint for the dominant side's token
        if (info.tokenIds?.length > 0) {
          const tokenIdx = side === "YES" ? 0 : 1;
          const mid = await fetchMidpoint(info.tokenIds[tokenIdx] || info.tokenIds[0]);
          if (mid !== null && mid > 0) currentPrice = mid;
        }

        const SLIPPAGE = 0.02;
        const valueDelta = side === "YES"
          ? (avgEntryPrice - currentPrice - SLIPPAGE)
          : ((1 - avgEntryPrice) - (1 - currentPrice) - SLIPPAGE);

        const confidence = computeConfidence(avgROI, consensusPct, valueDelta, avgNetUsdc);
        const id = `elite-${condId}-${side}`;
        const isNew = !seenSignalIds.has(id) && confidence >= 70;
        if (isNew) newSignalIds.push(id);
        seenSignalIds.add(id);

        signals.push({
          id,
          marketId: condId,
          marketQuestion: info.question,
          slug: info.slug,
          outcome: side,
          side,
          confidence,
          consensusPct: Math.round(consensusPct),
          valueDelta: Math.round(valueDelta * 1000) / 1000,
          currentPrice: Math.round(currentPrice * 1000) / 1000,
          avgEntryPrice: Math.round(avgEntryPrice * 1000) / 1000,
          totalNetUsdc: Math.round(totalNetUsdc),
          avgNetUsdc: Math.round(avgNetUsdc),
          traderCount: dominant.length,
          traders: dominant.slice(0, 5).map((p) => ({
            address: p.address,
            name: p.traderInfo.name,
            entryPrice: Math.round(p.avgPrice * 1000) / 1000,
            size: Math.round(p.netShares),
            netUsdc: Math.round(p.netUsdc),
            roi: Math.round(p.traderInfo.roi * 10) / 10,
            qualityScore: p.traderInfo.qualityScore,
          })),
          category: info.category,
          volume: info.volume,
          generatedAt: Date.now(),
          isValue: valueDelta > 0,
          isNew,
        });
      }

      signals.sort((a, b) => b.confidence - a.confidence);

      const response = {
        signals,
        topTraderCount: qualifiedAddresses.length,
        marketsScanned: tokenMap.size / 2,  // divide by 2 since YES+NO both counted
        newSignalCount: newSignalIds.length,
        fetchedAt: Date.now(),
        source: "subgraph_elite_v4",
      };

      setCache(cKey, response, 5 * 60 * 1000);
      res.json(response);
    } catch (err: any) {
      console.error("Signals error:", err.message);
      res.status(500).json({
        error: err.message, signals: [], topTraderCount: 0, marketsScanned: 0, fetchedAt: Date.now(),
      });
    }
  });

  // ── GET /api/signals/fast ─── Real-time consensus from recent trades ─────────
  app.get("/api/signals/fast", async (req, res) => {
    try {
      const cKey = "signals-fast-v3";
      const hit  = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      const [allTrades, rawMarkets] = await Promise.all([
        fetchRecentTrades(1000),
        fetchSportsMarkets(200),
      ]);

      const tokenMap = buildTokenMap(rawMarkets);

      // Filter to sports trades only and aggregate per wallet+conditionId
      type WalletPosition = { side: "YES"|"NO"; totalSize: number; prices: number[]; name: string };
      const marketWallets = new Map<string, {
        info: ReturnType<typeof tokenMap.get>;
        wallets: Map<string, WalletPosition>;
      }>();

      for (const trade of allTrades) {
        const title = (trade.title || trade.slug || "").toLowerCase();
        if (!isSportsRelated(title)) continue;

        const condId = trade.conditionId || "";
        if (!condId) continue;
        const wallet = trade.proxyWallet || "";
        if (!wallet) continue;

        // Skip obvious noise: crypto up/down short-term bets
        if (title.includes("up or down") && (title.includes("5m") || title.includes("15m") || title.includes("1h"))) continue;

        const side: "YES"|"NO" = (trade.outcome === "Yes" || trade.outcomeIndex === 0) ? "YES" : "NO";
        const price = parseFloat(trade.price || "0.5");
        const size  = parseFloat(trade.size  || "0");

        if (!marketWallets.has(condId)) {
          // Try to find market info from token map via conditionId
          let info: any = null;
          for (const [, mInfo] of tokenMap) {
            if (mInfo.conditionId === condId) { info = mInfo; break; }
          }
          marketWallets.set(condId, {
            info: info || { conditionId: condId, question: trade.title || condId, slug: trade.slug, currentPrice: 0.5, volume: 0, tokenIds: [] },
            wallets: new Map(),
          });
        }
        const mw = marketWallets.get(condId)!;
        const existing = mw.wallets.get(wallet);
        if (!existing) {
          mw.wallets.set(wallet, { side, totalSize: size, prices: [price], name: trade.pseudonym || truncAddr(wallet) });
        } else {
          // Accumulate same-side, or override if new side has larger size
          if (existing.side === side) {
            existing.totalSize += size;
            existing.prices.push(price);
          } else if (size > existing.totalSize) {
            // Trader flipped or sells — use net dominant position
            existing.side = side;
            existing.totalSize = size;
            existing.prices = [price];
          }
        }
      }

      const signals: any[] = [];
      for (const [condId, mw] of marketWallets.entries()) {
        const entries = Array.from(mw.wallets.values());
        if (entries.length < 2) continue;

        const yesE = entries.filter(e => e.side === "YES");
        const noE  = entries.filter(e => e.side === "NO");
        const side: "YES"|"NO" = yesE.length >= noE.length ? "YES" : "NO";
        const dominant = side === "YES" ? yesE : noE;
        const consensusPct = (dominant.length / entries.length) * 100;
        if (consensusPct < 60 || dominant.length < 2) continue;

        const avgEntry  = dominant.reduce((s, e) => s + (e.prices.reduce((a, b) => a + b, 0) / e.prices.length), 0) / dominant.length;
        const avgSize   = dominant.reduce((s, e) => s + e.totalSize, 0) / dominant.length;

        const info = mw.info!;
        let currentPrice = info.currentPrice ?? avgEntry;
        if ((info as any).tokenIds?.length > 0) {
          const mid = await fetchMidpoint((info as any).tokenIds[side === "YES" ? 0 : 1] || (info as any).tokenIds[0]);
          if (mid !== null && mid > 0) currentPrice = mid;
        }

        const valueDelta = side === "YES"
          ? (avgEntry - currentPrice - 0.02)
          : ((1 - avgEntry) - (1 - currentPrice) - 0.02);

        const confidence = computeConfidence(15, consensusPct, valueDelta, avgSize);

        signals.push({
          id: `fast-${condId}-${side}`,
          marketId: condId,
          marketQuestion: (info as any).question || condId,
          slug: (info as any).slug,
          outcome: side,
          side,
          confidence,
          consensusPct: Math.round(consensusPct),
          valueDelta: Math.round(valueDelta * 1000) / 1000,
          currentPrice: Math.round(currentPrice * 1000) / 1000,
          avgEntryPrice: Math.round(avgEntry * 1000) / 1000,
          totalNetUsdc: Math.round(dominant.reduce((s, e) => s + e.totalSize * avgEntry, 0)),
          avgNetUsdc: Math.round(avgSize * avgEntry),
          traderCount: dominant.length,
          traders: dominant.slice(0, 5).map(e => ({
            address: "",
            name: e.name,
            entryPrice: Math.round((e.prices.reduce((a, b) => a + b, 0) / e.prices.length) * 1000) / 1000,
            size: Math.round(e.totalSize),
            netUsdc: Math.round(e.totalSize * avgEntry),
            roi: 0,
            qualityScore: 0,
          })),
          category: (info as any).category || "sports",
          volume: (info as any).volume || 0,
          generatedAt: Date.now(),
          isValue: valueDelta > 0,
          isNew: false,
        });
      }

      const uniqueTraders = new Set(allTrades.map((t: any) => t.proxyWallet).filter(Boolean)).size;
      const sportsTradeCount = new Set(Array.from(marketWallets.keys())).size;
      signals.sort((a, b) => b.confidence - a.confidence);
      const response = {
        signals, topTraderCount: uniqueTraders,
        marketsScanned: sportsTradeCount,
        newSignalCount: 0, fetchedAt: Date.now(), source: "live_activity_v3",
      };
      setCache(cKey, response, 90_000);
      res.json(response);
    } catch (err: any) {
      console.error("Fast signals error:", err.message);
      res.status(500).json({ error: err.message, signals: [], topTraderCount: 0, marketsScanned: 0, fetchedAt: Date.now() });
    }
  });

  // ── GET /api/trader/:address/positions ─── Aggregate positions for one trader
  app.get("/api/trader/:address/positions", async (req, res) => {
    try {
      const addr = req.params.address.toLowerCase();
      const cKey = `trader-pos-${addr}`;
      const hit  = getCache<unknown>(cKey);
      if (hit) { res.json(hit); return; }

      const rawMarkets = await fetchSportsMarkets(200);
      const tokenMap   = buildTokenMap(rawMarkets);
      const allTokenIds = Array.from(tokenMap.keys());

      const rows = await fetchSubgraphPositions([addr], allTokenIds);

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

  // ── GET /api/market/:tokenId/price ──────────────────────────────────────────
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

