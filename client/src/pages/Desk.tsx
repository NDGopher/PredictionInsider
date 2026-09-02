import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { DeskResponse } from "@shared/schema";
import { englishName } from "@/lib/traderDisplay";
import { AlertTriangle, ArrowRight, Radio } from "lucide-react";

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)}`;
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function bucketTone(bucket: string): string {
  if (bucket === "live") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (bucket === "scout") return "bg-sky-500/15 text-sky-400 border-sky-500/30";
  if (bucket === "watch") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (bucket === "bench") return "bg-muted text-muted-foreground";
  return "border-border text-muted-foreground";
}

export default function Desk() {
  const { data, isLoading, error } = useQuery<DeskResponse>({
    queryKey: ["/api/desk"],
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-6 text-sm text-red-400">Could not load the desk. Check /api/desk.</div>
    );
  }

  const live = data.roster.filter((r) => r.bucket === "live");
  const rest = data.roster.filter((r) => r.bucket !== "live");

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="desk-page">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Copy desk</div>
          <h1 className="text-2xl font-semibold tracking-tight">Take book · roster · 30d would-have</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Current tickets vs the last 30 days of resolved tape the same rule would have taken.
            Numbers are unique-book hold-to-resolution at VWAP+2¢, $100 flat. Nothing here is a live fill.
            {data.ingest ? (
              <span className="block mt-1">
                Tape: {data.ingest.source}
                {data.ingest.lastFetchAt ? ` · last pull ${data.ingest.lastFetchAt.slice(0, 16).replace("T", " ")} UTC` : ""}
                {` · refresh every ${data.ingest.refreshMinutes}m`}
                {` · ${data.ingest.fills} fills / ${data.ingest.walletsTracked} wallets`}
                {data.ingest.unresolved ? ` · ${data.ingest.unresolved} unresolved` : ""}
                {data.ingest.running ? " · ingest running" : ""}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {data.now.paused ? (
            <Badge className="bg-red-500/15 text-red-400 border-red-500/30">Paused</Badge>
          ) : (
            <Badge className="gap-1"><Radio className="w-3 h-3" /> Copy on</Badge>
          )}
          <Badge>TAKE {data.now.take}</Badge>
          <Badge variant="outline">NEAR {data.now.near}</Badge>
          <Badge variant="outline">SKIP {data.now.skip}</Badge>
          <Badge variant="outline">
            30d {data.book.n} · {pct(data.book.roi2c)} ROI
          </Badge>
          <Link href="/" className="text-primary inline-flex items-center gap-1">
            Live tickets <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {data.now.pauseReason && (
        <Card><CardContent className="p-3 text-sm text-amber-400">{data.now.pauseReason}</CardContent></Card>
      )}

      <div className="grid md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Now</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div><span className="font-semibold text-emerald-400">TAKE</span> — fillable, all gates pass</div>
            <div><span className="font-semibold text-amber-400">NEAR</span> — one or two gates short</div>
            <div><span className="font-semibold text-muted-foreground">SKIP</span> — three+ misses, futures, or NFL</div>
            <div className="text-xs text-muted-foreground pt-2">{data.takeNearDiagnose}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">30d would-have</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>n={data.book.n} · WR {data.book.winRate ?? "—"}% · {pct(data.book.roi2c)}</div>
            <div>Unit PnL {money(data.book.pnl2c)}</div>
            <div className="text-xs text-muted-foreground pt-2">{data.howToRead}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Promote / demote</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <div>{data.promoteHow}</div>
            <div>Promoted {data.actions.promoted.length} · demoted {data.actions.demoted.length} · benched {data.actions.benched.length} · new scouts {data.actions.scoutsAdded.length}</div>
          </CardContent>
        </Card>
      </div>

      {data.equityCurve.length > 1 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Book equity · last 30d would-have</CardTitle></CardHeader>
          <CardContent className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.equityCurve}>
                <XAxis dataKey="t" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Area type="monotone" dataKey="equity" stroke="hsl(var(--primary))" fill="hsl(var(--primary)/0.15)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">30d would-have by trader</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trader</TableHead>
                  <TableHead className="text-right">n</TableHead>
                  <TableHead className="text-right">WR</TableHead>
                  <TableHead className="text-right">ROI</TableHead>
                  <TableHead className="text-right">PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.wouldHave.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground text-sm">
                      No resolved take-rule prints in the window{data.blockedReason ? ` — ${data.blockedReason}` : "."}
                    </TableCell>
                  </TableRow>
                )}
                {data.wouldHave.map((t) => (
                  <TableRow key={t.username}>
                    <TableCell className="font-medium">{t.displayName}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.n}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.winRate ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(t.roi2c)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(t.pnl2c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Plays the rule would have taken</CardTitle></CardHeader>
          <CardContent className="p-0 max-h-[360px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Trader</TableHead>
                  <TableHead>Play</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="text-right">PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.plays.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground text-sm">No would-have tickets to list.</TableCell>
                  </TableRow>
                )}
                {data.plays.map((p, i) => (
                  <TableRow key={`${p.end}-${p.play}-${i}`}>
                    <TableCell className="tabular-nums text-xs">{p.end.slice(0, 10)}</TableCell>
                    <TableCell>{p.displayName}</TableCell>
                    <TableCell className="max-w-[220px] truncate">{p.play}</TableCell>
                    <TableCell>{p.won ? <Badge>Won</Badge> : <Badge variant="outline">Lost</Badge>}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(p.pnl_2c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {data.blockedTraders.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Blocked — no honest tape
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-1 text-muted-foreground">
            {data.blockedTraders.map((b) => (
              <div key={`${b.displayName}-${b.why}`}>{b.displayName}: {b.why}</div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Roster</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trader</TableHead>
                <TableHead>Lane</TableHead>
                <TableHead className="text-right">WR</TableHead>
                <TableHead className="text-right">Unique ROI</TableHead>
                <TableHead className="text-right">30d n</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...live, ...rest].map((r) => (
                <TableRow key={r.wallet || r.username}>
                  <TableCell>
                    <div className="font-medium">{r.displayName || englishName(r.username, r.wallet)}</div>
                    <div className="text-[10px] text-muted-foreground">{r.wallet.slice(0, 10)}…</div>
                  </TableCell>
                  <TableCell>
                    <Badge className={bucketTone(r.bucket)}>{r.bucket.toUpperCase()}</Badge>
                    {r.pathB ? <Badge variant="outline" className="ml-1">Path-B</Badge> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.winRate ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.uniqueRoi)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.last30n ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[360px]">
                    {r.promoteReason || r.demoteReason || r.whyTail || r.reasons.slice(0, 2).join(" · ") || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(data.actions.promoted.length + data.actions.demoted.length + data.actions.benched.length) > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Last auto actions</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1">
            {data.actions.promoted.map((a) => (
              <div key={`p-${a.wallet}`} className="text-emerald-400">PROMOTE {a.displayName || a.username}: {a.why}</div>
            ))}
            {data.actions.demoted.map((a) => (
              <div key={`d-${a.wallet}`} className="text-amber-400">DEMOTE {a.displayName || a.username}: {a.why}</div>
            ))}
            {data.actions.benched.map((a) => (
              <div key={`b-${a.wallet}`} className="text-muted-foreground">BENCH {a.displayName || a.username}: {a.why}</div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Still blocked</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          {data.stillBlocked.map((line) => (
            <div key={line}>• {line}</div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
