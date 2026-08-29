import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ExternalLink,
  RefreshCw,
  Sparkles,
  ListOrdered,
  Users,
  Telescope,
  Trophy,
  ChevronRight,
  Radar,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  effectiveLane,
  laneLabel,
  timingLabel,
  type PlayLane,
} from "@/lib/playLane";

interface RankedPlay {
  id: string;
  rank?: number;
  list?: "take" | "near" | "watch";
  grade?: number;
  q?: number;
  rel?: number;
  sport?: string;
  submarket?: string;
  lane?: PlayLane;
  timing?: "live" | "upcoming" | "long" | "unknown";
  playLabel?: string;
  marketQuestion?: string;
  traders?: string[];
  why?: string[];
  misses?: string[];
  sportRoi?: number | null;
  url?: string;
  slug?: string;
  liveAsk?: number | null;
  takeCap?: number;
}

interface ExcellenceTrader {
  username: string;
  wallet: string;
  bucket: string;
  excellenceScore: number;
  verdict: string;
  why: string[];
  uniqueRoi: number | null;
  takeN: number | null;
  takeRoi: number | null;
  last30Roi: number | null;
  last30N: number | null;
  medianStake: number | null;
  recency: string | null;
  compositeScore: number | null;
  insiderScore: number | null;
  action: string | null;
  topEdges: string[];
  joinable: boolean;
  polymarketUrl: string;
}

interface PolydataFind {
  username?: string;
  wallet?: string;
  rank?: number;
  pnl?: number;
  vol?: number;
  pnl_vol?: number;
  window?: string;
}

interface UnusualFlowMarket {
  rank?: number;
  question?: string;
  event_title?: string;
  url?: string;
  sports_ish?: boolean;
  volume24hr?: number;
  unusual_score?: number;
  tags?: string[];
  smart_gap?: number | null;
  days_to_end?: number | null;
  prices?: number[];
  outcomes?: string[];
  flagged?: Array<{
    wallet?: string;
    name?: string;
    outcome?: string;
    amount?: number;
    z?: number;
    q?: number | null;
    open_markets?: number | null;
    trade_depth?: number | null;
    fresh?: boolean;
    tags?: string[];
    polymarket_profile?: string;
  }>;
}

interface UnusualFlowInsider {
  rank?: number;
  z?: number;
  name?: string;
  wallet?: string;
  outcome?: string;
  amount?: number;
  open_markets?: number | null;
  trade_depth?: number | null;
  fresh?: boolean;
  q?: number | null;
  tags?: string[];
  sports_ish?: boolean;
  lane?: string;
  market?: string;
  unusual_score?: number;
  url?: string;
  polymarket_profile?: string;
}

interface HotWalletResult {
  wallet?: string;
  username?: string;
  z?: number;
  lane?: string;
  sports_ish?: boolean;
  market?: string;
  tags?: string[];
  action?: string;
  light?: { light_q?: number; n?: number; win_rate?: number | null; roi_pct?: number | null };
  polymarket_profile?: string;
}

interface PredictionInsidersResponse {
  generatedAt?: string | null;
  rule?: string | null;
  method?: string;
  counts?: {
    plays?: number;
    take?: number;
    near?: number;
    watch?: number;
    traders?: number;
    newFinds?: number;
    booksScanned?: number;
    unusualMarkets?: number;
    potentialInsiders?: number;
    hotEnqueued?: number;
    hotCandidates?: number;
  };
  plays?: RankedPlay[];
  traders?: ExcellenceTrader[];
  newFinds?: PolydataFind[];
  discovery?: {
    live?: Array<{ username?: string; uniqueRoi?: number }>;
    adaptiveActions?: Array<{ action?: string; username?: string; why?: string }>;
    autoPromote?: { promoted?: Array<{ username?: string; why?: string }> };
  };
  unusualFlow?: {
    generated_at?: string;
    method?: string;
    markets?: UnusualFlowMarket[];
    potential_insiders?: UnusualFlowInsider[];
  } | null;
  hotDiscoveries?: {
    generated_at?: string;
    method?: string;
    counts?: {
      candidates?: number;
      scored?: number;
      enqueued?: number;
      enqueued_sports?: number;
      enqueued_macro?: number;
      csv_fetched?: number;
      watch_roster?: number;
    };
    enqueued?: Array<{ username?: string; wallet?: string; source?: string; notes?: string }>;
    watch_roster?: Array<{ username?: string; wallet?: string; source?: string; notes?: string }>;
    results?: HotWalletResult[];
  } | null;
  trust?: {
    takeHealth?: {
      status?: string;
      pause_reason?: string | null;
      windows?: Record<string, { n?: number; win_rate?: number | null; roi_2c?: number | null }>;
      generated_at?: string;
    } | null;
    walkforward?: {
      generated_at?: string;
      best_at_2c_slip_n50?: { id?: string; n?: number; roi?: number; win_rate?: number };
    } | null;
    bankroll?: {
      generated_at?: string;
      flat_100?: { n?: number; roi_on_start?: number; sharpe_daily_roi?: number; max_dd_pct?: number };
      sizing?: { kelly_half?: { avg_stake?: number; roi_on_start?: number } };
    } | null;
  };
}

function gradeTone(g: number): string {
  if (g >= 75) return "text-emerald-400";
  if (g >= 60) return "text-primary";
  if (g >= 45) return "text-amber-400";
  return "text-muted-foreground";
}

function bucketTone(bucket: string): string {
  if (bucket === "live") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (bucket === "bench") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-muted text-muted-foreground";
}

function money(v: number | null | undefined): string {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "−";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function PlayCard({ p }: { p: RankedPlay }) {
  const grade = Math.round(p.grade ?? 0);
  const href = p.url || (p.slug ? `https://polymarket.com/event/${p.slug}` : undefined);
  const why = p.why?.length ? p.why : (p.misses || []).map((m) => `Missing: ${m}`);
  const lane = p.lane ?? effectiveLane({ sport: p.sport, submarket: p.submarket, title: p.marketQuestion || p.playLabel });
  const tLabel = timingLabel(p.timing);

  return (
    <Card data-testid="card-insider-play">
      <CardContent className="p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="tabular-nums">#{p.rank ?? "—"}</Badge>
          <Badge variant={p.list === "take" ? "default" : p.list === "near" ? "outline" : "secondary"}>
            {p.list === "take" ? "TAKE" : p.list === "near" ? "NEAR" : "WATCH"}
          </Badge>
          <span className={`text-xl font-bold tabular-nums ${gradeTone(grade)}`}>{grade}</span>
          <span className="text-xs text-muted-foreground">/100</span>
          <Badge variant="outline" className={lane === "sports" ? "text-emerald-400 border-emerald-500/30" : lane === "other" ? "text-amber-400 border-amber-500/30" : ""}>
            {laneLabel(lane)}
          </Badge>
          {tLabel ? <Badge variant="outline">{tLabel}</Badge> : null}
          <Badge variant="outline">{p.submarket || "—"}</Badge>
          <Badge variant="outline">{p.sport || "—"}</Badge>
          {p.q != null ? <Badge variant="outline">Q {Math.round(p.q)}</Badge> : null}
          {p.rel != null ? <Badge variant="outline">{p.rel.toFixed(1)}×</Badge> : null}
        </div>
        <div className="font-semibold leading-snug">{p.playLabel || p.marketQuestion}</div>
        <div className="text-[11px] text-muted-foreground">
          {(p.traders || []).join(", ")}
          {p.sportRoi != null ? ` · sport ROI ${p.sportRoi.toFixed(0)}%` : ""}
          {p.liveAsk != null ? ` · ask ${p.liveAsk.toFixed(3)}` : ""}
        </div>
        <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
          {why.slice(0, 5).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {href && (
          <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary">
            Polymarket <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function TraderCard({ t, rank }: { t: ExcellenceTrader; rank: number }) {
  return (
    <Card data-testid="card-insider-trader">
      <CardContent className="p-4 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">#{rank}</Badge>
            <span className={`text-xl font-bold tabular-nums ${gradeTone(t.excellenceScore)}`}>
              {t.excellenceScore}
            </span>
            <span className="text-xs text-muted-foreground">excellence</span>
            <Badge variant="outline" className={bucketTone(t.bucket)}>{t.bucket}</Badge>
            {t.recency ? <Badge variant="outline">{t.recency}</Badge> : null}
            {t.joinable ? (
              <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">joinable</Badge>
            ) : null}
          </div>
          <Link href={`/elite/${t.wallet}`} className="text-xs text-primary inline-flex items-center gap-0.5">
            Profile <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="font-semibold">{t.username}</div>
        <div className="text-xs text-primary font-medium">{t.verdict}</div>
        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground tabular-nums">
          <span>Unique {t.uniqueRoi != null ? `${t.uniqueRoi.toFixed(1)}%` : "—"}</span>
          <span>Take {t.takeN != null ? `${t.takeN} @ ${t.takeRoi?.toFixed(1) ?? "—"}%` : "—"}</span>
          <span>30d {t.last30N ?? 0} prints · {t.last30Roi != null ? `${t.last30Roi.toFixed(1)}%` : "—"}</span>
          <span>Median {t.medianStake != null ? money(t.medianStake) : "—"}</span>
          {t.insiderScore != null ? <span>Insider {t.insiderScore.toFixed(0)}</span> : null}
        </div>
        {t.topEdges.length > 0 && (
          <div className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">How they win: </span>
            {t.topEdges.join(" · ")}
          </div>
        )}
        <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
          {t.why.slice(0, 4).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {t.action && (
          <div className="text-[11px] text-amber-500">Pipeline: {t.action}</div>
        )}
      </CardContent>
    </Card>
  );
}

function UnusualMarketCard({ m }: { m: UnusualFlowMarket }) {
  const score = m.unusual_score ?? 0;
  const top = m.flagged?.[0];
  return (
    <Card data-testid="card-unusual-market">
      <CardContent className="p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="tabular-nums">#{m.rank ?? "—"}</Badge>
          <span className={`text-xl font-bold tabular-nums ${gradeTone(Math.min(100, score * 2))}`}>
            {score.toFixed(1)}
          </span>
          <span className="text-xs text-muted-foreground">unusual</span>
          {m.sports_ish ? <Badge variant="outline">sports</Badge> : null}
          {m.smart_gap != null ? (
            <Badge variant="outline">smart gap {m.smart_gap > 0 ? "+" : ""}{m.smart_gap}</Badge>
          ) : null}
          {m.days_to_end != null && m.days_to_end <= 7 ? (
            <Badge variant="outline" className="text-amber-400 border-amber-500/30">closing soon</Badge>
          ) : null}
        </div>
        <div className="font-semibold leading-snug">{m.question || m.event_title}</div>
        <div className="flex flex-wrap gap-1">
          {(m.tags || []).map((t) => (
            <Badge key={t} variant="secondary" className="text-[10px]">{t.replace(/_/g, " ")}</Badge>
          ))}
        </div>
        {top && (
          <div className="text-xs text-muted-foreground">
            Top Z: <span className="text-foreground font-medium">{top.name || top.wallet?.slice(0, 10)}</span>
            {" · "}z={top.z} · {top.outcome} · size {top.amount != null ? Math.round(top.amount).toLocaleString() : "—"}
            {top.q != null ? ` · Q ${top.q}` : ""}
            {top.open_markets != null ? ` · ${top.open_markets} open mkts` : ""}
            {top.fresh ? " · fresh book" : ""}
          </div>
        )}
        {m.url && (
          <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary">
            Polymarket <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function InsiderAlertRow({ r }: { r: UnusualFlowInsider }) {
  return (
    <div className="border border-border/40 rounded-md p-3 space-y-1" data-testid="row-potential-insider">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">#{r.rank}</Badge>
        <span className="font-semibold text-sm">{r.name || r.wallet?.slice(0, 12)}</span>
        <Badge variant="outline" className="tabular-nums">Z {r.z}</Badge>
        {r.fresh ? <Badge variant="outline" className="text-amber-400 border-amber-500/30">fresh</Badge> : null}
        {(r.tags || []).slice(0, 3).map((t) => (
          <Badge key={t} variant="secondary" className="text-[10px]">{t.replace(/_/g, " ")}</Badge>
        ))}
      </div>
      <div className="text-xs text-muted-foreground">
        {r.market} · {r.outcome} · size {r.amount != null ? Math.round(r.amount).toLocaleString() : "—"}
        {r.open_markets != null ? ` · ${r.open_markets} open` : ""}
        {r.trade_depth != null ? ` · depth≥${r.trade_depth}` : ""}
      </div>
      <div className="flex gap-3 text-[11px]">
        {r.polymarket_profile && (
          <a href={r.polymarket_profile} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">
            Wallet <ExternalLink className="w-3 h-3" />
          </a>
        )}
        {r.url && (
          <a href={r.url} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">
            Market <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

interface EliteContinuousResponse {
  elite?: {
    busy?: boolean;
    lastMode?: string | null;
    lastStartedAt?: number | null;
    lastFinishedAt?: number | null;
    lastExitCode?: number | null;
    microIntervalMs?: number;
    promoteIntervalMs?: number;
  };
  hotDiscover?: {
    busy?: boolean;
    lastFinishedAt?: number | null;
    lastExitCode?: number | null;
    intervalMs?: number;
  };
  scheduledPipeline?: {
    busy?: boolean;
    lastFinishedAt?: number | null;
    lastCheckAt?: number | null;
    smartRefreshMs?: number;
  };
  lastTick?: {
    mode?: string;
    ok?: boolean;
    finished_at?: string;
    failed?: string[];
  } | null;
}

function fmtAgo(ts: number | null | undefined): string {
  if (ts == null) return "never";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function EliteHeartbeat() {
  const { data } = useQuery<EliteContinuousResponse>({
    queryKey: ["/api/elite-continuous"],
    refetchInterval: 15_000,
  });
  const e = data?.elite;
  const h = data?.hotDiscover;
  const p = data?.scheduledPipeline;
  const tick = data?.lastTick;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]" data-testid="elite-heartbeat">
      <div className="border border-border/40 rounded-md p-2 space-y-0.5">
        <div className="font-medium">Hot discover</div>
        <div className="text-muted-foreground">
          every {Math.round((h?.intervalMs ?? 600_000) / 60_000)}m · last {fmtAgo(h?.lastFinishedAt ?? null)}
          {h?.busy ? " · running" : ""}
        </div>
      </div>
      <div className="border border-border/40 rounded-md p-2 space-y-0.5">
        <div className="font-medium">Grade / promote</div>
        <div className="text-muted-foreground">
          micro {Math.round((e?.microIntervalMs ?? 900_000) / 60_000)}m · promote{" "}
          {Math.round((e?.promoteIntervalMs ?? 2_700_000) / 60_000)}m
        </div>
        <div className="text-muted-foreground">
          last {e?.lastMode || tick?.mode || "—"} {fmtAgo(e?.lastFinishedAt ?? null)}
          {e?.busy ? " · running" : ""}
          {tick?.ok === false ? " · warn" : ""}
        </div>
      </div>
      <div className="border border-border/40 rounded-md p-2 space-y-0.5">
        <div className="font-medium">Full pipeline</div>
        <div className="text-muted-foreground">
          check hourly · smart {Math.round((p?.smartRefreshMs ?? 21_600_000) / 3_600_000)}h
        </div>
        <div className="text-muted-foreground">
          last {fmtAgo(p?.lastFinishedAt ?? p?.lastCheckAt ?? null)}
          {p?.busy ? " · running" : ""}
        </div>
      </div>
    </div>
  );
}

export default function PredictionInsiders() {
  const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery<PredictionInsidersResponse>({
    queryKey: ["/api/prediction-insiders"],
    staleTime: 8_000,
    refetchInterval: 15_000,
  });

  const [playFilter, setPlayFilter] = useState<"all" | "take" | "near" | "watch">("all");
  const [laneTab, setLaneTab] = useState<PlayLane>("sports");
  const [traderFilter, setTraderFilter] = useState<"all" | "live" | "bench" | "watch">("all");
  const [unusualLane, setUnusualLane] = useState<"sports" | "macro">("sports");

  const resolveLane = (p: RankedPlay): PlayLane =>
    p.lane ?? effectiveLane({ sport: p.sport, submarket: p.submarket, title: p.marketQuestion || p.playLabel, timing: p.timing });

  const plays = useMemo(() => {
    const rows = data?.plays || [];
    const inLane = rows.filter((p) => resolveLane(p) === laneTab);
    if (playFilter === "all") return inLane;
    return inLane.filter((p) => p.list === playFilter);
  }, [data?.plays, playFilter, laneTab]);

  const laneCounts = useMemo(() => {
    const rows = data?.plays || [];
    return {
      sports: rows.filter((p) => resolveLane(p) === "sports").length,
      other: rows.filter((p) => resolveLane(p) === "other").length,
      futures: rows.filter((p) => resolveLane(p) === "futures").length,
    };
  }, [data?.plays]);

  const traders = useMemo(() => {
    const rows = data?.traders || [];
    if (traderFilter === "all") return rows;
    return rows.filter((t) => t.bucket === traderFilter);
  }, [data?.traders, traderFilter]);

  const unusualMarkets = useMemo(() => {
    const rows = data?.unusualFlow?.markets || [];
    if (unusualLane === "sports") return rows.filter((m) => m.sports_ish);
    return rows.filter((m) => !m.sports_ish);
  }, [data?.unusualFlow?.markets, unusualLane]);

  const potentialInsiders = data?.unusualFlow?.potential_insiders || [];
  const counts = data?.counts || {};

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5" data-testid="page-prediction-insiders">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" /> Prediction Insiders
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Sniper plays · rankings · unusual flow</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Sniper TAKE stays strict. Unusual Flow + hot discovery mirror Unusual Whales:
            market-first Z-scores → light Q on alerts only → watch enqueue (no cold full pipeline).
            {data?.rule ? ` Rule: ${data.rule}` : ""}
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => refetch()}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-2">
        {[
          { label: "Plays ranked", value: counts.plays ?? 0 },
          { label: "TAKE", value: counts.take ?? 0, tone: "text-emerald-400" },
          { label: "NEAR", value: counts.near ?? 0, tone: "text-amber-400" },
          { label: "WATCH", value: counts.watch ?? 0 },
          { label: "Traders", value: counts.traders ?? 0 },
          { label: "Unusual mkts", value: counts.unusualMarkets ?? 0 },
          { label: "Z-alerts", value: counts.potentialInsiders ?? 0, tone: "text-amber-400" },
          { label: "Hot enqueued", value: counts.hotEnqueued ?? 0, tone: "text-emerald-400" },
          { label: "Books scanned", value: counts.booksScanned ?? 0 },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-3">
              <div className={`text-lg font-bold tabular-nums ${s.tone || ""}`}>{s.value}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {dataUpdatedAt ? (
        <div className="text-[10px] text-muted-foreground">
          Updated {new Date(dataUpdatedAt).toLocaleString()}
          {data?.generatedAt ? ` · pipeline ${String(data.generatedAt).slice(0, 19)} UTC` : ""}
        </div>
      ) : null}

      {isLoading && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading Prediction Insiders…</CardContent></Card>
      )}
      {error && (
        <Card><CardContent className="p-6 text-sm text-red-400">Could not load Prediction Insiders.</CardContent></Card>
      )}

      {!isLoading && !error && (
        <Tabs defaultValue="plays" className="w-full">
          <TabsList className="grid w-full max-w-2xl grid-cols-4">
            <TabsTrigger value="plays" className="gap-1.5">
              <ListOrdered className="w-3.5 h-3.5" /> Plays
            </TabsTrigger>
            <TabsTrigger value="unusual" className="gap-1.5">
              <Radar className="w-3.5 h-3.5" /> Unusual
            </TabsTrigger>
            <TabsTrigger value="traders" className="gap-1.5">
              <Users className="w-3.5 h-3.5" /> Traders
            </TabsTrigger>
            <TabsTrigger value="discover" className="gap-1.5">
              <Telescope className="w-3.5 h-3.5" /> Discover
            </TabsTrigger>
          </TabsList>

          <TabsContent value="plays" className="space-y-3 mt-4">
            <div className="flex flex-wrap gap-2">
              {(["sports", "other", "futures"] as const).map((lane) => (
                <button
                  key={lane}
                  type="button"
                  onClick={() => setLaneTab(lane)}
                  className={`text-xs px-3 py-1 rounded-full border ${
                    laneTab === lane ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {laneLabel(lane)}
                  {lane === "sports" ? ` (${laneCounts.sports})` : lane === "other" ? ` (${laneCounts.other})` : ` (${laneCounts.futures})`}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {(["all", "take", "near", "watch"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setPlayFilter(f)}
                  className={`text-xs px-3 py-1 rounded-full border ${
                    playFilter === f ? "bg-muted text-foreground border-border" : "border-border text-muted-foreground"
                  }`}
                >
                  {f === "all" ? "All tiers" : f.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Default view is <strong>Sports (live / upcoming)</strong> only — politics, macro, and season-long futures are on separate tabs.
              TAKE = Sniper (Q≥60, sport lane +5%, 2× stake).
            </p>
            {plays.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  No {laneLabel(laneTab).toLowerCase()} plays in this filter.
                  {laneTab === "sports" ? " Live copy books may have no open game lines right now — check Futures or Politics tabs." : ""}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {plays.map((p) => (
                  <PlayCard key={p.id} p={p} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="unusual" className="space-y-4 mt-4">
            <div className="flex flex-wrap gap-2">
              {(["sports", "macro"] as const).map((lane) => (
                <button
                  key={lane}
                  type="button"
                  onClick={() => setUnusualLane(lane)}
                  className={`text-xs px-3 py-1 rounded-full border ${
                    unusualLane === lane ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {lane === "sports" ? "Sports unusual flow" : "Politics / macro unusual"}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground max-w-3xl">
              Same idea as{" "}
              <a href="https://unusualwhales.com/predictions/insiders" target="_blank" rel="noreferrer" className="text-primary">
                Unusual Whales Potential Insiders
              </a>{" "}
              / Hashdive: per-market holder Z-score (size vs peers), concentration, shallow trade depth,
              and capital-weighted smart gap from our known Q books. Free Polymarket /holders — no paid UW API.
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-medium">Markets by unusual score</div>
                {unusualMarkets.length === 0 ? (
                  <Card>
                    <CardContent className="p-4 text-xs text-muted-foreground">
                      Run python3 pnl_analysis/scan_unusual_flow.py (or refresh_product).
                    </CardContent>
                  </Card>
                ) : (
                  unusualMarkets.slice(0, 12).map((m) => <UnusualMarketCard key={m.rank} m={m} />)
                )}
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">Potential insider alerts</div>
                {potentialInsiders.length === 0 ? (
                  <Card>
                    <CardContent className="p-4 text-xs text-muted-foreground">No Z-score alerts yet.</CardContent>
                  </Card>
                ) : (
                  potentialInsiders.slice(0, 15).map((r) => (
                    <InsiderAlertRow key={`${r.wallet}-${r.market}-${r.rank}`} r={r} />
                  ))
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="traders" className="space-y-3 mt-4">
            <div className="flex flex-wrap gap-2">
              {(["all", "live", "bench", "watch"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setTraderFilter(f)}
                  className={`text-xs px-3 py-1 rounded-full border ${
                    traderFilter === f ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {f === "all" ? "All digested" : f}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Excellence score blends tail digest, take-rule backtest, insider rank, and adaptive lab composite.
              Promote only when take-rule n≥12 and +ROI on a joinable book.
            </p>
            <div className="space-y-2">
              {traders.map((t, i) => (
                <TraderCard key={t.wallet} t={t} rank={i + 1} />
              ))}
            </div>
            <Link href="/ranks" className="text-xs text-primary inline-flex items-center gap-1">
              <Trophy className="w-3 h-3" /> Full Insider Ranks table →
            </Link>
          </TabsContent>

          <TabsContent value="discover" className="space-y-4 mt-4">
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="font-medium text-sm flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  Trust surface · real ROI
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Golden rule: ROI from as-of CSV / take-health windows — never live API PnL guesses.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                  <div className="border border-border/40 rounded-md p-2 space-y-0.5">
                    <div className="font-medium">Take health</div>
                    <div className="text-muted-foreground">
                      {data?.trust?.takeHealth?.status || "—"}
                      {data?.trust?.takeHealth?.pause_reason
                        ? ` · ${data.trust.takeHealth.pause_reason}`
                        : ""}
                    </div>
                    {(["last_30d", "last_60d", "all"] as const).map((k) => {
                      const w = data?.trust?.takeHealth?.windows?.[k];
                      if (!w?.n) return null;
                      return (
                        <div key={k} className="tabular-nums text-muted-foreground">
                          {k.replace("last_", "")}: n={w.n} · {w.roi_2c ?? "—"}% ROI
                        </div>
                      );
                    })}
                  </div>
                  <div className="border border-border/40 rounded-md p-2 space-y-0.5">
                    <div className="font-medium">Walk-forward</div>
                    <div className="text-muted-foreground">
                      {data?.trust?.walkforward?.best_at_2c_slip_n50?.id || "best @ +2¢"}
                    </div>
                    {data?.trust?.walkforward?.best_at_2c_slip_n50?.n != null ? (
                      <div className="tabular-nums text-muted-foreground">
                        n={data.trust.walkforward.best_at_2c_slip_n50.n} ·{" "}
                        {data.trust.walkforward.best_at_2c_slip_n50.roi ?? "—"}% ROI ·{" "}
                        {data.trust.walkforward.best_at_2c_slip_n50.win_rate ?? "—"}% WR
                      </div>
                    ) : (
                      <div className="text-muted-foreground">Run walkforward backtest for bands</div>
                    )}
                  </div>
                  <div className="border border-border/40 rounded-md p-2 space-y-0.5">
                    <div className="font-medium">Bankroll / sizing</div>
                    {data?.trust?.bankroll?.flat_100?.n != null ? (
                      <>
                        <div className="tabular-nums text-muted-foreground">
                          Flat $100: n={data.trust.bankroll.flat_100.n} ·{" "}
                          {data.trust.bankroll.flat_100.roi_on_start ?? "—"}% · Sharpe{" "}
                          {data.trust.bankroll.flat_100.sharpe_daily_roi ?? "—"}
                        </div>
                        <div className="tabular-nums text-muted-foreground">
                          Half-Kelly avg stake $
                          {Math.round(data.trust.bankroll.sizing?.kelly_half?.avg_stake ?? 100)}
                        </div>
                      </>
                    ) : (
                      <div className="text-muted-foreground">Bankroll file missing — default $100</div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="font-medium text-sm flex items-center gap-2">
                  <Radar className="w-4 h-4 text-primary" />
                  Automation heartbeat
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Always-on while the server runs: hot discover 10m · grade micro 15m · promote 45m · full pipeline when ingest is stale.
                  See <code className="text-[10px]">pnl_analysis/ELITE_AUTOMATION.md</code>.
                </p>
                <EliteHeartbeat />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-medium text-sm flex items-center gap-2">
                  <Radar className="w-4 h-4 text-emerald-400" />
                  Hot wallet discoveries ({data?.counts?.hotEnqueued ?? data?.hotDiscoveries?.counts?.watch_roster ?? 0})
                </div>
                <p className="text-[11px] text-muted-foreground">
                  UW/OddsJam pattern: top markets → holder Z≥2 → light Q on alerts only → watch.
                  Sports and politics/macro stay separate. Full CSV only after enqueue — never a cold roster pipeline.
                  {data?.hotDiscoveries?.generated_at
                    ? ` Last pass ${String(data.hotDiscoveries.generated_at).slice(0, 19)} UTC.`
                    : ""}
                </p>
                {(data?.hotDiscoveries?.watch_roster?.length ?? 0) > 0 && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">On watch from hot discovery: </span>
                    {(data?.hotDiscoveries?.watch_roster || []).map((w) => w.username).filter(Boolean).join(", ")}
                  </div>
                )}
                <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  <span>Candidates: {data?.hotDiscoveries?.counts?.candidates ?? data?.counts?.hotCandidates ?? 0}</span>
                  <span>Scored: {data?.hotDiscoveries?.counts?.scored ?? 0}</span>
                  <span className="text-emerald-400">Roster watches: {data?.counts?.hotEnqueued ?? data?.hotDiscoveries?.counts?.watch_roster ?? 0}</span>
                  <span>This pass +{data?.hotDiscoveries?.counts?.enqueued ?? 0}</span>
                  <span>CSV fetched: {data?.hotDiscoveries?.counts?.csv_fetched ?? 0}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border/50">
                        <th className="py-1.5 pr-2">Trader</th>
                        <th className="py-1.5 pr-2">Lane</th>
                        <th className="py-1.5 pr-2">Z</th>
                        <th className="py-1.5 pr-2">Light Q</th>
                        <th className="py-1.5 pr-2">Action</th>
                        <th className="py-1.5 pr-2">Market</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.hotDiscoveries?.results || []).slice(0, 25).map((r) => (
                        <tr key={`${r.wallet}-${r.market}`} className="border-b border-border/30">
                          <td className="py-1.5 pr-2 font-medium">
                            {r.username || r.wallet?.slice(0, 10)}
                            {r.polymarket_profile || r.wallet ? (
                              <a
                                href={r.polymarket_profile || `https://polymarket.com/profile/${r.wallet}`}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-1 text-primary inline-flex"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : null}
                          </td>
                          <td className="py-1.5 pr-2">
                            <Badge
                              variant="outline"
                              className={
                                r.lane === "sports" || r.sports_ish
                                  ? "text-emerald-400 border-emerald-500/30"
                                  : "text-amber-400 border-amber-500/30"
                              }
                            >
                              {r.lane === "sports" || r.sports_ish ? "Sports" : "Politics/other"}
                            </Badge>
                          </td>
                          <td className="py-1.5 pr-2 tabular-nums">{r.z ?? "—"}</td>
                          <td className="py-1.5 pr-2 tabular-nums">{r.light?.light_q ?? "—"}</td>
                          <td className="py-1.5 pr-2">
                            <span className={r.action === "enqueue" ? "text-emerald-400" : "text-muted-foreground"}>
                              {r.action || "—"}
                            </span>
                          </td>
                          <td className="py-1.5 pr-2 text-muted-foreground max-w-[220px] truncate">
                            {r.market || "—"}
                          </td>
                        </tr>
                      ))}
                      {(data?.hotDiscoveries?.results || []).length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-3 text-muted-foreground">
                            No hot pass yet — loop runs every 10m, or POST /api/hot-wallet-discover.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="font-medium text-sm">Live copy roster</div>
                <div className="text-xs text-muted-foreground">
                  {(data?.discovery?.live || []).map((t) => t.username).filter(Boolean).join(", ") || "—"}
                </div>
              </CardContent>
            </Card>

            {(data?.discovery?.autoPromote?.promoted?.length ?? 0) > 0 && (
              <Card>
                <CardContent className="p-4 space-y-1">
                  <div className="font-medium text-sm text-emerald-400">Recently auto-promoted</div>
                  {(data?.discovery?.autoPromote?.promoted || []).map((p) => (
                    <div key={p.username} className="text-xs">
                      {p.username}: {p.why}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {(data?.discovery?.adaptiveActions?.length ?? 0) > 0 && (
              <Card>
                <CardContent className="p-4 space-y-1">
                  <div className="font-medium text-sm">Pipeline actions</div>
                  {(data?.discovery?.adaptiveActions || []).slice(0, 8).map((a) => (
                    <div key={`${a.action}-${a.username}`} className="text-xs text-muted-foreground">
                      <span className="text-amber-500">{a.action}</span>: {a.username} — {a.why}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-medium text-sm flex items-center gap-2">
                  <Telescope className="w-4 h-4 text-primary" />
                  New Polydata finds ({data?.newFinds?.length ?? 0})
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Month/week sports board survivors with PnL/vol ≥ 5%. Added to watch automatically;
                  need unique CSV + take-rule proof before live.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border/50">
                        <th className="py-1.5 pr-2">Trader</th>
                        <th className="py-1.5 pr-2">Window</th>
                        <th className="py-1.5 pr-2">Rank</th>
                        <th className="py-1.5 pr-2">PnL</th>
                        <th className="py-1.5 pr-2">PnL/vol</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.newFinds || []).slice(0, 20).map((r) => (
                        <tr key={r.wallet} className="border-b border-border/30">
                          <td className="py-1.5 pr-2 font-medium">
                            {r.username}
                            {r.wallet && (
                              <a
                                href={`https://polymarket.com/profile/${r.wallet}`}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-1 text-primary inline-flex"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </td>
                          <td className="py-1.5 pr-2">{r.window}</td>
                          <td className="py-1.5 pr-2">#{r.rank}</td>
                          <td className="py-1.5 pr-2 tabular-nums">{money(r.pnl ?? null)}</td>
                          <td className="py-1.5 pr-2 tabular-nums">
                            {r.pnl_vol != null ? `${(r.pnl_vol * 100).toFixed(1)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
