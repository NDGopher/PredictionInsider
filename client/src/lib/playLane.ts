/** Mirror server/betDescribe.ts playLane + timing for UI filters. */

export type PlayLane = "sports" | "other" | "futures";

export type MarketTiming = "live" | "upcoming" | "long" | "unknown";

const OTHER_SPORTS = /politic|crypto|finance|culture|weather/i;

export function playLane(sport?: string | null, submarket?: string | null): PlayLane {
  const sm = submarket || "";
  const s = sport || "";
  if (sm === "Futures" || /^future/i.test(sm)) return "futures";
  if (OTHER_SPORTS.test(s) || s.toUpperCase() === "POLITICS" || s.toUpperCase() === "OTHER") return "other";
  return "sports";
}

/** Long-dated season / election / macro titles → futures bucket even when submarket is Moneyline. */
export function titleLooksLongDated(title?: string | null): boolean {
  const t = (title || "").toLowerCase();
  if (!t) return false;
  return (
    /\bworlds?\s+20\d{2}\b/.test(t)
    || /\b(champion|mvp|ballon|nomination|win the 20\d{2})\b/.test(t)
    || /\bbefore 20\d{2}\b/.test(t)
    || /\b(in|by)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2}\b/.test(t)
    || /\b(control the (senate|house)|midterm|presidential election)\b/.test(t)
    || /\binvite to join nato\b/.test(t)
  );
}

export function effectiveLane(opts: {
  sport?: string | null;
  submarket?: string | null;
  title?: string | null;
  timing?: MarketTiming | null;
}): PlayLane {
  const base = playLane(opts.sport, opts.submarket);
  if (base === "other") return "other";
  if (base === "futures") return "futures";
  if (opts.timing === "long" || titleLooksLongDated(opts.title)) return "futures";
  return "sports";
}

export function laneLabel(lane: PlayLane): string {
  if (lane === "sports") return "Sports (live / upcoming)";
  if (lane === "other") return "Politics & other";
  return "Futures / long-dated";
}

export function timingLabel(timing?: MarketTiming | null): string | null {
  if (timing === "live") return "Live";
  if (timing === "upcoming") return "Upcoming";
  if (timing === "long") return "Long-dated";
  return null;
}
