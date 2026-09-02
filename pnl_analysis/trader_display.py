#!/usr/bin/env python3
"""English desk names for copy-book wallets.

Wallet hex and auto-pseudonyms are not a product surface. Never invent a
handle — if we do not have a human username, show a short book label.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any

# Known human / short labels. Keys are lowercase wallets or exact usernames.
# These are already-used handles in the repo, not invented personas.
KNOWN_LABELS: dict[str, str] = {
    "0xec981ed70ae69c5cbcac08c1ba063e734f6bafcd": "Heavy888",
    "0xheavy888": "Heavy888",
    "0x8a3ab8120807bd64a3de48695110e390fa2ceb9a": "8a3a",
    "0x8a3ab8120807bd64a3de48695110e390fa2ceb9a".lower(): "8a3a",
    "0x5966db1fe50763c9e3c014d756369bad07e1f804": "5966",
    "0x20d6436849f930584892730c7f96ebb2ac763856": "20D6",
    "0xe30e74595517de48f1fb19f4553dd3d9f1e96b87": "E30E",
    "0xcb6ed9332a8fd1b930893c705dd234f37aa248e6": "Cb6E",
    "0x53ecc53e7a69aad0e6dda60264cc2e363092df91": "53eC",
    "0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8": "HVAB",
}

WALLET_RE = re.compile(r"^0x[a-fA-F0-9]{8,}$")
HEX_TS_RE = re.compile(r"^0x[a-fA-F0-9]{10,}-\d{9,}$")
AUTO_PSEUDO_RE = re.compile(r"^[A-Z][a-z]+-[A-Z][a-z]+$")
MOJIBAKE_MARKS = ("Ã", "Â", "â€", "�", "\ufffd")


def fix_mojibake(text: str) -> str:
    """Undo UTF-8-as-latin1 and strip replacement characters. No invented text."""
    raw = (text or "").replace("\ufffd", "").replace("�", "")
    if any(m in raw for m in MOJIBAKE_MARKS):
        try:
            raw = raw.encode("latin-1").decode("utf-8")
        except (UnicodeDecodeError, UnicodeEncodeError):
            pass
    normalized = unicodedata.normalize("NFC", raw)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Cc").strip()


def is_wallet_username(name: str) -> bool:
    s = (name or "").strip()
    return bool(WALLET_RE.match(s) or HEX_TS_RE.match(s))


def is_auto_pseudonym(name: str) -> bool:
    s = (name or "").strip()
    return (not s) or bool(AUTO_PSEUDO_RE.match(s)) or is_wallet_username(s)


def short_wallet(wallet: str) -> str:
    w = (wallet or "").strip()
    if w.lower().startswith("0x") and len(w) >= 6:
        return w[2:6]
    return w[:6] if w else "book"


def english_name(username: str | None, wallet: str | None = None, *, top_sport: str | None = None) -> str:
    """Desk label: human username, known alias, or 'Book abcd' — never raw 40-char hex."""
    user = fix_mojibake(str(username or ""))
    w = str(wallet or "").strip().lower()
    if w in KNOWN_LABELS:
        return KNOWN_LABELS[w]
    if user.lower() in KNOWN_LABELS:
        return KNOWN_LABELS[user.lower()]
    if user and not is_auto_pseudonym(user):
        return user
    code = short_wallet(w or user)
    sport = fix_mojibake(top_sport or "")
    if sport and sport.upper() not in {"OTHER", "UNKNOWN", ""}:
        return f"{sport.title()} book {code}"
    return f"Book {code}"


def attach_display(row: dict[str, Any]) -> dict[str, Any]:
    """Copy a trader row and add display_name / display_wallet. Does not mutate PnL."""
    out = dict(row)
    username = str(row.get("username") or "")
    wallet = str(row.get("wallet") or "")
    top = None
    our = row.get("our")
    if isinstance(our, dict):
        top = our.get("top_sport")
    top = top or row.get("top_sport")
    out["display_name"] = english_name(username, wallet, top_sport=str(top) if top else None)
    out["display_wallet"] = (wallet[:10] + "…") if len(wallet) > 12 else wallet
    return out
