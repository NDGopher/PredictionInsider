import type { Express } from "express";
import { createServer, type Server } from "http";

const GAMMA_API = "https://gamma-api.polymarket.com";
const DATA_API = "https://data-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";
const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn";
const KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2";

const cache: Record<string, { data: unknown; ts: number; ttl: number }> = {};

function getCache<T>(key: string): T | null {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) return null;
  return entry.data as T;
}

function setCache(key: string, data: unknown, ttlMs: number) {
  cache[key] = { data, ts: Date.now(), ttl: ttlMs };
}

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
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; PredictionInsider/1.0)",
          ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(12000),
      });
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2500 * (i + 1)));
        continue;
      }
      return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error(`Failed after ${retries} retries: ${url}`);
}

/** --- Polymarket Official Leaderboard (v1) --- */
async function fetchOfficialLeaderboard(timePeriod: string = "ALL", limit = 100) {
  const cacheKey = `v1-leaderboard-${timePeriod}-${limit}`;
  const cached = getCache<unknown[]>(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({ timePeriod, orderBy: "PNL", limit: String(limit) });
  const res = await fetchWithRetry(`${DATA_API}/v1/leaderboard?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  const traders = Array.isArray(data) ? data : (data.data || []);
  setCache(cacheKey, traders, 10 * 60 * 1000);
  return traders;
}

/** --- Subgraph: enriched PNL/ROI for a batch of wallet addresses --- */
async function fetchSubgraphROI(addresses: string[]): Promise<Record<string, { roi: number; tradesCount: number }>> {
  if (addresses.length === 0) return {};
  const cacheKey = `subgraph-roi-${addresses.slice(0, 5).join("-")}`;
  const cached = getCache<Record<string, { roi: number; tradesCount: number }>>(cacheKey);
  if (cached) return cached;

  const addressFilter = addresses.slice(0, 30).map(a => `"${a.toLowerCase()}"`).join(",");
  const query = `{
    userPositions(
      first: 1000,
      orderBy: realizedPnl,
      orderDirection: desc,
      where: { user_in: [${addressFilter}] }
    ) {
      user
      realizedPnl
      totalBought
    }
  }`;

  try {
    const res = await fetchWithRetry(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const positions: any[] = data?.data?.userPositions || [];

    const roiMap: Record<string, { totalPnl: number; totalBought: number; count: number }> = {};
    for (const pos of positions) {
      const addr = (pos.user || "").toLowerCase();
      const pnl = parseFloat(pos.realizedPnl || "0");
      const bought = parseFloat(pos.totalBought || "0");
      if (!roiMap[addr]) roiMap[addr] = { totalPnl: 0, totalBought: 0, count: 0 };
      roiMap[addr].totalPnl += pnl;
      roiMap[addr].totalBought += bought;
      roiMap[addr].count += 1;
    }

    const result: Record<string, { roi: number; tradesCount: number }> = {};
    for (const [addr, stats] of Object.entries(roiMap)) {
      const roi = stats.totalBought > 0 ? (stats.totalPnl / stats.totalBought) * 100 : 0;
      result[addr] = { roi, tradesCount: stats.count };
    }

    setCache(cacheKey, result, 15 * 60 * 1000);
    return result;
  } catch (e) {
    return {};
  }
}

/** --- Polymarket User Positions --- */
async function fetchUserPositions(address: string) {
  const cacheKey = `positions-${address}`;
  const cached = getCache<unknown[]>(cacheKey);
  if (cached) return cached;

  const res = await fetchWithRetry(`${DATA_API}/positions?user=${address}&limit=100&sizeThreshold=.1`);
  if (!res.ok) return [];
  const data = await res.json();
  const positions = Array.isArray(data) ? data : (data.data || []);
  setCache(cacheKey, positions, 5 * 60 * 1000);
  return positions;
}

/** --- Polymarket Sports Markets (Gamma) --- */
async function fetchSportsMarkets(limit = 150) {
  const cacheKey = `sports-markets-${limit}`;
  const cached = getCache<unknown[]>(cacheKey);
  if (cached) return cached;

  const res = await fetchWithRetry(`${GAMMA_API}/markets?active=true&closed=false&limit=${limit}`);
  if (!res.ok) return [];
  const data = await res.json();
  const markets = Array.isArray(data) ? data : (data.data || []);
  setCache(cacheKey, markets, 3 * 60 * 1000);
  return markets;
}

/** --- Kalshi Markets (sports/politics/general) --- */
async function fetchKalshiMarkets(limit = 100) {
  const cacheKey = `kalshi-markets-${limit}`;
  const cached = getCache<unknown[]>(cacheKey);
  if (cached) return cached;

  const endpoints = [
    `${KALSHI_API}/markets?limit=${limit}&status=open`,
    `${KALSHI_API}/markets?limit=${limit}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetchWithRetry(url);
      if (!res.ok) continue;
      const data = await res.json();
      const markets = Array.isArray(data) ? data : (data.markets || data.data || []);
      if (markets.length > 0) {
        setCache(cacheKey, markets, 5 * 60 * 1000);
        return markets;
      }
    } catch {
      continue;
    }
  }

  setCache(cacheKey, [], 5 * 60 * 1000);
  return [];
}

/** --- CLOB Midpoint --- */
async function fetchMarketMidpoint(tokenId: string): Promise<number | null> {
  const cacheKey = `midpoint-${tokenId}`;
  const cached = getCache<number>(cacheKey);
  if (cached !== null) return cached;

  try {
    const res = await fetchWithRetry(`${CLOB_API}/midpoint?token_id=${tokenId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const mid = parseFloat(data.mid || data.midpoint || "0");
    if (!isNaN(mid) && mid > 0) {
      setCache(cacheKey, mid, 60 * 1000);
      return mid;
    }
  } catch { }
  return null;
}

/** --- Recent Trades (fallback for active trader detection) --- */
async function fetchRecentTrades(limit = 500) {
  const cacheKey = `recent-trades-${limit}`;
  const cached = getCache<unknown[]>(cacheKey);
  if (cached) return cached;

  const res = await fetchWithRetry(`${DATA_API}/trades?limit=${limit}`);
  if (!res.ok) return [];
  const data = await res.json();
  const trades = Array.isArray(data) ? data : (data.data || []);
  setCache(cacheKey, trades, 2 * 60 * 1000);
  return trades;
}

/** --- Helpers --- */
const SPORTS_KEYWORDS = [
  "nfl", "nba", "mlb", "nhl", "mls", "ncaa", "super bowl", "world cup",
  "champions league", "premier league", "bundesliga", "la liga", "serie a",
  "playoff", "championship", "stanley cup", "finals", "semifinal", "tournament",
  "ufc", "boxing", "tennis", "golf", "pga", "wimbledon", "us open",
  "f1", "formula 1", "nascar", "olympics", "world series",
  "win the", "beat the", "score", "touchdown", "goal", "mvp", "title",
  "season", "league", "team vs", " vs ", "match", "game",
  "quarterback", "pitcher", "forward", "goalkeeper", "transfer", "draft",
  "bnp", "atp", "wta", "open de france", "serie", "bundesliga",
];

function isSportsRelated(text: string): boolean {
  const t = (text || "").toLowerCase();
  return SPORTS_KEYWORDS.some(k => t.includes(k));
}

function isLikelyBot(trader: any): boolean {
  const name = (trader.userName || trader.name || "").toLowerCase();
  const addr = (trader.proxyWallet || trader.address || "").toLowerCase();
  if (name.startsWith("0x") && name.length > 30) return true;
  if (/^\d{10,}$/.test(name)) return true;
  const vol = parseFloat(trader.vol || trader.volume || "0");
  const pnl = parseFloat(trader.pnl || "0");
  if (vol > 1_000_000_000) return true;
  if (Math.abs(pnl / (vol || 1)) > 0.8) return true;
  return false;
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr || "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Confidence score formula:
 * 40% trader ROI (normalized), 30% consensus strength, 20% value delta, 10% position size
 */
function computeConfidence(
  avgROI: number,
  consensusPct: number,
  valueDelta: number,
  avgSize: number
): number {
  const roiScore = Math.min(Math.max((avgROI / 100) * 100, 0), 100);
  const consensusScore = Math.min(Math.max(consensusPct, 0), 100);
  const valueScore = valueDelta > 0 ? Math.min(valueDelta * 400, 100) : 0;
  const sizeScore = Math.min((avgSize / 200) * 100, 100);
  return Math.round(roiScore * 0.4 + consensusScore * 0.3 + valueScore * 0.2 + sizeScore * 0.1);
}

function parseMarket(m: any) {
  let outcomePrices: number[] = [];
  try { outcomePrices = JSON.parse(m.outcomePrices || "[]").map(parseFloat); } catch { }
  let tokenIds: string[] = [];
  try {
    const tokens = JSON.parse(m.tokens || "[]");
    tokenIds = tokens.map((t: any) => t.token_id || t.tokenId).filter(Boolean);
  } catch { }
  return {
    id: m.id || m.conditionId || "",
    question: m.question || m.title || "",
    slug: m.slug || undefined,
    category: m.groupItemTagSlug || m.category || "other",
    currentPrice: outcomePrices[0] ?? 0.5,
    volume: parseFloat(m.volume || m.volumeNum || "0"),
    liquidity: parseFloat(m.liquidity || m.liquidityNum || "0"),
    endDate: m.endDate || undefined,
    active: m.active !== false && m.closed !== true,
    traderCount: parseInt(m.uniqueTraders || m.traderCount || "0"),
    conditionId: m.conditionId || m.id || "",
    tokenIds,
  };
}

function parseKalshiMarket(m: any) {
  const yesPrice = parseFloat(m.yes_bid || m.yes_ask || m.last_price || "0.5");
  return {
    id: m.ticker || m.market_ticker || "",
    question: m.title || m.question || "",
    slug: m.ticker || undefined,
    category: (m.event_category || m.series_ticker || "other").toLowerCase(),
    currentPrice: yesPrice / 100,
    volume: parseFloat(m.volume || m.dollar_volume || "0"),
    liquidity: parseFloat(m.liquidity || m.open_interest || "0"),
    endDate: m.close_time || undefined,
    active: m.status === "open" || m.active === true,
    traderCount: 0,
    conditionId: m.ticker || "",
    tokenIds: [],
    source: "kalshi" as const,
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  /** GET /api/traders — Leaderboard with subgraph ROI enrichment */
  app.get("/api/traders", async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || "100"), 200);
      const cached = getCache<unknown>(`traders-v2-${limit}`);
      if (cached) { res.json(cached); return; }

      const timePeriod = (req.query.period as string) || "ALL";
      const rawLeaderboard = await fetchOfficialLeaderboard(timePeriod, Math.min(limit * 2, 200));

      const filtered = rawLeaderboard
        .filter((t: any) => !isLikelyBot(t))
        .slice(0, limit);

      const addresses = filtered.map((t: any) => (t.proxyWallet || "").toLowerCase()).filter(Boolean);
      const subgraphData = await fetchSubgraphROI(addresses);

      const traders = filtered.map((t: any, i: number) => {
        const addr = (t.proxyWallet || "").toLowerCase();
        const pnl = parseFloat(t.pnl || "0");
        const vol = parseFloat(t.vol || "0");
        const subgraph = subgraphData[addr];
        const roiFromLeaderboard = vol > 0 ? (pnl / vol) * 100 : 0;
        const roiFromSubgraph = subgraph?.roi ?? null;
        const roi = roiFromSubgraph !== null ? roiFromSubgraph : roiFromLeaderboard;

        return {
          address: t.proxyWallet || "",
          name: t.userName || truncateAddress(t.proxyWallet || ""),
          xUsername: t.xUsername || undefined,
          verifiedBadge: t.verifiedBadge || false,
          pnl,
          roi,
          tradesCount: subgraph?.tradesCount ?? 0,
          winRate: 0,
          avgSize: subgraph?.tradesCount ? vol / subgraph.tradesCount : 0,
          volume: vol,
          rank: parseInt(t.rank || String(i + 1)),
        };
      });

      const result = {
        traders,
        fetchedAt: Date.now(),
        window: timePeriod,
        source: "official_leaderboard",
      };
      setCache(`traders-v2-${limit}`, result, 10 * 60 * 1000);
      res.json(result);
    } catch (err: any) {
      console.error("Traders error:", err.message);
      res.status(500).json({ error: err.message, traders: [], fetchedAt: Date.now(), window: "ALL" });
    }
  });

  /** GET /api/markets — Polymarket + Kalshi sports markets */
  app.get("/api/markets", async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || "100"), 200);
      const includeKalshi = req.query.kalshi !== "false";
      const sportsOnly = req.query.sports !== "false";

      const [rawPoly, rawKalshi] = await Promise.all([
        fetchSportsMarkets(200),
        includeKalshi ? fetchKalshiMarkets(100) : Promise.resolve([]),
      ]);

      const polyMarkets = rawPoly
        .map(parseMarket)
        .filter(m => m.id && m.question && m.active && (!sportsOnly || isSportsRelated(m.question)));

      const kalshiMarkets = rawKalshi
        .map(parseKalshiMarket)
        .filter((m: any) => m.id && m.question && m.active && (!sportsOnly || isSportsRelated(m.question)));

      const markets = [...polyMarkets, ...kalshiMarkets].slice(0, limit);

      res.json({
        markets,
        fetchedAt: Date.now(),
        total: markets.length,
        polymarketCount: polyMarkets.length,
        kalshiCount: kalshiMarkets.length,
      });
    } catch (err: any) {
      console.error("Markets error:", err.message);
      res.status(500).json({ error: err.message, markets: [], fetchedAt: Date.now(), total: 0 });
    }
  });

  /** GET /api/signals — Consensus signals from elite traders */
  app.get("/api/signals", async (req, res) => {
    try {
      const cacheKey = "signals-v3";
      const cached = getCache<unknown>(cacheKey);
      if (cached) { res.json(cached); return; }

      const [rawLeaderboard, rawMarkets] = await Promise.all([
        fetchOfficialLeaderboard("ALL", 100),
        fetchSportsMarkets(200),
      ]);

      const eliteTraders = rawLeaderboard
        .filter((t: any) => !isLikelyBot(t))
        .slice(0, 50);

      const addresses = eliteTraders.map((t: any) => (t.proxyWallet || "").toLowerCase()).filter(Boolean);
      const subgraphData = await fetchSubgraphROI(addresses);

      const tradersWithROI = eliteTraders.map((t: any) => {
        const addr = (t.proxyWallet || "").toLowerCase();
        const pnl = parseFloat(t.pnl || "0");
        const vol = parseFloat(t.vol || "0");
        const sub = subgraphData[addr];
        const roi = sub?.roi ?? (vol > 0 ? (pnl / vol) * 100 : 0);
        return {
          address: t.proxyWallet || "",
          name: t.userName || truncateAddress(t.proxyWallet || ""),
          pnl,
          vol,
          roi,
          tradesCount: sub?.tradesCount ?? 0,
        };
      });

      const sportsMarketMap = new Map<string, any>();
      for (const m of rawMarkets) {
        const parsed = parseMarket(m);
        if (parsed.id && isSportsRelated(parsed.question)) {
          sportsMarketMap.set(parsed.conditionId, parsed);
        }
      }

      const positionResults = await Promise.allSettled(
        tradersWithROI.slice(0, 30).map(t => fetchUserPositions(t.address))
      );

      const marketActivityMap = new Map<string, {
        yesTraders: Array<{ trader: any; price: number; size: number }>;
        noTraders: Array<{ trader: any; price: number; size: number }>;
        marketInfo: any;
      }>();

      positionResults.forEach((result, idx) => {
        if (result.status !== "fulfilled") return;
        const positions = result.value as any[];
        const trader = tradersWithROI[idx];

        for (const pos of positions) {
          const condId = pos.conditionId || pos.marketId || pos.market || "";
          if (!condId) continue;
          const title = pos.title || pos.question || condId;
          if (!isSportsRelated(title)) continue;

          const marketInfo = sportsMarketMap.get(condId) || {
            id: condId,
            question: title,
            slug: pos.slug || pos.eventSlug,
            category: "sports",
            currentPrice: 0.5,
            volume: 0,
            tokenIds: [],
          };

          if (!marketActivityMap.has(condId)) {
            marketActivityMap.set(condId, { yesTraders: [], noTraders: [], marketInfo });
          }

          const activity = marketActivityMap.get(condId)!;
          const curPrice = parseFloat(pos.curPrice || "0.5");
          const size = parseFloat(pos.size || pos.sharesOwned || "0");
          const outcomeIdx = parseInt(pos.outcomeIndex ?? (curPrice > 0.5 ? 0 : 1));
          const isYes = outcomeIdx === 0;

          const entry = { trader, price: curPrice, size };
          if (isYes) {
            activity.yesTraders.push(entry);
          } else {
            activity.noTraders.push(entry);
          }
        }
      });

      const signals: any[] = [];

      for (const [condId, activity] of marketActivityMap.entries()) {
        const total = activity.yesTraders.length + activity.noTraders.length;
        if (total < 2) continue;

        const yesPct = (activity.yesTraders.length / total) * 100;
        const noPct = (activity.noTraders.length / total) * 100;

        const dominant = yesPct >= noPct ? activity.yesTraders : activity.noTraders;
        const side: "YES" | "NO" = yesPct >= noPct ? "YES" : "NO";
        const consensusPct = Math.max(yesPct, noPct);

        if (consensusPct < 55 || dominant.length < 2) continue;

        const avgEntryPrice = dominant.reduce((s, e) => s + e.price, 0) / dominant.length;
        const avgSize = dominant.reduce((s, e) => s + e.size, 0) / dominant.length;
        const avgROI = dominant.reduce((s, e) => s + e.trader.roi, 0) / dominant.length;

        const { marketInfo } = activity;
        let currentPrice = marketInfo.currentPrice ?? 0.5;

        if (marketInfo.tokenIds?.length > 0) {
          const tokenIdx = side === "YES" ? 0 : 1;
          const tokenId = marketInfo.tokenIds[tokenIdx] || marketInfo.tokenIds[0];
          const mid = await fetchMarketMidpoint(tokenId);
          if (mid !== null && mid > 0) currentPrice = mid;
        }

        const slippage = 0.02;
        const valueDelta = side === "YES"
          ? (avgEntryPrice - currentPrice - slippage)
          : ((1 - avgEntryPrice) - (1 - currentPrice) - slippage);

        const confidence = computeConfidence(avgROI, consensusPct, valueDelta, avgSize);

        signals.push({
          id: `${condId}-${side}`,
          marketId: condId,
          marketQuestion: marketInfo.question,
          slug: marketInfo.slug,
          outcome: side,
          side,
          confidence,
          consensusPct: Math.round(consensusPct),
          valueDelta: Math.round(valueDelta * 1000) / 1000,
          currentPrice: Math.round(currentPrice * 1000) / 1000,
          avgEntryPrice: Math.round(avgEntryPrice * 1000) / 1000,
          traderCount: dominant.length,
          traders: dominant.slice(0, 5).map(e => ({
            address: e.trader.address,
            name: e.trader.name,
            entryPrice: e.price,
            size: e.size,
            roi: e.trader.roi,
          })),
          category: marketInfo.category,
          volume: marketInfo.volume,
          generatedAt: Date.now(),
          isValue: valueDelta > 0,
        });
      }

      signals.sort((a, b) => b.confidence - a.confidence);

      const response = {
        signals,
        topTraderCount: tradersWithROI.length,
        marketsScanned: sportsMarketMap.size,
        fetchedAt: Date.now(),
        source: "official_leaderboard_v2",
      };

      setCache(cacheKey, response, 5 * 60 * 1000);
      res.json(response);
    } catch (err: any) {
      console.error("Signals error:", err.message);
      res.status(500).json({
        error: err.message,
        signals: [],
        topTraderCount: 0,
        marketsScanned: 0,
        fetchedAt: Date.now(),
      });
    }
  });

  /** GET /api/signals/fast — Quick signals from recent trade activity */
  app.get("/api/signals/fast", async (req, res) => {
    try {
      const cacheKey = "signals-fast-v2";
      const cached = getCache<unknown>(cacheKey);
      if (cached) { res.json(cached); return; }

      const [sportsTrades, rawMarkets] = await Promise.all([
        fetchRecentTrades(1000),
        fetchSportsMarkets(200),
      ]);

      const sportsMarketMap = new Map<string, any>();
      for (const m of rawMarkets) {
        const parsed = parseMarket(m);
        if (parsed.id && isSportsRelated(parsed.question)) {
          sportsMarketMap.set(parsed.conditionId, parsed);
        }
      }

      const filteredTrades = sportsTrades.filter((t: any) => isSportsRelated(t.title || t.slug || ""));

      const marketTradeMap = new Map<string, { walletSides: Map<string, { side: "YES" | "NO"; price: number; size: number; name: string }> }>();

      for (const trade of filteredTrades) {
        const condId = trade.conditionId || "";
        if (!condId) continue;
        const wallet = trade.proxyWallet || "";
        if (!wallet) continue;

        const side: "YES" | "NO" = (trade.outcome === "Yes" || trade.outcomeIndex === 0) ? "YES" : "NO";
        const price = parseFloat(trade.price || "0.5");
        const size = parseFloat(trade.size || "0");

        if (!marketTradeMap.has(condId)) {
          marketTradeMap.set(condId, { walletSides: new Map() });
        }
        const mt = marketTradeMap.get(condId)!;
        const existing = mt.walletSides.get(wallet);
        if (!existing || size > existing.size) {
          mt.walletSides.set(wallet, { side, price, size, name: trade.pseudonym || truncateAddress(wallet) });
        }
      }

      const signals: any[] = [];

      for (const [condId, mt] of marketTradeMap.entries()) {
        const entries = Array.from(mt.walletSides.values());
        if (entries.length < 2) continue;

        const yesEntries = entries.filter(e => e.side === "YES");
        const noEntries = entries.filter(e => e.side === "NO");
        const side: "YES" | "NO" = yesEntries.length >= noEntries.length ? "YES" : "NO";
        const dominant = side === "YES" ? yesEntries : noEntries;
        const consensusPct = (dominant.length / entries.length) * 100;

        if (consensusPct < 60 || dominant.length < 2) continue;

        const avgEntryPrice = dominant.reduce((s, e) => s + e.price, 0) / dominant.length;
        const avgSize = dominant.reduce((s, e) => s + e.size, 0) / dominant.length;
        const marketInfo = sportsMarketMap.get(condId);

        let currentPrice = marketInfo?.currentPrice ?? avgEntryPrice;
        if (marketInfo?.tokenIds?.length > 0) {
          const mid = await fetchMarketMidpoint(marketInfo.tokenIds[side === "YES" ? 0 : 1] || marketInfo.tokenIds[0]);
          if (mid !== null && mid > 0) currentPrice = mid;
        }

        const valueDelta = side === "YES"
          ? (avgEntryPrice - currentPrice - 0.02)
          : ((1 - avgEntryPrice) - (1 - currentPrice) - 0.02);

        const confidence = computeConfidence(15, consensusPct, valueDelta, avgSize);

        signals.push({
          id: `fast-${condId}-${side}`,
          marketId: condId,
          marketQuestion: marketInfo?.question || filteredTrades.find((t: any) => t.conditionId === condId)?.title || condId,
          slug: marketInfo?.slug,
          outcome: side,
          side,
          confidence,
          consensusPct: Math.round(consensusPct),
          valueDelta: Math.round(valueDelta * 1000) / 1000,
          currentPrice: Math.round(currentPrice * 1000) / 1000,
          avgEntryPrice: Math.round(avgEntryPrice * 1000) / 1000,
          traderCount: dominant.length,
          traders: dominant.slice(0, 5).map(e => ({
            address: "",
            name: e.name,
            entryPrice: e.price,
            size: e.size,
            roi: 0,
          })),
          category: marketInfo?.category || "sports",
          volume: marketInfo?.volume || 0,
          generatedAt: Date.now(),
          isValue: valueDelta > 0,
        });
      }

      signals.sort((a, b) => b.confidence - a.confidence);
      const uniqueTraderCount = new Set(filteredTrades.map((t: any) => t.proxyWallet).filter(Boolean)).size;
      const response = {
        signals,
        topTraderCount: uniqueTraderCount,
        marketsScanned: sportsMarketMap.size,
        fetchedAt: Date.now(),
        source: "recent_activity",
      };

      setCache(cacheKey, response, 2 * 60 * 1000);
      res.json(response);
    } catch (err: any) {
      console.error("Fast signals error:", err.message);
      res.status(500).json({ error: err.message, signals: [], topTraderCount: 0, marketsScanned: 0, fetchedAt: Date.now() });
    }
  });

  /** GET /api/market/:tokenId/price */
  app.get("/api/market/:tokenId/price", async (req, res) => {
    try {
      const mid = await fetchMarketMidpoint(req.params.tokenId);
      res.json({ tokenId: req.params.tokenId, midpoint: mid, fetchedAt: Date.now() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return httpServer;
}
