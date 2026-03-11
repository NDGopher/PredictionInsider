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
  Users, Search, RefreshCw, AlertCircle, ExternalLink, BadgeCheck,
  TrendingUp, Trophy, Star, BarChart3, ChevronRight
} from "lucide-react";
import type { LeaderboardResponse, Trader } from "@shared/schema";

function fmtPnl(n: number) {
  const abs = Math.abs(n);
  const str = abs >= 1_000_000
    ? `$${(abs / 1_000_000).toFixed(2)}M`
    : abs >= 1000
    ? `$${(abs / 1000).toFixed(1)}K`
    : `$${abs.toFixed(0)}`;
  return (n >= 0 ? "+" : "-") + str;
}

function fmtVol(n: number) {
  return n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
    ? `$${(n / 1000).toFixed(0)}K`
    : `$${n.toFixed(0)}`;
}

type TierKey = "elite" | "pro" | "active";

const TIER_CONFIG: Record<TierKey, { label: string; cls: string; icon: React.ReactNode }> = {
  elite: {
    label: "Elite",
    cls: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
    icon: <Trophy className="w-3 h-3" />,
  },
  pro: {
    label: "Pro",
    cls: "bg-primary/15 text-primary border-primary/30",
    icon: <Star className="w-3 h-3" />,
  },
  active: {
    label: "Active",
    cls: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
    icon: <TrendingUp className="w-3 h-3" />,
  },
};

function TierBadge({ tier }: { tier?: string }) {
  const cfg = TIER_CONFIG[(tier as TierKey) ?? "active"] ?? TIER_CONFIG.active;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${cfg.cls}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-sm font-black text-yellow-500">#1</span>;
  if (rank === 2) return <span className="text-sm font-black text-slate-400">#2</span>;
  if (rank === 3) return <span className="text-sm font-black text-amber-600">#3</span>;
  return <span className="text-xs text-muted-foreground tabular-nums font-medium">#{rank}</span>;
}

function Avatar({ name, tier }: { name: string; tier?: string }) {
  const bg =
    tier === "elite" ? "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400"
    : tier === "pro"  ? "bg-primary/15 text-primary"
    : "bg-muted text-muted-foreground";
  return (
    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold text-sm border ${bg}`}>
      {(name || "?").slice(0, 2).toUpperCase()}
    </div>
  );
}

function RecentFormBadge({ form }: { form?: string }) {
  if (!form || form === "all-time") return null;
  const isHot = form.includes("Hot");
  const isWeek = form.includes("week");
  const isCurated = form.includes("Curated");
  const isDiscovered = form.includes("Discovered");
  if (isCurated) return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded border bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25" data-testid="badge-recent-form">
      {form}
    </span>
  );
  if (isDiscovered) return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded border bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25" data-testid="badge-recent-form">
      {form}
    </span>
  );
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded border ${
        isHot
          ? "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25"
          : isWeek
          ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/25"
          : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
      }`}
      title="Recency form"
      data-testid="badge-recent-form"
    >
      {form}
    </span>
  );
}

function TraderCard({ trader, rank }: { trader: Trader; rank: number }) {
  const tier = (trader as any).tier as TierKey | undefined;
  const recentForm = (trader as any).recentForm as string | undefined;
  const addr = trader.address;
  const shortAddr = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
  const polyLink = `https://polymarket.com/profile/${addr}`;
  const analyticsLink = (trader as any).polyAnalyticsUrl || `https://polymarketanalytics.com/traders/${addr}`;
  const xLink = trader.xUsername ? `https://x.com/${trader.xUsername}` : null;

  const roiPositive = trader.roi >= 0;

  return (
    <Card
      className="hover-elevate transition-all"
      data-testid={`trader-card-${rank}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Avatar name={trader.name || shortAddr} tier={tier} />

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-1.5 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <RankBadge rank={rank} />
                  <span
                    className="text-sm font-bold truncate max-w-[140px]"
                    data-testid={`trader-name-${rank}`}
                    title={trader.name || shortAddr}
                  >
                    {trader.name || shortAddr}
                  </span>
                  {trader.verifiedBadge && (
                    <BadgeCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                  )}
                  <TierBadge tier={tier} />
                  <RecentFormBadge form={recentForm} />
                </div>
                <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{shortAddr}</div>
              </div>

              <div className="text-right shrink-0">
                <div
                  className={`text-base font-black tabular-nums ${trader.pnl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}
                  data-testid={`trader-pnl-${rank}`}
                >
                  {fmtPnl(trader.pnl)}
                </div>
                {(trader as any).pnlSource === "closed_positions_api" ? (
                  <div className="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center justify-end gap-0.5">
                    ✓ Verified
                  </div>
                ) : (
                  <div className="text-[9px] text-muted-foreground">total PNL</div>
                )}
              </div>
            </div>

            {(trader as any).realizedPNL != null && (
              <div className="grid grid-cols-2 gap-1.5 mt-2.5 p-2 bg-muted/30 rounded-md border border-border/40">
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Realized</div>
                  <div className={`text-xs font-bold tabular-nums ${(trader as any).realizedPNL >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}
                    data-testid={`trader-realized-pnl-${rank}`}>
                    {fmtPnl((trader as any).realizedPNL)}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wide">Unrealized</div>
                  <div className={`text-xs font-bold tabular-nums ${(trader as any).unrealizedPNL >= 0 ? "text-green-600 dark:text-green-400" : "text-amber-500"}`}
                    data-testid={`trader-unrealized-pnl-${rank}`}>
                    {fmtPnl((trader as any).unrealizedPNL)}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mt-2.5">
              <div className="bg-muted/40 rounded-md px-2.5 py-1.5">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">ROI</div>
                {trader.volume > 0 ? (
                  <div className={`text-sm font-bold tabular-nums ${roiPositive ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                    {roiPositive ? "+" : ""}{trader.roi.toFixed(1)}%
                  </div>
                ) : (
                  <div className="text-sm font-bold text-muted-foreground">N/A</div>
                )}
              </div>
              <div className="bg-muted/40 rounded-md px-2.5 py-1.5">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Volume</div>
                <div className="text-sm font-bold">{trader.volume > 0 ? fmtVol(trader.volume) : "—"}</div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border/50">
              <div className="flex items-center gap-2">
                {xLink && (
                  <a
                    href={xLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    data-testid={`link-trader-x-${rank}`}
                  >
                    @{trader.xUsername}
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <a
                  href={polyLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors border border-border rounded px-2 py-0.5"
                  data-testid={`link-trader-profile-${rank}`}
                  title="View on Polymarket"
                >
                  Polymarket <ExternalLink className="w-2.5 h-2.5" />
                </a>
                <a
                  href={analyticsLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] bg-primary text-primary-foreground rounded px-2 py-0.5 font-medium hover:opacity-90 transition-opacity"
                  data-testid={`link-trader-analytics-${rank}`}
                  title="View full stats on Polymarket Analytics"
                >
                  Full Stats <ChevronRight className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const SORT_OPTIONS = [
  { value: "rank",     label: "Sports Rank" },
  { value: "pnl",     label: "Total PNL" },
  { value: "realized", label: "Realized PNL" },
  { value: "roi",     label: "ROI %" },
  { value: "volume",  label: "Volume" },
];

const TIER_FILTER_OPTIONS = [
  { value: "all",    label: "All Tiers" },
  { value: "elite",  label: "Elite ($100K+)" },
  { value: "pro",    label: "Pro ($30K+)" },
  { value: "active", label: "Active" },
  { value: "hot",    label: "🔥 Hot This Week" },
];

export default function Traders() {
  const [search, setSearch]         = useState("");
  const [sort, setSort]             = useState("rank");
  const [category, setCategory]     = useState<"sports" | "all">("sports");
  const [tierFilter, setTierFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "sports_lb" | "curated" | "discovered">("all");

  const { data, isLoading, error, refetch } = useQuery<LeaderboardResponse>({
    queryKey: ["/api/traders", category],
    queryFn: () => fetch(`/api/traders?category=${category}&limit=300`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const traders = data?.traders || [];

  const filtered = traders
    .filter(t => {
      if (tierFilter === "hot") {
        const rf = (t as any).recentForm as string | undefined;
        if (!rf || rf === "all-time") return false;
      } else if (tierFilter !== "all" && (t as any).tier !== tierFilter) return false;
      if (sourceFilter !== "all") {
        const src = (t as any).source as string | undefined;
        if (sourceFilter === "curated" && src !== "curated") return false;
        if (sourceFilter === "discovered" && src !== "discovered") return false;
        if (sourceFilter === "sports_lb" && src !== "sports_lb") return false;
      }
      if (!search) return true;
      const q = search.toLowerCase();
      return (t.address || "").toLowerCase().includes(q) || (t.name || "").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (sort === "rank")     return a.rank - b.rank;
      if (sort === "pnl")      return b.pnl - a.pnl;
      if (sort === "realized") return ((b as any).realizedPNL ?? b.pnl) - ((a as any).realizedPNL ?? a.pnl);
      if (sort === "roi")      return b.roi - a.roi;
      if (sort === "volume")   return b.volume - a.volume;
      return 0;
    });

  const totalPnl    = traders.reduce((s, t) => s + t.pnl, 0);
  const totalRealized = traders.reduce((s, t) => s + ((t as any).realizedPNL ?? 0), 0);
  const totalVol    = traders.reduce((s, t) => s + t.volume, 0);
  const avgRoi      = traders.length > 0 ? traders.reduce((s, t) => s + t.roi, 0) / traders.length : 0;
  const eliteCount  = traders.filter(t => (t as any).tier === "elite").length;
  const proCount    = traders.filter(t => (t as any).tier === "pro").length;
  const canonicalCount = traders.filter(t => (t as any).pnlSource === "closed_positions_api").length;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold tracking-tight">
              {category === "sports" ? "Sports Traders" : "Top Traders"}
            </h1>
            {!isLoading && (
              <Badge variant="secondary" data-testid="badge-trader-count">{filtered.length}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {category === "sports"
              ? "Ranked by recency-weighted quality score — recent hot streaks boosted"
              : "Overall leaderboard ranked by PNL"}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-md border border-border overflow-hidden text-sm">
            <button
              onClick={() => setCategory("sports")}
              className={`px-3 py-1.5 transition-colors ${category === "sports" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
              data-testid="button-category-sports"
            >
              Sports
            </button>
            <button
              onClick={() => setCategory("all")}
              className={`px-3 py-1.5 transition-colors ${category === "all" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
              data-testid="button-category-all"
            >
              All Markets
            </button>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            data-testid="button-refresh-traders"
            className="gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {!isLoading && traders.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Total PNL</div>
              <div className={`text-lg font-black ${totalPnl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`} data-testid="stat-total-pnl">
                {fmtPnl(totalPnl)}
              </div>
              {canonicalCount > 0 && (
                <div className="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">
                  ✓ {canonicalCount}/42 verified
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Realized PNL</div>
              <div className={`text-lg font-black ${totalRealized >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`} data-testid="stat-total-realized">
                {fmtPnl(totalRealized)}
              </div>
              <div className="text-[9px] text-muted-foreground mt-0.5">locked profits</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Avg ROI</div>
              <div className={`text-lg font-black ${avgRoi >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                {avgRoi >= 0 ? "+" : ""}{avgRoi.toFixed(1)}%
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 px-4">
              <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Tiers</div>
              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                <span className="text-[11px] font-bold text-yellow-600">{eliteCount} Elite</span>
                <span className="text-muted-foreground text-[10px]">·</span>
                <span className="text-[11px] font-bold text-primary">{proCount} Pro</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Source filter pills */}
      {!isLoading && traders.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {(["all", "sports_lb", "curated", "discovered"] as const).map(src => {
            const count = src === "all" ? traders.length
              : traders.filter(t => (t as any).source === src).length;
            const labels: Record<typeof src, string> = {
              all: "All Sources",
              sports_lb: "Sports LB",
              curated: "📌 Curated",
              discovered: "🔍 Discovered",
            };
            if (count === 0 && src !== "all") return null;
            return (
              <button
                key={src}
                onClick={() => setSourceFilter(src)}
                data-testid={`button-source-filter-${src}`}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
                  sourceFilter === src
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                }`}
              >
                {labels[src]}
                {count > 0 && (
                  <span className={`ml-0.5 px-1 rounded text-[10px] font-bold ${
                    sourceFilter === src ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background text-muted-foreground"
                  }`}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search name or address..."
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-traders"
          />
        </div>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-tier-filter">
            <SelectValue placeholder="Filter tier" />
          </SelectTrigger>
          <SelectContent>
            {TIER_FILTER_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-32 h-8 text-sm" data-testid="select-sort-traders">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-1/2 mb-2" />
                    <Skeleton className="h-3 w-3/4 mb-3" />
                    <div className="grid grid-cols-2 gap-2">
                      <Skeleton className="h-12" />
                      <Skeleton className="h-12" />
                    </div>
                    <Skeleton className="h-7 mt-3" />
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
              <div className="font-semibold">Failed to load traders</div>
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
              <div className="font-semibold">
                {traders.length === 0 ? "No trader data" : "No traders match your filters"}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {traders.length === 0
                  ? "Fetching from Polymarket sports leaderboard..."
                  : "Try adjusting your search or tier filter."}
              </div>
            </div>
            {tierFilter !== "all" && (
              <Button variant="outline" size="sm" onClick={() => setTierFilter("all")}>
                Clear Filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((trader, idx) => (
            <TraderCard key={trader.address} trader={trader} rank={idx + 1} />
          ))}
        </div>
      )}

      {!isLoading && data && (
        <div className="flex flex-col items-center gap-1.5 pt-2">
          <div className="flex items-center gap-3">
            <div className="text-center text-[11px] text-muted-foreground">
              {traders.length} traders · Unified pool: Leaderboard + Curated + Discovered — 5 min cache
            </div>
            <a
              href="https://polymarketanalytics.com/traders"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              data-testid="link-polymarketanalytics"
            >
              <BarChart3 className="w-3 h-3" />
              Polymarket Analytics
            </a>
          </div>
          {(data as any).breakdown && (
            <div className="flex items-center gap-3 flex-wrap justify-center">
              {Object.entries((data as any).breakdown as Record<string, number>).map(([src, cnt]) => (
                <span key={src} className="text-[10px] text-muted-foreground">
                  <span className="font-medium text-foreground/70">{src.replace("_", " ")}</span>: {cnt as number}
                </span>
              ))}
              {(data as any).sharedMapAge && (
                <span className="text-[10px] text-muted-foreground">· signal pool: {(data as any).sharedMapAge}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
