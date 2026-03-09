import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
  RefreshCw, Users, Target, ChevronDown, ChevronUp, Star, Activity
} from "lucide-react";
import type { SignalsResponse, Signal } from "@shared/schema";

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

function SignalCard({ signal, mode }: { signal: Signal; mode: "elite" | "fast" }) {
  const [expanded, setExpanded] = useState(false);

  const yesColor = signal.side === "YES"
    ? "border-green-500/30 bg-green-500/5"
    : "border-red-500/30 bg-red-500/5";

  const confidenceLabel =
    signal.confidence >= 75 ? { label: "HIGH", cls: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20" } :
    signal.confidence >= 50 ? { label: "MED", cls: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20" } :
    { label: "LOW", cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20" };

  const polyUrl = signal.slug
    ? `https://polymarket.com/market/${signal.slug}`
    : signal.marketId ? `https://polymarket.com/event/${signal.marketId}` : null;

  const hasROI = signal.traders.some(t => t.roi > 0);

  return (
    <Card className={`border ${yesColor}`} data-testid={`signal-card-${signal.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold
            ${signal.side === "YES" ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-red-500/15 text-red-600 dark:text-red-400"}`}>
            {signal.side}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-snug" data-testid={`signal-question-${signal.id}`}>
                  {signal.marketQuestion}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${confidenceLabel.cls}`}>
                    {confidenceLabel.label} CONFIDENCE
                  </span>
                  {signal.isValue && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                      VALUE
                    </span>
                  )}
                  {mode === "elite" && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20 flex items-center gap-0.5">
                      <Star className="w-2.5 h-2.5" /> ELITE
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground capitalize">{signal.category}</span>
                </div>
              </div>
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                <span>Confidence Score</span>
                <span>{signal.confidence}/100</span>
              </div>
              <ConfidenceBar score={signal.confidence} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              <div className="bg-muted/50 rounded-md p-2">
                <div className="text-[10px] text-muted-foreground">Current Price</div>
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
                <div className="text-[10px] text-muted-foreground">Traders</div>
                <div className="text-sm font-semibold">{signal.traderCount}</div>
              </div>
            </div>

            {signal.valueDelta !== 0 && (
              <div className={`flex items-center gap-1.5 mt-2 text-xs
                ${signal.valueDelta > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                {signal.valueDelta > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {signal.valueDelta > 0
                  ? `${(signal.valueDelta * 100).toFixed(1)}¢ value edge vs. live price (after 2¢ slippage)`
                  : `Entry was ${Math.abs(signal.valueDelta * 100).toFixed(1)}¢ cheaper than live price`}
              </div>
            )}

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                data-testid={`button-expand-${signal.id}`}
              >
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {expanded ? "Hide" : "Show"} traders ({signal.traderCount})
              </button>
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

            {expanded && signal.traders.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {signal.traders.map((t, i) => (
                  <div key={i} className="flex items-center justify-between bg-muted/40 rounded px-2.5 py-1.5">
                    <div className="flex items-center gap-2">
                      <Users className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs font-mono">
                        {t.name || (t.address ? `${t.address.slice(0, 6)}...${t.address.slice(-4)}` : "Trader")}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">Entry: {(t.entryPrice * 100).toFixed(1)}¢</span>
                      {hasROI && t.roi > 0 && (
                        <span className={`font-medium ${t.roi >= 20 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                          {t.roi >= 0 ? "+" : ""}{t.roi.toFixed(1)}% ROI
                        </span>
                      )}
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

export default function Signals() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("confidence");
  const [mode, setMode] = useState<"elite" | "fast">("elite");

  const eliteQuery = useQuery<SignalsResponse>({
    queryKey: ["/api/signals"],
    staleTime: 4 * 60 * 1000,
    enabled: mode === "elite",
  });

  const fastQuery = useQuery<SignalsResponse>({
    queryKey: ["/api/signals/fast"],
    staleTime: 90 * 1000,
    enabled: mode === "fast",
  });

  const activeQuery = mode === "elite" ? eliteQuery : fastQuery;
  const { data, isLoading, error, refetch } = activeQuery;
  const signals = data?.signals || [];

  const filtered = signals
    .filter(s => {
      if (search && !s.marketQuestion.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === "value") return s.isValue;
      if (filter === "high") return s.confidence >= 70;
      if (filter === "yes") return s.side === "YES";
      if (filter === "no") return s.side === "NO";
      return true;
    })
    .sort((a, b) => {
      if (sort === "confidence") return b.confidence - a.confidence;
      if (sort === "consensus") return b.consensusPct - a.consensusPct;
      if (sort === "value") return b.valueDelta - a.valueDelta;
      if (sort === "traders") return b.traderCount - a.traderCount;
      return 0;
    });

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold tracking-tight">Live Signals</h1>
            {!isLoading && (
              <Badge variant="secondary" className="ml-1">{filtered.length}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {mode === "elite"
              ? "Consensus positions from official top-50 leaderboard traders (40% ROI weighted)"
              : "Real-time consensus from recent Polymarket sports trading activity"}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetch()}
          data-testid="button-refresh-signals"
          className="gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-1.5 p-1 bg-muted rounded-lg w-fit">
        <button
          onClick={() => setMode("elite")}
          data-testid="button-mode-elite"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            mode === "elite"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Star className="w-3.5 h-3.5" />
          Elite Signals
        </button>
        <button
          onClick={() => setMode("fast")}
          data-testid="button-mode-fast"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            mode === "fast"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Live Feed
        </button>
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
            data-testid="input-search-signals"
          />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-filter">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Signals</SelectItem>
            <SelectItem value="value">Value Only</SelectItem>
            <SelectItem value="high">High Confidence</SelectItem>
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
            <SelectItem value="value">Value Delta</SelectItem>
            <SelectItem value="traders">Trader Count</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!isLoading && signals.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <span className="font-medium">{data?.topTraderCount} traders tracked</span>
          <span>{data?.marketsScanned} sports markets scanned</span>
          <span className="text-green-600 dark:text-green-400">{signals.filter(s => s.isValue).length} value opportunities</span>
          <span>{signals.filter(s => s.confidence >= 70).length} high-confidence signals</span>
          {data?.source && (
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border">
              {data.source === "official_leaderboard_v2" ? "Official leaderboard" : "Live activity"} source
            </span>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-5 w-3/4 mb-3" />
                <Skeleton className="h-3 w-full mb-1.5" />
                <Skeleton className="h-3 w-4/5 mb-4" />
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <Skeleton key={j} className="h-12" />
                  ))}
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
                The Polymarket APIs may be temporarily unavailable or rate-limited.
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
            <Target className="w-10 h-10 text-muted-foreground" />
            <div>
              <div className="font-medium">
                {signals.length === 0 ? "No signals generated" : "No signals match your filters"}
              </div>
              <div className="text-sm text-muted-foreground mt-1 max-w-sm">
                {signals.length === 0
                  ? mode === "elite"
                    ? "Elite signals appear when 2+ top-50 leaderboard traders hold the same position. Try Live Feed for faster signals."
                    : "Live signals appear when 2+ active traders take the same side. Data is loading."
                  : "Try adjusting your filters to see more signals."}
              </div>
            </div>
            {signals.length === 0 && mode === "elite" && (
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
