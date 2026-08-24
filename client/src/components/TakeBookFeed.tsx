import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronUp, ExternalLink, Flame, PauseCircle, Radio } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

interface PriceFmt {
  price: number;
  cents: number;
  decimal: number;
  american: number;
  americanLabel: string;
  decimalLabel: string;
  compact: string;
}

interface TakePlay {
  id: string;
  marketQuestion: string;
  slug?: string;
  side: string;
  sport?: string;
  submarket: string;
  playLabel?: string;
  pick?: string;
  lane?: "sports" | "other" | "futures";
  outcomeLabel?: string;
  currentPrice: number;
  avgEntryPrice: number;
  fillPlus2c: number;
  takeCap: number;
  liveAsk: number | null;
  takePrice: number | null;
  quoteSource?: string;
  takeFmt: PriceFmt | null;
  liveFmt: PriceFmt | null;
  vwapFmt: PriceFmt | null;
  valid: boolean;
  invalidReason: string | null;
  grade?: number;
  confidence: number;
  q: number;
  rel: number;
  sportRoi: number | null;
  traders: string[];
  misses: string[];
  why?: string[];
  scoreBreakdown?: Record<string, number>;
  rank?: number;
  url?: string;
}

interface TakeHealth {
  status?: string;
  pauseReason?: string | null;
  windows?: Record<string, { n?: number; win_rate?: number | null; roi_2c?: number | null }>;
  proposeDrop?: Array<{ username?: string; reason?: string }>;
  proposeAdd?: Array<{ username?: string; reason?: string }>;
  generatedAt?: string;
}

interface DiscoveryBundle {
  live?: Array<{ username?: string; uniqueRoi?: number; medianStake?: number }>;
  watch?: Array<{ username?: string; uniqueRoi?: number; joinable?: boolean }>;
  topComposite?: Array<{
    username?: string;
    bucket?: string;
    compositeScore?: number;
    takeN?: number;
    takeRoi?: number;
    action?: string;
    why?: string;
  }>;
  adaptiveActions?: Array<{ action?: string; username?: string; why?: string }>;
  method?: string;
}

interface TakePlaysResponse {
  strategyName?: string | null;
  rule?: string | null;
  fill?: string;
  stake?: number;
  backtest?: { n?: number; win_rate?: number; roi?: number };
  health?: TakeHealth | null;
  paused?: boolean;
  pauseReason?: string | null;
  live?: TakePlay[];
  near?: TakePlay[];
  ranked?: TakePlay[];
  csvOpen?: { live?: TakePlay[]; near?: TakePlay[] };
  telegramConfigured?: boolean;
  quotesAt?: number | null;
  copyBooks?: Array<{ username: string; wallet: string }>;
  discovery?: DiscoveryBundle;
  lanes?: {
    sports?: { n?: number; win_rate?: number; roi_2c?: number };
    other?: { n?: number; win_rate?: number; roi_2c?: number };
    by_submarket?: Record<string, { n?: number; win_rate?: number; roi_2c?: number }>;
  };
}

function americanFromPrice(p: number): number {
  if (!p || p <= 0 || p >= 1) return 0;
  if (p >= 0.5) return -Math.round((p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

function decimalFromPrice(p: number): number {
  if (!p || p <= 0) return 0;
  return Math.round((1 / p) * 100) / 100;
}

function americanLabel(n: number): string {
  if (!n) return "—";
  return n > 0 ? `+${n}` : String(n);
}

function fmtTriple(p: number | null | undefined, fallback?: PriceFmt | null): string {
  if (fallback && fallback.price > 0) {
    return `${fallback.price.toFixed(3)}  ${fallback.decimalLabel}  ${fallback.americanLabel}`;
  }
  if (p == null || p <= 0) return "—";
  return `${p.toFixed(3)}  ${decimalFromPrice(p).toFixed(2)}  ${americanLabel(americanFromPrice(p))}`;
}

function gradeTone(g: number): string {
  if (g >= 75) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (g >= 60) return "bg-primary/15 text-primary border-primary/30";
  if (g >= 45) return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-muted text-muted-foreground border-border";
}

async function saveActualFill(playId: string, cents: string): Promise<void> {
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0 || n >= 100) {
    throw new Error("Enter actual fill in cents, e.g. 54");
  }
  const price = n / 100;
  const res = await fetch(`/api/bets/take-paper-${playId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actualPrice: price, entryPrice: price, americanOdds: americanFromPrice(price) }),
  });
  if (!res.ok) throw new Error(`Could not save fill (${res.status})`);
}

function PriceRow({ label, price, fmt, hint }: { label: string; price: number | null | undefined; fmt?: PriceFmt | null; hint?: string }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 text-xs font-mono tabular-nums">
      <span className="text-muted-foreground font-sans">{label}</span>
      <span>
        {fmtTriple(price, fmt)}
        {hint ? <span className="text-muted-foreground font-sans ml-1">{hint}</span> : null}
      </span>
    </div>
  );
}

function WhyBlock({ play, take }: { play: TakePlay; take: boolean }) {
  const [open, setOpen] = useState(take);
  const grade = Math.round(play.grade ?? play.confidence ?? 0);
  const why = play.why?.length ? play.why : play.misses.map((m) => `Missing: ${m}`);
  const bd = play.scoreBreakdown || {};
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        data-testid={take ? "button-why-take" : "button-why-near"}
      >
        <div className="flex items-center gap-2">
          <Badge className={`tabular-nums ${gradeTone(grade)}`}>Grade {grade}/100</Badge>
          <span className="text-xs text-muted-foreground">
            {take ? "Why this is recommended" : "Why it is close"}
          </span>
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="space-y-2">
          <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
            {why.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {Object.keys(bd).length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[10px]">
              {[
                ["roiPct", "ROI", 40],
                ["consensusPct", "Consensus", 30],
                ["valuePct", "Value", 20],
                ["sizePct", "Size", 10],
                ["relSizePts", "Rel size", 15],
                ["qualityBoost", "Quality", 6],
              ].map(([key, label, max]) => {
                const val = Number(bd[key as string] || 0);
                return (
                  <div key={String(key)} className="rounded border border-border/40 px-1.5 py-1">
                    <div className="text-muted-foreground">{label}</div>
                    <div className="font-semibold tabular-nums">{val}/{max}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlayCard({ play, take }: { play: TakePlay; take: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cents, setCents] = useState(
    play.liveAsk != null ? String(Math.round(play.liveAsk * 1000) / 10) : "",
  );
  const href = play.url || (play.slug ? `https://polymarket.com/event/${play.slug}` : undefined);
  const grade = Math.round(play.grade ?? play.confidence ?? 0);

  async function onSaveFill(): Promise<void> {
    try {
      await saveActualFill(play.id, cents);
      await queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
      toast({ title: "Actual fill saved", description: `${cents}¢ · My Bets` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "save failed";
      toast({ title: "Could not save fill", description: msg, variant: "destructive" });
    }
  }

  return (
    <Card data-testid={take ? "card-take-play" : "card-near-play"}>
      <CardContent className="p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {play.rank != null ? (
            <Badge variant="outline" className="tabular-nums">#{play.rank}</Badge>
          ) : null}
          {take ? <Badge>TAKE</Badge> : <Badge variant="outline">NEAR</Badge>}
          <Badge className={`tabular-nums ${gradeTone(grade)}`}>{grade}/100</Badge>
          <Badge>{play.submarket}</Badge>
          <Badge variant="outline">{play.sport || "—"}</Badge>
          <Badge variant="outline">Q {Math.round(play.q)}</Badge>
          <Badge variant="outline">{play.rel.toFixed(1)}×</Badge>
          {play.quoteSource === "clob" ? (
            <Badge variant="outline">live book</Badge>
          ) : (
            <Badge variant="outline">signal px</Badge>
          )}
        </div>
        <div className="text-lg font-semibold leading-snug tracking-tight">
          {play.playLabel || play.pick || play.outcomeLabel || play.side}
        </div>
        <div className="text-xs text-muted-foreground">{play.marketQuestion}</div>
        <div className="space-y-0.5 rounded-md bg-muted/40 p-2">
          <PriceRow label="Take cap" price={play.takeCap} fmt={play.takeFmt} hint="VWAP+2¢ max" />
          <PriceRow label="Live ask" price={play.liveAsk ?? play.currentPrice} fmt={play.liveFmt} hint="pay this" />
          <PriceRow label="Their VWAP" price={play.avgEntryPrice} fmt={play.vwapFmt} />
        </div>
        <WhyBlock play={play} take={take} />
        <div className="text-[11px] text-muted-foreground">
          Decimal = 1/price · American next to it. {play.traders.join(", ") || "matched book"}
          {play.sportRoi != null ? ` · sport ROI ${play.sportRoi.toFixed(0)}%` : ""}
        </div>
        {!take && play.misses.length > 0 && (
          <div className="text-xs text-amber-500">Missing: {play.misses.join(" · ")}</div>
        )}
        {take && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Actual fill (¢)</span>
            <Input
              className="h-7 w-24 text-xs"
              inputMode="decimal"
              value={cents}
              onChange={(e) => setCents(e.target.value)}
              placeholder="54"
            />
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void onSaveFill()}>
              I took it at
            </Button>
          </div>
        )}
        {href && (
          <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary">
            Polymarket <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function DiscoveryStrip({ discovery }: { discovery?: DiscoveryBundle }) {
  if (!discovery) return null;
  const live = discovery.live || [];
  const top = (discovery.topComposite || []).slice(0, 6);
  const actions = (discovery.adaptiveActions || []).slice(0, 4);
  return (
    <Card data-testid="card-copy-discovery">
      <CardContent className="p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-medium">Best-of roster · discovery</div>
          <Link href="/insiders" className="text-xs text-primary">Prediction Insiders →</Link>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Live now: {live.map((t) => t.username).filter(Boolean).join(", ") || "—"}
          {" · "}
          Auto-promote on: joinable + HOT + (unique ROI≥5% or turnaround last30). MM is a separate lane.
        </div>
        {top.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {top.map((t) => (
              <Badge key={String(t.username)} variant="outline" className="text-[10px] font-normal">
                {t.username} · {t.bucket} · score {t.compositeScore}
                {t.takeN ? ` · take ${t.takeN}/${t.takeRoi}%` : ""}
              </Badge>
            ))}
          </div>
        )}
        {actions.length > 0 && (
          <div className="text-[11px] text-amber-500 space-y-0.5">
            {actions.map((a) => (
              <div key={`${a.action}-${a.username}`}>{a.action}: {a.username} — {a.why}</div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function TakeBookFeed() {
  const { data, isLoading, error, refetch } = useQuery<TakePlaysResponse>({
    queryKey: ["/api/take-plays"],
    staleTime: 8_000,
    refetchInterval: 12_000,
  });

  const liveAll = (data?.live || []).filter((p) => p.valid !== false);
  const nearAll = [...(data?.near || []), ...(data?.csvOpen?.near || [])];
  const [laneTab, setLaneTab] = useState<"sports" | "other">("sports");
  const inLane = (p: TakePlay) => p.lane !== "futures" && p.submarket !== "Futures" && (p.lane || "sports") === laneTab;
  const live = liveAll.filter(inLane);
  const near = nearAll.filter(inLane).slice(0, 8);
  const w30 = data?.health?.windows?.last_30d;
  const w60 = data?.health?.windows?.last_60d;
  const w90 = data?.health?.windows?.last_90d;
  const bt = data?.backtest;

  return (
    <div className="space-y-4" data-testid="take-book-feed">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Recommended plays · graded 0–100 · $100 · live ask · decimal + American
          </div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Flame className="w-5 h-5 text-primary" />
            Take these
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            {data?.rule || "As-of Q60 + sport expert + 2× size, no NFL."}
            {bt?.n ? ` Backtest n=${bt.n} · ${bt.win_rate}% WR · ${bt.roi}% ROI after 2¢.` : ""}
            {" "}Each card shows Grade /100 and why. Full ranked list on Ranked Plays.
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {(["sports", "other"] as const).map((tab) => {
              const st = tab === "sports" ? data?.lanes?.sports : data?.lanes?.other;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setLaneTab(tab)}
                  className={`text-xs px-3 py-1 rounded-full border ${
                    laneTab === tab ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {tab === "sports" ? "Sports (ML / spread / total)" : "Politics"}
                  {st?.n ? ` · n=${st.n} ${st.roi_2c}% ROI` : ""}
                </button>
              );
            })}
          </div>
          {laneTab === "other" && (
            <p className="text-[11px] text-muted-foreground mt-1 max-w-2xl">
              Same Q/size gates, separate from the sports copy tape. Futures are not shown (historical n=5, −37% after 2¢).
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {data?.paused ? (
            <Badge className="bg-red-500/15 text-red-400 border-red-500/30 gap-1">
              <PauseCircle className="w-3 h-3" /> Paused
            </Badge>
          ) : (
            <Badge className="gap-1"><Radio className="w-3 h-3" /> Live copy ON</Badge>
          )}
          {w30?.n ? <Badge variant="outline">30d {w30.n} · {w30.roi_2c}% ROI</Badge> : null}
          {w60?.n ? <Badge variant="outline">60d {w60.n} · {w60.roi_2c}% ROI</Badge> : null}
          {w90?.n ? <Badge variant="outline">90d {w90.n} · {w90.roi_2c}% ROI</Badge> : null}
          {data?.telegramConfigured ? (
            <Badge variant="outline">Telegram on</Badge>
          ) : (
            <Badge variant="outline">Telegram off — set TELEGRAM_BOT_TOKEN</Badge>
          )}
          <Button size="sm" variant="outline" onClick={() => refetch()}>Refresh</Button>
          <Link href="/insiders" className="text-xs text-primary">Prediction Insiders →</Link>
          <Link href="/bets" className="text-xs text-primary">My Bets →</Link>
        </div>
      </div>

      <DiscoveryStrip discovery={data?.discovery} />

      {data?.pauseReason && (
        <Card>
          <CardContent className="p-3 text-sm text-amber-400">{data.pauseReason}</CardContent>
        </Card>
      )}

      {isLoading && <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading take book…</CardContent></Card>}
      {error && <Card><CardContent className="p-6 text-sm text-red-400">Could not load /api/take-plays.</CardContent></Card>}

      {!isLoading && live.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground space-y-1">
            <div>No live take-book tickets right now. Alerts auto-delete on Telegram when they go invalid.</div>
            <div>When one prints: Telegram + paper ticket at the live ask. Type the cents you actually paid. Empty book is honest.</div>
          </CardContent>
        </Card>
      )}

      {live.map((p) => (
        <PlayCard key={p.id} play={p} take />
      ))}

      {near.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Close — missing one or two gates</div>
          {near.map((p) => (
            <PlayCard key={p.id} play={p} take={false} />
          ))}
        </div>
      )}

      {(data?.health?.proposeDrop || []).length > 0 && (
        <Card>
          <CardContent className="p-4 text-xs space-y-1">
            <div className="font-medium">Roster proposals (not auto-applied)</div>
            {(data?.health?.proposeDrop || []).map((d) => (
              <div key={d.username}>{d.username}: {d.reason}</div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
