import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Activity, AlertTriangle, BarChart2, CheckCircle2, ExternalLink,
  Flame, LineChart, Target, TrendingUp, Users,
} from "lucide-react";
import type { Signal, SignalsResponse } from "@shared/schema";

interface StratStats {
  n?: number;
  wins?: number;
  win_rate?: number;
  implied_wr?: number;
  edge?: number;
  roi?: number;
  trades_per_day?: number;
  first?: string | null;
  last?: string | null;
  avg_fill?: number;
  profit_factor?: number;
}

interface LastPlay {
  end?: string;
  title?: string;
  side?: string;
  sport?: string;
  sport_family?: string;
  submarket?: string;
  play?: string;
  traders?: string;
  n_traders?: number;
  grade?: number;
  resolved?: string;
  their_vwap?: number;
  fill_join_plus_2c?: number;
  unit_pnl_at_2c?: number;
}

interface StrategyCard {
  id: string;
  name?: string;
  recommended?: boolean;
  priority?: number;
  rule?: string;
  description?: string;
  join_max_plus_2c?: StratStats;
  vwap?: StratStats;
  years?: Record<string, StratStats>;
  by_submarket?: Record<string, StratStats>;
  sport_x_submarket?: Array<StratStats & { sport?: string; submarket?: string }>;
  last_20?: LastPlay[];
  date_span?: { first?: string | null; last?: string | null; trades_per_day?: number };
  filters?: {
    minTraders: number;
    minGrade?: number;
    minQ?: number;
    priceLo: number;
    priceHi: number;
    excludeUsernames: string[];
    requireUsernames?: string[];
    skipSports: string[];
    marketTypes?: string[];
    sportIncludes?: string[];
  };
}

interface HealthRow {
  username: string;
  wallet: string;
  action: string;
  reason: string;
  overall?: StratStats;
  last_90d?: StratStats;
  last_60d?: StratStats;
  last_30d?: StratStats;
  max_date?: string;
  quality_proxy?: number;
}

interface ResearchStat {
  n?: number;
  win_rate?: number;
  roi?: number;
  sharpe_daily_roi?: number;
  max_dd?: number;
  last?: string | null;
  implied_wr?: number;
  edge?: number;
}

interface ResearchBook {
  id: string;
  name?: string;
  their_entry_vwap?: ResearchStat;
  ask_at_alert_join_max?: ResearchStat;
  ask_plus_2c?: ResearchStat;
  concentration?: {
    top_primary?: string;
    primary_share?: number;
    mention_share?: Record<string, number>;
  };
}

interface RobustResearch {
  generated_at?: string;
  as_of?: string;
  method?: string;
  universe?: { max_resolved_date?: string | null };
  freshness?: {
    consensus_last_play?: string | null;
    stale_traders?: string[];
    steady_traders?: string[];
    lane_only?: string[];
  };
  what_to_tail?: Array<{ title?: string; why?: string; strategy_id?: string | null }>;
  books?: ResearchBook[];
  leave_one_out?: Array<{
    dropped?: string;
    n_remaining?: number;
    ask_plus_2c?: ResearchStat;
    concentration?: { top_primary?: string; primary_share?: number };
  }>;
  pairs?: Array<{ pair?: string; n?: number; roi_ask_2c?: number; wr?: number; sharpe?: number; last?: string | null }>;
  clv?: Record<string, {
    n?: number;
    coverage?: number;
    clob_ask_coverage?: number;
    realized_roi?: number;
    expected_clv_roi?: number | null;
    avg_clv_cents?: number | null;
  }>;
  roster?: Array<{
    username?: string;
    action?: string;
    max_date?: string;
    steady_grade?: string;
    steady_reason?: string;
    median_cost?: number;
    last_90d?: ResearchStat;
    curve?: { sharpe?: number; max_dd_pct?: number };
    lanes?: {
      experts?: Array<{ sport?: string; submarket?: string; n?: number; roi?: number }>;
      bleeds?: Array<{ sport?: string; submarket?: string; n?: number; roi?: number }>;
    };
  }>;
  discovery?: {
    recommended?: Array<{
      username?: string;
      best_pnl?: number;
      sample_hold_roi?: number;
      sample_roi?: number;
      closed_only_bias?: number;
      windows?: string[];
    }>;
    error?: string;
  };
}

interface TailStrategiesResponse {
  generatedAt: string | null;
  asOf: string | null;
  fill: string;
  method: string | null;
  copyAll: StratStats | null;
  universe: { max_resolved_date?: string | null } | null;
  strategies: StrategyCard[];
  selectedId: string | null;
  livePlays: Array<Signal & { submarket?: string; playLabel?: string }>;
  research?: RobustResearch | null;
  health: {
    generatedAt?: string;
    counts?: Record<string, number>;
    cannae?: {
      action?: string;
      reason?: string;
      overall?: StratStats;
      last_90d?: StratStats;
      last_60d?: StratStats;
      last_30d?: StratStats;
      may_aug_2026?: StratStats;
      max_date?: string;
      by_sport?: Record<string, StratStats>;
      by_submarket?: Record<string, StratStats>;
      by_side?: Record<string, StratStats>;
    } | null;
    traders?: HealthRow[];
  } | null;
}

function roiClass(roi: number | undefined): string {
  if (roi == null) return "text-muted-foreground";
  if (roi >= 8) return "text-emerald-400";
  if (roi >= 0) return "text-emerald-500/80";
  return "text-red-400";
}

function actionBadge(action: string) {
  const map: Record<string, string> = {
    KEEP: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    TIGHTEN: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    STEADY: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    LANE_ONLY: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    OVERLAY: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    VOLATILE: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    STALE: "bg-muted text-muted-foreground",
    THIN: "bg-muted text-muted-foreground",
    FADED: "bg-red-500/15 text-red-400 border-red-500/30",
    GRINDER: "bg-red-500/15 text-red-400 border-red-500/30",
    UNTAILABLE: "bg-red-500/15 text-red-400 border-red-500/30",
    SKIP: "bg-red-500/15 text-red-400 border-red-500/30",
    WATCH: "bg-muted text-muted-foreground",
    KICK: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return map[action] || "bg-muted";
}

function haystack(signal: Signal): string {
  return [
    signal.marketQuestion, signal.slug, signal.marketType, signal.marketCategory,
    signal.sport, signal.category, signal.outcomeLabel,
  ].filter(Boolean).join(" ").toLowerCase();
}

function inferSubmarket(signal: Signal): string {
  const h = haystack(signal);
  if (h.includes("draw")) return "Draw";
  if (h.includes("spread") || h.includes("(+") || h.includes("(-")) return "Spread";
  if (h.includes("o/u") || h.includes(" over ") || h.includes(" under ") || h.includes("total")) return "Total";
  if (h.includes("mvp") || h.includes("champion") || h.includes("win the")) return "Futures";
  return "Moneyline";
}

function clientMatch(signal: Signal, filters: StrategyCard["filters"]): boolean {
  if (!filters) return false;
  const exclude = new Set((filters.excludeUsernames || []).map((n) => n.toLowerCase()));
  const traders = (signal.traders || []).filter((t) => {
    const name = (t.name || "").toLowerCase();
    return ![...exclude].some((ex) => name.includes(ex) || (t.address || "").toLowerCase().includes(ex));
  });
  if (traders.length < (filters.minTraders || 1)) return false;
  const required = (filters.requireUsernames || []).map((n) => n.toLowerCase());
  if (required.length > 0) {
    const names = new Set(
      traders.map((t) => (t.name || "").toLowerCase()).filter((n) => n.length > 0),
    );
    if (!required.every((name) => names.has(name))) return false;
  }
  if ((filters.minGrade || 0) > 0 && signal.confidence < (filters.minGrade || 0)) return false;
  const q = signal.avgQuality ?? 0;
  if ((filters.minQ || 0) > 0 && q < (filters.minQ || 0)) return false;
  const px = signal.currentPrice || signal.avgEntryPrice;
  if (px < filters.priceLo || px > filters.priceHi) return false;
  const sport = (signal.sport || signal.category || "").toLowerCase();
  if ((filters.skipSports || []).some((k) => sport.includes(k.toLowerCase()))) return false;
  if (filters.sportIncludes?.length && !filters.sportIncludes.some((k) => sport.includes(k.toLowerCase()))) {
    return false;
  }
  const types = filters.marketTypes || [];
  if (types.length) {
    const sub = inferSubmarket(signal);
    const ok = types.some((t) => {
      const tl = t.toLowerCase();
      if (tl.includes("moneyline")) return sub === "Moneyline";
      if (tl.includes("spread")) return sub === "Spread";
      if (tl.includes("total")) return sub === "Total";
      if (tl.includes("draw")) return sub === "Draw";
      return haystack(signal).includes(tl);
    });
    if (!ok) return false;
  }
  return true;
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${className || ""}`}>{value}</div>
    </div>
  );
}

export default function Strategies() {
  const [id, setId] = useState<string>("ghost_2plus_ml");
  const [tab, setTab] = useState<"plays" | "history" | "roster" | "research">("plays");

  const { data, isLoading } = useQuery<TailStrategiesResponse>({
    queryKey: ["/api/tail-strategies", id],
    queryFn: async () => {
      const res = await fetch(`/api/tail-strategies?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("Failed to load strategies");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: signals } = useQuery<SignalsResponse>({
    queryKey: ["/api/signals"],
    refetchInterval: 30_000,
  });

  const selected = useMemo(
    () => (data?.strategies || []).find((s) => s.id === id) || data?.strategies?.[0],
    [data, id],
  );

  const livePlays = useMemo(() => {
    const fromApi = data?.livePlays || [];
    const live = signals?.signals || [];
    const matched = selected?.filters
      ? live.filter((s) => clientMatch(s, selected.filters)).sort((a, b) => b.confidence - a.confidence)
      : fromApi;
    return matched.slice(0, 40);
  }, [data, signals, selected]);

  const stats = selected?.join_max_plus_2c;
  const theirFill = selected?.vwap;
  const healthRows = data?.health?.traders || [];
  const research = data?.research;
  const takeBooks = useMemo(
    () =>
      (data?.strategies || [])
        .filter((s) => s.recommended)
        .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)),
    [data],
  );
  const skipBooks = useMemo(
    () => (data?.strategies || []).filter((s) => !s.recommended),
    [data],
  );

  if (isLoading && !data) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Recommended plays · $100/play · hold to resolution</div>
          <h1 className="text-xl font-semibold tracking-tight">Take these</h1>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Copy-all is {data?.copyAll?.roi ?? "—"}% ROI. Only take the ranked books below.
            Fill at the later voter’s price + 2¢ — you will not get their VWAP.
            Last resolved game: {data?.research?.freshness?.consensus_last_play || data?.universe?.max_resolved_date || "—"}.
          </p>
        </div>
        <Select value={selected?.id || id} onValueChange={setId}>
          <SelectTrigger className="w-full md:w-[320px]" data-testid="select-strategy">
            <SelectValue placeholder="Select strategy" />
          </SelectTrigger>
          <SelectContent>
            {(data?.strategies || []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.recommended ? "TAKE · " : "SKIP · "}{s.name || s.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        {(["plays", "history", "roster", "research"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`text-sm px-3 py-1.5 rounded-md border ${tab === t ? "bg-primary text-primary-foreground" : "bg-card"}`}
            data-testid={`tab-${t}`}
          >
            {t === "plays" ? "Take list" : t === "history" ? "Tape" : t === "roster" ? "Roster" : "Research"}
          </button>
        ))}
      </div>

      {tab === "plays" && (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {takeBooks.map((book, idx) => {
              const st = book.join_max_plus_2c;
              const active = selected?.id === book.id;
              return (
                <button
                  key={book.id}
                  type="button"
                  onClick={() => setId(book.id)}
                  className={`text-left rounded-lg border p-4 space-y-2 transition-colors ${
                    active ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"
                  }`}
                  data-testid={`take-card-${book.id}`}
                >
                  <div className="flex items-center gap-2">
                    <Badge>{idx + 1}</Badge>
                    <span className="font-semibold text-sm">{book.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{book.rule || book.description}</p>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <Stat label="Your fill" value={`${st?.roi ?? 0}%`} className={`text-base ${roiClass(st?.roi)}`} />
                    <Stat label="Win rate" value={`${st?.win_rate ?? 0}%`} className="text-base" />
                    <Stat label="Plays" value={String(st?.n ?? 0)} className="text-base" />
                  </div>
                </button>
              );
            })}
          </div>

          {skipBooks.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Do not take</div>
              <div className="grid md:grid-cols-2 gap-2">
                {skipBooks.map((book) => {
                  const st = book.join_max_plus_2c;
                  const active = selected?.id === book.id;
                  return (
                    <button
                      key={book.id}
                      type="button"
                      onClick={() => setId(book.id)}
                      className={`text-left rounded-md border px-3 py-2 text-xs ${
                        active ? "border-red-500/50 bg-red-500/10" : "border-border/60 bg-card"
                      }`}
                    >
                      <span className="font-medium">{book.name}</span>
                      <span className={`ml-2 tabular-nums ${roiClass(st?.roi)}`}>{st?.roi}% ROI · {st?.win_rate}% WR · n={st?.n}</span>
                      <div className="text-muted-foreground mt-1">{book.rule || book.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selected && (
            <Card>
              <CardContent className="p-4 md:p-5 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{selected.name}</h2>
                  {selected.recommended ? <Badge>Take</Badge> : <Badge className="bg-red-500/15 text-red-400 border-red-500/30">Skip</Badge>}
                  <Badge variant="outline">{data?.fill}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{selected.description}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 pt-1">
                  <Stat label="Your fill (+2¢)" value={`${stats?.roi ?? 0}%`} className={roiClass(stats?.roi)} />
                  <Stat label="Their VWAP" value={`${theirFill?.roi ?? 0}%`} className={roiClass(theirFill?.roi)} />
                  <Stat label="Win rate" value={`${stats?.win_rate ?? 0}%`} />
                  <Stat label="Plays" value={String(stats?.n ?? 0)} />
                  <Stat label="Trades / day" value={String(stats?.trades_per_day ?? 0)} />
                  <Stat label="Date span" value={`${stats?.first || "—"} → ${stats?.last || "—"}`} className="text-sm" />
                </div>
                {selected.years && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {Object.entries(selected.years).map(([year, y]) => (
                      <Badge key={year} variant="outline" className="font-normal">
                        {year}: {y.n} plays · {y.roi}% ROI · {y.win_rate}% WR
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Flame className="w-3.5 h-3.5" />
            {livePlays.length} live matches for {selected?.name || "this book"} · polls every 30s
          </div>
          {livePlays.length === 0 && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No live 2+ plays currently match this filter. That is expected on quiet slates — do not force a trade.
              </CardContent>
            </Card>
          )}
          {livePlays.map((s) => {
            const sub = inferSubmarket(s);
            const href = s.slug ? `https://polymarket.com/event/${s.slug}` : undefined;
            return (
              <Card key={s.id}>
                <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <Badge variant="outline">{s.side}</Badge>
                      <Badge variant="outline">{s.sport || s.category}</Badge>
                      <Badge variant="outline">{sub}</Badge>
                      <Badge>Grade {s.confidence}</Badge>
                    </div>
                    <div className="font-medium truncate">{s.marketQuestion}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {s.traders?.map((t) => t.name).filter(Boolean).join(", ")} · {s.traderCount} wallets ·
                      live {(s.currentPrice * 100).toFixed(0)}¢ · entry {(s.avgEntryPrice * 100).toFixed(0)}¢
                    </div>
                  </div>
                  {href && (
                    <a href={href} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1 text-primary shrink-0">
                      Open market <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "history" && (
        <div className="grid lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Activity className="w-4 h-4" /> Last 20 resolved plays
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground text-left">
                    <tr>
                      <th className="py-1 pr-2">Date</th>
                      <th className="py-1 pr-2">Res</th>
                      <th className="py-1 pr-2">Play</th>
                      <th className="py-1 pr-2">Fill</th>
                      <th className="py-1 pr-2">G</th>
                      <th className="py-1">Traders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selected?.last_20 || []).map((p, i) => (
                      <tr key={`${p.end}-${i}`} className="border-t border-border/60">
                        <td className="py-1.5 pr-2 whitespace-nowrap">{(p.end || "").slice(0, 10)}</td>
                        <td className={`py-1.5 pr-2 ${p.resolved === "WIN" ? "text-emerald-400" : "text-red-400"}`}>{p.resolved}</td>
                        <td className="py-1.5 pr-2 max-w-[360px]">
                          <div className="truncate font-medium">{p.title}</div>
                          <div className="text-muted-foreground">{p.side} · {p.sport_family || p.sport} · {p.submarket}</div>
                        </td>
                        <td className="py-1.5 pr-2 tabular-nums">{p.fill_join_plus_2c}</td>
                        <td className="py-1.5 pr-2">{p.grade}</td>
                        <td className="py-1.5 text-muted-foreground">{p.traders}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <BarChart2 className="w-4 h-4" /> Sport × submarket
              </div>
              <div className="space-y-1.5 max-h-[480px] overflow-auto">
                {(selected?.sport_x_submarket || []).slice(0, 40).map((row) => (
                  <div key={`${row.sport}-${row.submarket}`} className="flex justify-between text-xs gap-2">
                    <span className="truncate">{row.sport} · {row.submarket}</span>
                    <span className={`tabular-nums shrink-0 ${roiClass(row.roi)}`}>
                      n={row.n} · {row.roi}% · {row.trades_per_day}/d
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "roster" && (
        <div className="space-y-4">
          {data?.health?.cannae && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span className="font-medium">Cannae</span>
                  <Badge className={actionBadge(data.health.cannae.action || "")}>{data.health.cannae.action}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{data.health.cannae.reason}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
                  <Stat label="Full ROI" value={`${data.health.cannae.overall?.roi ?? 0}%`} className={roiClass(data.health.cannae.overall?.roi)} />
                  <Stat label="Last 90d" value={`${data.health.cannae.last_90d?.roi ?? 0}%`} className={roiClass(data.health.cannae.last_90d?.roi)} />
                  <Stat label="Last 60d" value={`${data.health.cannae.last_60d?.roi ?? 0}%`} className={roiClass(data.health.cannae.last_60d?.roi)} />
                  <Stat label="Last 30d" value={`${data.health.cannae.last_30d?.roi ?? 0}%`} className={roiClass(data.health.cannae.last_30d?.roi)} />
                  <Stat label="Last dated play" value={data.health.cannae.max_date || "—"} className="text-sm" />
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm font-medium mb-3">
                <Users className="w-4 h-4" /> Roster
                {data?.health?.counts && (
                  <span className="text-xs text-muted-foreground font-normal">
                    KEEP {data.health.counts.KEEP} · TIGHTEN {data.health.counts.TIGHTEN} · OVERLAY {data.health.counts.OVERLAY} · WATCH {data.health.counts.WATCH} · KICK {data.health.counts.KICK}
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground text-left">
                    <tr>
                      <th className="py-1 pr-2">Trader</th>
                      <th className="py-1 pr-2">Action</th>
                      <th className="py-1 pr-2">n</th>
                      <th className="py-1 pr-2">ROI</th>
                      <th className="py-1 pr-2">90d</th>
                      <th className="py-1 pr-2">60d</th>
                      <th className="py-1 pr-2">Last</th>
                      <th className="py-1">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {healthRows.map((t) => (
                      <tr key={t.wallet} className="border-t border-border/60 align-top">
                        <td className="py-1.5 pr-2 font-medium whitespace-nowrap">{t.username}</td>
                        <td className="py-1.5 pr-2"><Badge className={actionBadge(t.action)}>{t.action}</Badge></td>
                        <td className="py-1.5 pr-2 tabular-nums">{t.overall?.n}</td>
                        <td className={`py-1.5 pr-2 tabular-nums ${roiClass(t.overall?.roi)}`}>{t.overall?.roi}%</td>
                        <td className={`py-1.5 pr-2 tabular-nums ${roiClass(t.last_90d?.roi)}`}>{t.last_90d?.roi}% ({t.last_90d?.n})</td>
                        <td className={`py-1.5 pr-2 tabular-nums ${roiClass(t.last_60d?.roi)}`}>{t.last_60d?.roi}% ({t.last_60d?.n})</td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">{t.max_date}</td>
                        <td className="py-1.5 text-muted-foreground">{t.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "research" && (
        <div className="space-y-4">
          {!research && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Research report not generated yet. Run `npm run backtest:research`.
              </CardContent>
            </Card>
          )}
          {research && (
            <>
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Target className="w-4 h-4" /> What to tail
                    <span className="text-xs text-muted-foreground font-normal">
                      last play {research.freshness?.consensus_last_play || "—"} · as of {research.as_of}
                    </span>
                  </div>
                  {(research.freshness?.stale_traders || []).length > 0 && (
                    <p className="text-xs text-amber-400">
                      Stale (no dated event in 21d): {(research.freshness?.stale_traders || []).join(", ")}
                    </p>
                  )}
                  <ol className="space-y-2 list-decimal pl-5 text-sm">
                    {(research.what_to_tail || []).map((item) => (
                      <li key={item.title}>
                        <span className="font-medium">{item.title}</span>
                        <div className="text-xs text-muted-foreground">{item.why}</div>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <BarChart2 className="w-4 h-4" /> Dual fill — their entry vs ask at alert
                  </div>
                  <p className="text-xs text-muted-foreground">
                    VWAP is the price they got. Join_max is the later voter (when a 2+ alert can fire). Live tailing uses join_max + 2¢.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground text-left">
                        <tr>
                          <th className="py-1 pr-2">Book</th>
                          <th className="py-1 pr-2">n</th>
                          <th className="py-1 pr-2">Their VWAP</th>
                          <th className="py-1 pr-2">Ask (join)</th>
                          <th className="py-1 pr-2">Ask+2¢</th>
                          <th className="py-1 pr-2">WR</th>
                          <th className="py-1">Concentration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(research.books || []).map((b) => (
                          <tr key={b.id} className="border-t border-border/60">
                            <td className="py-1.5 pr-2 font-medium">{b.name || b.id}</td>
                            <td className="py-1.5 pr-2 tabular-nums">{b.ask_plus_2c?.n}</td>
                            <td className={`py-1.5 pr-2 tabular-nums ${roiClass(b.their_entry_vwap?.roi)}`}>{b.their_entry_vwap?.roi}%</td>
                            <td className={`py-1.5 pr-2 tabular-nums ${roiClass(b.ask_at_alert_join_max?.roi)}`}>{b.ask_at_alert_join_max?.roi}%</td>
                            <td className={`py-1.5 pr-2 tabular-nums ${roiClass(b.ask_plus_2c?.roi)}`}>{b.ask_plus_2c?.roi}%</td>
                            <td className="py-1.5 pr-2 tabular-nums">{b.ask_plus_2c?.win_rate}%</td>
                            <td className="py-1.5 text-muted-foreground">
                              {b.concentration?.top_primary} {Math.round((b.concentration?.primary_share || 0) * 100)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <div className="grid lg:grid-cols-2 gap-4">
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <LineChart className="w-4 h-4" /> CLV vs realized
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Expected ROI from close line / fill − 1. Realized is hold-to-res at the same fill.
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground text-left">
                          <tr>
                            <th className="py-1 pr-2">Book</th>
                            <th className="py-1 pr-2">n</th>
                            <th className="py-1 pr-2">Realized</th>
                            <th className="py-1 pr-2">Expected</th>
                            <th className="py-1">CLV</th>
                          </tr>
                        </thead>
                        <tbody>
                          {([
                            ["q50_moneyline", "2+ Q50 ML"],
                            ["favorites_60_80", "Favorites 60–80¢"],
                            ["soccer_ml_no_cannae", "Soccer ML no Cannae"],
                          ] as const).map(([key, label]) => {
                            const c = research.clv?.[key];
                            return (
                              <tr key={key} className="border-t border-border/60">
                                <td className="py-1.5 pr-2">{label}</td>
                                <td className="py-1.5 pr-2 tabular-nums">{c?.n ?? "—"}</td>
                                <td className={`py-1.5 pr-2 tabular-nums ${roiClass(c?.realized_roi)}`}>{c?.realized_roi ?? "—"}%</td>
                                <td className={`py-1.5 pr-2 tabular-nums ${roiClass(c?.expected_clv_roi ?? undefined)}`}>{c?.expected_clv_roi ?? "—"}%</td>
                                <td className="py-1.5 tabular-nums">{c?.avg_clv_cents ?? "—"}¢</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Users className="w-4 h-4" /> Leave-one-out (Q50 moneyline)
                    </div>
                    <div className="space-y-1.5">
                      {(research.leave_one_out || []).map((row) => (
                        <div key={row.dropped} className="flex justify-between text-xs gap-2">
                          <span>Drop {row.dropped}</span>
                          <span className={`tabular-nums ${roiClass(row.ask_plus_2c?.roi)}`}>
                            n={row.n_remaining} · {row.ask_plus_2c?.roi}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">Pairs that print (Q50 moneyline)</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground text-left">
                        <tr>
                          <th className="py-1 pr-2">Pair</th>
                          <th className="py-1 pr-2">n</th>
                          <th className="py-1 pr-2">Ask+2¢ ROI</th>
                          <th className="py-1 pr-2">WR</th>
                          <th className="py-1">Last</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(research.pairs || []).slice(0, 12).map((p) => (
                          <tr key={p.pair} className="border-t border-border/60">
                            <td className="py-1.5 pr-2">{p.pair}</td>
                            <td className="py-1.5 pr-2 tabular-nums">{p.n}</td>
                            <td className={`py-1.5 pr-2 tabular-nums ${roiClass(p.roi_ask_2c)}`}>{p.roi_ask_2c}%</td>
                            <td className="py-1.5 pr-2 tabular-nums">{p.wr}%</td>
                            <td className="py-1.5">{p.last}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">Steady winners vs everyone else</div>
                  <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground text-left">
                        <tr>
                          <th className="py-1 pr-2">Trader</th>
                          <th className="py-1 pr-2">Grade</th>
                          <th className="py-1 pr-2">Last</th>
                          <th className="py-1 pr-2">90d</th>
                          <th className="py-1 pr-2">Sharpe</th>
                          <th className="py-1">Why</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(research.roster || []).filter((t) => t.steady_grade !== "SKIP").map((t) => (
                          <tr key={t.username} className="border-t border-border/60 align-top">
                            <td className="py-1.5 pr-2 font-medium whitespace-nowrap">{t.username}</td>
                            <td className="py-1.5 pr-2"><Badge className={actionBadge(t.steady_grade || "")}>{t.steady_grade}</Badge></td>
                            <td className="py-1.5 pr-2 whitespace-nowrap">{t.max_date}</td>
                            <td className={`py-1.5 pr-2 tabular-nums ${roiClass(t.last_90d?.roi)}`}>{t.last_90d?.roi}%</td>
                            <td className="py-1.5 pr-2 tabular-nums">{t.curve?.sharpe}</td>
                            <td className="py-1.5 text-muted-foreground">{t.steady_reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="text-sm font-medium">Expert lanes — weight these, ignore bleeds</div>
                  <div className="grid md:grid-cols-2 gap-3">
                    {(research.roster || [])
                      .filter((t) => (t.lanes?.experts?.length || 0) > 0 && !["SKIP", "STALE", "GRINDER", "UNTAILABLE"].includes(t.steady_grade || ""))
                      .map((t) => (
                        <div key={t.username} className="text-xs border border-border/60 rounded-md p-2">
                          <div className="font-medium mb-1">{t.username}</div>
                          <div className="text-emerald-400">
                            {(t.lanes?.experts || []).slice(0, 4).map((e) => `${e.sport}/${e.submarket} ${e.roi}%`).join(" · ")}
                          </div>
                          {(t.lanes?.bleeds || []).length > 0 && (
                            <div className="text-red-400 mt-1">
                              Bleed: {(t.lanes?.bleeds || []).slice(0, 3).map((e) => `${e.sport}/${e.submarket} ${e.roi}%`).join(" · ")}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-2">
                  <div className="text-sm font-medium">Off-list names (honest closed+open screen)</div>
                  {(research.discovery?.recommended || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {research.discovery?.error || "No new sports-leaderboard wallets passed the honest screen. Full-open grade still required before tailing."}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {(research.discovery?.recommended || []).map((r) => (
                        <div key={r.username} className="flex justify-between text-xs gap-2">
                          <span>{r.username}</span>
                          <span className="tabular-nums text-muted-foreground">
                            hold {r.sample_hold_roi}% · closed {r.sample_roi}% · bias {r.closed_only_bias}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground pt-2">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <Target className="w-3.5 h-3.5" />
        <TrendingUp className="w-3.5 h-3.5" />
        Copy-all hold-to-res baseline {data?.copyAll?.roi ?? "—"}% ROI on {data?.copyAll?.n ?? "—"} trader-markets. Do not confuse that with consensus strategy ROI.
      </div>
    </div>
  );
}
