import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Star, AlertTriangle, CheckCircle, Clock, RefreshCw, Download,
  TrendingUp, TrendingDown, ChevronDown, ChevronUp, Plus, ExternalLink,
  BarChart2, Target, DollarSign, Users, Activity, Award, Settings
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, Cell } from "recharts";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EliteTrader {
  wallet: string;
  username: string;
  added_at: string;
  last_analyzed_at: string | null;
  wallet_resolved: boolean;
  polymarket_url: string | null;
  notes: string | null;
  quality_score: number | null;
  tags: string[] | null;
  computed_at: string | null;
  total_trades: string | null;
  overall_roi: string | null;
  last90d_roi: string | null;
  win_rate: string | null;
  sharpe_score: string | null;
  avg_bet_size: string | null;
  /** Median USDC deployed per market (condition) — best “typical size” for tailing */
  median_market_stake: string | null;
  markets_traded: string | null;
  trades_per_day: string | null;
  top_sport: string | null;
  top_market_type: string | null;
  consistency_rating: string | null;
  overall_pnl: string | null;
  total_usdc: string | null;
  csv_tier: string | null;
  csv_quality_score: string | null;
  csv_tail_guide: string | null;
}

interface TraderMetrics {
  totalUSDC: number;
  totalTrades: number;
  settledTrades: number;
  avgBetSize: number;
  medianBetSize: number;
  betSizeCV: number;
  firstTradeDate: string;
  lastTradeDate: string;
  accountAgeDays: number;
  tradesPerDay: number;
  avgTradesPerWeek: number;
  overallROI: number;
  overallPNL: number;
  realizedPNL?: number;
  unrealizedPNL?: number;
  activeUnrealizedPNL?: number;
  closedPositionCount?: number;
  openPositionCount?: number;
  activeOpenCount?: number;
  redeemableCount?: number;
  redeemableValue?: number;
  totalInvested?: number;
  /** Canonical: return on total invested (percent). Prefer over legacy `roiCapital` (USD from CSV ingest). */
  capitalRoiPercent?: number;
  roiCapital?: number;
  pnlWinRate?: number;
  pnlSource?: string;
  pnlUpdatedAt?: string;
  winRate30?: number;
  winRate90?: number;
  last30dPNL?: number;
  last90dPNL?: number;
  closedByCategory?: Record<string, { pnl: number; positions: number; wins: number; invested: number }>;
  winRate: number;
  last30dROI: number;
  last90dROI: number;
  bigBetROI: number;
  smallBetROI: number;
  sharpeScore: number;
  consistencyRating: string;
  maxConsecLosingMonths: number;
  monthlyROI: { month: string; roi: number; pnl: number; tradeCount: number }[];
  roiBySport: Record<string, { roi: number; tradeCount: number; pnl: number; winRate: number; avgBet: number }>;
  topSport: string;
  roiByMarketType: Record<string, { roi: number; tradeCount: number; winRate: number; avgBet: number }>;
  topMarketType: string;
  sportDistribution: Record<string, number>;
  avgBetBySport: Record<string, number>;
  sizingInsights: string[];
  yesROI: number;
  noROI: number;
  yesTradeCount: number;
  noTradeCount: number;
  preferredSide: string;
  longshotROI: number;
  longshotCount: number;
  midrangeROI: number;
  midrangeCount: number;
  guaranteeROI: number;
  guaranteeCount: number;
  bestBets?: {
    title: string; slug: string; sport: string; marketType: string;
    side: string; price: number; size: number; pnl: number; date: string;
  }[];
  bestBetsDB?: {
    title: string; slug: string; sport: string; marketType: string;
    side: string; price: number; size: number; pnl: number; date: string;
  }[];
  // ── New intelligence metrics ──
  quantScore?: number;
  traderArchetype?: string;
  csvPseudoSharpe?: number;
  uniqueMarketsDB?: number;
  tradesBuyCount?: number;
  settledTradesDB?: number;
  monthlyVolume?: { month: string; volume: number }[];
  archetypeSignal?: {
    tradesPerDay: number; avgBetSize: number; avgPrice: number;
    longshotPct: number; yesBuyPct: number; uniqueMarkets: number;
  };
}

// ─── Format helpers ────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, suffix = ""): string {
  if (v == null || isNaN(v)) return "—";
  return v.toFixed(1) + suffix;
}

function fmtUSDC(v: number | null | undefined): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

function fmtROI(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
}

function qualityColor(q: number | null): string {
  if (!q) return "text-muted-foreground";
  if (q >= 70) return "text-green-500";
  if (q >= 45) return "text-yellow-500";
  return "text-red-500";
}

function qualityBg(q: number | null): string {
  if (!q) return "bg-muted";
  if (q >= 70) return "bg-green-500/10 border-green-500/30";
  if (q >= 45) return "bg-yellow-500/10 border-yellow-500/30";
  return "bg-red-500/10 border-red-500/30";
}

function roiColor(v: number): string {
  return v >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500";
}

function archetypeIcon(archetype: string): string {
  const icons: Record<string, string> = {
    "Information Trader": "🔬",
    "Sharp Scalper": "⚡",
    "Whale": "🐋",
    "Long-Shot Hunter": "🎯",
    "Momentum Trader": "🚀",
    "Market Maker": "⚖️",
    "Diversified Grinder": "🔄",
    "Balanced Trader": "📊",
  };
  return icons[archetype] || "📊";
}

// ─── Add Trader Form ──────────────────────────────────────────────────────────

function AddTraderForm({ onAdded }: { onAdded: () => void }) {
  const [input, setInput] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (body: { url?: string; wallet?: string; username?: string }) =>
      apiRequest("POST", "/api/elite/traders", body),
    onSuccess: (data: any) => {
      toast({
        title: data.resolved ? "Trader added!" : "Trader added — wallet pending",
        description: data.message,
      });
      setInput("");
      qc.invalidateQueries({ queryKey: ["/api/elite/traders"] });
      onAdded();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = () => {
    const val = input.trim();
    if (!val) return;
    if (val.startsWith("http")) mutation.mutate({ url: val });
    else if (/^0x[a-fA-F0-9]{40}$/.test(val)) mutation.mutate({ wallet: val });
    else mutation.mutate({ username: val });
  };

  return (
    <div className="flex gap-2 items-center">
      <Input
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="Paste Polymarket URL, wallet address, or username..."
        className="flex-1 text-sm"
        onKeyDown={e => e.key === "Enter" && handleSubmit()}
        data-testid="input-add-trader"
      />
      <Button onClick={handleSubmit} disabled={mutation.isPending || !input.trim()} size="sm" data-testid="button-add-trader">
        {mutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        Add
      </Button>
    </div>
  );
}

// ─── Wallet Resolver ──────────────────────────────────────────────────────────

function WalletResolver({ trader, onResolved }: { trader: EliteTrader; onResolved: () => void }) {
  const [wallet, setWallet] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (newWallet: string) =>
      apiRequest("PATCH", `/api/elite/traders/${encodeURIComponent(trader.wallet)}`, { newWallet, username: trader.username }),
    onSuccess: () => {
      toast({ title: "Wallet set!", description: "Analysis starting in background." });
      qc.invalidateQueries({ queryKey: ["/api/elite/traders"] });
      onResolved();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="mt-2 p-2 rounded-md bg-yellow-500/10 border border-yellow-500/30">
      <div className="text-xs text-yellow-600 dark:text-yellow-400 font-medium mb-1.5 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" /> Wallet not found — enter manually
      </div>
      <div className="flex gap-1.5">
        <Input
          value={wallet}
          onChange={e => setWallet(e.target.value)}
          placeholder="0x..."
          className="flex-1 text-xs h-7"
          data-testid={`input-wallet-${trader.username}`}
        />
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() => mutation.mutate(wallet.trim())}
          disabled={!/^0x[a-fA-F0-9]{40}$/.test(wallet.trim()) || mutation.isPending}
          data-testid={`button-resolve-${trader.username}`}
        >Set</Button>
      </div>
    </div>
  );
}

// ─── Monthly ROI sparkline ────────────────────────────────────────────────────

function MonthlySparkline({ data }: { data: { month: string; roi: number }[] }) {
  if (!data?.length) return <div className="text-xs text-muted-foreground">No monthly data yet</div>;
  const recent = data.slice(-12);
  return (
    <ResponsiveContainer width="100%" height={60}>
      <AreaChart data={recent} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
        <XAxis dataKey="month" tick={{ fontSize: 8 }} tickFormatter={v => v.slice(5)} />
        <YAxis tick={{ fontSize: 8 }} tickFormatter={v => v.toFixed(0) + "%"} />
        <Tooltip
          formatter={(v: number) => [fmtROI(v), "Monthly ROI"]}
          labelStyle={{ fontSize: 10 }}
          contentStyle={{ fontSize: 10 }}
        />
        <Area
          type="monotone"
          dataKey="roi"
          stroke="#22c55e"
          fill="#22c55e30"
          dot={false}
          strokeWidth={1.5}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── ROI Bar Chart ─────────────────────────────────────────────────────────────

function ROIBarChart({ data, label }: { data: { name: string; roi: number; count: number }[]; label: string }) {
  if (!data?.length) return <div className="text-xs text-muted-foreground">Insufficient data</div>;
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 20 }}>
        <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" />
        <YAxis tick={{ fontSize: 9 }} tickFormatter={v => v + "%"} />
        <Tooltip
          formatter={(v: number, name: string, props: any) => [
            fmtROI(v),
            `${label} (${props.payload?.count} trades)`,
          ]}
          contentStyle={{ fontSize: 10 }}
        />
        <Bar dataKey="roi" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.roi >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.8} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Trader Deep Dive ─────────────────────────────────────────────────────────

function TraderDeepDive({ wallet, username }: { wallet: string; username: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ trader: EliteTrader; profile: any; rawTradeCount: number }>({
    queryKey: ["/api/elite/traders", wallet],
    queryFn: () => fetch(`/api/elite/traders/${wallet}`).then(r => r.json()),
    staleTime: 30_000,
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/elite/traders/${wallet}/refresh`, {}),
    onSuccess: () => {
      toast({ title: "Refresh started", description: "Analysis running in background (~60s)" });
      qc.invalidateQueries({ queryKey: ["/api/elite/traders", wallet] });
      qc.invalidateQueries({ queryKey: ["/api/elite/traders"] });
    },
  });

  if (isLoading) return (
    <div className="space-y-3 p-4">
      {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
    </div>
  );

  const m: TraderMetrics | null = data?.profile?.metrics || null;
  const trader = data?.trader;
  const qs = data?.profile?.quality_score ?? null;
  const tags: string[] = data?.profile?.tags || [];

  const sportData = m
    ? Object.entries(m.roiBySport || {}).map(([name, v]) => ({ name, roi: v.roi, count: v.tradeCount })).sort((a, b) => b.roi - a.roi)
    : [];
  const mtData = m
    ? Object.entries(m.roiByMarketType || {}).map(([name, v]) => ({ name, roi: v.roi, count: v.tradeCount })).sort((a, b) => b.roi - a.roi)
    : [];

  const isAnalyzing = trader && !data?.profile && trader.wallet_resolved;

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold">{username}</h2>
            {qs != null && (
              <div className="flex items-center gap-1.5">
                <div className={`text-2xl font-bold tabular-nums ${qualityColor(qs)}`} data-testid={`quality-score-${wallet}`}>
                  {qs}
                </div>
                <div className="text-[9px] text-muted-foreground leading-tight">
                  <div>Quant</div><div>Score</div>
                </div>
              </div>
            )}
            {m?.traderArchetype && (
              <Badge className="text-[10px] px-2 py-0.5 bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30 border">
                {archetypeIcon(m.traderArchetype)} {m.traderArchetype}
              </Badge>
            )}
          </div>
          {m && (
            <div className="text-xs text-muted-foreground mt-0.5">
              Active {m.accountAgeDays} days · {fmt(m.tradesPerDay)} trades/day · First trade {new Date(m.firstTradeDate).toLocaleDateString()}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map(tag => (
              <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {trader?.polymarket_url && (
            <a href={trader.polymarket_url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                <ExternalLink className="w-3 h-3" /> Profile
              </Button>
            </a>
          )}
          <a href={`/api/elite/traders/${wallet}/csv`} download>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid={`button-csv-${wallet}`}>
              <Download className="w-3 h-3" /> CSV
            </Button>
          </a>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            data-testid={`button-refresh-${wallet}`}
          >
            <RefreshCw className={`w-3 h-3 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Wallet unresolved state */}
      {!trader?.wallet_resolved && (
        <WalletResolver trader={trader!} onResolved={() => qc.invalidateQueries({ queryKey: ["/api/elite/traders"] })} />
      )}

      {/* Still analyzing */}
      {isAnalyzing && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 text-sm text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Analysis in progress — fetching full trade history and computing metrics...
        </div>
      )}

      {m && (
        <>
          {/* Key stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            {[
              { label: "Total USDC", value: fmtUSDC(m.totalUSDC), icon: DollarSign },
              { label: "Avg Bet", value: fmtUSDC(m.avgBetSize), icon: Target },
              { label: "PA ROI", value: fmtROI(m.overallROI), icon: TrendingUp, color: roiColor(m.overallROI) },
              {
                label: "Capital ROI",
                value: fmtROI(
                  m.capitalRoiPercent ??
                    (m.totalInvested && m.totalInvested > 0 && m.realizedPNL != null
                      ? (m.realizedPNL / m.totalInvested) * 100
                      : null),
                ),
                icon: TrendingUp,
                color: roiColor(
                  m.capitalRoiPercent ??
                    (m.totalInvested && m.totalInvested > 0 && m.realizedPNL != null
                      ? (m.realizedPNL / m.totalInvested) * 100
                      : 0),
                ),
              },
              { label: "Win Rate", value: fmt(m.winRate, "%"), icon: Award },
              {
                label: "Sharpe",
                value: m.csvPseudoSharpe != null ? m.csvPseudoSharpe.toFixed(2) : "—",
                icon: Activity,
                color: m.csvPseudoSharpe != null && m.csvPseudoSharpe >= 1 ? "text-green-600 dark:text-green-400" : "",
              },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-muted/40 rounded-lg p-2.5 border border-border/40">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                  <Icon className="w-2.5 h-2.5" /> {label}
                </div>
                <div className={`text-sm font-bold ${color || ""}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* PNL breakdown — Polymarket verified when available, else CSV/computed */}
          {(m.realizedPNL != null) ? (
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total PNL</span>
                {m.pnlSource === "closed_positions_api" && (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-green-500/40 text-green-600 dark:text-green-400">
                    ✓ Polymarket Verified
                  </Badge>
                )}
              </div>
              <div className={`text-2xl font-bold ${roiColor(m.overallPNL)}`}>{fmtUSDC(m.overallPNL)}</div>
              <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/30">
                <div>
                  <div className="text-[9px] text-muted-foreground">Realized</div>
                  <div className={`text-xs font-bold ${roiColor(m.realizedPNL)}`}>{fmtUSDC(m.realizedPNL)}</div>
                  <div className="text-[9px] text-muted-foreground">{m.closedPositionCount ?? 0} closed</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground">
                    {m.activeUnrealizedPNL != null ? "Active P&L" : "Open P&L"}
                  </div>
                  <div className={`text-xs font-bold ${roiColor(m.activeUnrealizedPNL ?? m.unrealizedPNL ?? 0)}`}>
                    {fmtUSDC(m.activeUnrealizedPNL ?? m.unrealizedPNL ?? 0)}
                  </div>
                  <div className="text-[9px] text-muted-foreground">
                    {m.activeOpenCount != null
                      ? `${m.activeOpenCount} live`
                      : `${m.openPositionCount ?? 0} open`}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground">Win Rate</div>
                  <div className={`text-xs font-bold ${(m.pnlWinRate ?? 0) >= 50 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                    {m.pnlWinRate != null ? `${m.pnlWinRate.toFixed(1)}%` : "—"}
                  </div>
                  <div className="text-[9px] text-muted-foreground">of closed</div>
                </div>
              </div>
              {(m.redeemableCount ?? 0) > 0 && (
                <div className="pt-1.5 border-t border-border/30 flex items-center justify-between">
                  <div className="text-[9px] text-muted-foreground">
                    <span className="text-amber-600 dark:text-amber-400 font-medium">{m.redeemableCount} redeemable</span>
                    {" · "}
                    <span className="text-green-600 dark:text-green-400 font-medium">
                      {fmtUSDC(m.redeemableValue ?? 0)} claimable
                    </span>
                  </div>
                  {m.totalInvested != null && m.totalInvested > 0 && (
                    <div className="text-[9px] text-muted-foreground">
                      {fmtUSDC(m.totalInvested)} invested
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Last 30d ROI", value: m.last30dROI },
                { label: "Last 90d ROI", value: m.last90dROI },
                { label: "Total PNL", value: m.overallPNL },
              ].map(({ label, value }) => (
                <div key={label} className="bg-muted/30 rounded-md p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">{label}</div>
                  <div className={`text-sm font-bold ${roiColor(value)}`}>
                    {label.includes("PNL") ? fmtUSDC(value) : fmtROI(value)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ROI context (always shown) */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Last 30d ROI", value: m.last30dROI },
              { label: "Last 90d ROI", value: m.last90dROI },
            ].map(({ label, value }) => (
              <div key={label} className="bg-muted/30 rounded-md p-2 text-center">
                <div className="text-[10px] text-muted-foreground">{label}</div>
                <div className={`text-sm font-bold ${roiColor(value)}`}>{fmtROI(value)}</div>
              </div>
            ))}
          </div>

          {/* Sport + Market Type breakdown side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                <BarChart2 className="w-3 h-3" /> ROI by Sport
              </div>
              {sportData.length > 0
                ? <ROIBarChart data={sportData} label="Sport" />
                : <div className="text-xs text-muted-foreground">Need ≥5 settled trades per sport</div>}
            </div>
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                <BarChart2 className="w-3 h-3" /> ROI by Market Type
              </div>
              {mtData.length > 0
                ? <ROIBarChart data={mtData} label="Type" />
                : <div className="text-xs text-muted-foreground">Need ≥5 settled trades per type</div>}
            </div>
          </div>

          {/* Price Tier + YES/NO breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { label: "Long Shot (<25¢)", roi: m.longshotROI, count: m.longshotCount },
              { label: "Mid Range (25–75¢)", roi: m.midrangeROI, count: m.midrangeCount },
              { label: "Guarantee (>75¢)", roi: m.guaranteeROI, count: m.guaranteeCount },
              { label: "YES Bets", roi: m.yesROI, count: m.yesTradeCount },
              { label: "NO Bets", roi: m.noROI, count: m.noTradeCount },
            ].map(({ label, roi, count }) => (
              <div key={label} className="bg-muted/30 rounded-md p-2">
                <div className="text-[9px] text-muted-foreground leading-tight mb-1">{label}</div>
                <div className={`text-xs font-bold ${roiColor(roi)}`}>{fmtROI(roi)}</div>
                <div className="text-[9px] text-muted-foreground">{count} bets</div>
              </div>
            ))}
          </div>

          {/* Consistency */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
              <Activity className="w-3 h-3" /> PNL Consistency (Monthly)
            </div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <Badge variant={m.consistencyRating === "Excellent" ? "default" : "secondary"} className="text-[10px]">
                {m.consistencyRating}
              </Badge>
              {m.csvPseudoSharpe != null && (
                <span className="text-xs text-muted-foreground">Sharpe: {m.csvPseudoSharpe.toFixed(2)}</span>
              )}
              {m.maxConsecLosingMonths > 0 && (
                <span className="text-xs text-muted-foreground">Max losing streak: {m.maxConsecLosingMonths} months</span>
              )}
            </div>
            <MonthlySparkline data={m.monthlyROI} />
          </div>

          {/* Bet sizing */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
              <DollarSign className="w-3 h-3" /> Bet Sizing
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              {[
                { label: "Avg Bet", value: fmtUSDC(m.avgBetSize) },
                { label: "Median Bet", value: fmtUSDC(m.medianBetSize) },
                { label: "Big Bet ROI", value: fmtROI(m.bigBetROI) },
                { label: "Small Bet ROI", value: fmtROI(m.smallBetROI) },
              ].map(({ label, value }) => (
                <div key={label} className="bg-muted/30 rounded-md p-2">
                  <div className="text-[9px] text-muted-foreground">{label}</div>
                  <div className="text-xs font-bold">{value}</div>
                </div>
              ))}
            </div>
            {m.sizingInsights.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {m.sizingInsights.map(insight => (
                  <Badge key={insight} variant="outline" className="text-[10px]">{insight}</Badge>
                ))}
              </div>
            )}
          </div>

          {/* Best bets */}
          {((m.bestBets?.length ?? 0) > 0 || (m.bestBetsDB?.length ?? 0) > 0) && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                <Star className="w-3 h-3" /> Best Trades
              </div>
              <div className="space-y-1.5">
                {(m.bestBets ?? m.bestBetsDB ?? []).slice(0, 5).map((b, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/30 border border-border/40">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{b.title}</div>
                      <div className="text-[9px] text-muted-foreground">
                        {b.sport} · {b.side} @ {Math.round(b.price * 100)}¢ · {fmtUSDC(b.size)}
                      </div>
                    </div>
                    <div className="text-xs font-bold text-green-600 dark:text-green-400 shrink-0">
                      +{fmtUSDC(b.pnl)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Avg bet by sport */}
          {Object.keys(m.avgBetBySport || {}).length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Avg Bet by Sport</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(m.avgBetBySport)
                  .filter(([, v]) => v > 0)
                  .sort(([, a], [, b]) => b - a)
                  .map(([sport, avg]) => (
                    <div key={sport} className="bg-muted/30 rounded px-2 py-1 text-[10px]">
                      <span className="font-medium">{sport}:</span> {fmtUSDC(avg)}
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
            {m.totalTrades?.toLocaleString() ?? m.tradesBuyCount?.toLocaleString() ?? "—"} trades ({m.settledTradesDB ?? m.settledTrades ?? 0} settled in DB)
            {" · "}Last computed {data?.profile?.computed_at ? new Date(data.profile.computed_at).toLocaleString() : "—"}
            {m.pnlSource === "closed_positions_api" && (
              <span className="text-green-600 dark:text-green-400"> · ✓ Canonical PNL</span>
            )}
          </div>
        </>
      )}

      {/* No profile yet for resolved trader */}
      {!m && trader?.wallet_resolved && !isAnalyzing && (
        <div className="text-sm text-muted-foreground p-4 rounded-md bg-muted/30 text-center">
          No trade data yet. Click Refresh to start analysis.
        </div>
      )}
    </div>
  );
}

// ─── Trader Card ──────────────────────────────────────────────────────────────

function TraderCard({ trader }: { trader: EliteTrader }) {
  const [expanded, setExpanded] = useState(false);
  const [showResolver, setShowResolver] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const qs = trader.quality_score ? Math.round(parseFloat(trader.quality_score as any)) : null;

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/elite/traders/${trader.wallet}`, undefined),
    onSuccess: () => {
      toast({ title: "Trader removed" });
      qc.invalidateQueries({ queryKey: ["/api/elite/traders"] });
    },
  });

  const statusDot = trader.wallet_resolved
    ? trader.computed_at
      ? "bg-green-500"
      : "bg-yellow-500 animate-pulse"
    : "bg-red-500";

  const statusLabel = !trader.wallet_resolved
    ? "Wallet needed"
    : !trader.computed_at
      ? "Analysis pending"
      : "Analyzed";

  const overallROI = trader.overall_roi ? parseFloat(trader.overall_roi) : null;
  const winRate = trader.win_rate ? parseFloat(trader.win_rate) : null;

  return (
    <Card className={`border ${qualityBg(qs)}`} data-testid={`trader-card-${trader.wallet}`}>
      <CardContent className="p-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} title={statusLabel} />
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate flex items-center gap-1.5" data-testid={`trader-name-${trader.wallet}`}>
                {trader.username}
                {trader.wallet_resolved && !trader.wallet.startsWith("pending-") && !trader.last_analyzed_at && (
                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="No CSV / not analyzed yet" />
                )}
              </div>
              <div className="text-[10px] text-muted-foreground">{statusLabel}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {trader.csv_tier && (
              <div className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                trader.csv_tier === "S-Tier" ? "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300" :
                trader.csv_tier === "A-Tier" ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300" :
                trader.csv_tier === "B-Tier" ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300" :
                "bg-muted text-muted-foreground"
              }`}>{trader.csv_tier}</div>
            )}
            {qs != null && (
              <div className="flex flex-col items-center">
                <div className={`text-xl font-bold tabular-nums ${qualityColor(qs)}`}>{qs}</div>
                <div className="text-[8px] text-muted-foreground">QS</div>
              </div>
            )}
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid={`button-expand-${trader.wallet}`}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Tags + Archetype */}
        <div className="flex flex-wrap gap-1 mt-2">
          {(trader.tags || []).slice(0, 3).map(tag => (
            <Badge key={tag} variant="secondary" className="text-[9px] py-0">{tag}</Badge>
          ))}
        </div>

        {/* Metrics strip */}
        {(overallROI != null || winRate != null) && (
          <div className="grid grid-cols-4 gap-1.5 mt-2.5">
            {[
              {
                label: trader.csv_tier ? "CSV ROI" : "PA ROI",
                value: fmtROI(overallROI),
                color: overallROI != null ? roiColor(overallROI) : "",
              },
              {
                label: trader.csv_tier ? "Mkt win %" : "Win%",
                value: fmt(winRate, "%"),
                color: "",
              },
              { label: "Trades/d", value: trader.trades_per_day ? parseFloat(trader.trades_per_day).toFixed(1) : "—", color: "" },
              {
                label: "PNL",
                value: trader.overall_pnl ? fmtUSDC(parseFloat(trader.overall_pnl)) : "—",
                color: trader.overall_pnl ? roiColor(parseFloat(trader.overall_pnl)) : "",
              },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-muted/30 rounded p-1.5 text-center">
                <div className="text-[9px] text-muted-foreground">{label}</div>
                <div className={`text-xs font-bold ${color}`}>{value}</div>
              </div>
            ))}
          </div>
        )}
        {trader.csv_tier && (trader.median_market_stake || trader.markets_traded) && (
          <div className="text-[9px] text-muted-foreground mt-1.5 text-center leading-tight">
            {trader.median_market_stake
              ? <>Typical stake {fmtUSDC(parseFloat(trader.median_market_stake))} <span className="opacity-80">(median/market)</span></>
              : null}
            {trader.markets_traded
              ? <> · {(() => {
                  const n = Number.parseInt(trader.markets_traded!, 10);
                  return Number.isFinite(n) ? n.toLocaleString() : trader.markets_traded;
                })()} markets in book</>
              : null}
          </div>
        )}

        {/* Sport / type */}
        {(trader.top_sport || trader.top_market_type) && (
          <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
            {trader.top_sport && <span>Best sport: <span className="text-foreground font-medium">{trader.top_sport}</span></span>}
            {trader.top_market_type && <span>· Best type: <span className="text-foreground font-medium">{trader.top_market_type}</span></span>}
          </div>
        )}

        {/* Wallet pending banner */}
        {!trader.wallet_resolved && (
          <div className="mt-2">
            <button
              className="text-[10px] text-yellow-600 dark:text-yellow-400 underline"
              onClick={() => setShowResolver(r => !r)}
            >
              {showResolver ? "Hide" : "Enter wallet address"}
            </button>
            {showResolver && <WalletResolver trader={trader} onResolved={() => setShowResolver(false)} />}
          </div>
        )}

        {/* Footer: Polymarket link + CSV + Delete */}
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/30">
          {trader.polymarket_url && (
            <a href={trader.polymarket_url} target="_blank" rel="noopener noreferrer"
               className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
              <ExternalLink className="w-2.5 h-2.5" /> Polymarket
            </a>
          )}
          {trader.wallet_resolved && !trader.wallet.startsWith("pending-") && (
            <a href={`/api/elite/traders/${trader.wallet}/csv`} download
               className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
              <Download className="w-2.5 h-2.5" /> CSV
            </a>
          )}
          {trader.last_analyzed_at && (
            <span className="text-[9px] text-muted-foreground ml-auto">
              Updated {new Date(trader.last_analyzed_at).toLocaleDateString()}
            </span>
          )}
        </div>

        {/* Expanded deep dive */}
        {expanded && trader.wallet_resolved && !trader.wallet.startsWith("pending-") && (
          <div className="mt-3 pt-3 border-t border-border/40 -mx-3 px-0">
            <TraderDeepDive wallet={trader.wallet} username={trader.username} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Elite Page ──────────────────────────────────────────────────────────

export default function Elite() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [sortBy, setSortBy] = useState<"quality" | "roi" | "name">("quality");

  const { data, isLoading, error } = useQuery<{ traders: EliteTrader[]; fetchedAt: number }>({
    queryKey: ["/api/elite/traders"],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const traders = (data?.traders || []).sort((a, b) => {
    if (sortBy === "quality") return (parseFloat(b.quality_score as any || "0")) - (parseFloat(a.quality_score as any || "0"));
    if (sortBy === "roi") return (parseFloat(b.overall_roi || "0")) - (parseFloat(a.overall_roi || "0"));
    return a.username.localeCompare(b.username);
  });

  const resolved = traders.filter(t => t.wallet_resolved);
  const analyzed = traders.filter(t => t.computed_at);
  const pending = traders.filter(t => !t.wallet_resolved);

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      {/* Page Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-500" />
            Elite Traders
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Deep analysis of {traders.length} hand-curated traders — full trade history, specialization, consistency
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-2 py-1">
            <CheckCircle className="w-3 h-3 text-green-500" /> {analyzed.length} analyzed
            <span className="text-border">·</span>
            <Clock className="w-3 h-3 text-yellow-500" /> {resolved.length - analyzed.length} pending
            {pending.length > 0 && <><span className="text-border">·</span><AlertTriangle className="w-3 h-3 text-red-500" /> {pending.length} unresolved</>}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAddForm(v => !v)}
            data-testid="button-toggle-add-form"
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Trader
          </Button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <Card>
          <CardContent className="p-3">
            <div className="text-xs font-medium mb-2">Add a trader by Polymarket URL, wallet address, or username:</div>
            <AddTraderForm onAdded={() => setShowAddForm(false)} />
            <div className="text-[10px] text-muted-foreground mt-1.5">
              Example: https://polymarket.com/@kch123 · 0x6a72f... · kch123
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sort controls */}
      {traders.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort:</span>
          {(["quality", "roi", "name"] as const).map(s => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                sortBy === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`sort-${s}`}
            >
              {s === "quality" ? "Quality Score" : s === "roi" ? "ROI %" : "Name"}
            </button>
          ))}
        </div>
      )}

      {/* Unresolved wallets banner */}
      {pending.length > 0 && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-3">
            <div className="text-xs font-semibold text-yellow-600 dark:text-yellow-400 flex items-center gap-1 mb-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> {pending.length} traders need wallet addresses
            </div>
            <p className="text-xs text-muted-foreground">
              These usernames couldn't be auto-resolved from the leaderboard. Expand their card below to enter the wallet address manually — you can find it on their Polymarket profile page or by viewing transactions on Polygonscan.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Trader grid */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      )}

      {error && (
        <div className="text-sm text-red-500 p-4 rounded-md bg-red-500/10">
          Failed to load traders. Make sure the server is running.
        </div>
      )}

      {!isLoading && traders.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Star className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <div className="font-medium mb-1">No elite traders yet</div>
          <div className="text-sm">Add traders using the button above to start deep analysis.</div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {traders.map(trader => (
          <TraderCard key={trader.wallet} trader={trader} />
        ))}
      </div>

      {traders.length > 0 && (
        <div className="text-xs text-muted-foreground text-center pt-2">
          Analysis runs every 24h · Last fetch: {data?.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : "—"}
        </div>
      )}

      {/* Admin Panel */}
      <AdminPanel />
    </div>
  );
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────
function AdminPanel() {
  const { toast } = useToast();
  const [settleStatus, setSettleStatus] = useState<string | null>(null);
  const [refetchStatus, setRefetchStatus] = useState<string | null>(null);
  const [pnlStatus, setPnlStatus] = useState<string | null>(null);

  const { data: refreshStatus, refetch: refetchStatus2 } = useQuery<{
    running: boolean; startedAt: number | null; finishedAt: number | null;
    ranCount: number; skippedCount: number; totalCount: number; staleCount: number;
    errors: string[]; traders: Array<{ username: string; lastRefreshed: string | null; isStale: boolean; qualityScore: number | null }>;
  }>({
    queryKey: ["/api/elite/refresh-status"],
    refetchInterval: (q) => (q.state.data?.running ? 5000 : 60_000),
  });

  const dailyRefreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/elite/admin/daily-refresh", {}),
    onSuccess: (data: any) => {
      toast({ title: "Daily refresh started", description: `Updating ${data?.staleTraders ?? "?"} stale traders incrementally. Check status below.` });
      setTimeout(() => refetchStatus2(), 2000);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const settleMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/elite/admin/settle-all", {}),
    onSuccess: (data: any) => {
      setSettleStatus(`Settlement started for ${data?.wallets ?? "?"} wallets. This runs in the background and may take 10–20 minutes.`);
      toast({ title: "Settlement started", description: "Gamma API settlement running in background for all wallets." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const refetchMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/elite/admin/refetch-all", {}),
    onSuccess: (data: any) => {
      setRefetchStatus(`Full re-fetch started for ${data?.wallets ?? "?"} wallets. This clears & re-imports all trade history — may take 30–60 minutes.`);
      toast({ title: "Re-fetch started", description: "Full trade history re-import running in background." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canonicalPnlMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/elite/admin/refresh-canonical-pnl", {}),
    onSuccess: (data: any) => {
      setPnlStatus(`Canonical PNL refresh started for ${data?.wallets ?? "?"} traders. Takes ~5 min. Fetches from Polymarket /closed-positions API (matches official numbers).`);
      toast({ title: "PNL refresh started", description: "Fetching from Polymarket closed-positions API for all traders." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card className="border-border/40 bg-muted/20">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <Settings className="w-3.5 h-3.5" />
          Admin Tools
        </div>
        {/* Daily Refresh Status Bar */}
        <div className="rounded-md border border-border/40 bg-background/50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${refreshStatus?.running ? "bg-yellow-400 animate-pulse" : refreshStatus?.staleCount === 0 ? "bg-green-400" : "bg-orange-400"}`} />
              <span className="text-xs font-medium">
                {refreshStatus?.running
                  ? `Updating traders… ${refreshStatus.ranCount}/${(refreshStatus.totalCount ?? 0) - (refreshStatus.skippedCount ?? 0)} done`
                  : refreshStatus?.staleCount === 0
                    ? `All ${refreshStatus?.totalCount ?? 0} traders up to date`
                    : `${refreshStatus?.staleCount ?? "?"} of ${refreshStatus?.totalCount ?? "?"} traders need refresh`}
              </span>
              <span className="text-[10px] text-muted-foreground">· Auto-runs 3 AM UTC</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2 border-blue-500/40 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/20"
              onClick={() => dailyRefreshMutation.mutate()}
              disabled={dailyRefreshMutation.isPending || refreshStatus?.running}
              data-testid="btn-daily-refresh"
            >
              {refreshStatus?.running
                ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Running…</>
                : <><RefreshCw className="w-3 h-3 mr-1" />Run Now</>}
            </Button>
          </div>
          {refreshStatus && !refreshStatus.running && refreshStatus.finishedAt && (
            <p className="text-[10px] text-muted-foreground">
              Last completed: {new Date(refreshStatus.finishedAt).toLocaleString()} · {refreshStatus.ranCount} updated, {refreshStatus.skippedCount} skipped
              {refreshStatus.errors.length > 0 && <span className="text-orange-500 ml-1">· {refreshStatus.errors.length} errors</span>}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs border-green-500/40 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/20"
              onClick={() => canonicalPnlMutation.mutate()}
              disabled={canonicalPnlMutation.isPending}
              data-testid="btn-refresh-canonical-pnl"
            >
              {canonicalPnlMutation.isPending ? "Refreshing..." : "✓ Refresh PNL (Polymarket API)"}
            </Button>
            <p className="text-[10px] text-muted-foreground leading-tight">
              Refreshes realized PNL from Polymarket's /closed-positions API to match official numbers. CSV/analysis remains source of truth. Fast (~5 min).
            </p>
            {pnlStatus && <p className="text-[10px] text-green-600 dark:text-green-400 leading-tight">{pnlStatus}</p>}
          </div>
          <div className="space-y-1.5">
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs"
              onClick={() => settleMutation.mutate()}
              disabled={settleMutation.isPending}
              data-testid="btn-settle-all"
            >
              {settleMutation.isPending ? "Starting..." : "Settle All Trades (Fix Quality Scores)"}
            </Button>
            <p className="text-[10px] text-muted-foreground leading-tight">
              Checks all unsettled markets via Polymarket API and grades wins/losses. Fixes the 0% ROI problem.
            </p>
            {settleStatus && <p className="text-[10px] text-green-600 dark:text-green-400 leading-tight">{settleStatus}</p>}
          </div>
          <div className="space-y-1.5">
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs"
              onClick={() => refetchMutation.mutate()}
              disabled={refetchMutation.isPending}
              data-testid="btn-refetch-all"
            >
              {refetchMutation.isPending ? "Starting..." : "Full Re-fetch All Trades"}
            </Button>
            <p className="text-[10px] text-muted-foreground leading-tight">
              Clears and re-imports complete trade history for all traders. Use if trades are missing or incorrect.
            </p>
            {refetchStatus && <p className="text-[10px] text-yellow-600 dark:text-yellow-400 leading-tight">{refetchStatus}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
