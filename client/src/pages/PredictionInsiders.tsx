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
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";

interface RankedPlay {
  id: string;
  rank?: number;
  list?: "take" | "near" | "watch";
  grade?: number;
  q?: number;
  rel?: number;
  sport?: string;
  submarket?: string;
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
  };
  plays?: RankedPlay[];
  traders?: ExcellenceTrader[];
  newFinds?: PolydataFind[];
  discovery?: {
    live?: Array<{ username?: string; uniqueRoi?: number }>;
    adaptiveActions?: Array<{ action?: string; username?: string; why?: string }>;
    autoPromote?: { promoted?: Array<{ username?: string; why?: string }> };
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

export default function PredictionInsiders() {
  const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery<PredictionInsidersResponse>({
    queryKey: ["/api/prediction-insiders"],
    staleTime: 8_000,
    refetchInterval: 15_000,
  });

  const [playFilter, setPlayFilter] = useState<"all" | "take" | "near" | "watch">("all");
  const [traderFilter, setTraderFilter] = useState<"all" | "live" | "bench" | "watch">("all");

  const plays = useMemo(() => {
    const rows = data?.plays || [];
    if (playFilter === "all") return rows;
    return rows.filter((p) => p.list === playFilter);
  }, [data?.plays, playFilter]);

  const traders = useMemo(() => {
    const rows = data?.traders || [];
    if (traderFilter === "all") return rows;
    return rows.filter((t) => t.bucket === traderFilter);
  }, [data?.traders, traderFilter]);

  const counts = data?.counts || {};

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5" data-testid="page-prediction-insiders">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" /> Prediction Insiders
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Ranked plays & trader excellence</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            OddsJam-style intelligence: every open graded 0–100 with why, traders ranked on unique-book edge,
            and new Polydata names surfaced before they go live.
            {data?.rule ? ` Rule: ${data.rule}` : ""}
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => refetch()}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {[
          { label: "Plays ranked", value: counts.plays ?? 0 },
          { label: "TAKE", value: counts.take ?? 0, tone: "text-emerald-400" },
          { label: "NEAR", value: counts.near ?? 0, tone: "text-amber-400" },
          { label: "WATCH", value: counts.watch ?? 0 },
          { label: "Traders digested", value: counts.traders ?? 0 },
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
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="plays" className="gap-1.5">
              <ListOrdered className="w-3.5 h-3.5" /> Plays
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
              {(["all", "take", "near", "watch"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setPlayFilter(f)}
                  className={`text-xs px-3 py-1 rounded-full border ${
                    playFilter === f ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {f === "all" ? "All" : f.toUpperCase()}
                </button>
              ))}
            </div>
            {plays.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  No plays in this filter. The board scans live + bench + watch CSV books every pipeline run.
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
