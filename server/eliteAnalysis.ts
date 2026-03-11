import { Pool } from "pg";

const DATA_API = "https://data-api.polymarket.com";
const GAMMA_API = "https://gamma-api.polymarket.com";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── Known curated traders (pre-seeded) ──────────────────────────────────────

export const CURATED_TRADERS: { wallet: string; username: string; url?: string }[] = [
  { wallet: "0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee", username: "kch123", url: "https://polymarket.com/@kch123" },
  { wallet: "0x6e82b93eb57b01a63027bd0c6d2f3f04934a752c", username: "DLEK", url: "https://polymarket.com/@DLEK" },
  { wallet: "0x44c58184f89a5c2f699dc8943009cb3d75a08d45", username: "JhonAlexanderHinestroza", url: "https://polymarket.com/@JhonAlexanderHinestroza" },
  { wallet: "0x13414a77a4be48988851c73dfd824d0168e70853", username: "ShortFlutterStock", url: "https://polymarket.com/@ShortFlutterStock" },
  { wallet: "0x781caf04d98a281712caf1677877c442789fdb68", username: "Avarice31", url: "https://polymarket.com/@Avarice31" },
  { wallet: "0xc5b5bbd42624a8f0c8dfa90221913007d8c77e80", username: "Capman", url: "https://polymarket.com/@Capman" },
  { wallet: "0x84dbb7103982e3617704a2ed7d5b39691952aeeb", username: "ShucksIt69", url: "https://polymarket.com/@ShucksIt69" },
  { wallet: "0xc660ae71765d0d9eaf5fa8328c1c959841d2bd28", username: "TutiFromFactsOfLife", url: "https://polymarket.com/@TutiFromFactsOfLife" },
  { wallet: "0xd6966eb1ae7b52320ba7ab1016680198c9e08a49", username: "EIf", url: "https://polymarket.com/@EIf" },
  { wallet: "0x92672c80d36dcd08172aa1e51dface0f20b70f9a", username: "ckw", url: "https://polymarket.com/@ckw" },
  { wallet: "0xdbb9b3616f733e19278d1ca6f3207a8344b5ed8d", username: "bigmoneyloser00", url: "https://polymarket.com/@bigmoneyloser00" },
  { wallet: "0x52ecea7b3159f09db589e4f4ee64872fd0bba6f3", username: "fkgggg2", url: "https://polymarket.com/@fkgggg2" },
  { wallet: "0xd9e0aaca471f489be338fd0f91a26e8669a805f2", username: "0xD9E0AACa471f48F91A26E8669A805f2", url: "https://polymarket.com/@0xD9E0AACa471f48F91A26E8669A805f2" },
  { wallet: "0xf588b19afe63e1aba00f125f91e3e3b0fdc62b81", username: "RandomPunter", url: "https://polymarket.com/@RandomPunter" },
  { wallet: "0x9ac5c8496bc84f642bac181499bf64405a5c6a3d", username: "JuniorB", url: "https://polymarket.com/@JuniorB" },
  { wallet: "0x2c335066fe58fe9237c3d3dc7b275c2a034a0563", username: "0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563", url: "https://polymarket.com/@0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563-1759935795465" },
  { wallet: "0x20d6436849f930584892730c7f96ebb2ac763856", username: "0x20D6436849F930584892730C7F96eBB2Ac763856", url: "https://polymarket.com/@0x20D6436849F930584892730C7F96eBB2Ac763856-1768642056357" },
  // Unresolved — wallet_resolved=false, will be filled in when user provides wallet
  { wallet: "", username: "S-Works", url: "https://polymarket.com/@S-Works" },
  { wallet: "", username: "BoomLaLa", url: "https://polymarket.com/@BoomLaLa" },
  { wallet: "", username: "Bienville", url: "https://polymarket.com/@Bienville" },
  { wallet: "", username: "IBOV200K", url: "https://polymarket.com/@IBOV200K" },
  { wallet: "", username: "tcp2", url: "https://polymarket.com/@tcp2" },
  { wallet: "", username: "0xheavy888", url: "https://polymarket.com/@0xheavy888" },
  { wallet: "", username: "LynxTitan", url: "https://polymarket.com/@LynxTitan" },
  { wallet: "", username: "geniusMC", url: "https://polymarket.com/@geniusMC" },
  { wallet: "", username: "redskinrick", url: "https://polymarket.com/@redskinrick" },
  { wallet: "", username: "middleoftheocean", url: "https://polymarket.com/@middleoftheocean" },
  { wallet: "", username: "Andromeda1", url: "https://polymarket.com/@Andromeda1" },
  { wallet: "", username: "CoryLahey", url: "https://polymarket.com/@CoryLahey" },
  { wallet: "", username: "TheArena", url: "https://polymarket.com/@TheArena" },
  { wallet: "", username: "chenpengzao", url: "https://polymarket.com/@chenpengzao" },
  { wallet: "", username: "xytest", url: "https://polymarket.com/@xytest" },
  { wallet: "", username: "UAEVALORANTFAN", url: "https://polymarket.com/@UAEVALORANTFAN" },
  { wallet: "", username: "TheMangler", url: "https://polymarket.com/@TheMangler" },
  { wallet: "", username: "iDropMyHotdog", url: "https://polymarket.com/@iDropMyHotdog" },
  { wallet: "", username: "bloodmaster", url: "https://polymarket.com/@bloodmaster" },
  { wallet: "", username: "9sh8f", url: "https://polymarket.com/@9sh8f" },
  { wallet: "", username: "0x53eCc53E7", url: "https://polymarket.com/@0x53eCc53E7" },
  { wallet: "", username: "877s8d8g89I9f8d98fd99ww2", url: "https://polymarket.com/@877s8d8g89I9f8d98fd99ww2" },
  { wallet: "", username: "Vetch", url: "https://polymarket.com/@Vetch" },
  { wallet: "", username: "TTdes", url: "https://polymarket.com/@TTdes" },
  { wallet: "", username: "EF203F2IPFC2ICP20W-CP3", url: "https://polymarket.com/@EF203F2IPFC2ICP20W-CP3" },
];

// ─── In-memory set for fast signal lookup ────────────────────────────────────

export const curatedWalletSet = new Set<string>();
export const curatedWalletToUsername = new Map<string, string>();

// ─── Slug → Sport classifier ──────────────────────────────────────────────────

export function classifySport(slug: string, title: string): string {
  const s = (slug || "").toLowerCase();
  const t = (title || "").toLowerCase();

  if (s.startsWith("nba-") || t.includes("nba ") || t.includes(" nba")) return "NBA";
  if (s.startsWith("nfl-") || t.includes("nfl ") || t.includes("super bowl")) return "NFL";
  if (s.startsWith("nhl-") || t.includes("nhl ") || t.includes("stanley cup")) return "NHL";
  if (s.startsWith("mlb-") || t.includes("mlb ") || t.includes("world series")) return "MLB";
  if (s.startsWith("ufc-") || t.includes("ufc ") || t.includes("mma ") || t.includes("fight night")) return "UFC/MMA";
  if (s.match(/^(wta|atp|aus-|wimbledon|usopen-ten|roland)/) || t.includes("tennis") || t.includes("grand slam")) return "Tennis";
  if (s.match(/^(cbb|ncaab|ncaaf|cfb)-/) || t.includes("ncaa") || t.includes("march madness")) return "College Sports";
  if (s.match(/^(epl|lal|sea|bun|uel|ucl|mls|spl|bra|eng|fra|ger|esp|ita|por|bel|ned|sco)-/) ||
      t.includes("soccer") || t.includes("football") || t.includes("copa") || t.includes("premier league") ||
      t.includes("champions league") || t.includes("la liga") || t.includes("bundesliga") || t.includes("serie a")) return "Soccer";
  if (s.includes("esport") || s.includes("valorant") || s.includes("csgo") || s.includes("lol-") ||
      t.includes("esport") || t.includes("valorant") || t.includes("league of legends")) return "eSports";
  if (s.startsWith("golf-") || t.includes("masters") || t.includes("pga tour") || t.includes("golf")) return "Golf";
  if (s.match(/^(f1|formula)/) || t.includes("formula 1") || t.includes("grand prix")) return "Formula 1";
  if (t.match(/trump|biden|harris|election|congress|senate|president|vote|poll|democrat|republican/)) return "Politics";
  if (t.match(/crypto|bitcoin|ethereum|fed rate|inflation|gdp|stock|nasdaq/)) return "Finance/Crypto";
  return "Other";
}

export function classifyMarketType(slug: string, title: string, outcome: string): string {
  const s = (slug || "").toLowerCase();
  const t = (title || "").toLowerCase();
  const o = (outcome || "").toLowerCase();

  if (s.match(/total|o-u|over-under/) || t.match(/over\/under|o\/u|total (points|goals|runs)/) ||
      o.match(/^(over|under) \d/)) return "total";
  if (s.includes("spread") || t.match(/[-+]\d+\.?\d* (points?|pts)/) || o.match(/^[+-]\d/)) return "spread";
  if (s.match(/-draw$|-draw-/) || t.includes("draw") || o === "draw") return "draw";
  if (s.match(/champion|cup|title|win-the|playoff|finals/) || t.match(/win the|champion|super bowl|stanley cup|world series/)) return "futures";
  if (s.match(/btts|-btts$/) || t.includes("both teams to score")) return "btts";
  if (t.match(/first|last (team|player|goal)|anytime|clean sheet/)) return "prop";
  return "moneyline";
}

// ─── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<any> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "PredictionInsider/1.0" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Wallet resolution ────────────────────────────────────────────────────────

export async function resolveUsernameToWallet(username: string): Promise<string | null> {
  // 1. Direct wallet in username field
  if (/^0x[a-fA-F0-9]{40}/.test(username)) {
    return username.toLowerCase().slice(0, 42);
  }

  // 2. Try fetching a trade using username as user param — returns trades by name match on Polymarket
  const tradeRes = await fetchJson(`${DATA_API}/trades?user=${encodeURIComponent(username)}&limit=5`);
  if (Array.isArray(tradeRes) && tradeRes.length > 0) {
    // Get the most common proxyWallet (exclude the ~3 "wrong" wallets from ambiguous username)
    const walletCounts: Record<string, number> = {};
    for (const t of tradeRes) {
      if (t.proxyWallet) walletCounts[t.proxyWallet] = (walletCounts[t.proxyWallet] || 0) + 1;
    }
    // The username owner should have their name on all trades
    for (const t of tradeRes) {
      if ((t.name || t.pseudonym || "") === username && t.proxyWallet) {
        return t.proxyWallet.toLowerCase();
      }
    }
  }

  // 3. Leaderboard search
  for (const win of ["all", "week", "month"]) {
    for (let page = 0; page < 60; page++) {
      const data = await fetchJson(
        `${DATA_API}/v1/leaderboard?window=${win}&limit=50&offset=${page * 50}&category=sports`
      );
      const arr = Array.isArray(data) ? data : (data?.data || data?.leaderboard || data?.results || []);
      if (!arr.length) break;
      const match = arr.find((e: any) => (e.userName || e.name || "") === username);
      if (match) return (match.proxyWallet || match.address || "").toLowerCase();
    }
  }

  return null;
}

// ─── Full trade history fetch ─────────────────────────────────────────────────

export async function fetchFullTradeHistory(
  wallet: string,
  sinceTimestamp?: number
): Promise<number> {
  const PAGE = 500;
  let offset = 0;
  let totalInserted = 0;
  const walletLower = wallet.toLowerCase();

  // Build a batch insert helper
  const batch: any[][] = [];
  const flushBatch = async () => {
    if (!batch.length) return;
    // Build multi-row INSERT
    const placeholders = batch.map((_, i) => {
      const base = i * 16;
      return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13},$${base+14},$${base+15},$${base+16})`;
    }).join(",");
    const flat = batch.flat();
    try {
      await pool.query(`
        INSERT INTO elite_trader_trades
          (wallet, condition_id, side, is_buy, price, size, trade_timestamp, title, slug,
           outcome, outcome_index, sport, market_type, is_longshot, is_guarantee, transaction_hash)
        VALUES ${placeholders}
        ON CONFLICT (wallet, transaction_hash) WHERE transaction_hash IS NOT NULL DO NOTHING
      `, flat);
      totalInserted += batch.length;
    } catch (e: any) {
      // Fall back to individual inserts if batch fails
      for (const row of batch) {
        try {
          await pool.query(`
            INSERT INTO elite_trader_trades
              (wallet, condition_id, side, is_buy, price, size, trade_timestamp, title, slug,
               outcome, outcome_index, sport, market_type, is_longshot, is_guarantee, transaction_hash)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            ON CONFLICT (wallet, transaction_hash) WHERE transaction_hash IS NOT NULL DO NOTHING
          `, row);
          totalInserted++;
        } catch (_) {}
      }
    }
    batch.length = 0;
  };

  while (true) {
    const url = `${DATA_API}/trades?user=${walletLower}&limit=${PAGE}&offset=${offset}`;
    const data = await fetchJson(url);
    if (!Array.isArray(data) || data.length === 0) break;

    for (const t of data) {
      if (!t.conditionId) continue;

      // Skip trades newer than sinceTimestamp (for incremental refresh, we want OLDER)
      // Actually for incremental: skip trades OLDER than sinceTimestamp
      if (sinceTimestamp && t.timestamp && t.timestamp * 1000 < sinceTimestamp) {
        // We've hit the already-fetched range — stop
        await flushBatch();
        await pool.query(`UPDATE elite_traders SET last_analyzed_at = NOW() WHERE wallet = $1`, [walletLower]);
        return totalInserted;
      }

      const ts = t.timestamp ? new Date(t.timestamp * 1000) : null;
      if (!ts) continue;

      const sport = classifySport(t.slug || "", t.title || "");
      const mType = classifyMarketType(t.slug || "", t.title || "", t.outcome || "");
      const price = parseFloat(t.price) || 0;
      const size = parseFloat(t.size) || 0;
      const isBuy = (t.side || "").toUpperCase() === "BUY";
      const outcomeIndex = t.outcomeIndex != null ? t.outcomeIndex : (t.outcome?.toLowerCase() === "yes" ? 0 : 1);
      const side = outcomeIndex === 0 ? "YES" : "NO";
      // Use transactionHash if present, else generate a stable key
      const txHash = t.transactionHash || null;

      batch.push([
        walletLower, t.conditionId, side, isBuy, price, size, ts,
        (t.title || "").slice(0, 500), t.slug || "", t.outcome || "", outcomeIndex,
        sport, mType,
        price < 0.25, price > 0.75,
        txHash,
      ]);

      if (batch.length >= 100) await flushBatch();
    }

    await flushBatch();

    if (data.length < PAGE) break;
    offset += PAGE;
    await new Promise(r => setTimeout(r, 80));
  }

  await flushBatch();
  await pool.query(`UPDATE elite_traders SET last_analyzed_at = NOW() WHERE wallet = $1`, [walletLower]);
  return totalInserted;
}

// ─── Parse outcomePrices from Gamma market object ─────────────────────────────
function parseOutcome(m: any): { yesWon: boolean; noWon: boolean } | null {
  if (!m || m.closed !== true) return null;
  try {
    const raw = typeof m.outcomePrices === "string"
      ? JSON.parse(m.outcomePrices)
      : m.outcomePrices;
    if (!Array.isArray(raw) || raw.length < 2) return null;
    const yesP = parseFloat(raw[0]);
    const noP = parseFloat(raw[1]);
    const yesWon = yesP >= 0.99;
    const noWon = noP >= 0.99;
    if (!yesWon && !noWon) return null;
    return { yesWon, noWon };
  } catch (_) { return null; }
}

// ─── Global settlement: resolves ALL unsettled trades across all wallets ───────
// Uses single condition_ids= lookups with concurrency of 15 to avoid 429s.
// The Gamma API only reliably filters with a SINGLE condition_id at a time.

export async function settleAllUnresolvedTradesGlobal(): Promise<number> {
  // Get all distinct condition IDs that have ANY unsettled trades
  const { rows } = await pool.query(`
    SELECT DISTINCT condition_id
    FROM elite_trader_trades
    WHERE settled_outcome IS NULL AND is_buy = TRUE
  `);
  const allIds = rows.map((r: any) => r.condition_id as string);
  if (!allIds.length) return 0;

  console.log(`[Elite] Global settlement: checking ${allIds.length} condition IDs`);

  // Concurrency-limited fetch helper
  const CONCURRENCY = 15;
  const settled = new Map<string, { yesWon: boolean; noWon: boolean }>();

  const fetchOne = async (condId: string) => {
    try {
      const res = await fetchJson(`${GAMMA_API}/markets?condition_ids=${condId}`);
      const m = Array.isArray(res) ? res.find((x: any) => x.conditionId === condId) : null;
      const outcome = parseOutcome(m);
      if (outcome) settled.set(condId, outcome);
    } catch (_) {}
  };

  // Helper: flush the settled map to DB, return count of rows updated
  let totalUpdated = 0;
  const flushToDB = async () => {
    if (!settled.size) return;
    const entries = [...settled.entries()];
    settled.clear();
    const now = new Date();
    const CHUNK = 200;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK);
      const yesIds = chunk.filter(([, o]) => o.yesWon).map(([id]) => id);
      const noIds  = chunk.filter(([, o]) => o.noWon).map(([id]) => id);
      if (yesIds.length) {
        const ph = yesIds.map((_, j) => `$${j + 2}`).join(",");
        const { rowCount } = await pool.query(`
          UPDATE elite_trader_trades SET
            settled_at = $1,
            settled_outcome = CASE WHEN side = 'YES' THEN 'won' ELSE 'lost' END,
            settled_pnl = CASE WHEN side = 'YES' THEN size * (1.0 / NULLIF(price, 0) - 1.0) ELSE -size END
          WHERE is_buy = TRUE AND settled_outcome IS NULL AND condition_id IN (${ph})
        `, [now, ...yesIds]);
        totalUpdated += rowCount ?? 0;
      }
      if (noIds.length) {
        const ph = noIds.map((_, j) => `$${j + 2}`).join(",");
        const { rowCount } = await pool.query(`
          UPDATE elite_trader_trades SET
            settled_at = $1,
            settled_outcome = CASE WHEN side = 'NO' THEN 'won' ELSE 'lost' END,
            settled_pnl = CASE WHEN side = 'NO' THEN size * (1.0 / NULLIF(price, 0) - 1.0) ELSE -size END
          WHERE is_buy = TRUE AND settled_outcome IS NULL AND condition_id IN (${ph})
        `, [now, ...noIds]);
        totalUpdated += rowCount ?? 0;
      }
    }
  };

  // Process in parallel chunks, flushing to DB every 500 resolved markets
  for (let i = 0; i < allIds.length; i += CONCURRENCY) {
    await Promise.all(allIds.slice(i, i + CONCURRENCY).map(fetchOne));
    // Flush to DB every 500 resolved markets for incremental progress visibility
    if (settled.size >= 500) {
      await flushToDB();
      console.log(`[Elite] Settlement: ${i}/${allIds.length} checked, ${totalUpdated} settled so far`);
    } else if (i % 300 === 0 && i > 0) {
      console.log(`[Elite] Settlement progress: ${i}/${allIds.length} checked, ${settled.size} pending flush`);
    }
    await new Promise(r => setTimeout(r, 80)); // gentle rate limit
  }

  // Final flush
  await flushToDB();
  console.log(`[Elite] Global settlement complete: ${totalUpdated} trades settled`);
  return totalUpdated;
}

// ─── Per-wallet settlement (calls global for just this wallet's condition IDs) ─

export async function settleUnresolvedTrades(wallet: string): Promise<number> {
  const w = wallet.toLowerCase();

  // Get distinct condition IDs for just this wallet
  const { rows: condRows } = await pool.query(`
    SELECT DISTINCT condition_id
    FROM elite_trader_trades
    WHERE wallet = $1 AND settled_outcome IS NULL AND is_buy = TRUE
  `, [w]);

  const allIds = condRows.map((r: any) => r.condition_id as string);
  if (!allIds.length) return 0;

  const CONCURRENCY = 10;
  const settled = new Map<string, { yesWon: boolean; noWon: boolean }>();

  const fetchOne = async (condId: string) => {
    try {
      const res = await fetchJson(`${GAMMA_API}/markets?condition_ids=${condId}`);
      const m = Array.isArray(res) ? res.find((x: any) => x.conditionId === condId) : null;
      const outcome = parseOutcome(m);
      if (outcome) settled.set(condId, outcome);
    } catch (_) {}
  };

  for (let i = 0; i < allIds.length; i += CONCURRENCY) {
    await Promise.all(allIds.slice(i, i + CONCURRENCY).map(fetchOne));
    await new Promise(r => setTimeout(r, 60));
  }

  if (!settled.size) return 0;

  const settledAt = new Date();
  let totalUpdated = 0;

  const settledEntries = [...settled.entries()];
  const yesWonIds = settledEntries.filter(([, o]) => o.yesWon).map(([id]) => id);
  const noWonIds = settledEntries.filter(([, o]) => o.noWon).map(([id]) => id);

  if (yesWonIds.length) {
    // $1=settledAt, $2=wallet, $3,$4,...=conditionIds
    const placeholders = yesWonIds.map((_, i) => `$${i + 3}`).join(",");
    const { rowCount } = await pool.query(`
      UPDATE elite_trader_trades SET
        settled_at = $1,
        settled_outcome = CASE WHEN side = 'YES' THEN 'won' ELSE 'lost' END,
        settled_pnl = CASE WHEN side = 'YES' THEN size * (1.0 / NULLIF(price, 0) - 1.0) ELSE -size END
      WHERE wallet = $2 AND is_buy = TRUE AND settled_outcome IS NULL AND condition_id IN (${placeholders})
    `, [settledAt, w, ...yesWonIds]);
    totalUpdated += rowCount ?? 0;
  }

  if (noWonIds.length) {
    // $1=settledAt, $2=wallet, $3,$4,...=conditionIds
    const placeholders = noWonIds.map((_, i) => `$${i + 3}`).join(",");
    const { rowCount } = await pool.query(`
      UPDATE elite_trader_trades SET
        settled_at = $1,
        settled_outcome = CASE WHEN side = 'NO' THEN 'won' ELSE 'lost' END,
        settled_pnl = CASE WHEN side = 'NO' THEN size * (1.0 / NULLIF(price, 0) - 1.0) ELSE -size END
      WHERE wallet = $2 AND is_buy = TRUE AND settled_outcome IS NULL AND condition_id IN (${placeholders})
    `, [settledAt, w, ...noWonIds]);
    totalUpdated += rowCount ?? 0;
  }

  return totalUpdated;
}

// ─── Statistics helpers ────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ─── Compute trader profile ───────────────────────────────────────────────────

export async function computeTraderProfile(wallet: string): Promise<any> {
  const w = wallet.toLowerCase();

  // Get username
  const uRow = await pool.query(`SELECT username FROM elite_traders WHERE wallet = $1`, [w]);
  const username = uRow.rows[0]?.username || w.slice(0, 10);

  // Get all buy trades
  const { rows: trades } = await pool.query(`
    SELECT * FROM elite_trader_trades
    WHERE wallet = $1 AND is_buy = TRUE
    ORDER BY trade_timestamp ASC
  `, [w]);

  if (!trades.length) {
    return { wallet: w, username, totalTrades: 0, qualityScore: 0, tags: [] };
  }

  const now = Date.now();
  const settled = trades.filter(t => t.settled_outcome);
  const won = settled.filter(t => t.settled_outcome === "won");
  const lost = settled.filter(t => t.settled_outcome === "lost");

  const sizes = trades.map(t => parseFloat(t.size));
  const prices = trades.map(t => parseFloat(t.price));
  const totalUSDC = sizes.reduce((a, b) => a + b, 0);
  const avgBetSize = mean(sizes);
  const medianBetSize = median(sizes);
  const betSizeStdDev = stdDev(sizes);
  const betSizeCV = avgBetSize > 0 ? betSizeStdDev / avgBetSize : 0;

  const firstTrade = trades[0].trade_timestamp;
  const lastTrade = trades[trades.length - 1].trade_timestamp;
  const accountAgeDays = Math.max((new Date(lastTrade).getTime() - new Date(firstTrade).getTime()) / 86400000, 1);
  const tradesPerDay = trades.length / accountAgeDays;

  // ROI computation from settled trades
  const settledInvested = settled.reduce((a, t) => a + parseFloat(t.size), 0);
  const settledPnl = settled.reduce((a, t) => a + (parseFloat(t.settled_pnl) || 0), 0);
  const overallROI = settledInvested > 0 ? settledPnl / settledInvested : 0;
  const winRate = settled.length > 0 ? won.length / settled.length : 0;

  // Recent ROI (30d / 90d)
  const ms30 = now - 30 * 86400000;
  const ms90 = now - 90 * 86400000;
  const settled30 = settled.filter(t => new Date(t.trade_timestamp).getTime() > ms30);
  const settled90 = settled.filter(t => new Date(t.trade_timestamp).getTime() > ms90);
  const calc = (arr: any[]) => {
    const inv = arr.reduce((a, t) => a + parseFloat(t.size), 0);
    const pnl = arr.reduce((a, t) => a + (parseFloat(t.settled_pnl) || 0), 0);
    return inv > 0 ? pnl / inv : 0;
  };
  const last30dROI = calc(settled30);
  const last90dROI = calc(settled90);

  // Big vs small bet ROI
  const p90 = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length * 0.9)] || avgBetSize;
  const p50 = median(sizes);
  const bigTrades = settled.filter(t => parseFloat(t.size) >= p90);
  const smallTrades = settled.filter(t => parseFloat(t.size) <= p50);
  const bigBetROI = calc(bigTrades);
  const smallBetROI = calc(smallTrades);

  // Monthly ROI array
  const byMonth: Record<string, { pnl: number; invested: number; count: number }> = {};
  for (const t of settled) {
    const d = new Date(t.trade_timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[key]) byMonth[key] = { pnl: 0, invested: 0, count: 0 };
    byMonth[key].pnl += parseFloat(t.settled_pnl) || 0;
    byMonth[key].invested += parseFloat(t.size);
    byMonth[key].count++;
  }
  const monthlyROI = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { pnl, invested, count }]) => ({
      month,
      roi: invested > 0 ? pnl / invested : 0,
      pnl: Math.round(pnl * 100) / 100,
      tradeCount: count,
    }));

  const monthlyROIs = monthlyROI.map(m => m.roi);
  const avgMonthlyROI = mean(monthlyROIs);
  const stdMonthlyROI = stdDev(monthlyROIs);
  const sharpeScore = stdMonthlyROI > 0 ? avgMonthlyROI / stdMonthlyROI : (avgMonthlyROI > 0 ? 2 : 0);

  // Max consecutive losing months
  let maxLosing = 0, curLosing = 0;
  for (const m of monthlyROI) {
    if (m.roi < 0) { curLosing++; maxLosing = Math.max(maxLosing, curLosing); } else curLosing = 0;
  }
  const consistencyRating =
    sharpeScore >= 1.5 ? "Excellent" : sharpeScore >= 0.8 ? "Good" : sharpeScore >= 0.3 ? "Moderate" : "Volatile";

  // Sport breakdown
  const bySport: Record<string, { invested: number; pnl: number; count: number; won: number }> = {};
  for (const t of settled) {
    const sp = t.sport || "Other";
    if (!bySport[sp]) bySport[sp] = { invested: 0, pnl: 0, count: 0, won: 0 };
    bySport[sp].invested += parseFloat(t.size);
    bySport[sp].pnl += parseFloat(t.settled_pnl) || 0;
    bySport[sp].count++;
    if (t.settled_outcome === "won") bySport[sp].won++;
  }
  // Also track all buy trades for avgBet breakdown
  const avgBetBySport: Record<string, number> = {};
  const allBySport: Record<string, number[]> = {};
  for (const t of trades) {
    const sp = t.sport || "Other";
    if (!allBySport[sp]) allBySport[sp] = [];
    allBySport[sp].push(parseFloat(t.size));
  }
  for (const [sp, sizes] of Object.entries(allBySport)) {
    avgBetBySport[sp] = mean(sizes);
  }
  const roiBySport: Record<string, { roi: number; tradeCount: number; pnl: number; winRate: number; avgBet: number }> = {};
  let topSport = "";
  let topSportROI = -Infinity;
  for (const [sp, d] of Object.entries(bySport)) {
    if (d.count < 5) continue;
    const roi = d.invested > 0 ? d.pnl / d.invested : 0;
    roiBySport[sp] = {
      roi: Math.round(roi * 10000) / 100,
      tradeCount: d.count,
      pnl: Math.round(d.pnl * 100) / 100,
      winRate: Math.round((d.won / d.count) * 1000) / 10,
      avgBet: Math.round(avgBetBySport[sp] || 0),
    };
    if (d.count >= 10 && roi > topSportROI) { topSportROI = roi; topSport = sp; }
  }

  // Market type breakdown
  const byMType: Record<string, { invested: number; pnl: number; count: number; won: number }> = {};
  const allByMType: Record<string, number[]> = {};
  for (const t of trades) {
    const mt = t.market_type || "other";
    if (!allByMType[mt]) allByMType[mt] = [];
    allByMType[mt].push(parseFloat(t.size));
  }
  for (const t of settled) {
    const mt = t.market_type || "other";
    if (!byMType[mt]) byMType[mt] = { invested: 0, pnl: 0, count: 0, won: 0 };
    byMType[mt].invested += parseFloat(t.size);
    byMType[mt].pnl += parseFloat(t.settled_pnl) || 0;
    byMType[mt].count++;
    if (t.settled_outcome === "won") byMType[mt].won++;
  }
  const roiByMarketType: Record<string, { roi: number; tradeCount: number; winRate: number; avgBet: number }> = {};
  let topMarketType = "", topMTROI = -Infinity;
  for (const [mt, d] of Object.entries(byMType)) {
    if (d.count < 5) continue;
    const roi = d.invested > 0 ? d.pnl / d.invested : 0;
    roiByMarketType[mt] = {
      roi: Math.round(roi * 10000) / 100,
      tradeCount: d.count,
      winRate: Math.round((d.won / d.count) * 1000) / 10,
      avgBet: Math.round(mean(allByMType[mt] || [0])),
    };
    if (d.count >= 10 && roi > topMTROI) { topMTROI = roi; topMarketType = mt; }
  }

  // YES / NO breakdown
  const yesTrades = settled.filter(t => t.side === "YES");
  const noTrades = settled.filter(t => t.side === "NO");
  const yesROI = calc(yesTrades);
  const noROI = calc(noTrades);
  const yesBuys = trades.filter(t => t.side === "YES").length;
  const noBuys = trades.filter(t => t.side === "NO").length;
  const preferredSide =
    yesBuys / Math.max(trades.length, 1) > 0.65 ? "YES" :
    noBuys / Math.max(trades.length, 1) > 0.65 ? "NO" : "Balanced";

  // Price tier breakdown
  const longshotSettled = settled.filter(t => parseFloat(t.price) < 0.25);
  const midSettled = settled.filter(t => parseFloat(t.price) >= 0.25 && parseFloat(t.price) <= 0.75);
  const guaranteeSettled = settled.filter(t => parseFloat(t.price) > 0.75);
  const longshotROI = calc(longshotSettled);
  const midrangeROI = calc(midSettled);
  const guaranteeROI = calc(guaranteeSettled);

  // Per-market position sizing insights
  const sizingInsights: string[] = [];
  for (const [sp, avg] of Object.entries(avgBetBySport)) {
    if (avg > avgBetSize * 1.5) sizingInsights.push(`Bets ${(avg / avgBetSize).toFixed(1)}x more on ${sp}`);
  }

  // Sport distribution (% of all bets)
  const sportDistribution: Record<string, number> = {};
  for (const t of trades) {
    const sp = t.sport || "Other";
    sportDistribution[sp] = ((sportDistribution[sp] || 0) + 1);
  }
  for (const sp of Object.keys(sportDistribution)) {
    sportDistribution[sp] = Math.round(sportDistribution[sp] / trades.length * 1000) / 10;
  }

  // Auto tags
  const tags: string[] = [];
  // Sport expert tags (≥10 settled, ROI > 5%)
  const sportTagMap: Record<string, string> = {
    "NBA": "🏀 NBA Expert", "NFL": "🏈 NFL Specialist", "NHL": "🏒 NHL Pro",
    "MLB": "⚾ MLB Expert", "Soccer": "⚽ Soccer Expert", "UFC/MMA": "🥊 UFC Analyst",
    "Tennis": "🎾 Tennis Pro", "eSports": "🎮 eSports Analyst",
    "College Sports": "🎓 College Sports", "Golf": "⛳ Golf Expert", "Formula 1": "🏎️ F1 Expert",
  };
  for (const [sp, d] of Object.entries(roiBySport)) {
    if (d.tradeCount >= 10 && d.roi > 5 && sportTagMap[sp]) tags.push(sportTagMap[sp]);
  }
  // Market type tags
  if ((roiByMarketType["total"]?.tradeCount || 0) >= 10 && (roiByMarketType["total"]?.roi || 0) > 5) tags.push("📊 O/U Specialist");
  if ((roiByMarketType["moneyline"]?.tradeCount || 0) >= 10 && (roiByMarketType["moneyline"]?.roi || 0) > 5) tags.push("📈 Moneyline Pro");
  if ((roiByMarketType["futures"]?.tradeCount || 0) >= 10 && (roiByMarketType["futures"]?.roi || 0) > 5) tags.push("🔮 Futures Trader");
  if ((roiByMarketType["spread"]?.tradeCount || 0) >= 10 && (roiByMarketType["spread"]?.roi || 0) > 5) tags.push("↕️ Spread Expert");
  // Behavior tags
  if (noBuys >= 10 && noROI > yesROI + 0.05) tags.push("❌ NO Bet Specialist");
  if (yesBuys >= 10 && yesROI > noROI + 0.05) tags.push("✅ YES Specialist");
  if (longshotSettled.length >= 10 && longshotROI > 0.1) tags.push("🎲 Long Shot Hunter");
  if (sharpeScore >= 1.5) tags.push("💎 Consistent Grinder");
  if (avgBetSize >= 1000) tags.push("🐋 Big Bettor");
  if (bigBetROI > smallBetROI + 0.1 && bigTrades.length >= 10) tags.push("🎯 High Conviction");

  // Quality score
  const roiComponent = Math.min(Math.max(overallROI / 0.3, 0), 1) * 25;
  const consistencyComponent = Math.min(Math.max(sharpeScore / 2, 0), 1) * 20;
  const recentComponent = Math.min(Math.max(last90dROI / 0.2, 0), 1) * 15;
  const winRateComponent = Math.min(Math.max((winRate - 0.45) / 0.25, 0), 1) * 15;
  const volumeComponent = Math.min(Math.max(Math.log10(Math.max(trades.length, 1)) / Math.log10(1000), 0), 1) * 15;
  const cvComponent = Math.min(Math.max(1 - betSizeCV, 0), 1) * 10;
  const qualityScore = Math.round(
    roiComponent + consistencyComponent + recentComponent + winRateComponent + volumeComponent + cvComponent
  );

  // Top 10 best individual bets
  const bestBets = [...settled]
    .sort((a, b) => (parseFloat(b.settled_pnl) || 0) - (parseFloat(a.settled_pnl) || 0))
    .slice(0, 10)
    .map(t => ({
      title: t.title,
      slug: t.slug,
      sport: t.sport,
      marketType: t.market_type,
      side: t.side,
      price: parseFloat(t.price),
      size: parseFloat(t.size),
      pnl: Math.round((parseFloat(t.settled_pnl) || 0) * 100) / 100,
      date: t.trade_timestamp,
    }));

  const metrics = {
    totalUSDC: Math.round(totalUSDC),
    totalTrades: trades.length,
    settledTrades: settled.length,
    avgBetSize: Math.round(avgBetSize * 100) / 100,
    medianBetSize: Math.round(medianBetSize * 100) / 100,
    betSizeStdDev: Math.round(betSizeStdDev * 100) / 100,
    betSizeCV: Math.round(betSizeCV * 1000) / 1000,
    firstTradeDate: firstTrade,
    lastTradeDate: lastTrade,
    accountAgeDays: Math.round(accountAgeDays),
    tradesPerDay: Math.round(tradesPerDay * 100) / 100,
    avgTradesPerWeek: Math.round(tradesPerDay * 7 * 10) / 10,
    overallROI: Math.round(overallROI * 10000) / 100,
    overallPNL: Math.round(settledPnl * 100) / 100,
    winRate: Math.round(winRate * 1000) / 10,
    last30dROI: Math.round(last30dROI * 10000) / 100,
    last90dROI: Math.round(last90dROI * 10000) / 100,
    bigBetROI: Math.round(bigBetROI * 10000) / 100,
    smallBetROI: Math.round(smallBetROI * 10000) / 100,
    sharpeScore: Math.round(sharpeScore * 100) / 100,
    consistencyRating,
    maxConsecLosingMonths: maxLosing,
    monthlyROI,
    roiBySport,
    topSport,
    roiByMarketType,
    topMarketType,
    sportDistribution,
    avgBetBySport: Object.fromEntries(Object.entries(avgBetBySport).map(([k, v]) => [k, Math.round(v)])),
    sizingInsights,
    yesROI: Math.round(yesROI * 10000) / 100,
    noROI: Math.round(noROI * 10000) / 100,
    yesTradeCount: yesBuys,
    noTradeCount: noBuys,
    preferredSide,
    longshotROI: Math.round(longshotROI * 10000) / 100,
    longshotCount: trades.filter(t => parseFloat(t.price) < 0.25).length,
    midrangeROI: Math.round(midrangeROI * 10000) / 100,
    midrangeCount: trades.filter(t => parseFloat(t.price) >= 0.25 && parseFloat(t.price) <= 0.75).length,
    guaranteeROI: Math.round(guaranteeROI * 10000) / 100,
    guaranteeCount: trades.filter(t => parseFloat(t.price) > 0.75).length,
    bestBets,
  };

  // Save to DB
  await pool.query(`
    INSERT INTO elite_trader_profiles (wallet, username, computed_at, metrics, tags, quality_score)
    VALUES ($1, $2, NOW(), $3, $4, $5)
    ON CONFLICT (wallet) DO UPDATE SET
      username = EXCLUDED.username,
      computed_at = NOW(),
      metrics = EXCLUDED.metrics,
      tags = EXCLUDED.tags,
      quality_score = EXCLUDED.quality_score
  `, [w, username, JSON.stringify(metrics), tags, qualityScore]);

  return { wallet: w, username, qualityScore, tags, metrics };
}

// ─── CSV generator ─────────────────────────────────────────────────────────────

export async function generateTraderCSV(wallet: string): Promise<string> {
  const { rows } = await pool.query(`
    SELECT * FROM elite_trader_trades
    WHERE wallet = $1 AND is_buy = TRUE
    ORDER BY trade_timestamp DESC
  `, [wallet.toLowerCase()]);

  const headers = ["date", "market", "slug", "sport", "market_type", "side", "outcome", "price_cents", "size_usdc", "longshot", "guarantee", "result", "pnl"];
  const lines = [headers.join(",")];

  for (const t of rows) {
    const date = new Date(t.trade_timestamp).toISOString().slice(0, 10);
    const result = t.settled_outcome || "open";
    const pnl = t.settled_pnl != null ? parseFloat(t.settled_pnl).toFixed(2) : "";
    lines.push([
      date,
      `"${(t.title || "").replace(/"/g, '""')}"`,
      t.slug || "",
      t.sport || "",
      t.market_type || "",
      t.side,
      t.outcome || "",
      Math.round(parseFloat(t.price) * 100),
      parseFloat(t.size).toFixed(2),
      t.is_longshot ? "1" : "0",
      t.is_guarantee ? "1" : "0",
      result,
      pnl,
    ].join(","));
  }

  return lines.join("\n");
}

// ─── Seed curated traders on startup ─────────────────────────────────────────

export async function seedCuratedTraders(): Promise<void> {
  for (const t of CURATED_TRADERS) {
    const hasWallet = t.wallet && t.wallet.length > 0;
    try {
      await pool.query(`
        INSERT INTO elite_traders (wallet, username, wallet_resolved, polymarket_url)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (wallet) DO NOTHING
      `, [
        hasWallet ? t.wallet.toLowerCase() : `pending-${t.username.toLowerCase()}`,
        t.username,
        hasWallet,
        t.url || null,
      ]);
      if (hasWallet) {
        curatedWalletSet.add(t.wallet.toLowerCase());
        curatedWalletToUsername.set(t.wallet.toLowerCase(), t.username);
      }
    } catch (_) { }
  }

  // Also load any previously resolved wallets from DB
  try {
    const { rows } = await pool.query(`SELECT wallet, username FROM elite_traders WHERE wallet_resolved = TRUE`);
    for (const r of rows) {
      if (r.wallet && !r.wallet.startsWith("pending-")) {
        curatedWalletSet.add(r.wallet.toLowerCase());
        curatedWalletToUsername.set(r.wallet.toLowerCase(), r.username);
      }
    }
  } catch (_) { }
}

// ─── Background analysis for a trader ────────────────────────────────────────

export async function runAnalysisForTrader(wallet: string): Promise<void> {
  try {
    const { rows } = await pool.query(`SELECT last_analyzed_at FROM elite_traders WHERE wallet = $1`, [wallet]);
    const since = rows[0]?.last_analyzed_at ? new Date(rows[0].last_analyzed_at).getTime() : undefined;
    await fetchFullTradeHistory(wallet, since);
    await settleUnresolvedTrades(wallet);
    await computeTraderProfile(wallet);
    console.log(`[Elite] Analysis complete for ${wallet}`);
  } catch (err: any) {
    console.error(`[Elite] Analysis failed for ${wallet}:`, err.message);
  }
}

// ─── Periodic refresh (every 24h) ────────────────────────────────────────────

export function startPeriodicRefresh(): void {
  setInterval(async () => {
    try {
      const { rows } = await pool.query(`SELECT wallet FROM elite_traders WHERE wallet_resolved = TRUE`);
      for (const r of rows) {
        if (!r.wallet.startsWith("pending-")) {
          await runAnalysisForTrader(r.wallet);
          await new Promise(res => setTimeout(res, 2000)); // stagger requests
        }
      }
    } catch (err: any) {
      console.error("[Elite] Periodic refresh error:", err.message);
    }
  }, 24 * 60 * 60 * 1000);
}
