import { useState, useEffect, useCallback } from "react";
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

interface TrackedBet {
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
  snoozedUntil?: number;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

const BET_KEY = "pi_bets";

function loadBets(): TrackedBet[] {
  try { return JSON.parse(localStorage.getItem(BET_KEY) || "[]"); } catch { return []; }
}

function saveBets(bets: TrackedBet[]) {
  localStorage.setItem(BET_KEY, JSON.stringify(bets));
}

function useBets() {
  const [bets, setBets] = useState<TrackedBet[]>(() => loadBets());

  const addBet = useCallback((bet: Omit<TrackedBet, "id" | "betDate" | "status">) => {
    const newBet: TrackedBet = {
      ...bet,
      id: `bet-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      betDate: Date.now(),
      status: "open",
    };
    setBets(prev => {
      const updated = [newBet, ...prev];
      saveBets(updated);
      return updated;
    });
    return newBet;
  }, []);

  const resolveBet = useCallback((id: string, status: "won" | "lost" | "cancelled", resolvedPrice?: number) => {
    setBets(prev => {
      const updated = prev.map(b => {
        if (b.id !== id) return b;
        let pnl = 0;
        if (resolvedPrice !== undefined && status !== "cancelled") {
          if (b.side === "YES") {
            pnl = status === "won" ? b.betAmount * (1 - b.entryPrice) / b.entryPrice : -b.betAmount;
          } else {
            const noEntry = 1 - b.entryPrice;
            pnl = status === "won" ? b.betAmount * (1 - noEntry) / noEntry : -b.betAmount;
          }
        } else if (status === "won") {
          pnl = b.side === "YES"
            ? b.betAmount * (1 - b.entryPrice) / b.entryPrice
            : b.betAmount * b.entryPrice / (1 - b.entryPrice);
        } else if (status === "lost") {
          pnl = -b.betAmount;
        }
        return { ...b, status, resolvedPrice, resolvedDate: Date.now(), pnl: Math.round(pnl * 100) / 100 };
      });
      saveBets(updated);
      return updated;
    });
  }, []);

  const deleteBet = useCallback((id: string) => {
    setBets(prev => {
      const updated = prev.filter(b => b.id !== id);
      saveBets(updated);
      return updated;
    });
  }, []);

  const updateNotes = useCallback((id: string, notes: string) => {
    setBets(prev => {
      const updated = prev.map(b => b.id === id ? { ...b, notes } : b);
      saveBets(updated);
      return updated;
    });
  }, []);

  return { bets, addBet, resolveBet, deleteBet, updateNotes };
}

// ─── Snooze helpers ───────────────────────────────────────────────────────────

const SNOOZE_KEY = "pi_snoozed";

export function getSnoozed(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || "{}"); } catch { return {}; }
}

export function snoozeSignal(signalId: string, until: number) {
  const s = getSnoozed();
  s[signalId] = until;
  localStorage.setItem(SNOOZE_KEY, JSON.stringify(s));
}

export function unsnoozeSignal(signalId: string) {
  const s = getSnoozed();
  delete s[signalId];
  localStorage.setItem(SNOOZE_KEY, JSON.stringify(s));
}

export function isSignalSnoozed(signalId: string): boolean {
  const s = getSnoozed();
  const until = s[signalId];
  if (!until) return false;
  if (Date.now() > until) { unsnoozeSignal(signalId); return false; }
  return true;
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
  const potentialPnl = !isNaN(priceNum) && !isNaN(amtNum) && priceNum > 0 && priceNum < 1
    ? side === "YES"
      ? amtNum * (1 - priceNum) / priceNum
      : amtNum * priceNum / (1 - priceNum)
    : null;

  function handleSubmit() {
    if (!marketQuestion.trim() || !entryPrice || !betAmount) return;
    onAdd({
      marketQuestion: marketQuestion.trim(),
      outcomeLabel: outcomeLabel.trim() || marketQuestion.trim(),
      side,
      conditionId: prefill?.conditionId,
      slug: prefill?.slug,
      entryPrice: priceNum,
      betAmount: amtNum,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <div className="p-4 space-y-3 bg-muted/30 rounded-lg border border-border">
      <div className="font-semibold text-sm">Log a Bet</div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Market / Bet</label>
        <Input
          placeholder="e.g. Celtics vs. Spurs"
          value={marketQuestion}
          onChange={e => setMarketQuestion(e.target.value)}
          className="h-8 text-sm"
          data-testid="input-bet-market"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Outcome</label>
          <Input
            placeholder="e.g. Spurs WIN"
            value={outcomeLabel}
            onChange={e => setOutcomeLabel(e.target.value)}
            className="h-8 text-sm"
            data-testid="input-bet-outcome"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Side</label>
          <Select value={side} onValueChange={v => setSide(v as "YES" | "NO")}>
            <SelectTrigger className="h-8 text-sm" data-testid="select-bet-side">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="YES">YES</SelectItem>
              <SelectItem value="NO">NO</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Entry Price (cents)</label>
          <Input
            placeholder="e.g. 45"
            type="number"
            min="1"
            max="99"
            value={entryPrice}
            onChange={e => setEntryPrice(e.target.value)}
            className="h-8 text-sm"
            data-testid="input-bet-entry"
          />
          {priceNum > 0 && priceNum < 1 && (
            <div className="text-[10px] text-muted-foreground mt-0.5">{toAmericanOdds(priceNum)}</div>
          )}
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Bet Amount (USDC)</label>
          <Input
            placeholder="e.g. 100"
            type="number"
            min="1"
            value={betAmount}
            onChange={e => setBetAmount(e.target.value)}
            className="h-8 text-sm"
            data-testid="input-bet-amount"
          />
          {potentialPnl !== null && (
            <div className="text-[10px] text-green-600 dark:text-green-400 mt-0.5">
              Potential profit: {fmtUsdc(potentialPnl)}
            </div>
          )}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Notes (optional)</label>
        <Input
          placeholder="e.g. Based on OKC signal, confidence 95"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="h-8 text-sm"
          data-testid="input-bet-notes"
        />
      </div>
      <div className="flex gap-2">
        <Button onClick={handleSubmit} size="sm" className="flex-1" data-testid="button-add-bet">
          <Plus className="w-3.5 h-3.5 mr-1" /> Track Bet
        </Button>
        <Button onClick={onCancel} size="sm" variant="outline" data-testid="button-cancel-bet">
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Bet card ─────────────────────────────────────────────────────────────────

function BetCard({ bet, onResolve, onDelete, onUpdateNotes }: {
  bet: TrackedBet;
  onResolve: (id: string, status: "won" | "lost" | "cancelled", price?: number) => void;
  onDelete: (id: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [resolveMode, setResolveMode] = useState(false);
  const [finalPrice, setFinalPrice] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(bet.notes || "");

  const statusColor = {
    open: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/20",
    won: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/20",
    lost: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20",
    cancelled: "bg-muted text-muted-foreground border-border",
  }[bet.status];

  const potentialPnl = bet.side === "YES"
    ? bet.betAmount * (1 - bet.entryPrice) / bet.entryPrice
    : bet.betAmount * bet.entryPrice / (1 - bet.entryPrice);

  return (
    <Card data-testid={`bet-card-${bet.id}`}>
      <CardContent className="p-3 space-y-2">
        {/* Header row */}
        <div className="flex items-start gap-2">
          <div className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold border ${
            bet.side === "YES"
              ? "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/20"
              : "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20"
          }`}>
            {bet.side}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold leading-tight">{bet.outcomeLabel}</div>
            <div className="text-[11px] text-muted-foreground truncate">{bet.marketQuestion}</div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${statusColor}`}>
              {bet.status.toUpperCase()}
            </span>
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-muted-foreground hover:text-foreground"
              data-testid={`button-expand-bet-${bet.id}`}
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Key numbers row */}
        <div className="flex items-center gap-4 text-xs">
          <div>
            <span className="text-muted-foreground">Entry: </span>
            <span className="font-bold">{Math.round(bet.entryPrice * 100)}¢</span>
            <span className="text-muted-foreground ml-1">({toAmericanOdds(bet.entryPrice)})</span>
          </div>
          <div>
            <span className="text-muted-foreground">Bet: </span>
            <span className="font-bold">{fmtUsdc(bet.betAmount)}</span>
          </div>
          {bet.status === "open" && (
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
            {/* Notes */}
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

            {/* Polymarket link */}
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

            {/* Actions */}
            {bet.status === "open" && (
              <div className="space-y-2">
                {!resolveMode ? (
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white" onClick={() => {
                      onResolve(bet.id, "won");
                    }} data-testid={`button-won-${bet.id}`}>
                      <CheckCircle className="w-3 h-3" /> Won
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-red-500/30 text-red-600 hover:bg-red-500/10" onClick={() => {
                      onResolve(bet.id, "lost");
                    }} data-testid={`button-lost-${bet.id}`}>
                      <XCircle className="w-3 h-3" /> Lost
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setResolveMode(true)} data-testid={`button-resolve-custom-${bet.id}`}>
                      Custom resolve
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-1.5 flex-wrap">
                    <Input
                      placeholder="Final price (cents)"
                      type="number"
                      min="0"
                      max="100"
                      value={finalPrice}
                      onChange={e => setFinalPrice(e.target.value)}
                      className="h-7 text-xs w-36"
                      data-testid={`input-final-price-${bet.id}`}
                    />
                    <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => {
                      onResolve(bet.id, "won", parseFloat(finalPrice) / 100);
                      setResolveMode(false);
                    }}>Won</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs border-red-500/30 text-red-600 hover:bg-red-500/10" onClick={() => {
                      onResolve(bet.id, "lost", parseFloat(finalPrice) / 100);
                      setResolveMode(false);
                    }}>Lost</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setResolveMode(false)}>Cancel</Button>
                  </div>
                )}
              </div>
            )}

            {/* Delete */}
            <button
              onClick={() => onDelete(bet.id)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-red-500 transition-colors"
              data-testid={`button-delete-bet-${bet.id}`}
            >
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
  const { bets, addBet, resolveBet, deleteBet, updateNotes } = useBets();
  const [showAddForm, setShowAddForm] = useState(false);
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" /> My Bets
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track bets logged from signals. Stored locally.</p>
        </div>
        <Button onClick={() => setShowAddForm(f => !f)} size="sm" className="gap-1.5" data-testid="button-add-bet-open">
          <Plus className="w-3.5 h-3.5" /> Log Bet
        </Button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <AddBetForm
          onAdd={bet => { addBet(bet); setShowAddForm(false); }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Stats */}
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

      {/* Filter tabs */}
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

      {/* Bet list */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <div className="font-medium text-sm">No bets yet</div>
            <div className="text-xs text-muted-foreground mt-1">
              Log bets from the Signals or Dashboard pages using the "Track Bet" button, or click "Log Bet" above.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(bet => (
            <BetCard
              key={bet.id}
              bet={bet}
              onResolve={resolveBet}
              onDelete={deleteBet}
              onUpdateNotes={updateNotes}
            />
          ))}
        </div>
      )}

      {/* Instructions */}
      <Card className="border-dashed">
        <CardContent className="p-3 text-xs text-muted-foreground space-y-1">
          <div className="font-semibold text-foreground flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5" /> How to use
          </div>
          <div>1. Find a signal on the Signals or Dashboard page</div>
          <div>2. Click "Track Bet" on any signal card to pre-fill the form</div>
          <div>3. Enter your actual bet amount and click "Track Bet"</div>
          <div>4. When the market resolves, come back and click Won/Lost to log your PNL</div>
          <div className="text-muted-foreground/70 mt-1">Bets are stored locally in your browser. They won't sync across devices.</div>
        </CardContent>
      </Card>
    </div>
  );
}
