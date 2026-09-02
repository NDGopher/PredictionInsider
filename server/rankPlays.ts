/**
 * Rank every open book/play (OddsJam-style).
 * Weights match pnl_analysis/rank_plays.py — do not invent fills.
 */
import type { AnnotatedTakePlay } from "./takePlays";

export const RANK_WEIGHTS = {
  edgePerCent: 4,
  edgeMin: -20,
  edgeMax: 40,
  q: 0.25,
  sizePerX: 8,
  sizeCapX: 4,
  sportRoi: 0.4,
  sportRoiMin: -10,
  sportRoiMax: 20,
  fillable: 20,
  fillableBand: 8,
} as const;

const TAKE_LO = 0.1;
const TAKE_HI = 0.88;

export type TakeLane = "TAKE" | "NEAR" | "SKIP";

export interface RankedPlay {
  rank: number;
  rankScore: number;
  whyRank: string;
  takeLane: TakeLane;
  id: string;
  displayName: string;
  traders: string[];
  playLabel: string;
  marketQuestion: string;
  sport?: string;
  submarket: string;
  q: number;
  rel: number;
  sportRoi: number | null;
  edgeCents: number;
  liveAsk: number | null;
  takeCap: number;
  fillable: boolean;
  fillability: number;
  misses: string[];
  url?: string;
  slug?: string;
}

export interface RankParts {
  edge: number;
  q: number;
  size: number;
  sportRoi: number;
  fillability: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function takeLaneOf(play: AnnotatedTakePlay): TakeLane {
  if (play.take && play.valid) return "TAKE";
  if (play.close || (play.misses.length > 0 && play.misses.length <= 2)) return "NEAR";
  return "SKIP";
}

export function edgeCentsOf(play: AnnotatedTakePlay): number {
  const ask = play.liveAsk ?? play.currentPrice;
  if (!(ask > 0) || !(play.takeCap > 0)) return 0;
  return (play.takeCap - ask) * 100;
}

export function fillabilityOf(play: AnnotatedTakePlay): { frac: number; ok: boolean; why: string } {
  const sport = (play.sport || "").toLowerCase();
  const sub = (play.submarket || "").toLowerCase();
  if (sport.includes("nfl")) return { frac: 0, ok: false, why: "NFL blocked" };
  if (play.lane === "futures" || sub === "futures") return { frac: 0, ok: false, why: "futures blocked" };
  const ask = play.liveAsk ?? play.currentPrice;
  if (!(ask > 0)) return { frac: 0.15, ok: false, why: "no live ask" };
  const inBand = ask >= TAKE_LO && ask <= TAKE_HI;
  const underCap = ask <= play.takeCap + 0.001;
  if (inBand && underCap) return { frac: 1, ok: true, why: "fillable" };
  if (inBand) return { frac: 0.4, ok: false, why: `ask ${ask.toFixed(3)} over cap ${play.takeCap.toFixed(3)}` };
  if (underCap) return { frac: 0.25, ok: false, why: `ask ${ask.toFixed(3)} outside 10–88¢` };
  return { frac: 0, ok: false, why: `ask ${ask.toFixed(3)} unfillable` };
}

export function rankScoreOf(play: AnnotatedTakePlay): { score: number; parts: RankParts } {
  const edge = edgeCentsOf(play);
  const edgePts = clamp(edge * RANK_WEIGHTS.edgePerCent, RANK_WEIGHTS.edgeMin, RANK_WEIGHTS.edgeMax);
  const qPts = clamp(play.q, 0, 100) * RANK_WEIGHTS.q;
  const sizePts = clamp(play.rel, 0, RANK_WEIGHTS.sizeCapX) * RANK_WEIGHTS.sizePerX;
  const roi = play.sportRoi;
  const roiPts = roi == null
    ? 0
    : clamp(roi * RANK_WEIGHTS.sportRoi, RANK_WEIGHTS.sportRoiMin, RANK_WEIGHTS.sportRoiMax);
  const fill = fillabilityOf(play);
  let fillPts: number;
  if (fill.frac >= 1) fillPts = RANK_WEIGHTS.fillable;
  else if (fill.frac >= 0.4) fillPts = RANK_WEIGHTS.fillableBand * (fill.frac / 0.4);
  else fillPts = RANK_WEIGHTS.fillable * fill.frac;
  const parts: RankParts = {
    edge: Math.round(edgePts * 1000) / 1000,
    q: Math.round(qPts * 1000) / 1000,
    size: Math.round(sizePts * 1000) / 1000,
    sportRoi: Math.round(roiPts * 1000) / 1000,
    fillability: Math.round(fillPts * 1000) / 1000,
  };
  const score = Math.round((parts.edge + parts.q + parts.size + parts.sportRoi + parts.fillability) * 1000) / 1000;
  return { score, parts };
}

function whyRank(play: AnnotatedTakePlay, parts: RankParts, fillWhy: string): string {
  const roi = play.sportRoi;
  const edge = edgeCentsOf(play);
  const top = (Object.entries(parts) as Array<[keyof RankParts, number]>)
    .sort((a, b) => b[1] - a[1])[0];
  const bits = [
    `Q ${Math.round(play.q)}`,
    `${play.rel.toFixed(1)}× size`,
    roi == null ? "sport ROI n/a" : `sport ROI ${roi >= 0 ? "+" : ""}${roi.toFixed(0)}%`,
    `${edge >= 0 ? "+" : ""}${edge.toFixed(1)}¢ vs cap`,
    fillWhy,
  ];
  if (top) bits.push(`top factor ${top[0] === "sportRoi" ? "sport_roi" : top[0]}`);
  return bits.join(" · ");
}

export function rankOpenPlays(
  plays: AnnotatedTakePlay[],
  englishName: (username: string, wallet?: string) => string,
): RankedPlay[] {
  const seen = new Set<string>();
  const scored: RankedPlay[] = [];
  for (const play of plays) {
    if (seen.has(play.id)) continue;
    seen.add(play.id);
    const { score, parts } = rankScoreOf(play);
    const fill = fillabilityOf(play);
    const traders = play.traders || [];
    const displayName = traders[0] ? englishName(traders[0]) : "Book";
    scored.push({
      rank: 0,
      rankScore: score,
      whyRank: whyRank(play, parts, fill.why),
      takeLane: takeLaneOf(play),
      id: play.id,
      displayName,
      traders,
      playLabel: play.playLabel || play.pick || play.outcomeLabel || play.side,
      marketQuestion: play.marketQuestion,
      sport: play.sport,
      submarket: play.submarket,
      q: play.q,
      rel: play.rel,
      sportRoi: play.sportRoi,
      edgeCents: Math.round(edgeCentsOf(play) * 100) / 100,
      liveAsk: play.liveAsk ?? play.currentPrice ?? null,
      takeCap: play.takeCap,
      fillable: fill.ok,
      fillability: Math.round(fill.frac * 1000) / 1000,
      misses: play.misses,
      url: play.url,
      slug: play.slug,
    });
  }
  scored.sort((a, b) => b.rankScore - a.rankScore || b.q - a.q || b.rel - a.rel);
  return scored.map((row, i) => ({ ...row, rank: i + 1 }));
}
