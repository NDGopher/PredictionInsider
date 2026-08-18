import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink, Flame, PauseCircle, Radio } from "lucide-react";
import { Link } from "wouter";

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
  signalsFetchedAt?: number | null;
}

function cents(p: number): string {
  return `${Math.round(p * 100)}¢`;
}

function PlayCard({ play, take }: { play: TakePlay; take: boolean }) {
  const href = play.url || (play.slug ? `https://polymarket.com/event/${play.slug}` : undefined);
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
        </div>
        <div className="font-medium leading-snug">{play.marketQuestion}</div>
        <div className="text-xs text-muted-foreground">
          {play.traders.join(", ") || "matched book"} · their {cents(play.avgEntryPrice)} · live {cents(play.currentPrice)} · fill ≤ {cents(play.fillPlus2c)}
          {play.sportRoi != null ? ` · sport ROI ${play.sportRoi.toFixed(0)}%` : ""}
        </div>
        {!take && play.misses.length > 0 && (
          <div className="text-xs text-amber-500">Missing: {play.misses.join(" · ")}</div>
        )}
        {take && (
          <div className="text-xs text-muted-foreground">
            Pay up to live + 2¢, hold to resolution, $100 flat (or 1% of bank). Do not chase after 88¢.
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
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const live = data?.live || [];
  const near = data?.near || [];
  const csvLive = data?.csvOpen?.live || [];
  const w30 = data?.health?.windows?.last_30d;
  const bt = data?.backtest;

  return (
    <div className="space-y-4" data-testid="take-book-feed">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Recommended plays · $100 · VWAP + 2¢ · hold to res</div>
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
          {w30?.n ? (
            <Badge variant="outline">30d {w30.n} plays · {w30.roi_2c}% ROI</Badge>
          ) : null}
          {data?.telegramConfigured ? (
            <Badge variant="outline">Telegram on</Badge>
          ) : (
            <Badge variant="outline">Telegram off — set TELEGRAM_BOT_TOKEN</Badge>
          )}
          <Button size="sm" variant="outline" onClick={() => refetch()}>Refresh</Button>
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
            <div>No live take-book tickets right now. That is the point — ~1 play per calendar day, not a firehose.</div>
            {csvLive.length > 0 && (
              <div>CSV still shows {csvLive.length} unmatched open rows on the 12 books (often stale prices). Trust this live feed over the CSV.</div>
            )}
          </CardContent>
        </Card>
      )}

      {live.map((p) => (
        <PlayCard key={p.id} play={p} take />
      ))}

      {near.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Close — missing one or two gates</div>
          {near.slice(0, 8).map((p) => (
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
