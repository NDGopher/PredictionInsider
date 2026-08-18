#!/usr/bin/env python3
"""Robust tailing research: freshness, steady PnL curves, dual-fill, CLV, combos, expert lanes.

Uses the already-graded CSVs and the walk-forward 2+ consensus tape (not live API ROI).
CLV close/ask lines come from CLOB /prices-history when --clv is set.

Writes:
  pnl_analysis/output/robust_research.json
  pnl_analysis/ROBUST_TAIL_RESEARCH.md
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from itertools import combinations
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from discover_traders import scan_new_traders  # noqa: E402
from position_utils import read_trader_csv, sport_family  # noqa: E402
from run_full_pipeline import OUTPUT_DIR, csv_path_for, roster_traders  # noqa: E402
from trader_health_review import load_books  # noqa: E402
from walkforward_consensus_backtest import (  # noqa: E402
    LIVE_HI,
    LIVE_LO,
    STAKE,
    STALE_ENTRY,
    summarize,
)

AS_OF = datetime.now(timezone.utc)
STALE_DAYS = 21
STEADY_MIN_N90 = 20
STEADY_MIN_ROI90 = 3.0
STEADY_MIN_HOLD90 = 2.0
STEADY_MIN_SHARPE = 0.8
MAX_JOIN_MEDIAN = 25_000.0
MIN_JOIN_MEDIAN = 40.0
GRINDER_WR = 94.0
CLOB = "https://clob.polymarket.com"
CLOB_SLEEP = 0.18
CONC_WARN = 0.35
DROP_NAMES = ("GoalLineGhost", "ferrariChampions2026", "RN1", "Cannae", "BoomLaLa", "0xheavy888")
SPORT_FILTER_KEY = {
    "Soccer": "Soccer",
    "NBA": "NBA",
    "NFL": "NFL",
    "NHL": "NHL",
    "MLB": "MLB",
    "Tennis": "Tennis",
    "UFC/MMA": "UFC/MMA",
    "College Sports": "College Sports",
    "Esports": "eSports",
    "eSports": "eSports",
    "Politics": "Politics",
    "Other": "Other",
    "WNBA": "Other",
}
SUB_TO_MTYPE = {
    "Spread": "spread",
    "Total": "total",
    "Moneyline": "moneyline",
    "Futures": "futures",
    "Draw": "draw",
}


def _json_safe(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return 0.0
    if isinstance(obj, (np.floating,)):
        val = float(obj)
        return 0.0 if math.isnan(val) or math.isinf(val) else val
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    return obj


def nameset(raw: Any) -> set[str]:
    return {x.strip() for x in str(raw or "").split(",") if x.strip()}


def load_health() -> dict:
    path = OUTPUT_DIR / "trader_health.json"
    if not path.exists():
        raise FileNotFoundError(f"Missing {path}; run npm run backtest:health first")
    return json.loads(path.read_text(encoding="utf-8"))


def load_consensus() -> pd.DataFrame:
    path = OUTPUT_DIR / "walkforward_consensus_filtered_2plus.csv"
    if not path.exists():
        raise FileNotFoundError(f"Missing {path}; run npm run backtest:consensus first")
    df = pd.read_csv(path)
    df["end_dt"] = pd.to_datetime(df["end_dt"], utc=True)
    df["won"] = df["won"].astype(str).str.lower().isin(["true", "1", "yes"])
    for col in ("vwap", "join_max", "grade", "avg_q", "min_q", "n_traders", "n_counters", "n_q50", "rel_size"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    if "submarket" not in df.columns:
        df["submarket"] = df.get("market_type", "Moneyline")
    df["name_set"] = df["traders"].map(nameset)
    return df


def equity_metrics(mk: pd.DataFrame, days: int = 180) -> dict:
    empty = {
        "n": 0, "roi": 0.0, "sharpe": 0.0, "max_dd_pct": 0.0, "profit_factor": 0.0,
        "up_days": 0, "trade_days": 0, "up_day_pct": 0.0, "monthly": [],
        "vol_daily": 0.0, "worst_month_roi": 0.0, "best_month_roi": 0.0,
    }
    if mk is None or mk.empty:
        return empty
    cut = AS_OF - timedelta(days=days)
    sub = mk[mk["end_dt"] >= cut].copy()
    if sub.empty:
        sub = mk.copy()
    sub = sub.sort_values("end_dt")
    cost = float(sub["cost"].sum())
    pnl = float(sub["hold_pnl"].sum())
    roi = (pnl / cost * 100.0) if cost > 0 else 0.0
    daily = sub.groupby(sub["end_dt"].dt.date)["hold_pnl"].sum()
    vals = daily.to_numpy(dtype=float)
    sharpe = 0.0
    vol = 0.0
    if len(vals) >= 5 and float(vals.std()) > 0:
        vol = float(vals.std())
        sharpe = float(vals.mean() / vals.std() * math.sqrt(365.0))
    eq = np.cumsum(vals) if len(vals) else np.array([0.0])
    peak = np.maximum.accumulate(eq)
    dd = float((eq - peak).min()) if len(eq) else 0.0
    dd_pct = (dd / max(cost, 1.0)) * 100.0
    gp = float(vals[vals > 0].sum()) if len(vals) else 0.0
    gl = float(-vals[vals < 0].sum()) if len(vals) else 0.0
    pf = (gp / gl) if gl > 0 else (float("inf") if gp > 0 else 0.0)
    up = int((vals > 0).sum()) if len(vals) else 0
    months = []
    if not sub.empty:
        g = sub.groupby(sub["end_dt"].dt.to_period("M"))
        for period, grp in g:
            c = float(grp["cost"].sum())
            p = float(grp["hold_pnl"].sum())
            months.append({
                "month": str(period),
                "n": int(len(grp)),
                "pnl": round(p, 2),
                "roi": round((p / c * 100.0) if c > 0 else 0.0, 2),
            })
    m_rois = [m["roi"] for m in months]
    return {
        "n": int(len(sub)),
        "roi": round(roi, 2),
        "sharpe": round(sharpe, 2),
        "max_dd_pct": round(dd_pct, 2),
        "profit_factor": round(pf if pf != float("inf") else 99.0, 3),
        "up_days": up,
        "trade_days": int(len(vals)),
        "up_day_pct": round(up / max(len(vals), 1) * 100.0, 1),
        "monthly": months[-8:],
        "vol_daily": round(vol, 2),
        "worst_month_roi": round(min(m_rois) if m_rois else 0.0, 2),
        "best_month_roi": round(max(m_rois) if m_rois else 0.0, 2),
    }


def classify_steady(row: dict, curve: dict, median_cost: float) -> tuple[str, str]:
    days = row.get("days_since_last")
    if days is None:
        days = 999
    if days < 0:
        days = 0
    wr = float((row.get("overall") or {}).get("win_rate") or 0)
    n90 = int((row.get("last_90d") or {}).get("n") or 0)
    roi90 = float((row.get("last_90d") or {}).get("roi") or 0)
    hold90 = float((row.get("last_90d_hold") or {}).get("roi") or 0)
    n30 = int((row.get("last_30d") or {}).get("n") or 0)
    roi30 = float((row.get("last_30d") or {}).get("roi") or 0)
    action = str(row.get("action") or "")
    if action == "KICK" or row.get("possibly_quit") or row.get("untailable"):
        return "SKIP", row.get("reason") or "kicked / quit / untailable"
    if days > STALE_DAYS:
        return "STALE", f"Last dated event {row.get('max_date')} ({days}d ago). Do not tail stale markers."
    if median_cost >= MAX_JOIN_MEDIAN:
        return "UNTAILABLE", f"Median stake ${median_cost:,.0f} — cannot join at $100/play."
    if median_cost < MIN_JOIN_MEDIAN:
        return "UNTAILABLE", f"Median stake ${median_cost:,.0f} — mill-bet / dust, not copyable."
    if wr >= GRINDER_WR and float((row.get("overall") or {}).get("roi") or 0) < 8:
        return "GRINDER", f"{wr:.1f}% WR — favorite/bond pattern, copy edge is tiny."
    if wr >= 90.0 and float((row.get("overall") or {}).get("roi") or 0) < 6:
        return "GRINDER", f"{wr:.1f}% WR / {float((row.get('overall') or {}).get('roi') or 0):.1f}% ROI — grinder-adjacent, not a steady directional book."
    if n90 < STEADY_MIN_N90:
        return "THIN", f"Last 90d only {n90} resolved markets."
    if roi90 < STEADY_MIN_ROI90 and hold90 < STEADY_MIN_HOLD90:
        return "FADED", f"Last 90d dashboard {roi90:.1f}% / hold {hold90:.1f}%."
    if n30 >= 15 and roi30 <= -15:
        return "VOLATILE", f"Last 30d dashboard {roi30:.1f}% (n={n30})."
    sharpe = float(curve.get("sharpe") or 0)
    dd = float(curve.get("max_dd_pct") or 0)
    worst_m = float(curve.get("worst_month_roi") or 0)
    if sharpe < STEADY_MIN_SHARPE:
        return "VOLATILE", f"180d daily Sharpe {sharpe:.2f} (want ≥{STEADY_MIN_SHARPE})."
    if dd <= -25:
        return "VOLATILE", f"180d max drawdown {dd:.1f}% of cost."
    if worst_m <= -20 and len(curve.get("monthly") or []) >= 3:
        return "VOLATILE", f"Worst recent month {worst_m:.1f}% ROI."
    if action == "OVERLAY":
        return "OVERLAY", row.get("reason") or "Overlay only."
    if action == "TIGHTEN":
        return "LANE_ONLY", row.get("reason") or "Restrict to winning sport/submarket."
    return "STEADY", (
        f"Active {row.get('max_date')}, last 90d dash {roi90:.1f}% (n={n90}), "
        f"Sharpe {sharpe:.2f}, DD {dd:.1f}%."
    )


def expert_lanes(row: dict) -> dict:
    lanes = row.get("by_sport_submarket") or []
    experts = [x for x in lanes if int(x.get("n") or 0) >= 20 and float(x.get("roi") or 0) >= 8]
    bleeds = [x for x in lanes if int(x.get("n") or 0) >= 20 and float(x.get("roi") or 0) <= -8]
    sports = row.get("by_sport") or {}
    pos_sports = [k for k, v in sports.items() if int(v.get("n") or 0) >= 25 and float(v.get("roi") or 0) >= 8]
    neg_sports = [k for k, v in sports.items() if int(v.get("n") or 0) >= 25 and float(v.get("roi") or 0) <= -8]
    subs = row.get("by_submarket") or {}
    neg_subs = [k for k, v in subs.items() if int(v.get("n") or 0) >= 25 and float(v.get("roi") or 0) <= -8]
    do_not_tail = [SPORT_FILTER_KEY.get(s, s) for s in neg_sports]
    auto_tail = [SPORT_FILTER_KEY.get(s, s) for s in pos_sports]
    mtypes = []
    for s in neg_subs:
        mt = SUB_TO_MTYPE.get(s)
        if mt and mt != "moneyline":
            mtypes.append(mt)
    # Don't globally mute a market type if an expert lane uses it.
    expert_types = {SUB_TO_MTYPE.get(x.get("submarket")) for x in experts}
    mtypes = [m for m in mtypes if m not in expert_types]
    return {
        "experts": [
            {"sport": x["sport"], "submarket": x["submarket"], "n": x["n"], "roi": x["roi"], "win_rate": x.get("win_rate")}
            for x in sorted(experts, key=lambda z: -float(z["roi"]))[:10]
        ],
        "bleeds": [
            {"sport": x["sport"], "submarket": x["submarket"], "n": x["n"], "roi": x["roi"], "win_rate": x.get("win_rate")}
            for x in sorted(bleeds, key=lambda z: float(z["roi"]))[:10]
        ],
        "proposed_filter": {
            "autoTail": sorted(set(auto_tail)),
            "doNotTail": sorted(set(do_not_tail)),
            "doNotTailMarketTypes": sorted(set(mtypes)),
        },
    }


def live_mask(df: pd.DataFrame) -> pd.Series:
    return (
        (df["n_traders"] >= 2)
        & (df["vwap"] >= LIVE_LO)
        & (df["vwap"] <= LIVE_HI)
        & (df["vwap"] <= STALE_ENTRY)
    )


def strategy_masks(df: pd.DataFrame) -> dict[str, pd.Series]:
    live = live_mask(df)
    is_ml = df["submarket"].astype(str).isin(["Moneyline", "Moneyline / Match"]) | df["market_type"].astype(str).str.contains(
        "Moneyline", na=False
    )
    soccer = df["sport_type"].astype(str).str.startswith("SOCCER")
    no_cannae = ~df["traders"].astype(str).str.contains("Cannae", na=False)
    no_nfl = ~df["sport_type"].astype(str).str.contains("NFL", na=False)
    no_glg = ~df["traders"].astype(str).str.contains("GoalLineGhost", na=False)
    return {
        "copy_2plus_any": df["n_traders"] >= 2,
        "live_2plus": live,
        "favorites_60_80": live & (df["vwap"] >= 0.60) & (df["vwap"] < 0.80),
        "q50_moneyline": live & (df["min_q"] >= 50) & is_ml,
        "q50_moneyline_no_glg": live & (df["min_q"] >= 50) & is_ml & no_glg,
        "both_q50_ml": live & (df["n_q50"] >= 2) & is_ml,
        "grade70_live": live & (df["grade"] >= 70) & no_cannae & no_nfl,
        "core_live_no_cannae_nfl": live & no_cannae & no_nfl,
        "soccer_ml_no_cannae": live & soccer & is_ml & no_cannae,
        "soccer_ml_with_cannae": live & soccer & is_ml,
        "grade_lt60": (df["n_traders"] >= 2) & (df["grade"] < 60),
    }


def dual_fill_stats(sub: pd.DataFrame) -> dict:
    if sub.empty:
        return {"n": 0}
    return {
        "n": int(len(sub)),
        "their_entry_vwap": summarize(sub, "vwap", 0.0),
        "ask_at_alert_join_max": summarize(sub, "join_max", 0.0),
        "ask_plus_2c": summarize(sub, "join_max", 0.02),
        "ask_plus_5c": summarize(sub, "join_max", 0.05),
    }


def concentration(sub: pd.DataFrame) -> dict:
    if sub.empty:
        return {"primary_share": 0.0, "mention_share": {}, "n_primaries": 0, "top_primary": ""}
    prim = sub["primary"].astype(str)
    vc = prim.value_counts()
    mentions: Counter[str] = Counter()
    for s in sub["name_set"]:
        for n in s:
            mentions[n] += 1
    n = max(len(sub), 1)
    return {
        "top_primary": str(vc.index[0]) if len(vc) else "",
        "primary_share": round(float(vc.iloc[0] / n), 3) if len(vc) else 0.0,
        "n_primaries": int(prim.nunique()),
        "mention_share": {k: round(v / n, 3) for k, v in mentions.most_common(8)},
    }


def leave_one_out(base: pd.DataFrame, names: tuple[str, ...]) -> list[dict]:
    out = []
    for name in names:
        remaining = base["name_set"].map(lambda s, n=name: s - {n})
        keep = remaining.map(len) >= 2
        sub = base.loc[keep].copy()
        sub["n_traders_loo"] = remaining.loc[keep].map(len)
        st = dual_fill_stats(sub)
        conc = concentration(sub) if not sub.empty else {}
        out.append({
            "dropped": name,
            "n_remaining": int(len(sub)),
            "ask_plus_2c": st.get("ask_plus_2c") or {"n": 0, "roi": 0},
            "their_entry_vwap": st.get("their_entry_vwap") or {"n": 0, "roi": 0},
            "concentration": conc,
        })
    return out


def pair_books(df: pd.DataFrame, min_n: int = 20) -> list[dict]:
    plays: dict[tuple[str, str], list[int]] = defaultdict(list)
    for i, s in enumerate(df["name_set"]):
        names = sorted(s)
        if len(names) < 2:
            continue
        for a, b in combinations(names, 2):
            plays[(a, b)].append(i)
    rows = []
    for (a, b), idxs in plays.items():
        if len(idxs) < min_n:
            continue
        sub = df.iloc[idxs]
        st = dual_fill_stats(sub)
        ask = st.get("ask_plus_2c") or {}
        rows.append({
            "pair": f"{a} + {b}",
            "a": a,
            "b": b,
            "n": int(len(sub)),
            "roi_ask_2c": ask.get("roi"),
            "wr": ask.get("win_rate"),
            "sharpe": ask.get("sharpe_daily_roi"),
            "max_dd": ask.get("max_dd"),
            "their_vwap_roi": (st.get("their_entry_vwap") or {}).get("roi"),
            "last": ask.get("last"),
            "first": ask.get("first"),
        })
    rows.sort(key=lambda r: (-(r.get("roi_ask_2c") or -999), -(r.get("n") or 0)))
    return rows[:40]


def triple_books(df: pd.DataFrame, min_n: int = 12) -> list[dict]:
    plays: dict[tuple[str, ...], list[int]] = defaultdict(list)
    for i, s in enumerate(df["name_set"]):
        names = sorted(s)
        if len(names) < 3:
            continue
        for trip in combinations(names, 3):
            plays[trip].append(i)
    rows = []
    for trip, idxs in plays.items():
        if len(idxs) < min_n:
            continue
        sub = df.iloc[idxs]
        ask = summarize(sub, "join_max", 0.02)
        if ask["n"] < min_n:
            continue
        rows.append({
            "triple": " + ".join(trip),
            "n": ask["n"],
            "roi_ask_2c": ask["roi"],
            "wr": ask["win_rate"],
            "sharpe": ask["sharpe_daily_roi"],
            "last": ask["last"],
        })
    rows.sort(key=lambda r: (-(r.get("roi_ask_2c") or -999), -(r.get("n") or 0)))
    return rows[:20]


def parse_ts(val: Any) -> datetime | None:
    if val is None or str(val).strip() in ("", "nan", "None"):
        return None
    try:
        num = float(val)
    except (TypeError, ValueError):
        dt = pd.to_datetime(val, utc=True, errors="coerce")
        return dt.to_pydatetime() if pd.notna(dt) else None
    if num > 1e12:
        num /= 1000.0
    if num < 1e9:
        return None
    return datetime.fromtimestamp(num, tz=timezone.utc)


def build_token_index(condition_ids: set[str], wallets: list[tuple[str, str]]) -> dict[str, dict]:
    """conditionId -> {asset, alert_ts} from roster CSVs (max fill timestamp before end)."""
    idx: dict[str, dict] = {}
    usecols = ["asset", "conditionId", "timestamp", "endDate"]
    for wallet, username in wallets:
        path = csv_path_for(wallet, username)
        if not path.exists():
            continue
        try:
            raw = pd.read_csv(path, usecols=lambda c: c in usecols, dtype=str, low_memory=False)
        except Exception:
            try:
                raw = read_trader_csv(path)
            except Exception as e:
                print(f"  [warn] token index {username}: {e}")
                continue
        if "conditionId" not in raw.columns:
            continue
        raw["conditionId"] = raw["conditionId"].astype(str)
        hit = raw[raw["conditionId"].isin(condition_ids)]
        if hit.empty:
            continue
        for cid, g in hit.groupby("conditionId"):
            asset = ""
            if "asset" in g.columns:
                for a in g["asset"].astype(str):
                    if a and a not in ("nan", "None"):
                        asset = a
                        break
            alert = None
            end_dt = None
            if "endDate" in g.columns:
                ends = pd.to_datetime(g["endDate"], utc=True, errors="coerce")
                if ends.notna().any():
                    end_dt = ends.min().to_pydatetime()
            if "timestamp" in g.columns:
                for ts in g["timestamp"]:
                    dt = parse_ts(ts)
                    if dt is None:
                        continue
                    if end_dt is not None and dt > end_dt:
                        continue
                    if alert is None or dt > alert:
                        alert = dt
            prev = idx.get(str(cid))
            if prev is None:
                idx[str(cid)] = {"asset": asset, "alert_ts": alert.isoformat() if alert else None}
            else:
                if not prev.get("asset") and asset:
                    prev["asset"] = asset
                if alert and (not prev.get("alert_ts") or alert.isoformat() > str(prev["alert_ts"])):
                    prev["alert_ts"] = alert.isoformat()
    return idx


def load_clob_cache() -> dict:
    path = OUTPUT_DIR / "clob_history_cache.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_clob_cache(cache: dict) -> None:
    path = OUTPUT_DIR / "clob_history_cache.json"
    path.write_text(json.dumps(cache), encoding="utf-8")


def fetch_history(asset: str, start_ts: int, end_ts: int, cache: dict) -> list[dict]:
    key = f"{asset}:{start_ts}:{end_ts}"
    if key in cache:
        return cache[key]
    if asset in cache and isinstance(cache[asset], list):
        return cache[asset]
    try:
        resp = requests.get(
            f"{CLOB}/prices-history",
            params={"market": asset, "interval": "1h", "fidelity": 60, "startTs": start_ts, "endTs": end_ts},
            timeout=20,
        )
        data = resp.json() if resp.status_code == 200 else {}
    except requests.RequestException:
        data = {}
    hist = data.get("history") if isinstance(data, dict) else None
    if not isinstance(hist, list):
        hist = []
    rows = []
    for pt in hist:
        if not isinstance(pt, dict):
            continue
        try:
            rows.append({"t": int(pt.get("t") or 0), "p": float(pt.get("p") or 0)})
        except (TypeError, ValueError):
            continue
    cache[key] = rows
    time.sleep(CLOB_SLEEP)
    return rows


def lookup_price(hist: list[dict], ts: int) -> float | None:
    best = None
    best_t = -1
    for pt in hist:
        t = int(pt.get("t") or 0)
        p = float(pt.get("p") or 0)
        if t <= ts and t >= best_t and 0.0 < p < 1.0:
            best_t = t
            best = p
    return best


def clv_for_book(sub: pd.DataFrame, token_idx: dict, cache: dict, limit: int) -> dict:
    if sub.empty:
        return {"n": 0, "coverage": 0.0}
    work = sub.sort_values("end_dt", ascending=False).head(limit).copy()
    realized = []
    expected = []
    clv_cents = []
    rows_out = []
    fetched = 0
    for r in work.itertuples(index=False):
        cid = str(r.conditionId)
        meta = token_idx.get(cid) or {}
        asset = str(meta.get("asset") or "")
        end_dt = r.end_dt.to_pydatetime() if hasattr(r.end_dt, "to_pydatetime") else r.end_dt
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)
        alert = None
        if meta.get("alert_ts"):
            try:
                alert = datetime.fromisoformat(str(meta["alert_ts"]).replace("Z", "+00:00"))
            except ValueError:
                alert = None
        if alert is None or alert >= end_dt:
            alert = end_dt - timedelta(hours=6)
        join = float(np.clip(float(r.join_max) + 0.02, 0.02, 0.98))
        vwap = float(np.clip(float(r.vwap), 0.02, 0.98))
        ask = None
        close = None
        if asset and fetched < limit:
            start_ts = int((alert - timedelta(days=2)).timestamp())
            end_ts = int((end_dt + timedelta(hours=2)).timestamp())
            hist = fetch_history(asset, start_ts, end_ts, cache)
            fetched += 1
            ask = lookup_price(hist, int(alert.timestamp()))
            close_p = lookup_price(hist, int((end_dt - timedelta(minutes=30)).timestamp()))
            if close_p is not None and 0.02 < close_p < 0.98:
                close = close_p
        fill_ask = float(np.clip(ask if ask and 0.02 < ask < 0.98 else join, 0.02, 0.98))
        won = bool(r.won)
        real = (1.0 / fill_ask - 1.0) if won else -1.0
        realized.append(real)
        if close is not None:
            exp = close / fill_ask - 1.0
            expected.append(exp)
            clv_cents.append((close - fill_ask) * 100.0)
        rows_out.append({
            "end": str(end_dt)[:10],
            "title": str(r.title)[:80],
            "won": won,
            "vwap": round(vwap, 4),
            "join_plus_2c": round(join, 4),
            "clob_ask": round(ask, 4) if ask is not None else None,
            "close_line": round(close, 4) if close is not None else None,
            "realized_roi": round(real * 100.0, 2),
            "expected_clv_roi": round((close / fill_ask - 1.0) * 100.0, 2) if close is not None else None,
        })
    n = len(realized)
    n_clv = len(expected)
    return {
        "n": n,
        "n_with_close_line": n_clv,
        "coverage": round(n_clv / max(n, 1), 3),
        "realized_roi": round(float(np.mean(realized) * 100.0), 2) if n else 0.0,
        "expected_clv_roi": round(float(np.mean(expected) * 100.0), 2) if n_clv else None,
        "avg_clv_cents": round(float(np.mean(clv_cents)), 2) if clv_cents else None,
        "clob_ask_coverage": round(sum(1 for r in rows_out if r["clob_ask"] is not None) / max(n, 1), 3),
        "sample": rows_out[:12],
    }


def log_telemetry(ok: bool, detail: str) -> None:
    stamp = {
        "ok": ok,
        "at": datetime.now(timezone.utc).isoformat(),
        "detail": detail[:2000],
    }
    try:
        (OUTPUT_DIR / ".last_research_run").write_text(json.dumps(stamp), encoding="utf-8")
    except Exception as e:
        print(f"[warn] research stamp: {e}")
    url = os.environ.get("DATABASE_URL")
    if not url:
        return
    try:
        import psycopg2  # type: ignore

        conn = psycopg2.connect(url)
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS pipeline_script_health (
                name text PRIMARY KEY,
                ok boolean NOT NULL,
                detail text,
                updated_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        cur.execute(
            """
            INSERT INTO pipeline_script_health (name, ok, detail, updated_at)
            VALUES (%s, %s, %s, now())
            ON CONFLICT (name) DO UPDATE SET ok = EXCLUDED.ok, detail = EXCLUDED.detail, updated_at = now()
            """,
            ("robust_tail_research", ok, detail[:2000]),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[warn] research db telemetry: {e}")


def md_escape(s: str) -> str:
    return str(s).replace("|", "/")


def write_markdown(payload: dict) -> str:
    lines: list[str] = []
    a = payload
    lines.append("# Robust tail research")
    lines.append("")
    lines.append(f"As of **{a['as_of']}**. Data through last resolved consensus play **{a.get('universe', {}).get('max_resolved_date')}**.")
    lines.append("")
    lines.append("Run: `npm run backtest:research`")
    lines.append("")
    lines.append("## What to tail")
    for i, rec in enumerate(a.get("what_to_tail") or [], 1):
        lines.append(f"{i}. **{md_escape(rec.get('title', ''))}** — {md_escape(rec.get('why', ''))}")
    lines.append("")
    lines.append("## Dual fill (their entry vs ask-at-alert)")
    lines.append("")
    lines.append("Their entry = size-weighted VWAP of the wallets on the play. Ask-at-alert proxy = later member's price (`join_max`); live tailing uses **join_max + 2¢**. $100/play, hold to resolution.")
    lines.append("")
    lines.append("| Book | n | Their VWAP ROI | Ask (join_max) ROI | Ask+2¢ ROI | WR | Sharpe | Last |")
    lines.append("|------|--:|---------------:|-------------------:|-----------:|---:|-------:|------|")
    for b in a.get("books") or []:
        v = b.get("their_entry_vwap") or {}
        j = b.get("ask_at_alert_join_max") or {}
        s = b.get("ask_plus_2c") or {}
        lines.append(
            f"| {md_escape(b.get('name', ''))} | {s.get('n', 0)} | "
            f"{v.get('roi', 0)}% | {j.get('roi', 0)}% | **{s.get('roi', 0)}%** | "
            f"{s.get('win_rate', 0)}% | {s.get('sharpe_daily_roi', 0)} | {s.get('last', '')} |"
        )
    lines.append("")
    lines.append("## CLV (alert → close)")
    clv = a.get("clv") or {}
    lines.append("")
    lines.append(
        f"Close line = last CLOB mid in (2¢, 98¢) before event end. "
        f"Expected ROI = close / fill − 1. Realized ROI = binary hold-to-res at the same fill. "
        f"Coverage {clv.get('q50_moneyline', {}).get('coverage', 0)} of the Q50 moneyline sample."
    )
    lines.append("")
    lines.append("| Book | n | CLOB ask cov. | Close-line cov. | Realized ROI | Expected (CLV) ROI | Avg CLV |")
    lines.append("|------|--:|--------------:|----------------:|-------------:|-------------------:|--------:|")
    for key, label in (("q50_moneyline", "2+ Q50 moneyline"), ("favorites_60_80", "Favorites 60–80¢"), ("soccer_ml_no_cannae", "Soccer ML no Cannae")):
        c = clv.get(key) or {}
        lines.append(
            f"| {label} | {c.get('n', 0)} | {c.get('clob_ask_coverage', 0)} | {c.get('coverage', 0)} | "
            f"{c.get('realized_roi', 0)}% | {c.get('expected_clv_roi', '—')}% | {c.get('avg_clv_cents', '—')}¢ |"
        )
    lines.append("")
    lines.append("## Steady winners (active, joinable, low-vol)")
    lines.append("")
    lines.append("| Trader | Grade | Last | 90d dash | 180d Sharpe | Max DD | Median | Why |")
    lines.append("|--------|-------|------|---------:|------------:|-------:|-------:|-----|")
    for t in a.get("roster") or []:
        if t.get("steady_grade") in ("SKIP",):
            continue
        c = t.get("curve") or {}
        lines.append(
            f"| {md_escape(t.get('username', ''))} | **{t.get('steady_grade')}** | {t.get('max_date')} | "
            f"{(t.get('last_90d') or {}).get('roi', 0)}% | {c.get('sharpe', 0)} | {c.get('max_dd_pct', 0)}% | "
            f"${t.get('median_cost', 0):,.0f} | {md_escape(t.get('steady_reason', ''))} |"
        )
    lines.append("")
    lines.append("## Combinations")
    lines.append("")
    lines.append("Leave-one-out on the 2+ Q50 moneyline book (play dropped if fewer than 2 voters remain):")
    lines.append("")
    lines.append("| Dropped | Remaining n | Ask+2¢ ROI | Top remaining |")
    lines.append("|---------|------------:|-----------:|---------------|")
    for row in a.get("leave_one_out") or []:
        conc = row.get("concentration") or {}
        ask = row.get("ask_plus_2c") or {}
        lines.append(
            f"| {md_escape(row.get('dropped', ''))} | {row.get('n_remaining', 0)} | "
            f"{ask.get('roi', 0)}% | {md_escape(conc.get('top_primary', ''))} {float(conc.get('primary_share') or 0)*100:.0f}% |"
        )
    lines.append("")
    lines.append("Best co-occurring pairs (plays containing both names), ask+2¢:")
    lines.append("")
    lines.append("| Pair | n | ROI | WR | Sharpe | Last |")
    lines.append("|------|--:|----:|---:|-------:|------|")
    for p in (a.get("pairs") or [])[:15]:
        lines.append(
            f"| {md_escape(p.get('pair', ''))} | {p.get('n')} | {p.get('roi_ask_2c')}% | "
            f"{p.get('wr')}% | {p.get('sharpe')} | {p.get('last')} |"
        )
    lines.append("")
    if a.get("triples"):
        lines.append("Best triples:")
        lines.append("")
        lines.append("| Triple | n | ROI | WR | Last |")
        lines.append("|--------|--:|----:|---:|------|")
        for t in (a.get("triples") or [])[:8]:
            lines.append(
                f"| {md_escape(t.get('triple', ''))} | {t.get('n')} | {t.get('roi_ask_2c')}% | {t.get('wr')}% | {t.get('last')} |"
            )
        lines.append("")
    lines.append("## Expert lanes (weight these, mute bleeds)")
    lines.append("")
    for t in a.get("roster") or []:
        if t.get("steady_grade") in ("SKIP", "STALE", "UNTAILABLE", "GRINDER"):
            continue
        lanes = t.get("lanes") or {}
        exp = lanes.get("experts") or []
        bleed = lanes.get("bleeds") or []
        if not exp and not bleed:
            continue
        lines.append(f"### {md_escape(t.get('username', ''))}")
        if exp:
            lines.append("Experts: " + "; ".join(f"{x['sport']}/{x['submarket']} {x['roi']}% (n={x['n']})" for x in exp[:6]))
        if bleed:
            lines.append("Bleed: " + "; ".join(f"{x['sport']}/{x['submarket']} {x['roi']}% (n={x['n']})" for x in bleed[:6]))
        pf = (lanes.get("proposed_filter") or {})
        if pf.get("doNotTail") or pf.get("doNotTailMarketTypes"):
            lines.append(
                f"Proposed mute: sports `{', '.join(pf.get('doNotTail') or []) or '—'}` · "
                f"types `{', '.join(pf.get('doNotTailMarketTypes') or []) or '—'}`"
            )
        lines.append("")
    disc = a.get("discovery") or {}
    lines.append("## New names not on our list")
    lines.append("")
    recs = disc.get("recommended") or []
    if not recs:
        lines.append("No off-list sports-leaderboard wallets passed the honest closed+open screen this run.")
    else:
        lines.append("Screen only (not full-open). Do not tail until a unique open-book grade.")
        lines.append("")
        lines.append("| Username | LB PnL | Hold ROI | Closed ROI | Bias | Windows |")
        lines.append("|----------|-------:|---------:|-----------:|-----:|---------|")
        for r in recs:
            lines.append(
                f"| {md_escape(r.get('username', ''))} | ${r.get('best_pnl', 0):,.0f} | "
                f"{r.get('sample_hold_roi', 0)}% | {r.get('sample_roi', 0)}% | "
                f"{r.get('closed_only_bias', 0):+.0f} | {','.join(r.get('windows') or [])} |"
            )
    lines.append("")
    lines.append("## Method")
    lines.append("")
    lines.append("- ROI/PnL from PostgreSQL-ingested CSVs (hold-to-res + dashboard cash+realized). Never live portfolio math.")
    lines.append("- Event dates from endDate / slug / title. Redeem timestamps are not recency.")
    lines.append("- Consensus tape = walk-forward 2+ filtered wallets, warmed up, category filters applied.")
    lines.append("- Ask-at-alert = max member VWAP (when the later voter made a 2+ alert possible), plus 2¢ slip. Optional CLOB mid at that timestamp.")
    lines.append("- CLV expected ROI uses the last non-terminal CLOB price before endDate.")
    lines.append("")
    return "\n".join(lines) + "\n"


def pick_what_to_tail(books: list[dict], loo: list[dict], conc: dict) -> list[dict]:
    by_id = {b["id"]: b for b in books}
    recs = []
    q50 = by_id.get("q50_moneyline") or {}
    q50n = by_id.get("q50_moneyline_no_glg") or {}
    fav = by_id.get("favorites_60_80") or {}
    soc = by_id.get("soccer_ml_no_cannae") or {}
    glg_loo = next((x for x in loo if x.get("dropped") == "GoalLineGhost"), None)
    q50_roi = ((q50.get("ask_plus_2c") or {}).get("roi") or 0)
    q50n_roi = ((q50n.get("ask_plus_2c") or {}).get("roi") or 0)
    fav_roi = ((fav.get("ask_plus_2c") or {}).get("roi") or 0)
    share = float(conc.get("primary_share") or 0)
    if q50_roi > 0 and (glg_loo and ((glg_loo.get("ask_plus_2c") or {}).get("roi") or 0) > 0) and share <= 0.50:
        recs.append({
            "title": "Default: 2+ Q50 moneyline, join_max+2¢, no NFL, no Cannae voter",
            "why": f"Ask+2¢ ROI {q50_roi}% on {(q50.get('ask_plus_2c') or {}).get('n')} plays. Still positive after dropping GoalLineGhost.",
            "strategy_id": "grade70_moneyline",
        })
    elif q50n_roi > 0:
        recs.append({
            "title": "2+ Q50 moneyline but cap GoalLineGhost (do not let one wallet dominate)",
            "why": f"Full Q50 book is concentrated. Without GoalLineGhost ask+2¢ is {q50n_roi}%. Tail the lane, not the name.",
            "strategy_id": "moneyline_only",
        })
    else:
        recs.append({
            "title": "Favorites 60–80¢ (2+ live)",
            "why": f"Less concentrated. Ask+2¢ ROI {fav_roi}% — slower, steadier than the Q50 moneyline bomb.",
            "strategy_id": "favorites_60_80",
        })
    if fav_roi > 0:
        recs.append({
            "title": "Favorites 60–80¢ as the low-vol book",
            "why": f"Ask+2¢ {fav_roi}% WR {(fav.get('ask_plus_2c') or {}).get('win_rate')}%. Use this when you do not want GoalLineGhost-sized variance.",
            "strategy_id": "favorites_60_80",
        })
    soc_roi = ((soc.get("ask_plus_2c") or {}).get("roi") or 0)
    recs.append({
        "title": "Soccer moneyline overlay without Cannae in the 2+ cluster",
        "why": f"Ask+2¢ {soc_roi}%. Cannae is overlay-only (soccer ML NO), never an unfiltered voter.",
        "strategy_id": "soccer_no_cannae",
    })
    recs.append({
        "title": "Mute bleed lanes; only count a wallet where they are experts",
        "why": "Per-trader sport × submarket filters. Ignore places they bleed even if they are KEEP overall.",
        "strategy_id": None,
    })
    return recs[:5]


def main() -> int:
    parser = argparse.ArgumentParser(description="Robust tailing research")
    parser.add_argument("--clv", action="store_true", help="Fetch CLOB prices-history for CLV (slower)")
    parser.add_argument("--clv-limit", type=int, default=350, help="Max unique plays to price per book")
    parser.add_argument("--discover", action="store_true", help="Scan sports leaderboard for off-list names")
    parser.add_argument("--skip-curves", action="store_true", help="Skip CSV equity curves (health JSON only)")
    args = parser.parse_args()
    OUTPUT_DIR.mkdir(exist_ok=True)
    try:
        health = load_health()
        cl = load_consensus()
    except FileNotFoundError as e:
        print(e)
        log_telemetry(False, str(e))
        return 1

    print(f"Health as_of={health.get('as_of')}  consensus rows={len(cl):,}  last={str(cl['end_dt'].max())[:10]}")
    traders = health.get("traders") or []
    roster_out: list[dict] = []
    wallet_by_name: dict[str, str] = {}
    for rec in traders:
        username = rec.get("username") or ""
        wallet = str(rec.get("wallet") or "").lower()
        wallet_by_name[username] = wallet
        median_cost = 0.0
        curve = {
            "n": 0, "roi": 0.0, "sharpe": 0.0, "max_dd_pct": 0.0, "profit_factor": 0.0,
            "up_days": 0, "trade_days": 0, "up_day_pct": 0.0, "monthly": [],
        }
        if not args.skip_curves and rec.get("action") in ("KEEP", "TIGHTEN", "OVERLAY", "WATCH"):
            path = csv_path_for(wallet, username)
            if path.exists():
                try:
                    mk, _dash = load_books(path, username, wallet)
                    if mk is not None and not mk.empty:
                        median_cost = float(mk["cost"].median())
                        curve = equity_metrics(mk)
                except Exception as e:
                    print(f"  [warn] curve {username}: {e}")
        grade, reason = classify_steady(rec, curve, median_cost)
        lanes = expert_lanes(rec) if rec.get("action") != "KICK" else {}
        roster_out.append({
            "username": username,
            "wallet": wallet,
            "action": rec.get("action"),
            "max_date": rec.get("max_date"),
            "days_since_last": rec.get("days_since_last"),
            "possibly_quit": rec.get("possibly_quit"),
            "untailable": rec.get("untailable"),
            "overall": rec.get("overall"),
            "last_90d": rec.get("last_90d"),
            "last_60d": rec.get("last_60d"),
            "last_30d": rec.get("last_30d"),
            "last_90d_hold": rec.get("last_90d_hold"),
            "median_cost": round(median_cost, 2),
            "curve": curve,
            "steady_grade": grade,
            "steady_reason": reason,
            "lanes": lanes,
            "quality_proxy": rec.get("quality_proxy"),
        })
        print(f"  {username:<32} {grade:<10} last={rec.get('max_date')} sharpe={curve.get('sharpe')}")

    masks = strategy_masks(cl)
    books = []
    labels = {
        "q50_moneyline": "2+ Q50 moneyline",
        "q50_moneyline_no_glg": "2+ Q50 moneyline (no GoalLineGhost)",
        "both_q50_ml": "2+ both Q≥50 moneyline",
        "favorites_60_80": "Favorites 60–80¢",
        "grade70_live": "Grade 70+ live, no Cannae/NFL",
        "core_live_no_cannae_nfl": "Core 2+ live, no Cannae/NFL",
        "soccer_ml_no_cannae": "Soccer ML no Cannae",
        "soccer_ml_with_cannae": "Soccer ML with Cannae",
        "live_2plus": "Any 2+ live 10–88¢",
        "grade_lt60": "Grade <60 (do not take)",
    }
    for sid, mask in masks.items():
        if sid not in labels:
            continue
        sub = cl.loc[mask].copy()
        pack = dual_fill_stats(sub)
        pack["id"] = sid
        pack["name"] = labels[sid]
        pack["concentration"] = concentration(sub)
        pack["by_sport_submarket"] = []
        if not sub.empty:
            tmp = sub.copy()
            tmp["sport_fam"] = tmp["sport_type"].map(sport_family)
            for (sp, sm), grp in tmp.groupby(["sport_fam", "submarket"]):
                st = summarize(grp, "join_max", 0.02)
                if st["n"] >= 8:
                    pack["by_sport_submarket"].append({"sport": str(sp), "submarket": str(sm), **st})
            pack["by_sport_submarket"].sort(key=lambda r: -r["n"])
        books.append(pack)
        s = pack.get("ask_plus_2c") or {}
        print(
            f"  book {sid:<28} n={s.get('n', 0):<5} vwap={((pack.get('their_entry_vwap') or {}).get('roi'))} "
            f"join={((pack.get('ask_at_alert_join_max') or {}).get('roi'))} +2c={s.get('roi')}%"
        )

    q50 = cl.loc[masks["q50_moneyline"]].copy()
    loo = leave_one_out(q50, DROP_NAMES)
    pairs = pair_books(q50 if len(q50) >= 40 else cl.loc[masks["live_2plus"]], min_n=15)
    triples = triple_books(q50 if len(q50) >= 40 else cl.loc[masks["live_2plus"]], min_n=10)
    q50_conc = concentration(q50)

    clv_payload: dict[str, Any] = {}
    if args.clv:
        print("Building token index for CLV…")
        wanted = pd.concat(
            [
                cl.loc[masks["q50_moneyline"]],
                cl.loc[masks["favorites_60_80"]],
                cl.loc[masks["soccer_ml_no_cannae"]],
            ]
        ).drop_duplicates("conditionId")
        cutoff = AS_OF - timedelta(days=120)
        wanted = wanted[wanted["end_dt"] >= cutoff]
        cids = set(wanted["conditionId"].astype(str))
        active = [
            (r["wallet"], r["username"])
            for r in roster_out
            if r.get("action") in ("KEEP", "TIGHTEN", "OVERLAY")
        ]
        token_idx = build_token_index(cids, active)
        print(f"  indexed {len(token_idx)} / {len(cids)} conditionIds")
        cache = load_clob_cache()
        try:
            for key in ("q50_moneyline", "favorites_60_80", "soccer_ml_no_cannae"):
                sub = cl.loc[masks[key]]
                sub = sub[sub["end_dt"] >= cutoff]
                print(f"  CLV {key} n={len(sub)} limit={args.clv_limit}")
                clv_payload[key] = clv_for_book(sub, token_idx, cache, args.clv_limit)
        finally:
            save_clob_cache(cache)

    discovery: dict[str, Any] = {}
    if args.discover:
        print("Scanning sports leaderboard for off-list names…")
        try:
            discovery = scan_new_traders(max_new=10, min_pnl=25_000, min_vol=40_000, sample_pages=3)
            discovery = {
                "generated_at": discovery.get("generated_at"),
                "leaderboard_unique": discovery.get("leaderboard_unique"),
                "known_wallets": discovery.get("known_wallets"),
                "recommended": discovery.get("recommended") or [],
                "new_candidates": [
                    {
                        "username": r.get("username"),
                        "wallet": r.get("wallet"),
                        "best_pnl": r.get("best_pnl"),
                        "sample_hold_roi": r.get("sample_hold_roi"),
                        "sample_roi": r.get("sample_roi"),
                        "closed_only_bias": r.get("closed_only_bias"),
                        "sample_hold_wr": r.get("sample_hold_wr"),
                        "windows": r.get("windows"),
                        "screen_score": r.get("screen_score"),
                    }
                    for r in (discovery.get("new_candidates") or [])[:20]
                ],
            }
        except Exception as e:
            print(f"[warn] discovery: {e}")
            discovery = {"error": str(e), "recommended": []}

    what = pick_what_to_tail(books, loo, q50_conc)
    freshness = {
        "health_as_of": health.get("as_of"),
        "health_generated_at": health.get("generated_at"),
        "consensus_last_play": str(cl["end_dt"].max())[:10] if len(cl) else None,
        "stale_traders": [t["username"] for t in roster_out if t["steady_grade"] == "STALE"],
        "steady_traders": [t["username"] for t in roster_out if t["steady_grade"] == "STEADY"],
        "lane_only": [t["username"] for t in roster_out if t["steady_grade"] == "LANE_ONLY"],
    }
    payload = {
        "generated_at": AS_OF.isoformat(),
        "as_of": AS_OF.date().isoformat(),
        "method": (
            "Hold-to-resolution walk-forward on 2+ filtered wallets. Dual fill = trader VWAP vs "
            "join_max (later entry / ask-at-alert proxy) vs join_max+2¢. CLV = CLOB close line vs that fill. "
            "Steady-winner gate: last event ≤21d, last 90d n≥20 and ROI≥3%, daily Sharpe≥0.8, "
            "joinable median stake, not 94%+ WR grinders."
        ),
        "universe": {
            "max_resolved_date": str(cl["end_dt"].max())[:10] if len(cl) else None,
            "n_2plus": int(len(cl)),
            "health_counts": health.get("counts"),
        },
        "freshness": freshness,
        "what_to_tail": what,
        "books": books,
        "leave_one_out": loo,
        "pairs": pairs,
        "triples": triples,
        "q50_concentration": q50_conc,
        "clv": clv_payload,
        "roster": roster_out,
        "discovery": discovery,
        "proposed_filters": [
            {
                "username": t["username"],
                "wallet": t["wallet"],
                "filter": (t.get("lanes") or {}).get("proposed_filter"),
                "steady_grade": t["steady_grade"],
            }
            for t in roster_out
            if t.get("action") in ("KEEP", "TIGHTEN", "OVERLAY") and (t.get("lanes") or {}).get("proposed_filter")
        ],
    }
    out_json = OUTPUT_DIR / "robust_research.json"
    out_json.write_text(json.dumps(_json_safe(payload), indent=2), encoding="utf-8")
    md_path = Path(__file__).resolve().parent / "ROBUST_TAIL_RESEARCH.md"
    md_path.write_text(write_markdown(payload), encoding="utf-8")
    print(f"\nWrote {out_json}")
    print(f"Wrote {md_path}")
    log_telemetry(True, f"books={len(books)} steady={len(freshness['steady_traders'])} last={freshness['consensus_last_play']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
