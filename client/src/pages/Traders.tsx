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
  Users, Search, RefreshCw, AlertCircle, ExternalLink
} from "lucide-react";
import type { LeaderboardResponse, Trader } from "@shared/schema";

function TraderRank({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-xs font-bold text-yellow-500">🥇</span>;
  if (rank === 2) return <span className="text-xs font-bold text-slate-400">🥈</span>;
  if (rank === 3) return <span className="text-xs font-bold text-amber-600">🥉</span>;
  return <span className="text-xs text-muted-foreground tabular-nums w-5 text-center">#{rank}</span>;
}

function WinRateBar({ rate }: { rate: number }) {
  const color = rate >= 60 ? "bg-green-500" : rate >= 45 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground">{rate.toFixed(0)}%</span>
    </div>
  );
}

function TraderCard({ trader }: { trader: Trader }) {
  const addr = trader.address;
  const shortAddr = addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "Unknown";
  const polyLink = `https://polymarket.com/profile/${addr}`;

  return (
    <Card className="hover-elevate" data-testid={`trader-card-${trader.rank}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-xs font-bold text-primary">
              {(trader.name || shortAddr).slice(0, 2).toUpperCase()}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <TraderRank rank={trader.rank} />
                  <span className="text-sm font-semibold truncate" data-testid={`trader-name-${trader.rank}`}>
                    {trader.name || shortAddr}
                  </span>
                </div>
                {trader.name && (
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{shortAddr}</div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-bold text-foreground">
                  {trader.tradesCount} trades
                </div>
                <div className="text-[10px] text-muted-foreground">recent activity</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-3">
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">Trades</div>
                <div className="text-xs font-semibold">{trader.tradesCount.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">Volume</div>
                <div className="text-xs font-semibold">
                  ${trader.volume >= 1_000_000
                    ? `${(trader.volume / 1_000_000).toFixed(2)}M`
                    : trader.volume >= 1000
                    ? `${(trader.volume / 1000).toFixed(1)}K`
                    : trader.volume.toFixed(0)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">Avg Size</div>
                <div className="text-xs font-semibold">
                  ${trader.avgSize >= 1000
                    ? `${(trader.avgSize / 1000).toFixed(1)}K`
                    : trader.avgSize.toFixed(0)}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end mt-2.5 pt-2.5 border-t border-border/50">
              <a
                href={polyLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-primary"
                data-testid={`link-trader-profile-${trader.rank}`}
              >
                Profile <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Traders() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("trades");

  const { data, isLoading, error, refetch } = useQuery<LeaderboardResponse>({
    queryKey: ["/api/traders"],
    staleTime: 5 * 60 * 1000,
  });

  const traders = data?.traders || [];

  const filtered = traders
    .filter(t => {
      if (!search) return true;
      const addr = t.address.toLowerCase();
      const name = (t.name || "").toLowerCase();
      const q = search.toLowerCase();
      return addr.includes(q) || name.includes(q);
    })
    .sort((a, b) => {
      if (sort === "trades") return b.tradesCount - a.tradesCount;
      if (sort === "volume") return b.volume - a.volume;
      if (sort === "avgsize") return b.avgSize - a.avgSize;
      return 0;
    });

  const totalVolume = traders.reduce((s, t) => s + t.volume, 0);
  const avgTradeSize = traders.length > 0 ? traders.reduce((s, t) => s + t.avgSize, 0) / traders.length : 0;
  const totalTrades = traders.reduce((s, t) => s + t.tradesCount, 0);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold tracking-tight">Top Traders</h1>
            {!isLoading && (
              <Badge variant="secondary">{filtered.length}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Most active sports traders from recent Polymarket activity
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetch()}
          data-testid="button-refresh-traders"
          className="gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Summary Stats */}
      {!isLoading && traders.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-[10px] text-muted-foreground mb-1">Active Traders</div>
              <div className="text-lg font-bold">{traders.length}</div>
            </CardContent>
          </Card>
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
              <div className="text-[10px] text-muted-foreground mb-1">Avg Trade Size</div>
              <div className="text-lg font-bold">
                ${avgTradeSize >= 1000 ? `${(avgTradeSize / 1000).toFixed(1)}K` : avgTradeSize.toFixed(0)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by address or name..."
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-traders"
          />
        </div>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-sort-traders">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="trades">Trade Count</SelectItem>
            <SelectItem value="volume">Volume</SelectItem>
            <SelectItem value="avgsize">Avg Size</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-1/2 mb-2" />
                    <Skeleton className="h-3 w-full mb-3" />
                    <div className="grid grid-cols-3 gap-2">
                      <Skeleton className="h-10" />
                      <Skeleton className="h-10" />
                      <Skeleton className="h-10" />
                    </div>
                  </div>
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
              <div className="font-medium">Failed to load traders</div>
              <div className="text-sm text-muted-foreground mt-1 max-w-sm">
                Polymarket's leaderboard API may be temporarily unavailable.
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
            <Users className="w-10 h-10 text-muted-foreground" />
            <div>
              <div className="font-medium">
                {traders.length === 0 ? "No trader data" : "No traders match your search"}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {traders.length === 0
                  ? "Trader data is loading from the Polymarket leaderboard."
                  : "Try a different search term."}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((trader) => (
            <TraderCard key={trader.address} trader={trader} />
          ))}
        </div>
      )}
    </div>
  );
}
