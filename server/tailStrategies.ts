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
  requireUsernames?: string[];
  skipSports: string[];
  marketTypes?: string[];
  sportIncludes?: string[];
}

export interface TailStrategyCard {
  id: string;
  name?: string;
  backtest_key?: string;
  recommended?: boolean;
  priority?: number;
  rule?: string;
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

export interface ResearchStat {
  n?: number;
  wins?: number;
  win_rate?: number;
  roi?: number;
  sharpe_daily_roi?: number;
  max_dd?: number;
  first?: string | null;
  last?: string | null;
  expectancy?: number;
  implied_wr?: number;
  edge?: number;
  profit_factor?: number;
}

export interface ResearchBook {
  id: string;
  name?: string;
  n?: number;
  their_entry_vwap?: ResearchStat;
  ask_at_alert_join_max?: ResearchStat;
  ask_plus_2c?: ResearchStat;
  ask_plus_5c?: ResearchStat;
  concentration?: {
    top_primary?: string;
    primary_share?: number;
    n_primaries?: number;
    mention_share?: Record<string, number>;
  };
}

export interface ResearchClv {
  n?: number;
  n_with_close_line?: number;
  coverage?: number;
  clob_ask_coverage?: number;
  realized_roi?: number;
  expected_clv_roi?: number | null;
  avg_clv_cents?: number | null;
}

export interface RobustResearchFile {
  generated_at?: string;
  as_of?: string;
  method?: string;
  universe?: {
    max_resolved_date?: string | null;
    n_2plus?: number;
    health_counts?: Record<string, number>;
  };
  freshness?: {
    health_as_of?: string;
    consensus_last_play?: string | null;
    stale_traders?: string[];
    steady_traders?: string[];
    lane_only?: string[];
  };
  what_to_tail?: Array<{ title?: string; why?: string; strategy_id?: string | null }>;
  books?: ResearchBook[];
  leave_one_out?: Array<{
    dropped?: string;
    n_remaining?: number;
    ask_plus_2c?: ResearchStat;
    concentration?: { top_primary?: string; primary_share?: number };
  }>;
  pairs?: Array<{
    pair?: string;
    n?: number;
    roi_ask_2c?: number;
    wr?: number;
    sharpe?: number;
    last?: string | null;
  }>;
  triples?: Array<{
    triple?: string;
    n?: number;
    roi_ask_2c?: number;
    wr?: number;
    last?: string | null;
  }>;
  clv?: Record<string, ResearchClv>;
  roster?: Array<{
    username?: string;
    wallet?: string;
    action?: string;
    max_date?: string;
    steady_grade?: string;
    steady_reason?: string;
    median_cost?: number;
    last_90d?: ResearchStat;
    curve?: { sharpe?: number; max_dd_pct?: number; worst_month_roi?: number };
    lanes?: {
      experts?: Array<{ sport?: string; submarket?: string; n?: number; roi?: number }>;
      bleeds?: Array<{ sport?: string; submarket?: string; n?: number; roi?: number }>;
    };
  }>;
  discovery?: {
    generated_at?: string;
    recommended?: Array<{
      username?: string;
      wallet?: string;
      best_pnl?: number;
      sample_hold_roi?: number;
      sample_roi?: number;
      closed_only_bias?: number;
      windows?: string[];
      screen_score?: number;
    }>;
    error?: string;
  };
}

export function loadRobustResearchFile(): RobustResearchFile | null {
  return readJsonFile<RobustResearchFile>("pnl_analysis/output/robust_research.json");
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
  const required = (filters.requireUsernames || []).map((n) => n.toLowerCase());
  if (required.length > 0) {
    const names = new Set(
      traders.map((t) => (t.name || "").toLowerCase()).filter((n) => n.length > 0),
    );
    if (!required.every((name) => names.has(name))) return false;
  }
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
