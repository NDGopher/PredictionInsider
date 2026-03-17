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
  { wallet: "0xee00ba338c59557141789b127927a55f5cc5cea1", username: "S-Works", url: "https://polymarket.com/@S-Works" },
  { wallet: "0xe40172522c7c64afa2d052ddae6c92cd0f417b88", username: "BoomLaLa", url: "https://polymarket.com/@BoomLaLa" },
  { wallet: "0x9f138019d5481fdc5c59b93b0ae4b9b817cce0fd", username: "Bienville", url: "https://polymarket.com/@Bienville" },
  { wallet: "0x8c0b024c17831a0dde038547b7e791ae6a0d7aa5", username: "IBOV200K", url: "https://polymarket.com/@IBOV200K" },
  { wallet: "0x6b7c75862e64d6e976d2c08ad9f9b54add6c5f83", username: "tcp2", url: "https://polymarket.com/@tcp2" },
  { wallet: "0xec981ed70ae69c5cbcac08c1ba063e734f6bafcd", username: "0xheavy888", url: "https://polymarket.com/@0xheavy888" },
  { wallet: "0x68146921df11eab44296dc4e58025ca84741a9e7", username: "LynxTitan", url: "https://polymarket.com/@LynxTitan" },
  { wallet: "0x0b9cae2b0dfe7a71c413e0604eaac1c352f87e44", username: "geniusMC", url: "https://polymarket.com/@geniusMC" },
  { wallet: "0xe24838258b572f1771dffba3bcdde57a78def293", username: "redskinrick", url: "https://polymarket.com/@redskinrick" },
  { wallet: "0x6c743aafd813475986dcd930f380a1f50901bd4e", username: "middleoftheocean", url: "https://polymarket.com/@middleoftheocean" },
  { wallet: "0x39932ca2b7a1b8ab6cbf0b8f7419261b950ccded", username: "Andromeda1", url: "https://polymarket.com/@Andromeda1" },
  { wallet: "0x5c3a1a602848565bb16165fcd460b00c3d43020b", username: "CoryLahey", url: "https://polymarket.com/@CoryLahey" },
  { wallet: "0xafd492974cd531aae7786210438ae46b42047e61", username: "TheArena", url: "https://polymarket.com/@TheArena" },
  { wallet: "0xb2a48372404e6a0bfb6c2f23d715d3acc5a8cf8a", username: "chenpengzao", url: "https://polymarket.com/@chenpengzao" },
  { wallet: "0x3471a897e56a8d3621ca79af87dae4325977f17e", username: "xytest", url: "https://polymarket.com/@xytest" },
  { wallet: "0xc65ca4755436f82d8eb461e65781584b8cadea39", username: "UAEVALORANTFAN", url: "https://polymarket.com/@UAEVALORANTFAN" },
  { wallet: "0x9703676286b93c2eca71ca96e8757104519a69c2", username: "TheMangler", url: "https://polymarket.com/@TheMangler" },
  { wallet: "0xc49fe658479db29e1a2fefebf0735f657dca9e05", username: "iDropMyHotdog", url: "https://polymarket.com/@iDropMyHotdog" },
  { wallet: "0x58f8f1138be2192696378629fc9aa23c7910dc70", username: "bloodmaster", url: "https://polymarket.com/@bloodmaster" },
  { wallet: "0xf9b5f7293b8258be8b0e1f03717c5d2ad94809ee", username: "9sh8f", url: "https://polymarket.com/@9sh8f" },
  { wallet: "0x53ecc53e7a69aad0e6dda60264cc2e363092df91", username: "0x53eCc53E7", url: "https://polymarket.com/@0x53eCc53E7" },
  { wallet: "0x1b5e20a28d7115f10ce6190a5ae9a91169be83f8", username: "877s8d8g89I9f8d98fd99ww2", url: "https://polymarket.com/@877s8d8g89I9f8d98fd99ww2" },
  { wallet: "0x9c82c60829df081d593055ee5fa288870c051f13", username: "Vetch", url: "https://polymarket.com/@Vetch" },
  { wallet: "0x25867077c891354137bbaf7fde12eec6949cc893", username: "TTdes", url: "https://polymarket.com/@TTdes" },
  { wallet: "0x4133bcbad1d9c41de776646696f41c34d0a65e70", username: "EF203F2IPFC2ICP20W-CP3", url: "https://polymarket.com/@EF203F2IPFC2ICP20W-CP3" },
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
      s.includes("dota") || s.includes("cs2-") || s.startsWith("cs-") || s.includes("csgop5") ||
      t.includes("esport") || t.includes("valorant") || t.includes("league of legends") ||
      t.includes("dota 2") || t.includes("counter-strike") || t.includes("cs2") || t.includes("dota2")) return "eSports";
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      headers: { "User-Agent": "PredictionInsider/1.0" },
      signal: controller.signal,
    });
    clearTimeout(timer);
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
            settled_pnl = CASE WHEN side = 'YES' THEN size * (1.0 - price) ELSE -(size * price) END
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
            settled_pnl = CASE WHEN side = 'NO' THEN size * (1.0 - price) ELSE -(size * price) END
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
        settled_pnl = CASE WHEN side = 'YES' THEN size * (1.0 - price) ELSE -(size * price) END
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
        settled_pnl = CASE WHEN side = 'NO' THEN size * (1.0 - price) ELSE -(size * price) END
      WHERE wallet = $2 AND is_buy = TRUE AND settled_outcome IS NULL AND condition_id IN (${placeholders})
    `, [settledAt, w, ...noWonIds]);
    totalUpdated += rowCount ?? 0;
  }

  return totalUpdated;
}

// ─── Fetch ALL activity (trades + redeems) using cursor pagination ────────────
// Uses before=timestamp cursor to bypass the 3000 offset limit.
// Stores TRADE (buy/sell) and REDEEM events in elite_trader_activity.

export async function fetchAllActivity(
  wallet: string,
  sinceTs?: number, // Unix seconds — stop fetching events older than this
  maxPages = 1 // Activity API 'before' cursor is broken (always returns same page); fetch 1 page for recent REDEEMs only
): Promise<number> {
  const PAGE = 500;
  let before: number | null = null;
  let totalInserted = 0;
  let pagesFetched = 0;
  const walletLower = wallet.toLowerCase();

  const batch: any[][] = [];
  const flushBatch = async () => {
    if (!batch.length) return;
    const placeholders = batch.map((_, i) => {
      const base = i * 15;
      return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13},$${base+14},$${base+15})`;
    }).join(",");
    const flat = batch.flat();
    try {
      await pool.query(`
        INSERT INTO elite_trader_activity
          (wallet, condition_id, event_type, side, size, usdc_size, price, outcome_index,
           event_timestamp, title, slug, outcome, sport, market_type, transaction_hash)
        VALUES ${placeholders}
        ON CONFLICT (wallet, transaction_hash) DO NOTHING
      `, flat);
      totalInserted += batch.length;
    } catch (_) {
      for (const row of batch) {
        try {
          await pool.query(`
            INSERT INTO elite_trader_activity
              (wallet, condition_id, event_type, side, size, usdc_size, price, outcome_index,
               event_timestamp, title, slug, outcome, sport, market_type, transaction_hash)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            ON CONFLICT (wallet, transaction_hash) DO NOTHING
          `, row);
          totalInserted++;
        } catch (__) {}
      }
    }
    batch.length = 0;
  };

  while (true) {
    if (pagesFetched >= maxPages) break;
    pagesFetched++;
    const url = before
      ? `${DATA_API}/activity?user=${walletLower}&limit=${PAGE}&before=${before}`
      : `${DATA_API}/activity?user=${walletLower}&limit=${PAGE}`;
    const data = await fetchJson(url);
    if (!Array.isArray(data) || data.length === 0) break;

    let hitSince = false;
    for (const ev of data) {
      if (!ev.conditionId) continue;

      // Stop when we reach events older than sinceTs (already fetched)
      if (sinceTs && ev.timestamp && ev.timestamp < sinceTs) {
        hitSince = true;
        break;
      }

      const sport = classifySport(ev.slug || "", ev.title || "");
      const mType = classifyMarketType(ev.slug || "", ev.title || "", ev.outcome || "");
      const side = (ev.side || "").toUpperCase() || null;
      const usdcSize = parseFloat(ev.usdcSize) || 0;
      const size = parseFloat(ev.size) || 0;
      const price = parseFloat(ev.price) || 0;
      const outcomeIdx = ev.outcomeIndex != null && ev.outcomeIndex !== 999 ? ev.outcomeIndex : -1;
      const txHash = ev.transactionHash || null;

      batch.push([
        walletLower, ev.conditionId, ev.type || "TRADE",
        side, size, usdcSize, price, outcomeIdx,
        ev.timestamp,
        (ev.title || "").slice(0, 500), ev.slug || "", ev.outcome || "",
        sport, mType, txHash,
      ]);

      if (batch.length >= 100) await flushBatch();
    }

    await flushBatch();
    if (hitSince) break;
    if (data.length < PAGE) break;

    // Cursor: oldest timestamp on this page → get events BEFORE it
    before = data[data.length - 1].timestamp;
    await new Promise(r => setTimeout(r, 80));
  }

  await flushBatch();
  return totalInserted;
}

// ─── Compute trader profile from activity (correct PNL via REDEEM events) ─────

export async function computeTraderProfileFromActivity(wallet: string): Promise<any | null> {
  const w = wallet.toLowerCase();

  const uRow = await pool.query(`SELECT username FROM elite_traders WHERE wallet = $1`, [w]);
  const username = uRow.rows[0]?.username || w.slice(0, 10);

  const { rows: activity } = await pool.query(`
    SELECT * FROM elite_trader_activity WHERE wallet = $1 ORDER BY event_timestamp ASC
  `, [w]);

  if (!activity.length) return null;

  // Group by condition_id → one "position" per market
  type PosBucket = {
    conditionId: string; title: string; slug: string; sport: string; marketType: string;
    costBasis: number; sellProceeds: number; redeemValue: number; redeemCount: number;
    firstBuyTs: number; lastTs: number;
    buyPriceSum: number; buyPriceCt: number;
    outcomeIndex: number; side: string; buyUsdcSizes: number[];
  };

  const posMap = new Map<string, PosBucket>();

  for (const ev of activity) {
    const cid = ev.condition_id;
    if (!posMap.has(cid)) {
      posMap.set(cid, {
        conditionId: cid, title: ev.title || "", slug: ev.slug || "",
        sport: ev.sport || "Other", marketType: ev.market_type || "moneyline",
        costBasis: 0, sellProceeds: 0, redeemValue: 0, redeemCount: 0,
        firstBuyTs: Infinity, lastTs: 0,
        buyPriceSum: 0, buyPriceCt: 0,
        outcomeIndex: -1, side: "YES", buyUsdcSizes: [],
      });
    }
    const pos = posMap.get(cid)!;
    pos.lastTs = Math.max(pos.lastTs, Number(ev.event_timestamp));

    if (ev.event_type === "TRADE" && ev.side === "BUY") {
      const u = parseFloat(ev.usdc_size) || 0;
      pos.costBasis += u;
      pos.buyUsdcSizes.push(u);
      pos.firstBuyTs = Math.min(pos.firstBuyTs, Number(ev.event_timestamp));
      const p = parseFloat(ev.price) || 0;
      if (p > 0) { pos.buyPriceSum += p; pos.buyPriceCt++; }
      if (pos.outcomeIndex === -1 && ev.outcome_index != null && ev.outcome_index >= 0) {
        pos.outcomeIndex = ev.outcome_index;
        pos.side = ev.outcome_index === 0 ? "YES" : "NO";
      }
    } else if (ev.event_type === "TRADE" && ev.side === "SELL") {
      pos.sellProceeds += parseFloat(ev.usdc_size) || 0;
    } else if (ev.event_type === "REDEEM") {
      pos.redeemValue += parseFloat(ev.usdc_size) || 0;
      pos.redeemCount++;
    }
  }

  // For condition_ids where we have REDEEM/SELL but no BUY (activity API doesn't return old buys),
  // supplement cost basis from the trades table (which stores BUY trades from /trades API).
  const condIdsWithNobuys = [...posMap.values()]
    .filter(p => p.costBasis === 0 && (p.redeemCount > 0 || p.sellProceeds > 0))
    .map(p => p.conditionId);

  if (condIdsWithNobuys.length > 0) {
    const { rows: tradeBuys } = await pool.query(`
      SELECT condition_id, SUM(size) as total_cost, AVG(price) as avg_price,
             COUNT(*) as cnt, MIN(EXTRACT(EPOCH FROM trade_timestamp)) as first_ts,
             MAX(outcome_index) as oi
      FROM elite_trader_trades
      WHERE wallet = $1 AND is_buy = TRUE AND condition_id = ANY($2)
      GROUP BY condition_id
    `, [w, condIdsWithNobuys]);

    for (const tr of tradeBuys) {
      const pos = posMap.get(tr.condition_id);
      if (!pos) continue;
      const cost = parseFloat(tr.total_cost) || 0;
      pos.costBasis += cost;
      if (cost > 0) pos.buyUsdcSizes.push(cost);
      if (tr.avg_price > 0) { pos.buyPriceSum += parseFloat(tr.avg_price) * Number(tr.cnt); pos.buyPriceCt += Number(tr.cnt); }
      if (tr.first_ts) pos.firstBuyTs = Math.min(pos.firstBuyTs, Number(tr.first_ts));
      if (pos.outcomeIndex === -1 && tr.oi != null && tr.oi >= 0) {
        pos.outcomeIndex = Number(tr.oi);
        pos.side = pos.outcomeIndex === 0 ? "YES" : "NO";
      }
    }
  }

  // Only positions where we actually bought something
  const positions = [...posMap.values()]
    .filter(p => p.costBasis > 0)
    .map(pos => {
      const cashPnl = pos.sellProceeds + pos.redeemValue - pos.costBasis;
      const isSettled = pos.redeemCount > 0;
      const avgPrice = pos.buyPriceCt > 0 ? pos.buyPriceSum / pos.buyPriceCt : 0;
      return {
        ...pos,
        cashPnl,
        isSettled,
        isWon: isSettled && cashPnl > 0.01,
        isLost: isSettled && cashPnl <= 0.01,
        avgPrice,
        betSize: pos.costBasis,
      };
    });

  if (!positions.length) return null;

  const settled = positions.filter(p => p.isSettled);

  // If activity-based data is sparse (missing BUY events for most REDEEMs),
  // fall back to trades-based computation which uses settlement outcomes.
  // This happens for high-frequency traders where the /trades API only covers
  // a fraction of their history (3500-trade API limit).
  if (settled.length < 10) return null;
  const won = settled.filter(p => p.isWon);
  const open = positions.filter(p => !p.isSettled);

  const betSizes = positions.map(p => p.betSize);
  const avgBetSize = mean(betSizes);
  const medianBetSize = median(betSizes);
  const betSizeStdDev = stdDev(betSizes);
  const betSizeCV = avgBetSize > 0 ? betSizeStdDev / avgBetSize : 0;

  const totalUSDC = positions.reduce((a, p) => a + p.costBasis, 0);

  const validTs = positions.filter(p => p.firstBuyTs !== Infinity);
  const firstTs = validTs.length ? Math.min(...validTs.map(p => p.firstBuyTs)) : Date.now() / 1000;
  const lastTs = Math.max(...positions.map(p => p.lastTs));
  const accountAgeDays = Math.max((lastTs - firstTs) / 86400, 1);
  const tradesPerDay = positions.length / accountAgeDays;

  const settledCostBasis = settled.reduce((a, p) => a + p.costBasis, 0);
  const settledPnl = settled.reduce((a, p) => a + p.cashPnl, 0);
  const overallROI = settledCostBasis > 0 ? settledPnl / settledCostBasis : 0;
  const winRate = settled.length > 0 ? won.length / settled.length : 0;

  const nowSec = Date.now() / 1000;
  const calcROI = (arr: typeof settled) => {
    const cost = arr.reduce((a, p) => a + p.costBasis, 0);
    const pnl = arr.reduce((a, p) => a + p.cashPnl, 0);
    return cost > 0 ? pnl / cost : 0;
  };
  const last30dROI = calcROI(settled.filter(p => p.firstBuyTs > nowSec - 30 * 86400));
  const last90dROI = calcROI(settled.filter(p => p.firstBuyTs > nowSec - 90 * 86400));

  const p90 = [...betSizes].sort((a, b) => a - b)[Math.floor(betSizes.length * 0.9)] || avgBetSize;
  const bigBetROI = calcROI(settled.filter(p => p.betSize >= p90));
  const smallBetROI = calcROI(settled.filter(p => p.betSize <= medianBetSize));

  // Monthly ROI
  const byMonth: Record<string, { pnl: number; invested: number; count: number }> = {};
  for (const p of settled) {
    const d = new Date(p.firstBuyTs * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[key]) byMonth[key] = { pnl: 0, invested: 0, count: 0 };
    byMonth[key].pnl += p.cashPnl;
    byMonth[key].invested += p.costBasis;
    byMonth[key].count++;
  }
  const monthlyROI = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { pnl, invested, count }]) => ({
      month,
      roi: invested > 0 ? Math.round((pnl / invested) * 10000) / 100 : 0, // percentage
      pnl: Math.round(pnl * 100) / 100, tradeCount: count,
    }));
  // Sharpe uses ratio form to keep scale-invariant thresholds
  const monthlyROIs = monthlyROI.map(m => m.roi / 100);
  const avgMROI = mean(monthlyROIs);
  const stdMROI = stdDev(monthlyROIs);
  const sharpeScore = stdMROI > 0 ? avgMROI / stdMROI : (avgMROI > 0 ? 2 : 0);

  let maxLosing = 0, curLosing = 0;
  for (const m of monthlyROI) {
    if (m.roi < 0) { curLosing++; maxLosing = Math.max(maxLosing, curLosing); } else curLosing = 0;
  }
  const consistencyRating =
    sharpeScore >= 1.5 ? "Excellent" : sharpeScore >= 0.8 ? "Good" : sharpeScore >= 0.3 ? "Moderate" : "Volatile";

  // Sport/market type breakdowns
  type SportBucket = { invested: number; pnl: number; count: number; won: number; sizes: number[] };
  const bySport: Record<string, SportBucket> = {};
  const byMType: Record<string, SportBucket> = {};

  for (const p of positions) {
    const sp = p.sport || "Other";
    const mt = p.marketType || "moneyline";
    if (!bySport[sp]) bySport[sp] = { invested: 0, pnl: 0, count: 0, won: 0, sizes: [] };
    if (!byMType[mt]) byMType[mt] = { invested: 0, pnl: 0, count: 0, won: 0, sizes: [] };
    bySport[sp].sizes.push(p.betSize);
    byMType[mt].sizes.push(p.betSize);
  }
  for (const p of settled) {
    const sp = p.sport || "Other";
    const mt = p.marketType || "moneyline";
    bySport[sp].invested += p.costBasis; bySport[sp].pnl += p.cashPnl;
    bySport[sp].count++; if (p.isWon) bySport[sp].won++;
    byMType[mt].invested += p.costBasis; byMType[mt].pnl += p.cashPnl;
    byMType[mt].count++; if (p.isWon) byMType[mt].won++;
  }

  const buildBreakdown = (map: Record<string, SportBucket>) => {
    const result: Record<string, any> = {};
    let top = "", topROI = -Infinity;
    for (const [key, d] of Object.entries(map)) {
      if (d.count < 5) continue;
      const roi = d.invested > 0 ? d.pnl / d.invested : 0;
      result[key] = {
        roi: Math.round(roi * 10000) / 100,
        tradeCount: d.count,
        pnl: Math.round(d.pnl * 100) / 100,
        winRate: Math.round((d.won / d.count) * 1000) / 10,
        avgBet: Math.round(mean(d.sizes || [0])),
      };
      if (d.count >= 10 && roi > topROI) { topROI = roi; top = key; }
    }
    return { result, top };
  };

  const { result: roiBySport, top: topSport } = buildBreakdown(bySport);
  const { result: roiByMarketType, top: topMarketType } = buildBreakdown(byMType);

  const yesBuys = positions.filter(p => p.side === "YES").length;
  const noBuys = positions.filter(p => p.side === "NO").length;
  const yesROI = calcROI(settled.filter(p => p.side === "YES"));
  const noROI = calcROI(settled.filter(p => p.side === "NO"));
  const preferredSide =
    yesBuys / Math.max(positions.length, 1) > 0.65 ? "YES" :
    noBuys / Math.max(positions.length, 1) > 0.65 ? "NO" : "Balanced";

  const longshotSettled = settled.filter(p => p.avgPrice < 0.25);
  const midSettled = settled.filter(p => p.avgPrice >= 0.25 && p.avgPrice <= 0.75);
  const guaranteeSettled = settled.filter(p => p.avgPrice > 0.75);

  const sportDistribution: Record<string, number> = {};
  for (const p of positions) {
    const sp = p.sport || "Other";
    sportDistribution[sp] = ((sportDistribution[sp] || 0) + 1);
  }
  for (const sp of Object.keys(sportDistribution)) {
    sportDistribution[sp] = Math.round(sportDistribution[sp] / positions.length * 1000) / 10;
  }

  const avgBetBySport: Record<string, number> = {};
  for (const [sp, d] of Object.entries(bySport)) {
    avgBetBySport[sp] = Math.round(mean(d.sizes || [0]));
  }
  const sizingInsights: string[] = [];
  for (const [sp, avg] of Object.entries(avgBetBySport)) {
    if (avg > avgBetSize * 1.5) sizingInsights.push(`Bets ${(avg / avgBetSize).toFixed(1)}x more on ${sp}`);
  }

  // Auto tags
  const tags: string[] = [];
  const sportTagMap: Record<string, string> = {
    "NBA": "🏀 NBA Expert", "NFL": "🏈 NFL Specialist", "NHL": "🏒 NHL Pro",
    "MLB": "⚾ MLB Expert", "Soccer": "⚽ Soccer Expert", "UFC/MMA": "🥊 UFC Analyst",
    "Tennis": "🎾 Tennis Pro", "eSports": "🎮 eSports Analyst",
    "College Sports": "🎓 College Sports", "Golf": "⛳ Golf Expert", "Formula 1": "🏎️ F1 Expert",
  };
  // Sport expert tags: qualify by ROI>5% OR high absolute PNL (≥$20K settled profit).
  for (const [sp, d] of Object.entries(roiBySport)) {
    const isExpert = d.tradeCount >= 10 && sportTagMap[sp] && (d.roi > 5 || d.pnl >= 20000);
    if (isExpert) tags.push(sportTagMap[sp]);
  }
  if ((roiByMarketType["total"]?.tradeCount || 0) >= 10 && (roiByMarketType["total"]?.roi || 0) > 5) tags.push("📊 O/U Specialist");
  if ((roiByMarketType["moneyline"]?.tradeCount || 0) >= 10 && (roiByMarketType["moneyline"]?.roi || 0) > 5) tags.push("📈 Moneyline Pro");
  if ((roiByMarketType["futures"]?.tradeCount || 0) >= 10 && (roiByMarketType["futures"]?.roi || 0) > 5) tags.push("🔮 Futures Trader");
  if ((roiByMarketType["spread"]?.tradeCount || 0) >= 10 && (roiByMarketType["spread"]?.roi || 0) > 5) tags.push("↕️ Spread Expert");
  if (noBuys >= 10 && noROI > yesROI + 0.05) tags.push("❌ NO Bet Specialist");
  if (yesBuys >= 10 && yesROI > noROI + 0.05) tags.push("✅ YES Specialist");
  if (longshotSettled.length >= 10 && calcROI(longshotSettled) > 0.1) tags.push("🎲 Long Shot Hunter");
  if (sharpeScore >= 1.5) tags.push("💎 Consistent Grinder");
  if (avgBetSize >= 1000) tags.push("🐋 Big Bettor");
  if (bigBetROI > smallBetROI + 0.1 && settled.filter(p => p.betSize >= p90).length >= 10) tags.push("🎯 High Conviction");

  // Quality score
  const qualityScore = Math.round(
    Math.min(Math.max(overallROI / 0.3, 0), 1) * 25 +
    Math.min(Math.max(sharpeScore / 2, 0), 1) * 20 +
    Math.min(Math.max(last90dROI / 0.2, 0), 1) * 15 +
    Math.min(Math.max((winRate - 0.45) / 0.25, 0), 1) * 15 +
    Math.min(Math.max(Math.log10(Math.max(positions.length, 1)) / Math.log10(1000), 0), 1) * 15 +
    Math.min(Math.max(1 - betSizeCV, 0), 1) * 10
  );

  const bestBets = [...settled]
    .sort((a, b) => b.cashPnl - a.cashPnl)
    .slice(0, 10)
    .map(p => ({
      title: p.title, slug: p.slug, sport: p.sport, marketType: p.marketType,
      side: p.side, price: Math.round(p.avgPrice * 100) / 100,
      size: Math.round(p.betSize * 100) / 100,
      pnl: Math.round(p.cashPnl * 100) / 100,
      date: new Date(p.firstBuyTs * 1000).toISOString(),
    }));

  const metrics = {
    totalUSDC: Math.round(totalUSDC),
    totalTrades: positions.length,
    settledTrades: settled.length,
    openPositions: open.length,
    avgBetSize: Math.round(avgBetSize * 100) / 100,
    medianBetSize: Math.round(medianBetSize * 100) / 100,
    betSizeStdDev: Math.round(betSizeStdDev * 100) / 100,
    betSizeCV: Math.round(betSizeCV * 1000) / 1000,
    firstTradeDate: new Date(firstTs * 1000).toISOString(),
    lastTradeDate: new Date(lastTs * 1000).toISOString(),
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
    consistencyRating, maxConsecLosingMonths: maxLosing,
    monthlyROI, roiBySport, topSport, roiByMarketType, topMarketType,
    sportDistribution, avgBetBySport, sizingInsights,
    yesROI: Math.round(yesROI * 10000) / 100,
    noROI: Math.round(noROI * 10000) / 100,
    yesTradeCount: yesBuys, noTradeCount: noBuys, preferredSide,
    longshotROI: Math.round(calcROI(longshotSettled) * 10000) / 100,
    longshotCount: positions.filter(p => p.avgPrice < 0.25).length,
    midrangeROI: Math.round(calcROI(midSettled) * 10000) / 100,
    midrangeCount: positions.filter(p => p.avgPrice >= 0.25 && p.avgPrice <= 0.75).length,
    guaranteeROI: Math.round(calcROI(guaranteeSettled) * 10000) / 100,
    guaranteeCount: positions.filter(p => p.avgPrice > 0.75).length,
    bestBets,
    dataSource: "activity",
  };

  await pool.query(`
    INSERT INTO elite_trader_profiles (wallet, username, computed_at, metrics, tags, quality_score)
    VALUES ($1, $2, NOW(), $3, $4, $5)
    ON CONFLICT (wallet) DO UPDATE SET
      username = EXCLUDED.username, computed_at = NOW(),
      metrics = CASE
        WHEN elite_trader_profiles.metrics->>'manualPnlOverride' = 'true'
          OR elite_trader_profiles.metrics->>'pnlSource' = 'closed_positions_api'
        THEN EXCLUDED.metrics || elite_trader_profiles.metrics
        ELSE EXCLUDED.metrics
        END,
      tags = EXCLUDED.tags,
      quality_score = CASE
        WHEN elite_trader_profiles.metrics->>'pnlSource' = 'closed_positions_api'
        THEN elite_trader_profiles.quality_score
        ELSE EXCLUDED.quality_score
        END
  `, [w, username, JSON.stringify(metrics), tags, qualityScore]);

  return { wallet: w, username, qualityScore, tags, metrics };
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
// Tries activity-based computation first (accurate REDEEM PNL), falls back to trades.

export async function computeTraderProfile(wallet: string): Promise<any> {
  const w = wallet.toLowerCase();

  // Try activity-based computation ONLY if it covers significantly more settled bets
  // than the trades DB. Since we now fetch only 1 page (500 events) from the activity
  // API, the trades-based computation from elite_trader_trades is usually more complete.
  // The trades formula is now correct: win = size*(1-price), loss = -(size*price).
  const activityResult = await computeTraderProfileFromActivity(w);

  // Count settled trades in DB for comparison
  const { rows: dbSettledRows } = await pool.query(
    `SELECT COUNT(*) as cnt FROM elite_trader_trades WHERE wallet = $1 AND is_buy = TRUE AND settled_outcome IS NOT NULL`,
    [w]
  );
  const dbSettledCount = parseInt(dbSettledRows[0]?.cnt || "0");
  const activitySettledCount = activityResult?.metrics?.settledBets ?? 0;

  // Use activity result only if it has more settled bets than our trades DB
  if (activityResult && activitySettledCount > dbSettledCount && (activityResult.metrics?.overallPNL ?? 0) !== 0) {
    return activityResult;
  }

  // Primary: trades-based computation (uses correctly-settled elite_trader_trades)

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
      roi: invested > 0 ? Math.round((pnl / invested) * 10000) / 100 : 0, // percentage
      pnl: Math.round(pnl * 100) / 100,
      tradeCount: count,
    }));

  // Sharpe uses ratio form to keep scale-invariant thresholds
  const monthlyROIs = monthlyROI.map(m => m.roi / 100);
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
  // Sport expert tags: qualify by ROI>5% OR high absolute PNL (≥$20K settled profit).
  // PNL threshold matters because active traders with many open winning positions
  // may show low settled ROI while having significant real-world gains.
  for (const [sp, d] of Object.entries(roiBySport)) {
    const isExpert = d.tradeCount >= 10 && sportTagMap[sp] && (d.roi > 5 || d.pnl >= 20000);
    if (isExpert) tags.push(sportTagMap[sp]);
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

  // Save to DB — canonical metrics (pnlSource=closed_positions_api) always win over activity-based
  await pool.query(`
    INSERT INTO elite_trader_profiles (wallet, username, computed_at, metrics, tags, quality_score)
    VALUES ($1, $2, NOW(), $3, $4, $5)
    ON CONFLICT (wallet) DO UPDATE SET
      username = EXCLUDED.username,
      computed_at = NOW(),
      metrics = CASE
        WHEN elite_trader_profiles.metrics->>'manualPnlOverride' = 'true'
          OR elite_trader_profiles.metrics->>'pnlSource' = 'closed_positions_api'
        THEN EXCLUDED.metrics || elite_trader_profiles.metrics
        ELSE EXCLUDED.metrics
        END,
      tags = EXCLUDED.tags,
      quality_score = CASE
        WHEN elite_trader_profiles.metrics->>'pnlSource' = 'closed_positions_api'
        THEN elite_trader_profiles.quality_score
        ELSE EXCLUDED.quality_score
        END
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
    const w = wallet.toLowerCase();

    // Use the newest event we already have as the sinceTs cursor (not last_analyzed_at).
    // This lets us fetch only NEW events on incremental refresh without stopping on all old events.
    const { rows: newestRows } = await pool.query(
      `SELECT MAX(event_timestamp) as newest_ts FROM elite_trader_activity WHERE wallet = $1`, [w]
    );
    const newestTs = newestRows[0]?.newest_ts ? Number(newestRows[0].newest_ts) : undefined;

    // Fetch all activity (TRADE + REDEEM events) using cursor pagination — correct PNL source
    const activityCount = await fetchAllActivity(w, newestTs);
    console.log(`[Elite] ${w}: fetched ${activityCount} activity events (since ts: ${newestTs || 'beginning'})`);

    // Use the trades table's own newest timestamp as the cutoff for incremental trade fetching
    // (NOT the activity timestamp — they're different endpoints with different event ranges)
    const { rows: newestTradeRows } = await pool.query(
      `SELECT MAX(EXTRACT(EPOCH FROM trade_timestamp)::bigint * 1000) as newest_ms FROM elite_trader_trades WHERE wallet = $1`, [w]
    );
    const tradesSinceMs = newestTradeRows[0]?.newest_ms ? Number(newestTradeRows[0].newest_ms) : undefined;

    // Also fetch trades (for signal detection — current open positions)
    await fetchFullTradeHistory(w, tradesSinceMs);

    // Settle unsettled buy-trades via Gamma (keeps signals up to date)
    await settleUnresolvedTrades(w);

    // Compute profile from activity (for open positions / recent signals)
    await computeTraderProfile(w);

    // ALWAYS run canonical PNL at the end — this paginates ALL closed positions ever
    // and is the only source that covers 100% of trade history.
    // It overwrites any activity-based PNL/ROI estimates with accurate full-history numbers.
    console.log(`[Elite] ${w}: running canonical PNL (full closed-positions history)...`);
    await patchProfileWithCanonicalPNL(w);

    await pool.query(`UPDATE elite_traders SET last_analyzed_at = NOW() WHERE wallet = $1`, [w]);
    console.log(`[Elite] Analysis complete for ${w}`);
  } catch (err: any) {
    console.error(`[Elite] Analysis failed for ${wallet}:`, err.message);
  }
}

// ─── Canonical PNL from /closed-positions API ────────────────────────────────
// Uses sum(realizedPnl) which matches Polymarket's official displayed numbers.

export interface CanonicalPNL {
  // ── PNL totals ──────────────────────────────────────────────────────────────
  realizedPNL: number;
  unrealizedPNL: number;       // sum(cashPnl) across ALL open positions
  activeUnrealizedPNL: number; // sum(cashPnl) for live (unresolved) open positions only
  totalPNL: number;            // realizedPNL + unrealizedPNL + redeemableValue

  // ── Position counts ─────────────────────────────────────────────────────────
  closedCount: number;
  openCount: number;           // all open positions (includes redeemable)
  activeOpenCount: number;     // live markets (curPrice > 0, not redeemable)
  redeemableCount: number;     // resolved markets awaiting user redemption
  redeemableValue: number;     // USDC claimable from redeemable positions

  // ── Investment & ROI ────────────────────────────────────────────────────────
  totalInvested: number;       // sum(avgPrice * totalBought) USDC for all closed positions
  overallROI: number;          // PNL / (winsGross + lossesGross) * 100 — matches PolymarketAnalytics
  roiCapital: number;          // totalPNL / totalInvested * 100 — bankroll growth rate
  last30dPNL: number;
  last30dInvested: number;
  last30dCount: number;
  last30dROI: number;          // 0 if no 30d data
  last90dPNL: number;
  last90dInvested: number;
  last90dCount: number;
  last90dROI: number;

  // ── Win rates ───────────────────────────────────────────────────────────────
  pnlWinRate: number;          // overall % positions with realizedPnl > 0
  winRate30: number;
  winRate90: number;

  // ── Bet sizes (USDC) ────────────────────────────────────────────────────────
  avgBetUSDC: number;
  medianBetUSDC: number;

  // ── Monthly breakdown ───────────────────────────────────────────────────────
  monthlyROI: Array<{
    month: string; roi: number; pnl: number; invested: number;
    tradeCount: number; wins: number;
  }>;

  // ── Category breakdown ───────────────────────────────────────────────────────
  closedByCategory: Record<string, { pnl: number; positions: number; wins: number; invested: number; winsGross: number; lossesGross: number }>;
}

function classifySportFromSlug(slug: string, title?: string): string {
  const s = (slug || "").toLowerCase();
  const t = (title || "").toLowerCase();

  // ── Explicit non-sports slug patterns (must come first to avoid false sports positives) ──
  // Political markets — catch by slug patterns before sports rules can grab them
  if (s.match(/president|election|democrat|republican|nominee|senate|congress|inaugur|popular-vote|electoral|midterm|balance-of-power|prime-minister|chancellor/))
    return "Politics";
  if (t.match(/trump|biden|harris|election|congress|senate|president|vote|poll|democrat|republican|poilievre|prime minister|government of canada|walz|sanders|warren|buttigieg|newsom|shapiro|talarico|khanna|moore.*presiden|gubernatorial/))
    return "Politics";
  if (t.match(/crypto|bitcoin|ethereum|fed rate|inflation|gdp|stock|nasdaq|defi/) ||
      s.match(/bitcoin|ethereum|crypto|fed-rate|oil-price|crude-oil|gold-price|interest-rate|tariff/))
    return "Finance/Crypto";

  // ── NHL / Ice Hockey ──
  if (s.startsWith("nhl-") || s.includes("stanley-cup") || t.includes("nhl ") || t.includes(" nhl") ||
      t.includes("stanley cup") || t.includes("ice hockey") ||
      s.startsWith("mwoh-") || s.startsWith("wwoh-") ||
      (t.includes("hockey") && (t.includes("olympic") || t.includes("winter")))) return "NHL";

  // ── NBA ──
  if (s.startsWith("nba-") || s.includes("-nba-") || s.includes("nba-champion") ||
      t.includes("nba ") || t.includes(" nba")) return "NBA";

  // ── NFL ──
  if (s.startsWith("nfl-") || s.includes("super-bowl") || s.includes("superbowl") ||
      s.includes("afc-champ") || s.includes("nfc-champ") ||
      s.match(/^(afc|nfc)-champion/) ||
      t.includes("nfl ") || t.includes("super bowl") ||
      t.includes("afc champion") || t.includes("nfc champion")) return "NFL";

  // ── MLB ──
  if (s.startsWith("mlb-") || s.includes("world-series") || s.includes("alcs") || s.includes("nlcs") ||
      t.includes("mlb ") || t.includes("world series") || t.includes("alcs") || t.includes("nlcs")) return "MLB";

  // ── UFC/MMA ──
  if (s.startsWith("ufc-") || s.includes("-ufc-") || s.includes("-mma-") ||
      t.includes("ufc ") || t.includes("mma ") || t.includes("fight night")) return "UFC/MMA";

  // ── Tennis ──
  if (s.match(/^(wta|atp|aus-|wimbledon|usopen-ten|roland)/) ||
      t.includes("tennis") || t.includes("grand slam") || t.includes("wimbledon") ||
      t.includes("us open") || t.includes("french open") || t.includes("australian open") ||
      t.match(/\b(alcaraz|sinner|djokovic|swiatek|medvedev|zverev|sabalenka|gauff|rublev|fritz|lehecka|tiafoe)\b/)) return "Tennis";

  // ── College Sports ──
  if (s.match(/^(cbb|ncaab|ncaaf|cfb)-/) || s.includes("ncaa-tournament") ||
      s.includes("college-football") || s.includes("march-madness") ||
      t.includes("ncaa") || t.includes("march madness") || t.includes("college football")) return "College Sports";

  // ── Soccer ──
  if (s.match(/^(epl|lal|sea|bun|uel|ucl|mls|spl|bra|elc|ere|fl1|ligue|eng|fra|ger|esp|ita|por|bel|ned|sco|eur|con)-/) ||
      s.includes("champions-league") || s.includes("europa-league") || s.includes("world-cup") ||
      s.includes("euro-2024") || s.includes("euro-2025") || s.includes("copa-america") ||
      t.includes("soccer") || (t.includes("football") && !t.includes("super bowl")) ||
      t.includes("premier league") || t.includes("champions league") || t.includes("europa league") ||
      t.includes("la liga") || t.includes("bundesliga") || t.includes("serie a") ||
      t.includes("copa") || t.includes("ligue 1") || t.includes("world cup")) return "Soccer";

  // ── eSports ──
  if (s.includes("esport") || s.includes("valorant") || s.includes("csgo") ||
      t.includes("esport") || t.includes("valorant") || t.includes("league of legends")) return "eSports";

  // ── Golf ──
  if (s.startsWith("golf-") || (t.includes("masters") && t.includes("golf")) ||
      t.includes("pga tour") || t.includes("lpga") || t.includes("golf")) return "Golf";

  // ── Formula 1 ──
  if (s.match(/^(f1|formula)/) || t.includes("formula 1") || t.includes("grand prix")) return "Formula 1";

  return "Other";
}

export async function fetchCanonicalPNL(wallet: string): Promise<CanonicalPNL> {
  const addr = wallet.toLowerCase();
  const now = Date.now();
  const ms30 = now - 30 * 86_400_000;
  const ms90 = now - 90 * 86_400_000;

  // ── Build ALL-TIME PNL using two complementary endpoints ────────────────────────
  //
  // ENDPOINT 1: /closed-positions → returns ALL settled positions sorted by realizedPnl DESC.
  //   realizedPnl is NET profit (payout - cost), already computed by Polymarket.
  //   We paginate until we've seen all positive entries (then losses start appearing).
  //   This captures wins AND positions sold at a loss (partial closes).
  //
  // ENDPOINT 2: /positions?closed=true → returns unredeemed/pending-settled positions.
  //   For these, cashPnl = current mark-to-market = true net PNL for resolved markets:
  //   positive for unclaimed wins, negative for unrecouped losses (tokens worth $0).
  //   These do NOT appear in /closed-positions yet (no redemption transaction).
  //
  // NO SPORTS FILTER: We include ALL categories for all-time PNL matching
  // polymarketanalytics.com. Category breakdown (closedByCategory) is computed
  // separately using slug classification for per-sport metrics.
  type Settled = {
    _pnl: number; _invested: number; _ts: number; _win: boolean;
    slug: string; title: string;
  };

  const investedUSDC = (avgPrice: any, totalBought: any): number =>
    Math.abs((parseFloat(avgPrice) || 0) * (parseFloat(totalBought) || 0));

  const allSettled: Settled[] = [];

  // ── 1a. Wins + sold-at-loss from /closed-positions ────────────────────────────
  // Sorted by realizedPnl DESC. We stop when the API returns fewer records than
  // the limit (true end of data) OR after 30 consecutive all-dust pages.
  // 30 pages = 1500 positions of near-zero PNL — safe for traders (like kch123)
  // whose sorted list has a large zero-PnL zone between wins and losses, while
  // still preventing runaway pagination for traders with millions of micro-positions.
  const PAGE = 50; // Polymarket /closed-positions returns max 50 per page
  const MAX_PAGES = 2000; // cap at 100K positions
  const MAX_ZERO_PAGES = 30; // stop after 1500 consecutive near-zero positions
  let offset = 0;
  let pages = 0;
  let consecutiveZeroPages = 0;
  while (true) {
    const data = await fetchJson(
      `${DATA_API}/closed-positions?user=${addr}&limit=${PAGE}&offset=${offset}`
    );
    if (!Array.isArray(data) || data.length === 0) break;
    let pageAny = 0;
    for (const p of data) {
      const pnl = parseFloat(p.realizedPnl) || 0;
      if (Math.abs(pnl) <= 0.01) continue;
      pageAny++;
      const slug  = p.slug || p.eventSlug || "";
      const title = p.title || "";
      allSettled.push({
        _pnl:      pnl,
        _invested: investedUSDC(p.avgPrice, p.totalBought),
        _ts:       p.timestamp || 0,
        _win:      pnl > 0,
        slug,
        title,
      });
    }
    if (pageAny === 0) {
      consecutiveZeroPages++;
      if (consecutiveZeroPages >= MAX_ZERO_PAGES) break;
    } else {
      consecutiveZeroPages = 0;
    }
    if (data.length < PAGE) break;
    offset += PAGE;
    pages++;
    if (pages >= MAX_PAGES) break;
    await new Promise(r => setTimeout(r, 40));
  }

  // ── 1b. Unredeemed LOSSES from /positions?closed=true ────────────────────────
  // Captures resolved positions where user has NOT yet redeemed/settled.
  // For losing positions (tokens worth $0): cashPnl = -initialValue (the true loss).
  // We only capture losses here — unredeemed WINS are counted in redeemableValue below.
  // No double-counting: /closed-positions only has realizedPnl for actual transactions.
  let loseOffset = 0;
  let emptyLossPages = 0;
  while (true) {
    const data = await fetchJson(
      `${DATA_API}/positions?user=${addr}&limit=500&offset=${loseOffset}&sizeThreshold=0&closed=true`
    );
    if (!Array.isArray(data) || data.length === 0) break;
    let pageLosses = 0;
    for (const p of data) {
      const pnl = parseFloat(p.cashPnl) || 0;
      if (pnl >= -0.01) continue; // only genuine losses (cashPnl < 0)
      // CRITICAL: Only include positions from RESOLVED markets (curPrice must be 0 or 1).
      // curPrice between 0.001–0.999 = still active/open market (e.g., 2028 futures).
      // Including unresolved positions would count unrealized paper losses as settled losses.
      const curPrice = parseFloat(p.curPrice) || 0;
      const isResolved = curPrice < 0.001 || curPrice > 0.999;
      if (!isResolved) continue; // skip open/unresolved markets
      pageLosses++;
      const slug  = p.slug || p.eventSlug || "";
      const title = p.title || "";
      const ts    = p.endDate ? Math.floor(new Date(p.endDate).getTime() / 1000) : 0;
      allSettled.push({
        _pnl:      pnl,
        _invested: investedUSDC(p.avgPrice, p.totalBought),
        _ts:       ts,
        _win:      false,
        slug,
        title,
      });
    }
    if (pageLosses === 0) { emptyLossPages++; if (emptyLossPages >= 5) break; }
    else emptyLossPages = 0;
    if (data.length < 500) break;
    loseOffset += 500;
    if (loseOffset >= 300_000) break;
    await new Promise(r => setTimeout(r, 40));
  }

  // ── 3. Aggregate metrics ──────────────────────────────────────────────────
  const realizedPNL   = allSettled.reduce((s, c) => s + c._pnl, 0);
  const totalInvested = allSettled.reduce((s, c) => s + c._invested, 0);
  const wins          = allSettled.filter(c => c._win).length;
  const pnlWinRate    = allSettled.length > 0
    ? Math.round((wins / allSettled.length) * 1000) / 10 : 0;

  // Correct ROI denominator: net profit from wins + net losses from losses
  // Formula: PNL / (winsGross + lossesGross) — matches PolymarketAnalytics
  const winsGross    = allSettled.filter(c => c._win).reduce((s, c) => s + c._pnl, 0);
  const lossesGross  = allSettled.filter(c => !c._win).reduce((s, c) => s + Math.abs(c._pnl), 0);
  const roiDenom     = winsGross + lossesGross;
  const overallROI   = roiDenom > 0
    ? Math.round((realizedPNL / roiDenom) * 10000) / 100 : 0;

  // Bet size distribution (USDC)
  const betSizes = allSettled.map(c => c._invested).filter(v => v > 0);
  const avgBetUSDC    = betSizes.length > 0 ? Math.round(mean(betSizes) * 100) / 100 : 0;
  const medianBetUSDC = betSizes.length > 0 ? Math.round(median(betSizes) * 100) / 100 : 0;

  // ── 4. Time-windowed metrics (30d / 90d) ─────────────────────────────────
  const closed30 = allSettled.filter(c => c._ts * 1000 > ms30);
  const closed90 = allSettled.filter(c => c._ts * 1000 > ms90);

  const pnl30  = closed30.reduce((s, c) => s + c._pnl, 0);
  const pnl90  = closed90.reduce((s, c) => s + c._pnl, 0);
  const inv30  = closed30.reduce((s, c) => s + c._invested, 0);
  const inv90  = closed90.reduce((s, c) => s + c._invested, 0);
  const wins30 = closed30.filter(c => c._win).length;
  const wins90 = closed90.filter(c => c._win).length;

  const wg30 = closed30.filter(c => c._win).reduce((s, c) => s + c._pnl, 0);
  const lg30 = closed30.filter(c => !c._win).reduce((s, c) => s + Math.abs(c._pnl), 0);
  const wg90 = closed90.filter(c => c._win).reduce((s, c) => s + c._pnl, 0);
  const lg90 = closed90.filter(c => !c._win).reduce((s, c) => s + Math.abs(c._pnl), 0);
  const last30dROI  = (wg30 + lg30) > 0 ? Math.round((pnl30 / (wg30 + lg30)) * 10000) / 100 : 0;
  const last90dROI  = (wg90 + lg90) > 0 ? Math.round((pnl90 / (wg90 + lg90)) * 10000) / 100 : 0;
  const winRate30   = closed30.length > 0 ? Math.round((wins30 / closed30.length) * 1000) / 10 : 0;
  const winRate90   = closed90.length > 0 ? Math.round((wins90 / closed90.length) * 1000) / 10 : 0;

  // ── 5. Monthly breakdown ─────────────────────────────────────────────────
  const byMonth: Record<string, { pnl: number; invested: number; count: number; wins: number; winsGross: number; lossesGross: number }> = {};
  for (const c of allSettled) {
    if (!c._ts) continue;
    const d = new Date(c._ts * 1000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[key]) byMonth[key] = { pnl: 0, invested: 0, count: 0, wins: 0, winsGross: 0, lossesGross: 0 };
    byMonth[key].pnl      += c._pnl;
    byMonth[key].invested += c._invested;
    byMonth[key].count++;
    if (c._win) { byMonth[key].wins++; byMonth[key].winsGross += c._pnl; }
    else { byMonth[key].lossesGross += Math.abs(c._pnl); }
  }
  const monthlyROI = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => {
      const denom = d.winsGross + d.lossesGross;
      return {
        month,
        roi:        denom > 0 ? Math.round((d.pnl / denom) * 10000) / 100 : 0,
        pnl:        Math.round(d.pnl * 100) / 100,
        invested:   Math.round(d.invested),
        tradeCount: d.count,
        wins:       d.wins,
      };
    });

  // ── 6. Category breakdown (USDC invested — not shares) ───────────────────
  const closedByCategory: Record<string, { pnl: number; positions: number; wins: number; invested: number; winsGross: number; lossesGross: number }> = {};
  for (const c of allSettled) {
    const cat = classifySportFromSlug(c.slug, c.title);
    if (!closedByCategory[cat]) closedByCategory[cat] = { pnl: 0, positions: 0, wins: 0, invested: 0, winsGross: 0, lossesGross: 0 };
    closedByCategory[cat].pnl      += c._pnl;
    closedByCategory[cat].invested += c._invested;
    closedByCategory[cat].positions++;
    if (c._win) { closedByCategory[cat].wins++; closedByCategory[cat].winsGross += c._pnl; }
    else { closedByCategory[cat].lossesGross += Math.abs(c._pnl); }
  }
  for (const cat of Object.keys(closedByCategory)) {
    closedByCategory[cat].pnl      = Math.round(closedByCategory[cat].pnl * 100) / 100;
    closedByCategory[cat].invested = Math.round(closedByCategory[cat].invested * 100) / 100;
    closedByCategory[cat].winsGross = Math.round(closedByCategory[cat].winsGross * 100) / 100;
    closedByCategory[cat].lossesGross = Math.round(closedByCategory[cat].lossesGross * 100) / 100;
  }

  // ── 6. Open positions (paginated) ─────────────────────────────────────────
  const openPositions: any[] = [];
  let openOffset = 0;
  while (true) {
    const openPage = await fetchJson(
      `${DATA_API}/positions?user=${addr}&limit=500&offset=${openOffset}&sizeThreshold=0`
    );
    if (!Array.isArray(openPage) || openPage.length === 0) break;
    openPositions.push(...openPage);
    if (openPage.length < 500) break;
    openOffset += 500;
    if (openOffset >= 10_000) break;
    await new Promise(r => setTimeout(r, 80));
  }

  // Separate active (live market) from redeemable (resolved, awaiting claim)
  const activePositions = openPositions.filter(p => !p.redeemable && (parseFloat(p.curPrice) || 0) > 0);
  const redeemablePositions = openPositions.filter(p => p.redeemable);

  // Step 1b adds LOSING closed positions (cashPnl < 0) to allSettled.
  // Redeemable winning positions are NOT in step 1b (cashPnl > 0 was skipped).
  // Redeemable losers have currentValue=0 so redeemableValue = 0 for them.
  // Result: no double-counting. Active (live market) positions are accounted
  // for separately via unrealizedPNL. Redeemable winners via redeemableValue.
  const activeUnrealizedPNL = activePositions.reduce((s: number, p: any) => s + (parseFloat(p.cashPnl) || 0), 0);
  const unrealizedPNL = activeUnrealizedPNL; // live open positions only — no double-count
  const redeemableValue = redeemablePositions.reduce((s: number, p: any) => s + (parseFloat(p.currentValue) || 0), 0);

  return {
    realizedPNL:        Math.round(realizedPNL * 100) / 100,
    unrealizedPNL:      Math.round(unrealizedPNL * 100) / 100,
    activeUnrealizedPNL: Math.round(activeUnrealizedPNL * 100) / 100,
    totalPNL:           Math.round((realizedPNL + unrealizedPNL + redeemableValue) * 100) / 100,
    closedCount:        allSettled.length,
    openCount:          openPositions.length,
    activeOpenCount:    activePositions.length,
    redeemableCount:    redeemablePositions.length,
    redeemableValue:    Math.round(redeemableValue * 100) / 100,
    totalInvested:      Math.round(totalInvested * 100) / 100,
    overallROI,
    roiCapital:         totalInvested > 0
      ? Math.round(((realizedPNL + unrealizedPNL + redeemableValue) / totalInvested) * 10000) / 100
      : 0,
    last30dPNL:         Math.round(pnl30 * 100) / 100,
    last30dInvested:    Math.round(inv30 * 100) / 100,
    last30dCount:       closed30.length,
    last30dROI,
    last90dPNL:         Math.round(pnl90 * 100) / 100,
    last90dInvested:    Math.round(inv90 * 100) / 100,
    last90dCount:       closed90.length,
    last90dROI,
    pnlWinRate,
    winRate30,
    winRate90,
    avgBetUSDC,
    medianBetUSDC,
    monthlyROI,
    closedByCategory,
  };
}

// Compute a quality score from canonical metrics (0-100)
function computeCanonicalQualityScore(c: CanonicalPNL): number {
  const pnl    = c.totalPNL;
  const roi    = c.overallROI;   // PA-style: PNL / (wins + losses gross) — primary skill signal
  const capRoi = c.roiCapital;   // Capital ROI: used as credibility check
  const wr     = c.pnlWinRate;
  const trades = c.closedCount;
  const roi30  = c.last30dROI;
  const roi90  = c.last90dROI;

  // ── ROI (0–40 pts): Primary skill signal — dominates the score ──────────
  // 5% = 13pts, 10% = 27pts, 15%+ = 40pts
  const roiPts = roi <= 0 ? 0 : Math.min(40, Math.round(roi / 15 * 40));

  // ── Sample credibility (0–20 pts): ROI needs volume to be trustworthy ───
  // 300 trades = 6pts, 1000 = 13pts, 3000+ = 20pts (log curve)
  const tradePts = trades < 10 ? 0
    : Math.min(20, Math.round(Math.log(trades) / Math.log(3000) * 20));

  // ── Win rate (0–15 pts): consistency of being right ────────────────────
  // 50% = 0pts, 60% = 6pts, 70% = 12pts, 80%+ = 15pts
  const wrPts = wr < 50 ? 0 : Math.min(15, Math.round((wr - 50) / 30 * 15));

  // ── PNL at scale (0–15 pts): proves edge works with real money ──────────
  // log scale: $50K = 9pts, $500K = 14pts, $1M+ = 15pts
  // If Capital ROI < 1%, limit to 8pts (PNL may be from huge volume, not true edge)
  const rawPnlPts = pnl <= 0 ? 0
    : Math.min(15, Math.round(Math.log10(Math.max(pnl, 1)) / Math.log10(1_000_000) * 15));
  const capRoiCredible = capRoi !== null && capRoi > 1;
  const pnlPts = (capRoi === null || capRoiCredible) ? rawPnlPts : Math.min(rawPnlPts, 8);

  // ── Recent momentum (0–10 pts): is the edge holding up? ─────────────────
  // Full 10pts if 30d ROI ≥ overall, partial if positive but lower, 0 if negative
  // Also bonus path: if 90d ROI is positive, rescue 5pts even if 30d is down
  const momentumPts = roi30 > 0
    ? (roi30 >= roi ? 10 : Math.round((roi30 / Math.max(roi, 1)) * 10))
    : (roi90 > 0 ? 5 : 0);

  return Math.min(99, Math.max(1, roiPts + tradePts + wrPts + pnlPts + momentumPts));
}

// Patch an existing trader profile with canonical PNL + full metrics.
// This is the authoritative source of truth for all metric values displayed on the Traders page.
export async function patchProfileWithCanonicalPNL(wallet: string): Promise<{
  wallet: string; username: string; totalPNL: number; realizedPNL: number; unrealizedPNL: number;
} | null> {
  const w = wallet.toLowerCase();
  try {
    const uRow = await pool.query(`SELECT username FROM elite_traders WHERE wallet = $1`, [w]);
    const username = uRow.rows[0]?.username || w.slice(0, 10);

    const c = await fetchCanonicalPNL(w);
    const qualityScore = computeCanonicalQualityScore(c);

    // Build roiBySport from canonical closedByCategory (correct data, not per-trade)
    const roiBySport: Record<string, { roi: number; tradeCount: number; pnl: number; winRate: number; avgBet: number }> = {};
    for (const [cat, d] of Object.entries(c.closedByCategory)) {
      if (d.positions === 0) continue;
      const denom = (d.winsGross || 0) + (d.lossesGross || 0);
      const roi = denom > 0 ? Math.round((d.pnl / denom) * 10000) / 100 : 0;
      const winRate = d.positions > 0 ? Math.round((d.wins / d.positions) * 1000) / 10 : 0;
      const avgBet = d.positions > 0 ? Math.round(d.invested / d.positions) : 0;
      roiBySport[cat] = { roi, tradeCount: d.positions, pnl: Math.round(d.pnl * 100) / 100, winRate, avgBet };
    }

    // Compute canonical sport expert tags from roiBySport
    const sportTagMap: Record<string, string> = {
      "NHL": "🏒 NHL Pro", "NBA": "🏀 NBA Expert", "NFL": "🏈 NFL Specialist",
      "MLB": "⚾ MLB Expert", "Soccer": "⚽ Soccer Expert", "UFC/MMA": "🥊 UFC Analyst",
      "Tennis": "🎾 Tennis Expert", "Golf": "⛳ Golf Specialist",
    };
    const canonicalSportTags: string[] = [];
    for (const [sp, d] of Object.entries(roiBySport)) {
      if (d.tradeCount >= 10 && sportTagMap[sp] && (d.roi > 5 || d.pnl >= 20000)) {
        canonicalSportTags.push(sportTagMap[sp]);
      }
    }

    // Fetch existing profile — used for tag merging and position-count safeguard
    const existingProfile = await pool.query(`SELECT tags, metrics FROM elite_trader_profiles WHERE wallet = $1`, [w]);
    const existingTags: string[] = existingProfile.rows[0]?.tags ?? [];
    const existingMetrics: any = existingProfile.rows[0]?.metrics ?? {};
    const prevClosedCount: number = existingMetrics.closedPositionCount ?? 0;

    // ── Regression safeguard (relaxed): only block clearly broken API responses ──
    // With ALL-TIME PNL (all categories), counts should only go up. Block only if
    // count dropped >80% (likely empty/broken API page) AND PNL became negative when
    // it was previously strongly positive (which would only happen from a bug).
    const prevPNL: number = existingMetrics.overallPNL ?? 0;
    const apiAppearsEmpty = prevClosedCount > 500 && c.closedCount < prevClosedCount * 0.2;
    const pnlFlippedNegative = prevPNL > 10_000 && c.totalPNL < -1_000;
    if (apiAppearsEmpty && pnlFlippedNegative) {
      console.warn(
        `[Elite/PNL] ${username}: SKIPPED — API looks broken (${c.closedCount} positions vs ${prevClosedCount} stored, PNL flipped to $${Math.round(c.totalPNL).toLocaleString()}). Will retry next refresh.`
      );
      return null;
    }
    if (c.closedCount < prevClosedCount * 0.5 && prevClosedCount > 100) {
      console.log(`[Elite/PNL] ${username}: count dropped ${prevClosedCount}→${c.closedCount} — allowing update (PNL=$${Math.round(c.totalPNL).toLocaleString()})`);
    }

    // Merge tags: replace sport tags with canonical ones, keep non-sport tags
    const nonSportTags = existingTags.filter((t: string) => !Object.values(sportTagMap).some(st => t === st));
    const mergedTags = [...new Set([...canonicalSportTags, ...nonSportTags])];

    // All canonical metrics — these are authoritative and override activity-based values
    const canonicalMetrics = {
      overallPNL:          c.totalPNL,
      realizedPNL:         c.realizedPNL,
      unrealizedPNL:       c.unrealizedPNL,
      activeUnrealizedPNL: c.activeUnrealizedPNL,
      closedPositionCount: c.closedCount,
      openPositionCount:   c.openCount,
      activeOpenCount:     c.activeOpenCount,
      redeemableCount:     c.redeemableCount,
      redeemableValue:     c.redeemableValue,
      totalInvested:       c.totalInvested,
      overallROI:          c.overallROI,
      roiCapital:          c.roiCapital,
      last30dROI:          c.last30dROI,
      last30dPNL:          c.last30dPNL,
      last30dInvested:     c.last30dInvested,
      last30dCount:        c.last30dCount,
      last90dROI:          c.last90dROI,
      last90dPNL:          c.last90dPNL,
      last90dInvested:     c.last90dInvested,
      last90dCount:        c.last90dCount,
      winRate:             c.pnlWinRate,
      pnlWinRate:          c.pnlWinRate,
      winRate30:           c.winRate30,
      winRate90:           c.winRate90,
      avgBetSize:          c.avgBetUSDC,
      medianBetSize:       c.medianBetUSDC,
      totalTrades:         c.closedCount,
      monthlyROI:          c.monthlyROI,
      roiBySport,
      closedByCategory:    c.closedByCategory,
      pnlSource:           "closed_positions_api",
      pnlUpdatedAt:        new Date().toISOString(),
    };

    await pool.query(`
      UPDATE elite_trader_profiles
      SET metrics = metrics || $2::jsonb,
          computed_at = NOW(),
          quality_score = $3,
          tags = $4
      WHERE wallet = $1
    `, [w, JSON.stringify(canonicalMetrics), qualityScore, mergedTags]);

    console.log(
      `[Elite/PNL] ${username}: pnl=$${c.totalPNL.toFixed(0)} ` +
      `roi_pa=${c.overallROI.toFixed(1)}% roi_cap=${c.roiCapital.toFixed(1)}% 30d=${c.last30dROI.toFixed(1)}% 90d=${c.last90dROI.toFixed(1)}% ` +
      `wr=${c.pnlWinRate.toFixed(1)}% qs=${qualityScore} ` +
      `sportTags=[${canonicalSportTags.join(",")}] ` +
      `(${c.closedCount} closed, ${c.activeOpenCount} live open)`
    );
    return { wallet: w, username, totalPNL: c.totalPNL, realizedPNL: c.realizedPNL, unrealizedPNL: c.unrealizedPNL };
  } catch (err: any) {
    console.error(`[Elite/PNL] patchProfileWithCanonicalPNL failed for ${wallet}:`, err.message);
    return null;
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

let _scheduledRefreshRunning = false;

export async function runCanonicalPNLRefreshForAll(): Promise<void> {
  if (_scheduledRefreshRunning) {
    console.log("[canonical-pnl] Refresh already running — skipping duplicate trigger");
    return;
  }
  _scheduledRefreshRunning = true;
  try {
    const { rows } = await pool.query(
      `SELECT wallet, username FROM elite_traders WHERE wallet NOT LIKE 'pending-%' ORDER BY username`
    );
    console.log(`[canonical-pnl] Starting scheduled refresh for ${rows.length} wallets...`);
    let patched = 0;
    for (const r of rows) {
      try {
        const result = await patchProfileWithCanonicalPNL(r.wallet);
        if (result) patched++;
        await new Promise(res => setTimeout(res, 200));
      } catch (e: any) {
        console.error(`[canonical-pnl] Error for ${r.wallet}:`, e.message);
      }
    }
    console.log(`[canonical-pnl] Scheduled refresh done — patched ${patched}/${rows.length} profiles`);
  } catch (err: any) {
    console.error("[canonical-pnl] Scheduled refresh error:", err.message);
  } finally {
    _scheduledRefreshRunning = false;
  }
}

export function startCanonicalPNLRefresh(): void {
  // Run once on startup after a short delay, then every 24h
  setTimeout(() => {
    runCanonicalPNLRefreshForAll();
  }, 30 * 1000); // 30s after startup to let the server settle

  setInterval(() => {
    runCanonicalPNLRefreshForAll();
  }, 24 * 60 * 60 * 1000);
}
