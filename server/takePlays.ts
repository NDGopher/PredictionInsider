import fs from "fs";
import path from "path";
import type { Signal, SignalsResponse } from "@shared/schema";
import {
  annotateSignal,
  diagnoseTakeGates,
  loadTailStrategiesFile,
  signalMatchesStrategy,
  type TailStrategyCard,
  type TakeGateReport,
} from "./tailStrategies";

export const TAKE_STRATEGY_ID = "asof_live_q60_sport_rel2";

export interface TakeHealthFile {
  generated_at?: string;
  as_of?: string;
  status?: string;
  pause_reason?: string | null;
  windows?: Record<string, { n?: number; win_rate?: number | null; roi_2c?: number | null; pnl_2c?: number | null }>;
  propose_drop?: Array<{ username?: string; action?: string; reason?: string }>;
  propose_add?: Array<{ username?: string; reason?: string }>;
  live_open?: Array<Record<string, unknown>>;
  near_open?: Array<Record<string, unknown>>;
}

export interface AnnotatedTakePlay {
  id: string;
  marketQuestion: string;
  slug?: string;
  side: string;
  sport?: string;
  submarket: string;
  playLabel: string;
  currentPrice: number;
  avgEntryPrice: number;
  fillPlus2c: number;
  confidence: number;
  q: number;
  rel: number;
  sportRoi: number | null;
  traders: string[];
  misses: string[];
  url?: string;
  take: boolean;
  close: boolean;
}

function loadJson<T>(rel: string): T | null {
  const p = path.join(process.cwd(), rel);
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch (err) {
    console.error(`[take-plays] failed to read ${rel}:`, err);
    return null;
  }
}

export function loadTakeHealthFile(): TakeHealthFile | null {
  return loadJson<TakeHealthFile>("pnl_analysis/output/take_health.json");
}

export function takeStrategyCard(): TailStrategyCard | null {
  const file = loadTailStrategiesFile();
  const strategies = file?.strategies ?? [];
  return (
    strategies.find((s) => s.id === TAKE_STRATEGY_ID) ||
    strategies.find((s) => s.recommended) ||
    null
  );
}

export function collectTakePlays(signals: Signal[]): {
  live: AnnotatedTakePlay[];
  near: AnnotatedTakePlay[];
  paused: boolean;
  pauseReason: string | null;
} {
  const card = takeStrategyCard();
  const filters = card?.filters;
  const health = loadTakeHealthFile();
  const paused = health?.status === "pause";
  if (!filters) {
    return { live: [], near: [], paused, pauseReason: health?.pause_reason || null };
  }
  const live: AnnotatedTakePlay[] = [];
  const near: AnnotatedTakePlay[] = [];
  for (const raw of signals) {
    const report: TakeGateReport = diagnoseTakeGates(raw, filters);
    const ann = annotateSignal(raw);
    const row: AnnotatedTakePlay = {
      id: raw.id,
      marketQuestion: raw.marketQuestion,
      slug: raw.slug,
      side: raw.side,
      sport: raw.sport || raw.category,
      submarket: ann.submarket,
      playLabel: ann.playLabel,
      currentPrice: raw.currentPrice,
      avgEntryPrice: raw.avgEntryPrice,
      fillPlus2c: report.fillPlus2c,
      confidence: raw.confidence,
      q: report.q,
      rel: report.rel,
      sportRoi: report.sportRoi,
      traders: report.allowTraders,
      misses: report.misses,
      url: raw.slug ? `https://polymarket.com/event/${raw.slug}` : undefined,
      take: report.take && signalMatchesStrategy(raw, filters),
      close: report.close,
    };
    if (row.take) live.push(row);
    else if (row.close) near.push(row);
  }
  live.sort((a, b) => b.rel - a.rel || b.q - a.q);
  near.sort((a, b) => b.rel - a.rel || b.q - a.q);
  return {
    live: live.slice(0, 40),
    near: near.slice(0, 20),
    paused,
    pauseReason: health?.pause_reason || null,
  };
}

export function takePlaysFromCache(cached: SignalsResponse | null): ReturnType<typeof collectTakePlays> {
  return collectTakePlays(cached?.signals || []);
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Drop CSV rows whose title still has a kickoff date more than 12h in the past. */
export function titleLooksStale(title: string, nowMs = Date.now()): boolean {
  const m = title.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = Date.UTC(y, mo - 1, d);
  if (!Number.isFinite(dt)) return false;
  return dt < nowMs - 12 * 60 * 60 * 1000;
}

export function mapCsvOpenRow(row: Record<string, unknown>): AnnotatedTakePlay {
  const misses = Array.isArray(row.misses) ? row.misses.map(String) : [];
  const title = String(row.title || row.play || "");
  const slug = row.slug ? String(row.slug) : undefined;
  const username = row.username ? String(row.username) : "";
  return {
    id: `csv-${String(row.wallet || username)}-${slug || title}-${String(row.side || "")}`,
    marketQuestion: title,
    slug,
    side: String(row.side || ""),
    sport: row.sport ? String(row.sport) : undefined,
    submarket: String(row.submarket || ""),
    playLabel: String(row.play || title),
    currentPrice: num(row.live),
    avgEntryPrice: num(row.entry),
    fillPlus2c: num(row.fill_plus_2c),
    confidence: num(row.q),
    q: num(row.q),
    rel: num(row.rel),
    sportRoi: row.sport_roi == null || row.sport_roi === "" ? null : num(row.sport_roi),
    traders: username ? [username] : [],
    misses,
    url: row.url ? String(row.url) : undefined,
    take: misses.length === 0,
    close: misses.length > 0 && misses.length <= 2,
  };
}

export function mapCsvOpenRows(rows: Array<Record<string, unknown>>): AnnotatedTakePlay[] {
  return rows
    .map(mapCsvOpenRow)
    .filter((p) => !titleLooksStale(p.marketQuestion) && !titleLooksStale(p.slug || ""));
}
