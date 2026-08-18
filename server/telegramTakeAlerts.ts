/**
 * Telegram TAKE alerts with live ask. Edits the same message as the book moves.
 * Deletes the message when the play is no longer a valid TAKE.
 *
 * TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID required.
 */
import fs from "fs";
import path from "path";
import { formatPriceQuote } from "./oddsFormat";
import type { AnnotatedTakePlay, TakePlayBundle } from "./takePlays";

const ACTIVE_PATH = path.join(process.cwd(), "pnl_analysis", "output", "telegram_take_active.json");
const ASK_EDIT_TICK = 0.005;

interface ActivePlay {
  messageId: number;
  ask: number | null;
  paperId: string;
  playLabel: string;
}

interface ActiveFile {
  plays: Record<string, ActivePlay>;
}

function loadActive(): ActiveFile {
  try {
    if (!fs.existsSync(ACTIVE_PATH)) return { plays: {} };
    const raw = JSON.parse(fs.readFileSync(ACTIVE_PATH, "utf8")) as ActiveFile;
    return { plays: raw.plays || {} };
  } catch {
    return { plays: {} };
  }
}

function saveActive(file: ActiveFile): void {
  fs.mkdirSync(path.dirname(ACTIVE_PATH), { recursive: true });
  fs.writeFileSync(ACTIVE_PATH, JSON.stringify(file, null, 2), "utf8");
}

function lineFor(label: string, p: number | null | undefined): string {
  if (p == null || p <= 0) return `${label}  —`;
  const f = formatPriceQuote(p);
  return `${label}  ${p.toFixed(3)}  (${f.cents.toFixed(1)}¢)  dec ${f.decimalLabel}  ${f.americanLabel}`;
}

export function formatTakeTelegram(p: AnnotatedTakePlay, paused: boolean): string {
  const sportRoi = p.sportRoi == null ? "n/a" : `${p.sportRoi.toFixed(0)}%`;
  const lines = [
    paused ? "⏸ TAKE BOOK PAUSED — paper only, do not fill" : "🟢 TAKE",
    p.playLabel,
    `Sport ${p.sport || "—"} · ${p.submarket} · ${p.side}`,
    `Trader: ${p.traders.join(", ") || "—"}`,
    `As-of Q ${Math.round(p.q)} · ${p.rel.toFixed(1)}× own median · sport ROI ${sportRoi}`,
    lineFor("Their VWAP", p.avgEntryPrice),
    lineFor("Take cap ", p.takeCap) + "  (VWAP + 2¢, max pay)",
    lineFor("Live ask ", p.liveAsk ?? p.currentPrice) + "  ← paper at this",
    "Stake $100 · hold to resolution · skip NFL · drop if ask > cap or leaves 0.10–0.88",
    "Tracked as paper at the live ask. Type your real fill in My Bets.",
    p.url || "",
  ];
  return lines.filter((l) => l.length > 0).join("\n");
}

function formatKill(p: ActivePlay, reason: string): string {
  return `❌ DROPPED — no longer a TAKE\n${p.playLabel}\n${reason}\nPaper ticket cancelled unless you already entered an actual fill.`;
}

interface TelegramApiResult {
  ok: boolean;
  messageId?: number;
}

async function telegramApi(method: string, body: Record<string, unknown>): Promise<TelegramApiResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { ok: false };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, ...body }),
    });
    const json = (await res.json()) as { ok?: boolean; result?: { message_id?: number }; description?: string };
    if (!json.ok) {
      console.warn(`[telegram] ${method} failed: ${json.description || res.status}`);
      return { ok: false };
    }
    return { ok: true, messageId: json.result?.message_id };
  } catch (err: unknown) {
    console.warn(`[telegram] ${method} error:`, err);
    return { ok: false };
  }
}

async function sendMessage(text: string): Promise<number | null> {
  const r = await telegramApi("sendMessage", { text, disable_web_page_preview: false });
  return r.ok && r.messageId != null ? r.messageId : null;
}

async function editMessage(messageId: number, text: string): Promise<boolean> {
  const r = await telegramApi("editMessageText", { message_id: messageId, text, disable_web_page_preview: false });
  return r.ok;
}

async function deleteMessage(messageId: number): Promise<boolean> {
  const r = await telegramApi("deleteMessage", { message_id: messageId });
  return r.ok;
}

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export async function syncTakeBookAlerts(
  bundle: TakePlayBundle,
  opts: {
    paused: boolean;
    onNewTake?: (play: AnnotatedTakePlay) => Promise<void>;
    onDrop?: (paperId: string, reason: string) => Promise<void>;
    allowDrop?: boolean;
  },
): Promise<{ sent: number; edited: number; dropped: number; configured: boolean }> {
  const { paused, onNewTake, onDrop, allowDrop } = opts;
  const configured = telegramConfigured();
  const active = loadActive();
  const liveIds = new Set(bundle.live.filter((p) => p.take && p.valid).map((p) => p.id));
  let sent = 0;
  let edited = 0;
  let dropped = 0;
  const canDrop = allowDrop !== false;

  for (const play of bundle.live) {
    if (!play.take || !play.valid) continue;
    const paperId = `take-paper-${play.id}`;
    const prev = active.plays[play.id];
    if (paused && !prev) continue;
    if (!prev) {
      if (onNewTake) {
        await onNewTake(play);
      }
      if (configured) {
        const mid = await sendMessage(formatTakeTelegram(play, paused));
        if (mid == null) continue;
        active.plays[play.id] = {
          messageId: mid,
          ask: play.liveAsk,
          paperId,
          playLabel: play.playLabel,
        };
        sent += 1;
      } else {
        active.plays[play.id] = {
          messageId: 0,
          ask: play.liveAsk,
          paperId,
          playLabel: play.playLabel,
        };
      }
      continue;
    }
    const ask = play.liveAsk;
    const moved = prev.ask == null || ask == null || Math.abs((ask ?? 0) - (prev.ask ?? 0)) >= ASK_EDIT_TICK;
    if (configured && prev.messageId > 0 && moved) {
      const ok = await editMessage(prev.messageId, formatTakeTelegram(play, paused));
      if (ok) edited += 1;
    }
    prev.ask = ask;
    prev.playLabel = play.playLabel;
  }

  if (canDrop) {
  for (const id of Object.keys(active.plays)) {
    if (liveIds.has(id)) continue;
    const prev = active.plays[id];
    const liveRow = bundle.near.find((p) => p.id === id);
    const reason = liveRow?.invalidReason || liveRow?.misses[0] || "left the take book";
    if (configured && prev.messageId > 0) {
      const deleted = await deleteMessage(prev.messageId);
      if (!deleted) {
        await editMessage(prev.messageId, formatKill(prev, reason));
      }
      await sendMessage(formatKill(prev, reason));
    }
    if (onDrop) {
      await onDrop(prev.paperId, reason);
    }
    delete active.plays[id];
    dropped += 1;
  }
  }

  saveActive(active);
  return { sent, edited, dropped, configured };
}

/** @deprecated use syncTakeBookAlerts */
export async function notifyTakePlays(
  plays: AnnotatedTakePlay[],
  opts: { paused: boolean },
): Promise<{ sent: number; skipped: number; configured: boolean }> {
  const bundle: TakePlayBundle = {
    live: plays,
    near: [],
    paused: opts.paused,
    pauseReason: null,
  };
  const r = await syncTakeBookAlerts(bundle, { paused: opts.paused });
  return { sent: r.sent, skipped: r.edited, configured: r.configured };
}
