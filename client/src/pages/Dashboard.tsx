import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Link } from "wouter";
import {
  Zap, Users, BarChart3, TrendingUp, TrendingDown, ArrowRight,
  Activity, Target, AlertCircle, RefreshCw, ExternalLink, X,
  Radio, Hourglass, CalendarClock, DollarSign, ShieldCheck,
  ChevronDown, ChevronUp, Bell, Clock, Flame, BarChart2, BookmarkPlus, EyeOff, CheckCircle2, Award
} from "lucide-react";
import type { SignalsResponse, LeaderboardResponse, MarketsResponse, Signal } from "@shared/schema";
import GameScorePanel from "@/components/GameScorePanel";
import { useToast } from "@/hooks/use-toast";

const BET_KEY = "pi_bets";

function priceToAmericanNum(p: number): number {
  if (!p || p <= 0 || p >= 1) return 100;
  if (p >= 0.5) return -Math.round((p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

function americanToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

type BookType = "Kalshi" | "PPH" | "Polymarket";

function DashboardTrackBetModal({
  signal, outcomeLabel, open, onClose,
}: { signal: Signal; outcomeLabel: string; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const s = signal as any;
  const signalPrice = signal.avgEntryPrice || signal.currentPrice;
  const defaultOdds = priceToAmericanNum(signalPrice);

  const [book, setBook] = useState<BookType>("Kalshi");
  const [oddsStr, setOddsStr] = useState(defaultOdds > 0 ? `+${defaultOdds}` : String(defaultOdds));
  const [betAmount, setBetAmount] = useState("");
  const [notes, setNotes] = useState(`Signal confidence: ${signal.confidence}/95`);

  useEffect(() => {
    if (open) {
      const d = priceToAmericanNum(signalPrice);
      setOddsStr(d > 0 ? `+${d}` : String(d));
      setBetAmount("");
      setNotes(`Signal confidence: ${signal.confidence}/95`);
    }
  }, [open, signalPrice]);

  function parseOdds(raw: string): number | null {
    const n = parseInt(raw.replace(/[^-+0-9]/g, ""), 10);
    if (isNaN(n) || n === 0 || (n > -100 && n < 100)) return null;
    return n;
  }

  const oddsNum = parseOdds(oddsStr);
  const impliedProb = oddsNum ? americanToImplied(oddsNum) : null;
  const betAmtNum = parseFloat(betAmount);
  const potentialWin = oddsNum && !isNaN(betAmtNum) && betAmtNum > 0
    ? oddsNum > 0 ? betAmtNum * oddsNum / 100 : betAmtNum * 100 / Math.abs(oddsNum)
    : null;

  function handleSave() {
    if (!oddsNum || !betAmtNum || betAmtNum <= 0) return;
    const newBet = {
      id: `bet-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      marketQuestion: signal.marketQuestion,
      outcomeLabel,
      side: signal.side,
      conditionId: s.marketId,
      slug: s.slug,
      entryPrice: impliedProb || signalPrice,
      betAmount: betAmtNum,
      betDate: Date.now(),
      status: "open",
      book,
      americanOdds: oddsNum,
      polymarketPrice: signalPrice,
      sport: s.sport,
      notes: notes.trim() || undefined,
    };
    // Persist to database
    fetch("/api/bets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newBet),
    }).catch(() => {});
    // Also write to localStorage as immediate cache
    try {
      const bets = JSON.parse(localStorage.getItem(BET_KEY) || "[]");
      bets.unshift(newBet);
      localStorage.setItem(BET_KEY, JSON.stringify(bets));
    } catch {}
    toast({ title: "Bet tracked!", description: `${outcomeLabel} · ${oddsNum > 0 ? "+" : ""}${oddsNum} · ${book}` });
    onClose();
  }

  const BOOKS: BookType[] = ["Kalshi", "PPH", "Polymarket"];
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm" data-testid="modal-track-bet-dash">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <BookmarkPlus className="w-4 h-4 text-primary" />
            Track Bet
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="rounded-lg bg-muted/50 border border-border p-3 space-y-1">
            <div className="text-xs text-muted-foreground">{signal.marketQuestion}</div>
            <div className="text-sm font-bold text-green-600 dark:text-green-400">{outcomeLabel}</div>
            <div className="text-[10px] text-muted-foreground">
              Polymarket @ {Math.round(signalPrice * 100)}¢ ({priceToAmericanNum(signalPrice) > 0 ? "+" : ""}{priceToAmericanNum(signalPrice)})
              {s.sport && <span className="ml-1 text-primary">· {s.sport}</span>}
              {" · "}<span className="text-foreground font-semibold">Signal {signal.confidence}/95</span>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Where are you placing this bet?</label>
            <div className="flex gap-2">
              {BOOKS.map(b => (
                <button key={b} onClick={() => setBook(b)} className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                  book === b ? b === "Kalshi" ? "bg-purple-600 text-white border-purple-600" : b === "PPH" ? "bg-blue-600 text-white border-blue-600" : "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50"
                }`}>{b}</button>
              ))}
            </div>
            {book === "Kalshi" && (
              <div className="mt-2 p-2 rounded bg-purple-500/10 border border-purple-500/20 text-[10px] text-purple-700 dark:text-purple-300">
                <strong>Kalshi fees:</strong> Enter actual net odds after ~2% settlement fee (e.g. enter +318, not raw +354).
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Your actual odds (American)</label>
            <Input value={oddsStr} onChange={e => setOddsStr(e.target.value)} placeholder="+318 or -150" className="h-10 text-lg font-bold text-center" data-testid="input-odds-dash" />
            {oddsNum && impliedProb && (
              <div className="mt-1 flex items-center gap-2 text-[10px]">
                <span className="text-muted-foreground">Breakeven: <strong>{(impliedProb * 100).toFixed(1)}%</strong></span>
                <span className={impliedProb < signalPrice - 0.015 ? "text-green-600 dark:text-green-400" : impliedProb > signalPrice + 0.015 ? "text-red-500" : "text-muted-foreground"}>
                  {impliedProb < signalPrice - 0.015 ? `✓ Better than PM (${Math.round(signalPrice*100)}¢)` : impliedProb > signalPrice + 0.015 ? `⚠ Worse than PM (${Math.round(signalPrice*100)}¢)` : `≈ Same as PM`}
                </span>
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Bet amount ($)</label>
            <Input type="number" min="1" value={betAmount} onChange={e => setBetAmount(e.target.value)} placeholder="e.g. 50" className="h-10 text-base font-semibold" data-testid="input-bet-amount-dash" />
            {potentialWin !== null && (
              <div className="mt-1 text-[10px] text-green-600 dark:text-green-400 font-medium">
                To win: <strong>${potentialWin.toFixed(2)}</strong> · Total: <strong>${(betAmtNum + potentialWin).toFixed(2)}</strong>
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Notes</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add notes..." className="h-8 text-xs" data-testid="input-notes-dash" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={!oddsNum || !betAmtNum || betAmtNum <= 0} className="gap-1.5" data-testid="button-save-bet-dash">
            <CheckCircle2 className="w-3.5 h-3.5" /> Track Bet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SIGNAL_REFRESH_MS = 90_000; // 90s auto-refresh

function getOutcomeLabel(title: string, side: "YES" | "NO"): string {
  const t = title.trim();
  const ouMatch = t.match(/o\/?u\s+([\d.]+)/i) || t.match(/total[:\s]+([\d.]+)/i);
  if (ouMatch) return side === "YES" ? `Over ${ouMatch[1]}` : `Under ${ouMatch[1]}`;
  const spreadMatch = t.match(/spread[:\s]+([A-Za-z].+?)\s*\(([+-]?\d+\.?\d*)\)/i);
  if (spreadMatch) return side === "YES" ? `${spreadMatch[1].trim()} ${spreadMatch[2]} covers` : `${spreadMatch[1].trim()} doesn't cover`;
  const willMatch = t.match(/will\s+(?:the\s+)?(.+?)\s+win/i);
  if (willMatch) return side === "YES" ? `${willMatch[1].trim()} WIN` : `${willMatch[1].trim()} won't win`;
  if (!t.includes(":")) {
    const vsMatch = t.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
    if (vsMatch) return side === "YES" ? `${vsMatch[1].trim()} WIN` : `${vsMatch[2].trim()} WIN`;
  }
  const colonAfterVs = t.match(/^(.+?)\s+vs\.?\s+([^:]+):\s*(.+)$/i);
  if (colonAfterVs) {
    const sub = colonAfterVs[3].trim();
    const subOu = sub.match(/o\/?u\s*([\d.]+)/i);
    if (subOu) return side === "YES" ? `Over ${subOu[1]}` : `Under ${subOu[1]}`;
    return `${sub} — ${side}`;
  }
  const tourneyVs = t.match(/^.+?:\s*(.+?)\s+vs\.?\s+(.+)$/i);
  if (tourneyVs) return side === "YES" ? `${tourneyVs[1].trim()} WIN` : `${tourneyVs[2].trim()} WIN`;
  return side;
}

function ConfidenceBadge({ score }: { score: number }) {
  const color =
    score >= 75 ? "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20" :
    score >= 50 ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20" :
    "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border ${color}`}>
      {score}
    </span>
  );
}

function GameStatusBadge({ type }: { type?: string }) {
  if (type === "live") return (
    <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20 animate-pulse">
      <Radio className="w-2.5 h-2.5" />LIVE
    </span>
  );
  if (type === "pregame") return (
    <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20">
      <Hourglass className="w-2.5 h-2.5" />PREGAME
    </span>
  );
  return (
    <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
      <CalendarClock className="w-2.5 h-2.5" />FUTURES
    </span>
  );
}

function formatUsdc(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000)      return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function toAmericanOdds(p: number): string {
  if (!p || p <= 0 || p >= 1) return "N/A";
  if (p >= 0.5) return `-${Math.round((p / (1 - p)) * 100)}`;
  return `+${Math.round(((1 - p) / p) * 100)}`;
}

function timeAgo(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function DashboardScoreBreakdown({ breakdown, confidence, signal }: {
  breakdown: Record<string, number>;
  confidence: number;
  signal: any;
}) {
  const roiImplied = Math.round((breakdown.roiPct ?? 0) / 40 * 60);
  const items = [
    { label: "Trader ROI (40%)", val: breakdown.roiPct ?? 0, max: 40, color: "bg-blue-500",
      note: roiImplied > 0 ? `~${roiImplied}% avg ROI` : "low ROI data", low: (breakdown.roiPct ?? 0) < 8 },
    { label: "Consensus (30%)", val: breakdown.consensusPct ?? 0, max: 30, color: "bg-green-500",
      note: signal?.consensusPct ? `${signal.consensusPct}% same side` : "", low: false },
    { label: "Value Edge (20%)", val: breakdown.valuePct ?? 0, max: 20, color: "bg-yellow-500",
      note: signal?.valueDelta !== undefined
        ? signal.valueDelta > 0 ? `+${(signal.valueDelta*100).toFixed(1)}¢ edge`
          : Math.abs(signal.valueDelta) < 0.01 ? "at entry (slippage eats edge)"
          : `${(Math.abs(signal.valueDelta)*100).toFixed(1)}¢ worse than live`
        : "", low: (breakdown.valuePct ?? 0) === 0 },
    { label: "Position Size (10%)", val: breakdown.sizePct ?? 0, max: 10, color: "bg-purple-500",
      note: signal?.avgRiskUsdc ? `avg $${(signal.avgRiskUsdc/1000).toFixed(1)}K risk` : signal?.avgNetUsdc ? `avg $${(signal.avgNetUsdc/1000).toFixed(1)}K` : "", low: (breakdown.sizePct ?? 0) < 3 },
    { label: "Quality Bonus", val: breakdown.tierBonus ?? 0, max: 15, color: "bg-orange-500",
      note: signal?.avgQuality ? `quality ${signal.avgQuality}/100` : "", low: false },
  ];
  return (
    <div className="p-2.5 bg-muted/30 rounded-md border border-border/40 text-[10px]">
      <div className="flex items-center gap-1.5 mb-2">
        <BarChart2 className="w-3 h-3 text-muted-foreground" />
        <span className="font-semibold text-muted-foreground uppercase tracking-wide">Why {confidence}/95?</span>
      </div>
      <div className="space-y-1.5">
        {items.map(item => (
          <div key={item.label}>
            <div className="flex items-center justify-between mb-0.5">
              <span className={item.low ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>{item.label}</span>
              <span className="font-semibold tabular-nums">{item.val}/{item.max}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${item.color} opacity-70`} style={{ width: `${item.max > 0 ? (item.val / item.max) * 100 : 0}%` }} />
              </div>
              {item.note && <span className="text-muted-foreground shrink-0 max-w-[110px] truncate" title={item.note}>{item.note}</span>}
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-border/30 pt-1 mt-0.5">
          <span className="font-semibold">Total</span>
          <span className="font-bold text-primary">{confidence}/95 max</span>
        </div>
      </div>
    </div>
  );
}

function SignalExpandedPanel({ signal, onClose }: { signal: Signal; onClose: () => void }) {
  const s = signal as any;
  const outcomeLabel = s.outcomeLabel || getOutcomeLabel(signal.marketQuestion, signal.side as "YES" | "NO");
  const polyUrl = s.slug ? `https://polymarket.com/market/${s.slug}` : null;
  const condId: string = s.marketId || s.id || "";
  const [showBetModal, setShowBetModal] = useState(false);

  // SSE live price — updates every 3s from server
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [livePriceOdds, setLivePriceOdds] = useState<string>("");
  const [priceConnected, setPriceConnected] = useState(false);

  useEffect(() => {
    if (!condId) return;
    const es = new EventSource(`/api/stream?channel=price&conditionId=${encodeURIComponent(condId)}`);
    es.addEventListener("price", (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        setLivePrice(d.currentPrice);
        setLivePriceOdds(d.americanOdds || toAmericanOdds(d.currentPrice));
        setPriceConnected(true);
      } catch { /* ignore */ }
    });
    es.onerror = () => setPriceConnected(false);
    return () => es.close();
  }, [condId]);

  const displayPrice = livePrice ?? signal.currentPrice;
  const priceDiff = ((displayPrice - signal.avgEntryPrice) * 100).toFixed(1);
  const priceUp = displayPrice > signal.avgEntryPrice;

  return (
    <div className="mt-2 rounded-lg border border-border bg-muted/30 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold leading-snug text-foreground mb-1">{signal.marketQuestion}</div>
          <div className={`text-sm font-bold ${signal.side === "YES" ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
            {outcomeLabel}
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Game status + actionability */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <GameStatusBadge type={s.marketType} />
        {s.priceStatus === "actionable" && (
          <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
            <Target className="w-2.5 h-2.5" />ACTIONABLE
          </span>
        )}
        {s.priceStatus === "dip" && (
          <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/20" title="Price dipped BELOW sharp avg entry — better deal than smart money got">
            <TrendingDown className="w-2.5 h-2.5" />PRICE DIP ↓
          </span>
        )}
        {s.priceStatus === "moved" && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border" title="Price moved UP past sharp avg entry">
            PRICE MOVED ↑
          </span>
        )}
        {!s.priceStatus && s.isActionable === true && (
          <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
            <Target className="w-2.5 h-2.5" />ACTIONABLE
          </span>
        )}
        {!s.priceStatus && s.isActionable === false && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
            PRICE MOVED
          </span>
        )}
        {(s as any).relBetSize >= 3 && (s as any).hasCuratedElite && (
          <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/30"
            title={`Elite trader bet ${((s as any).relBetSize as number).toFixed(1)}× their typical stake`}>
            🔥 {((s as any).relBetSize as number).toFixed(1)}× NORMAL
          </span>
        )}
        {(s.bigPlayScore ?? 0) >= 2 && (
          <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/20">
            <DollarSign className="w-2.5 h-2.5" />BIG PLAY
          </span>
        )}
        {s.sportsLbCount > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-500/15 text-green-700 dark:text-green-300 border border-green-500/20">
            <ShieldCheck className="w-2.5 h-2.5" />SPORTS LB
          </span>
        )}
      </div>

      {/* Price comparison — live price via SSE */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-background rounded-md p-2 text-center border border-border/50">
          <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
            {priceConnected
              ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              : <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground" />}
            Live Price
          </div>
          <div className="text-base font-bold text-foreground">{(displayPrice * 100).toFixed(1)}¢</div>
          <div className="text-[10px] text-muted-foreground">{livePriceOdds || toAmericanOdds(displayPrice)}</div>
        </div>
        <div className="bg-background rounded-md p-2 text-center border border-border/50">
          <div className="text-[10px] text-muted-foreground">Avg Entry</div>
          <div className="text-base font-bold">{(signal.avgEntryPrice * 100).toFixed(1)}¢</div>
          <div className="text-[10px] text-muted-foreground">{toAmericanOdds(signal.avgEntryPrice)}</div>
        </div>
        <div className="bg-background rounded-md p-2 text-center border border-border/50">
          <div className="text-[10px] text-muted-foreground">Move</div>
          <div className={`text-base font-bold ${priceUp ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>
            {priceUp ? "+" : ""}{priceDiff}¢
          </div>
        </div>
      </div>

      {/* Value line */}
      {signal.valueDelta !== 0 && (
        <div className={`flex items-center gap-1.5 text-xs ${signal.valueDelta > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
          {signal.valueDelta > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          {signal.valueDelta > 0
            ? `${(signal.valueDelta * 100).toFixed(1)}¢ value edge vs current price`
            : `Price moved ${Math.abs(signal.valueDelta * 100).toFixed(1)}¢ past entry`}
        </div>
      )}

      {/* Game score + price chart */}
      <GameScorePanel
        slug={s.slug}
        conditionId={condId}
        yesTokenId={s.yesTokenId}
        noTokenId={s.noTokenId}
        side={signal.side as "YES" | "NO"}
        marketQuestion={signal.marketQuestion}
      />

      {/* Traders (ranked by size) */}
      {s.traders && s.traders.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center justify-between">
            <span>Traders — ranked by size ({s.traders.length})</span>
            {s.counterTraderCount > 0 && (
              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                ⚠ {s.counterTraderCount} on opposite side
              </span>
            )}
          </div>
          <div className="space-y-1">
            {s.traders.slice(0, 6).map((t: any, i: number) => (
              <div key={i} className="flex items-center gap-2 bg-muted/40 rounded px-2 py-1 text-xs">
                <span className="text-[9px] font-bold text-muted-foreground w-4 text-center shrink-0">#{i+1}</span>
                {t.isSportsLb && <span className="text-[9px] shrink-0">🏆</span>}
                {t.isLeaderboard && !t.isSportsLb && <span className="text-[9px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-0.5 rounded shrink-0">LB</span>}
                {t.address ? (
                  <a
                    href={`https://polymarket.com/profile/${t.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-mono truncate flex items-center gap-0.5 flex-1 min-w-0"
                    data-testid={`link-trader-${t.address}`}
                  >
                    {t.name || `${t.address.slice(0, 6)}…${t.address.slice(-4)}`}
                    <ExternalLink className="w-2 h-2 shrink-0 opacity-50" />
                  </a>
                ) : (
                  <span className="font-mono truncate flex-1">{t.name}</span>
                )}
                <div className="shrink-0 text-right space-y-0">
                  <div className="tabular-nums font-semibold">
                    {formatUsdc(t.riskUsdc ?? Math.round((t.size || 0) * (t.entryPrice || 0)))} risk @ {(t.entryPrice * 100).toFixed(0)}¢
                  </div>
                  <div className="flex items-center gap-1.5 justify-end flex-wrap">
                    {t.tradeTime > 0 && <span className="text-[9px] text-muted-foreground">{timeAgo(t.tradeTime)}</span>}
                    {(() => {
                      const avg = t.sportAvgBet ?? 0;
                      const bet = t.netUsdc ?? t.size ?? 0;
                      if (avg > 50 && bet > 0) {
                        const mult = bet / avg;
                        const isHigh = mult >= 2;
                        return (
                          <span className={`text-[9px] font-bold px-0.5 rounded ${isHigh ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}>
                            {mult.toFixed(1)}× avg
                          </span>
                        );
                      }
                      return null;
                    })()}
                    {(() => {
                      const displayRoi = t.sportRoi !== null && t.sportRoi !== undefined ? t.sportRoi : t.roi;
                      const roiLabel = t.sportRoi !== null && t.sportRoi !== undefined ? `${s.sport || "Sport"} ROI` : "ROI";
                      return displayRoi !== 0 ? (
                        <span className={`text-[9px] ${displayRoi >= 20 ? "text-green-600 dark:text-green-400" : displayRoi < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                          {displayRoi >= 0 ? "+" : ""}{displayRoi?.toFixed(0)}% {roiLabel}
                        </span>
                      ) : null;
                    })()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Score breakdown — why is this confidence? */}
      {s.scoreBreakdown && (
        <DashboardScoreBreakdown breakdown={s.scoreBreakdown} confidence={signal.confidence} signal={s} />
      )}

      {/* Confidence summary */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Score: <span className="font-bold text-foreground">{signal.confidence}/95</span></span>
        <span className="text-muted-foreground">{s.traderCount} trader{s.traderCount !== 1 ? "s" : ""} · {formatUsdc(s.totalRiskUsdc || s.totalNetUsdc || 0)} total risk</span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setShowBetModal(true)}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-xs font-semibold transition-colors"
          data-testid={`button-track-bet-dash-${signal.id}`}
        >
          <BookmarkPlus className="w-3.5 h-3.5" /> Track Bet
        </button>
        {polyUrl && (
          <a
            href={polyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            data-testid={`link-polymarket-${signal.id}`}
          >
            View on Polymarket <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      <DashboardTrackBetModal
        signal={signal}
        outcomeLabel={outcomeLabel}
        open={showBetModal}
        onClose={() => setShowBetModal(false)}
      />
    </div>
  );
}

function SignalRow({ signal }: { signal: Signal }) {
  const [expanded, setExpanded] = useState(false);
  const outcomeLabel = (signal as any).outcomeLabel || getOutcomeLabel(signal.marketQuestion, signal.side as "YES" | "NO");
  const s = signal as any;

  const outcomeColor = signal.side === "YES"
    ? "text-green-600 dark:text-green-400"
    : "text-red-500 dark:text-red-400";

  return (
    <div data-testid={`signal-row-${signal.id}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(e => !e)}
        onKeyDown={e => e.key === "Enter" && setExpanded(prev => !prev)}
        className="flex items-center gap-3 py-2.5 px-3 rounded-md hover-elevate cursor-pointer border border-transparent hover:border-border"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{signal.marketQuestion}</span>
            {s.marketType === "live" && (
              <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1 py-0 rounded bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20 animate-pulse shrink-0">
                <Radio className="w-2.5 h-2.5" />LIVE
              </span>
            )}
            {s.priceStatus === "actionable" && (
              <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1 py-0 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 shrink-0">
                <Target className="w-2.5 h-2.5" />ACT
              </span>
            )}
            {s.priceStatus === "dip" && (
              <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1 py-0 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20 shrink-0" title="Price dipped below what sharps paid">
                <TrendingDown className="w-2.5 h-2.5" />DIP
              </span>
            )}
            {!s.priceStatus && s.isActionable === true && (
              <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1 py-0 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 shrink-0">
                <Target className="w-2.5 h-2.5" />ACT
              </span>
            )}
            {(s.bigPlayScore ?? 0) >= 2 && (
              <span className="text-[10px] font-semibold px-1 py-0 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 shrink-0">🔥</span>
            )}
            {s.vipPremium === true && (
              <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1 py-0 rounded bg-violet-600/15 text-violet-700 dark:text-violet-300 border border-violet-500/30 shrink-0" title="Top-tier trader(s) in a strong sport/submarket lane with outsized stake — prioritized">
                <Award className="w-2.5 h-2.5" />VIP
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className={`text-xs font-semibold ${outcomeColor}`}>
              {outcomeLabel}
            </span>
            <span className="text-xs text-muted-foreground">@ {(signal.currentPrice * 100).toFixed(1)}¢</span>
            <span className="text-xs text-muted-foreground">{signal.traderCount} traders</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ConfidenceBadge score={signal.confidence} />
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-2">
          <SignalExpandedPanel signal={signal} onClose={() => setExpanded(false)} />
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, sub, color
}: {
  icon: any; label: string; value: string; sub?: string; color: string
}) {
  return (
    <Card data-testid={`stat-card-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-muted-foreground mb-1">{label}</div>
            <div className="text-2xl font-bold tracking-tight">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
          </div>
          <div className={`p-2 rounded-md ${color}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [signalTypeFilter, setSignalTypeFilter] = useState<"all" | "live" | "pregame" | "nofutures" | "actionable">("all");
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());
  const [hiddenAlertIds, setHiddenAlertIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("pi_hidden_alerts") || "[]")); } catch { return new Set(); }
  });
  const [showHiddenAlerts, setShowHiddenAlerts] = useState(false);
  const hideAlert = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHiddenAlertIds(prev => {
      const next = new Set(prev).add(id);
      localStorage.setItem("pi_hidden_alerts", JSON.stringify(Array.from(next)));
      return next;
    });
  };
  const unhideAllAlerts = () => {
    setHiddenAlertIds(new Set());
    localStorage.removeItem("pi_hidden_alerts");
    setShowHiddenAlerts(false);
  };
  const [livePrices, setLivePrices] = useState<Record<string, { price: number; americanOdds: string; fetchedAt: number }>>({});
  const [fetchingPrice, setFetchingPrice] = useState<Set<string>>(new Set());

  const refreshLivePrice = async (conditionId: string) => {
    if (!conditionId || fetchingPrice.has(conditionId)) return;
    setFetchingPrice(prev => new Set(prev).add(conditionId));
    try {
      const res = await fetch(`/api/market/price-by-condition/${conditionId}`);
      if (res.ok) {
        const data = await res.json();
        setLivePrices(prev => ({
          ...prev,
          [conditionId]: { price: data.currentPrice, americanOdds: data.americanOdds, fetchedAt: data.fetchedAt },
        }));
      }
    } finally {
      setFetchingPrice(prev => { const n = new Set(prev); n.delete(conditionId); return n; });
    }
  };

  const toggleAlert = (id: string) => setExpandedAlerts(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const { data: signalsData, isLoading: signalsLoading, error: signalsError, refetch: refetchSignals } =
    useQuery<SignalsResponse>({
      queryKey: ["/api/signals"],
      staleTime: 80_000,
      refetchInterval: SIGNAL_REFRESH_MS,
    });

  const { data: tradersData, isLoading: tradersLoading } =
    useQuery<LeaderboardResponse>({ queryKey: ["/api/traders"], staleTime: 5 * 60 * 1000 });

  const { data: marketsData, isLoading: marketsLoading } =
    useQuery<MarketsResponse>({
      queryKey: ["/api/markets", "upcoming"],
      queryFn: () => fetch("/api/markets?type=upcoming&limit=50").then(r => r.json()),
      staleTime: 25_000,
      refetchInterval: 30_000,
    });

  // Quick trader stats (loaded on demand per wallet)
  const [quickStats, setQuickStats] = useState<Record<string, any>>({});
  const loadTraderStats = async (wallet: string) => {
    const key = wallet.toLowerCase().slice(0, 42);
    if (quickStats[key]) return; // already loaded or loading
    setQuickStats(prev => ({ ...prev, [key]: "loading" }));
    try {
      const r = await fetch(`/api/trader/quick/${key}`);
      const data = await r.json();
      setQuickStats(prev => ({ ...prev, [key]: r.ok ? data : { error: data.error || "Failed" } }));
    } catch (e: any) {
      setQuickStats(prev => ({ ...prev, [key]: { error: e.message } }));
    }
  };

  // Live alerts via SSE — updates arrive automatically every 15s from the server
  const [alertsData, setAlertsData] = useState<{ alerts: any[]; fetchedAt: number } | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [lastAlertPush, setLastAlertPush] = useState<number>(0);
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/stream?channel=alerts");
    es.addEventListener("alerts", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setAlertsData(data);
        setLastAlertPush(Date.now());
        setAlertsLoading(false);
      } catch { /* ignore */ }
    });
    es.onerror = () => {
      // On SSE failure, fall back to one-shot fetch
      fetch("/api/alerts/live").then(r => r.json()).then(d => {
        setAlertsData(d);
        setAlertsLoading(false);
      }).catch(() => setAlertsLoading(false));
    };
    return () => es.close();
  }, []);

  const signals = signalsData?.signals || [];
  const highConfidence = signals.filter(s => s.confidence >= 70);
  const actionable = signals.filter(s => (s as any).isActionable === true);
  const traders = tradersData?.traders || [];

  const filteredSignals = signals.filter(s => {
    const mType = (s as any).marketType as string | undefined;
    const cat   = ((s as any).marketCategory || "").toLowerCase();
    if (signalTypeFilter === "live")       return mType === "live";
    if (signalTypeFilter === "pregame")    return mType === "pregame";
    if (signalTypeFilter === "nofutures")  return cat !== "futures" && mType !== "futures";
    if (signalTypeFilter === "actionable") return (s as any).isActionable === true;
    return true;
  });
  const topSignals = filteredSignals.slice(0, 8);

  const loading = signalsLoading || tradersLoading || marketsLoading;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Sports betting intelligence — live signals from top Polymarket traders
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetchSignals()}
          data-testid="button-refresh"
          className="gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {signalsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-4 pb-4 px-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))
        ) : (
          <>
            <StatCard
              icon={Zap}
              label="Active Signals"
              value={String(signals.length)}
              sub={`${highConfidence.length} high confidence`}
              color="bg-primary/10 text-primary"
            />
            <StatCard
              icon={Target}
              label="Actionable Now"
              value={String(actionable.length)}
              sub="Price still near entry"
              color="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            />
            <StatCard
              icon={Users}
              label="Tracked Traders"
              value={String(signalsData?.topTraderCount || 50)}
              sub="Curated elite traders"
              color="bg-blue-500/10 text-blue-600 dark:text-blue-400"
            />
            <StatCard
              icon={BarChart3}
              label="Markets Scanned"
              value={String(signalsData?.marketsScanned || 0)}
              sub="Active sports markets"
              color="bg-purple-500/10 text-purple-600 dark:text-purple-400"
            />
          </>
        )}
      </div>

      {/* Live Big Action Panel — above everything else for quick scanning */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-500" />
              <CardTitle className="text-sm font-semibold">Live Big Action</CardTitle>
              <span className="text-[10px] text-muted-foreground">
                — live push ·{" "}
                {lastAlertPush > 0
                  ? `${Math.round((nowTick - lastAlertPush) / 1000)}s ago`
                  : "connecting…"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {alertsData?.alerts?.filter((a: any) => a.isCurated).length ? (
                <Badge variant="secondary" className="text-[10px]">{alertsData.alerts.filter((a: any) => a.isCurated).length} bets</Badge>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {alertsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !alertsData?.alerts?.length ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
              <Bell className="w-3.5 h-3.5" />
              No large tracked-trader bets in recent data — check back shortly
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {/* Hidden alerts banner */}
              {hiddenAlertIds.size > 0 && (
                <div className="flex items-center justify-between px-1 py-1.5 text-[11px] bg-muted/40 rounded-md mb-1">
                  <span className="text-muted-foreground">{hiddenAlertIds.size} alert{hiddenAlertIds.size !== 1 ? "s" : ""} hidden</span>
                  <div className="flex gap-3">
                    <button
                      className="text-primary hover:underline font-medium"
                      onClick={() => setShowHiddenAlerts(v => !v)}
                      data-testid="button-toggle-hidden-alerts"
                    >
                      {showHiddenAlerts ? "Hide" : "Show"}
                    </button>
                    <button
                      className="text-muted-foreground hover:text-red-500 hover:underline"
                      onClick={unhideAllAlerts}
                      data-testid="button-unhide-all-alerts"
                    >
                      Clear all
                    </button>
                  </div>
                </div>
              )}
              {alertsData.alerts
                .filter((alert: any) => alert.isCurated)
                .filter((alert: any) => showHiddenAlerts || !hiddenAlertIds.has(alert.id))
                .slice(0, 15)
                .map((alert: any) => {
                const outcomeLabel = getOutcomeLabel(alert.market, alert.side);
                const isExpanded = expandedAlerts.has(alert.id);
                const isHidden = hiddenAlertIds.has(alert.id);
                const sharp = alert.sharpAction;
                return (
                  <div key={alert.id} data-testid={`live-alert-${alert.id}`} className={isHidden ? "opacity-40" : ""}>
                    {/* Main row — clickable */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleAlert(alert.id)}
                      onKeyDown={e => e.key === "Enter" && toggleAlert(alert.id)}
                      className="flex items-center gap-3 py-2.5 cursor-pointer rounded-md hover:bg-muted/40 transition-colors px-1 -mx-1"
                    >
                      {/* Side pill */}
                      <div className={`shrink-0 flex flex-col items-center justify-center w-12 h-12 rounded-lg font-bold text-xs border ${
                        alert.side === "YES"
                          ? "bg-green-500/10 border-green-500/25 text-green-700 dark:text-green-300"
                          : "bg-red-500/10 border-red-500/25 text-red-600 dark:text-red-400"
                      }`}>
                        <span className="text-[10px] leading-none">BET</span>
                        <span className="text-sm leading-tight font-black">{alert.side}</span>
                      </div>
                      {/* Market + outcome */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-foreground">{outcomeLabel}</span>
                          {alert.gameStatus === "live" && (
                            <span className="flex items-center gap-0.5 text-[10px] px-1 py-0 rounded bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20 font-semibold shrink-0 animate-pulse">
                              <Radio className="w-2.5 h-2.5" />LIVE
                            </span>
                          )}
                          {alert.gameStatus === "pregame" && (
                            <span className="flex items-center gap-0.5 text-[10px] px-1 py-0 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 font-semibold shrink-0">
                              <CalendarClock className="w-2.5 h-2.5" />PRE
                            </span>
                          )}
                          {alert.isCurated && (
                            <span className="text-[10px] px-1 py-0 rounded bg-violet-500/10 text-violet-700 dark:text-violet-300 border border-violet-500/20 font-semibold shrink-0" title="One of your 42 curated elite traders">★ Elite</span>
                          )}
                          {alert.isSportsLb && !alert.isCurated && (
                            <span className="text-[10px] px-1 py-0 rounded bg-primary/10 text-primary border border-primary/20 font-semibold shrink-0">LB</span>
                          )}
                          {sharp?.isActionable && (
                            <span className="text-[10px] px-1 py-0 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-semibold shrink-0">ACT</span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate mt-0.5">{alert.market}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] font-medium text-muted-foreground">{alert.trader}</span>
                          {alert.isSportsLb && (
                            <span className="text-[9px] font-bold text-green-600 dark:text-green-400">🏆 SPORTS LB</span>
                          )}
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" />{alert.timestamp ? timeAgo(alert.timestamp) : `${alert.minutesAgo}m ago`}
                          </span>
                          {alert.gameStartTime && (() => {
                            const dt = new Date(alert.gameStartTime);
                            const diffH = Math.round((dt.getTime() - Date.now()) / 3_600_000);
                            return diffH > 0 && diffH < 168 ? (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                <CalendarClock className="w-2.5 h-2.5" />
                                {diffH < 24 ? `${diffH}h away` : dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              </span>
                            ) : null;
                          })()}
                        </div>
                      </div>
                      {/* Size + expand chevron + hide */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="text-right">
                          <div className="text-sm font-bold tabular-nums">
                            ${alert.size >= 1000 ? `${(alert.size / 1000).toFixed(1)}K` : alert.size}
                          </div>
                          <div className="text-[10px] text-muted-foreground tabular-nums">
                            {Math.round(alert.price * 100)}¢ · {alert.americanOdds || toAmericanOdds(alert.price)}
                          </div>
                        </div>
                        {isExpanded
                          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                        <button
                          onClick={e => hideAlert(alert.id, e)}
                          data-testid={`button-hide-alert-${alert.id}`}
                          title="Hide this alert"
                          className="text-muted-foreground/50 hover:text-red-500 transition-colors ml-0.5 leading-none"
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    {/* Expanded detail panel */}
                    {isExpanded && (() => {
                      const lp = alert.conditionId ? livePrices[alert.conditionId] : undefined;
                      const isFetching = alert.conditionId ? fetchingPrice.has(alert.conditionId) : false;
                      const entryOdds = alert.americanOdds || toAmericanOdds(alert.price);
                      const tradeTimeStr = alert.timestamp ? timeAgo(alert.timestamp) : `${alert.minutesAgo}m ago`;
                      // Look up enriched trader profile from leaderboard data first
                      const traderProfile = traders.find((t: any) =>
                        alert.wallet && (t.address?.toLowerCase() === alert.wallet.toLowerCase() || t.polyId?.toLowerCase() === alert.wallet.toLowerCase())
                      ) as any | undefined;
                      // Fall back to quick-fetched stats
                      const walletKey = alert.wallet?.toLowerCase().slice(0, 42) || "";
                      const qsData = walletKey ? quickStats[walletKey] : undefined;
                      const qsLoaded = qsData && qsData !== "loading" && !qsData.error;
                      const effectiveProfile = traderProfile || (qsLoaded ? qsData : null);
                      const qs = effectiveProfile?.qualityScore || alert.qualityScore || 0;
                      const roiDisplay = effectiveProfile?.sportRoi ?? effectiveProfile?.roi ?? alert.roi ?? 0;
                      const roiLabel = effectiveProfile?.sportRoi !== undefined ? "Sport ROI" : "ROI";
                      const winRate = effectiveProfile?.winRate ?? 0;
                      const traderTags: string[] = effectiveProfile?.tags || [];
                      return (
                      <div className="mb-2 mx-1 p-3 rounded-md bg-muted/50 border border-border space-y-2 text-xs">
                        {/* Full market title */}
                        <div className="font-semibold text-foreground">{alert.market}</div>

                        {/* Trader quality row */}
                        <div className="flex items-center gap-2 flex-wrap text-[11px]">
                          <span className="font-medium text-foreground">{alert.trader}</span>
                          {alert.isSportsLb && (
                            <span className="px-1 py-0.5 rounded bg-green-500/15 text-green-700 dark:text-green-300 border border-green-500/20 font-semibold">🏆 Sports LB</span>
                          )}
                          {alert.isTracked && !traderProfile && (
                            <span className="px-1 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20 font-semibold">Elite Trader</span>
                          )}
                          {qs > 0 && (
                            <span className={`px-1 py-0.5 rounded border font-semibold ${qs >= 70 ? "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20" : qs >= 40 ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/20" : "bg-muted text-muted-foreground border-border"}`}>
                              Quality {qs}
                            </span>
                          )}
                          {roiDisplay !== 0 && (
                            <span className={roiDisplay >= 15 ? "text-green-600 dark:text-green-400 font-semibold" : roiDisplay < 0 ? "text-red-500" : "text-muted-foreground"}>
                              {roiDisplay >= 0 ? "+" : ""}{roiDisplay.toFixed(0)}% {roiLabel}
                            </span>
                          )}
                          {winRate > 0 && <span className="text-muted-foreground">{winRate.toFixed(0)}% WR</span>}
                          {qsLoaded && qsData.totalBets > 0 && (
                            <span className="text-muted-foreground">{qsData.totalBets} bets</span>
                          )}
                          <span className="text-muted-foreground">{tradeTimeStr}</span>
                        </div>
                        {/* Trader sport tags */}
                        {traderTags.length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            {traderTags.slice(0, 4).map((tag: string) => (
                              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted border border-border/60 text-muted-foreground">{tag}</span>
                            ))}
                          </div>
                        )}

                        {/* Quick-fetched extended stats panel */}
                        {qsLoaded && (
                          <div className="rounded border border-border/60 bg-background/60 p-2 space-y-1.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                              <span>Trader Quick Stats</span>
                              {!qsData.isElite && <span className="text-[9px] font-normal normal-case">(from Polymarket activity)</span>}
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-[11px]">
                              {qsData.winRate !== null && (
                                <div>
                                  <div className="text-muted-foreground text-[9px] uppercase tracking-wide">Win Rate</div>
                                  <div className={`font-bold ${qsData.winRate >= 55 ? "text-green-600 dark:text-green-400" : qsData.winRate < 45 ? "text-red-500" : "text-foreground"}`}>
                                    {qsData.winRate}%
                                  </div>
                                  {qsData.resolvedBets != null && <div className="text-[9px] text-muted-foreground">{qsData.resolvedBets} resolved</div>}
                                </div>
                              )}
                              {qsData.roi !== null && (
                                <div>
                                  <div className="text-muted-foreground text-[9px] uppercase tracking-wide">ROI</div>
                                  <div className={`font-bold ${qsData.roi >= 10 ? "text-green-600 dark:text-green-400" : qsData.roi < 0 ? "text-red-500" : "text-foreground"}`}>
                                    {qsData.roi >= 0 ? "+" : ""}{qsData.roi}%
                                  </div>
                                </div>
                              )}
                              {qsData.totalVolume != null && qsData.totalVolume > 0 && (
                                <div>
                                  <div className="text-muted-foreground text-[9px] uppercase tracking-wide">Volume</div>
                                  <div className="font-bold">${qsData.totalVolume >= 1000 ? `${(qsData.totalVolume / 1000).toFixed(0)}K` : qsData.totalVolume}</div>
                                  {qsData.totalPnl != null && (
                                    <div className={`text-[9px] ${qsData.totalPnl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                                      PnL {qsData.totalPnl >= 0 ? "+" : ""}${qsData.totalPnl >= 1000 ? `${(qsData.totalPnl / 1000).toFixed(1)}K` : qsData.totalPnl}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            {/* Verdict */}
                            {qsData.winRate !== null && qsData.roi !== null && (
                              <div className={`text-[10px] font-medium px-2 py-1 rounded ${
                                qsData.winRate >= 55 && qsData.roi >= 10
                                  ? "bg-green-500/10 text-green-700 dark:text-green-300"
                                  : qsData.winRate < 45 || qsData.roi < -10
                                  ? "bg-red-500/10 text-red-700 dark:text-red-300"
                                  : "bg-muted text-muted-foreground"
                              }`}>
                                {qsData.winRate >= 55 && qsData.roi >= 10
                                  ? "Sharp trader — historically profitable"
                                  : qsData.winRate < 45 || qsData.roi < -10
                                  ? "Below-average trader — use caution"
                                  : "Average trader — neutral track record"}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Load stats button for un-fetched traders */}
                        {!effectiveProfile && qsData !== "loading" && !qsLoaded && walletKey && (
                          <button
                            onClick={e => { e.stopPropagation(); loadTraderStats(walletKey); }}
                            data-testid={`btn-load-trader-stats-${alert.id}`}
                            className="text-[11px] text-primary hover:underline font-medium flex items-center gap-1"
                          >
                            Load trader stats ↓
                          </button>
                        )}
                        {qsData === "loading" && (
                          <div className="text-[11px] text-muted-foreground animate-pulse">Loading trader stats…</div>
                        )}
                        {qsData?.error && (
                          <div className="text-[11px] text-red-500">Could not load stats: {qsData.error}</div>
                        )}

                        {/* Match time (pregame) */}
                        {alert.gameStartTime && (() => {
                          const gdt = new Date(alert.gameStartTime);
                          return (
                            <div className="flex items-center gap-1.5 text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                              <CalendarClock className="w-3.5 h-3.5" />
                              Game: {gdt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET
                            </div>
                          );
                        })()}

                        {/* Bet details row */}
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">Bet:</span>
                            <span className={`font-bold ${alert.side === "YES" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                              {outcomeLabel}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">Size:</span>
                            <span className="font-bold">${alert.size >= 1000 ? `${(alert.size / 1000).toFixed(1)}K` : alert.size}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">Entry:</span>
                            <span className="font-bold tabular-nums">{Math.round(alert.price * 100)}¢ ({entryOdds})</span>
                          </div>
                          {/* Live price cell */}
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">Live:</span>
                            {lp ? (
                              <span className="font-bold tabular-nums text-blue-600 dark:text-blue-400">
                                {Math.round(lp.price * 100)}¢ ({lp.americanOdds})
                              </span>
                            ) : (
                              <button
                                onClick={e => { e.stopPropagation(); refreshLivePrice(alert.conditionId); }}
                                disabled={isFetching || !alert.conditionId}
                                data-testid={`btn-refresh-price-${alert.id}`}
                                className="text-primary hover:underline disabled:opacity-50 font-medium"
                              >
                                {isFetching ? "Loading…" : "Fetch ↺"}
                              </button>
                            )}
                            {lp && (
                              <button
                                onClick={e => { e.stopPropagation(); refreshLivePrice(alert.conditionId); }}
                                disabled={isFetching}
                                data-testid={`btn-refresh-price-live-${alert.id}`}
                                className="text-muted-foreground hover:text-foreground ml-0.5 disabled:opacity-50"
                                title="Refresh live price"
                              >
                                {isFetching ? "…" : "↺"}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Sharp consensus context */}
                        {sharp ? (
                          <div className={`p-2 rounded border text-[11px] ${
                            sharp.isActionable
                              ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                              : "bg-primary/5 border-primary/15 text-primary"
                          }`}>
                            <div className="font-semibold mb-0.5">
                              Sharp consensus: {sharp.traderCount} tracked traders → {sharp.side} · {sharp.confidence}/100
                            </div>
                            <div>
                              Avg entry: {Math.round(sharp.avgEntry * 100)}¢ ({toAmericanOdds(sharp.avgEntry)}) · 
                              Live price: {Math.round(sharp.currentPrice * 100)}¢ ({toAmericanOdds(sharp.currentPrice)})
                              {sharp.priceStatus === "dip" ? " · PRICE DIP — better entry than sharps got" : sharp.isActionable ? " · Still at entry price" : " · Price has moved past entry"}
                            </div>
                          </div>
                        ) : (
                          <div className="text-muted-foreground text-[11px]">
                            No consensus signal for this market yet — individual tracked-trader bet.
                          </div>
                        )}

                        {/* Polymarket link */}
                        {alert.slug && (
                          <a
                            href={`https://polymarket.com/market/${alert.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-primary hover:underline font-medium"
                            onClick={e => e.stopPropagation()}
                          >
                            Trade on Polymarket <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {/* Top Signals */}
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-sm">Top Signals</h2>
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Signal type filter toggles */}
              {(["all", "live", "pregame", "nofutures", "actionable"] as const).map(f => {
                const labels: Record<typeof f, string> = {
                  all: "All", live: "Live", pregame: "Pregame", nofutures: "No Futures",
                  actionable: `Actionable (${actionable.length})`,
                };
                return (
                  <button
                    key={f}
                    onClick={() => setSignalTypeFilter(f)}
                    data-testid={`filter-signals-${f}`}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                      signalTypeFilter === f
                        ? f === "live"
                          ? "bg-red-500 text-white border-red-500"
                          : f === "pregame"
                          ? "bg-blue-500 text-white border-blue-500"
                          : f === "actionable"
                          ? "bg-green-600 text-white border-green-600"
                          : "bg-primary text-primary-foreground border-primary"
                        : "bg-muted border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f === "live" && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1 animate-pulse align-middle" />}
                    {labels[f]}
                  </button>
                );
              })}
              <span className="text-[10px] text-muted-foreground hidden sm:inline">90s refresh</span>
              <Link href="/signals">
                <Button size="sm" variant="ghost" className="gap-1.5 h-7 text-xs" data-testid="link-all-signals">
                  View all <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          </div>

          <Card>
            <CardContent className="p-2">
              {signalsLoading ? (
                <div className="space-y-1">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="px-3 py-2.5">
                      <Skeleton className="h-4 w-3/4 mb-1.5" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : signalsError ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                  <AlertCircle className="w-8 h-8 text-muted-foreground" />
                  <div>
                    <div className="font-medium text-sm">Unable to fetch signals</div>
                    <div className="text-xs text-muted-foreground mt-1 max-w-xs">
                      Polymarket APIs may be rate-limited. Try refreshing.
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => refetchSignals()}>Retry</Button>
                </div>
              ) : topSignals.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                  <Activity className="w-8 h-8 text-muted-foreground" />
                  <div>
                    <div className="font-medium text-sm">
                      {signalTypeFilter !== "all" ? `No ${signalTypeFilter === "nofutures" ? "non-futures" : signalTypeFilter} signals right now` : "No signals generated yet"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 max-w-xs">
                      {signalTypeFilter !== "all"
                        ? "Try a different filter or check back after the next refresh."
                        : "Signals appear when 2+ top traders share a consensus position on sports markets."}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {topSignals.map(signal => (
                    <SignalRow key={signal.id} signal={signal} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* How It Works */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">How PredictionInsider Works</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                icon: Users,
                title: `${signalsData?.topTraderCount || 50} Curated Elite Traders`,
                desc: "50 hand-picked Polymarket sharpies analyzed from raw trade CSVs. Scored on ROI, Sharpe ratio, win rate, and consistency — no leaderboard guesswork.",
              },
              {
                icon: Activity,
                title: "Consensus + Actionability",
                desc: "When 50%+ of tracked traders share a position, we flag it. ACTIONABLE means the current market price is still close to where they entered — you can still get in.",
              },
              {
                icon: Target,
                title: "Big Play Detection",
                desc: "Signals with large capital deployed (BIG PLAY) indicate high conviction. We weight signals by bet size, trader quality, and consensus strength.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-3">
                <div className="p-2 rounded-md bg-muted h-fit shrink-0">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-sm font-medium">{title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
