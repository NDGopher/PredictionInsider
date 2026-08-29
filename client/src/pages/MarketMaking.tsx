import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, RefreshCw, ShieldAlert } from "lucide-react";
import { Link } from "wouter";

interface MmBook {
  username?: string;
  wallet?: string;
  has_csv?: boolean;
  analysis?: {
    overall_roi?: number;
    win_rate?: number;
    hedge_count?: number;
    hedge_profit?: number;
    dashboard_pnl?: number;
    median_stake?: number;
    last_30d?: { n?: number; roi?: number; pnl?: number };
  };
  csv_sim?: {
    rows_sampled?: number;
    conditions?: number;
    hedge_markets?: { n?: number; pnl?: number; roi_pct?: number; win_rate?: number };
    directional_markets?: { n?: number; pnl?: number; roi_pct?: number };
    maker_sim?: {
      avg_locked_edge?: number | null;
      median_locked_edge?: number | null;
      positive_edge_pct?: number | null;
      proj_pnl_per_100_hedges?: number | null;
      caveat?: string;
    };
  };
}

interface MmResponse {
  generated_at?: string;
  method?: string;
  feasibility?: {
    can_we_automate_today?: boolean;
    why_not_yet?: string[];
    what_is_viable_near_term?: string[];
    hist_avg_locked_edge?: number | null;
    verdict?: string;
  };
  books?: MmBook[];
  counts?: { books?: number };
}

export default function MarketMaking() {
  const { data, isLoading, error, refetch } = useQuery<MmResponse>({
    queryKey: ["/api/mm-research"],
    staleTime: 60_000,
  });
  const feas = data?.feasibility;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6" data-testid="page-mm-research">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Separate lane · research only · no live quoting
          </div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Market Making
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Deep dive on mega/MM books (RN1-class). Estimates hedge inventory edge from history.
            Not Take these. Not a $100 copy bot.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
          <Link href="/" className="text-xs text-primary">Take these →</Link>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <div className="font-medium text-sm">Can we automate MM on Polymarket?</div>
            <Badge variant={feas?.can_we_automate_today ? "default" : "outline"}>
              {feas?.can_we_automate_today ? "Yes" : "Not yet"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{feas?.verdict || (isLoading ? "Loading…" : "Run npm run research:mm")}</p>
          {feas?.hist_avg_locked_edge != null && (
            <div className="text-xs">Hist avg locked edge (yesVWAP+noVWAP): <span className="font-mono">{feas.hist_avg_locked_edge}</span></div>
          )}
          <div className="grid md:grid-cols-2 gap-3 text-xs">
            <div>
              <div className="font-medium mb-1">Why not live automate yet</div>
              <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                {(feas?.why_not_yet || []).map((w) => <li key={w}>{w}</li>)}
              </ul>
            </div>
            <div>
              <div className="font-medium mb-1">Near-term viable</div>
              <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                {(feas?.what_is_viable_near_term || []).map((w) => <li key={w}>{w}</li>)}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <Card><CardContent className="p-4 text-sm text-red-400">Could not load /api/mm-research. Run npm run research:mm</CardContent></Card>}

      <div className="space-y-2">
        {(data?.books || []).map((b) => {
          const a = b.analysis || {};
          const h = b.csv_sim?.hedge_markets || {};
          const d = b.csv_sim?.directional_markets || {};
          const sim = b.csv_sim?.maker_sim || {};
          return (
            <Card key={b.username || b.wallet}>
              <CardContent className="p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-semibold">{b.username}</div>
                  {a.overall_roi != null && <Badge variant="outline">ROI {a.overall_roi}%</Badge>}
                  {a.hedge_count != null && <Badge variant="outline">hedges {a.hedge_count}</Badge>}
                  {sim.avg_locked_edge != null && (
                    <Badge className="tabular-nums">edge {sim.avg_locked_edge}</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground grid sm:grid-cols-3 gap-2">
                  <div>Hedge markets: n={h.n ?? "—"} PnL=${h.pnl ?? "—"} ROI={h.roi_pct ?? "—"}%</div>
                  <div>Directional: n={d.n ?? "—"} PnL=${d.pnl ?? "—"} ROI={d.roi_pct ?? "—"}%</div>
                  <div>Sim $/100 hedges: {sim.proj_pnl_per_100_hedges ?? "—"}</div>
                </div>
                {sim.caveat && <div className="text-[11px] text-muted-foreground">{sim.caveat}</div>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
