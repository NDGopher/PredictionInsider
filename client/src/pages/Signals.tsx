import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Zap, Search, ExternalLink, TrendingUp, TrendingDown, AlertCircle,
  RefreshCw, Users, Target, ChevronDown, ChevronUp, Star, Activity,
  Bell, BellOff, Clock, DollarSign, ShieldCheck, AlertTriangle, Radio,
  Hourglass, CalendarClock, BarChart2
} from "lucide-react";
import type { SignalsResponse, Signal } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

// ─── Auto-refresh intervals ────────────────────────────────────────────────────
const ELITE_REFRESH_SEC = 120;       // 2 minutes (was 5 min)
const FAST_REFRESH_SEC  = 45;        // 45 seconds (was 90s)

// ─── Alert history (localStorage) ─────────────────────────────────────────────
const ALERT_KEY = "pi_alert_ids";
function getSeenAlerts(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(ALERT_KEY) || "[]")); } catch { return new Set(); }
}
function saveSeenAlert(id: string) {
  try {
    const s = getSeenAlerts(); s.add(id);
    localStorage.setItem(ALERT_KEY, JSON.stringify(Array.from(s).slice(-500)));
  } catch {}
}

// ─── Browser notification helper ──────────────────────────────────────────────
async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const perm = await Notification.requestPermission();
  return perm === "granted";
}

function sendNotification(title: string, body: string) {
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch {}
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function ConfidenceBar({ score }: { score: number }) {
  const color = score >= 75 ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-bold tabular-nums w-7 text-right">{score}</span>
    </div>
  );
}

function QualityPip({ score }: { score: number }) {
  if (!score && score !== 0) return null;
  const color = score >= 70 ? "text-green-600 dark:text-green-400" : score >= 40 ? "text-yellow-600" : "text-red-500";
  return (
    <span className={`text-[10px] font-semibold ${color} flex items-center gap-0.5`} title="Trader quality score">
      <ShieldCheck className="w-2.5 h-2.5" />{score}
    </span>
  );
}

function formatUsdc(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1000)      return `$${(val / 1000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function MarketTypePill({ type }: { type?: string }) {
  if (!type) return null;
  if (type === "live")    return <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20"><Radio className="w-2.5 h-2.5" />LIVE</span>;
  if (type === "pregame") return <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20"><Hourglass className="w-2.5 h-2.5" />PREGAME</span>;
  return <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border"><CalendarClock className="w-2.5 h-2.5" />FUTURES</span>;
}

function ScoreBreakdown({ breakdown, confidence }: { breakdown: Record<string, number>; confidence: number }) {
  const items = [
    { label: "ROI (40%)",      val: breakdown.roiPct ?? 0,       color: "bg-blue-500" },
    { label: "Consensus (30%)",val: breakdown.consensusPct ?? 0,  color: "bg-green-500" },
    { label: "Value (20%)",    val: breakdown.valuePct ?? 0,      color: "bg-yellow-500" },
    { label: "Size (10%)",     val: breakdown.sizePct ?? 0,       color: "bg-purple-500" },
    { label: "Tier Bonus",     val: breakdown.tierBonus ?? 0,     color: "bg-orange-500" },
  ].filter(i => i.val > 0);

  return (
    <div className="mt-3 pt-3 border-t border-border/40">
      <div className="flex items-center gap-1.5 mb-2">
        <BarChart2 className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Score Breakdown</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {items.map(item => (
          <div key={item.label} className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">{item.label}</span>
            <span className="font-semibold">{item.val}pts</span>
          </div>
        ))}
        <div className="flex items-center justify-between text-[10px] col-span-2 border-t border-border/30 pt-1 mt-0.5">
          <span className="font-semibold">Total Score</span>
          <span className="font-bold text-primary">{confidence}/100</span>
        </div>
      </div>
    </div>
  );
}

function getOutcomeLabel(title: string, side: "YES" | "NO"): string {
  const t = title.trim();
  const ouMatch = t.match(/o\/?u\s+([\d.]+)/i) || t.match(/total[:\s]+([\d.]+)/i);
  if (ouMatch) return side === "YES" ? `Over ${ouMatch[1]}` : `Under ${ouMatch[1]}`;
  const spreadMatch = t.match(/spread[:\s]+([A-Za-z].+?)\s*\(([+-]?\d+\.?\d*)\)/i);
  if (spreadMatch) return side === "YES" ? `${spreadMatch[1].trim()} ${spreadMatch[2]} covers` : `${spreadMatch[1].trim()} doesn't cover`;
  const willMatch = t.match(/will\s+(?:the\s+)?(.+?)\s+win/i);
  if (willMatch) return side === "YES" ? `${willMatch[1].trim()} WIN` : `${willMatch[1].trim()} won't win`;
  if (!t.includes(":")) {
    const vsMatch = t.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
    if (vsMatch) return side === "YES" ? `${vsMatch[1].trim()} WIN` : `${vsMatch[2].trim()} WIN`;
  }
  const colonAfterVs = t.match(/^(.+?)\s+vs\.?\s+([^:]+):\s*(.+)$/i);
  if (colonAfterVs) {
    const sub = colonAfterVs[3].trim();
    const subOu = sub.match(/o\/?u\s*([\d.]+)/i);
    if (subOu) return side === "YES" ? `Over ${subOu[1]}` : `Under ${subOu[1]}`;
    return `${sub} — ${side}`;
  }
  const tourneyVs = t.match(/^.+?:\s*(.+?)\s+vs\.?\s+(.+)$/i);
  if (tourneyVs) return side === "YES" ? `${tourneyVs[1].trim()} WIN` : `${tourneyVs[2].trim()} WIN`;
  return side;
}

function SignalCard({ signal, mode }: { signal: Signal; mode: "elite" | "fast" }) {
  const [expanded, setExpanded] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const borderCls = signal.side === "YES"
    ? "border-green-500/30 bg-green-500/5"
    : "border-red-500/30 bg-red-500/5";

  const confidenceLabel =
    signal.confidence >= 75 ? { label: "HIGH", cls: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20" } :
    signal.confidence >= 50 ? { label: "MED",  cls: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20" } :
    { label: "LOW", cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20" };

  const polyUrl = signal.slug
    ? `https://polymarket.com/market/${signal.slug}`
    : signal.marketId ? `https://polymarket.com/event/${signal.marketId}` : null;

  const outcomeLabel = (signal as any).outcomeLabel || getOutcomeLabel(signal.marketQuestion, signal.side as "YES" | "NO");

  const totalNetUsdc = (signal as any).totalNetUsdc as number | undefined;
  const avgNetUsdc   = (signal as any).avgNetUsdc   as number | undefined;

  return (
    <Card className={`border ${borderCls}`} data-testid={`signal-card-${signal.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Side indicator strip */}
          <div className={`mt-0.5 shrink-0 w-1 self-stretch rounded-full
            ${signal.side === "YES" ? "bg-green-500" : "bg-red-500"}`} />

          <div className="flex-1 min-w-0">
            {/* Title row */}
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                {polyUrl ? (
                  <a
                    href={polyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold leading-snug hover:text-primary hover:underline transition-colors cursor-pointer block"
                    data-testid={`signal-question-${signal.id}`}
                  >
                    {signal.marketQuestion}
                  </a>
                ) : (
                  <div className="text-sm font-semibold leading-snug" data-testid={`signal-question-${signal.id}`}>
                    {signal.marketQuestion}
                  </div>
                )}
                {/* Outcome label — the specific bet this signal represents */}
                <div className={`mt-0.5 text-xs font-bold ${signal.side === "YES" ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}
                  data-testid={`signal-outcome-${signal.id}`}>
                  {outcomeLabel} <span className="font-normal text-muted-foreground">@ {(signal.currentPrice * 100).toFixed(1)}¢</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${confidenceLabel.cls}`}>
                    {confidenceLabel.label} CONFIDENCE
                  </span>
                  {/* Tier badge */}
                  {(signal as any).tier === "HIGH" && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/20 flex items-center gap-0.5">
                      <Users className="w-2.5 h-2.5" />{signal.traderCount} TRADERS
                    </span>
                  )}
                  {(signal as any).tier === "MED" && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-0.5">
                      <Users className="w-2.5 h-2.5" />{signal.traderCount} TRADERS
                    </span>
                  )}
                  {(signal as any).tier === "SINGLE" && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                      WHALE SIGNAL
                    </span>
                  )}
                  {/* Market type */}
                  <MarketTypePill type={(signal as any).marketType} />
                  {/* Actionability indicator */}
                  {(signal as any).isActionable === true && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 flex items-center gap-0.5" title="Current price is still close to average entry — actionable now">
                      <Target className="w-2.5 h-2.5" /> ACTIONABLE
                    </span>
                  )}
                  {(signal as any).isActionable === false && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border" title="Price has moved significantly from avg entry — may have already priced in">
                      PRICE MOVED
                    </span>
                  )}
                  {/* Big play indicator */}
                  {((signal as any).bigPlayScore ?? 0) >= 2 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/20 flex items-center gap-0.5" title="Large capital deployed — significant bet">
                      <DollarSign className="w-2.5 h-2.5" /> BIG PLAY
                    </span>
                  )}
                  {signal.isValue && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                      VALUE EDGE
                    </span>
                  )}
                  {(signal as any).isNew && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/20 flex items-center gap-0.5">
                      <AlertTriangle className="w-2.5 h-2.5" /> NEW
                    </span>
                  )}
                  {mode === "elite" && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20 flex items-center gap-0.5">
                      <Star className="w-2.5 h-2.5" /> ELITE
                    </span>
                  )}
                  {(signal as any).sportsLbCount > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-500/15 text-green-700 dark:text-green-300 border border-green-500/20 flex items-center gap-0.5" title="At least one verified sports leaderboard trader">
                      <ShieldCheck className="w-2.5 h-2.5" /> SPORTS LB
                    </span>
                  )}
                  {(signal as any).source === "positions" && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-0.5" title="Signal derived from current open positions of verified sports traders">
                      <BarChart2 className="w-2.5 h-2.5" /> POSITIONS
                    </span>
                  )}
                </div>
              </div>
              {/* Net USDC aggregate */}
              {totalNetUsdc && totalNetUsdc > 0 && (
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-foreground">{formatUsdc(totalNetUsdc)}</div>
                  <div className="text-[10px] text-muted-foreground">elite net pos.</div>
                </div>
              )}
            </div>

            {/* Confidence bar */}
            <div className="mt-3">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                <span>Confidence Score</span>
                <span>{signal.confidence}/100</span>
              </div>
              <ConfidenceBar score={signal.confidence} />
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              <div className="bg-muted/50 rounded-md p-2">
                <div className="text-[10px] text-muted-foreground">Live Price</div>
                <div className="text-sm font-semibold">{(signal.currentPrice * 100).toFixed(1)}¢</div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="text-[10px] text-muted-foreground">Avg Entry</div>
                <div className="text-sm font-semibold">{(signal.avgEntryPrice * 100).toFixed(1)}¢</div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="text-[10px] text-muted-foreground">Consensus</div>
                <div className="text-sm font-semibold">{signal.consensusPct}%</div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="text-[10px] text-muted-foreground">
                  {mode === "elite" ? "Avg Net Size" : "Traders"}
                </div>
                <div className="text-sm font-semibold">
                  {mode === "elite" && avgNetUsdc
                    ? formatUsdc(avgNetUsdc)
                    : signal.traderCount}
                </div>
              </div>
            </div>

            {/* Value delta line */}
            {signal.valueDelta !== 0 && (
              <div className={`flex items-center gap-1.5 mt-2 text-xs
                ${signal.valueDelta > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                {signal.valueDelta > 0
                  ? <TrendingUp className="w-3.5 h-3.5" />
                  : <TrendingDown className="w-3.5 h-3.5" />}
                {signal.valueDelta > 0
                  ? `${(signal.valueDelta * 100).toFixed(1)}¢ value edge over live price (incl. 2¢ slippage)`
                  : `Elite avg entry was ${Math.abs(signal.valueDelta * 100).toFixed(1)}¢ below live price`}
              </div>
            )}

            {/* Footer row */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  data-testid={`button-expand-${signal.id}`}
                >
                  {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {expanded ? "Hide" : "Show"} traders ({signal.traderCount})
                </button>
                {(signal as any).scoreBreakdown && (
                  <button
                    onClick={() => setShowBreakdown(!showBreakdown)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    data-testid={`button-breakdown-${signal.id}`}
                  >
                    <BarChart2 className="w-3 h-3" />
                    {showBreakdown ? "Hide" : "Show"} score
                  </button>
                )}
              </div>
              {polyUrl && (
                <a
                  href={polyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-primary"
                  data-testid={`link-polymarket-${signal.id}`}
                >
                  View on Polymarket <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {/* Score breakdown */}
            {showBreakdown && (signal as any).scoreBreakdown && (
              <ScoreBreakdown breakdown={(signal as any).scoreBreakdown} confidence={signal.confidence} />
            )}

            {/* Expanded trader list */}
            {expanded && signal.traders.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <div className="grid grid-cols-4 text-[10px] text-muted-foreground font-medium px-2.5 py-1">
                  <span>Trader</span>
                  <span className="text-right">Entry</span>
                  <span className="text-right">Net Pos.</span>
                  <span className="text-right">ROI / Quality</span>
                </div>
                {signal.traders.map((t, i) => (
                  <div key={i} className="grid grid-cols-4 items-center bg-muted/40 rounded px-2.5 py-1.5 text-xs gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Users className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="font-mono truncate">
                        {t.name || (t.address ? `${t.address.slice(0, 6)}...${t.address.slice(-4)}` : "Trader")}
                      </span>
                      {(t as any).isSportsLb && (
                        <span className="text-[9px] font-bold bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 px-1 rounded shrink-0" title="Top sports leaderboard trader">SPORTS</span>
                      )}
                      {(t as any).isLeaderboard && !(t as any).isSportsLb && (
                        <span className="text-[9px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1 rounded shrink-0" title="Top PNL leaderboard trader">LB</span>
                      )}
                    </div>
                    <div className="text-right text-muted-foreground tabular-nums">
                      {(t.entryPrice * 100).toFixed(1)}¢
                    </div>
                    <div className="text-right font-medium tabular-nums">
                      {(t as any).netUsdc ? formatUsdc((t as any).netUsdc) : `${t.size.toLocaleString()} shr`}
                    </div>
                    <div className="text-right flex items-center justify-end gap-1.5">
                      {t.roi > 0 && (
                        <span className={`${t.roi >= 20 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                          {t.roi >= 0 ? "+" : ""}{t.roi.toFixed(1)}%
                        </span>
                      )}
                      {(t as any).qualityScore ? <QualityPip score={(t as any).qualityScore} /> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Countdown timer component ─────────────────────────────────────────────────
function RefreshCountdown({ secondsLeft }: { secondsLeft: number }) {
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
      <Clock className="w-3 h-3" />
      {m > 0 ? `${m}m ${s}s` : `${s}s`}
    </span>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function Signals() {
  const [search, setSearch]       = useState("");
  const [filter, setFilter]       = useState("all");
  const [sort, setSort]           = useState("confidence");
  const [mode, setMode]           = useState<"elite" | "fast">("elite");
  const [sportsOnly, setSportsOnly] = useState(true);
  const [notifEnabled, setNotifEnabled] = useState(Notification?.permission === "granted");
  const [countdown, setCountdown] = useState(mode === "elite" ? ELITE_REFRESH_SEC : FAST_REFRESH_SEC);
  const [alertHistory, setAlertHistory] = useState<Array<{ id: string; question: string; confidence: number; ts: number }>>([]);
  const [showAlerts, setShowAlerts] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const countdownRef = useRef<ReturnType<typeof setInterval>>();

  const refreshInterval = mode === "elite" ? ELITE_REFRESH_SEC : FAST_REFRESH_SEC;
  const eliteUrl  = sportsOnly ? "/api/signals?sports=true" : "/api/signals?sports=false";
  const queryKey  = mode === "elite" ? [eliteUrl] : ["/api/signals/fast"];

  // ── Query ────────────────────────────────────────────────────────────────────
  const { data, isLoading, error } = useQuery<SignalsResponse>({
    queryKey,
    staleTime: (refreshInterval - 5) * 1000,
  });

  // ── Process new signals for alerts ───────────────────────────────────────────
  const processAlerts = useCallback((signals: Signal[]) => {
    const seen = getSeenAlerts();
    const newAlerts: typeof alertHistory = [];

    for (const sig of signals) {
      if (sig.confidence >= 70 && !seen.has(sig.id)) {
        saveSeenAlert(sig.id);
        newAlerts.push({ id: sig.id, question: sig.marketQuestion, confidence: sig.confidence, ts: Date.now() });
        if (notifEnabled) {
          sendNotification(
            `PredictionInsider — ${sig.side} Signal (${sig.confidence}/100)`,
            sig.marketQuestion
          );
        }
      }
    }

    if (newAlerts.length > 0) {
      setAlertHistory(prev => [...newAlerts, ...prev].slice(0, 20));
      toast({
        title: `${newAlerts.length} new high-confidence signal${newAlerts.length > 1 ? "s" : ""}`,
        description: newAlerts[0].question,
      });
    }
  }, [notifEnabled, toast]);

  useEffect(() => {
    if (data?.signals) processAlerts(data.signals);
  }, [data, processAlerts]);

  // ── Auto-refresh countdown ────────────────────────────────────────────────────
  const resetCountdown = useCallback(() => {
    setCountdown(refreshInterval);
    clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          queryClient.invalidateQueries({ queryKey });
          return refreshInterval;
        }
        return prev - 1;
      });
    }, 1000);
  }, [refreshInterval, queryClient, queryKey]);

  useEffect(() => {
    resetCountdown();
    return () => clearInterval(countdownRef.current);
  }, [mode, resetCountdown]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey });
    resetCountdown();
  };

  const handleEnableNotifications = async () => {
    const ok = await requestNotificationPermission();
    setNotifEnabled(ok);
    toast({
      title: ok ? "Notifications enabled" : "Notifications blocked",
      description: ok
        ? "You'll be alerted for signals with confidence ≥ 70."
        : "Please allow notifications in your browser settings.",
    });
  };

  const signals = data?.signals || [];
  const filtered = signals
    .filter(s => {
      if (search && !s.marketQuestion.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === "value")   return s.isValue;
      if (filter === "high")    return s.confidence >= 70;
      if (filter === "multi")   return s.traderCount >= 2;
      if (filter === "single")  return (s as any).tier === "SINGLE";
      if (filter === "live")    return (s as any).marketType === "live";
      if (filter === "pregame") return (s as any).marketType === "pregame";
      if (filter === "futures") return (s as any).marketType === "futures";
      if (filter === "yes")     return s.side === "YES";
      if (filter === "no")      return s.side === "NO";
      return true;
    })
    .sort((a, b) => {
      if (sort === "confidence")  return b.confidence - a.confidence;
      if (sort === "consensus")   return b.consensusPct - a.consensusPct;
      if (sort === "value")       return b.valueDelta - a.valueDelta;
      if (sort === "traders")     return b.traderCount - a.traderCount;
      if (sort === "size") {
        const aSize = (a as any).totalNetUsdc || 0;
        const bSize = (b as any).totalNetUsdc || 0;
        return bSize - aSize;
      }
      return 0;
    });

  const newCount  = signals.filter(s => (s as any).isNew).length;
  const highCount = signals.filter(s => s.confidence >= 70).length;
  const valueCount = signals.filter(s => s.isValue).length;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold tracking-tight">Live Signals</h1>
            {!isLoading && <Badge variant="secondary" className="ml-1">{filtered.length}</Badge>}
            {newCount > 0 && (
              <Badge className="bg-orange-500 text-white text-[10px] px-1.5 h-4">
                {newCount} new
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {mode === "elite"
              ? "Aggregate open positions from official top-50 leaderboard — direct from on-chain subgraph"
              : "Real-time consensus from recent Polymarket sports trades — refreshes every 90s"}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Notifications */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleEnableNotifications}
            data-testid="button-notifications"
            className="gap-1.5"
            title={notifEnabled ? "Notifications active" : "Enable notifications"}
          >
            {notifEnabled ? <Bell className="w-3.5 h-3.5 text-green-500" /> : <BellOff className="w-3.5 h-3.5" />}
            <span className="text-xs">{notifEnabled ? "Alerts on" : "Alerts off"}</span>
          </Button>

          {/* Alert history */}
          {alertHistory.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAlerts(!showAlerts)}
              data-testid="button-alert-history"
              className="gap-1.5 relative"
            >
              <Bell className="w-3.5 h-3.5" />
              <span className="text-xs">History ({alertHistory.length})</span>
            </Button>
          )}

          <RefreshCountdown secondsLeft={countdown} />

          <Button
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            data-testid="button-refresh-signals"
            className="gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Alert history panel */}
      {showAlerts && alertHistory.length > 0 && (
        <Card className="border-orange-500/20 bg-orange-500/5">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Bell className="w-3.5 h-3.5 text-orange-500" />
              <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">Recent Alerts</span>
            </div>
            <div className="space-y-1.5">
              {alertHistory.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-xs bg-background/50 rounded px-2.5 py-1.5">
                  <span className="truncate flex-1 mr-2">{a.question}</span>
                  <span className="shrink-0 font-bold text-green-600 dark:text-green-400">{a.confidence}/100</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mode toggle + category filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 p-1 bg-muted rounded-lg">
          <button
            onClick={() => setMode("elite")}
            data-testid="button-mode-elite"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              mode === "elite" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Star className="w-3.5 h-3.5" />
            Elite Signals
          </button>
          <button
            onClick={() => setMode("fast")}
            data-testid="button-mode-fast"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              mode === "fast" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Live Feed
          </button>
        </div>

        {/* Sports-only toggle (Elite mode only) */}
        {mode === "elite" && (
          <div className="flex items-center gap-1.5 p-1 bg-muted rounded-lg">
            <button
              onClick={() => setSportsOnly(true)}
              data-testid="button-sports-only"
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                sportsOnly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sports Only
            </button>
            <button
              onClick={() => setSportsOnly(false)}
              data-testid="button-all-categories"
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                !sportsOnly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Categories
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search markets..."
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-signals"
          />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-40 h-8 text-sm" data-testid="select-filter">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Signals</SelectItem>
            <SelectItem value="value">Value Edge Only</SelectItem>
            <SelectItem value="high">High Confidence (70+)</SelectItem>
            <SelectItem value="multi">Multi-Trader (2+)</SelectItem>
            <SelectItem value="single">Whale Signals</SelectItem>
            <SelectItem value="live">Live Markets</SelectItem>
            <SelectItem value="pregame">Pregame</SelectItem>
            <SelectItem value="futures">Futures</SelectItem>
            <SelectItem value="yes">YES Positions</SelectItem>
            <SelectItem value="no">NO Positions</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-sort">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="confidence">Confidence</SelectItem>
            <SelectItem value="consensus">Consensus %</SelectItem>
            <SelectItem value="value">Value Edge</SelectItem>
            <SelectItem value="traders">Trader Count</SelectItem>
            <SelectItem value="size">Net Position $</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary bar */}
      {!isLoading && signals.length > 0 && (
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <span className="text-muted-foreground">{data?.topTraderCount} elite traders</span>
          <span className="text-muted-foreground">{data?.marketsScanned} sports markets scanned</span>
          {valueCount > 0 && (
            <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
              <DollarSign className="w-3 h-3" /> {valueCount} value edges
            </span>
          )}
          {highCount > 0 && (
            <span className="text-primary font-medium">{highCount} high-confidence</span>
          )}
          {data?.source && (
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border">
              {data.source.includes("elite") ? "On-chain subgraph" : "Live trades"} · {mode === "elite" ? "5m refresh" : "90s refresh"}
            </span>
          )}
        </div>
      )}

      {/* Signal cards */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-5 w-3/4 mb-3" />
                <Skeleton className="h-3 w-full mb-1.5" />
                <Skeleton className="h-3 w-4/5 mb-4" />
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: 4 }).map((_, j) => <Skeleton key={j} className="h-12" />)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <AlertCircle className="w-10 h-10 text-muted-foreground" />
            <div>
              <div className="font-medium">Failed to load signals</div>
              <div className="text-sm text-muted-foreground mt-1 max-w-sm">
                Polymarket APIs may be temporarily unavailable or rate-limited.
              </div>
            </div>
            <Button onClick={handleRefresh} variant="outline" className="gap-2">
              <RefreshCw className="w-4 h-4" /> Try Again
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Target className="w-10 h-10 text-muted-foreground" />
            <div>
              <div className="font-medium">
                {signals.length === 0 ? "No signals generated" : "No signals match your filters"}
              </div>
              <div className="text-sm text-muted-foreground mt-1 max-w-sm">
                {signals.length === 0
                  ? mode === "elite" && sportsOnly
                    ? "Top PNL traders mostly hold positions in politics/crypto markets. Try 'All Categories' to see their full signal set, or use Live Feed for real-time sports signals."
                    : mode === "elite"
                    ? "No open on-chain positions found for the elite trader pool. Try Live Feed for real-time signals."
                    : "Live feed signals appear when active traders share a sports market position in the last 2,000 trades."
                  : "Try adjusting your filters."}
              </div>
            </div>
            {signals.length === 0 && mode === "elite" && sportsOnly && (
              <div className="flex gap-2 flex-wrap justify-center">
                <Button variant="outline" size="sm" onClick={() => setSportsOnly(false)} className="gap-2">
                  <Target className="w-3.5 h-3.5" /> All Categories
                </Button>
                <Button variant="outline" size="sm" onClick={() => setMode("fast")} className="gap-2">
                  <Activity className="w-3.5 h-3.5" /> Live Feed
                </Button>
              </div>
            )}
            {signals.length === 0 && mode === "elite" && !sportsOnly && (
              <Button variant="outline" size="sm" onClick={() => setMode("fast")} className="gap-2">
                <Activity className="w-3.5 h-3.5" /> Switch to Live Feed
              </Button>
            )}
            {search && (
              <Button variant="outline" size="sm" onClick={() => setSearch("")}>Clear search</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(signal => (
            <SignalCard key={signal.id} signal={signal} mode={mode} />
          ))}
        </div>
      )}
    </div>
  );
}
