#!/usr/bin/env python3
"""Equity regime / turnaround detector from unique-book monthly PnL.

Used by auto-promote. Unique closed+open books are truth — not Polydata
month curves and not invented fills.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from run_full_pipeline import OUTPUT_DIR, csv_path_for


def _f(v: Any) -> float | None:
    try:
        if v is None:
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def load_analysis(wallet: str, username: str) -> dict[str, Any] | None:
    csv_p = csv_path_for(wallet, username)
    json_p = csv_p.with_suffix(".json")
    if not json_p.exists():
        w = wallet.lower().replace("0x", "")[:6]
        hits = list(OUTPUT_DIR.glob(f"*_{w}*.json"))
        if not hits:
            hits = list(OUTPUT_DIR.glob(f"{username}_*.json"))
        if not hits:
            return None
        json_p = hits[0]
    try:
        return json.loads(json_p.read_text(encoding="utf-8"))
    except Exception:
        return None


def detect_regime(analysis: dict[str, Any] | None) -> dict[str, Any]:
    """Classify equity path: turnaround | hot | stable | bleeding | thin."""
    empty = {
        "regime": "thin",
        "score": 0.0,
        "last_30d_roi": None,
        "last_30d_n": 0,
        "lifetime_roi": None,
        "red_months_before": 0,
        "green_streak": 0,
        "latest_month_pnl": None,
        "monthly_tail": {},
        "why": "no analysis json",
    }
    if not analysis:
        return empty
    life = _f(analysis.get("overall_roi"))
    last30 = analysis.get("last_30d") or {}
    l30_roi = _f(last30.get("roi"))
    try:
        l30_n = int(last30.get("n") or 0)
    except (TypeError, ValueError):
        l30_n = 0
    monthly = analysis.get("monthly_pnl") or {}
    if not isinstance(monthly, dict):
        monthly = {}
    months = sorted(monthly.keys())
    vals = [_f(monthly[m]) or 0.0 for m in months]
    latest = vals[-1] if vals else None
    green_streak = 0
    for v in reversed(vals):
        if v > 0:
            green_streak += 1
        else:
            break
    red_before = 0
    if green_streak > 0 and len(vals) > green_streak:
        for v in reversed(vals[: -green_streak]):
            if v < 0:
                red_before += 1
            else:
                break

    why_parts: list[str] = []
    regime = "stable"
    score = 40.0

    if l30_n < 8:
        regime = "thin"
        score = 10.0
        why_parts.append(f"last30 n={l30_n}<8")
    elif l30_roi is not None and l30_roi <= -8:
        regime = "bleeding"
        score = 5.0
        why_parts.append(f"last30 ROI {l30_roi}%")
    elif (
        red_before >= 2
        and green_streak >= 1
        and l30_roi is not None
        and l30_roi >= 8
        and l30_n >= 30
        and (life is None or life < 8)
    ):
        regime = "turnaround"
        score = 85.0 + min(l30_roi, 20.0)
        why_parts.append(
            f"{red_before} red months → {green_streak} green; last30 {l30_roi}% n={l30_n}"
        )
    elif l30_roi is not None and l30_roi >= 10 and l30_n >= 20:
        regime = "hot"
        score = 70.0 + min(l30_roi / 2, 15)
        why_parts.append(f"hot last30 {l30_roi}% n={l30_n}")
    elif life is not None and life >= 5 and (l30_roi is None or l30_roi > -5):
        regime = "stable"
        score = 55.0 + min(life, 20)
        why_parts.append(f"stable lifetime ROI {life}%")
    elif life is not None and life < 0 and (l30_roi is None or l30_roi < 5):
        regime = "bleeding"
        score = 15.0
        why_parts.append(f"lifetime {life}% and no hot 30d")
    else:
        why_parts.append(f"lifetime {life}% last30 {l30_roi}%")

    return {
        "regime": regime,
        "score": round(score, 1),
        "last_30d_roi": l30_roi,
        "last_30d_n": l30_n,
        "lifetime_roi": life,
        "red_months_before": red_before,
        "green_streak": green_streak,
        "latest_month_pnl": round(latest, 2) if latest is not None else None,
        "monthly_tail": {m: round(float(monthly[m]), 2) for m in months[-6:]},
        "why": "; ".join(why_parts) if why_parts else "—",
    }


def regime_for_trader(wallet: str, username: str) -> dict[str, Any]:
    return detect_regime(load_analysis(wallet, username))


def equity_points_from_monthly(monthly: dict[str, Any]) -> list[dict[str, Any]]:
    """Cumulative unique-book monthly PnL for a sparkline. Missing months stay missing."""
    if not isinstance(monthly, dict) or not monthly:
        return []
    running = 0.0
    out: list[dict[str, Any]] = []
    for month in sorted(monthly.keys()):
        val = _f(monthly[month])
        if val is None:
            continue
        running += val
        out.append({"t": str(month), "pnl": round(val, 2), "equity": round(running, 2)})
    return out
