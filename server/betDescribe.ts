/**
 * Human-readable pick for a Polymarket sports token.
 * "YES" on "Yankees vs Orioles" is not a bet — "Yankees WIN (Moneyline)" is.
 */
import type { Signal } from "@shared/schema";

const OTHER_SPORTS = /politic|crypto|finance|culture|weather/i;

export type PlayLane = "sports" | "other" | "futures";

export function inferSubmarket(signal: {
  marketQuestion?: string;
  slug?: string;
  marketType?: string;
  marketCategory?: string;
  sport?: string;
  category?: string;
  outcomeLabel?: string;
  outcome?: string;
}): string {
  const h = [
    signal.marketQuestion,
    signal.slug,
    signal.marketType,
    signal.marketCategory,
    signal.sport,
    signal.category,
    signal.outcomeLabel,
    signal.outcome,
  ]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" ")
    .toLowerCase();
  if (h.includes("draw")) return "Draw";
  if (h.includes("spread") || h.includes("(+") || h.includes("(-")) return "Spread";
  if (h.includes("o/u") || h.includes(" over ") || h.includes(" under ") || /\btotal\b/.test(h)) return "Total";
  if (h.includes("mvp") || h.includes("ballon") || h.includes("champion") || h.includes("nomination") || h.includes("win the 20")) {
    return "Futures";
  }
  return "Moneyline";
}

export function resolvePick(signal: {
  marketQuestion?: string;
  side?: string;
  outcome?: string;
  outcomeLabel?: string;
}): string {
  const labeled = (signal.outcomeLabel || "").trim();
  if (labeled && !/^(yes|no)$/i.test(labeled)) return labeled;
  const outcome = (signal.outcome || "").trim();
  if (outcome && !/^(yes|no)$/i.test(outcome)) return outcome;

  const side = (signal.side || "YES").toUpperCase() === "NO" ? "NO" : "YES";
  const t = (signal.marketQuestion || "").trim();
  const ouMatch = t.match(/o\/?u\s+([\d.]+)/i) || t.match(/total[:\s]+([\d.]+)/i);
  if (ouMatch) return side === "YES" ? `Over ${ouMatch[1]}` : `Under ${ouMatch[1]}`;

  const spreadMatch = t.match(/spread[:\s]+([A-Za-z].+?)\s*\(([+-]?\d+\.?\d*)\)/i);
  if (spreadMatch) {
    const team = spreadMatch[1].trim();
    const spd = spreadMatch[2];
    return side === "YES" ? `${team} ${spd}` : `${team} ${spd} does not cover`;
  }
  if (/end(s)?\s+in\s+a\s+draw|:\s*draw\s*$/i.test(t)) {
    return side === "YES" ? "Draw" : "No draw";
  }
  const willMatch = t.match(/^will\s+(?:the\s+)?(.+?)\s+win/i);
  if (willMatch && !/\s+vs\.?\s+/i.test(willMatch[1])) {
    const who = willMatch[1].trim();
    return side === "YES" ? `${who}` : `Not ${who}`;
  }
  if (!t.includes(":")) {
    const clean = t.replace(/^will\s+/i, "");
    const vsMatch = clean.match(/^(.+?)\s+vs\.?\s+([^?]+)/i);
    if (vsMatch) {
      const t1 = vsMatch[1].trim().replace(/\s+(win|beat|cover).*$/i, "");
      const t2 = vsMatch[2].trim().replace(/\s+(win|beat|cover).*$/i, "").replace(/\?$/, "").trim();
      return side === "YES" ? t1 : t2;
    }
  }
  return side === "YES" ? "Yes" : "No";
}

export function playLane(sport: string | undefined, submarket: string): PlayLane {
  const s = sport || "";
  if (submarket === "Futures") return "futures";
  if (OTHER_SPORTS.test(s) || s.toUpperCase() === "POLITICS") return "other";
  return "sports";
}

export function formatBetHeadline(pick: string, submarket: string, sport: string | undefined): string {
  const sm = submarket || "Moneyline";
  const sp = sport || "";
  if (sm === "Moneyline") return `${pick}  moneyline${sp ? ` · ${sp}` : ""}`;
  if (sm === "Spread") return `${pick}  spread${sp ? ` · ${sp}` : ""}`;
  if (sm === "Total") return `${pick}  total${sp ? ` · ${sp}` : ""}`;
  if (sm === "Draw") return `${pick}${sp ? ` · ${sp}` : ""}`;
  if (sm === "Futures") return `${pick}  futures${sp ? ` · ${sp}` : ""}`;
  return `${pick}  ${sm}${sp ? ` · ${sp}` : ""}`;
}
