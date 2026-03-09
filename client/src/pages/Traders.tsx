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
  Users, Search, RefreshCw, AlertCircle, ExternalLink, BadgeCheck, TrendingUp
} from "lucide-react";
import type { LeaderboardResponse, Trader } from "@shared/schema";

function TraderRank({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-xs font-bold text-yellow-500">#1</span>;
  if (rank === 2) return <span className="text-xs font-bold text-slate-400">#2</span>;
  if (rank === 3) return <span className="text-xs font-bold text-amber-600">#3</span>;
  return <span className="text-xs text-muted-foreground tabular-nums">#{rank}</span>;
}

function PnlBadge({ pnl }: { pnl: number }) {
  const positive = pnl >= 0;
  const formatted = pnl >= 1_000_000
    ? `$${(pnl / 1_000_000).toFixed(2)}M`
    : pnl >= 1000
    ? `$${(pnl / 1000).toFixed(1)}K`
    : `$${pnl.toFixed(0)}`;
  return (
    <span className={`text-xs font-bold tabular-nums ${positive ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
      {positive ? "+" : ""}{formatted}
    </span>
  );
}

function RoiPill({ roi }: { roi: number }) {
  const pct = Math.round(roi * 10) / 10;
  const cls = pct >= 20
    ? "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20"
    : pct >= 5
    ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cls}`}>
      {pct >= 0 ? "+" : ""}{pct.toFixed(1)}% ROI
    </span>
  );
}

function TraderCard({ trader }: { trader: Trader }) {
  const addr = trader.address;
  const shortAddr = addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "Unknown";
  const polyLink = `https://polymarket.com/profile/${addr}`;
  const xLink = (trader as any).xUsername ? `https://x.com/${(trader as any).xUsername}` : null;

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
                <div className="flex items-center gap-1.5 flex-wrap">
                  <TraderRank rank={trader.rank} />
                  <span className="text-sm font-semibold truncate" data-testid={`trader-name-${trader.rank}`}>
                    {trader.name || shortAddr}
                  </span>
                  {(trader as any).verifiedBadge && (
                    <BadgeCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                  )}
                </div>
                {trader.name && (
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{shortAddr}</div>
                )}
              </div>
              <div className="text-right shrink-0">
                <PnlBadge pnl={trader.pnl} />
                <div className="text-[10px] text-muted-foreground mt-0.5">all-time PNL</div>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <RoiPill roi={trader.roi} />
              {(trader as any).positionCount > 0 && (
                <span className="text-[10px] text-muted-foreground">{(trader as any).positionCount.toLocaleString()} positions tracked</span>
              )}
              {(trader as any).qualityScore !== undefined && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                  (trader as any).qualityScore >= 70
                    ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
                    : (trader as any).qualityScore >= 40
                    ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/20"
                    : "bg-muted text-muted-foreground border-border"
                }`}>
                  Quality {(trader as any).qualityScore}/100
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 mt-3">
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">Volume</div>
                <div className="text-xs font-semibold">
                  {trader.volume >= 1_000_000
                    ? `$${(trader.volume / 1_000_000).toFixed(1)}M`
                    : trader.volume >= 1000
                    ? `$${(trader.volume / 1000).toFixed(1)}K`
                    : `$${trader.volume.toFixed(0)}`}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">ROI</div>
                <div className={`text-xs font-semibold ${trader.roi >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                  {trader.roi >= 0 ? "+" : ""}{trader.roi.toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-0.5">Positions</div>
                <div className="text-xs font-semibold">{(trader as any).positionCount || "—"}</div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-2.5 pt-2.5 border-t border-border/50">
              {xLink && (
                <a
                  href={xLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  data-testid={`link-trader-x-${trader.rank}`}
                >
                  @{(trader as any).xUsername}
                </a>
              )}
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
  const [sort, setSort] = useState("rank");
  const [period, setPeriod] = useState("ALL");

  const { data, isLoading, error, refetch } = useQuery<LeaderboardResponse>({
    queryKey: ["/api/traders", period],
    queryFn: () => fetch(`/api/traders?period=${period}`).then(r => r.json()),
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
      if (sort === "rank") return a.rank - b.rank;
      if (sort === "pnl") return b.pnl - a.pnl;
      if (sort === "roi") return b.roi - a.roi;
      if (sort === "volume") return b.volume - a.volume;
      return 0;
    });

  const totalPnl = traders.reduce((s, t) => s + t.pnl, 0);
  const totalVolume = traders.reduce((s, t) => s + t.volume, 0);
  const avgROI = traders.length > 0 ? traders.reduce((s, t) => s + t.roi, 0) / traders.length : 0;

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
            Elite traders from Polymarket's official leaderboard, ranked by PNL
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={v => { setPeriod(v); }}>
            <SelectTrigger className="w-28 h-8 text-sm" data-testid="select-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Time</SelectItem>
              <SelectItem value="MONTH">This Month</SelectItem>
              <SelectItem value="WEEK">This Week</SelectItem>
            </SelectContent>
          </Select>
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
      </div>

      {!isLoading && traders.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-[10px] text-muted-foreground mb-1">Total PNL (Top Traders)</div>
              <div className="text-lg font-bold text-green-600 dark:text-green-400">
                +{totalPnl >= 1_000_000
                  ? `$${(totalPnl / 1_000_000).toFixed(1)}M`
                  : `$${(totalPnl / 1000).toFixed(0)}K`}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-[10px] text-muted-foreground mb-1">Total Volume</div>
              <div className="text-lg font-bold">
                {totalVolume >= 1_000_000
                  ? `$${(totalVolume / 1_000_000).toFixed(0)}M`
                  : `$${(totalVolume / 1000).toFixed(0)}K`}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-[10px] text-muted-foreground mb-1">Avg ROI</div>
              <div className={`text-lg font-bold ${avgROI >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                {avgROI >= 0 ? "+" : ""}{avgROI.toFixed(1)}%
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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
            <SelectItem value="rank">Rank</SelectItem>
            <SelectItem value="pnl">PNL</SelectItem>
            <SelectItem value="roi">ROI %</SelectItem>
            <SelectItem value="volume">Volume</SelectItem>
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
                    <div className="grid grid-cols-2 gap-2">
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
                  ? "Loading from the Polymarket official leaderboard..."
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

      {!isLoading && data && (
        <div className="text-center text-[11px] text-muted-foreground pt-2">
          Source: Polymarket official leaderboard ({data.window}) — updated every 10 min
        </div>
      )}
    </div>
  );
}
