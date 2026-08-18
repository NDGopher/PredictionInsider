import fs from "fs";
import path from "path";
import type { Signal } from "@shared/schema";
import { formatBetHeadline, inferSubmarket, resolvePick } from "./betDescribe";

export interface TailStrategyFilters {
  minTraders: number;
  minGrade?: number;
  minQ?: number;
  priceLo: number;
  priceHi: number;
  excludeUsernames: string[];
  requireUsernames?: string[];
  /** If set, only these wallets/usernames count toward minTraders (single-name as-of copy). */
  allowUsernames?: string[];
  skipSports: string[];
  marketTypes?: string[];
  sportIncludes?: string[];
  minRelBetSize?: number;
  minSportRoi?: number;
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

export interface InsiderOurMetrics {
  dashboard_pnl?: number | null;
  roi?: number | null;
  win_rate?: number | null;
  sharpe?: number | null;
  profit_factor?: number | null;
  median_stake?: number | null;
  markets?: number | null;
  events?: number | null;
  hedge_frac?: number | null;
    last_30d_pnl?: number | null;
    last_30d_wr?: number | null;
    last_30d_roi?: number | null;
    last_30d_n?: number | null;
    last_60d_pnl?: number | null;
    last_60d_wr?: number | null;
    last_60d_roi?: number | null;
    last_60d_n?: number | null;
    last_90d_pnl?: number | null;
    last_90d_wr?: number | null;
    last_90d_roi?: number | null;
    last_90d_n?: number | null;
  quality_score?: number | null;
  tier?: string | null;
  top_sport?: string | null;
  last_event_date?: string | null;
}

export interface InsiderBookFlags {
  rows?: number;
  closed?: number;
  open?: number;
  realized_pos?: number;
  realized_neg?: number;
  sum_dash?: number;
  profit_factor?: number | null;
  winner_capped?: boolean;
  book_note?: string;
}

export interface PolydataReference {
  url?: string;
  ok?: boolean;
  error?: string;
  smart_score?: number | null;
  win_rate?: number | null;
  pnl?: number | null;
  trades?: number | null;
  overall_rank?: number | null;
  sports_rank?: number | null;
  sports_pnl?: number | null;
  sports_volume?: number | null;
  profit_factor?: number | null;
  sharpe?: number | null;
  sortino?: number | null;
  hhi?: number | null;
  kelly_pct?: number | null;
  bot_score?: number | null;
  bot_class?: string | null;
  trades_per_day?: number | null;
  active_hours?: number | null;
}

export interface RankWindow {
  n?: number | null;
  pnl?: number | null;
  wr?: number | null;
  roi?: number | null;
  first?: string | null;
  last?: string | null;
}

export interface RankAccuracy {
  wr_delta_pp?: number | null;
  pnl_ratio?: number | null;
  matched?: boolean;
  note?: string;
}

export interface InsiderRankRow {
  username: string;
  wallet: string;
  on_roster?: boolean;
  lane?: string;
  take_book?: boolean;
  score_source?: string;
  insider_rank?: number;
  insider_score: number;
  badge?: string;
  copyable?: boolean;
  copy_note?: string;
  recency_band?: string;
  live_weight?: number;
  days_since_last?: number | null;
  polymarket_url?: string;
  our?: InsiderOurMetrics;
  windows?: {
    last_30d?: RankWindow | null;
    last_60d?: RankWindow | null;
    last_90d?: RankWindow | null;
  };
  book?: InsiderBookFlags;
  polydata?: PolydataReference;
  accuracy?: RankAccuracy;
  pnl_vs_polydata?: { ratio?: number | null; flag?: boolean; note?: string };
  components?: Record<string, number>;
  health_action?: string;
  extra_status?: string;
  untailable?: boolean;
  untailable_reason?: string;
  market_maker?: boolean;
  winner_capped?: boolean;
}

export interface InsiderRanksFile {
  generated_at?: string;
  as_of?: string;
  method?: string;
  weights?: Record<string, number>;
  polydata_weights?: Record<string, number>;
  counts?: Record<string, number>;
  polydata_sports_board?: Array<{
    username: string;
    wallet?: string;
    on_roster?: boolean;
    sports_rank?: number | null;
    sports_pnl?: number | null;
    smart_score?: number | null;
    win_rate?: number | null;
    profit_factor?: number | null;
    insider_score?: number;
    copyable?: boolean;
  }>;
  traders?: InsiderRankRow[];
}

export function loadInsiderRanksFile(): InsiderRanksFile | null {
  return readJsonFile<InsiderRanksFile>("pnl_analysis/output/insider_ranks.json");
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
  const h = [
    signal.marketQuestion,
    signal.slug,
    signal.outcomeLabel,
    signal.outcome,
    sub,
  ]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" ")
    .toLowerCase();
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
  const allow = (filters.allowUsernames || []).map((n) => n.toLowerCase()).filter((n) => n.length > 0);
  const allowSet = new Set(allow);
  const traders = (signal.traders || []).filter((t) => {
    const name = (t.name || "").toLowerCase();
    const addr = (t.address || "").toLowerCase();
    if (exclude.has(name)) return false;
    for (const ex of exclude) {
      if (addr.includes(ex) || name.includes(ex)) return false;
    }
    if (allowSet.size > 0) {
      const allowed = allowSet.has(name) || allow.some((a) => addr.includes(a) || name.includes(a));
      if (!allowed) return false;
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
  const q = Math.max(
    signal.avgQuality ?? 0,
    ...traders.map((t) => t.qualityScore ?? 0),
  );
  if ((filters.minQ || 0) > 0 && q < (filters.minQ || 0)) return false;
  const px = signal.currentPrice || signal.avgEntryPrice;
  if (px < filters.priceLo || px > filters.priceHi) return false;
  if ((filters.minRelBetSize || 0) > 0 && (signal.relBetSize ?? 0) < (filters.minRelBetSize || 0)) {
    return false;
  }
  if ((filters.minSportRoi || 0) > 0) {
    const sportRoi = Math.max(
      signal.insiderSportsROI ?? Number.NEGATIVE_INFINITY,
      ...traders.map((t) => t.sportRoi ?? Number.NEGATIVE_INFINITY),
    );
    if (!Number.isFinite(sportRoi) || sportRoi < (filters.minSportRoi || 0)) return false;
  }
  if (sportSkipped(signal.sport || signal.category, filters.skipSports || [])) return false;
  if (!sportIncluded(signal.sport || signal.category, filters.sportIncludes)) return false;
  if (!marketAllowed(signal, filters.marketTypes)) return false;
  return true;
}

export interface TakeGateReport {
  take: boolean;
  close: boolean;
  misses: string[];
  q: number;
  rel: number;
  sportRoi: number | null;
  price: number;
  fillPlus2c: number;
  allowTraders: string[];
}

export function diagnoseTakeGates(signal: Signal, filters: TailStrategyFilters): TakeGateReport {
  const misses: string[] = [];
  const exclude = new Set((filters.excludeUsernames || []).map((n) => n.toLowerCase()));
  const allow = (filters.allowUsernames || []).map((n) => n.toLowerCase()).filter((n) => n.length > 0);
  const allowSet = new Set(allow);
  const allowTraders = (signal.traders || []).filter((t) => {
    const name = (t.name || "").toLowerCase();
    const addr = (t.address || "").toLowerCase();
    if (exclude.has(name)) return false;
    if (allowSet.size === 0) return true;
    return allowSet.has(name) || allow.some((a) => addr.includes(a) || name.includes(a));
  });
  if (allowTraders.length < (filters.minTraders || 1)) {
    misses.push("not a matched-book wallet");
  }
  const q = Math.max(
    signal.avgQuality ?? 0,
    ...allowTraders.map((t) => t.qualityScore ?? 0),
    ...((signal.traders || []).map((t) => t.qualityScore ?? 0)),
  );
  if ((filters.minQ || 0) > 0 && q < (filters.minQ || 0)) {
    misses.push(`Q ${Math.round(q)} < ${filters.minQ}`);
  }
  const px = signal.currentPrice || signal.avgEntryPrice;
  if (px < filters.priceLo || px > filters.priceHi) {
    misses.push(`price ${(px * 100).toFixed(0)}¢ outside ${(filters.priceLo * 100).toFixed(0)}–${(filters.priceHi * 100).toFixed(0)}¢`);
  }
  const rel = signal.relBetSize ?? 0;
  if ((filters.minRelBetSize || 0) > 0 && rel < (filters.minRelBetSize || 0)) {
    misses.push(`size ${rel.toFixed(1)}× < ${filters.minRelBetSize}×`);
  }
  const sportRoi = Math.max(
    signal.insiderSportsROI ?? Number.NEGATIVE_INFINITY,
    ...allowTraders.map((t) => t.sportRoi ?? Number.NEGATIVE_INFINITY),
    ...((signal.traders || []).map((t) => t.sportRoi ?? Number.NEGATIVE_INFINITY)),
  );
  const sportRoiOut = Number.isFinite(sportRoi) ? sportRoi : null;
  if ((filters.minSportRoi || 0) > 0 && (sportRoiOut == null || sportRoiOut < (filters.minSportRoi || 0))) {
    misses.push(`sport ROI ${sportRoiOut == null ? "n/a" : sportRoiOut.toFixed(0) + "%"} < ${filters.minSportRoi}%`);
  }
  if (sportSkipped(signal.sport || signal.category, filters.skipSports || [])) {
    misses.push("NFL skipped");
  }
  const take = misses.length === 0 && signalMatchesStrategy(signal, filters);
  const close = !take && allowTraders.length > 0 && misses.length <= 2;
  return {
    take,
    close,
    misses,
    q,
    rel,
    sportRoi: sportRoiOut,
    price: px,
    fillPlus2c: Math.min(Math.max(px + 0.02, 0.02), 0.98),
    allowTraders: allowTraders.map((t) => t.name || t.address.slice(0, 10)).filter(Boolean),
  };
}

export function annotateSignal(signal: Signal): Signal & { submarket: string; playLabel: string; pick: string } {
  const submarket = inferSubmarket(signal);
  const sport = signal.sport || signal.category || "Unknown";
  const pick = resolvePick(signal);
  return {
    ...signal,
    submarket,
    pick,
    playLabel: formatBetHeadline(pick, submarket, sport),
  };
}
