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
  Clock, Droplets, Radio, Hourglass, CalendarClock, TrendingUp
} from "lucide-react";
import type { MarketsResponse, Market } from "@shared/schema";

const AUTO_REFRESH_MS = 30_000; // 30s

type MarketType = "upcoming" | "all" | "moneyline" | "spread" | "total" | "futures";

const TYPE_TABS: { value: MarketType; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "moneyline", label: "Moneyline" },
  { value: "spread", label: "Spread" },
  { value: "total", label: "Total (O/U)" },
  { value: "futures", label: "Futures" },
  { value: "all", label: "All" },
];

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

function MarketCard({ market }: { market: Market & { marketType?: string; gameStatus?: string } }) {
  const pct = Math.round(market.currentPrice * 100);
  const timeLeft = formatTimeLeft(market.endDate);
  const gameStatus = market.gameStatus as string | undefined;

  return (
    <Card className="hover-elevate" data-testid={`market-card-${market.id}`}>
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

  const queryKey = ["/api/markets", marketType];

  const { data, isLoading, error, refetch } = useQuery<MarketsResponse>({
    queryKey,
    queryFn: () => fetch(`/api/markets?type=${marketType}&limit=150`).then(r => r.json()),
    staleTime: 25_000,
    refetchInterval: AUTO_REFRESH_MS,
  });

  const markets = (data?.markets || []) as (Market & { marketType?: string; gameStatus?: string })[];

  const filtered = markets
    .filter(m => {
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
            onClick={() => setMarketType(tab.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors border
              ${marketType === tab.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-border/80"}`}
            data-testid={`tab-market-type-${tab.value}`}
          >
            {tab.label}
          </button>
        ))}
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
            <MarketCard key={market.id} market={market as any} />
          ))}
        </div>
      )}
    </div>
  );
}
