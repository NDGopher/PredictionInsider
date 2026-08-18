#!/usr/bin/env python3
"""Scrape public Polydata trader profiles as a calibration reference.

Polydata's JSON API (dev-api.polydata.pro) is 401 without a key. Public HTML
profiles at https://polydata.pro/traders/{username} include Smart Score, WR,
profit factor, Sharpe/Sortino/HHI/Kelly, bot score, and per-category rank/PnL.

This is a *reference*, not product truth. Our ranks use our closed+open books.
"""
from __future__ import annotations

import re
import time
from typing import Any

import requests

POLYDATA_BASE = "https://polydata.pro/traders"
USER_AGENT = "PredictionInsider/1.0 (research; +https://github.com/NDGopher/PredictionInsider)"
REQUEST_TIMEOUT = 25
SLEEP_SEC = 0.25
MAX_VALID_CATEGORY_RANK = 5_000

# Sports names we do not necessarily roster, but need for the public board.
REFERENCE_USERNAMES = [
    "swisstony",  # Polydata Sports #1
    "Theo4",
    "Fredi9999",
]

META_RE = re.compile(
    r"PnL\s+\$(-?[\d,]+),\s+Win Rate\s+(\d+)%?,\s+Smart Score\s+(\d+),\s+([\d,]+)\s+trades",
    re.I,
)
OVERALL_RANK_RE = re.compile(r"#(\d{1,4})\s+\d{2,3}\s+0x[a-fA-F0-9]{40}", re.I)
WALLET_RE = re.compile(r"0x[a-fA-F0-9]{40}")
PROFIT_FACTOR_RE = re.compile(r"Profit Factor\s+([\d.]+)x", re.I)
SHARPE_RE = re.compile(r"Sharpe\s+(-?[\d.]+)", re.I)
SORTINO_RE = re.compile(r"Sortino\s+(-?[\d.]+)", re.I)
HHI_RE = re.compile(r"HHI\s+([\d.]+)", re.I)
KELLY_RE = re.compile(r"Kelly\s*%\s+([\d.]+)%", re.I)
BOT_RE = re.compile(r"(\d{1,3})\s+(SEMI-BOT|BOT|HUMAN|MANUAL)[^\n]{0,40}", re.I)
TRADES_DAY_RE = re.compile(r"Trades\s*/\s*Day\s+([\d.]+)", re.I)
ACTIVE_HOURS_RE = re.compile(r"Active Hours\s+(\d+)/24", re.I)
CATEGORY_RE = re.compile(
    r"(OVERALL|SPORTS|WEATHER|CRYPTO|POLITICS|CULTURE|ECONOMICS|TECH|FINANCE)"
    r"\s*#\s*([\d,]+)\s*\$\s*([-,\d]+)"
    r"(?:\s*Vol:\s*\$\s*([-,\d]+))?",
    re.I,
)

# Polydata Smart Score mix (from https://polydata.pro/traders).
POLYDATA_SMART_SCORE_WEIGHTS = {
    "pnl_consistency": 0.25,
    "wr_quality": 0.20,
    "risk_management": 0.20,
    "diversification": 0.15,
    "timing_execution": 0.10,
    "bot_penalty": 0.10,
}


def _strip_html(html: str) -> str:
    text = re.sub(r"<!--\s*-->", "", html)
    text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    return re.sub(r"\s+", " ", text)


def _money(raw: str | None) -> float | None:
    if raw is None:
        return None
    cleaned = raw.replace(",", "").strip()
    if not cleaned or cleaned == "-":
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _int(raw: str | None) -> int | None:
    if raw is None:
        return None
    cleaned = raw.replace(",", "").strip()
    if not cleaned:
        return None
    try:
        return int(cleaned)
    except ValueError:
        return None


def parse_polydata_html(html: str, username: str) -> dict[str, Any]:
    """Parse a public Polydata trader profile page."""
    plain = _strip_html(html)
    out: dict[str, Any] = {
        "username": username,
        "url": f"{POLYDATA_BASE}/{username}",
        "ok": True,
    }
    meta = META_RE.search(html) or META_RE.search(plain)
    if meta:
        out["pnl"] = _money(meta.group(1))
        out["win_rate"] = float(meta.group(2))
        out["smart_score"] = int(meta.group(3))
        out["trades"] = _int(meta.group(4))
    wallets = WALLET_RE.findall(html)
    if wallets:
        # Prefer the first full address that appears next to the handle / score.
        out["wallet"] = wallets[0].lower()
    rank_m = OVERALL_RANK_RE.search(plain)
    if rank_m:
        out["overall_rank"] = int(rank_m.group(1))
    pf = PROFIT_FACTOR_RE.search(plain)
    if pf:
        out["profit_factor"] = float(pf.group(1))
    sh = SHARPE_RE.search(plain)
    if sh:
        out["sharpe"] = float(sh.group(1))
    so = SORTINO_RE.search(plain)
    if so:
        out["sortino"] = float(so.group(1))
    hhi = HHI_RE.search(plain)
    if hhi:
        out["hhi"] = float(hhi.group(1))
    kelly = KELLY_RE.search(plain)
    if kelly:
        out["kelly_pct"] = float(kelly.group(1))
    bot = BOT_RE.search(plain)
    if bot:
        out["bot_score"] = int(bot.group(1))
        out["bot_class"] = bot.group(2).upper()
    tpd = TRADES_DAY_RE.search(plain)
    if tpd:
        out["trades_per_day"] = float(tpd.group(1))
    hours = ACTIVE_HOURS_RE.search(plain)
    if hours:
        out["active_hours"] = int(hours.group(1))

    categories: dict[str, dict[str, float | int | None]] = {}
    for m in CATEGORY_RE.finditer(plain):
        cat = m.group(1).upper()
        rank = _int(m.group(2))
        pnl = _money(m.group(3))
        vol = _money(m.group(4))
        if rank is None:
            continue
        # Ghost's sports "rank" concatenated PnL digits (~1.8M). Real ranks are small.
        if rank > MAX_VALID_CATEGORY_RANK:
            rank = None
        categories[cat] = {"rank": rank, "pnl": pnl, "volume": vol}
    out["categories"] = categories
    sports = categories.get("SPORTS") or {}
    out["sports_rank"] = sports.get("rank")
    out["sports_pnl"] = sports.get("pnl")
    out["sports_volume"] = sports.get("volume")
    overall = categories.get("OVERALL") or {}
    if out.get("pnl") is None and overall.get("pnl") is not None:
        out["pnl"] = overall.get("pnl")
    if out.get("overall_rank") is None and overall.get("rank") is not None:
        out["overall_rank"] = overall.get("rank")
    return out


def fetch_polydata_profile(username: str, session: requests.Session | None = None) -> dict[str, Any]:
    """GET one public profile. Returns {ok: False, error} on failure."""
    url = f"{POLYDATA_BASE}/{username}"
    sess = session or requests.Session()
    try:
        r = sess.get(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"}, timeout=REQUEST_TIMEOUT)
        if r.status_code == 404:
            return {"username": username, "url": url, "ok": False, "error": "not_found"}
        r.raise_for_status()
        return parse_polydata_html(r.text, username)
    except Exception as exc:
        return {"username": username, "url": url, "ok": False, "error": str(exc)}


def scrape_polydata_profiles(usernames: list[str], sleep_sec: float = SLEEP_SEC) -> dict[str, dict[str, Any]]:
    """Scrape many profiles. Keyed by lowercase username."""
    seen: set[str] = set()
    ordered: list[str] = []
    for name in usernames:
        key = (name or "").strip()
        if not key or key.lower() in seen:
            continue
        seen.add(key.lower())
        ordered.append(key)
    out: dict[str, dict[str, Any]] = {}
    with requests.Session() as sess:
        for i, name in enumerate(ordered):
            row = fetch_polydata_profile(name, session=sess)
            out[name.lower()] = row
            status = "ok" if row.get("ok") else row.get("error") or "fail"
            sports = row.get("sports_rank")
            ss = row.get("smart_score")
            print(
                f"  polydata {i + 1}/{len(ordered)} {name:<32} {status} "
                f"SS={ss} sports#{sports} pnl={row.get('pnl')}"
            )
            if i < len(ordered) - 1:
                time.sleep(sleep_sec)
    return out
