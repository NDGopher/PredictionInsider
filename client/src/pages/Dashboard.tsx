import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Zap, Users, BarChart3, TrendingUp, TrendingDown, ArrowRight,
  Activity, Target, AlertCircle, RefreshCw, ExternalLink, X,
  Radio, Hourglass, CalendarClock, DollarSign, ShieldCheck,
  ChevronDown, ChevronUp, Bell, Clock, Flame
} from "lucide-react";
import type { SignalsResponse, LeaderboardResponse, MarketsResponse, Signal } from "@shared/schema";

const SIGNAL_REFRESH_MS = 90_000; // 90s auto-refresh

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

function ConfidenceBadge({ score }: { score: number }) {
  const color =
    score >= 75 ? "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20" :
    score >= 50 ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20" :
    "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border ${color}`}>
      {score}
    </span>
  );
}

function GameStatusBadge({ type }: { type?: string }) {
  if (type === "live") return (
    <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20 animate-pulse">
      <Radio className="w-2.5 h-2.5" />LIVE
    </span>
  );
  if (type === "pregame") return (
    <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20">
      <Hourglass className="w-2.5 h-2.5" />PREGAME
    </span>
  );
  return (
    <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
      <CalendarClock className="w-2.5 h-2.5" />FUTURES
    </span>
  );
}

function formatUsdc(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000)      return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function SignalExpandedPanel({ signal, onClose }: { signal: Signal; onClose: () => void }) {
  const s = signal as any;
  const outcomeLabel = s.outcomeLabel || getOutcomeLabel(signal.marketQuestion, signal.side as "YES" | "NO");
  const polyUrl = s.slug ? `https://polymarket.com/market/${s.slug}` : null;
  const priceDiff = ((signal.currentPrice - signal.avgEntryPrice) * 100).toFixed(1);
  const priceUp = signal.currentPrice > signal.avgEntryPrice;

  return (
    <div className="mt-2 rounded-lg border border-border bg-muted/30 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold leading-snug text-foreground mb-1">{signal.marketQuestion}</div>
          <div className={`text-sm font-bold ${signal.side === "YES" ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
            {outcomeLabel}
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Game status + actionability */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <GameStatusBadge type={s.marketType} />
        {s.isActionable === true && (
          <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
            <Target className="w-2.5 h-2.5" />ACTIONABLE
          </span>
        )}
        {s.isActionable === false && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
            PRICE MOVED
          </span>
        )}
        {(s.bigPlayScore ?? 0) >= 2 && (
          <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/20">
            <DollarSign className="w-2.5 h-2.5" />BIG PLAY
          </span>
        )}
        {s.sportsLbCount > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-500/15 text-green-700 dark:text-green-300 border border-green-500/20">
            <ShieldCheck className="w-2.5 h-2.5" />SPORTS LB
          </span>
        )}
      </div>

      {/* Price comparison */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-background rounded-md p-2 text-center border border-border/50">
          <div className="text-[10px] text-muted-foreground">Live Price</div>
          <div className="text-base font-bold text-foreground">{(signal.currentPrice * 100).toFixed(1)}¢</div>
        </div>
        <div className="bg-background rounded-md p-2 text-center border border-border/50">
          <div className="text-[10px] text-muted-foreground">Avg Entry</div>
          <div className="text-base font-bold">{(signal.avgEntryPrice * 100).toFixed(1)}¢</div>
        </div>
        <div className="bg-background rounded-md p-2 text-center border border-border/50">
          <div className="text-[10px] text-muted-foreground">Move</div>
          <div className={`text-base font-bold ${priceUp ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>
            {priceUp ? "+" : ""}{priceDiff}¢
          </div>
        </div>
      </div>

      {/* Value line */}
      {signal.valueDelta !== 0 && (
        <div className={`flex items-center gap-1.5 text-xs ${signal.valueDelta > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
          {signal.valueDelta > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          {signal.valueDelta > 0
            ? `${(signal.valueDelta * 100).toFixed(1)}¢ value edge vs current price`
            : `Price moved ${Math.abs(signal.valueDelta * 100).toFixed(1)}¢ past entry`}
        </div>
      )}

      {/* Traders */}
      {s.traders && s.traders.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Traders ({s.traders.length})
          </div>
          <div className="space-y-1">
            {s.traders.slice(0, 4).map((t: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate flex-1">{t.name}</span>
                <span className="font-semibold ml-2">{formatUsdc(t.size)} @ {(t.entryPrice * 100).toFixed(0)}¢</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confidence */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Confidence: <span className="font-bold text-foreground">{signal.confidence}/100</span></span>
        <span className="text-muted-foreground">{s.traderCount} trader{s.traderCount !== 1 ? "s" : ""} · {formatUsdc(s.totalNetUsdc || 0)} total</span>
      </div>

      {polyUrl && (
        <a
          href={polyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
          data-testid={`link-polymarket-${signal.id}`}
        >
          View on Polymarket <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

function SignalRow({ signal }: { signal: Signal }) {
  const [expanded, setExpanded] = useState(false);
  const outcomeLabel = (signal as any).outcomeLabel || getOutcomeLabel(signal.marketQuestion, signal.side as "YES" | "NO");
  const s = signal as any;

  const outcomeColor = signal.side === "YES"
    ? "text-green-600 dark:text-green-400"
    : "text-red-500 dark:text-red-400";

  return (
    <div data-testid={`signal-row-${signal.id}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(e => !e)}
        onKeyDown={e => e.key === "Enter" && setExpanded(prev => !prev)}
        className="flex items-center gap-3 py-2.5 px-3 rounded-md hover-elevate cursor-pointer border border-transparent hover:border-border"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{signal.marketQuestion}</span>
            {s.marketType === "live" && (
              <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1 py-0 rounded bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20 animate-pulse shrink-0">
                <Radio className="w-2.5 h-2.5" />LIVE
              </span>
            )}
            {s.isActionable === true && (
              <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1 py-0 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 shrink-0">
                <Target className="w-2.5 h-2.5" />ACT
              </span>
            )}
            {(s.bigPlayScore ?? 0) >= 2 && (
              <span className="text-[10px] font-semibold px-1 py-0 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 shrink-0">🔥</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className={`text-xs font-semibold ${outcomeColor}`}>
              {outcomeLabel}
            </span>
            <span className="text-xs text-muted-foreground">@ {(signal.currentPrice * 100).toFixed(1)}¢</span>
            <span className="text-xs text-muted-foreground">{signal.traderCount} traders</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ConfidenceBadge score={signal.confidence} />
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-2">
          <SignalExpandedPanel signal={signal} onClose={() => setExpanded(false)} />
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, sub, color
}: {
  icon: any; label: string; value: string; sub?: string; color: string
}) {
  return (
    <Card data-testid={`stat-card-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-muted-foreground mb-1">{label}</div>
            <div className="text-2xl font-bold tracking-tight">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
          </div>
          <div className={`p-2 rounded-md ${color}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [signalTypeFilter, setSignalTypeFilter] = useState<"all" | "live" | "pregame" | "nofutures">("all");
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());
  const toggleAlert = (id: string) => setExpandedAlerts(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const { data: signalsData, isLoading: signalsLoading, error: signalsError, refetch: refetchSignals } =
    useQuery<SignalsResponse>({
      queryKey: ["/api/signals"],
      staleTime: 80_000,
      refetchInterval: SIGNAL_REFRESH_MS,
    });

  const { data: tradersData, isLoading: tradersLoading } =
    useQuery<LeaderboardResponse>({ queryKey: ["/api/traders"], staleTime: 5 * 60 * 1000 });

  const { data: marketsData, isLoading: marketsLoading } =
    useQuery<MarketsResponse>({
      queryKey: ["/api/markets", "upcoming"],
      queryFn: () => fetch("/api/markets?type=upcoming&limit=50").then(r => r.json()),
      staleTime: 25_000,
      refetchInterval: 30_000,
    });

  // Live alerts via SSE — updates arrive automatically every 15s from the server
  const [alertsData, setAlertsData] = useState<{ alerts: any[]; fetchedAt: number } | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [lastAlertPush, setLastAlertPush] = useState<number>(0);
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/stream?channel=alerts");
    es.addEventListener("alerts", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setAlertsData(data);
        setLastAlertPush(Date.now());
        setAlertsLoading(false);
      } catch { /* ignore */ }
    });
    es.onerror = () => {
      // On SSE failure, fall back to one-shot fetch
      fetch("/api/alerts/live").then(r => r.json()).then(d => {
        setAlertsData(d);
        setAlertsLoading(false);
      }).catch(() => setAlertsLoading(false));
    };
    return () => es.close();
  }, []);

  const signals = signalsData?.signals || [];
  const highConfidence = signals.filter(s => s.confidence >= 70);
  const actionable = signals.filter(s => (s as any).isActionable === true);
  const traders = tradersData?.traders || [];

  const filteredSignals = signals.filter(s => {
    const mType = (s as any).marketType as string | undefined;
    const cat   = ((s as any).marketCategory || "").toLowerCase();
    if (signalTypeFilter === "live")     return mType === "live";
    if (signalTypeFilter === "pregame")  return mType === "pregame";
    if (signalTypeFilter === "nofutures") return cat !== "futures" && mType !== "futures";
    return true;
  });
  const topSignals = filteredSignals.slice(0, 8);

  const loading = signalsLoading || tradersLoading || marketsLoading;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Sports betting intelligence — live signals from top Polymarket traders
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetchSignals()}
          data-testid="button-refresh"
          className="gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {signalsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-4 pb-4 px-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))
        ) : (
          <>
            <StatCard
              icon={Zap}
              label="Active Signals"
              value={String(signals.length)}
              sub={`${highConfidence.length} high confidence`}
              color="bg-primary/10 text-primary"
            />
            <StatCard
              icon={Target}
              label="Actionable Now"
              value={String(actionable.length)}
              sub="Price still near entry"
              color="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            />
            <StatCard
              icon={Users}
              label="Tracked Traders"
              value={String(signalsData?.topTraderCount || traders.length)}
              sub="Multi-window LB"
              color="bg-blue-500/10 text-blue-600 dark:text-blue-400"
            />
            <StatCard
              icon={BarChart3}
              label="Markets Scanned"
              value={String(signalsData?.marketsScanned || 0)}
              sub="Active sports markets"
              color="bg-purple-500/10 text-purple-600 dark:text-purple-400"
            />
          </>
        )}
      </div>

      {/* Live Big Action Panel — above everything else for quick scanning */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-500" />
              <CardTitle className="text-sm font-semibold">Live Big Action</CardTitle>
              <span className="text-[10px] text-muted-foreground">
                — live push ·{" "}
                {lastAlertPush > 0
                  ? `${Math.round((nowTick - lastAlertPush) / 1000)}s ago`
                  : "connecting…"}
              </span>
            </div>
            {alertsData?.alerts?.length ? (
              <Badge variant="secondary" className="text-[10px]">{alertsData.alerts.length} bets</Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {alertsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !alertsData?.alerts?.length ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
              <Bell className="w-3.5 h-3.5" />
              No large tracked-trader bets in recent data — check back shortly
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {alertsData.alerts.slice(0, 15).map((alert: any) => {
                const outcomeLabel = getOutcomeLabel(alert.market, alert.side);
                const isExpanded = expandedAlerts.has(alert.id);
                const sharp = alert.sharpAction;
                return (
                  <div key={alert.id} data-testid={`live-alert-${alert.id}`}>
                    {/* Main row — clickable */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleAlert(alert.id)}
                      onKeyDown={e => e.key === "Enter" && toggleAlert(alert.id)}
                      className="flex items-center gap-3 py-2.5 cursor-pointer rounded-md hover:bg-muted/40 transition-colors px-1 -mx-1"
                    >
                      {/* Side pill */}
                      <div className={`shrink-0 flex flex-col items-center justify-center w-12 h-12 rounded-lg font-bold text-xs border ${
                        alert.side === "YES"
                          ? "bg-green-500/10 border-green-500/25 text-green-700 dark:text-green-300"
                          : "bg-red-500/10 border-red-500/25 text-red-600 dark:text-red-400"
                      }`}>
                        <span className="text-[10px] leading-none">BET</span>
                        <span className="text-sm leading-tight font-black">{alert.side}</span>
                      </div>
                      {/* Market + outcome */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-foreground">{outcomeLabel}</span>
                          {alert.isSportsLb && (
                            <span className="text-[10px] px-1 py-0 rounded bg-primary/10 text-primary border border-primary/20 font-semibold shrink-0">LB</span>
                          )}
                          {sharp?.isActionable && (
                            <span className="text-[10px] px-1 py-0 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-semibold shrink-0">ACT</span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate mt-0.5">{alert.market}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] font-medium text-muted-foreground">{alert.trader}</span>
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" />{alert.minutesAgo}m ago
                          </span>
                        </div>
                      </div>
                      {/* Size + expand chevron */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="text-right">
                          <div className="text-sm font-bold tabular-nums">
                            ${alert.size >= 1000 ? `${(alert.size / 1000).toFixed(1)}K` : alert.size}
                          </div>
                          <div className="text-[10px] text-muted-foreground tabular-nums">
                            @ {Math.round(alert.price * 100)}¢
                          </div>
                        </div>
                        {isExpanded
                          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                      </div>
                    </div>

                    {/* Expanded detail panel */}
                    {isExpanded && (
                      <div className="mb-2 mx-1 p-3 rounded-md bg-muted/50 border border-border space-y-2 text-xs">
                        <div className="font-semibold text-foreground">{alert.market}</div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">Bet:</span>
                            <span className={`font-bold ${alert.side === "YES" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                              {outcomeLabel}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">Size:</span>
                            <span className="font-bold">${alert.size >= 1000 ? `${(alert.size / 1000).toFixed(1)}K` : alert.size}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">Entry price:</span>
                            <span className="font-bold tabular-nums">{Math.round(alert.price * 100)}¢</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">Implied odds:</span>
                            <span className="font-bold">{(1 / alert.price).toFixed(1)}x</span>
                          </div>
                        </div>

                        {/* Sharp consensus context */}
                        {sharp ? (
                          <div className={`p-2 rounded border text-[11px] ${
                            sharp.isActionable
                              ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                              : "bg-primary/5 border-primary/15 text-primary"
                          }`}>
                            <div className="font-semibold mb-0.5">
                              Sharp consensus: {sharp.traderCount} tracked traders → {sharp.side} · {sharp.confidence}/100
                            </div>
                            <div>
                              Avg entry: {Math.round(sharp.avgEntry * 100)}¢ · 
                              Current price: {Math.round(sharp.currentPrice * 100)}¢
                              {sharp.isActionable ? " · Still actionable" : " · Price has moved"}
                            </div>
                          </div>
                        ) : (
                          <div className="text-muted-foreground text-[11px]">
                            No consensus signal yet for this market — this is an individual tracked-trader bet.
                          </div>
                        )}

                        {/* Polymarket link */}
                        {alert.slug && (
                          <a
                            href={`https://polymarket.com/market/${alert.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-primary hover:underline font-medium"
                            onClick={e => e.stopPropagation()}
                          >
                            Trade on Polymarket <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top Signals */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-sm">Top Signals</h2>
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Signal type filter toggles */}
              {(["all", "live", "pregame", "nofutures"] as const).map(f => {
                const labels: Record<typeof f, string> = {
                  all: "All", live: "Live", pregame: "Pregame", nofutures: "No Futures",
                };
                return (
                  <button
                    key={f}
                    onClick={() => setSignalTypeFilter(f)}
                    data-testid={`filter-signals-${f}`}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                      signalTypeFilter === f
                        ? f === "live"
                          ? "bg-red-500 text-white border-red-500"
                          : f === "pregame"
                          ? "bg-blue-500 text-white border-blue-500"
                          : "bg-primary text-primary-foreground border-primary"
                        : "bg-muted border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f === "live" && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1 animate-pulse align-middle" />}
                    {labels[f]}
                  </button>
                );
              })}
              <span className="text-[10px] text-muted-foreground hidden sm:inline">90s refresh</span>
              <Link href="/signals">
                <Button size="sm" variant="ghost" className="gap-1.5 h-7 text-xs" data-testid="link-all-signals">
                  View all <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          </div>

          <Card>
            <CardContent className="p-2">
              {signalsLoading ? (
                <div className="space-y-1">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="px-3 py-2.5">
                      <Skeleton className="h-4 w-3/4 mb-1.5" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : signalsError ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                  <AlertCircle className="w-8 h-8 text-muted-foreground" />
                  <div>
                    <div className="font-medium text-sm">Unable to fetch signals</div>
                    <div className="text-xs text-muted-foreground mt-1 max-w-xs">
                      Polymarket APIs may be rate-limited. Try refreshing.
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => refetchSignals()}>Retry</Button>
                </div>
              ) : topSignals.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                  <Activity className="w-8 h-8 text-muted-foreground" />
                  <div>
                    <div className="font-medium text-sm">
                      {signalTypeFilter !== "all" ? `No ${signalTypeFilter === "nofutures" ? "non-futures" : signalTypeFilter} signals right now` : "No signals generated yet"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 max-w-xs">
                      {signalTypeFilter !== "all"
                        ? "Try a different filter or check back after the next refresh."
                        : "Signals appear when 2+ top traders share a consensus position on sports markets."}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {topSignals.map(signal => (
                    <SignalRow key={signal.id} signal={signal} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Top Traders Mini */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Top Traders</h2>
            <Link href="/traders">
              <Button size="sm" variant="ghost" className="gap-1.5 h-7 text-xs" data-testid="link-all-traders">
                View all <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>

          <Card>
            <CardContent className="p-2">
              {tradersLoading ? (
                <div className="space-y-1">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="px-3 py-2">
                      <Skeleton className="h-4 w-2/3 mb-1" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  ))}
                </div>
              ) : traders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Users className="w-6 h-6 text-muted-foreground mb-2" />
                  <div className="text-xs text-muted-foreground">No trader data</div>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {traders.slice(0, 8).map((trader, i) => (
                    <div
                      key={trader.address}
                      className="flex items-center justify-between px-3 py-2 rounded-md hover-elevate"
                      data-testid={`trader-mini-${i}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-muted-foreground w-4 shrink-0 font-mono">#{i + 1}</span>
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate">
                            {trader.name || `${trader.address.slice(0, 6)}...${trader.address.slice(-4)}`}
                          </div>
                          <div className={`text-[10px] font-medium ${trader.roi >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                            {trader.roi >= 0 ? "+" : ""}{trader.roi.toFixed(1)}% ROI
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-xs font-semibold ${trader.pnl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                          {trader.pnl >= 0 ? "+" : ""}
                          {trader.pnl >= 1_000_000
                            ? `$${(trader.pnl / 1_000_000).toFixed(1)}M`
                            : trader.pnl >= 1000
                            ? `$${(trader.pnl / 1000).toFixed(0)}K`
                            : `$${trader.pnl.toFixed(0)}`}
                        </div>
                        <div className="text-[10px] text-muted-foreground">PNL</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* How It Works */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">How PredictionInsider Works</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                icon: Users,
                title: "150+ Tracked Traders",
                desc: "We pull from ALL, WEEK, and MONTH Polymarket leaderboards to build a database of elite sports traders — capturing both all-time greats and hot streaks.",
              },
              {
                icon: Activity,
                title: "Consensus + Actionability",
                desc: "When 50%+ of tracked traders share a position, we flag it. ACTIONABLE means the current market price is still close to where they entered — you can still get in.",
              },
              {
                icon: Target,
                title: "Big Play Detection",
                desc: "Signals with large capital deployed (BIG PLAY) indicate high conviction. We weight signals by bet size, trader quality, and consensus strength.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-3">
                <div className="p-2 rounded-md bg-muted h-fit shrink-0">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-sm font-medium">{title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
