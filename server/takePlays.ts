import fs from "fs";
import path from "path";
import type { Signal, SignalsResponse } from "@shared/schema";
import { fetchClobQuotes } from "./clobAsk";
import { formatPriceQuote, type PriceQuoteFmt } from "./oddsFormat";
import { formatBetHeadline, inferSubmarket, playLane, resolvePick } from "./betDescribe";
import {
  annotateSignal,
  diagnoseTakeGates,
  loadTailStrategiesFile,
  signalMatchesStrategy,
  type TailStrategyCard,
  type TakeGateReport,
} from "./tailStrategies";

export const TAKE_STRATEGY_ID = "asof_live_q60_sport_rel2";
export const TAKE_PRICE_LO = 0.1;
export const TAKE_PRICE_HI = 0.88;
export const TAKE_CUSHION = 0.02;

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
  pick: string;
  lane: "sports" | "other" | "futures";
  outcomeLabel?: string;
  currentPrice: number;
  avgEntryPrice: number;
  fillPlus2c: number;
  takeCap: number;
  liveAsk: number | null;
  liveBid: number | null;
  takePrice: number | null;
  quoteSource: "clob" | "signal" | "none";
  quoteAt: number | null;
  takeFmt: PriceQuoteFmt | null;
  liveFmt: PriceQuoteFmt | null;
  vwapFmt: PriceQuoteFmt | null;
  valid: boolean;
  invalidReason: string | null;
  /** 0–100 play grade (signal confidence, take-boosted when all gates pass). */
  grade: number;
  confidence: number;
  q: number;
  rel: number;
  sportRoi: number | null;
  traders: string[];
  misses: string[];
  /** Human-readable reasons for the grade / TAKE decision. */
  why: string[];
  scoreBreakdown?: Record<string, number>;
  url?: string;
  take: boolean;
  close: boolean;
  tokenId?: string;
  conditionId?: string;
  rank?: number;
}

export interface TakePlayBundle {
  live: AnnotatedTakePlay[];
  near: AnnotatedTakePlay[];
  paused: boolean;
  pauseReason: string | null;
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

export function loadTrustedCopyBooks(): Array<{ username: string; wallet: string }> {
  const uni = loadJson<{ live?: Array<{ username?: string; wallet?: string }> }>(
    "pnl_analysis/output/copy_universe.json",
  );
  const live = (uni?.live || [])
    .map((t) => ({ username: String(t.username || ""), wallet: String(t.wallet || "") }))
    .filter((t) => t.username || t.wallet);
  if (live.length > 0) {
    console.log(`[take-plays] copy books from copy_universe live (${live.length}): ${live.map((t) => t.username).join(", ")}`);
    return live;
  }
  console.warn("[take-plays] copy_universe.json has no live books — not falling back to the stale take-book 12");
  return [];
}

export interface LaneBacktest {
  n: number;
  win_rate: number;
  roi_2c: number;
}

export function loadLaneBacktest(): { sports?: LaneBacktest; other?: LaneBacktest; all?: LaneBacktest; by_submarket?: Record<string, LaneBacktest> } | null {
  return loadJson("pnl_analysis/output/take_lane_backtest.json");
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

export function tokenIdForSignal(signal: Signal): string | undefined {
  const side = (signal.side || "YES").toUpperCase();
  if (side === "NO") return signal.noTokenId || undefined;
  return signal.yesTokenId || undefined;
}

function takeCapFromVwap(vwap: number): number {
  return Math.min(TAKE_PRICE_HI, Math.max(TAKE_PRICE_LO, vwap + TAKE_CUSHION));
}

function validityForAsk(ask: number | null, takeCap: number, quoteSource: AnnotatedTakePlay["quoteSource"]): {
  valid: boolean;
  reason: string | null;
} {
  if (ask == null || ask <= 0) {
    return { valid: quoteSource !== "clob", reason: quoteSource === "clob" ? "no live ask" : null };
  }
  if (ask <= 0.02 || ask >= 0.98) {
    return { valid: false, reason: `locked/resolved at ${ask.toFixed(3)}` };
  }
  if (ask < TAKE_PRICE_LO || ask > TAKE_PRICE_HI) {
    return { valid: false, reason: `live ask ${ask.toFixed(3)} outside ${TAKE_PRICE_LO}–${TAKE_PRICE_HI}` };
  }
  if (ask > takeCap + 0.001) {
    return { valid: false, reason: `live ask ${ask.toFixed(3)} > take cap ${takeCap.toFixed(3)}` };
  }
  return { valid: true, reason: null };
}

function applyQuote(row: AnnotatedTakePlay): void {
  const ask = row.liveAsk;
  const takePrice = ask != null && ask > 0 ? ask : row.currentPrice || row.avgEntryPrice;
  row.takePrice = takePrice;
  row.takeFmt = takePrice > 0 ? formatPriceQuote(row.takeCap) : null;
  row.liveFmt = ask != null && ask > 0 ? formatPriceQuote(ask) : (row.currentPrice > 0 ? formatPriceQuote(row.currentPrice) : null);
  row.vwapFmt = row.avgEntryPrice > 0 ? formatPriceQuote(row.avgEntryPrice) : null;
  const gate = validityForAsk(ask, row.takeCap, row.quoteSource);
  if (row.take && !gate.valid) {
    row.valid = false;
    row.invalidReason = gate.reason;
    row.take = false;
    if (gate.reason && !row.misses.includes(gate.reason)) row.misses.push(gate.reason);
  } else if (row.take) {
    row.valid = true;
    row.invalidReason = null;
  } else {
    row.valid = false;
    row.invalidReason = row.misses[0] || gate.reason;
  }
}

function breakdownWhy(breakdown: Record<string, number> | undefined): string[] {
  if (!breakdown) return [];
  const labels: Array<[string, string, number]> = [
    ["roiPct", "Trader ROI edge", 40],
    ["consensusPct", "Consensus", 30],
    ["valuePct", "Value vs live", 20],
    ["sizePct", "Position size", 10],
    ["relSizePts", "Relative size (conviction)", 15],
    ["tierBonus", "Multi-trader / tier", 15],
    ["qualityBoost", "Quality boost", 6],
  ];
  const out: string[] = [];
  for (const [key, label, max] of labels) {
    const v = breakdown[key];
    if (typeof v === "number" && v > 0) out.push(`${label} ${Math.round(v)}/${max}`);
  }
  return out;
}

/** 0–100 grade: signal confidence, +small boost when TAKE gates all clear. */
export function computePlayGrade(confidence: number, take: boolean, q: number, rel: number): number {
  let g = Math.max(0, Math.min(100, Math.round(confidence || 0)));
  if (take) {
    if (q >= 70) g = Math.min(100, g + 3);
    if (rel >= 3) g = Math.min(100, g + 2);
    if (rel >= 5) g = Math.min(100, g + 2);
  }
  return g;
}

export function buildTakeWhy(opts: {
  take: boolean;
  q: number;
  rel: number;
  sportRoi: number | null;
  traders: string[];
  misses: string[];
  confidence: number;
  scoreBreakdown?: Record<string, number>;
  valid: boolean;
  invalidReason: string | null;
}): string[] {
  const why: string[] = [];
  if (opts.take && opts.valid) {
    why.push("Passes Take these gates (Q≥60, sport ROI≥+5%, ≥2× size, 10–88¢, no NFL)");
  }
  if (opts.q > 0) why.push(`Trader quality Q ${Math.round(opts.q)}/100`);
  if (opts.rel > 0) why.push(`Stake ${opts.rel.toFixed(1)}× their own median`);
  if (opts.sportRoi != null) why.push(`As-of sport-lane ROI ${opts.sportRoi.toFixed(0)}%`);
  if (opts.traders.length) why.push(`Copy book: ${opts.traders.join(", ")}`);
  why.push(...breakdownWhy(opts.scoreBreakdown));
  if (opts.confidence > 0) why.push(`Signal confidence ${Math.round(opts.confidence)}/100`);
  for (const m of opts.misses) {
    if (!why.some((w) => w.includes(m))) why.push(`Missing: ${m}`);
  }
  if (opts.invalidReason) why.push(`Fill gate: ${opts.invalidReason}`);
  return why.slice(0, 10);
}

function playFromSignal(raw: Signal, report: TakeGateReport): AnnotatedTakePlay {
  const ann = annotateSignal(raw);
  const vwap = raw.avgEntryPrice || raw.currentPrice || 0;
  const takeCap = takeCapFromVwap(vwap);
  const tokenId = tokenIdForSignal(raw);
  const filters = takeStrategyCard()?.filters;
  const take = Boolean(filters && report.take && signalMatchesStrategy(raw, filters));
  const breakdown = (raw as Signal & { scoreBreakdown?: Record<string, number> }).scoreBreakdown;
  const grade = computePlayGrade(raw.confidence, take, report.q, report.rel);
  const row: AnnotatedTakePlay = {
    id: raw.id,
    marketQuestion: raw.marketQuestion,
    slug: raw.slug,
    side: raw.side,
    sport: raw.sport || raw.category,
    submarket: ann.submarket,
    playLabel: ann.playLabel,
    pick: ann.pick,
    lane: playLane(raw.sport || raw.category, ann.submarket),
    outcomeLabel: raw.outcomeLabel || ann.pick,
    currentPrice: raw.currentPrice,
    avgEntryPrice: raw.avgEntryPrice,
    fillPlus2c: takeCap,
    takeCap,
    liveAsk: raw.currentPrice || null,
    liveBid: null,
    takePrice: raw.currentPrice || takeCap,
    quoteSource: "signal",
    quoteAt: null,
    takeFmt: null,
    liveFmt: null,
    vwapFmt: null,
    valid: false,
    invalidReason: null,
    grade,
    confidence: raw.confidence,
    q: report.q,
    rel: report.rel,
    sportRoi: report.sportRoi,
    traders: report.allowTraders,
    misses: [...report.misses],
    why: [],
    scoreBreakdown: breakdown,
    url: raw.slug ? `https://polymarket.com/event/${raw.slug}` : undefined,
    take,
    close: report.close,
    tokenId,
    conditionId: raw.marketId,
  };
  applyQuote(row);
  row.grade = computePlayGrade(row.confidence, row.take && row.valid, row.q, row.rel);
  row.why = buildTakeWhy({
    take: row.take,
    q: row.q,
    rel: row.rel,
    sportRoi: row.sportRoi,
    traders: row.traders,
    misses: row.misses,
    confidence: row.confidence,
    scoreBreakdown: row.scoreBreakdown,
    valid: row.valid,
    invalidReason: row.invalidReason,
  });
  return row;
}

export function collectTakePlays(signals: Signal[]): TakePlayBundle {
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
    const row = playFromSignal(raw, report);
    if (row.lane === "futures" || row.submarket === "Futures") continue;
    if (row.take) live.push(row);
    else if (row.close) near.push(row);
  }
  live.sort((a, b) => b.grade - a.grade || b.rel - a.rel || b.q - a.q);
  near.sort((a, b) => b.grade - a.grade || b.rel - a.rel || b.q - a.q);
  live.forEach((p, i) => {
    p.rank = i + 1;
  });
  near.forEach((p, i) => {
    p.rank = i + 1;
  });
  return {
    live: live.slice(0, 40),
    near: near.slice(0, 20),
    paused,
    pauseReason: health?.pause_reason || null,
  };
}

/** Overlay CLOB asks; drop TAKEs that can no longer be filled inside the cap. */
export async function enrichTakePlaysWithBook(bundle: TakePlayBundle): Promise<TakePlayBundle> {
  const rows = [...bundle.live, ...bundle.near];
  const tokenIds = rows.map((r) => r.tokenId).filter((t): t is string => Boolean(t));
  const quotes = tokenIds.length > 0 ? await fetchClobQuotes(tokenIds) : new Map();
  const stillLive: AnnotatedTakePlay[] = [];
  const stillNear: AnnotatedTakePlay[] = [];
  for (const row of bundle.live) {
    const q = row.tokenId ? quotes.get(row.tokenId) : undefined;
    if (q && q.ask != null) {
      row.liveAsk = q.ask;
      row.liveBid = q.bid;
      row.quoteSource = "clob";
      row.quoteAt = q.fetchedAt;
      row.currentPrice = q.ask;
    }
    applyQuote(row);
    if (row.take && row.valid) stillLive.push(row);
    else if (row.close || row.misses.length > 0) {
      row.grade = computePlayGrade(row.confidence, false, row.q, row.rel);
      row.why = buildTakeWhy({
        take: false,
        q: row.q,
        rel: row.rel,
        sportRoi: row.sportRoi,
        traders: row.traders,
        misses: row.misses,
        confidence: row.confidence,
        scoreBreakdown: row.scoreBreakdown,
        valid: row.valid,
        invalidReason: row.invalidReason,
      });
      stillNear.push(row);
    }
  }
  for (const row of bundle.near) {
    const q = row.tokenId ? quotes.get(row.tokenId) : undefined;
    if (q && q.ask != null) {
      row.liveAsk = q.ask;
      row.liveBid = q.bid;
      row.quoteSource = "clob";
      row.quoteAt = q.fetchedAt;
      row.currentPrice = q.ask;
    }
    applyQuote(row);
    row.grade = computePlayGrade(row.confidence, false, row.q, row.rel);
    row.why = buildTakeWhy({
      take: false,
      q: row.q,
      rel: row.rel,
      sportRoi: row.sportRoi,
      traders: row.traders,
      misses: row.misses,
      confidence: row.confidence,
      scoreBreakdown: row.scoreBreakdown,
      valid: row.valid,
      invalidReason: row.invalidReason,
    });
    stillNear.push(row);
  }
  for (const row of stillLive) {
    row.grade = computePlayGrade(row.confidence, true, row.q, row.rel);
    row.why = buildTakeWhy({
      take: true,
      q: row.q,
      rel: row.rel,
      sportRoi: row.sportRoi,
      traders: row.traders,
      misses: row.misses,
      confidence: row.confidence,
      scoreBreakdown: row.scoreBreakdown,
      valid: row.valid,
      invalidReason: row.invalidReason,
    });
  }
  stillLive.sort((a, b) => b.grade - a.grade || b.rel - a.rel || b.q - a.q);
  stillNear.sort((a, b) => b.grade - a.grade || b.rel - a.rel || b.q - a.q);
  stillLive.forEach((p, i) => {
    p.rank = i + 1;
  });
  stillNear.forEach((p, i) => {
    p.rank = i + 1;
  });
  bundle.live = stillLive.slice(0, 40);
  bundle.near = stillNear.slice(0, 20);
  return bundle;
}

export function takePlaysFromCache(cached: SignalsResponse | null): TakePlayBundle {
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
  const vwap = num(row.entry);
  const live = num(row.live);
  const takeCap = takeCapFromVwap(vwap);
  const side = String(row.side || "YES");
  const sport = row.sport ? String(row.sport) : undefined;
  const pick = resolvePick({
    marketQuestion: title,
    side,
    outcome: row.outcome ? String(row.outcome) : undefined,
  });
  const submarket = String(row.submarket || inferSubmarket({ marketQuestion: title, sport }));
  const play: AnnotatedTakePlay = {
    id: `csv-${String(row.wallet || username)}-${slug || title}-${side}`,
    marketQuestion: title,
    slug,
    side,
    sport,
    submarket,
    playLabel: formatBetHeadline(pick, submarket, sport),
    pick,
    lane: playLane(sport, submarket),
    outcomeLabel: pick,
    currentPrice: live,
    avgEntryPrice: vwap,
    fillPlus2c: num(row.fill_plus_2c, takeCap),
    takeCap,
    liveAsk: live || null,
    liveBid: null,
    takePrice: live || takeCap,
    quoteSource: "signal",
    quoteAt: null,
    takeFmt: null,
    liveFmt: null,
    vwapFmt: null,
    valid: misses.length === 0,
    invalidReason: misses[0] || null,
    grade: computePlayGrade(num(row.q), misses.length === 0, num(row.q), num(row.rel)),
    confidence: num(row.q),
    q: num(row.q),
    rel: num(row.rel),
    sportRoi: row.sport_roi == null || row.sport_roi === "" ? null : num(row.sport_roi),
    traders: username ? [username] : [],
    misses,
    why: [],
    url: row.url ? String(row.url) : undefined,
    take: misses.length === 0,
    close: misses.length > 0 && misses.length <= 2,
  };
  applyQuote(play);
  play.why = buildTakeWhy({
    take: play.take,
    q: play.q,
    rel: play.rel,
    sportRoi: play.sportRoi,
    traders: play.traders,
    misses: play.misses,
    confidence: play.confidence,
    valid: play.valid,
    invalidReason: play.invalidReason,
  });
  return play;
}

export function mapCsvOpenRows(rows: Array<Record<string, unknown>>): AnnotatedTakePlay[] {
  return rows
    .map(mapCsvOpenRow)
    .filter((p) => p.lane !== "futures" && p.submarket !== "Futures")
    .filter((p) => !titleLooksStale(p.marketQuestion) && !titleLooksStale(p.slug || ""));
}

export interface CopyDiscoveryBundle {
  generatedAt: string | null;
  live: Array<Record<string, unknown>>;
  bench: Array<Record<string, unknown>>;
  watch: Array<Record<string, unknown>>;
  adaptiveActions: Array<Record<string, unknown>>;
  topComposite: Array<Record<string, unknown>>;
  proposeAdd: Array<Record<string, unknown>>;
  proposeDrop: Array<Record<string, unknown>>;
  method: string;
}

/** Live roster + adaptive lab proposals for the UI discovery panel. */
export function loadCopyDiscovery(): CopyDiscoveryBundle {
  const uni = loadJson<{
    generated_at?: string;
    live?: Array<Record<string, unknown>>;
    bench?: Array<Record<string, unknown>>;
    watch?: Array<Record<string, unknown>>;
  }>("pnl_analysis/output/copy_universe.json");
  const lab = loadJson<{
    generated_at?: string;
    traders?: Array<Record<string, unknown>>;
    adaptation?: { actions?: Array<Record<string, unknown>> };
  }>("pnl_analysis/output/adaptive_copy_lab.json");
  const health = loadTakeHealthFile();
  const traders = lab?.traders || [];
  const topComposite = traders
    .slice()
    .sort((a, b) => Number(b.composite_score || 0) - Number(a.composite_score || 0))
    .slice(0, 15)
    .map((t) => ({
      username: t.username,
      bucket: t.bucket,
      compositeScore: t.composite_score,
      joinability: (t.joinability as { score?: number } | undefined)?.score,
      consistency: (t.equity as { consistency_score?: number } | undefined)?.consistency_score,
      takeN: (t.product as { n?: number } | undefined)?.n,
      takeRoi: (t.product as { roi?: number } | undefined)?.roi,
      action: (t.adaptive as { action?: string } | undefined)?.action,
      why: (t.adaptive as { why?: string } | undefined)?.why,
      uniqueRoi: t.unique_roi,
      medianStake: t.median_stake,
    }));
  return {
    generatedAt: lab?.generated_at || uni?.generated_at || null,
    live: (uni?.live || []).map((t) => ({
      username: t.username,
      wallet: t.wallet,
      uniqueRoi: t.unique_roi,
      winRate: t.win_rate,
      medianStake: t.median_stake,
      last30n: t.last_30d_n,
      reasons: t.reasons,
    })),
    bench: (uni?.bench || []).slice(0, 20).map((t) => ({
      username: t.username,
      uniqueRoi: t.unique_roi,
      reasons: t.reasons,
      recency: t.recency,
    })),
    watch: (uni?.watch || []).slice(0, 24).map((t) => ({
      username: t.username,
      uniqueRoi: t.unique_roi,
      joinable: t.joinable,
      last30n: t.last_30d_n,
      medianStake: t.median_stake,
      reasons: t.reasons,
    })),
    adaptiveActions: lab?.adaptation?.actions || [],
    topComposite,
    proposeAdd: health?.propose_add || [],
    proposeDrop: health?.propose_drop || [],
    method:
      "Polydata boards → extra_watch → unique book → adaptive lab. Watch never auto-live. "
      + "Daily: npm run daily-pipeline / discover:polydata.",
  };
}
