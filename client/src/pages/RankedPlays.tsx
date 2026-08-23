import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink, ListOrdered, RefreshCw, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

interface RankedPlay {
  id: string;
  rank?: number;
  list?: "take" | "near";
  grade?: number;
  confidence?: number;
  q?: number;
  rel?: number;
  sport?: string;
  submarket?: string;
  playLabel?: string;
  pick?: string;
  marketQuestion?: string;
  traders?: string[];
  why?: string[];
  misses?: string[];
  takeCap?: number;
  liveAsk?: number | null;
  currentPrice?: number;
  sportRoi?: number | null;
  url?: string;
  slug?: string;
  valid?: boolean;
}

interface DiscoveryTrader {
  username?: string;
  bucket?: string;
  compositeScore?: number;
  joinability?: number;
  consistency?: number;
  takeN?: number;
  takeRoi?: number;
  action?: string;
  why?: string;
  uniqueRoi?: number;
  medianStake?: number;
  joinable?: boolean;
  last30n?: number;
  reasons?: string[];
}

interface TakePlaysResponse {
  rule?: string | null;
  ranked?: RankedPlay[];
  live?: RankedPlay[];
  near?: RankedPlay[];
  discovery?: {
    live?: DiscoveryTrader[];
    bench?: DiscoveryTrader[];
    watch?: DiscoveryTrader[];
    topComposite?: DiscoveryTrader[];
    adaptiveActions?: Array<{ action?: string; username?: string; why?: string; to?: string }>;
    proposeAdd?: Array<{ username?: string; reason?: string }>;
    autoPromote?: {
      promoted?: Array<{ username?: string; why?: string; regime?: string }>;
      demoted?: Array<{ username?: string; why?: string }>;
    };
    method?: string;
    generatedAt?: string | null;
  };
}

function gradeTone(g: number): string {
  if (g >= 75) return "text-emerald-400";
  if (g >= 60) return "text-primary";
  if (g >= 45) return "text-amber-400";
  return "text-muted-foreground";
}

export default function RankedPlays() {
  const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery<TakePlaysResponse>({
    queryKey: ["/api/take-plays"],
    staleTime: 8_000,
    refetchInterval: 12_000,
  });
  const [tab, setTab] = useState<"all" | "take" | "near">("all");
  const ranked = (data?.ranked || []).filter((p) => {
    if (tab === "take") return p.list === "take";
    if (tab === "near") return p.list === "near";
    return true;
  });
  const disc = data?.discovery;
  const top = disc?.topComposite || [];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6" data-testid="page-ranked-plays">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Play board · 0–100 grades</div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <ListOrdered className="w-5 h-5 text-primary" />
            Ranked Plays
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Sorted by grade. TAKE rows are recommended on the home screen. Expand why for Q, size, sport ROI, and score parts.
            {data?.rule ? ` Rule: ${data.rule}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
          <Link href="/" className="text-xs text-primary">Take these →</Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", "take", "near"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`text-xs px-3 py-1 rounded-full border ${
              tab === t ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"
            }`}
          >
            {t === "all" ? "All ranked" : t === "take" ? "Recommended TAKE" : "Near misses"}
          </button>
        ))}
        {dataUpdatedAt ? (
          <span className="text-[10px] text-muted-foreground self-center">
            Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
          </span>
        ) : null}
      </div>

      {isLoading && <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading ranked plays…</CardContent></Card>}
      {error && <Card><CardContent className="p-6 text-sm text-red-400">Could not load plays.</CardContent></Card>}
      {!isLoading && ranked.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No graded take/near plays right now. Home Take these stays empty until a live book prints a Q60 + 2× ticket.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {ranked.map((p) => {
          const grade = Math.round(p.grade ?? p.confidence ?? 0);
          const href = p.url || (p.slug ? `https://polymarket.com/event/${p.slug}` : undefined);
          const why = p.why?.length ? p.why : (p.misses || []).map((m) => `Missing: ${m}`);
          return (
            <Card key={p.id} data-testid="card-ranked-play">
              <CardContent className="p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="tabular-nums">#{p.rank ?? "—"}</Badge>
                  <Badge variant={p.list === "near" ? "outline" : "default"}>
                    {p.list === "near" ? "NEAR" : "TAKE"}
                  </Badge>
                  <span className={`text-lg font-bold tabular-nums ${gradeTone(grade)}`}>{grade}</span>
                  <span className="text-xs text-muted-foreground">/100</span>
                  <Badge variant="outline">{p.submarket || "—"}</Badge>
                  <Badge variant="outline">{p.sport || "—"}</Badge>
                  {p.q != null ? <Badge variant="outline">Q {Math.round(p.q)}</Badge> : null}
                  {p.rel != null ? <Badge variant="outline">{p.rel.toFixed(1)}×</Badge> : null}
                </div>
                <div className="font-semibold leading-snug">{p.playLabel || p.pick || p.marketQuestion}</div>
                <div className="text-xs text-muted-foreground">{p.marketQuestion}</div>
                <div className="text-[11px] text-muted-foreground">
                  {(p.traders || []).join(", ") || "—"}
                  {p.sportRoi != null ? ` · sport ROI ${p.sportRoi.toFixed(0)}%` : ""}
                  {p.liveAsk != null ? ` · ask ${p.liveAsk.toFixed(3)}` : ""}
                  {p.takeCap != null ? ` · cap ${p.takeCap.toFixed(3)}` : ""}
                </div>
                <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                  {why.slice(0, 6).map((line) => (
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
        })}
      </div>

      <Card data-testid="card-trader-discovery">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            <div className="font-medium text-sm">Trader discovery · stay best-of</div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {disc?.method || "Polydata → watch → unique book → auto_promote when gates fire."}
            {disc?.generatedAt ? ` · ${String(disc.generatedAt).slice(0, 19)}` : ""}
          </p>
          <div className="text-xs">
            <span className="text-muted-foreground">Live copy: </span>
            {(disc?.live || []).map((t) => t.username).filter(Boolean).join(", ") || "—"}
          </div>
          {(disc?.autoPromote?.promoted?.length) ? (
            <div className="text-[11px] text-emerald-400 space-y-0.5">
              <div className="font-medium text-foreground">Auto-promoted</div>
              {(disc.autoPromote.promoted || []).map((p) => (
                <div key={p.username}>{p.username}: {p.why}{p.regime ? ` · ${p.regime}` : ""}</div>
              ))}
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border/50">
                  <th className="py-1.5 pr-2">Trader</th>
                  <th className="py-1.5 pr-2">Bucket</th>
                  <th className="py-1.5 pr-2">Score</th>
                  <th className="py-1.5 pr-2">Take</th>
                  <th className="py-1.5 pr-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {top.map((t) => (
                  <tr key={String(t.username)} className="border-b border-border/30">
                    <td className="py-1.5 pr-2 font-medium">{t.username}</td>
                    <td className="py-1.5 pr-2">{t.bucket}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{t.compositeScore}</td>
                    <td className="py-1.5 pr-2 tabular-nums">
                      {t.takeN != null ? `${t.takeN} / ${t.takeRoi}%` : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{t.action || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(disc?.adaptiveActions || []).length > 0 && (
            <div className="text-[11px] text-amber-500 space-y-0.5">
              {(disc?.adaptiveActions || []).map((a) => (
                <div key={`${a.action}-${a.username || a.to}`}>
                  {a.action}: {a.username || a.to} — {a.why}
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-3 text-xs">
            <Link href="/ranks" className="text-primary">Insider Ranks →</Link>
            <Link href="/elite" className="text-primary">Elite books →</Link>
            <span className="text-muted-foreground">Refresh roster: npm run daily-pipeline</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
