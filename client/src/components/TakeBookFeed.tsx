import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, Flame, PauseCircle, Radio } from "lucide-react";
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
  playLabel: string;
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
  confidence: number;
  q: number;
  rel: number;
  sportRoi: number | null;
  traders: string[];
  misses: string[];
  url?: string;
}

interface TakeHealth {
  status?: string;
  pauseReason?: string | null;
  windows?: Record<string, { n?: number; win_rate?: number | null; roi_2c?: number | null }>;
  proposeDrop?: Array<{ username?: string; reason?: string }>;
  generatedAt?: string;
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
  csvOpen?: { live?: TakePlay[]; near?: TakePlay[] };
  telegramConfigured?: boolean;
  quotesAt?: number | null;
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

function PlayCard({ play, take }: { play: TakePlay; take: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cents, setCents] = useState(
    play.liveAsk != null ? String(Math.round(play.liveAsk * 1000) / 10) : "",
  );
  const href = play.url || (play.slug ? `https://polymarket.com/event/${play.slug}` : undefined);

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
          {take ? <Badge>TAKE</Badge> : <Badge variant="outline">NEAR</Badge>}
          <Badge variant="outline">{play.side}</Badge>
          <Badge variant="outline">{play.sport || "—"}</Badge>
          <Badge variant="outline">{play.submarket}</Badge>
          <Badge variant="outline">Q {Math.round(play.q)}</Badge>
          <Badge variant="outline">{play.rel.toFixed(1)}×</Badge>
          {play.quoteSource === "clob" ? (
            <Badge variant="outline">live book</Badge>
          ) : (
            <Badge variant="outline">signal px</Badge>
          )}
        </div>
        <div className="font-medium leading-snug">{play.marketQuestion}</div>
        <div className="space-y-0.5 rounded-md bg-muted/40 p-2">
          <PriceRow label="Take cap" price={play.takeCap} fmt={play.takeFmt} hint="VWAP+2¢ max" />
          <PriceRow label="Live ask" price={play.liveAsk ?? play.currentPrice} fmt={play.liveFmt} hint="pay this" />
          <PriceRow label="Their VWAP" price={play.avgEntryPrice} fmt={play.vwapFmt} />
        </div>
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

export default function TakeBookFeed() {
  const { data, isLoading, error, refetch } = useQuery<TakePlaysResponse>({
    queryKey: ["/api/take-plays"],
    staleTime: 8_000,
    refetchInterval: 12_000,
  });

  const live = (data?.live || []).filter((p) => p.valid !== false);
  const near = [...(data?.near || []), ...(data?.csvOpen?.near || [])].slice(0, 8);
  const w30 = data?.health?.windows?.last_30d;
  const w60 = data?.health?.windows?.last_60d;
  const w90 = data?.health?.windows?.last_90d;
  const bt = data?.backtest;

  return (
    <div className="space-y-4" data-testid="take-book-feed">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Recommended plays · $100 · live ask · decimal + American · auto-drop when invalid
          </div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Flame className="w-5 h-5 text-primary" />
            Take these
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            {data?.rule || "As-of Q60 + sport expert + 2× size, no NFL."}
            {bt?.n ? ` Backtest n=${bt.n} · ${bt.win_rate}% WR · ${bt.roi}% ROI after 2¢.` : ""}
          </p>
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
          <Link href="/bets" className="text-xs text-primary">My Bets →</Link>
          <Link href="/strategies" className="text-xs text-primary">Research →</Link>
        </div>
      </div>

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
            <div>When one prints: Telegram + paper ticket at the live ask. Type the cents you actually paid.</div>
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
