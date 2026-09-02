#!/usr/bin/env python3
"""Resolve display names / usernames to the real Polymarket trading wallet.

A label like HVAB or 20D6 must become the proxy wallet that actually trades,
not a stale CSV filename. Unresolved names are flagged — never silently missing.

Order:
  1) Already a 0x40 address (or 0x…-timestamp profile slug)
  2) Local roster / known labels / extra_traders.json
  3) Gamma public-search (proxyWallet on the profile)
  4) Sports / all-time leaderboard username match
"""
from __future__ import annotations

import json
import random
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import requests

from trader_display import KNOWN_LABELS, english_name

ROOT = Path(__file__).resolve().parent
GAMMA = "https://gamma-api.polymarket.com"
DATA = "https://data-api.polymarket.com"
WALLET_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
SLUG_RE = re.compile(r"^(0x[a-fA-F0-9]{40})-\d+$")

GetJson = Callable[[str, dict[str, Any] | None], Any]


def _default_get(url: str, params: dict[str, Any] | None = None) -> Any:
    for attempt in range(4):
        try:
            r = requests.get(url, params=params, timeout=20)
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(min(8.0, (2**attempt) + random.uniform(0.2, 0.8)))
            continue
        if r.status_code in (429, 502, 503) and attempt < 3:
            time.sleep(min(8.0, (2**attempt) + random.uniform(0.2, 0.8)))
            continue
        r.raise_for_status()
        return r.json()
    return None


def normalize_wallet(value: str | None) -> str | None:
    raw = (value or "").strip()
    if not raw:
        return None
    m = SLUG_RE.match(raw)
    if m:
        return m.group(1).lower()
    if WALLET_RE.match(raw):
        return raw.lower()
    return None


def _local_maps() -> tuple[dict[str, str], dict[str, str]]:
    """username.lower() → wallet, wallet → username from on-disk roster files."""
    by_name: dict[str, str] = {}
    by_wallet: dict[str, str] = {}
    extra = ROOT / "extra_traders.json"
    if extra.exists():
        try:
            rows = json.loads(extra.read_text(encoding="utf-8"))
        except Exception:
            rows = []
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict):
                    continue
                w = normalize_wallet(str(row.get("wallet") or ""))
                u = str(row.get("username") or "").strip()
                if w and u:
                    by_name[u.lower()] = w
                    by_wallet[w] = u
    try:
        from run_full_pipeline import ALL_TRADERS  # noqa: WPS433
        for wallet, username in ALL_TRADERS:
            w = normalize_wallet(wallet)
            if w and username:
                by_name[str(username).lower()] = w
                by_wallet.setdefault(w, str(username))
    except Exception:
        pass
    for key, label in KNOWN_LABELS.items():
        if WALLET_RE.match(key):
            by_name[label.lower()] = key.lower()
            by_wallet.setdefault(key.lower(), label)
        else:
            # username alias — only useful if we already have a wallet
            pass
    return by_name, by_wallet


def _gamma_search(query: str, get_json: GetJson) -> dict[str, Any] | None:
    data = get_json(
        f"{GAMMA}/public-search",
        {"q": query, "search_profiles": "true", "limit_per_type": 25},
    )
    if not isinstance(data, dict):
        return None
    profiles = data.get("profiles") or []
    exact: list[dict[str, Any]] = []
    fuzzy: list[dict[str, Any]] = []
    q = query.strip().lower()
    for p in profiles:
        if not isinstance(p, dict):
            continue
        name = str(p.get("name") or "").strip()
        pseudo = str(p.get("pseudonym") or "").strip()
        proxy = normalize_wallet(str(p.get("proxyWallet") or p.get("proxy_wallet") or ""))
        eoa = normalize_wallet(str(p.get("userAddress") or p.get("address") or ""))
        if not proxy and not eoa:
            continue
        rec = {
            "username": name or pseudo or query,
            "wallet": proxy or eoa,
            "eoa_wallet": eoa,
            "source": "gamma_public_search",
        }
        if name.lower() == q or pseudo.lower() == q:
            exact.append(rec)
        elif q in name.lower() or q in pseudo.lower():
            fuzzy.append(rec)
    if exact:
        return exact[0]
    if len(fuzzy) == 1:
        return fuzzy[0]
    return None


def _leaderboard_match(query: str, get_json: GetJson) -> dict[str, Any] | None:
    q = query.strip().lower()
    for category, window in (("SPORTS", "MONTH"), ("SPORTS", "ALL"), ("OVERALL", "ALL")):
        try:
            data = get_json(
                f"{DATA}/v1/leaderboard",
                {
                    "timePeriod": window,
                    "orderBy": "PNL",
                    "limit": 100,
                    "offset": 0,
                    "category": category,
                },
            )
        except Exception:
            continue
        rows = data if isinstance(data, list) else (data.get("data") or data.get("traders") or [] if isinstance(data, dict) else [])
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("userName") or row.get("username") or row.get("name") or "").strip()
            proxy = normalize_wallet(
                str(row.get("proxyWallet") or row.get("userAddress") or row.get("address") or "")
            )
            if not proxy or not name:
                continue
            if name.lower() == q or name.lower().replace(" ", "") == q.replace(" ", ""):
                return {
                    "username": name,
                    "wallet": proxy,
                    "eoa_wallet": normalize_wallet(str(row.get("userAddress") or "")),
                    "source": f"leaderboard_{category.lower()}_{window.lower()}",
                }
    return None


def resolve_username(
    username: str,
    *,
    get_json: GetJson | None = None,
    local_only: bool = False,
) -> dict[str, Any]:
    """Return a resolution record. Never invent a wallet."""
    raw = (username or "").strip()
    display = english_name(raw, None)
    now = datetime.now(timezone.utc).isoformat()
    empty = {
        "username": raw,
        "display_name": display,
        "wallet": None,
        "eoa_wallet": None,
        "source": "",
        "resolved": False,
        "unresolved_reason": "empty_username",
        "last_resolved_at": now,
    }
    if not raw:
        return empty

    as_wallet = normalize_wallet(raw)
    if as_wallet:
        return {
            "username": raw,
            "display_name": english_name(raw, as_wallet),
            "wallet": as_wallet,
            "eoa_wallet": as_wallet,
            "source": "address",
            "resolved": True,
            "unresolved_reason": None,
            "last_resolved_at": now,
        }

    by_name, by_wallet = _local_maps()
    local = by_name.get(raw.lower())
    if local:
        return {
            "username": raw,
            "display_name": english_name(raw, local),
            "wallet": local,
            "eoa_wallet": None,
            "source": "local_roster",
            "resolved": True,
            "unresolved_reason": None,
            "last_resolved_at": now,
        }
    # Known short labels (HVAB, 20D6) keyed by wallet in KNOWN_LABELS
    for wallet, label in KNOWN_LABELS.items():
        if WALLET_RE.match(wallet) and label.lower() == raw.lower():
            return {
                "username": raw,
                "display_name": label,
                "wallet": wallet.lower(),
                "eoa_wallet": None,
                "source": "known_label",
                "resolved": True,
                "unresolved_reason": None,
                "last_resolved_at": now,
            }

    if local_only:
        return {
            **empty,
            "username": raw,
            "display_name": display,
            "unresolved_reason": "not_in_local_roster",
        }

    getter = get_json or _default_get
    try:
        hit = _gamma_search(raw, getter)
        if hit and hit.get("wallet"):
            w = str(hit["wallet"])
            return {
                "username": raw,
                "display_name": english_name(hit.get("username") or raw, w),
                "wallet": w,
                "eoa_wallet": hit.get("eoa_wallet"),
                "source": hit.get("source") or "gamma_public_search",
                "resolved": True,
                "unresolved_reason": None,
                "last_resolved_at": now,
            }
    except Exception as exc:
        gamma_err = str(exc)
    else:
        gamma_err = None

    try:
        hit = _leaderboard_match(raw, getter)
        if hit and hit.get("wallet"):
            w = str(hit["wallet"])
            return {
                "username": raw,
                "display_name": english_name(hit.get("username") or raw, w),
                "wallet": w,
                "eoa_wallet": hit.get("eoa_wallet"),
                "source": hit.get("source") or "leaderboard",
                "resolved": True,
                "unresolved_reason": None,
                "last_resolved_at": now,
            }
    except Exception as exc:
        lb_err = str(exc)
    else:
        lb_err = None

    why = "unresolved_after_search"
    if gamma_err or lb_err:
        why = f"search_error gamma={gamma_err} leaderboard={lb_err}"
    return {
        "username": raw,
        "display_name": display,
        "wallet": None,
        "eoa_wallet": None,
        "source": "unresolved",
        "resolved": False,
        "unresolved_reason": why,
        "last_resolved_at": now,
    }


def roster_targets() -> list[dict[str, str]]:
    """Copy-focus names/wallets we must keep current (live/watch/scout/bench)."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    try:
        from copy_roster import copy_focus_buckets, load_universe
        uni = load_universe()
        for key in copy_focus_buckets():
            for t in uni.get(key) or []:
                username = str(t.get("username") or "").strip()
                wallet = normalize_wallet(str(t.get("wallet") or "")) or ""
                token = wallet or username.lower()
                if not token or token in seen:
                    continue
                seen.add(token)
                out.append({"username": username, "wallet": wallet})
    except Exception:
        pass
    extra = ROOT / "extra_traders.json"
    if extra.exists():
        try:
            rows = json.loads(extra.read_text(encoding="utf-8"))
        except Exception:
            rows = []
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict):
                    continue
                st = str(row.get("status") or "").lower()
                if st not in {"take_book", "watch", "scout", "benched"}:
                    continue
                username = str(row.get("username") or "").strip()
                wallet = normalize_wallet(str(row.get("wallet") or "")) or ""
                token = wallet or username.lower()
                if not token or token in seen:
                    continue
                seen.add(token)
                out.append({"username": username, "wallet": wallet})
    return out


def resolve_targets(
    names: list[str] | None = None,
    *,
    get_json: GetJson | None = None,
    local_only: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Resolve copy-focus + optional extra usernames. Returns (resolved, unresolved)."""
    targets = roster_targets()
    extra_names = [n.strip() for n in (names or []) if n and n.strip()]
    have = {t["username"].lower() for t in targets if t.get("username")}
    for n in extra_names:
        if n.lower() not in have:
            targets.append({"username": n, "wallet": ""})
    resolved: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    for t in targets:
        username = t.get("username") or ""
        known = normalize_wallet(t.get("wallet"))
        if known:
            rec = {
                "username": username or known,
                "display_name": english_name(username, known),
                "wallet": known,
                "eoa_wallet": None,
                "source": "roster_wallet",
                "resolved": True,
                "unresolved_reason": None,
                "last_resolved_at": datetime.now(timezone.utc).isoformat(),
            }
            resolved.append(rec)
            continue
        rec = resolve_username(username, get_json=get_json, local_only=local_only)
        if rec.get("resolved") and rec.get("wallet"):
            resolved.append(rec)
        else:
            unresolved.append(rec)
    return resolved, unresolved
