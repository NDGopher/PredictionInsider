import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback } from "react";
import GameScorePanel from "@/components/GameScorePanel";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Zap, Search, ExternalLink, TrendingUp, TrendingDown, AlertCircle,
  RefreshCw, Users, Target, ChevronDown, ChevronUp, Star, Activity,
  Bell, BellOff, Clock, DollarSign, ShieldCheck, AlertTriangle, Radio,
  Hourglass, CalendarClock, BarChart2, Flame, ChevronRight, BookmarkPlus, EyeOff, X
} from "lucide-react";
import { Link } from "wouter";
import type { SignalsResponse, Signal } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

// ─── Auto-refresh intervals ────────────────────────────────────────────────────
const ELITE_REFRESH_SEC = 120;       // 2 minutes (was 5 min)
const FAST_REFRESH_SEC  = 45;        // 45 seconds (was 90s)

// ─── Snooze helpers (localStorage) ────────────────────────────────────────────
const SNOOZE_KEY = "pi_snoozed";
function getSnoozed(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || "{}"); } catch { return {}; }
}
function snoozeSignal(id: string, hours: number) {
  const s = getSnoozed();
  s[id] = Date.now() + hours * 3600_000;
  localStorage.setItem(SNOOZE_KEY, JSON.stringify(s));
}
function unsnoozeSignal(id: string) {
  const s = getSnoozed();
  delete s[id];
  localStorage.setItem(SNOOZE_KEY, JSON.stringify(s));
}
function isSignalSnoozed(id: string): boolean {
  const s = getSnoozed();
  const until = s[id];
  if (!until) return false;
  if (Date.now() > until) { unsnoozeSignal(id); return false; }
  return true;
}

// ─── Bet tracker helpers (localStorage) ────────────────────────────────────────
const BET_KEY = "pi_bets";
function trackBetFromSignal(signal: Signal, outcomeLabel: string) {
  try {
    const bets = JSON.parse(localStorage.getItem(BET_KEY) || "[]");
    bets.unshift({
      id: `bet-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      marketQuestion: signal.marketQuestion,
      outcomeLabel,
      side: signal.side,
      conditionId: signal.marketId,
      slug: (signal as any).slug,
      entryPrice: signal.avgEntryPrice,
      betAmount: 0,
      betDate: Date.now(),
      status: "open",
      notes: `Signal confidence: ${signal.confidence}/95`,
    });
    localStorage.setItem(BET_KEY, JSON.stringify(bets));
  } catch {}
}

// ─── Alert history (localStorage) ─────────────────────────────────────────────
const ALERT_KEY = "pi_alert_ids";
function getSeenAlerts(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(ALERT_KEY) || "[]")); } catch { return new Set(); }
}
function saveSeenAlert(id: string) {
  try {
    const s = getSeenAlerts(); s.add(id);
    localStorage.setItem(ALERT_KEY, JSON.stringify(Array.from(s).slice(-500)));
  } catch {}
}

// ─── Browser notification helper ──────────────────────────────────────────────
async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const perm = await Notification.requestPermission();
  return perm === "granted";
}

function sendNotification(title: string, body: string) {
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch {}
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function ConfidenceBar({ score }: { score: number }) {
  const color = score >= 75 ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-bold tabular-nums w-7 text-right">{score}</span>
    </div>
  );
}

function QualityPip({ score }: { score: number }) {
  if (!score && score !== 0) return null;
  const color = score >= 70 ? "text-green-600 dark:text-green-400" : score >= 40 ? "text-yellow-600" : "text-red-500";
  return (
    <span className={`text-[10px] font-semibold ${color} flex items-center gap-0.5`} title="Trader quality score">
      <ShieldCheck className="w-2.5 h-2.5" />{score}
    </span>
  );
}

function formatUsdc(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1000)      return `$${(val / 1000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function timeAgoShort(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function MarketTypePill({ type }: { type?: string }) {
  if (!type) return null;
  if (type === "live")    return <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20"><Radio className="w-2.5 h-2.5" />LIVE</span>;
  if (type === "pregame") return <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20"><Hourglass className="w-2.5 h-2.5" />PREGAME</span>;
  return <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border"><CalendarClock className="w-2.5 h-2.5" />FUTURES</span>;
}

function ScoreBreakdown({ breakdown, confidence, signal }: {
  breakdown: Record<string, number>;
  confidence: number;
  signal?: any;
}) {
  const roiImplied  = Math.round((breakdown.roiPct ?? 0) / 40 * 60);
  const items = [
    {
      label: "Trader ROI (40%)",
      val: breakdown.roiPct ?? 0,
      max: 40,
      color: "bg-blue-500",
      note: roiImplied > 0 ? `avg ~${roiImplied}% ROI` : "low/no ROI data",
      low: (breakdown.roiPct ?? 0) < 8,
    },
    {
      label: "Consensus (30%)",
      val: breakdown.consensusPct ?? 0,
      max: 30,
      color: "bg-green-500",
      note: signal?.consensusPct ? `${signal.consensusPct}% on same side` : "",
      low: false,
    },
    {
      label: "Value Edge (20%)",
      val: breakdown.valuePct ?? 0,
      max: 20,
      color: "bg-yellow-500",
      note: signal?.valueDelta !== undefined
        ? signal.valueDelta > 0
          ? `+${(signal.valueDelta * 100).toFixed(1)}¢ edge vs current`
          : signal.valueDelta === 0 || Math.abs(signal.valueDelta) < 0.01
          ? "at entry (slippage eats edge)"
          : `entry ${(Math.abs(signal.valueDelta) * 100).toFixed(1)}¢ worse than live`
        : "",
      low: (breakdown.valuePct ?? 0) === 0,
    },
    {
      label: "Position Size (10%)",
      val: breakdown.sizePct ?? 0,
      max: 10,
      color: "bg-purple-500",
      note: signal?.avgNetUsdc ? `avg $${(signal.avgNetUsdc / 1000).toFixed(1)}K (threshold $15K)` : "",
      low: (breakdown.sizePct ?? 0) < 3,
    },
    {
      label: "Quality Bonus",
      val: breakdown.tierBonus ?? 0,
      max: 15,
      color: "bg-orange-500",
      note: signal?.avgQuality ? `avg quality ${signal.avgQuality}/100` : "",
      low: false,
    },
  ];

  return (
    <div className="mt-2 p-2.5 bg-muted/30 rounded-md border border-border/40">
      <div className="flex items-center gap-1.5 mb-2">
        <BarChart2 className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Why {confidence}/100?</span>
      </div>
      <div className="space-y-1.5">
        {items.map(item => (
          <div key={item.label}>
            <div className="flex items-center justify-between text-[10px] mb-0.5">
              <span className={item.low ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>{item.label}</span>
              <span className="font-semibold tabular-nums">{item.val}/{item.max}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${item.color} opacity-70`} style={{ width: `${item.max > 0 ? (item.val / item.max) * 100 : 0}%` }} />
              </div>
              {item.note && <span className="text-[9px] text-muted-foreground shrink-0 max-w-[120px] truncate" title={item.note}>{item.note}</span>}
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between text-[10px] border-t border-border/30 pt-1.5 mt-1">
          <span className="font-semibold">Total</span>
          <span className="font-bold text-primary">{confidence}/95 max</span>
        </div>
      </div>
    </div>
  );
}

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

function SignalCard({ signal, mode, onSnoozed }: { signal: Signal; mode: "elite" | "fast"; onSnoozed?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const { toast } = useToast();

  // Auto-show score breakdown when card is expanded
  useEffect(() => {
    if (expanded && (signal as any).scoreBreakdown) setShowBreakdown(true);
  }, [expanded]);

  // Subscribe to SSE price stream while expanded
  useEffect(() => {
    if (!expanded) { setLivePrice(null); return; }
    const condId = (signal as any).marketId || signal.id;
    if (!condId) return;
    const es = new EventSource(`/api/stream?channel=price&conditionId=${condId}`);
    es.addEventListener("price", (e: MessageEvent) => {
      try { const d = JSON.parse(e.data); if (typeof d.price === "number") setLivePrice(d.price); } catch {}
    });
    return () => es.close();
  }, [expanded, signal.id, (signal as any).marketId]);

  const borderCls = signal.side === "YES"
    ? "border-green-500/25"
    : "border-red-500/25";

  const confidenceLabel =
    signal.confidence >= 75 ? { label: "HIGH", cls: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20" } :
    signal.confidence >= 50 ? { label: "MED",  cls: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20" } :
    { label: "LOW", cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20" };

  const polyUrl = signal.slug
    ? `https://polymarket.com/market/${signal.slug}`
    : signal.marketId ? `https://polymarket.com/event/${signal.marketId}` : null;

  const outcomeLabel = (signal as any).outcomeLabel || getOutcomeLabel(signal.marketQuestion, signal.side as "YES" | "NO");

  const totalNetUsdc = (signal as any).totalNetUsdc as number | undefined;
  const avgNetUsdc   = (signal as any).avgNetUsdc   as number | undefined;

  return (
    <Card className={`border ${borderCls}`} data-testid={`signal-card-${signal.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Side indicator strip */}
          <div className={`mt-0.5 shrink-0 w-1 self-stretch rounded-full
            ${signal.side === "YES" ? "bg-green-500" : "bg-red-500"}`} />

          <div className="flex-1 min-w-0">
            {/* Title row */}
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                {polyUrl ? (
                  <a
                    href={polyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold leading-snug hover:text-primary hover:underline transition-colors cursor-pointer block"
                    data-testid={`signal-question-${signal.id}`}
                  >
                    {signal.marketQuestion}
                  </a>
                ) : (
                  <div className="text-sm font-semibold leading-snug" data-testid={`signal-question-${signal.id}`}>
                    {signal.marketQuestion}
                  </div>
                )}
                {/* Outcome label — the specific bet this signal represents */}
                <div className={`mt-0.5 text-xs font-bold ${signal.side === "YES" ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}
                  data-testid={`signal-outcome-${signal.id}`}>
                  {outcomeLabel} <span className="font-normal text-muted-foreground">@ {(signal.currentPrice * 100).toFixed(1)}¢</span>
                </div>
                {/* Game date/time for pregame signals */}
                {((signal as any).marketType === "pregame" || (signal as any).marketType === "live") && ((signal as any).gameStartTime || (signal as any).endDate) && (() => {
                  const dt = new Date((signal as any).gameStartTime || (signal as any).endDate);
                  const now2 = Date.now();
                  const diffMs = dt.getTime() - now2;
                  const diffH = Math.round(diffMs / 3_600_000);
                  const label = diffMs < 0
                    ? "In progress"
                    : diffH < 1 ? "< 1h away"
                    : diffH < 24 ? `${diffH}h away`
                    : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
                  return (
                    <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground" data-testid={`signal-gametime-${signal.id}`}>
                      <CalendarClock className="w-3 h-3 shrink-0" />
                      <span>{label}</span>
                    </div>
                  );
                })()}
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${confidenceLabel.cls}`}>
                    {confidenceLabel.label} CONFIDENCE
                  </span>
                  {/* Tier badge */}
                  {(signal as any).tier === "HIGH" && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/20 flex items-center gap-0.5">
                      <Users className="w-2.5 h-2.5" />{signal.traderCount} TRADERS
                    </span>
                  )}
                  {(signal as any).tier === "MED" && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-0.5">
                      <Users className="w-2.5 h-2.5" />{signal.traderCount} TRADERS
                    </span>
                  )}
                  {(signal as any).tier === "SINGLE" && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                      WHALE SIGNAL
                    </span>
                  )}
                  {/* Market type */}
                  <MarketTypePill type={(signal as any).marketType} />
                  {/* Actionability indicator — 3-state */}
                  {(signal as any).priceStatus === "actionable" && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 flex items-center gap-0.5" title="Current price is still close to average sharp entry — actionable now">
                      <Target className="w-2.5 h-2.5" /> ACTIONABLE
                    </span>
                  )}
                  {(signal as any).priceStatus === "dip" && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/20 flex items-center gap-0.5" title="Price has dipped BELOW what sharps paid — potentially a better entry than the smart money got">
                      <TrendingDown className="w-2.5 h-2.5" /> PRICE DIP ↓
                    </span>
                  )}
                  {(signal as any).priceStatus === "moved" && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border" title="Price has moved UP significantly past sharp avg entry — sharps got a better price than you can get now">
                      PRICE MOVED ↑
                    </span>
                  )}
                  {/* Legacy fallback for signals without priceStatus */}
                  {!(signal as any).priceStatus && (signal as any).isActionable === true && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 flex items-center gap-0.5">
                      <Target className="w-2.5 h-2.5" /> ACTIONABLE
                    </span>
                  )}
                  {/* Big play indicator */}
                  {((signal as any).bigPlayScore ?? 0) >= 2 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/20 flex items-center gap-0.5" title="Large capital deployed — significant bet">
                      <DollarSign className="w-2.5 h-2.5" /> BIG PLAY
                    </span>
                  )}
                  {signal.isValue && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                      VALUE EDGE
                    </span>
                  )}
                  {(signal as any).splitOU && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/20 flex items-center gap-0.5" title="Sharps are split between Over and Under on this game at different lines — conflicting O/U signal, reduced confidence">
                      ⚡ SPLIT O/U
                    </span>
                  )}
                  {(signal as any).isNew && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/20 flex items-center gap-0.5">
                      <AlertTriangle className="w-2.5 h-2.5" /> NEW
                    </span>
                  )}
                  {mode === "elite" && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20 flex items-center gap-0.5">
                      <Star className="w-2.5 h-2.5" /> ELITE
                    </span>
                  )}
                  {(signal as any).sportsLbCount > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-500/15 text-green-700 dark:text-green-300 border border-green-500/20 flex items-center gap-0.5" title="At least one verified sports leaderboard trader">
                      <ShieldCheck className="w-2.5 h-2.5" /> SPORTS LB
                    </span>
                  )}
                  {(signal as any).source === "positions" && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-0.5" title="Signal derived from current open positions of verified sports traders">
                      <BarChart2 className="w-2.5 h-2.5" /> POSITIONS
                    </span>
                  )}
                </div>
              </div>
              {/* Net USDC aggregate */}
              {totalNetUsdc && totalNetUsdc > 0 && (
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-foreground">{formatUsdc(totalNetUsdc)}</div>
                  <div className="text-[10px] text-muted-foreground">elite net pos.</div>
                </div>
              )}
            </div>

            {/* Confidence bar */}
            <div className="mt-3">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                <span>Confidence Score</span>
                <span>{signal.confidence}/100</span>
              </div>
              <ConfidenceBar score={signal.confidence} />
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              <div className="bg-muted/50 rounded-md p-2">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  {livePrice !== null && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />}
                  Live Price
                </div>
                <div className="text-sm font-semibold">
                  {livePrice !== null
                    ? `${(livePrice * 100).toFixed(1)}¢`
                    : `${(signal.currentPrice * 100).toFixed(1)}¢`}
                </div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="text-[10px] text-muted-foreground">Avg Entry</div>
                <div className="text-sm font-semibold">{(signal.avgEntryPrice * 100).toFixed(1)}¢</div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="text-[10px] text-muted-foreground">Consensus</div>
                <div className="text-sm font-semibold">{signal.consensusPct}%</div>
              </div>
              <div className="bg-muted/50 rounded-md p-2">
                <div className="text-[10px] text-muted-foreground">
                  {mode === "elite" ? "Avg Net Size" : "Traders"}
                </div>
                <div className="text-sm font-semibold">
                  {mode === "elite" && avgNetUsdc
                    ? formatUsdc(avgNetUsdc)
                    : signal.traderCount}
                </div>
              </div>
            </div>

            {/* Value delta line */}
            {signal.valueDelta !== 0 && (
              <div className={`flex items-center gap-1.5 mt-2 text-xs
                ${signal.valueDelta > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                {signal.valueDelta > 0
                  ? <TrendingUp className="w-3.5 h-3.5" />
                  : <TrendingDown className="w-3.5 h-3.5" />}
                {signal.valueDelta > 0
                  ? `${(signal.valueDelta * 100).toFixed(1)}¢ value edge over live price (incl. 2¢ slippage)`
                  : `Elite avg entry was ${Math.abs(signal.valueDelta * 100).toFixed(1)}¢ below live price`}
              </div>
            )}

            {/* Footer row */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  data-testid={`button-expand-${signal.id}`}
                >
                  {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {expanded ? "Hide" : "Show"} traders ({signal.traderCount})
                </button>
                {(signal as any).scoreBreakdown && (
                  <button
                    onClick={() => setShowBreakdown(!showBreakdown)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    data-testid={`button-breakdown-${signal.id}`}
                  >
                    <BarChart2 className="w-3 h-3" />
                    {showBreakdown ? "Hide" : "Show"} score
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {/* Track Bet button */}
                <Link href="/bets">
                  <button
                    onClick={() => {
                      const outcomeLabel = getOutcomeLabel(signal.marketQuestion, signal.side as "YES" | "NO");
                      trackBetFromSignal(signal, outcomeLabel);
                      toast({ title: "Bet logged!", description: `Added ${outcomeLabel} to My Bets. Set your amount there.` });
                    }}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                    data-testid={`button-track-bet-${signal.id}`}
                    title="Log this signal as a bet"
                  >
                    <BookmarkPlus className="w-3 h-3" /> Track
                  </button>
                </Link>

                {/* Snooze button */}
                <div className="relative">
                  <button
                    onClick={() => setShowSnoozeMenu(s => !s)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    data-testid={`button-snooze-${signal.id}`}
                    title="Hide this signal for a while"
                  >
                    <EyeOff className="w-3 h-3" />
                  </button>
                  {showSnoozeMenu && (
                    <div className="absolute right-0 bottom-6 bg-background border border-border rounded-lg shadow-lg p-1 z-50 min-w-[130px]">
                      <div className="text-[10px] font-semibold text-muted-foreground px-2 py-1">Snooze for...</div>
                      {[["1h", 1], ["4h", 4], ["24h", 24], ["3 days", 72]].map(([label, hrs]) => (
                        <button
                          key={label as string}
                          onClick={() => {
                            snoozeSignal(signal.id, hrs as number);
                            setShowSnoozeMenu(false);
                            onSnoozed?.(signal.id);
                            toast({ title: `Signal snoozed ${label}`, description: signal.marketQuestion });
                          }}
                          className="w-full text-left px-2 py-1 text-xs hover:bg-muted rounded transition-colors"
                          data-testid={`button-snooze-${label}-${signal.id}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {polyUrl && (
                  <a
                    href={polyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary"
                    data-testid={`link-polymarket-${signal.id}`}
                  >
                    View on Polymarket <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>

            {/* Score breakdown + counter-trader warning */}
            {showBreakdown && (signal as any).scoreBreakdown && (
              <div className="mt-3">
                {(signal as any).counterTraderCount > 0 && (
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] px-2 py-1.5 bg-amber-500/10 border border-amber-500/25 rounded text-amber-700 dark:text-amber-400">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span><strong>{(signal as any).counterTraderCount}</strong> tracked trader{(signal as any).counterTraderCount !== 1 ? "s" : ""} hold the opposite position — reduces conviction</span>
                  </div>
                )}
                <ScoreBreakdown breakdown={(signal as any).scoreBreakdown} confidence={signal.confidence} signal={signal} />
              </div>
            )}

            {/* Game score + price chart */}
            {expanded && (
              <div className="mt-3">
                <GameScorePanel
                  slug={(signal as any).slug}
                  conditionId={signal.marketId}
                  yesTokenId={(signal as any).yesTokenId}
                  noTokenId={(signal as any).noTokenId}
                  side={signal.side as "YES" | "NO"}
                  marketQuestion={signal.marketQuestion}
                />
              </div>
            )}

            {/* Expanded trader list */}
            {expanded && signal.traders.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <div className="grid grid-cols-5 text-[10px] text-muted-foreground font-medium px-2.5 py-1">
                  <span className="col-span-2">Trader (sorted by size)</span>
                  <span className="text-right">Entry</span>
                  <span className="text-right">Size</span>
                  <span className="text-right">Quality / Time</span>
                </div>
                {signal.traders.map((t, i) => (
                  <div key={i} className="grid grid-cols-5 items-center bg-muted/40 rounded px-2.5 py-1.5 text-xs gap-1">
                    {/* Rank + name */}
                    <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                      <span className="shrink-0 text-[9px] font-bold text-muted-foreground w-3.5 text-center">#{i + 1}</span>
                      {t.address ? (
                        <a
                          href={`https://polymarket.com/profile/${t.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline font-mono truncate flex items-center gap-0.5"
                          data-testid={`link-trader-${t.address}`}
                          title="View on Polymarket"
                        >
                          {t.name || `${t.address.slice(0, 6)}…${t.address.slice(-4)}`}
                          <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-50" />
                        </a>
                      ) : (
                        <span className="font-mono truncate">{t.name || "Trader"}</span>
                      )}
                      {(t as any).isSportsLb && (
                        <span className="text-[9px] font-bold bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 px-1 rounded shrink-0" title="Top sports leaderboard">🏆</span>
                      )}
                      {(t as any).isLeaderboard && !(t as any).isSportsLb && (
                        <span className="text-[9px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1 rounded shrink-0" title="General leaderboard">LB</span>
                      )}
                    </div>
                    <div className="text-right text-muted-foreground tabular-nums">
                      {(t.entryPrice * 100).toFixed(1)}¢
                    </div>
                    <div className="text-right font-medium tabular-nums">
                      {(t as any).netUsdc ? formatUsdc((t as any).netUsdc) : `${t.size.toLocaleString()} shr`}
                    </div>
                    <div className="text-right flex flex-col items-end gap-0.5">
                      <div className="flex items-center gap-1">
                        {t.roi !== 0 && (
                          <span className={`text-[9px] ${t.roi >= 20 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                            {t.roi >= 0 ? "+" : ""}{t.roi.toFixed(0)}% ROI
                          </span>
                        )}
                        {(t as any).qualityScore ? <QualityPip score={(t as any).qualityScore} /> : null}
                      </div>
                      {(t as any).tradeTime > 0 && (
                        <span className="text-[9px] text-muted-foreground">{timeAgoShort((t as any).tradeTime)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Countdown timer component ─────────────────────────────────────────────────
function RefreshCountdown({ secondsLeft }: { secondsLeft: number }) {
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
      <Clock className="w-3 h-3" />
      {m > 0 ? `${m}m ${s}s` : `${s}s`}
    </span>
  );
}

// ─── Sharp Moves feed ──────────────────────────────────────────────────────────
function fmtMinsAgo(mins: number): string {
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ago`;
}

function toAmericanOdds(p: number): string {
  if (p <= 0 || p >= 1) return "—";
  if (p >= 0.5) return `${Math.round(-p / (1 - p) * 100)}`;
  return `+${Math.round((1 - p) / p * 100)}`;
}

function SharpMovesPanel({ signals }: { signals?: any[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, isLoading, refetch } = useQuery<{ alerts: any[]; fetchedAt: number }>({
    queryKey: ["/api/alerts/live"],
    queryFn: () => fetch("/api/alerts/live").then(r => r.json()),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const alerts = data?.alerts || [];
  const multiAlerts = alerts.filter((a: any) => a.sharpAction?.traderCount >= 2);
  const bigAlerts   = alerts.filter((a: any) => !multiAlerts.includes(a));

  function renderAlert(a: any, isMulti: boolean) {
    const alertOutcomeLabel = a.outcomeLabel || getOutcomeLabel(a.market, a.side);
    const alertTimeStr = a.timestamp ? timeAgoShort(a.timestamp) : fmtMinsAgo(a.minutesAgo);
    const isExp = expandedId === a.id;
    const sharp = a.sharpAction;
    // Cross-reference with signals to find matching signal for trader list
    const matchSignal = signals?.find(s =>
      s.marketId === a.conditionId && s.side === (sharp?.side ?? a.side)
    );

    return (
      <div key={a.id} data-testid={isMulti ? `sharp-move-multi-${a.id}` : `sharp-move-${a.id}`}>
        {/* Collapsed row — clickable */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setExpandedId(isExp ? null : a.id)}
          onKeyDown={e => e.key === "Enter" && setExpandedId(isExp ? null : a.id)}
          className={`flex items-center gap-2 text-[11px] rounded-md px-2.5 py-1.5 cursor-pointer transition-colors ${
            isMulti
              ? "bg-orange-500/8 border border-orange-500/20 hover:bg-orange-500/15"
              : "bg-muted/40 hover:bg-muted/70"
          }`}
        >
          {isMulti && (
            <span className="shrink-0 font-bold px-1 py-0.5 rounded text-[9px] bg-orange-500/20 text-orange-600 dark:text-orange-400">
              MULTI
            </span>
          )}
          {!isMulti && a.isTracked && (
            <span className="shrink-0 font-semibold text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 max-w-[60px] truncate" title={a.trader}>
              {a.trader}
            </span>
          )}
          {sharp?.isActionable && (
            <span
              className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 cursor-help"
              title="ACTIONABLE — current price is within 2¢ of sharp avg entry. You can get in at essentially the same price as these traders."
            >
              ACT
            </span>
          )}
          <div className="flex-1 min-w-0">
            <div className={`font-bold text-[11px] ${a.side === "YES" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
              {alertOutcomeLabel}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">{a.market}</div>
          </div>
          <div className="text-right shrink-0 flex items-center gap-1.5">
            {matchSignal && (
              <span className={`text-[9px] font-bold px-1 py-0.5 rounded shrink-0 ${
                matchSignal.confidence >= 70 ? "bg-green-500/15 text-green-700 dark:text-green-300"
                : matchSignal.confidence >= 50 ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300"
                : "bg-muted text-muted-foreground"
              }`} title={`Signal confidence: ${matchSignal.confidence}/95`}>
                {matchSignal.confidence}
              </span>
            )}
            <div>
              <div className="font-bold tabular-nums">${a.size >= 1000 ? `${(a.size/1000).toFixed(1)}K` : a.size}</div>
              <div className="text-muted-foreground text-[10px]">{alertTimeStr}</div>
            </div>
            {isExp ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
          </div>
        </div>

        {/* Expanded detail */}
        {isExp && (
          <div className="mx-1 mb-1 p-2.5 rounded-b-md bg-muted/60 border-x border-b border-border space-y-2 text-[11px]">
            {/* Bet details */}
            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <span className="text-muted-foreground">Entry: </span>
                <span className="font-bold">{Math.round(a.price * 100)}¢</span>
                <span className="text-muted-foreground ml-1">({a.americanOdds || toAmericanOdds(a.price)})</span>
              </div>
              <div>
                <span className="text-muted-foreground">Size: </span>
                <span className="font-bold">${a.size >= 1000 ? `${(a.size/1000).toFixed(1)}K` : a.size}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Time: </span>
                <span className="font-medium">{alertTimeStr}</span>
              </div>
              {a.isTracked && a.trader && (
                <div>
                  <span className="text-muted-foreground">Trader: </span>
                  <span className="font-semibold text-primary">{a.trader}</span>
                </div>
              )}
            </div>

            {/* Sharp consensus context */}
            {sharp && (
              <div className={`p-1.5 rounded border text-[10px] ${
                sharp.priceStatus === "dip"
                  ? "bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-300"
                  : sharp.isActionable
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                  : "bg-primary/5 border-primary/15 text-primary"
              }`}>
                <div className="font-semibold">
                  {sharp.traderCount} tracked traders → {sharp.side} · Confidence: {sharp.confidence}/100
                </div>
                <div className="mt-0.5">
                  Avg entry: {Math.round(sharp.avgEntry * 100)}¢ ({toAmericanOdds(sharp.avgEntry)})
                  {" · "}Live: {Math.round(sharp.currentPrice * 100)}¢
                  {sharp.priceStatus === "dip" ? " · PRICE DIP ↓ — better than what sharps paid" :
                   sharp.isActionable ? " · ACTIONABLE — at sharp entry" :
                   " · Moved past entry"}
                </div>
              </div>
            )}

            {/* Trader list from matching signal */}
            {matchSignal && matchSignal.traders?.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Traders (sorted by size)</div>
                {matchSignal.traders.slice(0, 5).map((t: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-0.5 border-t border-border/30 text-[10px]">
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground w-4 text-right">#{i + 1}</span>
                      {t.isSportsLb && <span className="text-[9px]">🏆</span>}
                      <a
                        href={`https://polymarket.com/profile/${t.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline font-mono"
                        onClick={e => e.stopPropagation()}
                      >{t.name}</a>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>{Math.round(t.entryPrice * 100)}¢ entry</span>
                      <span className="font-medium text-foreground">${(t.netUsdc / 1000).toFixed(1)}K</span>
                      {t.tradeTime > 0 && <span>{timeAgoShort(t.tradeTime)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Polymarket link */}
            {a.slug && (
              <a
                href={`https://polymarket.com/market/${a.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:underline font-medium"
                onClick={e => e.stopPropagation()}
              >
                Trade on Polymarket <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className="border-orange-500/20 bg-gradient-to-r from-orange-500/5 to-transparent">
      <CardContent className="p-3">
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setCollapsed(!collapsed)}
          data-testid="button-toggle-sharp-moves"
        >
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-bold">Sharp Moves</span>
            <Badge variant="secondary" className="text-[10px] h-4 px-1">Live</Badge>
            {!isLoading && alerts.length > 0 && (
              <span className="text-[10px] text-muted-foreground">{alerts.length} trades</span>
            )}
            {multiAlerts.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/20">
                {multiAlerts.length} MULTI SHARP
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">· tap to expand</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">30s</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={e => { e.stopPropagation(); refetch(); }}
              data-testid="button-refresh-sharp-moves"
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
            {collapsed ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </div>
        </div>

        {!collapsed && (
          <div className="mt-2.5 space-y-1" data-testid="sharp-moves-list">
            {isLoading ? (
              <div className="space-y-1.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : alerts.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2 text-center">
                No sharp moves detected in recent trades
              </div>
            ) : (
              <>
                {multiAlerts.slice(0, 5).map((a: any) => renderAlert(a, true))}
                {bigAlerts.slice(0, 8 - Math.min(multiAlerts.length, 5)).map((a: any) => renderAlert(a, false))}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function Signals() {
  const [search, setSearch]       = useState("");
  const [filter, setFilter]       = useState("all");
  const [sort, setSort]           = useState("confidence");
  const [mode, setMode]           = useState<"elite" | "fast">("elite");
  const [sportsOnly, setSportsOnly] = useState(true);
  const [betType, setBetType]     = useState<"all" | "moneyline" | "spread" | "total" | "futures">("all");
  const [notifEnabled, setNotifEnabled] = useState(Notification?.permission === "granted");
  const [countdown, setCountdown] = useState(mode === "elite" ? ELITE_REFRESH_SEC : FAST_REFRESH_SEC);
  const [alertHistory, setAlertHistory] = useState<Array<{ id: string; question: string; confidence: number; ts: number }>>([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [snoozedIds, setSnoozedIds] = useState<Set<string>>(() => {
    const s = getSnoozed();
    const now = Date.now();
    return new Set(Object.entries(s).filter(([, v]) => v > now).map(([k]) => k));
  });

  const handleSnoozed = useCallback((id: string) => {
    setSnoozedIds(prev => new Set([...prev, id]));
  }, []);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const countdownRef = useRef<ReturnType<typeof setInterval>>();

  const refreshInterval = mode === "elite" ? ELITE_REFRESH_SEC : FAST_REFRESH_SEC;
  const eliteUrl  = sportsOnly ? "/api/signals?sports=true" : "/api/signals?sports=false";
  const queryKey  = mode === "elite" ? [eliteUrl] : ["/api/signals/fast"];

  // ── Query ────────────────────────────────────────────────────────────────────
  const { data, isLoading, error } = useQuery<SignalsResponse>({
    queryKey,
    staleTime: (refreshInterval - 5) * 1000,
  });

  // ── Process new signals for alerts ───────────────────────────────────────────
  const processAlerts = useCallback((signals: Signal[]) => {
    const seen = getSeenAlerts();
    const newAlerts: typeof alertHistory = [];

    for (const sig of signals) {
      if (sig.confidence >= 70 && !seen.has(sig.id)) {
        saveSeenAlert(sig.id);
        newAlerts.push({ id: sig.id, question: sig.marketQuestion, confidence: sig.confidence, ts: Date.now() });
        if (notifEnabled) {
          sendNotification(
            `PredictionInsider — ${sig.side} Signal (${sig.confidence}/100)`,
            sig.marketQuestion
          );
        }
      }
    }

    if (newAlerts.length > 0) {
      setAlertHistory(prev => [...newAlerts, ...prev].slice(0, 20));
      toast({
        title: `${newAlerts.length} new high-confidence signal${newAlerts.length > 1 ? "s" : ""}`,
        description: newAlerts[0].question,
      });
    }
  }, [notifEnabled, toast]);

  useEffect(() => {
    if (data?.signals) processAlerts(data.signals);
  }, [data, processAlerts]);

  // ── Auto-refresh countdown ────────────────────────────────────────────────────
  const resetCountdown = useCallback(() => {
    setCountdown(refreshInterval);
    clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          queryClient.invalidateQueries({ queryKey });
          return refreshInterval;
        }
        return prev - 1;
      });
    }, 1000);
  }, [refreshInterval, queryClient, queryKey]);

  useEffect(() => {
    resetCountdown();
    return () => clearInterval(countdownRef.current);
  }, [mode, resetCountdown]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey });
    resetCountdown();
  };

  const handleEnableNotifications = async () => {
    const ok = await requestNotificationPermission();
    setNotifEnabled(ok);
    toast({
      title: ok ? "Notifications enabled" : "Notifications blocked",
      description: ok
        ? "You'll be alerted for signals with confidence ≥ 70."
        : "Please allow notifications in your browser settings.",
    });
  };

  const signals = data?.signals || [];
  const filtered = signals
    .filter(s => {
      if (snoozedIds.has(s.id)) return false;
      if (search && !s.marketQuestion.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === "best_bets") return s.confidence >= 70 && s.isActionable && s.valueDelta > 0;
      if (filter === "value")   return s.isValue;
      if (filter === "high")    return s.confidence >= 70;
      if (filter === "multi")   return s.traderCount >= 2;
      if (filter === "single")  return (s as any).tier === "SINGLE";
      if (filter === "live")    return (s as any).marketType === "live";
      if (filter === "pregame") return (s as any).marketType === "pregame";
      if (filter === "futures") return (s as any).marketType === "futures";
      if (filter === "yes")     return s.side === "YES";
      if (filter === "no")      return s.side === "NO";
      // Bet-type filter
      if (betType !== "all") {
        const cat = ((s as any).marketCategory || "other").toLowerCase();
        if (betType === "futures") return cat === "futures";
        return cat === betType;
      }
      return true;
    })
    .sort((a, b) => {
      if (sort === "confidence")  return b.confidence - a.confidence;
      if (sort === "consensus")   return b.consensusPct - a.consensusPct;
      if (sort === "value")       return b.valueDelta - a.valueDelta;
      if (sort === "traders")     return b.traderCount - a.traderCount;
      if (sort === "size") {
        const aSize = (a as any).totalNetUsdc || 0;
        const bSize = (b as any).totalNetUsdc || 0;
        return bSize - aSize;
      }
      return 0;
    });

  const newCount     = signals.filter(s => (s as any).isNew).length;
  const highCount    = signals.filter(s => s.confidence >= 70).length;
  const valueCount   = signals.filter(s => s.isValue).length;
  const bestBetsCount = signals.filter(s => s.confidence >= 70 && s.isActionable && s.valueDelta > 0).length;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold tracking-tight">Live Signals</h1>
            {!isLoading && <Badge variant="secondary" className="ml-1">{filtered.length}</Badge>}
            {newCount > 0 && (
              <Badge className="bg-orange-500 text-white text-[10px] px-1.5 h-4">
                {newCount} new
              </Badge>
            )}
            {bestBetsCount > 0 && (
              <button
                onClick={() => setFilter("best_bets")}
                className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 h-4 rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
                data-testid="badge-best-bets-count"
              >
                <Star className="w-2.5 h-2.5" />
                {bestBetsCount} Best Bet{bestBetsCount !== 1 ? "s" : ""}
              </button>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {mode === "elite"
              ? "Aggregate open positions from official top-50 leaderboard — direct from on-chain subgraph"
              : "Real-time consensus from recent Polymarket sports trades — refreshes every 90s"}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Notifications */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleEnableNotifications}
            data-testid="button-notifications"
            className="gap-1.5"
            title={notifEnabled ? "Notifications active" : "Enable notifications"}
          >
            {notifEnabled ? <Bell className="w-3.5 h-3.5 text-green-500" /> : <BellOff className="w-3.5 h-3.5" />}
            <span className="text-xs">{notifEnabled ? "Alerts on" : "Alerts off"}</span>
          </Button>

          {/* Alert history */}
          {alertHistory.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAlerts(!showAlerts)}
              data-testid="button-alert-history"
              className="gap-1.5 relative"
            >
              <Bell className="w-3.5 h-3.5" />
              <span className="text-xs">History ({alertHistory.length})</span>
            </Button>
          )}

          <RefreshCountdown secondsLeft={countdown} />

          <Button
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            data-testid="button-refresh-signals"
            className="gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Alert history panel */}
      {showAlerts && alertHistory.length > 0 && (
        <Card className="border-orange-500/20 bg-orange-500/5">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Bell className="w-3.5 h-3.5 text-orange-500" />
              <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">Recent Alerts</span>
            </div>
            <div className="space-y-1.5">
              {alertHistory.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-xs bg-background/50 rounded px-2.5 py-1.5">
                  <span className="truncate flex-1 mr-2">{a.question}</span>
                  <span className="shrink-0 font-bold text-green-600 dark:text-green-400">{a.confidence}/100</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sharp Moves real-time feed */}
      <SharpMovesPanel signals={signals} />

      {/* Mode toggle + category filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 p-1 bg-muted rounded-lg">
          <button
            onClick={() => setMode("elite")}
            data-testid="button-mode-elite"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              mode === "elite" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Star className="w-3.5 h-3.5" />
            Elite Signals
          </button>
          <button
            onClick={() => setMode("fast")}
            data-testid="button-mode-fast"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              mode === "fast" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Live Feed
          </button>
        </div>

        {/* Sports-only toggle (Elite mode only) */}
        {mode === "elite" && (
          <div className="flex items-center gap-1.5 p-1 bg-muted rounded-lg">
            <button
              onClick={() => setSportsOnly(true)}
              data-testid="button-sports-only"
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                sportsOnly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sports Only
            </button>
            <button
              onClick={() => setSportsOnly(false)}
              data-testid="button-all-categories"
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                !sportsOnly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Categories
            </button>
          </div>
        )}
      </div>

      {/* Bet-type filter tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {(["all", "moneyline", "spread", "total", "futures"] as const).map(bt => {
          const label: Record<typeof bt, string> = {
            all: "All Types", moneyline: "Moneyline", spread: "Spread",
            total: "Over/Under", futures: "Futures",
          };
          const count = bt === "all" ? signals.length : signals.filter(s => {
            const cat = ((s as any).marketCategory || "other").toLowerCase();
            return cat === bt;
          }).length;
          return (
            <button
              key={bt}
              onClick={() => setBetType(bt)}
              data-testid={`button-bet-type-${bt}`}
              className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                betType === bt
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
              }`}
            >
              {label[bt]}
              {count > 0 && (
                <span className={`ml-0.5 px-1 rounded text-[10px] font-bold ${
                  betType === bt ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background text-muted-foreground"
                }`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search markets..."
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-signals"
          />
        </div>
        {/* Best Bets quick filter button */}
        <button
          onClick={() => setFilter(filter === "best_bets" ? "all" : "best_bets")}
          data-testid="button-filter-best-bets"
          className={`flex items-center gap-1.5 px-3 py-1.5 h-8 rounded-md text-xs font-bold transition-all border ${
            filter === "best_bets"
              ? "bg-green-600 text-white border-green-600"
              : "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30 hover:bg-green-500/20"
          }`}
          title="High confidence (70+), actionable, and positive value edge"
        >
          <Star className="w-3 h-3" />
          Best Bets
        </button>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-40 h-8 text-sm" data-testid="select-filter">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Signals</SelectItem>
            <SelectItem value="best_bets">⭐ Best Bets (70+ & Edge)</SelectItem>
            <SelectItem value="value">Value Edge Only</SelectItem>
            <SelectItem value="high">High Confidence (70+)</SelectItem>
            <SelectItem value="multi">Multi-Trader (2+)</SelectItem>
            <SelectItem value="single">Whale Signals</SelectItem>
            <SelectItem value="live">Live Markets</SelectItem>
            <SelectItem value="pregame">Pregame</SelectItem>
            <SelectItem value="futures">Futures</SelectItem>
            <SelectItem value="yes">YES Positions</SelectItem>
            <SelectItem value="no">NO Positions</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-sort">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="confidence">Confidence</SelectItem>
            <SelectItem value="consensus">Consensus %</SelectItem>
            <SelectItem value="value">Value Edge</SelectItem>
            <SelectItem value="traders">Trader Count</SelectItem>
            <SelectItem value="size">Net Position $</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary bar */}
      {!isLoading && signals.length > 0 && (
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <span className="text-muted-foreground">{data?.topTraderCount} elite traders</span>
          <span className="text-muted-foreground">{data?.marketsScanned} sports markets scanned</span>
          {valueCount > 0 && (
            <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
              <DollarSign className="w-3 h-3" /> {valueCount} value edges
            </span>
          )}
          {highCount > 0 && (
            <span className="text-primary font-medium">{highCount} high-confidence</span>
          )}
          {data?.source && (
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted border border-border">
              {data.source.includes("elite") ? "On-chain subgraph" : "Live trades"} · {mode === "elite" ? "5m refresh" : "90s refresh"}
            </span>
          )}
        </div>
      )}

      {/* Signal cards */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-5 w-3/4 mb-3" />
                <Skeleton className="h-3 w-full mb-1.5" />
                <Skeleton className="h-3 w-4/5 mb-4" />
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: 4 }).map((_, j) => <Skeleton key={j} className="h-12" />)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <AlertCircle className="w-10 h-10 text-muted-foreground" />
            <div>
              <div className="font-medium">Failed to load signals</div>
              <div className="text-sm text-muted-foreground mt-1 max-w-sm">
                Polymarket APIs may be temporarily unavailable or rate-limited.
              </div>
            </div>
            <Button onClick={handleRefresh} variant="outline" className="gap-2">
              <RefreshCw className="w-4 h-4" /> Try Again
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Target className="w-10 h-10 text-muted-foreground" />
            <div>
              <div className="font-medium">
                {signals.length === 0 ? "No signals generated" : "No signals match your filters"}
              </div>
              <div className="text-sm text-muted-foreground mt-1 max-w-sm">
                {signals.length === 0
                  ? mode === "elite" && sportsOnly
                    ? "Top PNL traders mostly hold positions in politics/crypto markets. Try 'All Categories' to see their full signal set, or use Live Feed for real-time sports signals."
                    : mode === "elite"
                    ? "No open on-chain positions found for the elite trader pool. Try Live Feed for real-time signals."
                    : "Live feed signals appear when active traders share a sports market position in the last 2,000 trades."
                  : "Try adjusting your filters."}
              </div>
            </div>
            {signals.length === 0 && mode === "elite" && sportsOnly && (
              <div className="flex gap-2 flex-wrap justify-center">
                <Button variant="outline" size="sm" onClick={() => setSportsOnly(false)} className="gap-2">
                  <Target className="w-3.5 h-3.5" /> All Categories
                </Button>
                <Button variant="outline" size="sm" onClick={() => setMode("fast")} className="gap-2">
                  <Activity className="w-3.5 h-3.5" /> Live Feed
                </Button>
              </div>
            )}
            {signals.length === 0 && mode === "elite" && !sportsOnly && (
              <Button variant="outline" size="sm" onClick={() => setMode("fast")} className="gap-2">
                <Activity className="w-3.5 h-3.5" /> Switch to Live Feed
              </Button>
            )}
            {search && (
              <Button variant="outline" size="sm" onClick={() => setSearch("")}>Clear search</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {snoozedIds.size > 0 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <span>{snoozedIds.size} signal{snoozedIds.size !== 1 ? "s" : ""} snoozed</span>
              <button
                onClick={() => { localStorage.removeItem(SNOOZE_KEY); setSnoozedIds(new Set()); }}
                className="flex items-center gap-1 hover:text-foreground transition-colors"
                data-testid="button-clear-snooze"
              >
                <X className="w-3 h-3" /> Clear all
              </button>
            </div>
          )}
          {filtered.map(signal => (
            <SignalCard key={signal.id} signal={signal} mode={mode} onSnoozed={handleSnoozed} />
          ))}
        </div>
      )}
    </div>
  );
}
