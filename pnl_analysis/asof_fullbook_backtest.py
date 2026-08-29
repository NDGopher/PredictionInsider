#!/usr/bin/env python3
"""Hold-to-resolution as-of copy of trusted full books.

Unlike walkforward_tail_backtest.py this does NOT treat dashboard pnl>0 as a win.
Win = token resolved to $1. Fill = their VWAP and +2¢. Grade / sport-lane /
submarket / relative size use only markets that had already resolved.

Forward / look-ahead notes (important for OddsJam-style honesty):
  - Features (Q, lane ROI, median stake) are as-of (first_fill − KNOWLEDGE_LAG)
    when a fill timestamp exists, else (endDate − KNOWLEDGE_LAG).
    The *current* market's outcome is never in the snapshot.
  - Labels are resolution outcomes only — we never peek at future PnL.
  - Live opens use `now − KNOWLEDGE_LAG` (true forward).
  - Product Sniper rule: asof_live_q60_sport_rel2 (Q≥60, sport +5%, rel≥2×).
  - Explorer (labeled, non-Telegram): asof_q60_sub_rel2.

Writes:
  pnl_analysis/output/asof_fullbook_backtest.json
  pnl_analysis/output/asof_fullbook_plays.csv  (gitignored)
  pnl_analysis/FULL_BOOK_STRATEGIES.md
  pnl_analysis/output/tail_strategies.json  (product; --write-product)
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from position_utils import play_label, sport_family  # noqa: E402
from run_full_pipeline import OUTPUT_DIR, csv_path_for, roster_traders  # noqa: E402
from walkforward_consensus_backtest import (  # noqa: E402
    KNOWLEDGE_LAG,
    LIVE_HI,
    LIVE_LO,
    MIN_LANE_ROI,
    STAKE,
    STALE_ENTRY,
    WARMUP,
    build_snapshots,
    daily_roi_sharpe,
    load_trader_markets,
    lookup_snap,
    max_drawdown,
    profit_factor,
)

TRUSTED = OUTPUT_DIR / "trusted_full_books.json"
OUT = OUTPUT_DIR / "asof_fullbook_backtest.json"
PLAYS_CSV = OUTPUT_DIR / "asof_fullbook_plays.csv"
MD = Path(__file__).resolve().parent / "FULL_BOOK_STRATEGIES.md"
TAIL = OUTPUT_DIR / "tail_strategies.json"
ELITES_MD = Path(__file__).resolve().parent / "POLYDATA_ELITES.md"

UNTILABLE = [
    "GoalLineGhost",
    "RN1",
    "Cannae",
    "ferrariChampions2026",
    "HomeRunHazard",
    "swisstony",
    "wr0ngw4yb3tt0r",
    "quavoo",
]


def load_trusted() -> list[dict]:
    data = json.loads(TRUSTED.read_text(encoding="utf-8"))
    return list(data.get("trusted") or [])


def unit_pnl(won: bool, price: float) -> float:
    px = min(max(float(price), 0.02), 0.98)
    return STAKE * (1.0 / px - 1.0) if won else -STAKE


def _empty_stat() -> dict:
    return {
        "n": 0, "wins": 0, "losses": 0, "win_rate": 0.0,
        "unit_pnl": 0.0, "expectancy": 0.0, "roi": 0.0,
        "profit_factor": 0.0, "sharpe_daily_roi": 0.0, "max_dd": 0.0,
        "avg_grade": 0.0, "avg_q": 0.0, "avg_fill": 0.0, "avg_vwap": 0.0,
        "implied_wr": 0.0, "edge": 0.0, "avg_traders": 1.0, "avg_rel": 0.0,
        "calmar": 0.0, "days": 0, "trades_per_day": 0.0, "first": None, "last": None,
    }


def asof_stat(sub: pd.DataFrame, slip: float) -> dict:
    if sub is None or sub.empty:
        return _empty_stat()
    fills = np.clip(sub["entry"].to_numpy(dtype=float) + slip, 0.02, 0.98)
    won = sub["won"].to_numpy()
    pnls = np.where(won, STAKE * (1.0 / fills - 1.0), -STAKE)
    n = int(len(sub))
    wins = int(won.sum())
    wr = wins / n * 100.0
    upnl = float(pnls.sum())
    implied = float(fills.mean() * 100.0)
    dates = sub["end_dt"].tolist()
    dd = max_drawdown(pnls)
    qcol = sub["q"] if "q" in sub.columns else pd.Series([0.0] * n)
    relcol = sub["rel"] if "rel" in sub.columns else pd.Series([1.0] * n)
    return {
        "n": n,
        "wins": wins,
        "losses": n - wins,
        "win_rate": round(wr, 2),
        "unit_pnl": round(upnl, 2),
        "expectancy": round(float(pnls.mean()), 2),
        "roi": round(upnl / (n * STAKE) * 100.0, 2),
        "profit_factor": round(profit_factor(pnls), 3),
        "sharpe_daily_roi": round(daily_roi_sharpe(dates, pnls), 2),
        "max_dd": round(dd, 2),
        "avg_grade": round(float(qcol.mean()), 1),
        "avg_q": round(float(qcol.mean()), 1),
        "avg_fill": round(float(fills.mean()), 3),
        "avg_vwap": round(float(sub["entry"].mean()), 3),
        "implied_wr": round(implied, 1),
        "edge": round(wr - implied, 1),
        "avg_traders": 1.0,
        "avg_rel": round(float(relcol.mean()), 2),
        "calmar": round(upnl / abs(dd or 1.0), 2),
        "days": int(pd.to_datetime(sub["end_dt"]).dt.date.nunique()),
        "trades_per_day": round(n / max(int(pd.to_datetime(sub["end_dt"]).dt.date.nunique()), 1), 2),
        "first": str(sub["end_dt"].min())[:10] if n else None,
        "last": str(sub["end_dt"].max())[:10] if n else None,
    }


def year_split(sub: pd.DataFrame, slip: float) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if sub.empty:
        return out
    years = pd.to_datetime(sub["end_dt"]).dt.year
    for year, grp in sub.groupby(years):
        out[str(int(year))] = asof_stat(grp, slip)
    return out


def quarter_split(sub: pd.DataFrame, slip: float) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if sub.empty:
        return out
    dt = pd.to_datetime(sub["end_dt"], utc=True)
    try:
        dt = dt.dt.tz_convert("UTC").dt.tz_localize(None)
    except TypeError:
        pass
    q = dt.dt.to_period("Q").astype(str)
    tmp = sub.copy()
    tmp["_q"] = q.to_numpy()
    for key, grp in tmp.groupby("_q"):
        out[str(key)] = asof_stat(grp.drop(columns=["_q"]), slip)
    return out


def breakdown(sub: pd.DataFrame, col: str, slip: float = 0.02) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if sub.empty or col not in sub.columns:
        return out
    for key, grp in sub.groupby(col):
        if len(grp) < 8:
            continue
        out[str(key)] = asof_stat(grp, slip)
    return out


def last_plays(sub: pd.DataFrame, n: int = 20) -> list[dict]:
    out: list[dict] = []
    if sub.empty:
        return out
    last = sub.sort_values("end_dt", ascending=False).head(n)
    for r in last.itertuples(index=False):
        fill = min(max(float(r.entry) + 0.02, 0.02), 0.98)
        pnl = STAKE * (1.0 / fill - 1.0) if bool(r.won) else -STAKE
        subm = str(getattr(r, "submarket", "") or "")
        title = str(r.title or "")
        sport = str(r.sport)
        out.append({
            "end": pd.Timestamp(r.end_dt).isoformat(),
            "title": title,
            "side": "YES",
            "sport": sport,
            "sport_family": sport_family(sport),
            "market": subm,
            "submarket": subm,
            "play": play_label(title, "YES", sport, subm),
            "traders": str(r.username),
            "n_traders": 1,
            "grade": int(getattr(r, "q", 0) or 0),
            "resolved": "win" if bool(r.won) else "loss",
            "their_vwap": round(float(r.entry), 3),
            "fill_join_plus_2c": round(fill, 3),
            "unit_pnl_at_2c": round(pnl, 2),
            "rel": round(float(getattr(r, "rel", 1.0) or 1.0), 2),
        })
    return out


def trader_rows(sub: pd.DataFrame) -> list[dict]:
    rows: list[dict] = []
    if sub.empty:
        return rows
    for name, grp in sub.groupby("username"):
        st = asof_stat(grp, 0.02)
        rows.append({
            "username": str(name),
            "n": st["n"],
            "win_rate": st["win_rate"],
            "roi_0c": asof_stat(grp, 0.0)["roi"],
            "roi_2c": st["roi"],
            "share": round(len(grp) / max(len(sub), 1) * 100.0, 1),
        })
    rows.sort(key=lambda r: -r["n"])
    return rows


def leave_one_out(sub: pd.DataFrame) -> list[dict]:
    rows: list[dict] = []
    if sub.empty:
        return rows
    names = sorted(sub["username"].unique())
    for name in names:
        rest = sub[sub["username"] != name]
        st = asof_stat(rest, 0.02)
        rows.append({
            "dropped": str(name),
            "n_remaining": st["n"],
            "win_rate": st["win_rate"],
            "roi_2c": st["roi"],
        })
    rows.sort(key=lambda r: r["roi_2c"])
    return rows


def concentration(sub: pd.DataFrame) -> dict:
    if sub.empty:
        return {"top": None, "share": 0.0, "n_traders": 0}
    counts = sub["username"].value_counts()
    top = str(counts.index[0])
    return {
        "top": top,
        "share": round(float(counts.iloc[0] / len(sub) * 100.0), 1),
        "n_traders": int(sub["username"].nunique()),
    }


def robust_ok(sub: pd.DataFrame) -> tuple[bool, str]:
    """Recommend only if n, +2¢ ROI, LOO, and concentration all hold."""
    st = asof_stat(sub, 0.02)
    if st["n"] < 200:
        return False, f"n={st['n']} < 200"
    if st["roi"] <= 0:
        return False, f"+2¢ ROI {st['roi']}% ≤ 0"
    conc = concentration(sub)
    if conc["share"] >= 70:
        return False, f"{conc['top']} is {conc['share']}% of the book"
    loo = leave_one_out(sub)
    if loo:
        worst = loo[0]
        if worst["roi_2c"] <= 0 and worst["n_remaining"] >= 150:
            return False, f"dropping {worst['dropped']} flips remaining to {worst['roi_2c']}%"
        neg = [r for r in loo if r["roi_2c"] <= 0]
        if len(neg) >= max(3, len(loo) // 3):
            return False, f"{len(neg)} leave-one-out drops go non-positive"
    quarters = quarter_split(sub, 0.02)
    fat = [k for k, v in quarters.items() if v["n"] >= 40]
    if fat:
        pos = sum(1 for k in fat if quarters[k]["roi"] > 0)
        if pos / len(fat) < 0.5:
            return False, f"only {pos}/{len(fat)} quarters with n≥40 are +ROI after 2¢"
    return True, "n≥200, +ROI after 2¢, leave-one-out and quarters hold"


def collect_plays(trusted: list[dict], extra_books: list[dict] | None = None) -> pd.DataFrame:
    allow: dict[str, str] = {}
    for t in trusted:
        w = str(t.get("wallet") or "").lower()
        u = str(t.get("username") or "")
        if w:
            allow[w] = u
    for t in extra_books or []:
        w = str(t.get("wallet") or "").lower()
        u = str(t.get("username") or "")
        if w:
            allow[w] = u or allow.get(w, w[:10])
    pairs: list[tuple[str, str]] = []
    seen: set[str] = set()
    for wallet, username in roster_traders():
        w = wallet.lower()
        if w not in allow or w in seen:
            continue
        pairs.append((wallet, username))
        seen.add(w)
    for t in extra_books or []:
        w = str(t.get("wallet") or "").lower()
        u = str(t.get("username") or "") or allow.get(w, w[:10])
        if w in allow and w not in seen:
            pairs.append((w, u))
            seen.add(w)
    rows: list[dict] = []
    print(f"Hold-to-res as-of copy  wallets={len(allow)}  stake=${STAKE:.0f}")
    for wallet, username in pairs:
        w = wallet.lower()
        csv_p = csv_path_for(wallet, username)
        if not csv_p.exists():
            continue
        mk = load_trader_markets(csv_p, username, w)
        if len(mk) < WARMUP + 5:
            print(f"  skip {username}: n={len(mk)}")
            continue
        snaps = build_snapshots(mk)
        n_after = 0
        for r in mk.sort_values("end_dt").itertuples(index=False):
            end_dt = pd.Timestamp(r.end_dt).to_pydatetime()
            if end_dt.tzinfo is None:
                end_dt = end_dt.replace(tzinfo=timezone.utc)
            # Prefer first-fill as-of so features match what we would have known
            # when the position was opened (not resolution day − 1d).
            fill_raw = getattr(r, "first_fill_ts", None)
            fill_dt = None
            if fill_raw is not None and not (isinstance(fill_raw, float) and np.isnan(fill_raw)):
                try:
                    fill_ts = pd.Timestamp(fill_raw)
                    if not pd.isna(fill_ts):
                        fill_dt = fill_ts.to_pydatetime()
                        if fill_dt.tzinfo is None:
                            fill_dt = fill_dt.replace(tzinfo=timezone.utc)
                except (TypeError, ValueError):
                    fill_dt = None
            if fill_dt is not None:
                as_of = fill_dt - KNOWLEDGE_LAG
                # Never use knowledge after the game has resolved
                as_of = min(as_of, end_dt - KNOWLEDGE_LAG)
            else:
                as_of = end_dt - KNOWLEDGE_LAG
            snap = lookup_snap(snaps, as_of)
            n_prior = int(snap["n"]) if snap else 0
            if n_prior < WARMUP:
                continue
            n_after += 1
            q = int(snap["q"]) if snap else 0
            median = float(snap["median"]) if snap else 0.0
            roi = float(snap["roi"]) if snap else 0.0
            sport = str(r.sport_type)
            sub = str(getattr(r, "submarket", None) or r.market_type)
            sport_roi = float((snap.get("sport_roi") or {}).get(sport, roi)) if snap else roi
            sub_roi = float((snap.get("sub_roi") or {}).get(f"{sport}|{sub}", sport_roi)) if snap else sport_roi
            lane_ok = sport in (snap.get("sport_roi") or {}) and sport_roi >= MIN_LANE_ROI
            sub_ok = f"{sport}|{sub}" in (snap.get("sub_roi") or {}) and sub_roi >= MIN_LANE_ROI
            rel = (float(r.cost) / median) if median > 0 else 1.0
            px = float(np.clip(r.entry_price, 0.02, 0.98))
            won = bool(r.won)
            rows.append({
                "username": username,
                "wallet": w,
                "end_dt": end_dt,
                "conditionId": str(getattr(r, "conditionId", "") or ""),
                "side": str(getattr(r, "side", "Yes") or "Yes"),
                "sport": sport,
                "sport_family": sport_family(sport),
                "submarket": sub,
                "title": str(r.title or ""),
                "won": won,
                "entry": px,
                "cost": float(r.cost),
                "q": q,
                "n_prior": n_prior,
                "roi": roi,
                "sport_roi": sport_roi,
                "sub_roi": sub_roi,
                "lane_ok": lane_ok,
                "sub_ok": sub_ok,
                "rel": min(rel, 30.0),
                "pnl_0c": unit_pnl(won, px),
                "pnl_2c": unit_pnl(won, min(px + 0.02, 0.98)),
            })
        print(f"  {username:<36} markets={len(mk):>5} after_warmup={n_after:>5}")
    return pd.DataFrame(rows)


def strategy_masks(df: pd.DataFrame) -> dict[str, pd.Series]:
    live = (df["entry"] >= LIVE_LO) & (df["entry"] <= LIVE_HI) & (df["entry"] <= STALE_ENTRY)
    no_nfl = ~df["sport_family"].astype(str).str.contains("NFL", case=False, na=False)
    return {
        "copy_all_warmup": pd.Series(True, index=df.index),
        "live_10_88": live,
        "asof_q50": df["q"] >= 50,
        "asof_q60": df["q"] >= 60,
        "asof_q70": df["q"] >= 70,
        "asof_sport_expert": df["lane_ok"],
        "asof_sub_expert": df["sub_ok"],
        "asof_rel2": df["rel"] >= 2,
        "asof_q50_sport": (df["q"] >= 50) & df["lane_ok"],
        "asof_q60_sport": (df["q"] >= 60) & df["lane_ok"],
        "asof_q50_sport_rel2": (df["q"] >= 50) & df["lane_ok"] & (df["rel"] >= 2),
        "asof_q60_sport_rel2": (df["q"] >= 60) & df["lane_ok"] & (df["rel"] >= 2) & no_nfl,
        "asof_q60_sub_rel2": (df["q"] >= 60) & df["sub_ok"] & (df["rel"] >= 2) & no_nfl,
        "asof_live_q50_sport": live & (df["q"] >= 50) & df["lane_ok"],
        "asof_live_q60_sport_rel2": live & (df["q"] >= 60) & df["lane_ok"] & (df["rel"] >= 2) & no_nfl,
        "asof_ml_sport": df["lane_ok"] & df["submarket"].str.contains("Moneyline", case=False, na=False),
        "asof_flip_sport": df["lane_ok"] & (df["entry"] >= 0.40) & (df["entry"] < 0.60),
    }


PRODUCT_SPECS = [
    {
        "id": "asof_live_q60_sport_rel2",
        "name": "As-of Q60 + sport expert + 2× size (live 10–88¢)",
        "priority": 1,
        "rule": (
            "Single-name copy of a Polydata-matched sports book. At the time of the bet the "
            "trader’s prior Q was ≥60, their prior ROI in that sport was ≥+5%, and the stake "
            "was ≥2× their own median. Price 10–88¢. Skip NFL (negative after 2¢). "
            "Fill their VWAP + 2¢. Hold to resolution."
        ),
        "description": (
            "This is the book to take. Grade, sport lane, and relative size are what we would "
            "have seen before the game resolved — not lifetime stats after the fact. "
            "2+ overlap on these 12 names is almost empty; do not wait for a second voter."
        ),
        "filters": {
            "minTraders": 1,
            "minGrade": 0,
            "minQ": 60,
            "priceLo": 0.10,
            "priceHi": 0.88,
            "minRelBetSize": 2,
            "minSportRoi": 5,
            "excludeUsernames": UNTILABLE,
            "skipSports": ["NFL"],
            "skipMarketTypes": ["Futures"],
            "marketTypes": [],
        },
    },
    {
        "id": "asof_q60_sport_rel2",
        "name": "As-of Q60 + sport expert + 2× size (any price, no NFL)",
        "priority": 2,
        "rule": (
            "Same conviction rule without the live 10–88¢ band. Skip NFL. Use when a Q60 "
            "sport-expert is sizing up on a longshot or a heavy favorite."
        ),
        "description": "Slightly more trades than the live band. Still hold-to-res, still +2¢ fill.",
        "filters": {
            "minTraders": 1,
            "minGrade": 0,
            "minQ": 60,
            "priceLo": 0.02,
            "priceHi": 0.98,
            "minRelBetSize": 2,
            "minSportRoi": 5,
            "excludeUsernames": UNTILABLE,
            "skipSports": ["NFL"],
            "skipMarketTypes": ["Futures"],
            "marketTypes": [],
        },
    },
    {
        "id": "asof_q60_sub_rel2",
        "name": "As-of Q60 + submarket expert + 2× size (no NFL)",
        "priority": 3,
        "rule": (
            "Q ≥ 60, prior ROI in that sport|submarket (moneyline / spread / total / props) ≥ +5%, "
            "stake ≥ 2× their median, no NFL. Fill VWAP + 2¢."
        ),
        "description": "Tighter lane than sport-only. Use when you want ML/spread specialists, not just ‘good at soccer’.",
        "filters": {
            "minTraders": 1,
            "minGrade": 0,
            "minQ": 60,
            "priceLo": 0.02,
            "priceHi": 0.98,
            "minRelBetSize": 2,
            "minSportRoi": 5,
            "excludeUsernames": UNTILABLE,
            "skipSports": ["NFL"],
            "skipMarketTypes": ["Futures"],
            "marketTypes": [],
        },
    },
]


SKIP_SPECS = [
    {
        "id": "asof_q50_sport_rel2",
        "name": "As-of Q50 + sport expert + 2× size — thinner",
        "priority": 80,
        "recommended": False,
        "rule": "Prints after 2¢ but kch123 is negative here, NFL drags, and tcp2 is 42% of the tape. Prefer Q60.",
        "description": "Volume book. Not the take list.",
        "filters": {
            "minTraders": 1, "minQ": 50, "priceLo": 0.02, "priceHi": 0.98,
            "minRelBetSize": 2, "minSportRoi": 5,
            "excludeUsernames": UNTILABLE, "skipSports": [], "marketTypes": [],
        },
    },
    {
        "id": "asof_rel2",
        "name": "Conviction size only (≥2× own median) — thinner",
        "priority": 81,
        "recommended": False,
        "rule": "Prints after 2¢ but NFL is negative and Bienville/ckw bleed. Prefer Q60 + sport + size.",
        "description": "Largest sample. Not the take list.",
        "filters": {
            "minTraders": 1, "minQ": 0, "priceLo": 0.02, "priceHi": 0.98,
            "minRelBetSize": 2,
            "excludeUsernames": UNTILABLE, "skipSports": [], "marketTypes": [],
        },
    },
    {
        "id": "copy_all_warmup",
        "name": "Copy-all of the 12 matched books — skip",
        "priority": 90,
        "recommended": False,
        "rule": "Do not copy every play. After warmup this tape is ~54% WR and negative after juice.",
        "description": "Proof the full book is not an unfiltered edge. tcp2 and kch123 dominate volume and lose at copy prices.",
        "filters": {
            "minTraders": 1, "minQ": 0, "priceLo": 0.02, "priceHi": 0.98,
            "excludeUsernames": UNTILABLE, "skipSports": [], "marketTypes": [],
        },
    },
    {
        "id": "asof_q60",
        "name": "As-of Q60 with no size/sport gate — skip",
        "priority": 91,
        "recommended": False,
        "rule": "Q ≥ 60 alone is not enough. +2¢ ROI is negative. You need sport expertise and size.",
        "description": "Grade without conviction is still a 54–58% favorite book that does not cover juice.",
        "filters": {
            "minTraders": 1, "minQ": 60, "priceLo": 0.02, "priceHi": 0.98,
            "excludeUsernames": UNTILABLE, "skipSports": [], "marketTypes": [],
        },
    },
    {
        "id": "ghost_2plus_ml",
        "name": "GoalLineGhost 2+ moneyline — DO NOT TAKE",
        "priority": 92,
        "recommended": False,
        "rule": "INVALID. Closed-positions were winner-sorted. Ghost public WR is ~53% / PnL −$1.14M.",
        "description": "Kept as a skip card so nobody revives the 98% Ghost cluster from the old Strategies page.",
        "filters": {
            "minTraders": 2, "minQ": 0, "priceLo": 0.10, "priceHi": 0.88,
            "excludeUsernames": ["Cannae"], "requireUsernames": ["GoalLineGhost"],
            "skipSports": ["NFL"], "marketTypes": ["Moneyline", "Moneyline / Match"],
        },
    },
]


def card_from(sub: pd.DataFrame, spec: dict, allow_names: list[str], recommended: bool) -> dict:
    st0 = asof_stat(sub, 0.0)
    st2 = asof_stat(sub, 0.02)
    filters = dict(spec.get("filters") or {})
    filters["allowUsernames"] = allow_names
    rec_ok, rec_why = robust_ok(sub) if recommended else (False, spec.get("rule") or "skip")
    take = bool(recommended and rec_ok)
    return {
        "id": spec["id"],
        "name": spec["name"],
        "recommended": take,
        "priority": spec.get("priority", 99),
        "rule": spec["rule"],
        "description": spec.get("description") or spec["rule"],
        "robust": {"ok": rec_ok, "why": rec_why},
        "filters": filters,
        "join_max_plus_2c": st2,
        "join_max": st0,
        "vwap": st0,
        "vwap_plus_2c": st2,
        "years": year_split(sub, 0.02),
        "quarters": quarter_split(sub, 0.02),
        "by_trader": trader_rows(sub),
        "leave_one_out": leave_one_out(sub)[:12],
        "concentration": concentration(sub),
        "by_sport": breakdown(sub, "sport_family", 0.02),
        "by_submarket": breakdown(sub, "submarket", 0.02),
        "last_20": last_plays(sub, 20),
        "date_span": {
            "first": st2.get("first"),
            "last": st2.get("last"),
            "trades_per_day": st2.get("trades_per_day"),
        },
    }


def write_markdown(
    trusted: list[dict],
    universe: dict,
    results: dict,
    by_trader: list[dict],
    robustness: dict,
    product: list[dict],
) -> str:
    lines = [
        "# Full-book strategies (hold-to-resolution)",
        "",
        "Polydata 80+/90+ sports books whose **WR and PnL match** Polydata (and therefore "
        "Polymarket analytics: `realizedPnl + cashPnl`) are the only names in this tape. "
        "Copy is **hold to resolution**, not scalp PnL. Q / sport / submarket / relative "
        "size are **as-of**: only markets that had already resolved at least one day earlier.",
        "",
        "## Polydata Elite sports vs our score",
        "",
        "| SS | Sports # | Trader | PD WR | Our WR | PD PnL | Our PnL | n closed |",
        "|---:|---------:|--------|------:|-------:|-------:|--------:|---------:|",
    ]
    for t in trusted:
        lines.append(
            f"| {t.get('smart_score')} | {t.get('sports_rank') or '—'} | {t['username']} | "
            f"{t.get('pd_wr')}% | {t.get('our_wr')}% | ${t.get('pd_pnl'):,.0f} | "
            f"${t.get('our_pnl'):,.0f} | {t.get('closed_rows')} |"
        )
    lines += [
        "",
        "## Honest copy results",
        "",
        f"Copy-all of these {universe['wallets']} after warmup: **n={universe['n']} "
        f"WR={universe['win_rate']}% ROI {universe['roi_0c']}% at their price, "
        f"{universe['roi_2c']}% at +2¢.**",
        "",
        "2+ consensus among them is almost empty (they rarely land on the same contract). "
        "The old 98% Ghost 2+ book was a winner-sorted CSV, not an edge.",
        "",
        "| Strategy | n | WR | ROI 0¢ | ROI +2¢ | PF |",
        "|----------|--:|---:|-------:|--------:|---:|",
    ]
    for name, st in sorted(results.items(), key=lambda kv: -kv[1]["roi_2c"]):
        lines.append(
            f"| `{name}` | {st['n']} | {st['win_rate']}% | {st['roi_0c']}% | "
            f"{st['roi_2c']}% | {st.get('pf_0c') or '—'} |"
        )
    lines += [
        "",
        "### Per trader (hold-to-res, after warmup, unfiltered)",
        "",
        "| Trader | n | WR | ROI 0¢ | ROI +2¢ | mean as-of Q |",
        "|--------|--:|---:|-------:|--------:|-------------:|",
    ]
    for r in by_trader:
        lines.append(
            f"| {r['username']} | {r['n']} | {r['win_rate']}% | {r['roi_0c']}% | "
            f"{r['roi_2c']}% | {r['mean_q']} |"
        )
    lines += [
        "",
        "## Robustness on books that print after +2¢",
        "",
    ]
    for sid, rb in robustness.items():
        conc = rb.get("concentration") or {}
        lines.append(
            f"### `{sid}` — {rb.get('n')} plays, +2¢ ROI {rb.get('roi_2c')}%, "
            f"top={conc.get('top')} {conc.get('share')}%"
        )
        lines.append("")
        lines.append("| Dropped | n left | WR | +2¢ ROI |")
        lines.append("|---------|-------:|---:|--------:|")
        for row in rb.get("leave_one_out") or []:
            lines.append(
                f"| {row['dropped']} | {row['n_remaining']} | {row['win_rate']}% | {row['roi_2c']}% |"
            )
        lines.append("")
        lines.append("| Trader | n | share | WR | +2¢ ROI |")
        lines.append("|--------|--:|------:|---:|--------:|")
        for row in rb.get("by_trader") or []:
            lines.append(
                f"| {row['username']} | {row['n']} | {row['share']}% | {row['win_rate']}% | {row['roi_2c']}% |"
            )
        lines.append("")
        if rb.get("quarters"):
            lines.append("| Quarter | n | WR | +2¢ ROI |")
            lines.append("|---------|--:|---:|--------:|")
            for k, v in sorted((rb.get("quarters") or {}).items()):
                lines.append(f"| {k} | {v['n']} | {v['win_rate']}% | {v['roi']}% |")
            lines.append("")
        if rb.get("by_sport"):
            lines.append("| Sport | n | WR | +2¢ ROI |")
            lines.append("|-------|--:|---:|--------:|")
            sports = sorted((rb.get("by_sport") or {}).items(), key=lambda kv: -kv[1]["n"])
            for k, v in sports[:12]:
                lines.append(f"| {k} | {v['n']} | {v['win_rate']}% | {v['roi']}% |")
            lines.append("")

    takes = [s for s in product if s.get("recommended")]
    skips = [s for s in product if not s.get("recommended")]
    lines += [
        "## What we take from this",
        "",
        "1. **Data first.** 80+ Polydata sports names with finishable books now match their WR/PnL. "
        "Mega-whales (RN1, swisstony, Ghost) do not — do not backtest them as copy-sharps.",
        "2. **Do not use 2+ consensus on this list.** Overlap is too thin and it lost.",
        "3. **New product is single-name as-of copy:** only fire when the trader’s *prior* Q and "
        "sport/submarket lane said they were an expert, and size vs their own median showed conviction.",
        "4. Unfiltered copy of kch123 / tcp2 is negative at our fill even though their lifetime "
        "Polydata PnL is huge — they win dollars on size, not on a copyable 54% coin flip.",
        "",
        "### Recommended",
        "",
    ]
    if not takes:
        lines.append("None passed n≥200, +ROI after 2¢, leave-one-out, and concentration.")
        lines.append("")
    else:
        lines.append("| Strategy | n | WR | +2¢ ROI | Why |")
        lines.append("|----------|--:|---:|--------:|-----|")
        for s in takes:
            st = s.get("join_max_plus_2c") or {}
            why = (s.get("robust") or {}).get("why") or ""
            lines.append(
                f"| **{s.get('name')}** | {st.get('n')} | {st.get('win_rate')}% | "
                f"**{st.get('roi')}%** | {why} |"
            )
        lines.append("")
    lines += [
        "### Skip",
        "",
        "| Book | n | +2¢ ROI | Why |",
        "|------|--:|--------:|-----|",
    ]
    for s in skips:
        st = s.get("join_max_plus_2c") or {}
        lines.append(
            f"| {s.get('name')} | {st.get('n') or '—'} | {st.get('roi') if st else '—'}% | {s.get('rule')} |"
        )
    lines.append("")
    return "\n".join(lines) + "\n"


def patch_elites_md(trusted: list[dict]) -> None:
    """Keep POLYDATA_ELITES.md proud-list in sync with trusted_full_books.json."""
    if not ELITES_MD.exists():
        return
    text = ELITES_MD.read_text(encoding="utf-8")
    marker = "**Trusted copy list"
    names = ", ".join(t["username"] for t in trusted)
    block = (
        f"**Proud copy list ({len(trusted)}, n≥40, WR/PnL matched, sports specialists):** {names}\n"
        "\n"
        "Dropped from copy even when Smart Score is 80+: fengdubiying (sports is 5% of PnL), "
        "KeyTransporter (11 closed), asparagus2012 (15 closed), Theo4/Michie (not sports), "
        "RN1/swisstony (10k/sort cap — book unfinished), Ghost (lifetime negative).\n"
    )
    if marker in text:
        head = text.split(marker)[0].rstrip()
        ELITES_MD.write_text(head + "\n\n" + block + "\n", encoding="utf-8")
    else:
        ELITES_MD.write_text(text.rstrip() + "\n\n" + block + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-product", action="store_true", default=True)
    parser.add_argument("--skip-product", action="store_true")
    args = parser.parse_args()
    write_product = bool(args.write_product) and not args.skip_product

    trusted = load_trusted()
    df = collect_plays(trusted)
    if df.empty:
        print("No plays.")
        return 1
    masks = strategy_masks(df)

    print(f"\nUniverse hold-to-res: {len(df):,} plays  WR={df['won'].mean()*100:.1f}%")
    print(f"{'Strategy':<28} {'N':>6} {'WR':>6} {'ROI0':>8} {'ROI2':>8} {'PF0':>6}")
    results: dict[str, dict] = {}
    for name, mask in masks.items():
        sub = df.loc[mask.fillna(False)]
        n = int(len(sub))
        if n == 0:
            continue
        wr = float(sub["won"].mean() * 100)
        roi0 = float(sub["pnl_0c"].sum() / (n * STAKE) * 100)
        roi2 = float(sub["pnl_2c"].sum() / (n * STAKE) * 100)
        pf0 = profit_factor(sub["pnl_0c"].to_numpy())
        results[name] = {
            "n": n, "win_rate": round(wr, 2),
            "roi_0c": round(roi0, 2), "roi_2c": round(roi2, 2),
            "pf_0c": None if pf0 == float("inf") else round(pf0, 2),
            "traders": int(sub["username"].nunique()),
        }
        print(f"{name:<28} {n:>6} {wr:5.1f}% {roi0:7.1f}% {roi2:7.1f}% {pf0:6.2f}")

    by_trader = []
    for name, grp in df.groupby("username"):
        n = len(grp)
        by_trader.append({
            "username": name,
            "n": n,
            "win_rate": round(float(grp["won"].mean() * 100), 2),
            "roi_0c": round(float(grp["pnl_0c"].sum() / (n * STAKE) * 100), 2),
            "roi_2c": round(float(grp["pnl_2c"].sum() / (n * STAKE) * 100), 2),
            "mean_q": round(float(grp["q"].mean()), 1),
        })
    by_trader.sort(key=lambda r: -r["roi_2c"])

    robustness: dict[str, dict] = {}
    print("\nRobustness (n≥200 and +ROI at +2¢):")
    for name, mask in masks.items():
        st = results.get(name)
        if not st or st["n"] < 200 or st["roi_2c"] <= 0:
            continue
        sub = df.loc[mask.fillna(False)]
        ok, why = robust_ok(sub)
        rb = {
            "n": st["n"],
            "win_rate": st["win_rate"],
            "roi_2c": st["roi_2c"],
            "ok": ok,
            "why": why,
            "concentration": concentration(sub),
            "by_trader": trader_rows(sub),
            "leave_one_out": leave_one_out(sub),
            "quarters": quarter_split(sub, 0.02),
            "by_sport": breakdown(sub, "sport_family", 0.02),
        }
        robustness[name] = rb
        conc = rb["concentration"]
        print(
            f"  {name:<28} ok={ok}  top={conc['top']} {conc['share']}%  {why}"
        )

    allow_names = [t["username"] for t in trusted]
    product: list[dict] = []
    for spec in PRODUCT_SPECS:
        mask = masks.get(spec["id"])
        sub = df.loc[mask.fillna(False)] if mask is not None else df.iloc[0:0]
        product.append(card_from(sub, spec, allow_names, recommended=True))
    for spec in SKIP_SPECS:
        mask = masks.get(spec["id"])
        sub = df.loc[mask.fillna(False)] if mask is not None else df.iloc[0:0]
        product.append(card_from(sub, spec, allow_names, recommended=False))

    print("\nProduct:")
    for s in product:
        st = s.get("join_max_plus_2c") or {}
        flag = "TAKE" if s.get("recommended") else "skip"
        print(
            f"  {flag:<4} {s['id']:<28} n={st.get('n', 0):>5} "
            f"WR={st.get('win_rate', 0):5.1f}% +2¢={st.get('roi', 0):6.1f}%  "
            f"{(s.get('robust') or {}).get('why')}"
        )

    universe = {
        "n": int(len(df)),
        "wallets": int(df["wallet"].nunique()),
        "win_rate": round(float(df["won"].mean() * 100), 2),
        "roi_0c": round(float(df["pnl_0c"].sum() / (len(df) * STAKE) * 100), 2),
        "roi_2c": round(float(df["pnl_2c"].sum() / (len(df) * STAKE) * 100), 2),
        "max_resolved_date": str(df["end_dt"].max())[:10],
    }
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": (
            "Hold-to-resolution as-of copy of Polydata-matched full books. "
            "Win iff curPrice>=0.99. Q/sport/sub/rel from expanding book with 1-day lag."
        ),
        "trusted": trusted,
        "universe": universe,
        "strategies": results,
        "by_trader": by_trader,
        "robustness": {
            k: {
                "n": v["n"], "win_rate": v["win_rate"], "roi_2c": v["roi_2c"],
                "ok": v["ok"], "why": v["why"],
                "concentration": v["concentration"],
                "leave_one_out": v["leave_one_out"],
                "by_trader": v["by_trader"],
                "quarters": {qk: {"n": qv["n"], "win_rate": qv["win_rate"], "roi": qv["roi"]}
                             for qk, qv in (v.get("quarters") or {}).items()},
            }
            for k, v in robustness.items()
        },
    }
    OUT.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    try:
        df.to_csv(PLAYS_CSV, index=False)
    except OSError as exc:
        print(f"  [warn] plays csv: {exc}")

    MD.write_text(
        write_markdown(trusted, universe, results, by_trader, robustness, product),
        encoding="utf-8",
    )
    patch_elites_md(trusted)

    if write_product:
        tail = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "as_of": datetime.now(timezone.utc).date().isoformat(),
            "fill": "vwap+2c",
            "stake": STAKE,
            "method": (
                "Hold-to-resolution as-of copy of 12 Polydata-matched sports books. "
                "Win = token resolved to $1. Fill = their VWAP + 2¢. Grade, sport/submarket "
                "expertise, and relative wager use only prior resolved markets (1-day lag). "
                "2+ Ghost consensus is retired — that tape was winner-sorted."
            ),
            "copy_all": {
                "n": universe["n"],
                "win_rate": universe["win_rate"],
                "implied_wr": round(float(df["entry"].mean() * 100), 1),
                "edge": round(universe["win_rate"] - float(df["entry"].mean() * 100), 1),
                "roi": universe["roi_2c"],
            },
            "strategies": product,
            "universe": {
                "max_resolved_date": universe["max_resolved_date"],
                "trusted_wallets": universe["wallets"],
                "n_plays": universe["n"],
            },
        }
        TAIL.write_text(json.dumps(tail, indent=2, default=str), encoding="utf-8")
        print(f"Wrote {TAIL}")

    print(f"Wrote {OUT}\nWrote {MD}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
