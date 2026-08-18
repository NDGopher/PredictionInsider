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
from run_full_pipeline import OUTPUT_DIR, csv_path_for, json_path_for, roster_traders  # noqa: E402

AS_OF = datetime.now(timezone.utc)
ROOT = Path(__file__).resolve().parent
HEALTH_PATH = OUTPUT_DIR / "trader_health.json"
CACHE_PATH = OUTPUT_DIR / "polydata_profiles.json"
OUT_JSON = OUTPUT_DIR / "insider_ranks.json"
OUT_MD = ROOT / "INSIDER_RANKS.md"

# Same mix as Polydata Smart Score, with our two custom slots.
INSIDER_WEIGHTS = {
    "pnl_consistency": 0.25,
    "wr_quality": 0.20,
    "risk": 0.20,
    "diversification": 0.15,
    "recency": 0.10,       # Polydata "timing & execution"
    "copyability": 0.10,   # Polydata "bot penalty" — we score joinability instead
}

MM_WALLETS = {
    "0xd9e0aaca471f489be338fd0c91a26e8669a805f2",
    "0xd9e0aaca471f489be338fd0f91a26e8669a805f2",
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
    }
    if not csv_path.exists():
        return empty
    try:
        cols = ("status", "realizedPnl", "cashPnl", "total_position_pnl")
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
) -> dict[str, Any]:
    a = analysis or {}
    h = health or {}
    pd_early = poly if poly and poly.get("ok") else {}
    score_source = "our_book"
    pnl = float(a.get("dashboard_pnl") if a.get("dashboard_pnl") is not None else book.get("sum_dash") or 0)
    wr = float(a.get("win_rate") or (h.get("overall") or {}).get("win_rate") or 0)
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
    recency_band = str(h.get("recency_band") or recency_from_days(days_since_i)[0])
    live_weight = float(h.get("live_weight") if h.get("live_weight") is not None else recency_from_days(days_since_i)[1])
    market_maker = wallet.lower() in MM_WALLETS
    untailable = bool(h.get("untailable") or market_maker)
    winner_capped = bool(book.get("winner_capped"))

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
        health_action=str(h.get("action") or "") or None,
    )
    if winner_capped:
        pnl_s = min(pnl_s, 20.0)
        wr_s = min(wr_s, 25.0)
    if score_source == "polydata_shadow":
        copy_s = min(copy_s, 35.0)
        copy_note = "Reference only — we do not have this full book yet."

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
    gap = polydata_gap(pnl, pd.get("pnl") if isinstance(pd.get("pnl"), (int, float)) else None)
    copyable = (
        copy_s >= 60
        and not winner_capped
        and not market_maker
        and recency_band in {"HOT", "WARM"}
        and wr < GRINDER_WR
        and 45 <= wr <= 75
        and median < UNTAILABLE_MEDIAN
        and pnl > 0
        and hedge_frac < 0.50
        and (h.get("action") or "").upper() not in BLOCK_COPY_ACTIONS
        and score_source == "our_book"
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
    last_90 = a.get("last_90d") or h.get("last_90d") or {}
    return {
        "username": username,
        "wallet": wallet.lower(),
        "on_roster": on_roster,
        "score_source": score_source,
        "insider_score": insider,
        "badge": badge,
        "copyable": copyable,
        "copy_note": copy_note,
        "recency_band": recency_band,
        "live_weight": live_weight,
        "days_since_last": days_since_i,
        "our": {
            "dashboard_pnl": round(pnl, 2),
            "roi": a.get("overall_roi"),
            "win_rate": round(wr, 2),
            "sharpe": sharpe,
            "profit_factor": book.get("profit_factor"),
            "median_stake": round(median, 2),
            "markets": markets,
            "events": events,
            "hedge_frac": round(hedge_frac, 3),
            "last_30d_pnl": last_30.get("pnl"),
            "last_30d_wr": last_30.get("win_rate"),
            "last_90d_pnl": last_90.get("pnl"),
            "last_90d_wr": last_90.get("win_rate"),
            "quality_score": a.get("quality_score"),
            "tier": a.get("tier"),
            "top_sport": a.get("top_sport"),
            "last_event_date": a.get("last_event_date") or h.get("max_date"),
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
        "pnl_vs_polydata": gap,
        "components": components,
        "health_action": h.get("action"),
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
    copyable = [t for t in traders if t.get("copyable")]
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
        "Our mix: same first four slots, then **recency 10%** and **copyability 10%**.",
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
    lines += [
        "",
        "## Our Insider Score (copy product)",
        "",
        "| Rank | Trader | Score | Recency | Copy? | Our PnL | Our WR | PD sports # | PD SS | Gap | Book |",
        "|-----:|--------|------:|---------|-------|--------:|-------:|------------:|------:|-----|------|",
    ]
    shown = 0
    for t in traders:
        if not t.get("on_roster") and not t.get("copyable"):
            sr = t.get("polydata", {}).get("sports_rank")
            if not (isinstance(sr, int) and sr <= 10):
                continue
        our = t["our"]
        pd = t["polydata"]
        gap = t.get("pnl_vs_polydata") or {}
        copy = "yes" if t.get("copyable") else "no"
        src = "" if t.get("score_source") == "our_book" else " (PD shadow)"
        lines.append(
            f"| {t.get('insider_rank')} | {t['username']}{src} | {t['insider_score']:.1f} | "
            f"{t.get('recency_band')} | {copy} | "
            f"{_md_money(our.get('dashboard_pnl'))} | {our.get('win_rate')}% | "
            f"{pd.get('sports_rank') or '—'} | {pd.get('smart_score') or '—'} | "
            f"{gap.get('note')} | {t.get('book', {}).get('book_note')} |"
        )
        shown += 1
        if shown >= 40:
            break
    lines += [
        "",
        f"**Copyable now ({len(copyable)}):** "
        + (", ".join(t["username"] for t in copyable[:20]) or "none"),
        "",
        "## Notes",
        "",
        "- ROI/PnL in this file come from our CSVs (`dashboard_pnl` = realized + cash on the full book).",
        "- A large `pnl_vs_polydata` gap usually means trade-level vs position-level books, not a scrape bug.",
        "- `winner_capped` names are scored but **not copyable** until loser+recent closed fetches land.",
        "- swisstony is Sports #1 on Polydata and is listed as reference-only until we ingest a full book.",
        "",
    ]
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    roster = roster_traders()
    health_map = load_health_by_wallet()
    names = [u for _, u in roster] + list(REFERENCE_USERNAMES)
    offline = "--offline" in sys.argv
    if offline and CACHE_PATH.exists():
        print(f"[insider-ranks] using cached Polydata profiles {CACHE_PATH}")
        profiles = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    else:
        print(f"[insider-ranks] scraping {len(names)} Polydata profiles…")
        profiles = scrape_polydata_profiles(names)
        CACHE_PATH.write_text(json.dumps(profiles, indent=2, default=str), encoding="utf-8")

    traders: list[dict[str, Any]] = []
    roster_set = {w.lower() for w, _ in roster}
    for wallet, username in roster:
        analysis = load_analysis(wallet, username)
        book = csv_book_flags(csv_path_for(wallet, username))
        poly = profiles.get(username.lower())
        traders.append(
            score_trader(
                wallet, username, analysis, health_map.get(wallet.lower()),
                book, poly, on_roster=True,
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
            )
        )

    traders.sort(key=lambda t: (-float(t["insider_score"]), t["username"].lower()))
    for i, t in enumerate(traders, 1):
        t["insider_rank"] = i

    sports = [t for t in traders if t.get("polydata", {}).get("sports_rank")]
    sports.sort(key=lambda t: t["polydata"]["sports_rank"] or 9_999)
    payload = {
        "generated_at": AS_OF.isoformat(),
        "as_of": AS_OF.date().isoformat(),
        "method": (
            "Insider Score from our full closed+open CSVs. Polydata HTML profiles are a "
            "calibration reference (Smart Score, WR, PF, Sharpe/Sortino/HHI/Kelly, sports rank). "
            "Not used as product PnL."
        ),
        "weights": INSIDER_WEIGHTS,
        "polydata_weights": POLYDATA_SMART_SCORE_WEIGHTS,
        "counts": {
            "roster": len(roster),
            "scored": len(traders),
            "copyable": sum(1 for t in traders if t.get("copyable")),
            "polydata_ok": sum(1 for t in traders if t.get("polydata", {}).get("ok")),
            "winner_capped": sum(1 for t in traders if t.get("winner_capped")),
            "polydata_sports_ranked": len(sports),
        },
        "polydata_sports_board": [
            {
                "username": t["username"],
                "wallet": t["wallet"],
                "on_roster": t["on_roster"],
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
    print(f"  copyable={payload['counts']['copyable']} polydata_ok={payload['counts']['polydata_ok']} "
          f"winner_capped={payload['counts']['winner_capped']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
