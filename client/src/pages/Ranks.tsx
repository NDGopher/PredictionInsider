import { useMemo, useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle, ChevronDown, ChevronUp, ExternalLink, Trophy, Flame,
} from "lucide-react";

interface InsiderOurMetrics {
  dashboard_pnl?: number | null;
  roi?: number | null;
  win_rate?: number | null;
  sharpe?: number | null;
  profit_factor?: number | null;
  median_stake?: number | null;
  markets?: number | null;
  events?: number | null;
  hedge_frac?: number | null;
  last_30d_pnl?: number | null;
  last_30d_wr?: number | null;
  last_90d_pnl?: number | null;
  quality_score?: number | null;
  tier?: string | null;
  top_sport?: string | null;
  last_event_date?: string | null;
}

interface PolydataReference {
  url?: string;
  ok?: boolean;
  error?: string;
  smart_score?: number | null;
  win_rate?: number | null;
  pnl?: number | null;
  overall_rank?: number | null;
  sports_rank?: number | null;
  sports_pnl?: number | null;
  sports_volume?: number | null;
  profit_factor?: number | null;
  sharpe?: number | null;
  sortino?: number | null;
  hhi?: number | null;
  kelly_pct?: number | null;
  bot_score?: number | null;
  bot_class?: string | null;
  trades_per_day?: number | null;
}

interface InsiderRankRow {
  username: string;
  wallet: string;
  on_roster?: boolean;
  score_source?: string;
  insider_rank?: number;
  insider_score: number;
  badge?: string;
  copyable?: boolean;
  copy_note?: string;
  recency_band?: string;
  our?: InsiderOurMetrics;
  book?: { closed?: number; winner_capped?: boolean; book_note?: string };
  polydata?: PolydataReference;
  pnl_vs_polydata?: { ratio?: number | null; flag?: boolean; note?: string };
  components?: Record<string, number>;
  winner_capped?: boolean;
  market_maker?: boolean;
}

interface SportsBoardRow {
  username: string;
  on_roster?: boolean;
  sports_rank?: number | null;
  sports_pnl?: number | null;
  smart_score?: number | null;
  win_rate?: number | null;
  profit_factor?: number | null;
  insider_score?: number;
  copyable?: boolean;
}

interface InsiderRanksResponse {
  generatedAt?: string | null;
  asOf?: string | null;
  method?: string | null;
  weights?: Record<string, number> | null;
  polydataWeights?: Record<string, number> | null;
  counts?: Record<string, number> | null;
  polydataSportsBoard?: SportsBoardRow[];
  traders?: InsiderRankRow[];
}

type SortKey = "insider" | "sports" | "our_pnl" | "smart";
type FilterKey = "all" | "copyable" | "hot" | "roster";

function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const sign = v >= 0 ? "+" : "−";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function pnlClass(v: number | null | undefined): string {
  if (v === null || v === undefined) return "text-muted-foreground";
  return v >= 0 ? "text-emerald-400" : "text-red-400";
}

function recencyClass(band: string | undefined): string {
  if (band === "HOT") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (band === "WARM") return "bg-sky-500/15 text-sky-400 border-sky-500/30";
  if (band === "COLD") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (band === "DARK" || band === "DROP") return "bg-red-500/15 text-red-400 border-red-500/30";
  return "bg-muted text-muted-foreground";
}

function badgeClass(badge: string | undefined): string {
  if (badge === "Elite") return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  if (badge === "Diamond") return "bg-sky-500/15 text-sky-400 border-sky-500/30";
  if (badge === "Gold") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-muted text-muted-foreground";
}

function WeightPills({ weights }: { weights: Record<string, number> | null | undefined }) {
  if (!weights) return null;
  const labels: Record<string, string> = {
    pnl_consistency: "PnL",
    wr_quality: "WR",
    risk: "Risk",
    diversification: "Div",
    recency: "Recency",
    copyability: "Copy",
    risk_management: "Risk",
    timing_execution: "Timing",
    bot_penalty: "Bot",
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(weights).map(([k, w]) => (
        <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/70 text-muted-foreground">
          {labels[k] || k} {(w * 100).toFixed(0)}%
        </span>
      ))}
    </div>
  );
}

function ComponentBars({ components }: { components?: Record<string, number> }) {
  if (!components) return null;
  const order = ["pnl_consistency", "wr_quality", "risk", "diversification", "recency", "copyability"];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
      {order.map((key) => {
        const v = components[key] ?? 0;
        return (
          <div key={key}>
            <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
              <span className="capitalize">{key.replace(/_/g, " ")}</span>
              <span className="tabular-nums">{v.toFixed(0)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary/80"
                style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Ranks() {
  const [sortBy, setSortBy] = useState<SortKey>("insider");
  const [filter, setFilter] = useState<FilterKey>("copyable");
  const [open, setOpen] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<InsiderRanksResponse>({
    queryKey: ["/api/insider-ranks"],
    queryFn: async () => {
      const res = await fetch("/api/insider-ranks");
      if (!res.ok) throw new Error("Failed to load insider ranks");
      return res.json();
    },
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    let list = [...(data?.traders || [])];
    if (filter === "copyable") list = list.filter((t) => t.copyable);
    if (filter === "hot") list = list.filter((t) => t.recency_band === "HOT" || t.recency_band === "WARM");
    if (filter === "roster") list = list.filter((t) => t.on_roster);
    list.sort((a, b) => {
      if (sortBy === "sports") {
        const ar = a.polydata?.sports_rank ?? 9_999;
        const br = b.polydata?.sports_rank ?? 9_999;
        return ar - br;
      }
      if (sortBy === "our_pnl") return (b.our?.dashboard_pnl || 0) - (a.our?.dashboard_pnl || 0);
      if (sortBy === "smart") return (b.polydata?.smart_score || 0) - (a.polydata?.smart_score || 0);
      return (b.insider_score || 0) - (a.insider_score || 0);
    });
    return list;
  }, [data, sortBy, filter]);

  const board = (data?.polydataSportsBoard || []).slice(0, 12);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          Insider Ranks
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Polydata is calibration, not the take list. Default view is <span className="text-foreground">copyable</span> names. DROP/COLD/sign-mismatch books stay in All for research. Take these only copies the 12 matched sports books.
        </p>
      </div>

      <Card className="border-sky-500/20 bg-sky-500/5">
        <CardContent className="p-3 space-y-2">
          <div className="text-xs text-muted-foreground">
            Polydata scores traders with Smart Score, WR, profit factor, Sharpe, Sortino, HHI, Kelly, and
            sports-category rank. We keep those as a reference column. Insider Score swaps their timing/bot
            slots for <span className="text-foreground">recency</span> and{" "}
            <span className="text-foreground">copyability</span> so a HOT joinable 52% WR book beats a
            DARK $12M whale and a 98% favorite grinder.
          </div>
          <div className="flex flex-col sm:flex-row gap-3 text-[11px]">
            <div>
              <div className="text-muted-foreground mb-1">Our weights</div>
              <WeightPills weights={data?.weights} />
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Polydata Smart Score</div>
              <WeightPills weights={data?.polydataWeights} />
            </div>
          </div>
        </CardContent>
      </Card>

      {board.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            Polydata Sports board (scraped)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {board.map((b) => (
              <Card key={b.username} className="bg-muted/30">
                <CardContent className="p-2.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] text-muted-foreground">#{b.sports_rank}</span>
                    {b.on_roster ? (
                      <Badge variant="outline" className="text-[9px] h-4 px-1">ours</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] h-4 px-1 text-amber-400 border-amber-500/30">ref</Badge>
                    )}
                  </div>
                  <div className="text-xs font-medium truncate mt-0.5">{b.username}</div>
                  <div className={`text-sm font-semibold tabular-nums ${pnlClass(b.sports_pnl)}`}>
                    {money(b.sports_pnl)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    SS {b.smart_score ?? "—"} · WR {b.win_rate ?? "—"}% · PF {b.profit_factor ?? "—"}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Show:</span>
        {([
          ["all", "All"],
          ["roster", "Roster"],
          ["copyable", "Copyable"],
          ["hot", "HOT/WARM"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
              filter === k ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`filter-${k}`}
          >
            {label}
          </button>
        ))}
        <span className="text-xs text-muted-foreground ml-2">Sort:</span>
        {([
          ["insider", "Insider Score"],
          ["sports", "PD Sports #"],
          ["smart", "PD Smart Score"],
          ["our_pnl", "Our PnL"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSortBy(k)}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
              sortBy === k ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`sort-${k}`}
          >
            {label}
          </button>
        ))}
        {data?.counts && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {data.counts.copyable ?? 0} copyable · {data.counts.polydata_ok ?? 0} Polydata hits · as of {data.asOf}
          </span>
        )}
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}
      {error && (
        <div className="text-sm text-red-500 p-4 rounded-md bg-red-500/10">
          Failed to load ranks. Run <code>npm run backtest:ranks</code>.
        </div>
      )}

      {!isLoading && !error && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Trader</TableHead>
                  <TableHead className="text-right">Insider</TableHead>
                  <TableHead>Recency</TableHead>
                  <TableHead>Copy</TableHead>
                  <TableHead className="text-right">Our PnL</TableHead>
                  <TableHead className="text-right">Our WR</TableHead>
                  <TableHead className="text-right">PD Sports</TableHead>
                  <TableHead className="text-right">PD SS</TableHead>
                  <TableHead className="text-right">PD WR / PF</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => {
                  const key = t.wallet || t.username;
                  const expanded = open === key;
                  return (
                    <Fragment key={key}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setOpen(expanded ? null : key)}
                        data-testid={`rank-row-${t.username}`}
                      >
                        <TableCell className="tabular-nums text-muted-foreground">
                          {t.insider_rank ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm">{t.username}</span>
                            {t.recency_band === "HOT" && <Flame className="w-3 h-3 text-orange-400" />}
                            {t.winner_capped && (
                              <AlertTriangle className="w-3 h-3 text-amber-400" />
                            )}
                          </div>
                          <div className="flex gap-1 mt-0.5">
                            <Badge variant="outline" className={`text-[9px] h-4 px-1 ${badgeClass(t.badge)}`}>
                              {t.badge || "—"}
                            </Badge>
                            {!t.on_roster && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1">ref only</Badge>
                            )}
                            {t.score_source === "polydata_shadow" && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1">PD shadow</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {t.insider_score.toFixed(1)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[9px] ${recencyClass(t.recency_band)}`}>
                            {t.recency_band || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {t.copyable ? (
                            <span className="text-xs text-emerald-400">yes</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">no</span>
                          )}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${pnlClass(t.our?.dashboard_pnl)}`}>
                          {money(t.our?.dashboard_pnl)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.our?.win_rate != null ? `${t.our.win_rate.toFixed(0)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.polydata?.sports_rank != null ? (
                            <span>
                              #{t.polydata.sports_rank}
                              <span className={`block text-[10px] ${pnlClass(t.polydata.sports_pnl)}`}>
                                {money(t.polydata.sports_pnl)}
                              </span>
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.polydata?.smart_score ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {t.polydata?.win_rate != null ? `${t.polydata.win_rate}%` : "—"}
                          {t.polydata?.profit_factor != null && (
                            <span className="block text-[10px] text-muted-foreground">
                              PF {t.polydata.profit_factor}x
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${key}-detail`}>
                          <TableCell colSpan={11} className="bg-muted/20">
                            <div className="text-xs space-y-2 py-1">
                              <div className="text-muted-foreground">{t.copy_note}</div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <div>Sharpe (ours) <span className="font-medium">{t.our?.sharpe ?? "—"}</span></div>
                                <div>Sharpe (PD) <span className="font-medium">{t.polydata?.sharpe ?? "—"}</span></div>
                                <div>Sortino <span className="font-medium">{t.polydata?.sortino ?? "—"}</span></div>
                                <div>HHI <span className="font-medium">{t.polydata?.hhi ?? "—"}</span></div>
                                <div>Kelly <span className="font-medium">{t.polydata?.kelly_pct != null ? `${t.polydata.kelly_pct}%` : "—"}</span></div>
                                <div>Bot <span className="font-medium">{t.polydata?.bot_score ?? "—"} {t.polydata?.bot_class || ""}</span></div>
                                <div>Median stake <span className="font-medium">{money(t.our?.median_stake)}</span></div>
                                <div>Hedge frac <span className="font-medium">{t.our?.hedge_frac != null ? (t.our.hedge_frac * 100).toFixed(0) + "%" : "—"}</span></div>
                                <div>PF (ours) <span className="font-medium">{t.our?.profit_factor ?? "—"}</span></div>
                                <div>Book <span className="font-medium">{t.book?.book_note} · {t.book?.closed ?? 0} closed</span></div>
                                <div>30d PnL <span className={pnlClass(t.our?.last_30d_pnl)}>{money(t.our?.last_30d_pnl)}</span></div>
                                <div>Gap vs PD <span className="font-medium">{t.pnl_vs_polydata?.note || "—"}</span></div>
                              </div>
                              <ComponentBars components={t.components} />
                              <div className="flex gap-3 pt-1">
                                {t.polydata?.url && (
                                  <a
                                    href={t.polydata.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[11px] text-sky-400 hover:underline inline-flex items-center gap-0.5"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <ExternalLink className="w-3 h-3" /> Polydata
                                  </a>
                                )}
                                {t.on_roster && (
                                  <a
                                    href={`/elite/${t.wallet}`}
                                    className="text-[11px] text-muted-foreground hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Elite profile
                                  </a>
                                )}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
