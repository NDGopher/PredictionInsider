import fs from "fs";
import path from "path";
import type { Signal } from "@shared/schema";

export interface TailStrategyFilters {
  minTraders: number;
  minGrade?: number;
  minQ?: number;
  priceLo: number;
  priceHi: number;
  excludeUsernames: string[];
  skipSports: string[];
  marketTypes?: string[];
  sportIncludes?: string[];
}

export interface TailStrategyCard {
  id: string;
  name?: string;
  backtest_key?: string;
  recommended?: boolean;
  description?: string;
  filters?: TailStrategyFilters;
  join_max_plus_2c?: Record<string, number | string | null>;
  years?: Record<string, Record<string, number | string | null>>;
  by_sport?: Record<string, Record<string, number | string | null>>;
  by_submarket?: Record<string, Record<string, number | string | null>>;
  sport_x_submarket?: Array<Record<string, number | string | null>>;
  last_20?: Array<Record<string, string | number | null>>;
  date_span?: {
    first?: string | null;
    last?: string | null;
    trades_per_day?: number;
  };
}

export interface TailStrategiesFile {
  generated_at?: string;
  as_of?: string;
  fill?: string;
  stake?: number;
  method?: string;
  copy_all?: Record<string, number>;
  strategies?: TailStrategyCard[];
  universe?: Record<string, number | string | null>;
}

export interface TraderHealthFile {
  generated_at?: string;
  as_of?: string;
  method?: string;
  cannae?: Record<string, unknown> | null;
  traders?: Array<Record<string, unknown>>;
  counts?: Record<string, number>;
}

function readJsonFile<T>(rel: string): T | null {
  const p = path.join(process.cwd(), rel);
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`[tail-strategies] failed to read ${rel}:`, err);
    return null;
  }
}

export function loadTailStrategiesFile(): TailStrategiesFile | null {
  return readJsonFile<TailStrategiesFile>("pnl_analysis/output/tail_strategies.json");
}

export function loadTraderHealthFile(): TraderHealthFile | null {
  return readJsonFile<TraderHealthFile>("pnl_analysis/output/trader_health.json");
}

function textHaystack(signal: Signal): string {
  return [
    signal.marketQuestion,
    signal.slug,
    signal.marketType,
    signal.marketCategory,
    signal.sport,
    signal.category,
    signal.outcomeLabel,
  ]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" ")
    .toLowerCase();
}

function inferSubmarket(signal: Signal): string {
  const h = textHaystack(signal);
  if (h.includes("draw")) return "Draw";
  if (h.includes("spread") || h.includes("(+") || h.includes("(-")) return "Spread";
  if (h.includes("o/u") || h.includes(" over ") || h.includes(" under ") || h.includes("total")) return "Total";
  if (h.includes("mvp") || h.includes("champion") || h.includes("win the")) return "Futures";
  return "Moneyline";
}

function sportSkipped(sport: string | undefined, skips: string[]): boolean {
  if (!skips.length) return false;
  const s = (sport || "").toLowerCase();
  const cat = "";
  const blob = `${s} ${cat}`;
  return skips.some((k) => blob.includes(k.toLowerCase()));
}

function sportIncluded(sport: string | undefined, includes: string[] | undefined): boolean {
  if (!includes || includes.length === 0) return true;
  const s = (sport || "").toLowerCase();
  return includes.some((k) => s.includes(k.toLowerCase()));
}

function marketAllowed(signal: Signal, types: string[] | undefined): boolean {
  if (!types || types.length === 0) return true;
  const sub = inferSubmarket(signal);
  const h = textHaystack(signal);
  return types.some((t) => {
    const tl = t.toLowerCase();
    if (tl.includes("moneyline")) return sub === "Moneyline";
    if (tl.includes("spread")) return sub === "Spread";
    if (tl.includes("total") || tl.includes("o/u")) return sub === "Total";
    if (tl.includes("draw")) return sub === "Draw";
    return h.includes(tl) || sub.toLowerCase().includes(tl);
  });
}

export function signalMatchesStrategy(signal: Signal, filters: TailStrategyFilters): boolean {
  const exclude = new Set((filters.excludeUsernames || []).map((n) => n.toLowerCase()));
  const traders = (signal.traders || []).filter((t) => {
    const name = (t.name || "").toLowerCase();
    const addr = (t.address || "").toLowerCase();
    if (exclude.has(name)) return false;
    for (const ex of exclude) {
      if (addr.includes(ex) || name.includes(ex)) return false;
    }
    return true;
  });
  if (traders.length < (filters.minTraders || 1)) return false;
  if ((filters.minGrade || 0) > 0 && signal.confidence < (filters.minGrade || 0)) return false;
  const q = signal.avgQuality ?? 0;
  if ((filters.minQ || 0) > 0 && q < (filters.minQ || 0)) return false;
  const px = signal.currentPrice || signal.avgEntryPrice;
  if (px < filters.priceLo || px > filters.priceHi) return false;
  if (sportSkipped(signal.sport || signal.category, filters.skipSports || [])) return false;
  if (!sportIncluded(signal.sport || signal.category, filters.sportIncludes)) return false;
  if (!marketAllowed(signal, filters.marketTypes)) return false;
  return true;
}

export function annotateSignal(signal: Signal): Signal & { submarket: string; playLabel: string } {
  const submarket = inferSubmarket(signal);
  const side = signal.side;
  const sport = signal.sport || signal.category || "Unknown";
  return {
    ...signal,
    submarket,
    playLabel: `${signal.marketQuestion} · ${side} · ${sport} · ${submarket}`,
  };
}
