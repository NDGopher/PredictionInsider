/**
 * TS ranking smoke test — same weights as pnl_analysis/rank_plays.py
 * Run: npx tsx server/test_rankPlays.ts
 */
import { rankOpenPlays, rankScoreOf, type RankedPlay } from "./rankPlays";
import type { AnnotatedTakePlay } from "./takePlays";

function play(partial: Partial<AnnotatedTakePlay> & { id: string }): AnnotatedTakePlay {
  return {
    marketQuestion: "Lakers vs Celtics",
    side: "YES",
    submarket: "Spread",
    playLabel: "Lakers -4.5",
    pick: "Lakers -4.5",
    lane: "sports",
    currentPrice: 0.54,
    avgEntryPrice: 0.52,
    fillPlus2c: 0.56,
    takeCap: 0.56,
    liveAsk: 0.54,
    liveBid: 0.53,
    takePrice: 0.54,
    quoteSource: "signal",
    quoteAt: null,
    takeFmt: null,
    liveFmt: null,
    vwapFmt: null,
    valid: true,
    invalidReason: null,
    confidence: 70,
    q: 70,
    rel: 2.5,
    sportRoi: 12,
    traders: ["Vetch"],
    misses: [],
    take: true,
    close: false,
    sport: "NBA",
    ...partial,
  };
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const take = play({ id: "take", q: 72, rel: 3.1, sportRoi: 18, liveAsk: 0.54, takeCap: 0.56, take: true, valid: true });
const near = play({
  id: "near",
  q: 52,
  rel: 8,
  sportRoi: 8,
  liveAsk: 0.87,
  takeCap: 0.82,
  take: false,
  valid: false,
  close: true,
  misses: ["Q 52 < 60"],
});
const skip = play({
  id: "skip",
  q: 40,
  rel: 0.4,
  sportRoi: -5,
  liveAsk: 0.93,
  takeCap: 0.7,
  take: false,
  valid: false,
  misses: ["Q", "size", "band"],
  sport: "NFL",
});

const ranked: RankedPlay[] = rankOpenPlays([skip, near, take], (n) => n);
assert(ranked.map((r) => r.id).join(",") === "take,near,skip", `order ${ranked.map((r) => r.id)}`);
assert(ranked[0].takeLane === "TAKE", "take lane");
assert(ranked[0].fillable === true, "take fillable");
assert(ranked[0].whyRank.includes("Q 72"), ranked[0].whyRank);
assert(rankScoreOf(take).score > rankScoreOf(near).score, "take score");
console.log("[OK] rankPlays.ts");
