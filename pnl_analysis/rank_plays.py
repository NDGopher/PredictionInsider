#!/usr/bin/env python3
"""Rank every open book/play — OddsJam-style board, not just TAKE/NEAR/SKIP pills.

Score = edge + Q + size + sport ROI + fillability.
Does not invent fills or PnL. Unfillable / NFL / futures still rank, with why.

Usage:
  python pnl_analysis/rank_plays.py
"""
from __future__ import annotations

from typing import Any

TAKE_PRICE_LO = 0.10
TAKE_PRICE_HI = 0.88

# Documented weights — keep in sync with server/rankPlays.ts
WEIGHTS = {
    "edge_per_cent": 4.0,  # 10¢ under cap → +40; 5¢ over → −20 (clamped)
    "edge_min": -20.0,
    "edge_max": 40.0,
    "q": 0.25,  # Q 80 → +20
    "size_per_x": 8.0,  # 2× → +16; cap 4× → +32
    "size_cap_x": 4.0,
    "sport_roi": 0.4,  # +25% → +10; clamp −10..+20
    "sport_roi_min": -10.0,
    "sport_roi_max": 20.0,
    "fillable": 20.0,  # fully fillable inside 10–88 and under cap
    "fillable_band": 8.0,  # inside 10–88 but over cap
}


def _f(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        n = float(v)
        return n if n == n else None  # NaN
    except (TypeError, ValueError):
        return None


def _lane(play: dict[str, Any]) -> str:
    raw = str(play.get("take_lane") or play.get("takeLane") or "").upper()
    if raw in {"TAKE", "NEAR", "SKIP"}:
        return raw
    take = bool(play.get("take") and play.get("valid", True))
    if take:
        return "TAKE"
    misses = play.get("misses") or []
    n = len(misses) if isinstance(misses, list) else 0
    if play.get("close") or 0 < n <= 2:
        return "NEAR"
    return "SKIP"


def fillability(play: dict[str, Any]) -> tuple[float, bool, str]:
    """0–1 fillability. Full credit only when 10–88¢ and live ask ≤ take cap."""
    ask = _f(play.get("live_ask") if play.get("live_ask") is not None else play.get("liveAsk"))
    if ask is None:
        ask = _f(play.get("current_price") if play.get("current_price") is not None else play.get("currentPrice"))
    cap = _f(play.get("take_cap") if play.get("take_cap") is not None else play.get("takeCap"))
    sport = str(play.get("sport") or play.get("category") or "").lower()
    sub = str(play.get("submarket") or "").lower()
    lane = str(play.get("lane") or "").lower()
    if "nfl" in sport:
        return 0.0, False, "NFL blocked"
    if lane == "futures" or sub == "futures":
        return 0.0, False, "futures blocked"
    if ask is None or ask <= 0:
        return 0.15, False, "no live ask"
    in_band = TAKE_PRICE_LO <= ask <= TAKE_PRICE_HI
    under_cap = cap is None or ask <= cap + 0.001
    if in_band and under_cap:
        return 1.0, True, "fillable"
    if in_band:
        return 0.4, False, f"ask {ask:.3f} over cap {cap:.3f}" if cap else "over cap"
    if under_cap:
        return 0.25, False, f"ask {ask:.3f} outside 10–88¢"
    return 0.0, False, f"ask {ask:.3f} unfillable"


def edge_cents(play: dict[str, Any]) -> float:
    ask = _f(play.get("live_ask") if play.get("live_ask") is not None else play.get("liveAsk"))
    if ask is None:
        ask = _f(play.get("current_price") if play.get("current_price") is not None else play.get("currentPrice"))
    cap = _f(play.get("take_cap") if play.get("take_cap") is not None else play.get("takeCap"))
    if ask is None or cap is None:
        return 0.0
    return round((cap - ask) * 100.0, 4)


def rank_score(play: dict[str, Any]) -> tuple[float, dict[str, float]]:
    edge = edge_cents(play)
    edge_pts = max(WEIGHTS["edge_min"], min(WEIGHTS["edge_max"], edge * WEIGHTS["edge_per_cent"]))
    q = _f(play.get("q")) or 0.0
    q_pts = max(0.0, min(100.0, q)) * WEIGHTS["q"]
    rel = _f(play.get("rel")) or 0.0
    size_pts = max(0.0, min(WEIGHTS["size_cap_x"], rel)) * WEIGHTS["size_per_x"]
    roi = _f(play.get("sport_roi") if play.get("sport_roi") is not None else play.get("sportRoi"))
    roi_pts = 0.0
    if roi is not None:
        roi_pts = max(WEIGHTS["sport_roi_min"], min(WEIGHTS["sport_roi_max"], roi * WEIGHTS["sport_roi"]))
    fill_frac, _ok, _why = fillability(play)
    fill_pts = WEIGHTS["fillable"] * fill_frac if fill_frac >= 1.0 else (
        WEIGHTS["fillable_band"] * fill_frac / 0.4 if fill_frac >= 0.4 else WEIGHTS["fillable"] * fill_frac
    )
    parts = {
        "edge": round(edge_pts, 3),
        "q": round(q_pts, 3),
        "size": round(size_pts, 3),
        "sport_roi": round(roi_pts, 3),
        "fillability": round(fill_pts, 3),
    }
    return round(sum(parts.values()), 3), parts


def why_rank(play: dict[str, Any], parts: dict[str, float], *, fill_why: str) -> str:
    q = _f(play.get("q")) or 0.0
    rel = _f(play.get("rel")) or 0.0
    roi = _f(play.get("sport_roi") if play.get("sport_roi") is not None else play.get("sportRoi"))
    edge = edge_cents(play)
    bits = [
        f"Q {q:.0f}",
        f"{rel:.1f}× size",
        f"sport ROI {roi:+.0f}%" if roi is not None else "sport ROI n/a",
        f"{edge:+.1f}¢ vs cap",
        fill_why,
    ]
    top = sorted(parts.items(), key=lambda kv: kv[1], reverse=True)
    if top:
        bits.append(f"top factor {top[0][0]}")
    return " · ".join(bits)


def rank_open_plays(plays: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return a new list, rank 1 = highest score. Dedupes by id."""
    seen: set[str] = set()
    scored: list[dict[str, Any]] = []
    for i, raw in enumerate(plays):
        if not isinstance(raw, dict):
            continue
        pid = str(raw.get("id") or f"{raw.get('slug') or raw.get('title') or i}|{raw.get('side')}|{raw.get('username')}")
        if pid in seen:
            continue
        seen.add(pid)
        score, parts = rank_score(raw)
        fill_frac, fillable, fill_why = fillability(raw)
        lane = _lane(raw)
        row = {
            **raw,
            "id": pid,
            "rank_score": score,
            "rank_parts": parts,
            "edge_cents": round(edge_cents(raw), 2),
            "fillable": fillable,
            "fillability": round(fill_frac, 3),
            "take_lane": lane,
            "why_rank": why_rank(raw, parts, fill_why=fill_why),
        }
        scored.append(row)
    scored.sort(key=lambda r: (-float(r["rank_score"]), -(_f(r.get("q")) or 0), -(_f(r.get("rel")) or 0)))
    out: list[dict[str, Any]] = []
    for idx, row in enumerate(scored, 1):
        out.append({**row, "rank": idx})
    return out


def main() -> int:
    print(f"rank_plays weights={WEIGHTS}")
    demo = rank_open_plays(
        [
            {"id": "take", "q": 72, "rel": 3.1, "sport_roi": 18, "live_ask": 0.54, "take_cap": 0.56, "take": True, "valid": True},
            {"id": "near", "q": 52, "rel": 8.0, "sport_roi": 8, "live_ask": 0.87, "take_cap": 0.82, "misses": ["Q"], "close": True},
        ]
    )
    for r in demo:
        print(f"  #{r['rank']} {r['id']} score={r['rank_score']} {r['why_rank']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
