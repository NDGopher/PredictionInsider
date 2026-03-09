import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
  TrendingUp, TrendingDown, Clock, Droplets
} from "lucide-react";
import type { MarketsResponse, Market } from "@shared/schema";

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

function MarketCard({ market }: { market: Market }) {
  const pct = Math.round(market.currentPrice * 100);
  const endDate = market.endDate ? new Date(market.endDate) : null;
  const daysLeft = endDate ? Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : null;

  return (
    <Card className="hover-elevate" data-testid={`market-card-${market.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-snug line-clamp-2" data-testid={`market-question-${market.id}`}>
              {market.question}
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {market.category && (
                <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4 capitalize">
                  {market.category}
                </Badge>
              )}
              {(market as any).source === "kalshi" && (
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 border-blue-500/30 text-blue-600 dark:text-blue-400">
                  Kalshi
                </Badge>
              )}
              {daysLeft !== null && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {daysLeft}d left
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
            {(market as any).source === "kalshi" ? (
              <a
                href={`https://kalshi.com/markets/${market.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-primary"
                data-testid={`link-market-${market.id}`}
              >
                Trade on Kalshi <ExternalLink className="w-3 h-3" />
              </a>
            ) : (
              <a
                href={`https://polymarket.com/market/${market.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-primary"
                data-testid={`link-market-${market.id}`}
              >
                Trade on Polymarket <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Markets() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("volume");
  const [priceFilter, setPriceFilter] = useState("all");

  const { data, isLoading, error, refetch } = useQuery<MarketsResponse>({
    queryKey: ["/api/markets"],
    staleTime: 3 * 60 * 1000,
  });

  const markets = data?.markets || [];

  const filtered = markets
    .filter(m => {
      if (search && !m.question.toLowerCase().includes(search.toLowerCase())) return false;
      if (priceFilter === "long") return m.currentPrice < 0.4;
      if (priceFilter === "short") return m.currentPrice > 0.6;
      if (priceFilter === "coin") return m.currentPrice >= 0.4 && m.currentPrice <= 0.6;
      return true;
    })
    .sort((a, b) => {
      if (sort === "volume") return b.volume - a.volume;
      if (sort === "liquidity") return b.liquidity - a.liquidity;
      if (sort === "price-high") return b.currentPrice - a.currentPrice;
      if (sort === "price-low") return a.currentPrice - b.currentPrice;
      return 0;
    });

  const totalVolume = markets.reduce((s, m) => s + m.volume, 0);
  const avgPrice = markets.length > 0 ? markets.reduce((s, m) => s + m.currentPrice, 0) / markets.length : 0;
  const overFifty = markets.filter(m => m.currentPrice > 0.5).length;

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
            Active sports prediction markets on Polymarket
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
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-[10px] text-muted-foreground mb-1">Markets Listed</div>
              <div className="text-lg font-bold">{markets.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-[10px] text-muted-foreground mb-1">Favored YES</div>
              <div className="text-lg font-bold">{overFifty}/{markets.length}</div>
            </CardContent>
          </Card>
        </div>
      )}

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
            <SelectItem value="volume">Volume</SelectItem>
            <SelectItem value="liquidity">Liquidity</SelectItem>
            <SelectItem value="price-high">Price High</SelectItem>
            <SelectItem value="price-low">Price Low</SelectItem>
          </SelectContent>
        </Select>
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
                  ? "Sports markets are loading from Polymarket."
                  : "Try adjusting your filters."}
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
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}
    </div>
  );
}
