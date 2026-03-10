import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";
import {
  Zap, Users, BarChart3, TrendingUp, TrendingDown, ArrowRight,
  Activity, Target, AlertCircle, RefreshCw, ExternalLink
} from "lucide-react";
import type { SignalsResponse, LeaderboardResponse, MarketsResponse, Signal } from "@shared/schema";

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

function SignalRow({ signal }: { signal: Signal }) {
  const [, nav] = useLocation();
  const outcomeLabel = (signal as any).outcomeLabel || getOutcomeLabel(signal.marketQuestion, signal.side as "YES" | "NO");
  const polyUrl = (signal as any).slug
    ? `https://polymarket.com/market/${(signal as any).slug}`
    : null;

  const handleClick = () => {
    if (polyUrl) { window.open(polyUrl, "_blank", "noopener,noreferrer"); }
    else { nav("/signals"); }
  };

  const outcomeColor = signal.side === "YES"
    ? "text-green-600 dark:text-green-400"
    : "text-red-500 dark:text-red-400";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={e => e.key === "Enter" && handleClick()}
      className="flex items-center gap-3 py-2.5 px-3 rounded-md hover-elevate cursor-pointer border border-transparent hover:border-border"
      data-testid={`signal-row-${signal.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{signal.marketQuestion}</span>
          {signal.isValue && (
            <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4 shrink-0">VALUE</Badge>
          )}
          {polyUrl && <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          <span className={`text-xs font-semibold ${outcomeColor}`}>
            {outcomeLabel}
          </span>
          <span className="text-xs text-muted-foreground">@ {(signal.currentPrice * 100).toFixed(1)}¢</span>
          <span className="text-xs text-muted-foreground">{signal.traderCount} traders</span>
        </div>
      </div>
      <ConfidenceBadge score={signal.confidence} />
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
  const { data: signalsData, isLoading: signalsLoading, error: signalsError, refetch: refetchSignals } =
    useQuery<SignalsResponse>({ queryKey: ["/api/signals"], staleTime: 3 * 60 * 1000 });

  const { data: tradersData, isLoading: tradersLoading } =
    useQuery<LeaderboardResponse>({ queryKey: ["/api/traders"], staleTime: 5 * 60 * 1000 });

  const { data: marketsData, isLoading: marketsLoading } =
    useQuery<MarketsResponse>({ queryKey: ["/api/markets"], staleTime: 3 * 60 * 1000 });

  const signals = signalsData?.signals || [];
  const topSignals = signals.slice(0, 6);
  const highConfidence = signals.filter(s => s.confidence >= 70);
  const valueSignals = signals.filter(s => s.isValue);
  const traders = tradersData?.traders || [];

  const loading = signalsLoading || tradersLoading || marketsLoading;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Sports prediction market intelligence from top Polymarket traders
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
              value={signalsLoading ? "—" : String(signals.length)}
              sub={`${highConfidence.length} high confidence`}
              color="bg-primary/10 text-primary"
            />
            <StatCard
              icon={Target}
              label="Value Signals"
              value={signalsLoading ? "—" : String(valueSignals.length)}
              sub="Current price beats entry"
              color="bg-green-500/10 text-green-600 dark:text-green-400"
            />
            <StatCard
              icon={Users}
              label="Top Traders"
              value={tradersLoading ? "—" : String(traders.length)}
              sub="Filtered by PNL & ROI"
              color="bg-blue-500/10 text-blue-600 dark:text-blue-400"
            />
            <StatCard
              icon={BarChart3}
              label="Markets Scanned"
              value={signalsLoading ? "—" : String(signalsData?.marketsScanned || marketsData?.total || 0)}
              sub="Active sports markets"
              color="bg-purple-500/10 text-purple-600 dark:text-purple-400"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top Signals */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Top Signals</h2>
            <Link href="/signals">
              <Button size="sm" variant="ghost" className="gap-1.5 h-7 text-xs" data-testid="link-all-signals">
                View all <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>

          <Card>
            <CardContent className="p-2">
              {signalsLoading ? (
                <div className="space-y-1">
                  {Array.from({ length: 5 }).map((_, i) => (
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
                    <div className="font-medium text-sm">No signals generated yet</div>
                    <div className="text-xs text-muted-foreground mt-1 max-w-xs">
                      Signals appear when 2+ top traders share a consensus position on sports markets.
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
                title: "Identify Top Traders",
                desc: "We scan Polymarket's public leaderboard and filter for traders with strong PNL, high ROI, and meaningful trade volume.",
              },
              {
                icon: Activity,
                title: "Find Consensus",
                desc: "When 50%+ of top traders share the same position on a sports market, we flag it as a consensus signal worth watching.",
              },
              {
                icon: Target,
                title: "Detect Value",
                desc: "We compare current market prices to the average entry price of top traders to surface opportunities where value may remain.",
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
