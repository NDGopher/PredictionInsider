/**
 * Telegram alerts for take-book plays. No auto-betting.
 *
 * TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID required.
 * Dedupes by signal id in pnl_analysis/output/telegram_take_sent.json
 */
import fs from "fs";
import path from "path";
import type { AnnotatedTakePlay } from "./takePlays";

const SENT_PATH = path.join(process.cwd(), "pnl_analysis", "output", "telegram_take_sent.json");

interface SentFile {
  ids: string[];
}

function loadSent(): Set<string> {
  try {
    if (!fs.existsSync(SENT_PATH)) return new Set();
    const raw = JSON.parse(fs.readFileSync(SENT_PATH, "utf8")) as SentFile;
    return new Set(raw.ids || []);
  } catch {
    return new Set();
  }
}

function saveSent(ids: Set<string>): void {
  const trimmed = [...ids].slice(-500);
  fs.mkdirSync(path.dirname(SENT_PATH), { recursive: true });
  fs.writeFileSync(SENT_PATH, JSON.stringify({ ids: trimmed }, null, 2), "utf8");
}

function formatPlay(p: AnnotatedTakePlay, paused: boolean): string {
  const fill = Math.round(p.fillPlus2c * 100);
  const live = Math.round(p.currentPrice * 100);
  const entry = Math.round(p.avgEntryPrice * 100);
  const sportRoi = p.sportRoi == null ? "n/a" : `${p.sportRoi.toFixed(0)}%`;
  const lines = [
    paused ? "⏸ TAKE BOOK PAUSED — paper only, do not fill" : "🟢 TAKE",
    p.playLabel,
    `Sport ${p.sport || "—"} · ${p.submarket} · ${p.side}`,
    `Trader: ${p.traders.join(", ") || "—"}`,
    `As-of Q ${Math.round(p.q)} · ${p.rel.toFixed(1)}× own median · sport ROI ${sportRoi}`,
    `Their VWAP ${entry}¢ · live ${live}¢ · pay up to ${fill}¢ (VWAP + 2¢)`,
    "Stake $100 flat · hold to resolution · skip NFL · do not chase past 88¢",
    "Human fill. No auto-bet. Log the ticket in My Bets after you take it.",
    p.url || "",
  ];
  return lines.filter((l) => l.length > 0).join("\n");
}

async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text,
        disable_web_page_preview: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[telegram] send failed ${res.status}: ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[telegram] send error:", err);
    return false;
  }
}

export async function notifyTakePlays(
  plays: AnnotatedTakePlay[],
  *,
  paused: boolean,
): Promise<{ sent: number; skipped: number; configured: boolean }> {
  const configured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const sentIds = loadSent();
  let sent = 0;
  let skipped = 0;
  for (const p of plays) {
    if (!p.take) continue;
    if (sentIds.has(p.id)) {
      skipped += 1;
      continue;
    }
    if (!configured) {
      skipped += 1;
      continue;
    }
    const ok = await sendTelegram(formatPlay(p, paused));
    if (!ok) continue;
    sentIds.add(p.id);
    sent += 1;
  }
  if (sent > 0) saveSent(sentIds);
  return { sent, skipped, configured };
}
