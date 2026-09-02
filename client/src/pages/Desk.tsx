import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { DeskRankedPlay, DeskResponse } from "@shared/schema";
import { englishName } from "@/lib/traderDisplay";
import { AlertTriangle, ArrowRight, ArrowUpDown, ExternalLink, Radio } from "lucide-react";

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

function cents(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}¢`;
}

function bucketTone(bucket: string): string {
  if (bucket === "live") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (bucket === "scout") return "bg-sky-500/15 text-sky-400 border-sky-500/30";
  if (bucket === "watch") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (bucket === "bench") return "bg-muted text-muted-foreground";
  return "border-border text-muted-foreground";
}

function laneTone(lane: string): string {
  if (lane === "TAKE") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (lane === "NEAR") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-muted text-muted-foreground";
}

type SortKey = "rank" | "q" | "rel" | "sportRoi" | "edgeCents" | "fillability";

function TakeTicketCard({ play }: { play: DeskRankedPlay }) {
  const href = play.url || (play.slug ? `https://polymarket.com/event/${play.slug}` : undefined);
  return (
    <Card data-testid="card-take-ticket" className="min-w-[280px] flex-1 border-emerald-500/30">
      <CardContent className="p-3 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <Badge className={laneTone("TAKE")}>TAKE</Badge>
          <Badge variant="outline">#{play.rank}</Badge>
          <Badge variant="outline">Q {Math.round(play.q)}</Badge>
          <Badge variant="outline">{play.rel.toFixed(1)}×</Badge>
          <Badge variant="outline">{play.submarket}</Badge>
        </div>
        <div className="text-sm font-semibold leading-snug">{play.playLabel}</div>
        <div className="text-[11px] text-muted-foreground truncate">{play.marketQuestion}</div>
        <div className="text-[11px] font-mono tabular-nums">
          {play.displayName} · ask {cents(play.liveAsk)} · cap {cents(play.takeCap)} · edge {play.edgeCents >= 0 ? "+" : ""}{play.edgeCents.toFixed(1)}¢
        </div>
        <div className="text-[10px] text-muted-foreground">{play.whyRank}</div>
        {href && (
          <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary">
            Polymarket <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </CardContent>
    </Card>
  );
}

export default function Desk() {
  const { data, isLoading, error } = useQuery<DeskResponse>({
    queryKey: ["/api/desk"],
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const [laneFilter, setLaneFilter] = useState<"ALL" | "TAKE" | "NEAR" | "SKIP">("ALL");
  const [sportFilter, setSportFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [minQ, setMinQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const ranked = data?.rankedPlays || [];
  const takeTickets = data?.takeTickets || ranked.filter((p) => p.takeLane === "TAKE");
  const sports = useMemo(() => {
    const set = new Set<string>();
    for (const p of ranked) {
      if (p.sport) set.add(p.sport);
    }
    return [...set].sort();
  }, [ranked]);

  const board = useMemo(() => {
    const qMin = minQ ? Number(minQ) : 0;
    let rows = ranked.filter((p) => {
      if (laneFilter !== "ALL" && p.takeLane !== laneFilter) return false;
      if (sportFilter !== "ALL" && (p.sport || "") !== sportFilter) return false;
      if (qMin && p.q < qMin) return false;
      if (query) {
        const blob = `${p.displayName} ${p.playLabel} ${p.marketQuestion} ${p.traders.join(" ")}`.toLowerCase();
        if (!blob.includes(query.toLowerCase())) return false;
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (sortKey === "rank") return (a.rank - b.rank) * dir;
      const av = a[sortKey] ?? -999;
      const bv = b[sortKey] ?? -999;
      return (Number(av) - Number(bv)) * dir;
    });
    return rows;
  }, [ranked, laneFilter, sportFilter, minQ, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "rank" ? "asc" : "desc");
    }
  }

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
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto" data-testid="desk-page">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Copy desk</div>
          <h1 className="text-2xl font-semibold tracking-tight">TOP / TAKE · all plays ranked</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            OddsJam-style board: live copy tickets on top, every open book ranked below.
            TAKE is Q≥60, sport ROI, 2× size, 10–88¢, no NFL. Empty TAKE stays honest.
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
            {data.discovery ? (
              <span className="block mt-1">
                Auto-discovery: {data.discovery.recommended} recommended · {data.discovery.scoutsAdded} scouts · {data.discovery.unresolved} unresolved
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

      <section data-testid="take-strip">
        <div className="flex items-end justify-between gap-2 mb-2">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-emerald-400">TOP / TAKE</div>
            <h2 className="text-lg font-semibold">Live copy tickets</h2>
          </div>
          <div className="text-xs text-muted-foreground max-w-xl text-right">{data.takeNearDiagnose}</div>
        </div>
        {takeTickets.length === 0 ? (
          <Card data-testid="take-strip-empty">
            <CardContent className="p-5 text-sm text-muted-foreground">
              TAKE is empty — the live rule has no fillable ticket right now. That is a diagnose, not a dead board.
              All open plays are still ranked below.
            </CardContent>
          </Card>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {takeTickets.map((p) => (
              <TakeTicketCard key={p.id} play={p} />
            ))}
          </div>
        )}
      </section>

      <Card data-testid="all-plays-ranked">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex flex-col gap-1">
            <span>ALL PLAYS RANKED</span>
            <span className="font-normal text-xs text-muted-foreground">{data.rankHow}</span>
          </CardTitle>
          <div className="flex flex-wrap gap-2 pt-2">
            {(["ALL", "TAKE", "NEAR", "SKIP"] as const).map((lane) => (
              <button
                key={lane}
                type="button"
                onClick={() => setLaneFilter(lane)}
                className={`text-xs px-2.5 py-1 rounded-full border ${
                  laneFilter === lane ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"
                }`}
              >
                {lane}
              </button>
            ))}
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={sportFilter}
              onChange={(e) => setSportFilter(e.target.value)}
              aria-label="Filter sport"
            >
              <option value="ALL">All sports</option>
              {sports.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <Input
              className="h-8 w-24 text-xs"
              placeholder="Min Q"
              value={minQ}
              onChange={(e) => setMinQ(e.target.value)}
              inputMode="numeric"
            />
            <Input
              className="h-8 w-48 text-xs"
              placeholder="Search book / play"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead label="#" k="rank" sortKey={sortKey} onClick={toggleSort} />
                <TableHead>Play</TableHead>
                <TableHead>Book</TableHead>
                <SortHead label="Edge" k="edgeCents" sortKey={sortKey} onClick={toggleSort} />
                <SortHead label="Q" k="q" sortKey={sortKey} onClick={toggleSort} />
                <SortHead label="Size" k="rel" sortKey={sortKey} onClick={toggleSort} />
                <SortHead label="Sport ROI" k="sportRoi" sortKey={sortKey} onClick={toggleSort} />
                <SortHead label="Fill" k="fillability" sortKey={sortKey} onClick={toggleSort} />
                <TableHead>Why this rank</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground text-sm">
                    No open plays in the universe for this filter.
                  </TableCell>
                </TableRow>
              )}
              {board.map((p) => (
                <TableRow key={p.id} data-testid="ranked-play-row">
                  <TableCell className="tabular-nums font-medium">
                    {p.rank}
                    <div><Badge className={`${laneTone(p.takeLane)} text-[10px]`}>{p.takeLane}</Badge></div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium max-w-[280px]">{p.playLabel}</div>
                    <div className="text-[10px] text-muted-foreground max-w-[280px] truncate">{p.marketQuestion}</div>
                    <div className="text-[10px] text-muted-foreground">{p.sport || "—"} · {p.submarket}</div>
                  </TableCell>
                  <TableCell className="font-medium">{p.displayName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.edgeCents >= 0 ? "+" : ""}{p.edgeCents.toFixed(1)}¢
                    <div className="text-[10px] text-muted-foreground">ask {cents(p.liveAsk)}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{Math.round(p.q)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.rel.toFixed(1)}×</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(p.sportRoi)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.fillable ? <Badge className={laneTone("TAKE")}>Yes</Badge> : <Badge variant="outline">No</Badge>}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground max-w-[340px]">{p.whyRank}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Now</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div><span className="font-semibold text-emerald-400">TAKE</span> — fillable, all gates pass</div>
            <div><span className="font-semibold text-amber-400">NEAR</span> — one or two gates short</div>
            <div><span className="font-semibold text-muted-foreground">SKIP</span> — three+ misses, futures, or NFL</div>
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
        <CardHeader className="pb-2"><CardTitle className="text-sm">Roster · auto scout / watch / take_book</CardTitle></CardHeader>
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

      {(data.actions.promoted.length + data.actions.demoted.length + data.actions.benched.length + data.actions.scoutsAdded.length) > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Last auto actions</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1">
            {data.actions.scoutsAdded.map((a) => (
              <div key={`s-${a.wallet}`} className="text-sky-400">SCOUT {a.displayName || a.username}: {a.why}</div>
            ))}
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

function SortHead({
  label, k, sortKey, onClick,
}: { label: string; k: SortKey; sortKey: SortKey; onClick: (k: SortKey) => void }) {
  return (
    <TableHead>
      <button type="button" className="inline-flex items-center gap-1" onClick={() => onClick(k)}>
        {label}
        <ArrowUpDown className={`w-3 h-3 ${sortKey === k ? "text-primary" : "text-muted-foreground"}`} />
      </button>
    </TableHead>
  );
}
