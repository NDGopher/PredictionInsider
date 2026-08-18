import { useMemo, useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle, ChevronDown, ChevronUp, ExternalLink, Trophy, Flame, CheckCircle2,
} from "lucide-react";

interface RankWindow {
  n?: number | null;
  pnl?: number | null;
  wr?: number | null;
  roi?: number | null;
  first?: string | null;
  last?: string | null;
}

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
  last_30d_roi?: number | null;
  last_30d_n?: number | null;
  last_60d_pnl?: number | null;
  last_60d_wr?: number | null;
  last_60d_roi?: number | null;
  last_60d_n?: number | null;
  last_90d_pnl?: number | null;
  last_90d_wr?: number | null;
  last_90d_roi?: number | null;
  last_90d_n?: number | null;
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

interface RankAccuracy {
  wr_delta_pp?: number | null;
  pnl_ratio?: number | null;
  matched?: boolean;
  note?: string;
}

interface InsiderRankRow {
  username: string;
  wallet: string;
  on_roster?: boolean;
  lane?: string;
  take_book?: boolean;
  score_source?: string;
  insider_rank?: number;
  insider_score: number;
  badge?: string;
  copyable?: boolean;
  copy_note?: string;
  recency_band?: string;
  days_since_last?: number | null;
  polymarket_url?: string;
  our?: InsiderOurMetrics;
  windows?: {
    last_30d?: RankWindow | null;
    last_60d?: RankWindow | null;
    last_90d?: RankWindow | null;
  };
  book?: { rows?: number; closed?: number; open?: number; winner_capped?: boolean; book_note?: string };
  polydata?: PolydataReference;
  accuracy?: RankAccuracy;
  pnl_vs_polydata?: { ratio?: number | null; flag?: boolean; note?: string };
  components?: Record<string, number>;
  health_action?: string;
  extra_status?: string;
  winner_capped?: boolean;
  market_maker?: boolean;
}

interface SportsBoardRow {
  username: string;
  on_roster?: boolean;
  lane?: string;
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

type SortKey = "insider" | "sports" | "our_pnl" | "smart" | "last";
type FilterKey = "hot" | "take_book" | "watch" | "kicked" | "roster" | "all";

function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const sign = v >= 0 ? "+" : "−";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(digits)}%`;
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

function laneClass(lane: string | undefined): string {
  if (lane === "take_book") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (lane === "watch") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (lane === "kicked") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (lane === "reference") return "bg-muted text-muted-foreground";
  return "bg-sky-500/15 text-sky-400 border-sky-500/30";
}

function laneLabel(lane: string | undefined): string {
  if (lane === "take_book") return "take book";
  if (lane === "watch") return "watch";
  if (lane === "kicked") return "kicked";
  if (lane === "reference") return "ref";
  return "roster";
}

function badgeClass(badge: string | undefined): string {
  if (badge === "Elite") return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  if (badge === "Diamond") return "bg-sky-500/15 text-sky-400 border-sky-500/30";
  if (badge === "Gold") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-muted text-muted-foreground";
}

function accuracyClass(acc: RankAccuracy | undefined): string {
  if (acc?.matched) return "text-emerald-400";
  if (acc?.note === "wr_gap" || acc?.note === "magnitude_gap") return "text-amber-400";
  if (acc?.note === "sign_mismatch") return "text-red-400";
  return "text-muted-foreground";
}

function freshness(iso: string | null | undefined): string {
  if (!iso) return "not built";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours}h ago`;
  return new Date(iso).toLocaleString();
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

function WindowCell({ label, w }: { label: string; w?: RankWindow | null }) {
  if (!w) return <div>{label} <span className="text-muted-foreground">—</span></div>;
  return (
    <div>
      {label}{" "}
      <span className={`font-medium ${pnlClass(w.pnl)}`}>{money(w.pnl)}</span>
      <span className="text-muted-foreground"> · {pct(w.wr)} WR · {pct(w.roi, 1)} ROI · n={w.n ?? "—"}</span>
    </div>
  );
}

export default function Ranks() {
  const [sortBy, setSortBy] = useState<SortKey>("insider");
  const [filter, setFilter] = useState<FilterKey>("hot");
  const [open, setOpen] = useState<string | null>(null);

  const { data, isLoading, error, dataUpdatedAt } = useQuery<InsiderRanksResponse>({
    queryKey: ["/api/insider-ranks"],
    queryFn: async () => {
      const res = await fetch("/api/insider-ranks", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load insider ranks");
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const rows = useMemo(() => {
    let list = [...(data?.traders || [])];
    if (filter === "hot") {
      list = list.filter(
        (t) =>
          (t.recency_band === "HOT" || t.recency_band === "WARM") &&
          t.lane !== "kicked" &&
          t.lane !== "reference",
      );
    }
    if (filter === "take_book") list = list.filter((t) => t.lane === "take_book" || t.copyable);
    if (filter === "watch") list = list.filter((t) => t.lane === "watch");
    if (filter === "kicked") list = list.filter((t) => t.lane === "kicked");
    if (filter === "roster") list = list.filter((t) => t.on_roster && t.lane !== "kicked");
    list.sort((a, b) => {
      if (sortBy === "sports") {
        const ar = a.polydata?.sports_rank ?? 9_999;
        const br = b.polydata?.sports_rank ?? 9_999;
        return ar - br;
      }
      if (sortBy === "our_pnl") return (b.our?.dashboard_pnl || 0) - (a.our?.dashboard_pnl || 0);
      if (sortBy === "smart") return (b.polydata?.smart_score || 0) - (a.polydata?.smart_score || 0);
      if (sortBy === "last") {
        const ad = a.our?.last_event_date || "";
        const bd = b.our?.last_event_date || "";
        return bd.localeCompare(ad);
      }
      return (b.insider_score || 0) - (a.insider_score || 0);
    });
    return list;
  }, [data, sortBy, filter]);

  const board = (data?.polydataSportsBoard || []).filter((b) => b.lane === "take_book" || b.copyable).slice(0, 12);
  const pdBoard = board.length > 0 ? board : (data?.polydataSportsBoard || []).slice(0, 12);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          Insider Ranks
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Default view is <span className="text-foreground">Hot now</span> — traders who printed in the last two weeks.
          The old matched 12 still live under Take book (Capman / tcp2 / kch123 are history, not live copy).
          Kicked stays visible so you can see grinders we removed. Elite Traders is retired.
        </p>
        <p className="text-[11px] text-muted-foreground mt-1" data-testid="ranks-freshness">
          Built {freshness(data?.generatedAt)} · as of {data?.asOf || "—"}
          {dataUpdatedAt ? ` · UI ${freshness(new Date(dataUpdatedAt).toISOString())}` : ""}
        </p>
      </div>

      <Card className="border-sky-500/20 bg-sky-500/5">
        <CardContent className="p-3 space-y-2">
          <div className="text-xs text-muted-foreground">
            Our books are product truth (closed + open CSVs). Polydata Smart Score / sports rank is calibration.
            Accuracy <span className="text-foreground">matched</span> means our WR is within 6pp of Polydata and PnL is the same sign.
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

      {pdBoard.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            Polydata sports board (take-book first)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {pdBoard.map((b) => (
              <Card key={b.username} className="bg-muted/30">
                <CardContent className="p-2.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] text-muted-foreground">#{b.sports_rank}</span>
                    <Badge variant="outline" className={`text-[9px] h-4 px-1 ${laneClass(b.lane)}`}>
                      {laneLabel(b.lane)}
                    </Badge>
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
          ["hot", "Hot now"],
          ["take_book", "Take book"],
          ["watch", "Watch"],
          ["kicked", "Kicked"],
          ["roster", "Roster"],
          ["all", "All"],
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
          ["last", "Last trade"],
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
            {data.counts.take_book ?? data.counts.copyable ?? 0} take book · {data.counts.kicked ?? 0} kicked · {data.counts.accuracy_matched ?? 0} matched PD
          </span>
        )}
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}
      {error && (
        <div className="text-sm text-red-500 p-4 rounded-md bg-red-500/10">
          Failed to load ranks. Run <code>npm run backtest:ranks</code>.
        </div>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <div className="text-sm text-muted-foreground p-4">No traders in this filter.</div>
      )}

      {!isLoading && !error && rows.length > 0 && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Trader</TableHead>
                  <TableHead>Lane</TableHead>
                  <TableHead className="text-right">Insider</TableHead>
                  <TableHead>Recency</TableHead>
                  <TableHead>Last</TableHead>
                  <TableHead className="text-right">Our PnL</TableHead>
                  <TableHead className="text-right">ROI</TableHead>
                  <TableHead className="text-right">Our WR</TableHead>
                  <TableHead className="text-right">30d</TableHead>
                  <TableHead>vs PD</TableHead>
                  <TableHead className="text-right">PD Sports</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => {
                  const key = t.wallet || t.username;
                  const expanded = open === key;
                  const acc = t.accuracy;
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
                            {acc?.matched && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                          </div>
                          <div className="flex gap-1 mt-0.5">
                            <Badge variant="outline" className={`text-[9px] h-4 px-1 ${badgeClass(t.badge)}`}>
                              {t.badge || "—"}
                            </Badge>
                            {t.health_action && t.lane === "take_book" && t.health_action !== "KEEP" && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1 text-amber-400 border-amber-500/30">
                                health {t.health_action}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[9px] ${laneClass(t.lane)}`}>
                            {laneLabel(t.lane)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {t.insider_score.toFixed(1)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[9px] ${recencyClass(t.recency_band)}`}>
                            {t.recency_band || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                          {t.our?.last_event_date || "—"}
                          {t.days_since_last != null && (
                            <span className="block text-[10px]">{t.days_since_last}d ago</span>
                          )}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${pnlClass(t.our?.dashboard_pnl)}`}>
                          {money(t.our?.dashboard_pnl)}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${pnlClass(t.our?.roi)}`}>
                          {pct(t.our?.roi, 1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.our?.win_rate != null ? `${t.our.win_rate.toFixed(0)}%` : "—"}
                          {t.polydata?.win_rate != null && (
                            <span className="block text-[10px] text-muted-foreground">PD {t.polydata.win_rate}%</span>
                          )}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums text-xs ${pnlClass(t.our?.last_30d_pnl)}`}>
                          {money(t.our?.last_30d_pnl)}
                          {t.our?.last_30d_roi != null && (
                            <span className="block text-[10px] text-muted-foreground">{pct(t.our.last_30d_roi, 0)}</span>
                          )}
                        </TableCell>
                        <TableCell className={`text-xs ${accuracyClass(acc)}`}>
                          {acc?.matched ? "matched" : (acc?.note || "—")}
                          {acc?.wr_delta_pp != null && (
                            <span className="block text-[10px] tabular-nums">
                              WR {acc.wr_delta_pp >= 0 ? "+" : ""}{acc.wr_delta_pp.toFixed(1)}pp
                            </span>
                          )}
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
                        <TableCell>
                          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${key}-detail`}>
                          <TableCell colSpan={13} className="bg-muted/20">
                            <div className="text-xs space-y-2 py-1">
                              <div className="text-muted-foreground">{t.copy_note}</div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                                <WindowCell label="30d" w={t.windows?.last_30d} />
                                <WindowCell label="60d" w={t.windows?.last_60d} />
                                <WindowCell label="90d" w={t.windows?.last_90d} />
                              </div>
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
                                <div>PF (PD) <span className="font-medium">{t.polydata?.profit_factor ?? "—"}</span></div>
                                <div>Markets / events <span className="font-medium">{t.our?.markets ?? 0} / {t.our?.events ?? 0}</span></div>
                                <div>Book <span className="font-medium">{t.book?.book_note} · {t.book?.closed ?? 0} closed · {t.book?.open ?? 0} open</span></div>
                                <div>Our PnL <span className={pnlClass(t.our?.dashboard_pnl)}>{money(t.our?.dashboard_pnl)}</span></div>
                                <div>PD PnL <span className={pnlClass(t.polydata?.pnl)}>{money(t.polydata?.pnl)}</span></div>
                                <div>Gap vs PD <span className="font-medium">{t.pnl_vs_polydata?.note || "—"} {t.pnl_vs_polydata?.ratio != null ? `(${t.pnl_vs_polydata.ratio}x)` : ""}</span></div>
                                <div>Top sport <span className="font-medium">{t.our?.top_sport || "—"}</span></div>
                                <div>Tier / Q <span className="font-medium">{t.our?.tier || "—"} · {t.our?.quality_score ?? "—"}</span></div>
                                <div>Health <span className="font-medium">{t.health_action || "—"}</span></div>
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
                                {t.polymarket_url && (
                                  <a
                                    href={t.polymarket_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[11px] text-sky-400 hover:underline inline-flex items-center gap-0.5"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <ExternalLink className="w-3 h-3" /> Polymarket
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
