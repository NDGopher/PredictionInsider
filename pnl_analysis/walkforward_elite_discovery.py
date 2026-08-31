#!/usr/bin/env python3
"""Discovery-first Verified Elite — find Capman/HVAB-class books early.

This is NOT "pick known elites then backtest them."

At every alert time T we only use information ≤ T:
  1. Expanding unique-book equity curve (unit $100 hold-to-res)
  2. Style: sports mix, top sports/submarkets, median size, WR
  3. Activity (anti-stale) + joinability
  4. Scout → Elite graduation (early curve, then confirmed edge)
  5. Sniper trade only while Elite AND gates clear

Discovery traits we hunt (HVAB / Capman-like):
  - Smooth upward unit equity (Sharpe, R², up-day %, calmar)
  - Sports specialist (not politics grind)
  - Joinable median stake
  - Currently active (not dark/cold)
  - Young/emerging books get an early-scout path (HVAB-class)

Writes:
  pnl_analysis/output/walkforward_elite_discovery.json
  pnl_analysis/output/verified_elite_roster.json   (live product)
  pnl_analysis/VERIFIED_ELITE_DISCOVERY.md

Usage:
  python pnl_analysis/walkforward_elite_discovery.py
"""
from __future__ import annotations

import heapq
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from asof_fullbook_backtest import asof_stat, load_trusted  # noqa: E402
from copy_roster import CSV_ROWS_BOT, CLOSED_MAX_COPY, OUTPUT_DIR, ROOT, load_universe  # noqa: E402
from position_utils import play_label, sport_family  # noqa: E402
from run_full_pipeline import csv_path_for  # noqa: E402
from walkforward_consensus_backtest import (  # noqa: E402
    KNOWLEDGE_LAG,
    LIVE_HI,
    LIVE_LO,
    MIN_COST,
    MIN_LANE_ROI,
    STAKE,
    STALE_ENTRY,
    WARMUP,
    attach_event_dates,
    build_snapshots,
    classify_submarket,
    get_market_type,
    get_sport,
    lookup_snap,
    read_trader_csv,
)
from walkforward_elite_sniper import (  # noqa: E402
    ALERT_FALLBACK_HOURS,
    MEDIAN_JOIN_MAX,
    WR_HI,
    WR_HI_SPECIALIST,
    WR_LO,
    _parse_ts,
    alert_time,
    load_markets_with_entry,
    sniper_gates,
    unit_pnl,
)

OUT_JSON = OUTPUT_DIR / "walkforward_elite_discovery.json"
ROSTER_JSON = OUTPUT_DIR / "verified_elite_roster.json"
OUT_MD = ROOT / "VERIFIED_ELITE_DISCOVERY.md"

# ── Early scout (HVAB finder) ────────────────────────────────────────────────
SCOUT_MIN_N = 25                 # closed markets before we even look
SCOUT_MIN_ACTIVE_30D = 12        # must be printing
SCOUT_MIN_CURVE = 55.0           # composite 0–100 (specialty-aware)
SCOUT_MIN_UNIQUE_ROI = 5.0
SCOUT_MIN_SPORTS_FRAC = 0.55
SCOUT_EMERGING_DAYS = 150        # first→as_of window for "young book" bonus
HYSTERESIS_DAYS = 14             # min days in scout/elite before soft demote
REENTRY_COOLDOWN_DAYS = 21       # after a kick, stay out before re-scout
# Hard floors — hysteresis never protects a collapsed / negative *dollar* book
HARD_CURVE_FLOOR = 35.0
HARD_UNIQUE_ROI_FLOOR = 0.0

# ── Elite (can fire Sniper / Telegram) ───────────────────────────────────────
ELITE_MIN_TAKE_N = 12
ELITE_MIN_TAKE_ROI = 5.0
ELITE_MIN_CURVE = 60.0
ELITE_MIN_UNIQUE_ROI = 5.0
# Path B: Capman/HVAB dollar-curve confirm (unit take may lag favorites / +2¢)
ELITE_CURVE_UNIQUE_ROI = 10.0
ELITE_CURVE_SCORE = 70.0
ELITE_CURVE_TAKE_N = 12
ELITE_CURVE_TAKE_ROI_FLOOR = -8.0  # allow short take drawdown if dollar curve elite
ELITE_ALT_UNIQUE_ROI = 12.0
ELITE_ALT_UNIQUE_N = 50
ELITE_MIN_ACTIVE_30D = 8
ELITE_STALE_30D = 5
ELITE_BLEED_60D_N = 20
ELITE_BLEED_60D_ROI = -12.0
# Life-floor: only cut when *both* take-slice AND dollar curve are soft
ELITE_LIFE_FLOOR_N = 40
ELITE_LIFE_FLOOR_ROI = -5.0
ELITE_LIFE_FLOOR_SOFT_N = 55
ELITE_LIFE_FLOOR_SOFT_ROI = 0.0
SPECIALTY_MIN_N = 20
SPECIALTY_MIN_ROI = 8.0
SPECIALTY_STRONG_ROI = 12.0


def _is_sports_family(fam: str) -> bool:
    f = (fam or "").upper()
    if not f or f in {"OTHER", "POLITICS", "CRYPTO", "FINANCE"}:
        return False
    if "NFL" in f:
        return False
    return True


def curve_metrics_from_holds(
    hold_pnls: list[float],
    costs: list[float],
    end_dts: list[datetime],
) -> dict[str, float]:
    """Capman/HVAB equity shape on *their* dollar hold-to-res PnL (not flat $100)."""
    if len(hold_pnls) < 5:
        return {
            "n": float(len(hold_pnls)),
            "roi": 0.0,
            "sharpe": 0.0,
            "r2": 0.0,
            "up_day_pct": 0.0,
            "max_dd": 0.0,
            "calmar": 0.0,
            "total_pnl": 0.0,
        }
    pnls = np.asarray(hold_pnls, dtype=float)
    costs_a = np.asarray(costs, dtype=float)
    cum = np.cumsum(pnls)
    total = float(cum[-1])
    invested = float(costs_a.sum()) or 1.0
    roi = float(total / invested * 100.0)
    x = np.arange(len(cum), dtype=float)
    coef = np.polyfit(x, cum, 1)
    pred = coef[0] * x + coef[1]
    ss_res = float(((cum - pred) ** 2).sum())
    ss_tot = float(((cum - cum.mean()) ** 2).sum())
    r2 = float(1.0 - ss_res / ss_tot) if ss_tot > 1e-9 else 0.0
    r2 = max(0.0, min(1.0, r2))

    day_keys = [d.date() for d in end_dts]
    by_day = pd.Series(pnls, index=day_keys).groupby(level=0).sum()
    if len(by_day) > 1 and float(by_day.std()) > 1e-9:
        sharpe = float(by_day.mean() / by_day.std() * np.sqrt(365.0))
    else:
        sharpe = 0.0
    up_day = float((by_day > 0).mean() * 100.0)
    peak = np.maximum.accumulate(cum)
    dd = float((cum - peak).min()) if len(cum) else 0.0
    calmar = float(total / abs(dd)) if dd < -1e-6 else (10.0 if total > 0 else 0.0)
    return {
        "n": float(len(pnls)),
        "roi": round(roi, 2),
        "sharpe": round(sharpe, 2),
        "r2": round(r2, 3),
        "up_day_pct": round(up_day, 1),
        "max_dd": round(dd, 2),
        "calmar": round(calmar, 2),
        "total_pnl": round(total, 2),
    }


def curve_score(m: dict[str, float], *, emerging: bool, last30_roi: float, last30_n: int) -> float:
    """0–100: higher = more Capman/HVAB-like."""
    score = 0.0
    roi = m.get("roi") or 0.0
    sharpe = m.get("sharpe") or 0.0
    r2 = m.get("r2") or 0.0
    up = m.get("up_day_pct") or 0.0
    calmar = m.get("calmar") or 0.0

    # Edge
    if roi >= 15:
        score += 25
    elif roi >= 10:
        score += 20
    elif roi >= 5:
        score += 14
    elif roi >= 0:
        score += 6

    # Smoothness / consistency
    score += min(20.0, max(0.0, sharpe) * 8.0)
    score += min(15.0, r2 * 15.0)
    if up >= 58:
        score += 12
    elif up >= 54:
        score += 8
    elif up >= 50:
        score += 4

    # Drawdown control
    if calmar >= 3:
        score += 10
    elif calmar >= 1.5:
        score += 7
    elif calmar >= 0.8:
        score += 4

    # Recent heat (HVAB path)
    if last30_n >= 20 and last30_roi >= 10:
        score += 12
    elif last30_n >= 12 and last30_roi >= 5:
        score += 7

    if emerging and roi >= 5 and (sharpe >= 0.3 or r2 >= 0.35):
        score += 8  # young solid book bonus

    return float(min(100.0, score))


@dataclass
class StyleCard:
    top_sports: list[dict[str, Any]] = field(default_factory=list)
    top_submarkets: list[dict[str, Any]] = field(default_factory=list)
    sports_frac: float = 0.0
    median: float = 0.0
    wr: float = 0.0
    unique_roi: float = 0.0
    curve: dict[str, float] = field(default_factory=dict)
    curve_score: float = 0.0
    emerging: bool = False


@dataclass
class MemberState:
    tier: str = "none"  # none | scout | elite
    why: str = "init"
    take_n: int = 0
    take_roi: float = 0.0
    active_30d: int = 0
    style: StyleCard | None = None
    since: datetime | None = None  # when current tier started (hysteresis)
    kicked_at: datetime | None = None  # last kick → re-entry cooldown



def style_from_history(
    known_rows: list[dict[str, Any]],
    end_dts: list[datetime],
    as_of: datetime,
    first_end: datetime | None,
) -> StyleCard:
    card = StyleCard()
    if not known_rows or len(known_rows) != len(end_dts):
        # allow end_dts longer if warmup empties — align by known_rows only
        pass
    if not known_rows:
        return card
    # Align: known_rows appended with end_dts in lockstep
    n_use = min(len(known_rows), len(end_dts))
    known_rows = known_rows[:n_use]
    end_dts = end_dts[:n_use]

    sports: dict[str, dict[str, float]] = {}
    subs: dict[str, dict[str, float]] = {}
    costs: list[float] = []
    holds: list[float] = []
    wins = 0
    sports_n = 0
    sport_series: dict[str, list[tuple[datetime, float, float]]] = {}
    for i, r in enumerate(known_rows):
        cost = float(r["cost"])
        hold = float(r["hold_pnl"])
        costs.append(cost)
        holds.append(hold)
        if r["won"]:
            wins += 1
        fam = str(r.get("sport_family") or "")
        sport = str(r.get("sport") or "")
        sub = str(r.get("submarket") or "")
        if _is_sports_family(fam):
            sports_n += 1
        for store, key in ((sports, sport), (subs, f"{sport}|{sub}")):
            lane = store.setdefault(key, {"n": 0.0, "pnl": 0.0, "cost": 0.0})
            lane["n"] += 1
            lane["pnl"] += hold
            lane["cost"] += cost
        if _is_sports_family(fam):
            sport_series.setdefault(sport, []).append((end_dts[i], hold, cost))

    n = len(known_rows)
    card.wr = 100.0 * wins / n
    card.sports_frac = sports_n / n
    big = [c for c in costs if c >= 200]
    card.median = float(np.median(big if len(big) >= 10 else costs)) if costs else 0.0
    total_cost = sum(costs) or 1.0
    card.unique_roi = 100.0 * sum(holds) / total_cost

    def _top(store: dict[str, dict[str, float]], k: int = 3) -> list[dict[str, Any]]:
        rows = []
        for key, lane in store.items():
            if lane["n"] < 5:
                continue
            roi = 100.0 * lane["pnl"] / lane["cost"] if lane["cost"] else 0.0
            rows.append({"key": key, "n": int(lane["n"]), "roi": round(roi, 1)})
        rows.sort(key=lambda x: (-x["n"], -x["roi"]))
        return rows[:k]

    card.top_sports = _top(sports)
    card.top_submarkets = _top(subs)
    overall = curve_metrics_from_holds(holds, costs, end_dts)
    best_spec = overall
    best_name = None
    for sport, pairs in sport_series.items():
        if len(pairs) < 15:
            continue
        m = curve_metrics_from_holds(
            [p[1] for p in pairs], [p[2] for p in pairs], [p[0] for p in pairs]
        )
        if (m.get("roi") or 0) > (best_spec.get("roi") or -999):
            best_spec = m
            best_name = sport

    cut = as_of - timedelta(days=30)
    idx = [i for i, d in enumerate(end_dts) if cut <= d <= as_of]
    if idx:
        l30_pnl = sum(holds[i] for i in idx)
        l30_cost = sum(costs[i] for i in idx) or 1.0
        last30_roi = 100.0 * l30_pnl / l30_cost
        last30_n = len(idx)
    else:
        last30_roi, last30_n = 0.0, 0

    emerging = False
    if first_end is not None:
        age = (as_of - first_end).days
        emerging = 0 <= age <= SCOUT_EMERGING_DAYS
    card.emerging = emerging
    score_all = curve_score(overall, emerging=emerging, last30_roi=last30_roi, last30_n=last30_n)
    score_spec = curve_score(best_spec, emerging=emerging, last30_roi=last30_roi, last30_n=last30_n)
    if best_name and (best_spec.get("roi") or 0) >= 8:
        score_spec = min(100.0, score_spec + 8)
    card.curve_score = max(score_all, score_spec)
    card.curve = {
        **overall,
        "specialty": best_name,
        "specialty_roi": best_spec.get("roi") if best_name else None,
        "specialty_n": best_spec.get("n") if best_name else None,
        "specialty_sharpe": best_spec.get("sharpe") if best_name else None,
        "last30_roi": round(last30_roi, 2),
        "last30_n": last30_n,
    }
    return card


def joinable(median: float, wr: float) -> tuple[bool, str]:
    if median <= 0 or median >= MEDIAN_JOIN_MAX:
        return False, f"median=${median:,.0f}"
    if WR_LO <= wr <= WR_HI:
        return True, "wr_band"
    if wr <= WR_HI_SPECIALIST:
        return True, f"specialist_wr={wr:.0f}"
    return False, f"wr={wr:.0f}"


def _sports_specialty(style: StyleCard) -> tuple[dict[str, Any], bool]:
    """Best real-sport specialty (ignore OTHER/politics/NFL as 'top')."""
    sports_only = [
        s for s in (style.top_sports or [])
        if str(s.get("key") or "").upper() not in {"OTHER", "POLITICS", "CRYPTO", "FINANCE", ""}
        and "NFL" not in str(s.get("key") or "").upper()
    ]
    top = sports_only[0] if sports_only else {}
    top_sport_ok = (
        bool(top.get("key"))
        and int(top.get("n") or 0) >= SPECIALTY_MIN_N
        and float(top.get("roi") or 0) >= SPECIALTY_MIN_ROI
    )
    return top, top_sport_ok


def _strong_curve_book(style: StyleCard, top_sport_ok: bool, top: dict[str, Any]) -> bool:
    """Capman/HVAB-class: dollar equity + specialty still green even if unit take is soft."""
    return (
        top_sport_ok
        and style.curve_score >= ELITE_CURVE_SCORE
        and style.unique_roi >= ELITE_CURVE_UNIQUE_ROI
        and float(top.get("roi") or 0) >= SPECIALTY_STRONG_ROI
    )


def decide_tier(
    *,
    was: MemberState,
    style: StyleCard,
    prior_takes: list[dict[str, Any]],
    active_30d: int,
    as_of: datetime,
) -> MemberState:
    sports_takes = [
        t for t in prior_takes
        if _is_sports_family(str(t.get("sport_family") or ""))
    ]
    take_pool = sports_takes if len(sports_takes) >= max(8, ELITE_MIN_TAKE_N // 2) else prior_takes
    take_n = len(take_pool)
    take_roi = (
        float(sum(t["pnl_2c"] for t in take_pool) / (take_n * STAKE) * 100.0)
        if take_n
        else 0.0
    )
    window_takes = [t for t in take_pool if t["end_dt"] >= as_of - timedelta(days=60)]
    n60 = len(window_takes)
    roi60 = (
        float(sum(t["pnl_2c"] for t in window_takes) / (n60 * STAKE) * 100.0)
        if n60
        else 0.0
    )
    ok_join, join_why = joinable(style.median, style.wr)
    top, top_sport_ok = _sports_specialty(style)
    top_is_sports = bool(top.get("key"))
    strong = _strong_curve_book(style, top_sport_ok, top)

    st = MemberState(
        tier=was.tier,
        take_n=take_n,
        take_roi=take_roi,
        active_30d=active_30d,
        style=style,
        since=was.since,
        kicked_at=was.kicked_at,
    )
    held_days = (as_of - was.since).days if was.since else 999
    cooldown_left = 0
    if was.kicked_at is not None:
        cooldown_left = REENTRY_COOLDOWN_DAYS - (as_of - was.kicked_at).days

    def _set(tier: str, why: str) -> MemberState:
        st.tier = tier
        st.why = why
        if tier != was.tier:
            st.since = as_of
            if tier == "none" and was.tier in {"scout", "elite"}:
                st.kicked_at = as_of
            if tier in {"scout", "elite"}:
                st.kicked_at = None
        else:
            st.since = was.since or as_of
        return st

    # Hard kicks — never shield collapsed dollar books; protect HVAB-class from short take DD
    if was.tier in {"scout", "elite"}:
        if active_30d < ELITE_STALE_30D:
            return _set("none", f"stale_30d_n={active_30d}")
        if not ok_join:
            return _set("none", f"unjoinable_{join_why}")
        if style.unique_roi < HARD_UNIQUE_ROI_FLOOR:
            return _set("none", f"hard_unique_roi={style.unique_roi:.1f}")
        if style.curve_score < HARD_CURVE_FLOOR:
            return _set("none", f"hard_curve_collapse score={style.curve_score:.0f}")
        if not strong:
            if n60 >= ELITE_BLEED_60D_N and roi60 < ELITE_BLEED_60D_ROI:
                return _set("none", f"bleed_60d_n={n60}_roi={roi60:.1f}")
            if (
                take_n >= ELITE_LIFE_FLOOR_N
                and take_roi < ELITE_LIFE_FLOOR_ROI
                and style.unique_roi < 8
            ):
                return _set("none", f"life_floor_take_roi={take_roi:.1f}_n={take_n}")

    soft_kill = False
    soft_why = ""
    if was.tier in {"scout", "elite"} and held_days >= HYSTERESIS_DAYS:
        if (
            not strong
            and take_n >= ELITE_LIFE_FLOOR_SOFT_N
            and take_roi < ELITE_LIFE_FLOOR_SOFT_ROI
            and style.unique_roi < SCOUT_MIN_UNIQUE_ROI
        ):
            soft_kill, soft_why = True, f"life_floor_soft_take_roi={take_roi:.1f}"
        elif style.curve_score < SCOUT_MIN_CURVE - 15 and style.unique_roi < SCOUT_MIN_UNIQUE_ROI:
            soft_kill, soft_why = True, f"curve_collapse score={style.curve_score:.0f}"
        elif was.tier == "scout" and style.unique_roi < SCOUT_MIN_UNIQUE_ROI:
            soft_kill, soft_why = True, f"scout_unique_roi={style.unique_roi:.1f}"
        elif not top_is_sports and not strong:
            soft_kill, soft_why = True, "no_sports_specialty"

    elite_ok = False
    elite_why = ""
    base_elite = (
        ok_join
        and active_30d >= ELITE_MIN_ACTIVE_30D
        and style.sports_frac >= SCOUT_MIN_SPORTS_FRAC
        and top_sport_ok
    )
    if base_elite and style.curve_score >= ELITE_MIN_CURVE and style.unique_roi >= ELITE_MIN_UNIQUE_ROI:
        if take_n >= ELITE_MIN_TAKE_N and take_roi >= ELITE_MIN_TAKE_ROI:
            elite_ok = True
            elite_why = (
                f"elite take={take_n}/{take_roi:.1f}% "
                f"spec={top.get('key')}@{top.get('roi')}% curve={style.curve_score:.0f}"
            )
        elif (
            strong
            and take_n >= ELITE_CURVE_TAKE_N
            and take_roi >= ELITE_CURVE_TAKE_ROI_FLOOR
            and active_30d >= 15
        ):
            elite_ok = True
            elite_why = (
                f"elite curve-book unique={style.unique_roi:.1f}% "
                f"spec={top.get('key')}@{top.get('roi')}% "
                f"take={take_n}/{take_roi:.1f}% curve={style.curve_score:.0f}"
            )
        elif (
            take_n >= ELITE_MIN_TAKE_N
            and take_roi >= 2.0
            and style.curve_score >= 70
            and style.unique_roi >= ELITE_ALT_UNIQUE_ROI
            and int(style.curve.get("n") or 0) >= ELITE_ALT_UNIQUE_N
        ):
            elite_ok = True
            elite_why = (
                f"elite specialty {top.get('key')} n={top.get('n')} roi={top.get('roi')}% "
                f"take={take_n}/{take_roi:.1f}% curve={style.curve_score:.0f}"
            )

    if elite_ok and not soft_kill:
        return _set("elite", elite_why + f" {join_why} active30={active_30d}")

    blocked_reentry = was.tier == "none" and cooldown_left > 0

    scout_ok = (
        not blocked_reentry
        and ok_join
        and style.curve.get("n", 0) >= SCOUT_MIN_N
        and active_30d >= SCOUT_MIN_ACTIVE_30D
        and style.sports_frac >= SCOUT_MIN_SPORTS_FRAC
        and style.unique_roi >= SCOUT_MIN_UNIQUE_ROI
        and top_is_sports
        and (
            (style.curve_score >= SCOUT_MIN_CURVE and top_sport_ok)
            or (top_sport_ok and style.curve_score >= 50 and active_30d >= 20)
            or (
                style.emerging
                and top_sport_ok
                and style.unique_roi >= 8
                and style.curve_score >= 48
                and active_30d >= 15
            )
        )
    )
    if scout_ok and not soft_kill:
        sports_keys = [
            str(s.get("key"))
            for s in (style.top_sports or [])
            if s.get("key")
            and str(s.get("key")).upper() not in {"OTHER", "POLITICS", "CRYPTO", "FINANCE"}
            and "NFL" not in str(s.get("key")).upper()
        ][:2]
        tops = ",".join(sports_keys) or str(top.get("key") or "?")
        return _set(
            "scout",
            f"scout curve={style.curve_score:.0f} roi={style.unique_roi:.1f}% "
            f"spec={tops} sports={style.sports_frac:.0%} "
            f"{'emerging ' if style.emerging else ''}active30={active_30d}",
        )

    if soft_kill:
        return _set("none", soft_why)

    if was.tier in {"scout", "elite"} and held_days < HYSTERESIS_DAYS and active_30d >= ELITE_STALE_30D:
        base_why = was.why or ""
        if base_why.startswith("hold_"):
            parts = base_why.split(" · ", 1)
            base_why = parts[-1] if parts else base_why
        st.why = f"hold_{was.tier} {held_days}d · {base_why}"
        return st

    if was.tier != "none":
        return _set(
            "none",
            f"drop score={style.curve_score:.0f} active30={active_30d} "
            f"sports={style.sports_frac:.0%} take={take_n}/{take_roi:.1f}",
        )

    why = (
        f"watch score={style.curve_score:.0f} n={int(style.curve.get('n') or 0)} "
        f"active30={active_30d} sports={style.sports_frac:.0%}"
    )
    if blocked_reentry:
        why = f"cooldown_{cooldown_left}d · {why}"
    return _set("none", why)



def candidate_books() -> list[tuple[str, str]]:
    """All non-mega digest CSVs: universe + trusted + every output *_0x*.csv.

    Forward system must scan the full discovery pool — not a hand-picked elite list.
    """
    import re

    pairs: list[tuple[str, str]] = []
    seen: set[str] = set()

    def _key(wallet: str) -> str:
        # Digest paths use wallet[:8] (e.g. 0xc5b5bb) — not 8 hex digits.
        return (wallet or "").lower()[:8]

    def _add(username: str, wallet: str) -> None:
        w = (wallet or "").lower()
        u = username or ""
        if not w:
            return
        key = _key(w)
        if key in seen:
            return
        p = csv_path_for(w, u)
        if not p.exists():
            hits = list(OUTPUT_DIR.glob(f"*_{key}.csv"))
            if not hits:
                return
            p = hits[0]
            if not u:
                u = p.stem.rsplit("_", 1)[0]
            jp = p.with_suffix(".json")
            if jp.exists():
                try:
                    meta = json.loads(jp.read_text(encoding="utf-8"))
                    fw = str(meta.get("wallet") or "").lower()
                    fu = str(meta.get("username") or "")
                    if fw:
                        w = fw
                    if fu:
                        u = fu
                except (OSError, json.JSONDecodeError):
                    pass
        # Prefer full wallet from sidecar even when path resolved
        jp = csv_path_for(w, u).with_suffix(".json") if u else p.with_suffix(".json")
        if not jp.exists():
            jp = p.with_suffix(".json")
        if jp.exists() and len(w) <= 10:
            try:
                meta = json.loads(jp.read_text(encoding="utf-8"))
                fw = str(meta.get("wallet") or "").lower()
                fu = str(meta.get("username") or "")
                if fw and len(fw) > len(w):
                    w = fw
                if fu:
                    u = fu
            except (OSError, json.JSONDecodeError):
                pass
        try:
            est = sum(1 for _ in open(csv_path_for(w, u) if csv_path_for(w, u).exists() else p, "rb")) - 1
        except OSError:
            est = 0
        if est >= CSV_ROWS_BOT:
            return
        pairs.append((u or p.stem.rsplit("_", 1)[0], w))
        seen.add(key)

    uni = load_universe()
    for bucket in ("live", "bench", "watch"):
        for t in uni.get(bucket) or []:
            rows = int(t.get("rows") or 0)
            closed = int(t.get("closed") or 0)
            if rows >= CSV_ROWS_BOT or closed >= CLOSED_MAX_COPY:
                continue
            _add(str(t.get("username") or ""), str(t.get("wallet") or ""))
    for t in load_trusted():
        _add(str(t.get("username") or ""), str(t.get("wallet") or ""))

    # Digest CSVs on disk (hot_copy / polydata / watch promotions not yet in universe)
    pat = re.compile(r"^(.+)_(0x[0-9a-fA-F]+)\.csv$")
    for p in sorted(OUTPUT_DIR.glob("*.csv")):
        m = pat.match(p.name)
        if not m:
            continue
        _add(m.group(1), m.group(2))

    hot_path = OUTPUT_DIR / "hot_copy_screen.json"
    if hot_path.exists():
        try:
            hot = json.loads(hot_path.read_text(encoding="utf-8"))
            for row in hot.get("named") or []:
                if isinstance(row, dict):
                    _add(str(row.get("username") or ""), str(row.get("wallet") or ""))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"  warn hot_copy_screen: {exc}", flush=True)

    return pairs


@dataclass
class TraderWalk:
    username: str
    wallet: str
    trades: list[dict[str, Any]] = field(default_factory=list)
    roster_log: list[dict[str, Any]] = field(default_factory=list)
    discoveries: list[dict[str, Any]] = field(default_factory=list)
    final: dict[str, Any] = field(default_factory=dict)


def walk_trader(username: str, wallet: str, mk: pd.DataFrame) -> TraderWalk:
    out = TraderWalk(username=username, wallet=wallet)
    if len(mk) < WARMUP + 5:
        return out
    snaps = build_snapshots(mk)
    rows = list(mk.itertuples(index=False))
    rows.sort(key=lambda r: (alert_time(r), pd.Timestamp(r.end_dt).to_pydatetime()))

    pending: list[tuple[datetime, int, dict[str, Any] | None]] = []
    known_rows: list[dict[str, Any]] = []
    end_dts: list[datetime] = []
    prior_takes: list[dict[str, Any]] = []
    state = MemberState()
    first_end: datetime | None = None
    seq = 0

    def flush(as_of: datetime) -> None:
        nonlocal first_end
        while pending and pending[0][0] <= as_of:
            end_dt, _seq, rec = heapq.heappop(pending)
            if rec is None:
                continue
            if first_end is None:
                first_end = end_dt
            end_dts.append(end_dt)
            known_rows.append(rec)
            if rec.get("product_ok"):
                prior_takes.append({
                    "end_dt": end_dt,
                    "pnl_2c": rec["unit_pnl_2c"],
                    "sport_family": rec["sport_family"],
                })

    for r in rows:
        end_dt = pd.Timestamp(r.end_dt).to_pydatetime()
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)
        alert_at = alert_time(r)
        as_of = alert_at - KNOWLEDGE_LAG
        flush(as_of)

        snap = lookup_snap(snaps, as_of)
        n_prior = int(snap["n"]) if snap else 0
        entry = float(np.clip(r.entry_price, 0.02, 0.98))
        sport = str(r.sport_type)
        sub = str(getattr(r, "submarket", None) or r.market_type)
        fam = sport_family(sport)
        won = bool(r.won)
        cost = float(r.cost)
        hold = float(r.hold_pnl)
        up0 = unit_pnl(won, entry, 0.0)
        up2 = unit_pnl(won, entry, 0.02)

        if n_prior < WARMUP:
            seq += 1
            heapq.heappush(pending, (end_dt, seq, {
                "cost": cost,
                "hold_pnl": hold,
                "won": won,
                "sport": sport,
                "sport_family": fam,
                "submarket": sub,
                "unit_pnl_0c": up0,
                "unit_pnl_2c": up2,
                "product_ok": False,
            }))
            continue

        q = int(snap["q"]) if snap else 0
        median = float(snap["median"]) if snap else 0.0
        roi = float(snap["roi"]) if snap else 0.0
        sport_roi = float((snap.get("sport_roi") or {}).get(sport, roi)) if snap else roi
        lane_ok = sport in (snap.get("sport_roi") or {}) and sport_roi >= MIN_LANE_ROI
        rel = min((cost / median) if median > 0 else 1.0, 30.0)
        misses = sniper_gates(q, lane_ok, rel, entry, fam)
        product_ok = len(misses) == 0

        active_30d = sum(1 for e in end_dts if (as_of - timedelta(days=30)) <= e <= as_of)
        style = style_from_history(known_rows, end_dts, as_of, first_end)
        new_state = decide_tier(
            was=state,
            style=style,
            prior_takes=prior_takes,
            active_30d=active_30d,
            as_of=as_of,
        )

        if new_state.tier != state.tier:
            action = (
                "promote_elite" if new_state.tier == "elite"
                else "promote_scout" if new_state.tier == "scout"
                else "kick"
            )
            entry_log = {
                "at": as_of.isoformat(),
                "alert_ref": alert_at.isoformat(),
                "action": action,
                "from": state.tier,
                "to": new_state.tier,
                "why": new_state.why,
                "curve_score": style.curve_score,
                "unique_roi": round(style.unique_roi, 2),
                "take_n": new_state.take_n,
                "take_roi": round(new_state.take_roi, 2),
                "active_30d": active_30d,
                "median": round(style.median, 2),
                "sports_frac": round(style.sports_frac, 2),
                "top_sports": style.top_sports,
                "emerging": style.emerging,
                "curve": style.curve,
            }
            out.roster_log.append(entry_log)
            if new_state.tier in {"scout", "elite"} and state.tier == "none":
                out.discoveries.append(entry_log)
        state = new_state

        if product_ok and state.tier == "elite":
            out.trades.append({
                "username": username,
                "wallet": wallet,
                "alerted_at": alert_at.isoformat(),
                "as_of": as_of.isoformat(),
                "event_end": end_dt.isoformat(),
                "title": str(r.title or ""),
                "side": str(r.side),
                "sport": sport,
                "sport_family": fam,
                "submarket": sub,
                "play": play_label(str(r.title or ""), str(r.side), sport, sub),
                "q": q,
                "rel": round(rel, 2),
                "sport_roi": round(sport_roi, 1),
                "entry": round(entry, 4),
                "fill_plus_2c": round(min(entry + 0.02, 0.98), 4),
                "cost": round(cost, 2),
                "won": won,
                "unit_pnl": round(up2, 2),
                "elite_why": state.why,
                "curve_score": style.curve_score,
                "conditionId": str(r.conditionId),
            })

        seq += 1
        heapq.heappush(pending, (end_dt, seq, {
            "cost": cost,
            "hold_pnl": hold,
            "won": won,
            "sport": sport,
            "sport_family": fam,
            "submarket": sub,
            "unit_pnl_0c": up0,
            "unit_pnl_2c": up2,
            "product_ok": product_ok,
        }))

    now = datetime.now(timezone.utc)
    flush(now)
    active_30d = sum(1 for e in end_dts if (now - timedelta(days=30)) <= e <= now)
    style = style_from_history(known_rows, end_dts, now, first_end)
    final = decide_tier(
        was=state, style=style, prior_takes=prior_takes, active_30d=active_30d, as_of=now
    )
    if final.tier != state.tier:
        out.roster_log.append({
            "at": now.isoformat(),
            "action": (
                "promote_elite" if final.tier == "elite"
                else "promote_scout" if final.tier == "scout"
                else "kick"
            ),
            "from": state.tier,
            "to": final.tier,
            "why": final.why,
            "curve_score": style.curve_score,
            "active_30d": active_30d,
            "top_sports": style.top_sports,
        })
    state = final
    out.final = {
        "username": username,
        "wallet": wallet,
        "tier": state.tier,
        "why": state.why,
        "take_n": state.take_n,
        "take_roi": round(state.take_roi, 2),
        "active_30d": active_30d,
        "median": round(style.median, 2),
        "unique_roi": round(style.unique_roi, 2),
        "curve_score": style.curve_score,
        "sports_frac": round(style.sports_frac, 2),
        "top_sports": style.top_sports,
        "top_submarkets": style.top_submarkets,
        "curve": style.curve,
        "emerging": style.emerging,
        "wr": round(style.wr, 2),
        "trades": len(out.trades),
        "discoveries": len(out.discoveries),
    }
    return out


def leave_one_out(tdf: pd.DataFrame) -> list[dict[str, Any]]:
    out = []
    for user in sorted(tdf["username"].unique()):
        sub = tdf[tdf["username"] != user].copy()
        sub["end_dt"] = pd.to_datetime(sub["event_end"], utc=True)
        st = asof_stat(sub, 0.02)
        out.append({
            "dropped": user,
            "n_remaining": st["n"],
            "win_rate": st["win_rate"],
            "roi_2c": st["roi"],
            "unit_pnl": st["unit_pnl"],
        })
    return out


def write_md(payload: dict[str, Any]) -> None:
    st = payload.get("portfolio") or {}
    lines = [
        "# Verified Elite Discovery — walk-forward (find HVAB/Capman-class early)",
        "",
        f"Generated **{payload['generated_at'][:19]} UTC**.",
        "",
        "## What this proves",
        "",
        "This is **not** picking Capman/Vetch then backtesting them. At each time T the system:",
        "1. Scores every book’s **equity curve + style** with data ≤ T only",
        "2. Auto-promotes **Scout** (early curve) → **Elite** (confirmed)",
        "3. Trades Sniper gates only while Elite",
        "4. Kicks stale / bleed / curve collapse",
        "",
        "## Portfolio (auto-found elites only)",
        "",
        f"- **n={st.get('n')}** · WR **{st.get('win_rate')}%** · ROI+2¢ **{st.get('roi')}%** · "
        f"PnL **${st.get('unit_pnl')}** · PF {st.get('profit_factor')} · maxDD ${st.get('max_dd')}",
        f"- Span {st.get('first')} → {st.get('last')} · ~{st.get('trades_per_day')}/day",
        f"- Passes 5% bar: **{payload.get('passes_product_bar')}**",
        "",
        "### Leave-one-out",
        "",
    ]
    for row in payload.get("leave_one_out") or []:
        lines.append(
            f"- Drop **{row['dropped']}**: n={row['n_remaining']} WR={row['win_rate']}% ROI={row['roi_2c']}%"
        )
    lines += ["", "### By auto-found trader", ""]
    for row in payload.get("by_trader") or []:
        lines.append(
            f"- **{row['username']}**: n={row['n']} WR={row['win_rate']}% ROI={row['roi']}% "
            f"(first elite trade {row.get('first')} → {row.get('last')})"
        )
    lines += ["", "## Live roster now", "", "### Elite (Telegram / Sniper)", ""]
    for e in payload.get("live_elite") or []:
        tops = ", ".join(f"{s['key']} n={s['n']} ({s['roi']}%)" for s in (e.get("top_sports") or [])[:3])
        lines.append(
            f"- **{e['username']}** curve={e.get('curve_score')} unique={e.get('unique_roi')}% "
            f"take={e.get('take_n')}/{e.get('take_roi')}% active30={e.get('active_30d')} "
            f"median=${e.get('median')} · {tops}"
        )
        lines.append(f"  - {e.get('why')}")
    if not payload.get("live_elite"):
        lines.append("_None — waiting for active elite promotes._")
    lines += ["", "### Scout (watching — not Telegram yet)", ""]
    for e in payload.get("live_scout") or []:
        lines.append(
            f"- **{e['username']}** curve={e.get('curve_score')} unique={e.get('unique_roi')}% "
            f"active30={e.get('active_30d')} emerging={e.get('emerging')} · {e.get('why')}"
        )
    if not payload.get("live_scout"):
        lines.append("_None._")
    lines += ["", "### Proven but stale (kicked — will re-scout when active)", ""]
    for e in payload.get("proven_stale") or []:
        lines.append(
            f"- **{e['username']}** take={e.get('take_n')}/{e.get('take_roi')}% "
            f"curve={e.get('curve_score')} · {e.get('why')}"
        )
    lines += ["", "## First discoveries (when the system found them)", ""]
    for d in (payload.get("first_discoveries") or [])[:30]:
        lines.append(
            f"- {str(d.get('at') or '')[:10]} **{d['username']}** → {d.get('to')}: {d.get('why')}"
        )
    lines += ["", "## Last 15 trades (would have alerted)", ""]
    for t in (payload.get("last_trades") or [])[:15]:
        wl = "W" if t.get("won") else "L"
        lines.append(
            f"- {str(t.get('alerted_at') or '')[:10]} {wl} ${t.get('unit_pnl')} "
            f"**{t.get('username')}** Q={t.get('q')} · {str(t.get('title') or '')[:50]}"
        )
    lines += [
        "",
        "## Rules",
        "",
        f"- **Scout**: n≥{SCOUT_MIN_N}, active30≥{SCOUT_MIN_ACTIVE_30D}, sports≥{SCOUT_MIN_SPORTS_FRAC:.0%}, "
        f"curve_score≥{SCOUT_MIN_CURVE}, unique ROI≥{SCOUT_MIN_UNIQUE_ROI}%, real-sport specialty, joinable.",
        f"- **Elite**: specialty n≥{SPECIALTY_MIN_N} ROI≥{SPECIALTY_MIN_ROI}% + curve≥{ELITE_MIN_CURVE} + "
        f"unique≥{ELITE_MIN_UNIQUE_ROI}% + sports-take n≥{ELITE_MIN_TAKE_N} ROI≥{ELITE_MIN_TAKE_ROI}%.",
        f"- **Kick (hard)**: stale active30<{ELITE_STALE_30D}, unique ROI<{HARD_UNIQUE_ROI_FLOOR}%, "
        f"curve<{HARD_CURVE_FLOOR}, early life-floor take ROI<{ELITE_LIFE_FLOOR_ROI}% @ n≥{ELITE_LIFE_FLOOR_N}.",
        "- **Trade**: Elite + Sniper gates (Q≥60, sport+5%, rel≥2×, 10–88¢, no NFL).",
        "- **Product roster**: Telegram = live elite only. Scouts watch. Proven_bench = stale but historically green.",
        "",
    ]
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    books = candidate_books()
    print(f"Discovery walk-forward  books={len(books)}  stake=${STAKE:.0f}", flush=True)
    walks: list[TraderWalk] = []
    for username, wallet in books:
        try:
            mk = load_markets_with_entry(csv_path_for(wallet, username), username, wallet)
        except Exception as exc:
            print(f"  skip {username}: {exc}", flush=True)
            continue
        if len(mk) < WARMUP + 5:
            print(f"  skip {username}: n={len(mk)}", flush=True)
            continue
        tw = walk_trader(username, wallet, mk)
        walks.append(tw)
        f = tw.final
        print(
            f"  {username:<36} tier={f.get('tier','?'):5s} curve={f.get('curve_score'):5.1f} "
            f"trades={f.get('trades'):3d} active30={f.get('active_30d'):3d} "
            f"disc={f.get('discoveries')}",
            flush=True,
        )

    all_trades = [t for w in walks for t in w.trades]
    roster_changes = []
    for w in walks:
        for ch in w.roster_log:
            roster_changes.append({"username": w.username, **ch})
    roster_changes.sort(key=lambda x: x.get("at") or "")

    first_discoveries = []
    seen_u: set[str] = set()
    for ch in roster_changes:
        if ch.get("action") in {"promote_scout", "promote_elite"} and ch["username"] not in seen_u:
            first_discoveries.append(ch)
            seen_u.add(ch["username"])

    if all_trades:
        tdf = pd.DataFrame(all_trades)
        tdf["end_dt"] = pd.to_datetime(tdf["event_end"], utc=True)
        tdf["entry"] = tdf["entry"].astype(float)
        portfolio = asof_stat(tdf, 0.02)
        by_trader = []
        for user, grp in tdf.groupby("username"):
            st = asof_stat(grp, 0.02)
            by_trader.append({
                "username": user,
                **{k: st[k] for k in ("n", "win_rate", "roi", "unit_pnl", "first", "last")},
            })
        by_trader.sort(key=lambda r: -r["n"])
        loo = leave_one_out(tdf)
        last_trades = (
            tdf.sort_values("end_dt", ascending=False)
            .head(20)
            .drop(columns=["end_dt"], errors="ignore")
            .to_dict(orient="records")
        )
        quarters: dict[str, Any] = {}
        q = tdf["end_dt"].dt.tz_convert("UTC").dt.to_period("Q").astype(str)
        tmp = tdf.copy()
        tmp["_q"] = q.to_numpy()
        for key, grp in tmp.groupby("_q"):
            quarters[str(key)] = asof_stat(grp.drop(columns=["_q"]), 0.02)
    else:
        portfolio = asof_stat(pd.DataFrame(), 0.02)
        by_trader, loo, last_trades, quarters = [], [], [], {}

    live_elite, live_scout, proven_stale = [], [], []
    for w in walks:
        f = w.final
        if not f:
            continue
        row = {**f}
        if f.get("tier") == "elite":
            live_elite.append(row)
        elif f.get("tier") == "scout":
            live_scout.append(row)
        elif str(f.get("why") or "").startswith("stale") and (
            (
                int(f.get("take_n") or 0) >= ELITE_MIN_TAKE_N
                and float(f.get("take_roi") or 0) >= ELITE_MIN_TAKE_ROI
            )
            or (
                float(f.get("curve_score") or 0) >= SCOUT_MIN_CURVE
                and float(f.get("unique_roi") or 0) >= SCOUT_MIN_UNIQUE_ROI
                and int(f.get("trades") or 0) >= 10
            )
        ):
            # Historically green / traded — not bleeders parked as "proven"
            proven_stale.append(row)

    live_elite.sort(key=lambda x: -(x.get("curve_score") or 0))
    live_scout.sort(key=lambda x: -(x.get("curve_score") or 0))
    proven_stale.sort(key=lambda x: -(x.get("curve_score") or 0))

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": (
            "Discovery-first walk-forward: equity-curve + style scout → elite confirm → "
            "Sniper trades only while elite; kick stale. No pre-chosen winner list."
        ),
        "rules": {
            "scout": {
                "min_n": SCOUT_MIN_N,
                "min_active_30d": SCOUT_MIN_ACTIVE_30D,
                "min_curve_score": SCOUT_MIN_CURVE,
                "min_sports_frac": SCOUT_MIN_SPORTS_FRAC,
                "min_unique_roi": SCOUT_MIN_UNIQUE_ROI,
                "specialty_min_n": SPECIALTY_MIN_N,
                "specialty_min_roi": SPECIALTY_MIN_ROI,
            },
            "elite": {
                "min_take_n": ELITE_MIN_TAKE_N,
                "min_take_roi": ELITE_MIN_TAKE_ROI,
                "min_curve": ELITE_MIN_CURVE,
                "min_unique_roi": ELITE_MIN_UNIQUE_ROI,
                "alt_unique_roi": ELITE_ALT_UNIQUE_ROI,
                "alt_unique_n": ELITE_ALT_UNIQUE_N,
                "require_sports_specialty": True,
            },
            "hard_kick": {
                "stale_30d": ELITE_STALE_30D,
                "unique_roi_floor": HARD_UNIQUE_ROI_FLOOR,
                "curve_floor": HARD_CURVE_FLOOR,
                "life_floor_n": ELITE_LIFE_FLOOR_N,
                "life_floor_roi": ELITE_LIFE_FLOOR_ROI,
            },
            "sniper": "Q>=60 sport+5% rel>=2x 10-88c no NFL",
        },
        "books_scanned": len(walks),
        "portfolio": portfolio,
        "quarters": quarters,
        "by_trader": by_trader,
        "leave_one_out": loo,
        "live_elite": live_elite,
        "live_scout": live_scout,
        "proven_stale": proven_stale,
        "first_discoveries": first_discoveries[:40],
        "recent_roster_changes": list(reversed(roster_changes[-50:])),
        "last_trades": last_trades,
        "passes_product_bar": bool(
            portfolio.get("n", 0) >= 80 and (portfolio.get("roi") or 0) >= 5.0
        ),
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")

    roster = {
        "generated_at": payload["generated_at"],
        "rule": "walkforward_elite_discovery",
        "sniper_strategy": "asof_live_q60_sport_rel2",
        "elite": [
            {
                "username": e["username"],
                "wallet": e["wallet"],
                "take_n": e.get("take_n"),
                "take_roi": e.get("take_roi"),
                "active_30d": e.get("active_30d"),
                "median": e.get("median"),
                "curve_score": e.get("curve_score"),
                "unique_roi": e.get("unique_roi"),
                "top_sports": e.get("top_sports"),
                "top_submarkets": e.get("top_submarkets"),
                "why": e.get("why"),
                "trades_in_backtest": e.get("trades"),
            }
            for e in live_elite
        ],
        "scout": live_scout,
        "proven_bench": proven_stale,
        "backtest": {
            "n": portfolio.get("n"),
            "win_rate": portfolio.get("win_rate"),
            "roi_2c": portfolio.get("roi"),
            "unit_pnl": portfolio.get("unit_pnl"),
            "passes_5pct_bar": payload["passes_product_bar"],
        },
        "note": (
            "Telegram/Sniper = elite only (must be active). Scout = watching. "
            "Proven_bench = historically good but stale — re-enters when active + curve holds."
        ),
    }
    ROSTER_JSON.write_text(json.dumps(roster, indent=2, default=str) + "\n", encoding="utf-8")
    write_md(payload)

    print("\n=== DISCOVERY PORTFOLIO ===", flush=True)
    print(
        f"n={portfolio.get('n')} WR={portfolio.get('win_rate')}% "
        f"ROI+2c={portfolio.get('roi')}% pass5={payload['passes_product_bar']}",
        flush=True,
    )
    print(
        f"Live elite ({len(live_elite)}):",
        ", ".join(e["username"] for e in live_elite) or "(none)",
        flush=True,
    )
    print(
        f"Live scout ({len(live_scout)}):",
        ", ".join(e["username"] for e in live_scout) or "(none)",
        flush=True,
    )
    print(f"Wrote {OUT_JSON}\nWrote {ROSTER_JSON}\nWrote {OUT_MD}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
