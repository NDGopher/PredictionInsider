import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen, Plus, CheckCircle, XCircle, Clock, TrendingUp, TrendingDown,
  DollarSign, Trash2, ExternalLink, Target, ChevronDown, ChevronUp, RefreshCw
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─── Types ───────────────────────────────────────────────────────────────────

type BetStatus = "open" | "won" | "lost" | "cancelled";

export interface TrackedBet {
  id: string;
  marketQuestion: string;
  outcomeLabel: string;
  side: "YES" | "NO";
  conditionId?: string;
  slug?: string;
  entryPrice: number;
  betAmount: number;
  betDate: number;
  status: BetStatus;
  resolvedPrice?: number;
  resolvedDate?: number;
  pnl?: number;
  notes?: string;
  book?: "PPH" | "Kalshi" | "Polymarket";
  americanOdds?: number;
  polymarketPrice?: number;
  sport?: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiBets(): Promise<TrackedBet[]> {
  const r = await fetch("/api/bets");
  if (!r.ok) throw new Error("Failed to load bets");
  return r.json();
}

async function apiAddBet(bet: TrackedBet): Promise<void> {
  await fetch("/api/bets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bet),
  });
}

async function apiPatchBet(id: string, patch: Partial<TrackedBet>): Promise<void> {
  await fetch(`/api/bets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

async function apiDeleteBet(id: string): Promise<void> {
  await fetch(`/api/bets/${id}`, { method: "DELETE" });
}

// ─── localStorage write-through (so Signals/Dashboard can read fast) ──────────

export const BET_KEY = "pi_bets";
export function syncBetsToStorage(bets: TrackedBet[]) {
  try { localStorage.setItem(BET_KEY, JSON.stringify(bets)); } catch {}
}
export function loadBetsFromStorage(): TrackedBet[] {
  try { return JSON.parse(localStorage.getItem(BET_KEY) || "[]"); } catch { return []; }
}

// ─── Snooze helpers (still localStorage – these are ephemeral) ───────────────

const SNOOZE_KEY = "pi_snoozed";
export function getSnoozed(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || "{}"); } catch { return {}; }
}
export function snoozeSignal(signalId: string, until: number) {
  const s = getSnoozed(); s[signalId] = until;
  localStorage.setItem(SNOOZE_KEY, JSON.stringify(s));
}
export function unsnoozeSignal(signalId: string) {
  const s = getSnoozed(); delete s[signalId];
  localStorage.setItem(SNOOZE_KEY, JSON.stringify(s));
}
export function isSignalSnoozed(signalId: string): boolean {
  const s = getSnoozed();
  const until = s[signalId];
  if (!until) return false;
  if (Date.now() > until) { unsnoozeSignal(signalId); return false; }
  return true;
}

// ─── Auto-grading helpers ─────────────────────────────────────────────────────

const AUTO_GRADE_INTERVAL_MS = 5 * 60 * 1000;
const MIN_AGE_BEFORE_GRADE_MS = 60 * 60 * 1000;
const REVERIFY_WINDOW_MS = 72 * 60 * 60 * 1000; // Re-verify grades within last 72h

function calcPnlFromGrade(bet: TrackedBet, won: boolean): number {
  if (!won) return -bet.betAmount;
  if (bet.americanOdds !== undefined) {
    return bet.americanOdds > 0
      ? bet.betAmount * (bet.americanOdds / 100)
      : bet.betAmount * (100 / Math.abs(bet.americanOdds));
  }
  // entryPrice is always the purchased token's price (YES price for YES bets, NO price for NO bets).
  // Win formula is identical for both sides: risk * (1 - tokenPrice) / tokenPrice
  return bet.betAmount * (1 - bet.entryPrice) / bet.entryPrice;
}

async function resolveViaSlug(
  bet: TrackedBet
): Promise<{ outcome: "YES" | "NO"; finalPrice: number | null } | { marketOpen: true } | null> {
  if (!bet.conditionId && !bet.slug) return null;
  const slugParam = bet.slug ? `?slug=${encodeURIComponent(bet.slug)}` : "";
  const res = await fetch(`/api/market/resolve/${encodeURIComponent(bet.conditionId || "unknown")}${slugParam}`);
  if (!res.ok) return null;
  const data: { resolved: boolean; outcome: "YES" | "NO" | null; finalPrice: number | null; marketOpen?: boolean } = await res.json();
  if (data.marketOpen) return { marketOpen: true };
  if (!data.resolved || !data.outcome) return null;
  return { outcome: data.outcome, finalPrice: data.finalPrice };
}

function useAutoGrade(bets: TrackedBet[], patchBet: (id: string, patch: Partial<TrackedBet>) => void) {
  useEffect(() => {
    async function checkResolutions() {
      const now = Date.now();

      // 1. Grade open bets that are old enough
      const openBets = bets.filter(b =>
        b.status === "open" &&
        (b.conditionId || b.slug) &&
        (now - (b.betDate || 0)) > MIN_AGE_BEFORE_GRADE_MS
      );

      for (const bet of openBets) {
        try {
          const result = await resolveViaSlug(bet);
          if (!result || "marketOpen" in result) continue;
          const won = result.outcome === bet.side;
          patchBet(bet.id, {
            status: won ? "won" : "lost",
            resolvedPrice: result.finalPrice ?? undefined,
            resolvedDate: now,
            pnl: Math.round(calcPnlFromGrade(bet, won) * 100) / 100,
          });
        } catch {}
      }

      // 2. Re-verify recently auto-graded bets (catches wrong grades from the old broken system)
      const recentlyResolved = bets.filter(b =>
        b.status !== "open" &&
        (b.conditionId || b.slug) &&
        b.resolvedDate &&
        (now - b.resolvedDate) < REVERIFY_WINDOW_MS
      );

      for (const bet of recentlyResolved) {
        try {
          const result = await resolveViaSlug(bet);
          if (!result) continue;

          // Market is confirmed genuinely open — the existing grade must be wrong (old broken system)
          if ("marketOpen" in result) {
            patchBet(bet.id, {
              status: "open",
              resolvedPrice: undefined,
              resolvedDate: undefined,
              pnl: undefined,
            });
            continue;
          }

          const correctWon = result.outcome === bet.side;
          const correctStatus = correctWon ? "won" : "lost";
          if (correctStatus !== bet.status) {
            patchBet(bet.id, {
              status: correctStatus,
              resolvedPrice: result.finalPrice ?? undefined,
              resolvedDate: bet.resolvedDate,
              pnl: Math.round(calcPnlFromGrade(bet, correctWon) * 100) / 100,
            });
          }
        } catch {}
      }
    }

    checkResolutions();
    const iv = setInterval(checkResolutions, AUTO_GRADE_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [bets.length]);
}

async function verifyAllBetGrades(
  bets: TrackedBet[],
  patchBet: (id: string, patch: Partial<TrackedBet>) => void
): Promise<{ fixed: number; checked: number }> {
  const gradeable = bets.filter(b => b.conditionId || b.slug);
  let fixed = 0;
  for (const bet of gradeable) {
    try {
      const result = await resolveViaSlug(bet);
      if (!result) continue;

      // Market confirmed genuinely open → re-open any wrong grade from old system
      if ("marketOpen" in result) {
        if (bet.status !== "open") {
          patchBet(bet.id, { status: "open", resolvedPrice: undefined, resolvedDate: undefined, pnl: undefined });
          fixed++;
        }
        continue;
      }

      const correctWon = result.outcome === bet.side;
      const correctStatus = correctWon ? "won" : "lost";
      if (bet.status === "open") {
        patchBet(bet.id, {
          status: correctStatus,
          resolvedPrice: result.finalPrice ?? undefined,
          resolvedDate: Date.now(),
          pnl: Math.round(calcPnlFromGrade(bet, correctWon) * 100) / 100,
        });
        fixed++;
      } else if (correctStatus !== bet.status) {
        patchBet(bet.id, {
          status: correctStatus,
          resolvedPrice: result.finalPrice ?? undefined,
          resolvedDate: bet.resolvedDate ?? Date.now(),
          pnl: Math.round(calcPnlFromGrade(bet, correctWon) * 100) / 100,
        });
        fixed++;
      }
    } catch {}
  }
  return { fixed, checked: gradeable.length };
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtUsdc(v: number): string {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}
function toAmericanOdds(p: number): string {
  if (p <= 0 || p >= 1) return "—";
  if (p >= 0.5) return `-${Math.round(p / (1 - p) * 100)}`;
  return `+${Math.round((1 - p) / p * 100)}`;
}

// ─── Add Bet Modal ────────────────────────────────────────────────────────────

function AddBetForm({ onAdd, onCancel, prefill }: {
  onAdd: (bet: Omit<TrackedBet, "id" | "betDate" | "status">) => void;
  onCancel: () => void;
  prefill?: Partial<TrackedBet>;
}) {
  const [marketQuestion, setMarketQuestion] = useState(prefill?.marketQuestion || "");
  const [outcomeLabel, setOutcomeLabel] = useState(prefill?.outcomeLabel || "");
  const [side, setSide] = useState<"YES" | "NO">(prefill?.side || "YES");
  const [entryPrice, setEntryPrice] = useState(prefill?.entryPrice ? String(Math.round(prefill.entryPrice * 100)) : "");
  const [betAmount, setBetAmount] = useState(prefill?.betAmount ? String(prefill.betAmount) : "");
  const [notes, setNotes] = useState(prefill?.notes || "");

  const priceNum = parseFloat(entryPrice) / 100;
  const amtNum = parseFloat(betAmount);
  // entryPrice is the purchased token's price — same formula for YES and NO
  const potentialPnl = !isNaN(priceNum) && !isNaN(amtNum) && priceNum > 0 && priceNum < 1
    ? amtNum * (1 - priceNum) / priceNum
    : 0;

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm">Log Bet</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        <Input placeholder="Market question" value={marketQuestion} onChange={e => setMarketQuestion(e.target.value)} className="h-8 text-sm" data-testid="input-market-question" />
        <div className="flex gap-2">
          <Input placeholder="Pick / outcome label" value={outcomeLabel} onChange={e => setOutcomeLabel(e.target.value)} className="h-8 text-sm flex-1" data-testid="input-outcome-label" />
          <Select value={side} onValueChange={v => setSide(v as "YES" | "NO")}>
            <SelectTrigger className="h-8 text-sm w-20" data-testid="select-side"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="YES">YES</SelectItem>
              <SelectItem value="NO">NO</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Input placeholder="Entry (cents)" type="number" value={entryPrice} onChange={e => setEntryPrice(e.target.value)} className="h-8 text-sm flex-1" data-testid="input-entry-price" />
          <Input placeholder="Bet amount ($)" type="number" value={betAmount} onChange={e => setBetAmount(e.target.value)} className="h-8 text-sm flex-1" data-testid="input-bet-amount" />
        </div>
        {potentialPnl > 0 && (
          <div className="text-xs text-green-600 dark:text-green-400 font-medium">
            To win: +{fmtUsdc(potentialPnl)}
          </div>
        )}
        <Input placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} className="h-8 text-sm" data-testid="input-notes" />
        <div className="flex gap-2 pt-1">
          <Button size="sm" className="flex-1 h-8" onClick={() => {
            if (!marketQuestion || !outcomeLabel) return;
            onAdd({
              marketQuestion, outcomeLabel, side,
              entryPrice: priceNum || 0,
              betAmount: amtNum || 0,
              conditionId: prefill?.conditionId,
              slug: prefill?.slug,
              notes: notes || undefined,
            });
          }} data-testid="button-submit-add-bet">
            Track Bet
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={onCancel} data-testid="button-cancel-add-bet">Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Bet card ─────────────────────────────────────────────────────────────────

function BetCard({ bet, onResolve, onDelete, onUpdateNotes, onReopen }: {
  bet: TrackedBet;
  onResolve: (id: string, status: "won" | "lost" | "cancelled", price?: number) => void;
  onDelete: (id: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onReopen: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [resolveMode, setResolveMode] = useState(false);
  const [finalPrice, setFinalPrice] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(bet.notes || "");

  const priceNum = bet.entryPrice || 0;
  // entryPrice is always the purchased token's price — same formula for YES and NO
  const potentialPnl = bet.betAmount > 0 && priceNum > 0 && priceNum < 1
    ? bet.betAmount * (1 - priceNum) / priceNum
    : 0;

  const statusColor = {
    open: "bg-primary/10 text-primary border-primary/20",
    won: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/20",
    lost: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20",
    cancelled: "bg-muted text-muted-foreground border-border",
  }[bet.status];

  return (
    <Card data-testid={`card-bet-${bet.id}`}>
      <CardContent className="p-3 space-y-2">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm leading-tight truncate" data-testid={`text-market-${bet.id}`}>
              {bet.marketQuestion}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${statusColor}`}>
                {bet.status.toUpperCase()}
              </span>
              <span className="text-xs font-bold text-foreground" data-testid={`text-outcome-${bet.id}`}>{bet.outcomeLabel}</span>
            </div>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground transition-colors mt-0.5 shrink-0"
            data-testid={`button-expand-bet-${bet.id}`}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Key numbers row */}
        <div className="flex items-center gap-4 text-xs flex-wrap">
          {bet.book && (
            <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
              bet.book === "Kalshi" ? "bg-purple-500/15 text-purple-700 dark:text-purple-300" :
              bet.book === "PPH" ? "bg-blue-500/15 text-blue-700 dark:text-blue-300" :
              "bg-primary/10 text-primary"
            }`}>{bet.book}</span>
          )}
          <div>
            <span className="text-muted-foreground">Odds: </span>
            <span className="font-bold">
              {bet.americanOdds !== undefined
                ? (bet.americanOdds > 0 ? `+${bet.americanOdds}` : `${bet.americanOdds}`)
                : toAmericanOdds(bet.entryPrice)}
            </span>
            {bet.polymarketPrice && bet.americanOdds !== undefined && (
              <span className="text-muted-foreground ml-1">(PM: {Math.round(bet.polymarketPrice * 100)}¢)</span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Bet: </span>
            <span className="font-bold">{fmtUsdc(bet.betAmount)}</span>
          </div>
          {bet.status === "open" && potentialPnl > 0 && (
            <div>
              <span className="text-muted-foreground">To win: </span>
              <span className="font-bold text-green-600 dark:text-green-400">{fmtUsdc(potentialPnl)}</span>
            </div>
          )}
          {bet.pnl !== undefined && bet.status !== "open" && (
            <div>
              <span className="text-muted-foreground">PNL: </span>
              <span className={`font-bold ${bet.pnl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                {bet.pnl >= 0 ? "+" : ""}{fmtUsdc(bet.pnl)}
              </span>
            </div>
          )}
          <div className="ml-auto text-muted-foreground">{formatDate(bet.betDate)}</div>
        </div>

        {/* Expanded section */}
        {expanded && (
          <div className="pt-2 border-t border-border/50 space-y-2">
            <div>
              {editingNotes ? (
                <div className="flex gap-1">
                  <Input
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="h-7 text-xs flex-1"
                    placeholder="Add notes..."
                    data-testid={`input-notes-${bet.id}`}
                  />
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => {
                    onUpdateNotes(bet.id, notes);
                    setEditingNotes(false);
                  }}>Save</Button>
                </div>
              ) : (
                <button
                  onClick={() => setEditingNotes(true)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  data-testid={`button-edit-notes-${bet.id}`}
                >
                  {bet.notes ? `Notes: ${bet.notes}` : "Add notes..."}
                </button>
              )}
            </div>

            {bet.slug && (
              <a
                href={`https://polymarket.com/market/${bet.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                View market <ExternalLink className="w-3 h-3" />
              </a>
            )}

            {bet.status === "open" && (
              <div className="space-y-2">
                {!resolveMode ? (
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white" onClick={() => onResolve(bet.id, "won")} data-testid={`button-won-${bet.id}`}>
                      <CheckCircle className="w-3 h-3" /> Won
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-red-500/30 text-red-600 hover:bg-red-500/10" onClick={() => onResolve(bet.id, "lost")} data-testid={`button-lost-${bet.id}`}>
                      <XCircle className="w-3 h-3" /> Lost
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setResolveMode(true)} data-testid={`button-resolve-custom-${bet.id}`}>
                      Custom resolve
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-1.5 flex-wrap">
                    <Input placeholder="Final price (cents)" type="number" min="0" max="100" value={finalPrice} onChange={e => setFinalPrice(e.target.value)} className="h-7 text-xs w-36" data-testid={`input-final-price-${bet.id}`} />
                    <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => { onResolve(bet.id, "won", parseFloat(finalPrice) / 100); setResolveMode(false); }}>Won</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs border-red-500/30 text-red-600 hover:bg-red-500/10" onClick={() => { onResolve(bet.id, "lost", parseFloat(finalPrice) / 100); setResolveMode(false); }}>Lost</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setResolveMode(false)}>Cancel</Button>
                  </div>
                )}
              </div>
            )}

            {bet.status !== "open" && (
              <button onClick={() => onReopen(bet.id)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-blue-500 transition-colors" data-testid={`button-reopen-bet-${bet.id}`}>
                <RefreshCw className="w-3 h-3" /> Reopen
              </button>
            )}

            <button onClick={() => onDelete(bet.id)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-red-500 transition-colors" data-testid={`button-delete-bet-${bet.id}`}>
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Bets page ───────────────────────────────────────────────────────────

export default function Bets() {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);

  const { data: bets = [], isLoading } = useQuery<TrackedBet[]>({
    queryKey: ["/api/bets"],
    queryFn: apiBets,
    staleTime: 30_000,
  });

  // Keep localStorage in sync so Signals/Dashboard can read fast
  useEffect(() => {
    if (bets.length > 0) syncBetsToStorage(bets);
  }, [bets]);

  // Also migrate any existing localStorage bets to DB on first load
  useEffect(() => {
    const stored = loadBetsFromStorage();
    if (stored.length === 0) return;
    stored.forEach(bet => apiAddBet(bet).catch(() => {}));
    queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
    localStorage.removeItem(BET_KEY);
  }, []);

  const addMutation = useMutation({
    mutationFn: (bet: TrackedBet) => apiAddBet(bet),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bets"] }),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<TrackedBet> }) => apiPatchBet(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bets"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDeleteBet(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bets"] }),
  });

  function computePnl(bet: TrackedBet, status: "won" | "lost" | "cancelled", resolvedPrice?: number): number {
    if (status === "cancelled") return 0;
    if (status === "won") {
      if (bet.americanOdds !== undefined) {
        return bet.americanOdds > 0
          ? bet.betAmount * (bet.americanOdds / 100)
          : bet.betAmount * (100 / Math.abs(bet.americanOdds));
      }
      // entryPrice is always the purchased token's price — same formula for YES and NO
      return bet.betAmount * (1 - bet.entryPrice) / bet.entryPrice;
    }
    return -bet.betAmount;
  }

  function handleAddBet(betData: Omit<TrackedBet, "id" | "betDate" | "status">) {
    const newBet: TrackedBet = {
      ...betData,
      id: `bet-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      betDate: Date.now(),
      status: "open",
    };
    addMutation.mutate(newBet);
    setShowAddForm(false);
  }

  function handleResolve(id: string, status: "won" | "lost" | "cancelled", resolvedPrice?: number) {
    const bet = bets.find(b => b.id === id);
    if (!bet) return;
    const pnl = Math.round(computePnl(bet, status, resolvedPrice) * 100) / 100;
    patchMutation.mutate({ id, patch: { status, resolvedPrice, resolvedDate: Date.now(), pnl } });
  }

  function handleDelete(id: string) {
    deleteMutation.mutate(id);
  }

  function handleUpdateNotes(id: string, notes: string) {
    patchMutation.mutate({ id, patch: { notes } });
  }

  function handleReopen(id: string) {
    patchMutation.mutate({ id, patch: { status: "open", resolvedPrice: undefined, resolvedDate: undefined, pnl: undefined } });
  }

  function patchBet(id: string, patch: Partial<TrackedBet>) {
    patchMutation.mutate({ id, patch });
  }

  async function handleVerifyAll() {
    setVerifyLoading(true);
    setVerifyResult(null);
    try {
      const { fixed, checked } = await verifyAllBetGrades(bets, patchBet);
      await queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
      setVerifyResult(fixed > 0 ? `Fixed ${fixed} of ${checked} bets` : `All ${checked} bets confirmed correct`);
    } catch {
      setVerifyResult("Error during verification");
    } finally {
      setVerifyLoading(false);
      setTimeout(() => setVerifyResult(null), 6000);
    }
  }

  useAutoGrade(bets, patchBet);

  const openBets = bets.filter(b => b.status === "open");
  const resolvedBets = bets.filter(b => b.status !== "open");
  const totalPnl = resolvedBets.reduce((s, b) => s + (b.pnl ?? 0), 0);
  const wins = resolvedBets.filter(b => b.status === "won").length;
  const winRate = resolvedBets.length > 0 ? Math.round(wins / resolvedBets.length * 100) : null;
  const totalBetAmount = openBets.reduce((s, b) => s + b.betAmount, 0);

  const filtered = bets.filter(b => {
    if (filter === "open") return b.status === "open";
    if (filter === "resolved") return b.status !== "open";
    return true;
  });

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" /> My Bets
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track bets from signals. Synced to database — persists across devices.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleVerifyAll}
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            disabled={verifyLoading || bets.length === 0}
            data-testid="button-verify-grades"
          >
            <RefreshCw className={`w-3 h-3 ${verifyLoading ? "animate-spin" : ""}`} />
            {verifyLoading ? "Verifying…" : "Verify Grades"}
          </Button>
          <Button onClick={() => setShowAddForm(f => !f)} size="sm" className="gap-1.5" data-testid="button-add-bet-open">
            <Plus className="w-3.5 h-3.5" /> Log Bet
          </Button>
        </div>
      </div>
      {verifyResult && (
        <div className={`text-xs px-3 py-1.5 rounded-md border ${verifyResult.startsWith("Fixed") ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300" : verifyResult.startsWith("Error") ? "bg-red-50 dark:bg-red-950/30 border-red-200 text-red-700" : "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"}`}>
          {verifyResult}
        </div>
      )}

      {showAddForm && (
        <AddBetForm
          onAdd={handleAddBet}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-xs text-muted-foreground">Open</div>
            <div className="text-xl font-bold" data-testid="stat-open-bets">{openBets.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-xs text-muted-foreground">Win Rate</div>
            <div className="text-xl font-bold" data-testid="stat-win-rate">
              {winRate !== null ? `${winRate}%` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-xs text-muted-foreground">Total PNL</div>
            <div className={`text-xl font-bold ${totalPnl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`} data-testid="stat-total-pnl">
              {totalPnl >= 0 ? "+" : ""}{fmtUsdc(totalPnl)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-xs text-muted-foreground">At Risk</div>
            <div className="text-xl font-bold" data-testid="stat-at-risk">{fmtUsdc(totalBetAmount)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit">
        {([["all", "All"], ["open", "Open"], ["resolved", "Resolved"]] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            data-testid={`button-filter-bets-${v}`}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              filter === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
            {v === "open" && openBets.length > 0 && (
              <span className="ml-1 px-1 rounded text-[10px] bg-primary/15 text-primary font-bold">{openBets.length}</span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <div className="font-medium text-sm">No bets yet</div>
            <div className="text-xs text-muted-foreground mt-1">
              Log bets from the Signals or Dashboard pages, or click "Log Bet" above.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(bet => (
            <BetCard
              key={bet.id}
              bet={bet}
              onResolve={handleResolve}
              onDelete={handleDelete}
              onUpdateNotes={handleUpdateNotes}
              onReopen={handleReopen}
            />
          ))}
        </div>
      )}

      <Card className="border-dashed">
        <CardContent className="p-3 text-xs text-muted-foreground space-y-1">
          <div className="font-semibold text-foreground flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5" /> How to use
          </div>
          <div>1. Find a signal on the Signals or Dashboard page</div>
          <div>2. Click "Track Bet" on any signal card to pre-fill the form</div>
          <div>3. Enter your actual bet amount and click "Track Bet"</div>
          <div>4. When the market resolves, come back and click Won/Lost to log your PNL</div>
          <div className="text-primary/70 mt-1 font-medium">✓ Bets are saved to the database and will not disappear.</div>
        </CardContent>
      </Card>
    </div>
  );
}
