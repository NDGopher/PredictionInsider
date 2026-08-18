/**
 * Telegram take book:
 *  - One pinned tape (history + open paper + live count)
 *  - Live messages only while a TAKE is still fillable
 *  - Those cards are deleted when the play leaves the book
 *  - Kickoff CLV / won-lost are separate messages; the pin is updated too
 *
 * TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID required.
 * In the group: make the bot admin with Pin Messages.
 */
import fs from "fs";
import path from "path";
import { formatPriceQuote } from "./oddsFormat";
import { listTakeTape, type TakeTapeRow } from "./paperTakeBets";
import { loadTakeHealthFile, type AnnotatedTakePlay, type TakePlayBundle } from "./takePlays";

const ACTIVE_PATH = path.join(process.cwd(), "pnl_analysis", "output", "telegram_take_active.json");
const BOARD_PATH = path.join(process.cwd(), "pnl_analysis", "output", "telegram_take_board.json");
const ASK_EDIT_TICK = 0.005;
const TG_MAX = 3900;

interface ActivePlay {
  messageId: number;
  ask: number | null;
  paperId: string;
  playLabel: string;
}

interface ActiveFile {
  plays: Record<string, ActivePlay>;
}

interface BoardFile {
  pinMessageId: number | null;
  lifecycle: Record<string, number>;
}

interface TelegramApiResult {
  ok: boolean;
  messageId?: number;
  description?: string;
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

function loadBoard(): BoardFile {
  try {
    if (!fs.existsSync(BOARD_PATH)) return { pinMessageId: null, lifecycle: {} };
    const raw = JSON.parse(fs.readFileSync(BOARD_PATH, "utf8")) as BoardFile;
    return { pinMessageId: raw.pinMessageId ?? null, lifecycle: raw.lifecycle || {} };
  } catch {
    return { pinMessageId: null, lifecycle: {} };
  }
}

function saveBoard(file: BoardFile): void {
  fs.mkdirSync(path.dirname(BOARD_PATH), { recursive: true });
  fs.writeFileSync(BOARD_PATH, JSON.stringify(file, null, 2), "utf8");
}

function cents(p: number | null | undefined): string {
  if (p == null || p <= 0) return "—";
  return `${formatPriceQuote(p).cents.toFixed(1)}¢`;
}

function clvLabel(alert: number, close: number | null): string {
  if (close == null || close <= 0 || alert <= 0) return "CLV —";
  const diff = (close - alert) * 100;
  const sign = diff >= 0 ? "+" : "";
  return `CLV ${sign}${diff.toFixed(1)}¢`;
}

function lineFor(label: string, p: number | null | undefined): string {
  if (p == null || p <= 0) return `${label}  —`;
  const f = formatPriceQuote(p);
  return `${label}  ${p.toFixed(3)}  (${f.cents.toFixed(1)}¢)  dec ${f.decimalLabel}  ${f.americanLabel}`;
}

function clip(text: string): string {
  if (text.length <= TG_MAX) return text;
  return `${text.slice(0, TG_MAX - 14)}\n…(truncated)`;
}

function tapeLine(row: TakeTapeRow): string {
  const label = row.playLabel.replace(/\s+/g, " ").slice(0, 72);
  if (row.status === "won") {
    const pnl = row.pnl == null ? "" : `  +$${Math.abs(row.pnl).toFixed(0)}`;
    return `✅ ${label}  ${cents(row.alertPrice)}  ${clvLabel(row.alertPrice, row.closePrice)}${pnl}`;
  }
  if (row.status === "lost") {
    return `❌ ${label}  ${cents(row.alertPrice)}  ${clvLabel(row.alertPrice, row.closePrice)}  −$100`;
  }
  if (row.status === "cancelled") {
    return `🗑 DROPPED  ${label}`;
  }
  if (row.kickoffSent) {
    return `⏰ ${label}  alert ${cents(row.alertPrice)}  ${clvLabel(row.alertPrice, row.closePrice)}  waiting settle`;
  }
  return `🟢 ${label}  alert ${cents(row.alertPrice)}  still live / pre-kickoff`;
}

function liveBoardLines(live: AnnotatedTakePlay[]): string[] {
  if (live.length) {
    return live.map((p) => `• ${p.playLabel}  ask ${cents(p.liveAsk ?? p.currentPrice)}`);
  }
  const leftover = Object.values(loadActive().plays);
  if (leftover.length) {
    return leftover.map((p) => `• ${p.playLabel}  ask ${cents(p.ask)}`);
  }
  return ["• none — waiting for a TAKE"];
}

function formatBoard(opts: {
  live: AnnotatedTakePlay[];
  open: TakeTapeRow[];
  recent: TakeTapeRow[];
}): string {
  const health = loadTakeHealthFile();
  const w30 = health?.windows?.last_30d;
  const w60 = health?.windows?.last_60d;
  const status = (health?.status || "—").toUpperCase();
  const liveLines = liveBoardLines(opts.live);
  const openLines = opts.open.length
    ? opts.open.map(tapeLine)
    : ["• none"];
  const recentLines = opts.recent.length
    ? opts.recent.map(tapeLine)
    : ["• none yet — results land here"];
  const roi30 = w30?.roi_2c == null ? "—" : `${w30.roi_2c >= 0 ? "+" : ""}${w30.roi_2c.toFixed(1)}%`;
  const roi60 = w60?.roi_2c == null ? "—" : `${w60.roi_2c >= 0 ? "+" : ""}${w60.roi_2c.toFixed(1)}%`;
  const pause = health?.pause_reason ? `\n⏸ ${health.pause_reason}` : "";
  return clip([
    `📌 TAKE BOOK  ·  ${status}  ·  paper $100${pause}`,
    "",
    "LIVE (bet these now — cards below disappear when you can no longer fill)",
    ...liveLines,
    "",
    "OPEN PAPER",
    ...openLines,
    "",
    "RESULTS",
    ...recentLines,
    "",
    `30d n=${w30?.n ?? 0}  ${roi30} after 2¢   ·   60d n=${w60?.n ?? 0}  ${roi60}`,
    "Fill the live ask, never above VWAP+2¢. Hold to resolution. Skip NFL.",
  ].join("\n"));
}

function telegramEnv(name: "TELEGRAM_BOT_TOKEN" | "TELEGRAM_CHAT_ID"): string {
  return (process.env[name] || "").trim().replace(/^["']|["']$/g, "");
}

async function telegramApi(method: string, body: Record<string, unknown>): Promise<TelegramApiResult> {
  const token = telegramEnv("TELEGRAM_BOT_TOKEN");
  const chat = telegramEnv("TELEGRAM_CHAT_ID");
  if (!token || !chat) return { ok: false };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, ...body }),
    });
    const json = (await res.json()) as { ok?: boolean; result?: { message_id?: number }; description?: string };
    if (!json.ok) {
      const desc = json.description || String(res.status);
      if (/message is not modified/i.test(desc)) {
        return { ok: true, messageId: typeof body.message_id === "number" ? body.message_id : undefined };
      }
      console.warn(`[telegram] ${method} failed: ${desc}`);
      return { ok: false, description: desc };
    }
    return { ok: true, messageId: json.result?.message_id };
  } catch (err: unknown) {
    console.warn(`[telegram] ${method} error:`, err);
    return { ok: false };
  }
}

async function sendMessage(text: string): Promise<number | null> {
  const r = await telegramApi("sendMessage", { text, disable_web_page_preview: true });
  return r.ok && r.messageId != null ? r.messageId : null;
}

async function editMessage(messageId: number, text: string): Promise<boolean> {
  const r = await telegramApi("editMessageText", {
    message_id: messageId,
    text,
    disable_web_page_preview: true,
  });
  return r.ok;
}

async function deleteMessage(messageId: number): Promise<boolean> {
  const r = await telegramApi("deleteMessage", { message_id: messageId });
  return r.ok;
}

async function pinMessage(messageId: number): Promise<boolean> {
  const r = await telegramApi("pinChatMessage", {
    message_id: messageId,
    disable_notification: true,
  });
  if (!r.ok) {
    console.warn("[telegram] pin failed — make the bot a group admin with Pin Messages");
  }
  return r.ok;
}

export function formatTakeTelegram(p: AnnotatedTakePlay, paused: boolean): string {
  const sportRoi = p.sportRoi == null ? "n/a" : `${p.sportRoi.toFixed(0)}%`;
  const lines = [
    paused ? "⏸ TAKE BOOK PAUSED — paper only, do not fill" : "🟢 LIVE TAKE — fillable now",
    p.playLabel,
    p.marketQuestion,
    `Sport ${p.sport || "—"} · ${p.submarket} · ${p.side}`,
    `Trader: ${p.traders.join(", ") || "—"}`,
    `As-of Q ${Math.round(p.q)} · ${p.rel.toFixed(1)}× own median · sport ROI ${sportRoi}`,
    lineFor("Their VWAP", p.avgEntryPrice),
    lineFor("Take cap ", p.takeCap) + "  (VWAP + 2¢, max pay)",
    lineFor("Live ask ", p.liveAsk ?? p.currentPrice) + "  ← paper at this",
    "Stake $100 · hold to resolution · skip NFL",
    "This card is deleted when you can no longer bet it. CLV + result go to the pinned tape.",
    p.url || "",
  ];
  return lines.filter((l) => l.length > 0).join("\n");
}

function formatKill(p: ActivePlay, reason: string): string {
  return `❌ DROPPED — no longer fillable\n${p.playLabel}\n${reason}\nPaper cancelled unless you already entered an actual fill.`;
}

export async function sendTelegramText(text: string): Promise<number | null> {
  return sendMessage(text);
}

export function isUnfillableReason(reason: string): boolean {
  return /ask|outside|locked|resolved|no live ask|cap/i.test(reason);
}

export function telegramConfigured(): boolean {
  return Boolean(telegramEnv("TELEGRAM_BOT_TOKEN") && telegramEnv("TELEGRAM_CHAT_ID"));
}

export function logTelegramStartup(): void {
  if (telegramConfigured()) {
    const chat = telegramEnv("TELEGRAM_CHAT_ID");
    console.log(`[telegram] ON — will pin the take tape in chat ${chat}`);
    return;
  }
  console.warn(
    "[telegram] OFF — the website is up, but Telegram will stay silent. In .env the TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID lines must be uncommented (no # at the start), saved, then restart the server.",
  );
}

export async function refreshPinnedTakeBoard(live: AnnotatedTakePlay[]): Promise<void> {
  if (!telegramConfigured()) return;
  const tape = await listTakeTape();
  const text = formatBoard({ live, open: tape.open, recent: tape.recent });
  const board = loadBoard();
  if (board.pinMessageId && board.pinMessageId > 0) {
    const ok = await editMessage(board.pinMessageId, text);
    if (ok) {
      await pinMessage(board.pinMessageId);
      return;
    }
  }
  const mid = await sendMessage(text);
  if (mid == null) return;
  board.pinMessageId = mid;
  saveBoard(board);
  await pinMessage(mid);
}

export async function removeLiveTakeCard(paperId: string): Promise<void> {
  const active = loadActive();
  let changed = false;
  for (const id of Object.keys(active.plays)) {
    const prev = active.plays[id];
    if (prev.paperId !== paperId) continue;
    if (telegramConfigured() && prev.messageId > 0) {
      await deleteMessage(prev.messageId);
    }
    delete active.plays[id];
    changed = true;
  }
  if (changed) saveActive(active);
}

export async function postTakeLifecycle(paperId: string, text: string): Promise<void> {
  if (!telegramConfigured()) return;
  const board = loadBoard();
  const existing = board.lifecycle[paperId];
  if (existing && existing > 0) {
    const ok = await editMessage(existing, text);
    if (ok) return;
  }
  const mid = await sendMessage(text);
  if (mid == null) return;
  board.lifecycle[paperId] = mid;
  saveBoard(board);
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
  const livePlays = bundle.live.filter((p) => p.take && p.valid);
  const liveIds = new Set(livePlays.map((p) => p.id));
  let sent = 0;
  let edited = 0;
  let dropped = 0;
  const canDrop = allowDrop !== false;

  for (const play of livePlays) {
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
      const liveRow = bundle.near.find((p) => p.id === id) || bundle.live.find((p) => p.id === id);
      const reason = liveRow?.invalidReason || liveRow?.misses[0] || "left the take book";
      const unfillable = isUnfillableReason(reason);
      if (configured && prev.messageId > 0) {
        await deleteMessage(prev.messageId);
      }
      if (unfillable) {
        if (configured) {
          await postTakeLifecycle(prev.paperId, formatKill(prev, reason));
        }
        if (onDrop) {
          await onDrop(prev.paperId, reason);
        }
      }
      delete active.plays[id];
      dropped += 1;
    }
  }

  saveActive(active);
  if (configured) {
    await refreshPinnedTakeBoard(paused ? [] : livePlays);
  }
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
