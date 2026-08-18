#!/usr/bin/env python3
"""Build PredictionInsider trader ranks from our full books.

Polydata is the public calibration (Smart Score, WR, PF, Sharpe, sports rank).
Our Insider Score is the product: same ratio families, but recency + copyability
replace their timing/bot slots, and PnL/WR come from our winner+loser+recent
closed books — never from a winner-sorted 10k cap.

Writes:
  pnl_analysis/output/insider_ranks.json
  pnl_analysis/INSIDER_RANKS.md
"""
from __future__ import annotations

import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from polydata_reference import (  # noqa: E402
    POLYDATA_SMART_SCORE_WEIGHTS,
    REFERENCE_USERNAMES,
    scrape_polydata_profiles,
)
from run_full_pipeline import (  # noqa: E402
    EXTRA_TRADERS_PATH,
    OUTPUT_DIR,
    csv_path_for,
    json_path_for,
    roster_traders,
)

AS_OF = datetime.now(timezone.utc)
ROOT = Path(__file__).resolve().parent
HEALTH_PATH = OUTPUT_DIR / "trader_health.json"
TRUSTED_PATH = OUTPUT_DIR / "trusted_full_books.json"
CACHE_PATH = OUTPUT_DIR / "polydata_profiles.json"
OUT_JSON = OUTPUT_DIR / "insider_ranks.json"
OUT_MD = ROOT / "INSIDER_RANKS.md"
KICK_NOTE_RE = re.compile(r"\bKICK\b|do not tail|not a copy", re.I)

# Same mix as Polydata Smart Score, with our two custom slots.
INSIDER_WEIGHTS = {
    "pnl_consistency": 0.22,
    "wr_quality": 0.18,
    "risk": 0.18,
    "diversification": 0.08,
    "recency": 0.22,       # Stale take-book names must not outrank HOT copyables
    "copyability": 0.12,   # Joinable size + not a grinder
}

MM_WALLETS = {
    "0xd9e0aaca471f489be338fd0c91a26e8669a805f2",
    "0xd9e0aaca471f489be338fd0f91a26e8669a805f2",
    "0x2005d16a84ceefa912d4e380cd32e7ff827875ea",  # RN1 — 3.3M fills
}
GRINDER_WR = 94.0
UNTAILABLE_MEDIAN = 50_000.0
BLOCK_COPY_ACTIONS = {"KICK", "UNTAILABLE", "GRINDER", "SKIP", "FADED"}


def _clip(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def recency_from_days(days: int | None) -> tuple[str, float]:
    if days is None:
        return "UNKNOWN", 0.5
    if days <= 7:
        return "HOT", 1.0
    if days <= 14:
        return "WARM", 0.7
    if days <= 21:
        return "COLD", 0.35
    if days <= 45:
        return "DARK", 0.1
    return "DROP", 0.0


def csv_book_flags(csv_path: Path) -> dict[str, Any]:
    empty = {
        "rows": 0,
        "closed": 0,
        "open": 0,
        "realized_pos": 0,
        "realized_neg": 0,
        "sum_dash": 0.0,
        "profit_factor": None,
        "winner_capped": False,
        "book_note": "missing_csv",
        "last_end_date": None,
        "csv_wr": None,
    }
    if not csv_path.exists():
        return empty
    try:
        cols = ("status", "realizedPnl", "cashPnl", "total_position_pnl", "endDate")
        df = pd.read_csv(csv_path, usecols=lambda c: c in cols, low_memory=False)
    except Exception as exc:
        empty["book_note"] = f"csv_read_error:{exc}"
        return empty
    st = df["status"].astype(str).str.lower() if "status" in df.columns else pd.Series([], dtype=str)
    closed = int((st == "closed").sum()) if len(st) else 0
    opened = int((st == "open").sum()) if len(st) else 0
    r = pd.to_numeric(df.get("realizedPnl", 0), errors="coerce").fillna(0)
    cash = pd.to_numeric(df.get("cashPnl", 0), errors="coerce").fillna(0)
    if "total_position_pnl" in df.columns:
        dash = pd.to_numeric(df["total_position_pnl"], errors="coerce").fillna(0)
    else:
        dash = r + cash
    pos = int((r > 0).sum())
    neg = int((r < 0).sum())
    wins = float(dash[dash > 0].sum())
    losses = float(abs(dash[dash < 0].sum()))
    pf = round(wins / losses, 2) if losses > 0 else (None if wins <= 0 else 99.0)
    # Exact 10k closed + almost all winners = the REALIZEDPNL DESC page cap.
    win_share = pos / max(closed, 1)
    loser_share = neg / max(closed, 1)
    winner_capped = closed == 10_000 or (
        9_500 <= closed <= 10_500 and win_share >= 0.88 and loser_share < 0.12
    )
    note = "full_book"
    if winner_capped:
        note = "winner_capped_10k"
    elif closed >= 20_000:
        note = "deep_book"
    last_end = None
    if "endDate" in df.columns and len(df):
        try:
            last_end = str(pd.to_datetime(df["endDate"], errors="coerce").max())[:10]
            if last_end in {"NaT", "nat", "None"}:
                last_end = None
        except Exception:
            last_end = None
    csv_wr = round(100.0 * pos / closed, 2) if closed else None
    return {
        "rows": int(len(df)),
        "closed": closed,
        "open": opened,
        "realized_pos": pos,
        "realized_neg": neg,
        "sum_dash": round(float(dash.sum()), 2),
        "profit_factor": pf,
        "winner_capped": winner_capped,
        "book_note": note,
        "last_end_date": last_end,
        "csv_wr": csv_wr,
    }


def wr_quality_score(wr: float) -> float:
    """Copyable sports WR lives in a 48–75 band. 94%+ grinders score 0."""
    if wr >= GRINDER_WR:
        return 0.0
    if wr < 40:
        return 12.0
    if wr < 45:
        return 35.0
    if wr < 48:
        return 70.0
    if wr <= 62:
        return 100.0
    if wr <= 75:
        return 82.0
    if wr <= 88:
        return 40.0
    return 8.0


def pnl_consistency_score(pnl: float, profitable_days: int, total_days: int) -> float:
    mag = 100.0 * (1.0 - math.exp(-abs(pnl) / 2_000_000.0))
    if pnl < 0:
        mag *= 0.25
    days = profitable_days / max(total_days, 1)
    return _clip(0.65 * mag + 0.35 * days * 100.0)


def risk_score(sharpe: float, hedge_frac: float, median_stake: float) -> float:
    sharpe_s = _clip((sharpe + 2.0) / 10.0 * 100.0)
    if hedge_frac < 0.15:
        hedge_s = 100.0
    elif hedge_frac < 0.40:
        hedge_s = 70.0
    elif hedge_frac < 0.70:
        hedge_s = 28.0
    else:
        hedge_s = 8.0
    if 10 <= median_stake <= 2_000:
        join_s = 100.0
    elif median_stake < 10_000:
        join_s = 72.0
    elif median_stake < UNTAILABLE_MEDIAN:
        join_s = 28.0
    else:
        join_s = 0.0
    return _clip(0.50 * sharpe_s + 0.30 * hedge_s + 0.20 * join_s)


def diversification_score(events: int, markets: int) -> float:
    n = max(events, markets, 1)
    return _clip(18.0 * math.log10(n + 1.0) + 8.0)


def copyability_score(
    *,
    wr: float,
    pnl: float,
    median_stake: float,
    hedge_frac: float,
    recency_band: str,
    winner_capped: bool,
    market_maker: bool,
    untailable: bool,
    health_action: str | None,
) -> tuple[float, str]:
    if market_maker:
        return 0.0, "Market maker — do not copy."
    if winner_capped:
        return 0.0, "Closed book still winner-capped at 10k — not copyable."
    if untailable:
        return 0.0, "Untailable (size or grinder)."
    if (health_action or "").upper() in BLOCK_COPY_ACTIONS:
        return 8.0, f"Health {health_action} — not on the copy list."
    if wr >= GRINDER_WR:
        return 0.0, f"{wr:.0f}% WR grinder."
    if pnl <= 0:
        return 18.0, "Lifetime book is not profitable — tracking-site rank ≠ copy."
    if recency_band in {"DROP", "DARK"}:
        return 12.0, f"{recency_band} — too quiet to tail live."
    if median_stake >= UNTAILABLE_MEDIAN:
        return 0.0, f"Median stake ${median_stake:,.0f} — cannot join."
    if wr < 45:
        return 22.0, "Win rate too low to copy blindly."
    if hedge_frac >= 0.50:
        return 20.0, "Two-sided book (hedge share too high) — market-make, don't copy."
    score = 55.0
    if 48 <= wr <= 70:
        score += 25.0
    if 10 <= median_stake <= 5_000:
        score += 15.0
    elif median_stake > 15_000:
        score -= 20.0
    if hedge_frac > 0.40:
        score -= 15.0
    if recency_band == "HOT":
        score += 10.0
    elif recency_band == "COLD":
        score -= 15.0
    return _clip(score), "Joinable sports book." if score >= 60 else "Watch — not a default copy."


def load_health_by_wallet() -> dict[str, dict[str, Any]]:
    if not HEALTH_PATH.exists():
        return {}
    try:
        data = json.loads(HEALTH_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in data.get("traders") or []:
        w = str(row.get("wallet") or "").lower()
        if w:
            out[w] = row
    return out


def load_take_book() -> dict[str, dict[str, Any]]:
    """Trusted 12 from take_book_daily / asof consensus — source of truth for copyable."""
    if not TRUSTED_PATH.exists():
        return {}
    try:
        data = json.loads(TRUSTED_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[insider-ranks] could not read trusted_full_books.json: {exc}")
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in data.get("trusted") or []:
        if not isinstance(row, dict):
            continue
        w = str(row.get("wallet") or "").strip().lower()
        if w:
            out[w] = row
    return out


def load_extra_meta() -> dict[str, dict[str, Any]]:
    if not EXTRA_TRADERS_PATH.exists():
        return {}
    try:
        data = json.loads(EXTRA_TRADERS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(data, list):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in data:
        if not isinstance(row, dict):
            continue
        w = str(row.get("wallet") or "").strip().lower()
        if w:
            out[w] = row
    return out


def window_snapshot(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or not raw:
        return None
    n = raw.get("n")
    try:
        n_i = int(n) if n is not None else None
    except (TypeError, ValueError):
        n_i = None
    return {
        "n": n_i,
        "pnl": raw.get("pnl"),
        "wr": raw.get("win_rate"),
        "roi": raw.get("roi"),
        "first": raw.get("first"),
        "last": raw.get("last"),
    }


def book_accuracy(
    our_wr: float | None,
    our_pnl: float | None,
    pd_wr: float | None,
    pd_pnl: float | None,
) -> dict[str, Any]:
    wr_delta = None
    if our_wr is not None and pd_wr is not None:
        wr_delta = round(float(our_wr) - float(pd_wr), 2)
    gap = polydata_gap(
        float(our_pnl or 0),
        float(pd_pnl) if isinstance(pd_pnl, (int, float)) else None,
    )
    wr_ok = wr_delta is not None and abs(wr_delta) <= 6.0
    matched = bool(wr_ok and not gap["flag"] and pd_wr is not None)
    if pd_wr is None and pd_pnl is None:
        note = "no_polydata"
    elif matched:
        note = "matched"
    elif not wr_ok and wr_delta is not None:
        note = "wr_gap"
    else:
        note = str(gap.get("note") or "gap")
    return {
        "wr_delta_pp": wr_delta,
        "pnl_ratio": gap.get("ratio"),
        "matched": matched,
        "note": note,
    }


def classify_lane(
    *,
    on_roster: bool,
    take_book: bool,
    health_action: str | None,
    extra_status: str | None,
    extra_notes: str | None,
    score_source: str,
) -> str:
    """Product lane. Take book always wins over a stale health KICK."""
    if take_book:
        return "take_book"
    extra = (extra_status or "").strip().lower()
    if extra in {"kicked", "kick", "grinder", "untailable"}:
        return "kicked"
    if extra_notes and KICK_NOTE_RE.search(extra_notes):
        return "kicked"
    action = (health_action or "").strip().upper()
    if action in BLOCK_COPY_ACTIONS:
        return "kicked"
    if not on_roster or score_source == "polydata_shadow":
        return "reference"
    if extra in {"watch", "calibration", "thin"}:
        return "watch"
    if action in {"WATCH", "TIGHTEN", "OVERLAY"}:
        return "watch"
    return "roster"


def load_analysis(wallet: str, username: str) -> dict[str, Any] | None:
    path = json_path_for(wallet, username)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def polydata_gap(our_pnl: float, pd_pnl: float | None) -> dict[str, Any]:
    if pd_pnl is None:
        return {"ratio": None, "flag": False, "note": "no_polydata_pnl"}
    denom = max(abs(pd_pnl), 1.0)
    ratio = our_pnl / denom
    # Same sign and within 3x is "aligned enough" for position vs trade books.
    same_sign = (our_pnl >= 0) == (pd_pnl >= 0)
    flag = (not same_sign) or abs(ratio) > 3.0
    note = "aligned" if not flag else ("sign_mismatch" if not same_sign else "magnitude_gap")
    return {"ratio": round(ratio, 2), "flag": flag, "note": note}


def score_trader(
    wallet: str,
    username: str,
    analysis: dict[str, Any] | None,
    health: dict[str, Any] | None,
    book: dict[str, Any],
    poly: dict[str, Any] | None,
    on_roster: bool,
    take_row: dict[str, Any] | None = None,
    extra_row: dict[str, Any] | None = None,
) -> dict[str, Any]:
    a = analysis or {}
    h = health or {}
    extra = extra_row or {}
    on_take = bool(take_row)
    pd_early = poly if poly and poly.get("ok") else {}
    score_source = "our_book"
    pnl = float(a.get("dashboard_pnl") if a.get("dashboard_pnl") is not None else book.get("sum_dash") or 0)
    wr = float(a.get("win_rate") or (h.get("overall") or {}).get("win_rate") or 0)
    if wr == 0 and take_row and take_row.get("our_wr") is not None:
        wr = float(take_row["our_wr"])
    if wr == 0 and book.get("csv_wr") is not None:
        wr = float(book["csv_wr"])
    if pnl == 0 and take_row and take_row.get("our_pnl") is not None:
        pnl = float(take_row["our_pnl"])
    sharpe = float(a.get("pseudo_sharpe") or 0)
    median = float(a.get("median_market_stake") or 0)
    if not on_roster and not a and pd_early:
        score_source = "polydata_shadow"
        if pd_early.get("sports_pnl") is not None:
            pnl = float(pd_early["sports_pnl"])
        elif pd_early.get("pnl") is not None:
            pnl = float(pd_early["pnl"])
        wr = float(pd_early.get("win_rate") or wr)
        sharpe = float(pd_early.get("sharpe") or sharpe)
    markets = int(a.get("markets_traded") or 0)
    events = int(a.get("total_events") or markets)
    if markets == 0:
        markets = int(book.get("closed") or 0)
        events = max(events, markets)
    hedge_risk = float(a.get("hedge_risk") or 0)
    total_risked = float(a.get("total_risked") or 0)
    hedge_frac = hedge_risk / max(hedge_risk + total_risked, 1.0)
    days_since = a.get("days_since_last_event")
    if days_since is None:
        days_since = h.get("days_since_last")
    try:
        days_since_i = int(days_since) if days_since is not None else None
    except (TypeError, ValueError):
        days_since_i = None
    if days_since_i is not None and days_since_i < 0:
        days_since_i = 0
    last_event_early = a.get("last_event_date") or h.get("max_date") or book.get("last_end_date")
    if days_since_i is None and last_event_early:
        try:
            last_dt = datetime.fromisoformat(str(last_event_early)[:10]).replace(tzinfo=timezone.utc)
            days_since_i = max(0, int((AS_OF - last_dt).total_seconds() // 86400))
        except (TypeError, ValueError):
            pass
    recency_band = str(h.get("recency_band") or recency_from_days(days_since_i)[0])
    live_weight = float(h.get("live_weight") if h.get("live_weight") is not None else recency_from_days(days_since_i)[1])
    pd_trades = int(pd_early.get("trades") or 0)
    try:
        tpd = float(pd_early.get("trades_per_day") or 0)
    except (TypeError, ValueError):
        tpd = 0.0
    bot_class = str(pd_early.get("bot_class") or "").upper()
    market_maker = (
        wallet.lower() in MM_WALLETS
        or pd_trades >= 100_000
        or tpd >= 400
        or bot_class == "BOT"
    )
    untailable = bool(h.get("untailable") or market_maker)
    winner_capped = bool(book.get("winner_capped"))
    health_action = str(h.get("action") or "") or None
    extra_status = str(extra.get("status") or "") or None
    extra_notes = str(extra.get("notes") or "") or None

    pnl_s = pnl_consistency_score(
        pnl,
        int(a.get("profitable_days") or 0),
        int(a.get("total_days") or 0),
    )
    wr_s = wr_quality_score(wr)
    risk_s = risk_score(sharpe, hedge_frac, median)
    div_s = diversification_score(events, markets)
    recency_s = _clip(live_weight * 100.0)
    copy_s, copy_note = copyability_score(
        wr=wr,
        pnl=pnl,
        median_stake=median,
        hedge_frac=hedge_frac,
        recency_band=recency_band,
        winner_capped=winner_capped,
        market_maker=market_maker,
        untailable=untailable,
        health_action=health_action,
    )
    if winner_capped:
        pnl_s = min(pnl_s, 20.0)
        wr_s = min(wr_s, 25.0)
    if score_source == "polydata_shadow":
        copy_s = min(copy_s, 35.0)
        copy_note = "Reference only — we do not have this full book yet."

    lane = classify_lane(
        on_roster=on_roster,
        take_book=on_take,
        health_action=health_action,
        extra_status=extra_status,
        extra_notes=extra_notes,
        score_source=score_source,
    )
    copyable = lane == "take_book"
    if copyable:
        take_reason = str((take_row or {}).get("reason") or "").strip()
        if recency_band in {"DROP", "DARK"}:
            copy_s = min(copy_s, 22.0)
            copy_note = (
                take_reason
                or "Historical take-book name, but too quiet to tail live."
            )
        else:
            copy_s = max(copy_s, 80.0)
            copy_note = take_reason or "On the live take book (matched sports books)."
        if health_action and health_action.upper() in BLOCK_COPY_ACTIONS:
            copy_note += (
                f" Health still flags {health_action} on hold-to-res — "
                "the as-of take book is the copy list."
            )
    elif lane == "kicked":
        copy_s = min(copy_s, 12.0)
        if extra_notes:
            copy_note = extra_notes
        elif health_action:
            copy_note = f"Removed from copy list ({health_action})."
    elif lane == "watch":
        copy_note = extra_notes or copy_note or "Watch — not on the take book."
    elif lane == "reference":
        copy_note = "Polydata reference only — no full book on our roster."

    components = {
        "pnl_consistency": round(pnl_s, 1),
        "wr_quality": round(wr_s, 1),
        "risk": round(risk_s, 1),
        "diversification": round(div_s, 1),
        "recency": round(recency_s, 1),
        "copyability": round(copy_s, 1),
    }
    insider = 0.0
    for key, weight in INSIDER_WEIGHTS.items():
        insider += components[key] * weight
    insider = round(_clip(insider), 1)

    pd = poly if poly and poly.get("ok") else {}
    if take_row and not pd.get("win_rate"):
        pd = {
            **pd,
            "ok": bool(pd.get("ok") or take_row.get("pd_wr") is not None),
            "url": pd.get("url") or f"https://polydata.pro/traders/{username}",
            "win_rate": pd.get("win_rate") if pd.get("win_rate") is not None else take_row.get("pd_wr"),
            "pnl": pd.get("pnl") if pd.get("pnl") is not None else take_row.get("pd_pnl"),
            "smart_score": pd.get("smart_score") if pd.get("smart_score") is not None else take_row.get("smart_score"),
            "sports_rank": pd.get("sports_rank") if pd.get("sports_rank") is not None else take_row.get("sports_rank"),
            "sports_pnl": pd.get("sports_pnl") if pd.get("sports_pnl") is not None else take_row.get("sports_pnl"),
        }
    gap = polydata_gap(pnl, pd.get("pnl") if isinstance(pd.get("pnl"), (int, float)) else None)
    accuracy = book_accuracy(
        wr,
        pnl,
        float(pd["win_rate"]) if isinstance(pd.get("win_rate"), (int, float)) else None,
        float(pd["pnl"]) if isinstance(pd.get("pnl"), (int, float)) else None,
    )
    if insider >= 80:
        badge = "Elite"
    elif insider >= 60:
        badge = "Diamond"
    elif insider >= 40:
        badge = "Gold"
    else:
        badge = "Standard"

    last_30 = a.get("last_30d") or h.get("last_30d") or {}
    last_60 = a.get("last_60d") or h.get("last_60d") or {}
    last_90 = a.get("last_90d") or h.get("last_90d") or {}
    overall_h = h.get("overall") if isinstance(h.get("overall"), dict) else {}
    roi = a.get("overall_roi")
    if roi is None:
        roi = overall_h.get("roi")
    last_event = a.get("last_event_date") or h.get("max_date") or overall_h.get("last") or book.get("last_end_date")
    return {
        "username": username,
        "wallet": wallet.lower(),
        "on_roster": on_roster,
        "lane": lane,
        "take_book": on_take,
        "copy_bucket": None,
        "score_source": score_source,
        "insider_score": insider,
        "badge": badge,
        "copyable": copyable,
        "copy_note": copy_note,
        "recency_band": recency_band,
        "live_weight": live_weight,
        "days_since_last": days_since_i,
        "polymarket_url": f"https://polymarket.com/profile/{wallet.lower()}",
        "our": {
            "dashboard_pnl": round(pnl, 2),
            "roi": roi,
            "win_rate": round(wr, 2),
            "sharpe": sharpe,
            "profit_factor": book.get("profit_factor"),
            "median_stake": round(median, 2),
            "markets": markets,
            "events": events,
            "hedge_frac": round(hedge_frac, 3),
            "last_30d_pnl": last_30.get("pnl"),
            "last_30d_wr": last_30.get("win_rate"),
            "last_30d_roi": last_30.get("roi"),
            "last_30d_n": last_30.get("n"),
            "last_60d_pnl": last_60.get("pnl"),
            "last_60d_wr": last_60.get("win_rate"),
            "last_60d_roi": last_60.get("roi"),
            "last_60d_n": last_60.get("n"),
            "last_90d_pnl": last_90.get("pnl"),
            "last_90d_wr": last_90.get("win_rate"),
            "last_90d_roi": last_90.get("roi"),
            "last_90d_n": last_90.get("n"),
            "quality_score": a.get("quality_score"),
            "tier": a.get("tier"),
            "top_sport": a.get("top_sport"),
            "last_event_date": last_event,
        },
        "windows": {
            "last_30d": window_snapshot(last_30),
            "last_60d": window_snapshot(last_60),
            "last_90d": window_snapshot(last_90),
        },
        "book": book,
        "polydata": {
            "url": pd.get("url") or f"https://polydata.pro/traders/{username}",
            "ok": bool(pd.get("ok")),
            "error": pd.get("error"),
            "smart_score": pd.get("smart_score"),
            "win_rate": pd.get("win_rate"),
            "pnl": pd.get("pnl"),
            "trades": pd.get("trades"),
            "overall_rank": pd.get("overall_rank"),
            "sports_rank": pd.get("sports_rank"),
            "sports_pnl": pd.get("sports_pnl"),
            "sports_volume": pd.get("sports_volume"),
            "profit_factor": pd.get("profit_factor"),
            "sharpe": pd.get("sharpe"),
            "sortino": pd.get("sortino"),
            "hhi": pd.get("hhi"),
            "kelly_pct": pd.get("kelly_pct"),
            "bot_score": pd.get("bot_score"),
            "bot_class": pd.get("bot_class"),
            "trades_per_day": pd.get("trades_per_day"),
            "active_hours": pd.get("active_hours"),
        },
        "accuracy": accuracy,
        "pnl_vs_polydata": gap,
        "components": components,
        "health_action": health_action,
        "extra_status": extra_status,
        "untailable": untailable,
        "untailable_reason": h.get("untailable_reason") or "",
        "market_maker": market_maker,
        "winner_capped": winner_capped,
    }


def _md_money(v: float | None) -> str:
    if v is None:
        return "—"
    sign = "+" if v >= 0 else "−"
    return f"{sign}${abs(v):,.0f}"


def write_markdown(payload: dict[str, Any]) -> None:
    traders: list[dict[str, Any]] = payload["traders"]
    sports_board = [t for t in traders if t.get("polydata", {}).get("sports_rank")]
    sports_board.sort(key=lambda t: t["polydata"]["sports_rank"] or 9_999)
    lines = [
        "# Insider Ranks",
        "",
        f"As of **{payload['as_of']}**. Polydata is the public calibration. "
        "Our Insider Score is built on **our** full books (winners + losers + recent closed, plus opens).",
        "",
        "## Why this exists",
        "",
        "Tracking sites rank individual traders with Smart Score, win rate, profit factor, "
        "Sharpe/Sortino, HHI, Kelly, bot score, and sports-category PnL. We want the same "
        "surface — customized for copy-tailing (recency + joinability) and fed by our CSVs, "
        "not a winner-sorted 10k closed-position dump.",
        "",
        "Polydata Smart Score mix: PnL consistency 25%, WR quality 20%, risk 20%, "
        "diversification 15%, timing 10%, bot penalty 10%.",
        "",
        "Our mix: PnL consistency 22%, WR 18%, risk 18%, diversification 8%, "
        "**recency 22%**, **copyability 12%**. DROP/DARK take-book names stay in "
        "the archive filter — they do not get a live copyability boost.",
        "",
        "## Polydata Sports ranks (scraped profiles)",
        "",
        "| Sports # | Trader | Sports PnL | Smart Score | WR | PF | Sharpe | On roster |",
        "|--------:|--------|-----------:|------------:|---:|---:|-------:|:----------|",
    ]
    for t in sports_board[:25]:
        pd = t["polydata"]
        lines.append(
            f"| {pd.get('sports_rank')} | [{t['username']}]({pd.get('url')}) | "
            f"{_md_money(pd.get('sports_pnl'))} | {pd.get('smart_score') or '—'} | "
            f"{pd.get('win_rate') or '—'}% | {pd.get('profit_factor') or '—'} | "
            f"{pd.get('sharpe') or '—'} | {'yes' if t.get('on_roster') else 'no'} |"
        )
    take_book = [t for t in traders if t.get("lane") == "take_book"]
    kicked = [t for t in traders if t.get("lane") == "kicked"]
    lines += [
        "",
        "## Take book (the copy list)",
        "",
        "Copyable = the 12 matched sports books in `trusted_full_books.json`. "
        "Health KICK on hold-to-res does **not** remove a take-book name.",
        "",
        "| Trader | Recency | Last | Our PnL | Our WR | PD WR | ΔWR | Accuracy | Closed |",
        "|--------|---------|------|--------:|-------:|------:|----:|----------|-------:|",
    ]
    for t in take_book:
        our = t["our"]
        pd = t["polydata"]
        acc = t.get("accuracy") or {}
        wr_d = acc.get("wr_delta_pp")
        wr_d_s = f"{wr_d:+.1f}" if isinstance(wr_d, (int, float)) else "—"
        lines.append(
            f"| {t['username']} | {t.get('recency_band')} | {our.get('last_event_date') or '—'} | "
            f"{_md_money(our.get('dashboard_pnl'))} | {our.get('win_rate')}% | "
            f"{pd.get('win_rate') or '—'}% | {wr_d_s} | {acc.get('note')} | "
            f"{t.get('book', {}).get('closed', 0)} |"
        )
    lines += [
        "",
        f"**Take book ({len(take_book)}):** "
        + (", ".join(t["username"] for t in take_book) or "none"),
        "",
        f"**Kicked / do-not-copy ({len(kicked)}):** "
        + (", ".join(t["username"] for t in kicked[:30]) or "none"),
        "",
        "## Notes",
        "",
        "- ROI/PnL come from our CSVs (`dashboard_pnl` = realized + cash on the full book).",
        "- Accuracy `matched` = our WR within 6pp of Polydata and PnL same sign / within 3x.",
        "- Kicked names stay in the file so the UI can show what we removed.",
        "- swisstony is Sports #1 on Polydata and is listed as reference-only until we ingest a full book.",
        "",
    ]
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _load_profiles(names: list[str], offline: bool) -> dict[str, Any]:
    cached: dict[str, Any] = {}
    if CACHE_PATH.exists():
        try:
            cached = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        except Exception:
            cached = {}
    if offline and cached:
        print(f"[insider-ranks] using cached Polydata profiles {CACHE_PATH}")
        return cached
    try:
        print(f"[insider-ranks] scraping {len(names)} Polydata profiles…")
        profiles = scrape_polydata_profiles(names)
        CACHE_PATH.write_text(json.dumps(profiles, indent=2, default=str), encoding="utf-8")
        return profiles
    except Exception as exc:
        print(f"[insider-ranks] Polydata scrape failed ({exc}); using cache")
        if cached:
            return cached
        return {}


def main() -> int:
    roster = roster_traders()
    health_map = load_health_by_wallet()
    take_book = load_take_book()
    extra_meta = load_extra_meta()
    names = [u for _, u in roster] + list(REFERENCE_USERNAMES)
    offline = "--offline" in sys.argv
    profiles = _load_profiles(names, offline)
    by_wallet: dict[str, dict[str, Any]] = {}
    for row in profiles.values():
        if isinstance(row, dict) and row.get("wallet"):
            by_wallet[str(row["wallet"]).lower()] = row

    traders: list[dict[str, Any]] = []
    roster_set = {w.lower() for w, _ in roster}
    for wallet, username in roster:
        w = wallet.lower()
        analysis = load_analysis(wallet, username)
        book = csv_book_flags(csv_path_for(wallet, username))
        poly = profiles.get(username.lower()) or by_wallet.get(w)
        traders.append(
            score_trader(
                wallet, username, analysis, health_map.get(w),
                book, poly, on_roster=True,
                take_row=take_book.get(w),
                extra_row=extra_meta.get(w),
            )
        )

    for ref in REFERENCE_USERNAMES:
        poly = profiles.get(ref.lower()) or {}
        wallet = str(poly.get("wallet") or "").lower()
        if wallet and wallet in roster_set:
            continue
        if not wallet:
            wallet = f"polydata-ref-{ref.lower()}"
        traders.append(
            score_trader(
                wallet, ref, None, None,
                {
                    "rows": 0, "closed": 0, "open": 0, "realized_pos": 0, "realized_neg": 0,
                    "sum_dash": 0.0, "profit_factor": None, "winner_capped": False,
                    "book_note": "reference_only_no_csv",
                },
                poly, on_roster=False,
                take_row=take_book.get(wallet),
                extra_row=extra_meta.get(wallet),
            )
        )

    traders.sort(
        key=lambda t: (
            0 if t.get("lane") == "take_book" else 1,
            -float(t["insider_score"]),
            t["username"].lower(),
        )
    )
    for i, t in enumerate(traders, 1):
        t["insider_rank"] = i

    copy_buckets: dict[str, str] = {}
    uni_path = OUTPUT_DIR / "copy_universe.json"
    if uni_path.exists():
        try:
            uni = json.loads(uni_path.read_text(encoding="utf-8"))
            for key in ("live", "bench", "watch", "kicked", "skip"):
                for row in uni.get(key) or []:
                    if isinstance(row, dict) and row.get("wallet"):
                        copy_buckets[str(row["wallet"]).lower()] = key
        except Exception:
            copy_buckets = {}
    for t in traders:
        t["copy_bucket"] = copy_buckets.get(str(t.get("wallet") or "").lower())

    sports = [t for t in traders if t.get("polydata", {}).get("sports_rank")]
    sports.sort(key=lambda t: t["polydata"]["sports_rank"] or 9_999)
    lane_counts = {
        "take_book": sum(1 for t in traders if t.get("lane") == "take_book"),
        "watch": sum(1 for t in traders if t.get("lane") == "watch"),
        "kicked": sum(1 for t in traders if t.get("lane") == "kicked"),
        "roster": sum(1 for t in traders if t.get("lane") == "roster"),
        "reference": sum(1 for t in traders if t.get("lane") == "reference"),
    }
    matched = sum(1 for t in traders if (t.get("accuracy") or {}).get("matched"))
    payload = {
        "generated_at": AS_OF.isoformat(),
        "as_of": AS_OF.date().isoformat(),
        "method": (
            "Insider Score from our full closed+open CSVs. Take-book 12 is the "
            "historical as-of backtest set (Capman, kch123…). Live copy is the "
            "$100 joinable subset (unique ROI ≥5%, ≥8 prints in 30d, median <$15k). "
            "Polydata Smart Score / 3M-fill bots (RN1) are not $100 copy."
        ),
        "weights": INSIDER_WEIGHTS,
        "polydata_weights": POLYDATA_SMART_SCORE_WEIGHTS,
        "take_book_wallets": sorted(take_book.keys()),
        "counts": {
            "roster": len(roster),
            "scored": len(traders),
            "copyable": sum(1 for t in traders if t.get("copyable")),
            "take_book": lane_counts["take_book"],
            "watch": lane_counts["watch"],
            "kicked": lane_counts["kicked"],
            "reference": lane_counts["reference"],
            "live_copy": sum(1 for t in traders if t.get("copy_bucket") == "live"),
            "bench": sum(1 for t in traders if t.get("copy_bucket") == "bench"),
            "polydata_ok": sum(1 for t in traders if t.get("polydata", {}).get("ok")),
            "accuracy_matched": matched,
            "winner_capped": sum(1 for t in traders if t.get("winner_capped")),
            "polydata_sports_ranked": len(sports),
        },
        "polydata_sports_board": [
            {
                "username": t["username"],
                "wallet": t["wallet"],
                "on_roster": t["on_roster"],
                "lane": t.get("lane"),
                "sports_rank": t["polydata"].get("sports_rank"),
                "sports_pnl": t["polydata"].get("sports_pnl"),
                "smart_score": t["polydata"].get("smart_score"),
                "win_rate": t["polydata"].get("win_rate"),
                "profit_factor": t["polydata"].get("profit_factor"),
                "insider_score": t["insider_score"],
                "copyable": t["copyable"],
            }
            for t in sports[:30]
        ],
        "traders": traders,
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    write_markdown(payload)
    print(f"[insider-ranks] wrote {OUT_JSON} and {OUT_MD}")
    print(
        f"  take_book={lane_counts['take_book']} kicked={lane_counts['kicked']} "
        f"watch={lane_counts['watch']} matched={matched} "
        f"polydata_ok={payload['counts']['polydata_ok']}"
    )
    missing = [w[:10] for w in take_book if not any(t["wallet"] == w for t in traders)]
    if missing:
        print(f"  WARNING take-book wallets not scored: {missing}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
