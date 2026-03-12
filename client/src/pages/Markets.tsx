import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  BarChart3, Search, ExternalLink, RefreshCw, AlertCircle,
  Clock, Droplets, Radio, Hourglass, CalendarClock, TrendingUp,
  ChevronDown, ChevronUp, DollarSign, Target
} from "lucide-react";
import type { MarketsResponse, Market } from "@shared/schema";

const AUTO_REFRESH_MS = 30_000; // 30s

type MarketType = "live" | "upcoming" | "all" | "moneyline" | "spread" | "total" | "futures";

const TYPE_TABS: { value: MarketType; label: string }[] = [
  { value: "live", label: "🔴 Live" },
  { value: "upcoming", label: "Upcoming" },
  { value: "moneyline", label: "Moneyline" },
  { value: "spread", label: "Spread" },
  { value: "total", label: "Total (O/U)" },
  { value: "futures", label: "Futures" },
  { value: "all", label: "All" },
];

function getOutcomeLabel(title: string, side: "YES" | "NO"): string {
  const t = title.trim();
  const ouMatch = t.match(/o\/?u\s+([\d.]+)/i) || t.match(/total[:\s]+([\d.]+)/i);
  if (ouMatch) return side === "YES" ? `Over ${ouMatch[1]}` : `Under ${ouMatch[1]}`;
  const willMatch = t.match(/will\s+(?:the\s+)?(.+?)\s+win/i);
  if (willMatch) return side === "YES" ? `${willMatch[1].trim()} WIN` : `${willMatch[1].trim()} won't win`;
  // eSports: "LoL: Team A vs Team B (BO3) - Context" → "Team A win (Context)"
  const esportsColonSub = t.match(/^[^:]+:\s*(.+?)\s+vs\.?\s+(.+?)\s*-\s*(.+)$/i);
  if (esportsColonSub) {
    const team1 = esportsColonSub[1].trim();
    const team2 = esportsColonSub[2].trim();
    const ctx   = esportsColonSub[3].trim();
    return side === "YES" ? `${team1} win (${ctx})` : `${team2} win (${ctx})`;
  }
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
  return side === "YES" ? "YES wins" : "NO wins";
}

function GameStatusBadge({ status }: { status?: string }) {
  if (status === "live") return (
    <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20 animate-pulse">
      <Radio className="w-2.5 h-2.5" />LIVE
    </span>
  );
  if (status === "pregame") return (
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

function MarketTypeBadge({ type }: { type?: string }) {
  if (!type || type === "other") return null;
  const map: Record<string, { label: string; cls: string }> = {
    moneyline: { label: "MONEYLINE", cls: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20" },
    spread:    { label: "SPREAD",    cls: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20" },
    total:     { label: "TOTAL",     cls: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20" },
    futures:   { label: "FUTURES",   cls: "bg-muted text-muted-foreground border-border" },
  };
  const cfg = map[type];
  if (!cfg) return null;
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function PriceBar({ price }: { price: number }) {
  const pct = Math.round(price * 100);
  const color = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-primary" : "bg-red-500";
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>YES</span>
        <span>{pct}¢</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function formatTimeLeft(endDate: string | null | undefined): string {
  if (!endDate) return "";
  const ms = new Date(endDate).getTime() - Date.now();
  if (ms < 0) return "Ended";
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (h === 0) return `${m}m`;
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function SharpActionBanner({ action }: { action: any }) {
  if (!action) return null;
  return (
    <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs border ${
      action.isActionable
        ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300"
        : action.bigPlayScore >= 2
        ? "bg-amber-500/10 border-amber-500/25 text-amber-700 dark:text-amber-300"
        : "bg-primary/8 border-primary/20 text-primary"
    }`} data-testid="sharp-action-banner">
      <div className="flex items-center gap-1.5 font-semibold">
        <TrendingUp className="w-3 h-3" />
        <span>SHARPS → {action.side}</span>
        {action.isActionable && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-500/20 font-bold">ACTIONABLE</span>
        )}
        {!action.isActionable && action.bigPlayScore >= 2 && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/20 font-bold">BIG PLAY</span>
        )}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-medium">
        <span>{action.traderCount} trader{action.traderCount !== 1 ? "s" : ""}</span>
        <span className="font-bold text-foreground">{action.confidence}/100</span>
      </div>
    </div>
  );
}

function MarketCard({ market, matchSignal }: { market: Market & { marketType?: string; gameStatus?: string; sharpAction?: any }; matchSignal?: any }) {
  const [expanded, setExpanded] = useState(false);
  const pct = Math.round(market.currentPrice * 100);
  const timeLeft = formatTimeLeft(market.endDate);
  const gameStatus = market.gameStatus as string | undefined;
  const sharpAction = (market as any).sharpAction;

  // Sharp action derived values
  const entryPct    = sharpAction ? Math.round(sharpAction.avgEntry * 100) : null;
  const currentPct  = sharpAction ? Math.round(sharpAction.currentPrice * 100) : null;
  const delta       = (entryPct !== null && currentPct !== null) ? currentPct - entryPct : null;
  const totalK      = sharpAction ? (sharpAction.totalUsdc / 1000).toFixed(1) : null;
  const outcomeLabel = sharpAction ? getOutcomeLabel(market.question, sharpAction.side) : null;

  return (
    <Card className={`hover-elevate transition-all ${sharpAction ? "border-primary/20" : ""}`} data-testid={`market-card-${market.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-snug line-clamp-2" data-testid={`market-question-${market.id}`}>
              {market.question}
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <GameStatusBadge status={gameStatus} />
              <MarketTypeBadge type={market.marketType} />
              {timeLeft && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="w-3 h-3" />{timeLeft}
                </span>
              )}
            </div>
          </div>
          <div className={`text-xl font-bold shrink-0 tabular-nums
            ${pct >= 60 ? "text-green-600 dark:text-green-400" : pct <= 40 ? "text-red-500" : "text-foreground"}`}>
            {pct}¢
          </div>
        </div>

        <PriceBar price={market.currentPrice} />

        {/* Sharp action banner — clickable to expand */}
        {sharpAction && (
          <div className="mt-3">
            <button
              onClick={() => setExpanded(e => !e)}
              data-testid={`button-expand-sharp-${market.id}`}
              className="w-full text-left"
            >
              <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs border cursor-pointer transition-colors ${
                sharpAction.isActionable
                  ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15"
                  : sharpAction.bigPlayScore >= 2
                  ? "bg-amber-500/10 border-amber-500/25 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15"
                  : "bg-primary/8 border-primary/20 text-primary hover:bg-primary/12"
              }`}>
                <div className="flex items-center gap-1.5 font-semibold">
                  <TrendingUp className="w-3 h-3" />
                  <span>SHARPS → {sharpAction.side}</span>
                  {sharpAction.isActionable && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-500/20 font-bold">ACTIONABLE</span>
                  )}
                  {!sharpAction.isActionable && sharpAction.bigPlayScore >= 2 && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/20 font-bold">BIG PLAY</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                  <span>{sharpAction.traderCount} traders · {sharpAction.confidence}/100</span>
                  {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </div>
              </div>
            </button>

            {/* Expanded sharp action panel */}
            {expanded && (
              <div className="mt-2 p-3 rounded-md bg-muted/50 border border-border space-y-2.5" data-testid={`sharp-detail-${market.id}`}>
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Target className="w-3.5 h-3.5 text-primary" />
                  <span>Sharp Play: <span className={sharpAction.side === "YES" ? "text-green-600 dark:text-green-400" : "text-red-500"}>{outcomeLabel}</span></span>
                </div>

                {/* Price comparison */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center p-2 rounded bg-background border border-border">
                    <div className="text-[10px] text-muted-foreground mb-0.5">They Paid</div>
                    <div className="text-sm font-bold tabular-nums">{entryPct}¢</div>
                  </div>
                  <div className="text-center p-2 rounded bg-background border border-border">
                    <div className="text-[10px] text-muted-foreground mb-0.5">Live Now</div>
                    <div className="text-sm font-bold tabular-nums">{pct}¢</div>
                  </div>
                  <div className={`text-center p-2 rounded border ${
                    delta !== null && delta <= 3
                      ? "bg-emerald-500/10 border-emerald-500/25"
                      : delta !== null && delta > 10
                      ? "bg-red-500/10 border-red-500/25"
                      : "bg-muted border-border"
                  }`}>
                    <div className="text-[10px] text-muted-foreground mb-0.5">Moved</div>
                    <div className={`text-sm font-bold tabular-nums ${
                      delta !== null && delta <= 3 ? "text-emerald-600 dark:text-emerald-400"
                      : delta !== null && delta > 10 ? "text-red-500"
                      : "text-foreground"
                    }`}>
                      {delta !== null ? (delta >= 0 ? `+${delta}` : delta) : "—"}¢
                    </div>
                  </div>
                </div>

                {/* What to look for */}
                {entryPct !== null && (
                  <div className={`px-2.5 py-1.5 rounded text-[11px] border ${
                    delta !== null && Math.abs(delta) <= 5
                      ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                      : "bg-muted border-border text-muted-foreground"
                  }`}>
                    {delta !== null && Math.abs(delta) <= 5 ? (
                      <span>✓ <strong>Still actionable</strong> — price is near where sharps entered ({entryPct}¢). Look to buy {sharpAction.side} at or below {entryPct + 3}¢.</span>
                    ) : delta !== null && delta > 5 ? (
                      <span>⚠ Price moved +{delta}¢ since sharps entered at {entryPct}¢. Value may be gone — proceed with caution.</span>
                    ) : (
                      <span>↓ Price dropped {Math.abs(delta ?? 0)}¢ since sharps entered. Could be an even better entry near {pct}¢.</span>
                    )}
                  </div>
                )}

                {/* Meta stats */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
                  <span className="flex items-center gap-1">
                    <DollarSign className="w-3 h-3" />
                    ${totalK}K committed by {sharpAction.traderCount} tracked traders
                  </span>
                  <span className="font-semibold text-foreground">{sharpAction.confidence}/100 confidence</span>
                </div>

                {/* Trader profiles from matching signal */}
                {matchSignal && matchSignal.traders?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border/30 space-y-1.5">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      {matchSignal.sport || "Sport"} Track Record
                    </div>
                    {matchSignal.traders.slice(0, 4).map((t: any, i: number) => (
                      <div key={i} className="rounded bg-background/70 border border-border/40 p-2">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="text-muted-foreground text-[10px] font-bold shrink-0">#{i+1}</span>
                            {t.isSportsLb && <span className="text-[10px]">🏆</span>}
                            <a
                              href={`https://polymarket.com/profile/${t.address}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] font-semibold text-primary hover:underline truncate"
                              onClick={e => e.stopPropagation()}
                            >{t.name || t.address?.slice(0, 10)}</a>
                          </div>
                          <div className="text-[10px] text-muted-foreground shrink-0">
                            {t.netUsdc >= 1000 ? `$${(t.netUsdc/1000).toFixed(1)}K` : `$${t.netUsdc}`} @ {Math.round(t.entryPrice * 100)}¢
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {t.sportRoi !== null && t.sportRoi !== undefined && (
                            <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${t.sportRoi >= 20 ? "bg-green-500/15 text-green-700 dark:text-green-300" : t.sportRoi < 0 ? "bg-red-500/15 text-red-600" : "bg-muted text-muted-foreground"}`}>
                              {matchSignal.sport} ROI: {t.sportRoi >= 0 ? "+" : ""}{t.sportRoi.toFixed(1)}%{t.sportTradeCount ? ` (${t.sportTradeCount})` : ""}
                            </span>
                          )}
                          {t.winRate > 0 && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground font-bold">
                              {t.winRate.toFixed(0)}% win
                            </span>
                          )}
                          {t.tags?.filter((tag: string) => tag.includes("🏒")||tag.includes("⚽")||tag.includes("🏈")||tag.includes("⚾")||tag.includes("🏀")||tag.includes("🎾")).slice(0,2).map((tag: string, ti: number) => (
                            <span key={ti} className="text-[9px] text-primary/70">{tag}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <div className="text-[10px] text-muted-foreground">Volume</div>
            <div className="text-xs font-semibold">
              ${market.volume >= 1_000_000
                ? `${(market.volume / 1_000_000).toFixed(2)}M`
                : market.volume >= 1000
                ? `${(market.volume / 1000).toFixed(1)}K`
                : market.volume.toFixed(0)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">Liquidity</div>
            <div className="text-xs font-semibold flex items-center gap-1">
              <Droplets className="w-3 h-3 text-muted-foreground" />
              ${market.liquidity >= 1000
                ? `${(market.liquidity / 1000).toFixed(1)}K`
                : market.liquidity.toFixed(0)}
            </div>
          </div>
        </div>

        {market.slug && (
          <div className="mt-3 pt-2.5 border-t border-border/50">
            <a
              href={`https://polymarket.com/market/${market.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-primary hover:underline"
              data-testid={`link-market-${market.id}`}
            >
              Trade on Polymarket <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Markets() {
  const queryClient = useQueryClient();
  const [search, setSearch]         = useState("");
  const [sort, setSort]             = useState("soonest");
  const [priceFilter, setPriceFilter] = useState("all");
  const [marketType, setMarketType] = useState<MarketType>("upcoming");

  // "live" is client-side filtered from "all"
  const apiType   = marketType === "live" ? "all" : marketType;
  const queryKey  = ["/api/markets", apiType];

  const { data, isLoading, error, refetch } = useQuery<MarketsResponse>({
    queryKey,
    queryFn: () => fetch(`/api/markets?type=${apiType}&limit=200`).then(r => r.json()),
    staleTime: 25_000,
    refetchInterval: marketType === "live" ? 15_000 : AUTO_REFRESH_MS, // faster for live
  });

  // Fetch signals in the background so we can cross-reference trader profiles
  const { data: signalsData } = useQuery<{ signals: any[] }>({
    queryKey: ["/api/signals-elite", "markets-xref"],
    queryFn: () => fetch("/api/signals-elite?limit=500").then(r => r.json()),
    staleTime: 90_000,
  });
  const allSignals: any[] = signalsData?.signals || [];

  const markets = (data?.markets || []) as (Market & { marketType?: string; gameStatus?: string })[];

  const filtered = markets
    .filter(m => {
      // Live tab: only show live game markets
      if (marketType === "live" && m.gameStatus !== "live") return false;
      if (search && !m.question.toLowerCase().includes(search.toLowerCase())) return false;
      if (priceFilter === "long")  return m.currentPrice < 0.4;
      if (priceFilter === "short") return m.currentPrice > 0.6;
      if (priceFilter === "coin")  return m.currentPrice >= 0.4 && m.currentPrice <= 0.6;
      return true;
    })
    .sort((a, b) => {
      if (sort === "volume")     return b.volume - a.volume;
      if (sort === "liquidity")  return b.liquidity - a.liquidity;
      if (sort === "price-high") return b.currentPrice - a.currentPrice;
      if (sort === "price-low")  return a.currentPrice - b.currentPrice;
      if (sort === "sharps") {
        const aConf = (a as any).sharpAction?.confidence ?? -1;
        const bConf = (b as any).sharpAction?.confidence ?? -1;
        return bConf - aConf;
      }
      if (sort === "soonest") {
        const aEnd = a.endDate ? new Date(a.endDate).getTime() : Infinity;
        const bEnd = b.endDate ? new Date(b.endDate).getTime() : Infinity;
        return aEnd - bEnd;
      }
      return 0;
    });

  const liveCount    = markets.filter(m => m.gameStatus === "live").length;
  const pregameCount = markets.filter(m => m.gameStatus === "pregame").length;
  const totalVolume  = markets.reduce((s, m) => s + m.volume, 0);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold tracking-tight">Sports Markets</h1>
            {!isLoading && (
              <Badge variant="secondary">{filtered.length}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Live & upcoming sports markets — moneylines, spreads, and totals
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetch()}
          data-testid="button-refresh-markets"
          className="gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {!isLoading && markets.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-[10px] text-muted-foreground mb-1">Total Volume</div>
              <div className="text-lg font-bold">
                ${totalVolume >= 1_000_000
                  ? `${(totalVolume / 1_000_000).toFixed(1)}M`
                  : totalVolume >= 1000
                  ? `${(totalVolume / 1000).toFixed(0)}K`
                  : totalVolume.toFixed(0)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 px-4 flex items-center gap-2">
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">Live Now</div>
                <div className="text-lg font-bold text-red-500">{liveCount}</div>
              </div>
              {liveCount > 0 && <Radio className="w-4 h-4 text-red-500 animate-pulse" />}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-[10px] text-muted-foreground mb-1">Pregame</div>
              <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{pregameCount}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Market Type Tabs */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {TYPE_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => {
              setMarketType(tab.value);
              if (tab.value === "live") setSort("sharps"); // default sharps sort for live tab
            }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors border
              ${marketType === tab.value
                ? tab.value === "live"
                  ? "bg-red-500 text-white border-red-500"
                  : "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-border/80"}`}
            data-testid={`tab-market-type-${tab.value}`}
          >
            {tab.label}
            {tab.value === "live" && liveCount > 0 && (
              <span className={`text-[10px] px-1 py-0 rounded font-bold ${
                marketType === "live" ? "bg-white/20 text-white" : "bg-red-500/15 text-red-600 dark:text-red-400"
              }`}>{liveCount}</span>
            )}
          </button>
        ))}
        {marketType === "live" && (
          <span className="text-[10px] text-muted-foreground ml-1">15s auto-refresh</span>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search markets..."
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-markets"
          />
        </div>
        <Select value={priceFilter} onValueChange={setPriceFilter}>
          <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-price-filter">
            <SelectValue placeholder="Price range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Prices</SelectItem>
            <SelectItem value="long">Longshots (&lt;40¢)</SelectItem>
            <SelectItem value="coin">Coin flip (40-60¢)</SelectItem>
            <SelectItem value="short">Favorites (&gt;60¢)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-sort-markets">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="soonest">Soonest First</SelectItem>
            <SelectItem value="sharps">Sharp Action</SelectItem>
            <SelectItem value="volume">Volume</SelectItem>
            <SelectItem value="liquidity">Liquidity</SelectItem>
            <SelectItem value="price-high">Price High</SelectItem>
            <SelectItem value="price-low">Price Low</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">
          Auto-refreshes every 30s
        </span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-3 w-1/2 mb-4" />
                <Skeleton className="h-2 w-full mb-3" />
                <div className="grid grid-cols-2 gap-2">
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
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
              <div className="font-medium">Failed to load markets</div>
              <div className="text-sm text-muted-foreground mt-1">
                Polymarket Gamma API may be temporarily unavailable.
              </div>
            </div>
            <Button onClick={() => refetch()} variant="outline" className="gap-2">
              <RefreshCw className="w-4 h-4" /> Try Again
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <BarChart3 className="w-10 h-10 text-muted-foreground" />
            <div>
              <div className="font-medium">
                {markets.length === 0 ? "No markets found" : "No markets match your filters"}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {markets.length === 0
                  ? `No ${marketType === "upcoming" ? "upcoming game" : marketType} markets right now. Try "All" to see everything.`
                  : "Try adjusting your filters or switching tabs."}
              </div>
            </div>
            {search && (
              <Button variant="outline" size="sm" onClick={() => setSearch("")}>Clear search</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(market => (
            <MarketCard
              key={market.id}
              market={market as any}
              matchSignal={allSignals.find((s: any) => s.marketId === market.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
