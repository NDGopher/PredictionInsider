import type { Express } from "express";
import { createServer, type Server } from "http";

const GAMMA_API = "https://gamma-api.polymarket.com";
const DATA_API = "https://data-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";

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

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; PredictionInsider/1.0)",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
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

async function fetchSportsTrades(limit = 1000) {
  const cacheKey = `sports-trades-${limit}`;
  const cached = getCache<unknown[]>(cacheKey);
  if (cached) return cached;

  const res = await fetchWithRetry(`${DATA_API}/trades?limit=${limit}`);
  if (!res.ok) return [];
  const data = await res.json();
  const all = Array.isArray(data) ? data : (data.data || []);
  const sports = all.filter((t: any) => isSportsRelated(t.title || t.slug || ""));
  setCache(cacheKey, sports, 2 * 60 * 1000);
  return sports;
}

async function fetchUserPositions(address: string) {
  const cacheKey = `positions-${address}`;
  const cached = getCache<unknown[]>(cacheKey);
  if (cached) return cached;

  const url = `${DATA_API}/positions?user=${address}&limit=100&sizeThreshold=.1`;
  const res = await fetchWithRetry(url);
  if (!res.ok) return [];
  const data = await res.json();
  const positions = Array.isArray(data) ? data : (data.data || []);
  setCache(cacheKey, positions, 5 * 60 * 1000);
  return positions;
}

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

async function fetchMarketMidpoint(tokenId: string): Promise<number | null> {
  const cacheKey = `midpoint-${tokenId}`;
  const cached = getCache<number>(cacheKey);
  if (cached !== null) return cached;

  try {
    const url = `${CLOB_API}/midpoint?token_id=${tokenId}`;
    const res = await fetchWithRetry(url);
    if (!res.ok) return null;
    const data = await res.json();
    const mid = parseFloat(data.mid || data.midpoint || "0");
    if (!isNaN(mid) && mid > 0) {
      setCache(cacheKey, mid, 60 * 1000);
      return mid;
    }
  } catch {
    // ignore
  }
  return null;
}

const SPORTS_KEYWORDS = [
  "nfl", "nba", "mlb", "nhl", "mls", "ncaa", "super bowl", "world cup",
  "champions league", "premier league", "bundesliga", "la liga", "serie a",
  "playoffs", "championship", "stanley cup", "finals", "semifinal", "tournament",
  "ufc", "boxing", "tennis", "golf", "pga", "wimbledon",
  "f1", "formula", "nascar", "olympics", "world series",
  "win the", "beat the", "score", "touchdown", "goal", "mvp", "title",
  "draft", "transfer", "season", "league", "team vs", " vs ",
  "quarterback", "pitcher", "forward", "goalkeeper",
];

function isSportsRelated(text: string): boolean {
  const t = text.toLowerCase();
  return SPORTS_KEYWORDS.some(k => t.includes(k));
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr || "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function computeConfidence(tradeCount: number, consensusPct: number, valueDelta: number, avgSize: number): number {
  const activityScore = Math.min((tradeCount / 20) * 100, 100);
  const consensusScore = Math.min(consensusPct, 100);
  const valueScore = valueDelta > 0 ? Math.min(valueDelta * 400, 100) : 0;
  const sizeScore = Math.min((avgSize / 100) * 40, 40);
  return Math.round(activityScore * 0.2 + consensusScore * 0.5 + valueScore * 0.2 + sizeScore * 0.1);
}

function buildTraderProfile(trades: any[]): any[] {
  const walletMap: Record<string, {
    address: string; name: string; pseudonym: string;
    trades: number; sportsTradesCount: number; volume: number; sides: Record<string, number>;
  }> = {};

  for (const t of trades) {
    const addr = t.proxyWallet || t.user || "";
    if (!addr) continue;
    if (!walletMap[addr]) {
      walletMap[addr] = {
        address: addr,
        name: t.pseudonym || t.name || truncateAddress(addr),
        pseudonym: t.pseudonym || "",
        trades: 0, sportsTradesCount: 0, volume: 0,
        sides: {},
      };
    }
    walletMap[addr].trades += 1;
    walletMap[addr].volume += parseFloat(t.size || "0") * parseFloat(t.price || "0");
    if (isSportsRelated(t.title || t.slug || "")) {
      walletMap[addr].sportsTradesCount += 1;
    }
  }

  return Object.values(walletMap)
    .sort((a, b) => b.sportsTradesCount - a.sportsTradesCount || b.trades - a.trades)
    .filter(w => w.trades >= 3)
    .map((w, i) => ({
      address: w.address,
      name: w.name || w.pseudonym || truncateAddress(w.address),
      pnl: 0,
      roi: 0,
      tradesCount: w.trades,
      winRate: 50,
      avgSize: w.trades > 0 ? w.volume / w.trades : 0,
      volume: w.volume,
      rank: i + 1,
    }));
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/traders", async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || "100"), 200);
      const cached = getCache<unknown>(`traders-resp-${limit}`);
      if (cached) { res.json(cached); return; }

      const trades = await fetchRecentTrades(500);
      const traders = buildTraderProfile(trades).slice(0, limit);

      const result = {
        traders,
        fetchedAt: Date.now(),
        window: "recent",
      };

      setCache(`traders-resp-${limit}`, result, 3 * 60 * 1000);
      res.json(result);
    } catch (err: any) {
      console.error("Traders error:", err.message);
      res.status(500).json({ error: err.message, traders: [], fetchedAt: Date.now(), window: "recent" });
    }
  });

  app.get("/api/markets", async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || "100"), 200);
      const sportsOnly = req.query.sports !== "false";

      const raw = await fetchSportsMarkets(200);

      const markets = raw
        .map((m: any) => {
          let outcomePrices: number[] = [];
          try { outcomePrices = JSON.parse(m.outcomePrices || "[]").map(parseFloat); } catch {}
          const currentPrice = outcomePrices.length > 0 ? outcomePrices[0] : 0.5;

          let tokenIds: string[] = [];
          try {
            const tokens = JSON.parse(m.tokens || "[]");
            tokenIds = tokens.map((t: any) => t.token_id || t.tokenId).filter(Boolean);
          } catch {}

          return {
            id: m.id || m.conditionId || "",
            question: m.question || m.title || "",
            slug: m.slug || m.market_slug || undefined,
            category: m.groupItemTagSlug || m.category || m.tag || "other",
            currentPrice,
            volume: parseFloat(m.volume || m.volumeNum || "0"),
            liquidity: parseFloat(m.liquidity || m.liquidityNum || "0"),
            endDate: m.endDate || m.end_date || undefined,
            active: m.active !== false && m.closed !== true,
            traderCount: parseInt(m.uniqueTraders || m.traderCount || "0"),
            conditionId: m.conditionId || m.id || undefined,
            tokenIds,
          };
        })
        .filter((m: any) => {
          if (!m.id || !m.question) return false;
          if (!m.active) return false;
          if (sportsOnly) return isSportsRelated(m.question);
          return true;
        })
        .slice(0, limit);

      res.json({
        markets,
        fetchedAt: Date.now(),
        total: markets.length,
      });
    } catch (err: any) {
      console.error("Markets error:", err.message);
      res.status(500).json({ error: err.message, markets: [], fetchedAt: Date.now(), total: 0 });
    }
  });

  app.get("/api/signals", async (req, res) => {
    try {
      const cacheKey = "signals-computed-v2";
      const cached = getCache<unknown>(cacheKey);
      if (cached) { res.json(cached); return; }

      const [sportsTrades, rawMarkets] = await Promise.all([
        fetchSportsTrades(1000),
        fetchSportsMarkets(200),
      ]);

      const traderProfiles = buildTraderProfile(sportsTrades);
      const topTraderCount = traderProfiles.length;

      const sportsMarketMap: Record<string, any> = {};
      for (const m of rawMarkets) {
        let outcomePrices: number[] = [];
        try { outcomePrices = JSON.parse(m.outcomePrices || "[]").map(parseFloat); } catch {}
        const currentPrice = outcomePrices.length > 0 ? outcomePrices[0] : 0.5;

        let tokenIds: string[] = [];
        try {
          const tokens = JSON.parse(m.tokens || "[]");
          tokenIds = tokens.map((t: any) => t.token_id || t.tokenId).filter(Boolean);
        } catch {}

        const marketKey = m.conditionId || m.id || "";
        if (marketKey && isSportsRelated(m.question || "")) {
          sportsMarketMap[marketKey] = {
            id: marketKey,
            question: m.question || "",
            slug: m.slug || undefined,
            category: m.groupItemTagSlug || m.category || "sports",
            currentPrice,
            volume: parseFloat(m.volume || "0"),
            tokenIds,
          };
        }
      }

      const marketActivityMap: Record<string, {
        tradesByWallet: Record<string, { side: "YES" | "NO"; price: number; size: number; name: string; }>;
        question: string; slug?: string; category: string;
        currentPrice: number; volume: number; tokenIds: string[];
      }> = {};

      for (const trade of sportsTrades) {
        const conditionId = trade.conditionId || "";
        if (!conditionId) continue;

        const wallet = trade.proxyWallet || trade.user || "";
        if (!wallet) continue;

        const side: "YES" | "NO" = (trade.outcome === "Yes" || (trade.side === "BUY" && trade.outcomeIndex === 0))
          ? "YES"
          : (trade.outcome === "No" || (trade.side === "BUY" && trade.outcomeIndex === 1))
          ? "NO"
          : trade.side === "BUY" ? "YES" : "NO";

        const price = parseFloat(trade.price || "0.5");
        const size = parseFloat(trade.size || "0");
        const marketInfo = sportsMarketMap[conditionId];

        if (!marketActivityMap[conditionId]) {
          marketActivityMap[conditionId] = {
            tradesByWallet: {},
            question: trade.title || marketInfo?.question || conditionId,
            slug: trade.slug || trade.eventSlug || marketInfo?.slug,
            category: marketInfo?.category || "sports",
            currentPrice: marketInfo?.currentPrice || price,
            volume: marketInfo?.volume || 0,
            tokenIds: marketInfo?.tokenIds || [],
          };
        }

        const ma = marketActivityMap[conditionId];
        if (!ma.tradesByWallet[wallet]) {
          ma.tradesByWallet[wallet] = { side, price, size, name: trade.pseudonym || truncateAddress(wallet) };
        } else {
          const existing = ma.tradesByWallet[wallet];
          existing.price = (existing.price * existing.size + price * size) / (existing.size + size);
          existing.size += size;
          if (size > existing.size * 0.5) existing.side = side;
        }
      }

      const signals: any[] = [];

      for (const [conditionId, ma] of Object.entries(marketActivityMap)) {
        const entries = Object.values(ma.tradesByWallet);
        if (entries.length < 2) continue;

        const yesEntries = entries.filter(e => e.side === "YES");
        const noEntries = entries.filter(e => e.side === "NO");

        const dominant = yesEntries.length >= noEntries.length ? yesEntries : noEntries;
        const side: "YES" | "NO" = yesEntries.length >= noEntries.length ? "YES" : "NO";
        const consensusPct = (dominant.length / entries.length) * 100;

        if (consensusPct < 55 || dominant.length < 2) continue;

        const avgEntryPrice = dominant.reduce((s, e) => s + e.price, 0) / dominant.length;
        const avgSize = dominant.reduce((s, e) => s + e.size, 0) / dominant.length;

        let currentPrice = ma.currentPrice;
        if (ma.tokenIds.length > 0) {
          const mid = await fetchMarketMidpoint(ma.tokenIds[side === "YES" ? 0 : 1] || ma.tokenIds[0]);
          if (mid !== null && mid > 0) currentPrice = mid;
        }

        const slippage = 0.02;
        const valueDelta = side === "YES"
          ? (avgEntryPrice - currentPrice - slippage)
          : ((1 - avgEntryPrice) - (1 - currentPrice) - slippage);

        const confidence = computeConfidence(dominant.length, consensusPct, valueDelta, avgSize);

        signals.push({
          id: `${conditionId}-${side}`,
          marketId: conditionId,
          marketQuestion: ma.question,
          slug: ma.slug,
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
          category: ma.category,
          volume: ma.volume,
          generatedAt: Date.now(),
          isValue: valueDelta > 0,
        });
      }

      signals.sort((a, b) => b.confidence - a.confidence);

      const response = {
        signals,
        topTraderCount,
        marketsScanned: Object.keys(sportsMarketMap).length,
        fetchedAt: Date.now(),
      };

      setCache(cacheKey, response, 2 * 60 * 1000);
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

  app.get("/api/market/:tokenId/price", async (req, res) => {
    try {
      const { tokenId } = req.params;
      const mid = await fetchMarketMidpoint(tokenId);
      res.json({ tokenId, midpoint: mid, fetchedAt: Date.now() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return httpServer;
}
