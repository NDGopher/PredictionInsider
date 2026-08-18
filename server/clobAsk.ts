/**
 * Live CLOB bid/ask for a Polymarket token. No cache in callers — 8s TTL here.
 */
const CLOB_API = "https://clob.polymarket.com";
const TTL_MS = 8_000;

export interface ClobQuote {
  ask: number | null;
  bid: number | null;
  fetchedAt: number;
  source: "book" | "price" | "none";
}

interface CacheRow {
  quote: ClobQuote;
  ts: number;
}

const cache = new Map<string, CacheRow>();

function parsePx(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

async function clobGet(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "PredictionInsider/3.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[clob] GET ${url.slice(0, 80)} failed: ${msg}`);
    return null;
  }
}

function minAsk(book: Record<string, unknown>): number | null {
  const asks = book.asks;
  if (!Array.isArray(asks) || asks.length === 0) return null;
  let best: number | null = null;
  for (const row of asks) {
    const rec = row as Record<string, unknown>;
    const px = parsePx(rec.price);
    if (px == null) continue;
    if (best == null || px < best) best = px;
  }
  return best;
}

function maxBid(book: Record<string, unknown>): number | null {
  const bids = book.bids;
  if (!Array.isArray(bids) || bids.length === 0) return null;
  let best: number | null = null;
  for (const row of bids) {
    const rec = row as Record<string, unknown>;
    const px = parsePx(rec.price);
    if (px == null) continue;
    if (best == null || px > best) best = px;
  }
  return best;
}

export async function fetchClobQuote(tokenId: string): Promise<ClobQuote> {
  const id = tokenId.trim();
  const empty: ClobQuote = { ask: null, bid: null, fetchedAt: Date.now(), source: "none" };
  if (!id) return empty;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.quote;

  const bookRaw = await clobGet(`${CLOB_API}/book?token_id=${encodeURIComponent(id)}`);
  let ask: number | null = null;
  let bid: number | null = null;
  let source: ClobQuote["source"] = "none";
  if (bookRaw && typeof bookRaw === "object") {
    const book = bookRaw as Record<string, unknown>;
    ask = minAsk(book);
    bid = maxBid(book);
    if (ask != null) source = "book";
  }

  if (ask == null) {
    const pxRaw = await clobGet(`${CLOB_API}/price?token_id=${encodeURIComponent(id)}&side=buy`);
    if (pxRaw && typeof pxRaw === "object") {
      const px = parsePx((pxRaw as Record<string, unknown>).price);
      if (px != null) {
        ask = px;
        source = "price";
      }
    }
  }

  const quote: ClobQuote = { ask, bid, fetchedAt: Date.now(), source };
  cache.set(id, { quote, ts: Date.now() });
  return quote;
}

export async function fetchClobQuotes(tokenIds: string[]): Promise<Map<string, ClobQuote>> {
  const unique = [...new Set(tokenIds.map((t) => t.trim()).filter(Boolean))];
  const out = new Map<string, ClobQuote>();
  const concurrency = 6;
  for (let i = 0; i < unique.length; i += concurrency) {
    const chunk = unique.slice(i, i + concurrency);
    const quotes = await Promise.all(chunk.map((id) => fetchClobQuote(id)));
    chunk.forEach((id, idx) => out.set(id, quotes[idx]));
  }
  return out;
}
