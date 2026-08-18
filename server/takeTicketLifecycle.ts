/**
 * Follow paper TAKE tickets: kickoff close vs alert, then won/lost at resolution.
 */
import { fetchClobQuote } from "./clobAsk";
import { formatPriceQuote } from "./oddsFormat";
import {
  listFollowedTakes,
  markKickoff,
  markSettled,
  type FollowedTake,
} from "./paperTakeBets";
import { sendTelegramText, telegramConfigured } from "./telegramTakeAlerts";

const GAMMA = "https://gamma-api.polymarket.com";

interface GammaMarket {
  closed?: boolean;
  active?: boolean;
  gameStartTime?: string;
  endDate?: string;
  outcomePrices?: string | string[];
  slug?: string;
}

function parsePrices(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => parseFloat(String(v))).filter((n) => Number.isFinite(n));
  }
  if (typeof raw === "string") {
    try {
      const arr = JSON.parse(raw) as unknown;
      return parsePrices(arr);
    } catch {
      return [];
    }
  }
  return [];
}

function parseStartMs(raw: string | undefined): number | null {
  if (!raw) return null;
  const iso = String(raw).replace(" ", "T").replace("+00", "Z");
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function tokenPrice(prices: number[], side: string): number | null {
  if (prices.length === 0) return null;
  const up = side.toUpperCase();
  if (up === "NO" && prices.length > 1) return prices[1];
  return prices[0];
}

function resolution(prices: number[], closed: boolean): { resolved: boolean; yesWon: boolean | null; yesPrice: number | null } {
  const yes = prices[0];
  if (!Number.isFinite(yes)) return { resolved: false, yesWon: null, yesPrice: null };
  if (closed) {
    if (yes >= 0.99) return { resolved: true, yesWon: true, yesPrice: yes };
    if (yes <= 0.01) return { resolved: true, yesWon: false, yesPrice: yes };
    return { resolved: false, yesWon: null, yesPrice: yes };
  }
  if (yes >= 0.999) return { resolved: true, yesWon: true, yesPrice: yes };
  if (yes <= 0.001) return { resolved: true, yesWon: false, yesPrice: yes };
  return { resolved: false, yesWon: null, yesPrice: yes };
}

async function fetchGammaMarket(slug: string | null): Promise<GammaMarket | null> {
  if (!slug) return null;
  try {
    const res = await fetch(`${GAMMA}/markets?slug=${encodeURIComponent(slug)}&limit=1`, {
      headers: { Accept: "application/json", "User-Agent": "PredictionInsider/3.0" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const mkt = Array.isArray(data) ? data[0] : (data as { markets?: GammaMarket[] })?.markets?.[0];
    return mkt && typeof mkt === "object" ? (mkt as GammaMarket) : null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[take-lifecycle] gamma slug ${slug}: ${msg}`);
    return null;
  }
}

function line(label: string, p: number | null): string {
  if (p == null || p <= 0) return `${label}  —`;
  const f = formatPriceQuote(p);
  return `${label}  ${p.toFixed(3)}  (${f.cents.toFixed(1)}¢)  dec ${f.decimalLabel}  ${f.americanLabel}`;
}

function clvCents(alert: number, close: number): string {
  const diff = (close - alert) * 100;
  const sign = diff >= 0 ? "+" : "";
  const beat = close > alert + 0.001
    ? "beat the close (got a better number)"
    : close < alert - 0.001
      ? "worse than close"
      : "in line with close";
  return `CLV  ${sign}${diff.toFixed(1)}¢  — ${beat}`;
}

function paperPnl(stake: number, fill: number, won: boolean): number {
  if (!won) return -stake;
  if (fill <= 0 || fill >= 1) return 0;
  return stake * (1 - fill) / fill;
}

async function snapshotClose(row: FollowedTake, gammaPx: number | null): Promise<number | null> {
  if (row.tokenId) {
    const q = await fetchClobQuote(row.tokenId);
    if (q.ask != null && q.ask > 0) return q.ask;
  }
  return gammaPx;
}

export async function runTakeTicketLifecycle(): Promise<void> {
  const rows = await listFollowedTakes();
  if (rows.length === 0) return;
  const tg = telegramConfigured();

  for (const row of rows) {
    try {
      const mkt = await fetchGammaMarket(row.slug);
      const prices = parsePrices(mkt?.outcomePrices);
      const closed = mkt?.closed === true || mkt?.active === false;
      const startMs = parseStartMs(mkt?.gameStartTime) ?? row.eventStartMs;
      const ourPx = tokenPrice(prices, row.side);
      const res = resolution(prices, closed);
      const now = Date.now();
      const started = startMs != null && now >= startMs - 30_000;
      let closePx = row.closePrice;

      if (!row.kickoffSent && (started || res.resolved)) {
        const close = await snapshotClose(row, ourPx);
        if (close != null && close > 0 && row.alertPrice > 0) {
          closePx = close;
          await markKickoff(row.id, close, startMs);
          if (tg) {
            const header = started && !res.resolved ? "⏰ KICKOFF — close vs alert" : "⏰ CLOSE LINE — vs alert";
            await sendTelegramText(
              [
                header,
                row.playLabel || row.marketQuestion,
                line("Alert ask", row.alertPrice),
                line("Close    ", close),
                clvCents(row.alertPrice, close),
                "Paper $100 at the alert ask. Hold to resolution.",
              ].join("\n"),
            );
          }
        } else if (res.resolved) {
          await markKickoff(row.id, row.alertPrice, startMs);
        }
      }

      if (!res.resolved || res.yesWon == null) continue;

      const side = row.side.toUpperCase();
      const won = side === "NO" ? res.yesWon === false : res.yesWon === true;
      const fill = row.actualPrice ?? row.alertPrice;
      const pnl = Math.round(paperPnl(row.betAmount || 100, fill, won) * 100) / 100;
      const settlePx = tokenPrice(prices, row.side) ?? (won ? 1 : 0);
      await markSettled(row.id, { won, resolvedPrice: settlePx, pnl });
      if (tg) {
        const title = won ? `✅ WON  $${(row.betAmount || 100).toFixed(0)} → ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}` : `❌ LOST  $${(row.betAmount || 100).toFixed(0)} → −$${(row.betAmount || 100).toFixed(0)}`;
        await sendTelegramText(
          [
            title,
            row.playLabel || row.marketQuestion,
            line("Alert ask", row.alertPrice),
            closePx != null ? line("Close    ", closePx) : "",
            `Settle ${won ? "Yes" : "No"} token → ${settlePx.toFixed(3)}`,
            "Paper ticket. Type your real fill in My Bets if you took it.",
          ].filter(Boolean).join("\n"),
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[take-lifecycle] ${row.id}: ${msg}`);
    }
  }
}
