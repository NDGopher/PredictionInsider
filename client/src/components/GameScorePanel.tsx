import { useState, useEffect } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Activity } from "lucide-react";

interface GameScore {
  homeTeam: string; awayTeam: string;
  homeAbbr: string; awayAbbr: string;
  homeScore: number; awayScore: number;
  status: string; detail: string;
  period: number; clock: string; completed: boolean;
}

interface PricePoint { t: number; p: number; }

interface Props {
  slug?: string;
  conditionId?: string;
  yesTokenId?: string;
  noTokenId?: string;
  side?: "YES" | "NO";
  marketQuestion?: string;
}

function formatChartTime(ts: number, allTimes?: number[]): string {
  const d = new Date(ts);
  if (!allTimes || allTimes.length < 2) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  const spanMs = allTimes[allTimes.length - 1] - allTimes[0];
  if (spanMs > 20 * 3600_000) {
    // Multi-day: show "Mar 10 14:30"
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  if (val == null) return null;
  const pct = (val * 100).toFixed(1);
  const odds = val >= 0.5
    ? `-${Math.round((val / (1 - val)) * 100)}`
    : `+${Math.round(((1 - val) / val) * 100)}`;
  const ts = typeof label === "number" ? new Date(label) : null;
  const dateStr = ts ? ts.toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }) : null;
  return (
    <div className="bg-background border border-border rounded px-2 py-1 text-xs shadow">
      {dateStr && <div className="text-muted-foreground mb-0.5">{dateStr}</div>}
      <span className="font-semibold">{pct}¢</span>
      <span className="text-muted-foreground ml-1.5">{odds}</span>
    </div>
  );
}

export default function GameScorePanel({ slug, conditionId, yesTokenId, noTokenId, side, marketQuestion }: Props) {
  const [score, setScore] = useState<GameScore | null>(null);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setScore(null);
    setHistory([]);

    const promises: Promise<void>[] = [];

    if (slug) {
      promises.push(
        fetch(`/api/game-score?slug=${encodeURIComponent(slug)}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (!cancelled && d) setScore(d); })
          .catch(() => {})
      );
    }

    // Build price chart from trade prices (works for all market types incl. AMM sports)
    // Pass both conditionId and yesTokenId so the backend can match on either field
    const historyParams = new URLSearchParams();
    if (conditionId) historyParams.set("conditionId", conditionId);
    if (yesTokenId) historyParams.set("tokenId", yesTokenId);
    const historyParam = historyParams.toString() || null;

    if (historyParam) {
      promises.push(
        fetch(`/api/price-history?${historyParam}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (!cancelled && d?.history?.length) {
              setHistory(d.history);
            }
          })
          .catch(() => {})
      );
    }

    Promise.all(promises).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, conditionId, yesTokenId]);

  const hasScore = !!score;
  const hasChart = history.length > 2;

  if (!hasScore && !hasChart && !loading) return null;
  if (!hasScore && !hasChart && loading) return (
    <div className="h-8 flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
      <Activity className="w-3 h-3" /> Loading game data…
    </div>
  );

  const isLive = score && !score.completed && score.status?.includes("IN_PROGRESS");
  const lastP = history.length > 0 ? history[history.length - 1].p : null;
  const allTimes = history.map(h => h.t);
  const tickFmt = (ts: number) => formatChartTime(ts, allTimes);

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 overflow-hidden" data-testid="game-score-panel">
      {/* Score header */}
      {hasScore && score && (
        <div className="px-3 py-2.5 flex items-center justify-between gap-2 bg-muted/30 border-b border-border/40">
          {/* Away team */}
          <div className="flex-1 text-center">
            <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">{score.awayAbbr}</div>
            <div className="text-xl font-bold tabular-nums leading-none mt-0.5">{score.awayScore}</div>
          </div>

          {/* Status */}
          <div className="text-center flex-shrink-0 min-w-[80px]">
            {isLive ? (
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] font-bold text-red-500 uppercase">Live</span>
              </div>
            ) : score.completed ? (
              <div className="text-[10px] text-muted-foreground uppercase font-semibold mb-0.5">Final</div>
            ) : (
              <div className="text-[10px] text-muted-foreground uppercase font-semibold mb-0.5">Pre-Game</div>
            )}
            <div className="text-[11px] text-foreground font-medium leading-tight">{score.detail}</div>
          </div>

          {/* Home team */}
          <div className="flex-1 text-center">
            <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">{score.homeAbbr}</div>
            <div className="text-xl font-bold tabular-nums leading-none mt-0.5">{score.homeScore}</div>
          </div>
        </div>
      )}

      {/* Price chart */}
      {hasChart && (
        <div className="px-1 pt-2 pb-1">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[10px] text-muted-foreground">
              YES price (trade history)
              {marketQuestion && ` — ${marketQuestion.length > 36 ? marketQuestion.slice(0, 36) + "…" : marketQuestion}`}
            </span>
            {lastP !== null && (
              <span className="text-[10px] font-semibold tabular-nums">
                {(lastP * 100).toFixed(1)}¢
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={90}>
            <AreaChart data={history} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                tickFormatter={tickFmt}
                tick={{ fontSize: 9 }}
                interval="preserveStartEnd"
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[0, 1]}
                tickFormatter={(v: number) => `${Math.round(v * 100)}`}
                tick={{ fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                width={24}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="p"
                stroke="#3b82f6"
                strokeWidth={1.5}
                fill="url(#priceGrad)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
