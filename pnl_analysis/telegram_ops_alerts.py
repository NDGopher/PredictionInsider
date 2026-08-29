#!/usr/bin/env python3
"""Telegram ops alerts for promote / demote / hot-kick / health PAUSE.

Uses the same TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID as the Node take tape.
Dedupes via pnl_analysis/output/telegram_ops_sent.json.

Usage:
  python3 pnl_analysis/telegram_ops_alerts.py
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "output"
SENT = OUT / "telegram_ops_sent.json"
PROMOTE_LOG = OUT / "auto_promote_log.json"
KICK_LOG = OUT / "hot_kick_log.json"
HEALTH = OUT / "take_health.json"


def env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def configured() -> bool:
    return bool(env("TELEGRAM_BOT_TOKEN") and env("TELEGRAM_CHAT_ID"))


def load_sent() -> dict[str, str]:
    if not SENT.exists():
        return {}
    try:
        data = json.loads(SENT.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_sent(d: dict[str, str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    SENT.write_text(json.dumps(d, indent=2) + "\n", encoding="utf-8")


def send(text: str) -> bool:
    token = env("TELEGRAM_BOT_TOKEN")
    chat = env("TELEGRAM_CHAT_ID")
    if not token or not chat:
        return False
    body = json.dumps(
        {"chat_id": chat, "text": text, "disable_web_page_preview": True},
    ).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status == 200
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        print(f"[tg-ops] send failed: {e}")
        return False


def load_json(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def main() -> int:
    if not configured():
        print("[tg-ops] Telegram not configured — skip")
        return 0

    sent = load_sent()
    messages: list[tuple[str, str]] = []  # key, text

    promote = load_json(PROMOTE_LOG) or {}
    for p in promote.get("promoted") or []:
        u = str(p.get("username") or "")
        why = str(p.get("why") or "")
        key = f"promote:{u}:{why[:40]}"
        if key in sent:
            continue
        messages.append((key, f"✅ AUTO-PROMOTE → live\n{u}\n{why}"))
    for d in promote.get("demoted") or []:
        u = str(d.get("username") or "")
        why = str(d.get("why") or "")
        key = f"demote:{u}:{why[:40]}"
        if key in sent:
            continue
        messages.append((key, f"⬇️ AUTO-DEMOTE → watch\n{u}\n{why}"))

    kick = load_json(KICK_LOG) or {}
    for k in kick.get("kicked") or []:
        u = str(k.get("username") or "")
        why = str(k.get("why") or "")
        key = f"hotkick:{u}:{why[:40]}"
        if key in sent:
            continue
        messages.append((key, f"🚫 HOT-KICK\n{u}\n{why}"))

    health = load_json(HEALTH) or {}
    status = str(health.get("status") or "go").lower()
    pause = health.get("pause_reason")
    if status != "go" and pause:
        key = f"pause:{status}:{str(pause)[:60]}"
        if key not in sent:
            messages.append((key, f"⏸ TAKE BOOK PAUSED\n{pause}"))

    if not messages:
        print("[tg-ops] nothing new to send")
        return 0

    now = datetime.now(timezone.utc).isoformat()
    sent_n = 0
    for key, text in messages[:12]:
        if send(text):
            sent[key] = now
            sent_n += 1
            print(f"  sent {key}")
    save_sent(sent)
    print(f"[tg-ops] sent={sent_n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
