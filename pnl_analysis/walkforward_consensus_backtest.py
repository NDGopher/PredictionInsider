#!/usr/bin/env python3
"""
Walk-forward MULTI-TRADER consensus tailing backtest.

Fixes vs the first tailing backtest (which produced fake 70–95% ROIs):
  * Win = token resolved to $1 (curPrice >= 0.99), loss = resolved to $0.
    Never treat realizedPnl > 0 (scalps / early exits) as a binary win.
  * Unit of a play = conditionId + side, not eventSlug blends of ML/spread/total.
  * Trader Q / lane ROI / median stake use only markets that had already
    resolved at least 1 day before this market's endDate (no same-day leak).
  * A tailable signal requires 2+ warmed-up tracked wallets on the same side
    with size, matching how live /api/signals actually grades.

Fills:
  * their_vwap  — dollar-weighted average of members' avgPrice (got their price)
  * join_max    — max member avgPrice (worse of the group)
  * +1c / +2c / +5c on each of those

Writes:
  pnl_analysis/output/walkforward_consensus_backtest.json
  pnl_analysis/output/walkforward_consensus_trades.csv  (best strategy only)
"""
from __future__ import annotations

import json
import math
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_trader import get_market_type, get_sport, price_bucket  # noqa: E402
from position_utils import (  # noqa: E402
    attach_event_dates,
    classify_submarket,
    play_label,
    sport_family,
)
from run_full_pipeline import OUTPUT_DIR, csv_path_for, roster_traders  # noqa: E402

STAKE = 100.0
WARMUP = 20
MIN_LANE_N = 8
MIN_LANE_ROI = 5.0
KNOWLEDGE_LAG = timedelta(days=1)
MIN_VOTE_USD = 200.0
MIN_COST = 25.0
STALE_ENTRY = 0.88  # live signals drop avgEntry > 0.88
LIVE_LO, LIVE_HI = 0.10, 0.90
SLIPS = (0.0, 0.01, 0.02, 0.05)
MARKET_MAKERS = {"0xd9e0aaca471f489be338fd0f91a26e8669a805f2"}
ELITE_TS = Path(__file__).resolve().parents[1] / "server" / "eliteAnalysis.ts"


# ── Category filters (same lists the live scorer uses) ────────────────────────

def _parse_ts_string_arrays(block: str, key: str) -> list[str]:
    m = re.search(rf"{key}:\s*\[(.*?)\]", block, re.S)
    if not m:
        return []
    return re.findall(r'"([^"]+)"', m.group(1))


def load_category_filters() -> dict[str, dict[str, list[str]]]:
    if not ELITE_TS.exists():
        return {}
    text = ELITE_TS.read_text(encoding="utf-8")
    start = text.find("export const TRADER_CATEGORY_FILTERS")
    if start < 0:
        return {}
    # Cut at the next top-level export after the filters object.
    rest = text[start:]
    end = rest.find("\nexport const", 40)
    chunk = rest if end < 0 else rest[:end]
    out: dict[str, dict[str, list[str]]] = {}
    for m in re.finditer(
        r'"((?:0x)[0-9a-fA-F]+)"\s*:\s*\{(.*?)\n  \},',
        chunk,
        re.S,
    ):
        wallet = m.group(1).lower()
        body = m.group(2)
        out[wallet] = {
            "doNotTail": _parse_ts_string_arrays(body, "doNotTail"),
            "doNotTailMarketTypes": _parse_ts_string_arrays(body, "doNotTailMarketTypes"),
            "doNotTailSides": _parse_ts_string_arrays(body, "doNotTailSides"),
            "doNotTailTitleKeywords": _parse_ts_string_arrays(body, "doNotTailTitleKeywords"),
        }
    return out


def load_aliases() -> dict[str, str]:
    """username-or-wallet -> canonical wallet."""
    if not ELITE_TS.exists():
        return {}
    text = ELITE_TS.read_text(encoding="utf-8")
    out: dict[str, str] = {}
    for m in re.finditer(
        r"canonicalWallet:\s*\"((?:0x)[0-9a-fA-F]+)\"",
        text,
    ):
        # pair with the object key one block up
        pass
    for m in re.finditer(
        r"^\s*([a-zA-Z0-9_-]+):\s*\{\s*canonicalWallet:\s*\"((?:0x)[0-9a-fA-F]+)\"",
        text,
        re.M,
    ):
        out[m.group(1).lower()] = m.group(2).lower()
        out[m.group(2).lower()] = m.group(2).lower()
    return out


def sport_keys(sport: str) -> list[str]:
    s = str(sport)
    keys = [s]
    if s.startswith("SOCCER"):
        keys += ["Soccer"]
        if "UCL" in s:
            keys += ["UCL"]
    elif s == "ESPORTS":
        keys += ["eSports", "LoL", "CS2", "Valorant", "Dota2", "CoD"]
    elif s == "OTHER":
        keys += ["Other", "College Sports"]
    elif s == "POLITICS":
        keys += ["Politics"]
    return keys


def market_keys(market_type: str) -> list[str]:
    m = str(market_type).lower()
    if "spread" in m:
        return ["spread"]
    if "total" in m or "o/u" in m:
        return ["total"]
    if "future" in m:
        return ["futures"]
    if "draw" in m:
        return ["draw"]
    return ["moneyline"]


def trader_blocked(
    filters: dict[str, dict[str, list[str]]],
    wallet: str,
    sport: str,
    market_type: str,
    side: str,
    title: str,
) -> bool:
    spec = filters.get(wallet.lower())
    if not spec:
        return False
    sk = set(sport_keys(sport))
    if sk & set(spec.get("doNotTail") or []):
        return True
    mk = set(market_keys(market_type))
    if mk & set(spec.get("doNotTailMarketTypes") or []):
        return True
    sides = {x.lower() for x in (spec.get("doNotTailSides") or [])}
    if side.lower() in sides:
        return True
    title_l = (title or "").lower()
    for kw in spec.get("doNotTailTitleKeywords") or []:
        if kw.lower() in title_l:
            return True
    return False


# ── Expanding quality book (hold-to-resolution PnL, not scalp PnL) ───────────

@dataclass
class Lane:
    n: int = 0
    pnl: float = 0.0
    cost: float = 0.0
    wins: int = 0

    def roi(self) -> float:
        return (self.pnl / self.cost * 100.0) if self.cost > 0 else 0.0


@dataclass
class ExpandingBook:
    n: int = 0
    pnl: float = 0.0
    cost: float = 0.0
    wins: int = 0
    losses: int = 0
    sports: dict[str, Lane] = field(default_factory=lambda: defaultdict(Lane))
    markets: dict[str, Lane] = field(default_factory=lambda: defaultdict(Lane))
    buckets: dict[str, Lane] = field(default_factory=lambda: defaultdict(Lane))
    daily: dict[object, float] = field(default_factory=dict)
    costs: list[float] = field(default_factory=list)

    def update(self, *, pnl: float, cost: float, won: bool, sport: str, market: str, entry: float, day) -> None:
        self.n += 1
        self.pnl += pnl
        self.cost += cost
        if won:
            self.wins += 1
        else:
            self.losses += 1
        for store, key in (
            (self.sports, sport),
            (self.markets, market),
            (self.buckets, price_bucket(entry)),
        ):
            lane = store[key]
            lane.n += 1
            lane.pnl += pnl
            lane.cost += cost
            if won:
                lane.wins += 1
        self.daily[day] = self.daily.get(day, 0.0) + pnl
        self.costs.append(cost)

    def median_stake(self) -> float:
        # Ignore dust so a $5k play is not a fake 50× vs an $80 median of mill-bets.
        big = [c for c in self.costs if c >= 200.0]
        src = big if len(big) >= 10 else self.costs
        return float(np.median(src)) if src else 0.0

    def overall_roi(self) -> float:
        return (self.pnl / self.cost * 100.0) if self.cost > 0 else 0.0

    def win_rate(self) -> float:
        d = self.wins + self.losses
        return (self.wins / d * 100.0) if d else 0.0

    def sharpe(self) -> float:
        vals = np.array(list(self.daily.values()), dtype=float)
        if len(vals) < 2 or float(vals.std()) == 0:
            return 0.0
        return float(vals.mean() / vals.std() * math.sqrt(365.0))

    def quality_score(self) -> int:
        if self.n < WARMUP:
            return 0
        roi = self.overall_roi()
        wr = self.win_rate()
        sharpe = self.sharpe()
        days = list(self.daily.values())
        profitable_days = sum(1 for x in days if x > 0)
        total_days = max(len(days), 1)
        sharpe_score = min(max(sharpe / 8 * 30, 0), 30)
        roi_score = min(max(roi / 15 * 25, 0), 25)
        wr_score = min(max((wr - 48) / 15 * 15, 0), 15)
        cons_score = min(max(profitable_days / total_days * 10, 0), 10)
        vol_score = min(max(math.log10(max(self.cost, 1)) / math.log10(5_000_000) * 5, 0), 5)
        base = sharpe_score + roi_score + wr_score + cons_score + vol_score
        mid = []
        flip = self.buckets.get("Flip (40-60c)")
        und = self.buckets.get("Underdog (20-40c)")
        if flip and flip.n >= 10:
            mid.append(flip.roi())
        if und and und.n >= 10:
            mid.append(und.roi())
        midzone = sum(mid) / len(mid) if mid else 0.0
        if midzone >= 15:
            flip_bonus = 15
        elif midzone >= 10:
            flip_bonus = 10
        elif midzone >= 5:
            flip_bonus = 5
        else:
            flip_bonus = 0
        anchor = max(self.pnl, abs(self.pnl), 1.0)
        leakage = 0
        for lane in self.sports.values():
            if lane.n >= 10 and lane.roi() < -5 and lane.pnl < -5_000:
                ratio = abs(lane.pnl) / anchor
                if ratio >= 0.30:
                    leakage += 10
                elif ratio >= 0.10:
                    leakage += 5
                else:
                    leakage += 2
        sp = self.markets.get("Spread")
        if sp and sp.n >= 10 and sp.roi() < -10:
            leakage += 3
        q = int(round(base + flip_bonus - min(leakage, 15)))
        return max(0, min(q, 100))

    def sport_roi(self, sport: str) -> float:
        lane = self.sports.get(sport)
        if lane and lane.n >= MIN_LANE_N:
            return lane.roi()
        return self.overall_roi()

    def lane_ok(self, sport: str) -> bool:
        lane = self.sports.get(sport)
        if not lane or lane.n < MIN_LANE_N:
            return False
        return lane.roi() >= MIN_LANE_ROI

    def snapshot(self, end_dt: datetime) -> dict:
        sport_roi = {k: v.roi() for k, v in self.sports.items() if v.n >= MIN_LANE_N}
        return {
            "end_dt": end_dt,
            "q": self.quality_score(),
            "n": self.n,
            "roi": round(self.overall_roi(), 2),
            "wr": round(self.win_rate(), 2),
            "median": self.median_stake(),
            "sport_roi": sport_roi,
        }


def rel_size_pts(rel: float) -> int:
    if rel >= 10:
        return 15
    if rel >= 7:
        return 13
    if rel >= 5:
        return 10
    if rel >= 3:
        return 7
    if rel >= 2:
        return 4
    return 0


def compute_confidence(
    avg_roi: float,
    consensus_pct: float,
    value_delta: float,
    avg_net: float,
    trader_count: int,
    avg_q: float,
    counters: int,
    rel: float,
) -> tuple[int, dict[str, int]]:
    roi_pct = int(round(min(max(avg_roi / 25.0, 0.0), 1.0) * 40))
    counter_penalty = min(counters * 20, 40) if counters > 0 else 0
    adj = max(0.0, consensus_pct - counter_penalty)
    cons_weight = 0.15 if trader_count == 1 else 0.30
    cons_pct = int(round(min(max(adj - 50.0, 0.0) / 50.0, 1.0) * 100 * cons_weight))
    value_pct = int(round(min(max((value_delta + 0.05) / 0.10, 0.0), 1.0) * 20))
    size_pct = int(round(min(avg_net / 15_000.0, 1.0) * 10))
    rel_pts = rel_size_pts(rel)
    if trader_count >= 3 and avg_q >= 50:
        tier_bonus = 8
    elif trader_count >= 2:
        tier_bonus = 4
    elif avg_q >= 75:
        tier_bonus = 3
    else:
        tier_bonus = 0
    quality_boost = 6 if avg_q >= 80 else 4 if avg_q >= 70 else 2 if avg_q >= 55 else 0
    base = roi_pct + cons_pct + value_pct + size_pct + rel_pts + quality_boost
    single_cap = 82 if rel >= 5 else 76 if rel >= 3 else 72 if rel >= 2 else 68
    cap = single_cap if trader_count == 1 else 100
    score = int(max(min(base + tier_bonus, cap), 0))
    return score, {
        "roi_pct": roi_pct,
        "cons_pct": cons_pct,
        "value_pct": value_pct,
        "size_pct": size_pct,
        "rel_pts": rel_pts,
        "tier_bonus": tier_bonus,
        "quality_boost": quality_boost,
    }


# ── Load directional resolved markets ─────────────────────────────────────────

def load_trader_markets(csv_path: Path, username: str, wallet: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path, low_memory=False)
    need = [
        "conditionId", "avgPrice", "totalBought", "realizedPnl", "cashPnl",
        "curPrice", "title", "slug", "eventSlug", "outcome", "endDate", "status",
        "timestamp", "initialValue",
    ]
    for col in need:
        if col not in df.columns:
            df[col] = np.nan
    for col in ("avgPrice", "totalBought", "realizedPnl", "cashPnl", "curPrice", "initialValue"):
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)
    price_res = (df["curPrice"] >= 0.99) | (df["curPrice"] <= 0.01)
    if "redeemable" in df.columns:
        redeem_res = df["redeemable"].astype(str).str.lower().isin(["true", "1", "yes"])
        resolved = price_res | redeem_res
    else:
        resolved = price_res
    df = df[resolved].copy()
    if df.empty:
        return df
    df["side"] = df["outcome"].astype(str).str.strip().str.lower()
    df.loc[df["side"].eq("yes"), "side"] = "Yes"
    df.loc[df["side"].eq("no"), "side"] = "No"
    bought_cost = df["totalBought"] * df["avgPrice"]
    df["cost"] = bought_cost.where(bought_cost > 0, df["initialValue"])
    df["sport_type"] = df.apply(get_sport, axis=1)
    df["market_type"] = df.apply(get_market_type, axis=1)
    df["submarket"] = df.apply(classify_submarket, axis=1)
    # Drop 95c+ NO bonds
    df = df[~((df["side"] == "No") & (df["avgPrice"] >= 0.95))].copy()
    # Both-sides hedge: drop the whole condition for this trader
    if "conditionId" in df.columns:
        sides = df.groupby("conditionId")["side"].agg(lambda s: set(s))
        hedged = {cid for cid, ss in sides.items() if "Yes" in ss and "No" in ss}
        if hedged:
            df = df[~df["conditionId"].isin(hedged)].copy()
    df = df[df["cost"] >= MIN_COST].copy()
    df = attach_event_dates(df)
    df["end_dt"] = df["event_dt"]
    df = df.dropna(subset=["end_dt", "conditionId"])
    # Price can sit at 0/1 on still-open futures. Only count games that have already happened.
    horizon = datetime.now(timezone.utc) + timedelta(days=1)
    df = df[df["end_dt"] <= horizon]
    if df.empty:
        return df
    df["won"] = df["curPrice"] >= 0.99
    df["entry_price"] = df["avgPrice"].clip(0.02, 0.98)
    # Hold-to-resolution PnL (what a tailer who copies and holds would get)
    df["hold_pnl"] = np.where(
        df["won"],
        df["cost"] * (1.0 / df["entry_price"] - 1.0),
        -df["cost"],
    )
    def _wavg(g: pd.DataFrame) -> float:
        w = g["cost"].replace(0, 1e-9)
        return float(np.average(g["entry_price"], weights=w))

    g = df.groupby(["conditionId", "side"], dropna=False)
    prices = g.apply(_wavg, include_groups=False)
    agg = g.agg(
        cost=("cost", "sum"),
        hold_pnl=("hold_pnl", "sum"),
        won=("won", "first"),
        cur_price=("curPrice", "first"),
        sport_type=("sport_type", "first"),
        market_type=("market_type", "first"),
        submarket=("submarket", "first"),
        title=("title", "first"),
        event_slug=("eventSlug", "first"),
        slug=("slug", "first"),
        end_dt=("end_dt", "min"),
    ).reset_index()
    agg["entry_price"] = agg.set_index(["conditionId", "side"]).index.map(prices)
    agg["username"] = username
    agg["wallet"] = wallet.lower()
    agg["entry_price"] = agg["entry_price"].clip(0.02, 0.98)
    return agg


def build_snapshots(markets: pd.DataFrame) -> list[dict]:
    book = ExpandingBook()
    snaps: list[dict] = []
    for row in markets.sort_values("end_dt").itertuples(index=False):
        # Snapshot BEFORE this market is known (knowledge is this end_dt)
        # Caller looks up snaps with end_dt <= as_of.
        book.update(
            pnl=float(row.hold_pnl),
            cost=float(row.cost),
            won=bool(row.won),
            sport=str(row.sport_type),
            market=str(row.market_type),
            entry=float(row.entry_price),
            day=row.end_dt.date(),
        )
        snaps.append(book.snapshot(row.end_dt))
    return snaps


def lookup_snap(snaps: list[dict], as_of: datetime) -> dict | None:
    lo, hi, found = 0, len(snaps) - 1, None
    while lo <= hi:
        mid = (lo + hi) // 2
        if snaps[mid]["end_dt"] <= as_of:
            found = snaps[mid]
            lo = mid + 1
        else:
            hi = mid - 1
    return found


# ── Stats ─────────────────────────────────────────────────────────────────────

def max_drawdown(pnls: np.ndarray) -> float:
    if len(pnls) == 0:
        return 0.0
    eq = np.cumsum(pnls)
    peak = np.maximum.accumulate(eq)
    return float((eq - peak).min())


def profit_factor(pnls: np.ndarray) -> float:
    gp = float(pnls[pnls > 0].sum()) if len(pnls) else 0.0
    gl = float(-pnls[pnls < 0].sum()) if len(pnls) else 0.0
    if gl <= 0:
        return float("inf") if gp > 0 else 0.0
    return gp / gl


def daily_roi_sharpe(dates: list, pnls: np.ndarray) -> float:
    if len(pnls) < 10:
        return 0.0
    by_pnl: dict[object, float] = defaultdict(float)
    by_n: dict[object, int] = defaultdict(int)
    for d, x in zip(dates, pnls):
        day = d.date() if hasattr(d, "date") else d
        by_pnl[day] += float(x)
        by_n[day] += 1
    rois = np.array([by_pnl[d] / (by_n[d] * STAKE) for d in by_pnl], dtype=float)
    if len(rois) < 10 or float(rois.std()) == 0:
        return 0.0
    return float(rois.mean() / rois.std() * math.sqrt(365.0))


def summarize(sub: pd.DataFrame, fill_col: str, slip: float) -> dict:
    if sub.empty:
        return {
            "n": 0, "wins": 0, "losses": 0, "win_rate": 0.0,
            "unit_pnl": 0.0, "expectancy": 0.0, "roi": 0.0,
            "profit_factor": 0.0, "sharpe_daily_roi": 0.0, "max_dd": 0.0,
            "avg_grade": 0.0, "avg_q": 0.0, "avg_fill": 0.0, "avg_vwap": 0.0,
            "implied_wr": 0.0, "edge": 0.0, "avg_traders": 0.0, "avg_rel": 0.0,
            "calmar": 0.0, "days": 0, "trades_per_day": 0.0, "first": None, "last": None,
        }
    fills = np.clip(sub[fill_col].to_numpy(dtype=float) + slip, 0.02, 0.98)
    won = sub["won"].to_numpy()
    pnls = np.where(won, STAKE * (1.0 / fills - 1.0), -STAKE)
    n = int(len(sub))
    wins = int(won.sum())
    wr = wins / n * 100.0
    upnl = float(pnls.sum())
    implied = float(fills.mean() * 100.0)
    dates = sub["end_dt"].tolist()
    dd = max_drawdown(pnls)
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
        "avg_grade": round(float(sub["grade"].mean()), 1),
        "avg_q": round(float(sub["avg_q"].mean()), 1),
        "avg_fill": round(float(fills.mean()), 3),
        "avg_vwap": round(float(sub["vwap"].mean()), 3),
        "implied_wr": round(implied, 1),
        "edge": round(wr - implied, 1),
        "avg_traders": round(float(sub["n_traders"].mean()), 2),
        "avg_rel": round(float(sub["rel_size"].mean()), 2),
        "calmar": round(upnl / abs(dd or 1.0), 2),
        "days": int(sub["end_dt"].dt.date.nunique()),
        "trades_per_day": round(n / max(int(sub["end_dt"].dt.date.nunique()), 1), 2),
        "first": str(sub["end_dt"].min())[:10] if n else None,
        "last": str(sub["end_dt"].max())[:10] if n else None,
    }


def year_split(sub: pd.DataFrame, fill_col: str, slip: float) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if sub.empty:
        return out
    years = sub["end_dt"].dt.year
    for year, grp in sub.groupby(years):
        out[str(int(year))] = summarize(grp, fill_col, slip)
    return out


def breakdown_table(sub: pd.DataFrame, col: str, fill_col: str = "join_max", slip: float = 0.02) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if sub.empty or col not in sub.columns:
        return out
    for key, grp in sub.groupby(col):
        out[str(key)] = summarize(grp, fill_col, slip)
    return out


def sport_submarket_rows(sub: pd.DataFrame) -> list[dict]:
    if sub.empty:
        return []
    tmp = sub.copy()
    tmp["sport_fam"] = tmp["sport_type"].map(sport_family)
    if "submarket" not in tmp.columns:
        tmp["submarket"] = tmp["market_type"]
    rows: list[dict] = []
    for (sport, mtype), grp in tmp.groupby(["sport_fam", "submarket"]):
        st = summarize(grp, "join_max", 0.02)
        rows.append({"sport": str(sport), "submarket": str(mtype), **st})
    rows.sort(key=lambda r: (-r["n"], str(r["sport"]), str(r["submarket"])))
    return rows


def plays_payload(sub: pd.DataFrame, n: int = 20) -> list[dict]:
    out: list[dict] = []
    if sub.empty:
        return out
    last = sub.sort_values("end_dt", ascending=False).head(n)
    for r in last.itertuples(index=False):
        fill = min(max(float(r.join_max) + 0.02, 0.02), 0.98)
        pnl = STAKE * (1.0 / fill - 1.0) if bool(r.won) else -STAKE
        subm = str(getattr(r, "submarket", None) or r.market_type)
        title = str(r.title or "")
        out.append({
            "end": r.end_dt.isoformat(),
            "title": title,
            "side": r.side,
            "sport": r.sport_type,
            "sport_family": sport_family(str(r.sport_type)),
            "market": r.market_type,
            "submarket": subm,
            "play": play_label(title, str(r.side), str(r.sport_type), subm),
            "traders": r.traders,
            "n_traders": int(r.n_traders),
            "n_counters": int(r.n_counters),
            "grade": int(r.grade),
            "avg_q": float(r.avg_q),
            "min_q": int(r.min_q),
            "rel_size": float(r.rel_size),
            "primary": getattr(r, "primary", ""),
            "their_vwap": float(r.vwap),
            "join_max": float(r.join_max),
            "fill_join_plus_2c": round(fill, 4),
            "resolved": "WIN" if bool(r.won) else "LOSS",
            "unit_pnl_at_2c": round(pnl, 2),
            "total_size": float(r.total_size),
            "event_slug": r.event_slug,
            "slug": str(getattr(r, "slug", "") or ""),
            "conditionId": str(getattr(r, "conditionId", "") or ""),
        })
    return out


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    filters = load_category_filters()
    aliases = load_aliases()
    print(f"Loaded {len(filters)} category filters, {len(aliases)} alias keys")

    all_markets: list[pd.DataFrame] = []
    snaps_by_wallet: dict[str, list[dict]] = {}
    print("Loading directional resolved markets (curPrice 0/1, hedges stripped)…")
    for wallet, username in roster_traders():
        w = wallet.lower()
        if w in MARKET_MAKERS:
            continue
        # Collapse known aliases onto the canonical wallet id for consensus counting
        canon = aliases.get(username.lower()) or aliases.get(w) or w
        csv_p = csv_path_for(wallet, username)
        if not csv_p.exists():
            continue
        try:
            mk = load_trader_markets(csv_p, username, canon)
        except Exception as e:
            print(f"  skip {username}: {e}")
            continue
        if len(mk) < WARMUP + 5:
            continue
        snaps_by_wallet[canon] = build_snapshots(mk)
        all_markets.append(mk)
        last_q = snaps_by_wallet[canon][-1]["q"] if snaps_by_wallet[canon] else 0
        print(f"  {username:<32} {len(mk):>5} markets  final Q={last_q}")

    if not all_markets:
        print("No markets loaded.")
        return 1

    pos = pd.concat(all_markets, ignore_index=True)
    print(f"\nUniverse: {len(pos):,} trader-markets across {pos['wallet'].nunique()} wallets")

    # ── Diagnostic: copy-all hold-to-res vs fake pnl-win (single name, no consensus)
    copy_all_won = pos["won"].to_numpy()
    copy_fills = pos["entry_price"].to_numpy()
    copy_pnls = np.where(copy_all_won, STAKE * (1.0 / copy_fills - 1.0), -STAKE)
    copy_roi = float(copy_pnls.sum() / (len(pos) * STAKE) * 100)
    copy_wr = float(copy_all_won.mean() * 100)
    copy_imp = float(copy_fills.mean() * 100)
    print(
        f"SANITY copy-all hold-to-res: n={len(pos):,} WR={copy_wr:.1f}% "
        f"implied={copy_imp:.1f}% edge={copy_wr-copy_imp:+.1f} ROI={copy_roi:.1f}%"
    )

    # ── Build one cluster per conditionId (dominant side, 1+ traders) ─────────
    clusters: list[dict] = []
    grouped = pos.groupby("conditionId", sort=False)
    for cid, g in grouped:
        yes = g[g["side"] == "Yes"]
        no = g[g["side"] == "No"]
        # Unique wallets per side (alias already collapsed)
        def pack(side_df: pd.DataFrame) -> pd.DataFrame:
            if side_df.empty:
                return side_df
            return (
                side_df.sort_values("cost", ascending=False)
                .drop_duplicates("wallet", keep="first")
            )

        yes_u = pack(yes)
        no_u = pack(no)
        # Dominant by trader count, then size
        yes_n, no_n = len(yes_u), len(no_u)
        yes_sz = float(yes_u["cost"].sum()) if yes_n else 0.0
        no_sz = float(no_u["cost"].sum()) if no_n else 0.0
        if yes_n > no_n or (yes_n == no_n and yes_sz >= no_sz):
            dom, opp, side = yes_u, no_u, "Yes"
        else:
            dom, opp, side = no_u, yes_u, "No"
        if dom.empty:
            continue
        end_dt = pd.Timestamp(dom["end_dt"].min())
        as_of = end_dt.to_pydatetime() - KNOWLEDGE_LAG
        if as_of.tzinfo is None:
            as_of = as_of.replace(tzinfo=timezone.utc)

        voters = []
        for r in dom.itertuples(index=False):
            snap = lookup_snap(snaps_by_wallet.get(str(r.wallet), []), as_of)
            n_prior = int(snap["n"]) if snap else 0
            q = int(snap["q"]) if snap else 0
            median = float(snap["median"]) if snap and snap["median"] else 0.0
            roi = float(snap["roi"]) if snap else 0.0
            sport_roi = 0.0
            lane_ok = False
            if snap:
                sport_roi = float(snap["sport_roi"].get(str(r.sport_type), roi))
                lane = snap["sport_roi"].get(str(r.sport_type))
                lane_ok = lane is not None and lane >= MIN_LANE_ROI
            rel = (float(r.cost) / median) if median > 0 else 1.0
            blocked = trader_blocked(
                filters, str(r.wallet), str(r.sport_type), str(r.market_type),
                str(r.side), str(r.title or ""),
            )
            voters.append({
                "wallet": str(r.wallet),
                "username": str(r.username),
                "cost": float(r.cost),
                "entry": float(r.entry_price),
                "q": q,
                "n_prior": n_prior,
                "roi": roi,
                "sport_roi": sport_roi,
                "lane_ok": lane_ok,
                "rel": rel,
                "blocked": blocked,
                "warm": n_prior >= WARMUP,
            })

        counters = []
        for r in opp.itertuples(index=False):
            snap = lookup_snap(snaps_by_wallet.get(str(r.wallet), []), as_of)
            q = int(snap["q"]) if snap else 0
            n_prior = int(snap["n"]) if snap else 0
            blocked = trader_blocked(
                filters, str(r.wallet), str(r.sport_type), str(r.market_type),
                str(r.side), str(r.title or ""),
            )
            counters.append({
                "wallet": str(r.wallet),
                "q": q,
                "cost": float(r.cost),
                "warm": n_prior >= WARMUP,
                "blocked": blocked,
            })

        title = str(dom["title"].iloc[0] or "")
        sport = str(dom["sport_type"].iloc[0])
        mtype = str(dom["market_type"].iloc[0])
        submarket = str(dom["submarket"].iloc[0] if "submarket" in dom.columns else mtype)
        won = bool(dom["won"].iloc[0])
        # If members disagree on resolution, skip
        if int(dom["won"].nunique()) != 1:
            continue

        clusters.append({
            "conditionId": str(cid),
            "side": side,
            "title": title,
            "event_slug": str(dom["event_slug"].iloc[0] or ""),
            "slug": str(dom["slug"].iloc[0] or ""),
            "sport_type": sport,
            "market_type": mtype,
            "submarket": submarket,
            "end_dt": end_dt,
            "won": won,
            "voters": voters,
            "counters": counters,
        })

    print(f"Clusters (unique markets): {len(clusters):,}")

    # Score every cluster under two voter definitions: raw vs category-filtered
    rows = []
    for c in clusters:
        for use_filters, tag in ((False, "raw"), (True, "filtered")):
            voters = [
                v for v in c["voters"]
                if v["warm"] and v["cost"] >= MIN_VOTE_USD and (not use_filters or not v["blocked"])
            ]
            counters = [
                v for v in c["counters"]
                if v["warm"] and v["cost"] >= MIN_VOTE_USD and (not use_filters or not v["blocked"])
            ]
            n_dom = len(voters)
            n_ctr = len(counters)
            if n_dom < 1:
                continue
            total_on_market = n_dom + n_ctr
            consensus_pct = (n_dom / total_on_market * 100.0) if total_on_market else 100.0
            risk = sum(v["cost"] for v in voters) or 1.0
            avg_q = sum(v["q"] * v["cost"] for v in voters) / risk
            avg_roi = sum(v["sport_roi"] * v["cost"] for v in voters) / risk
            avg_net = risk / n_dom
            rel = sum(v["rel"] * v["cost"] for v in voters) / risk
            vwap = sum(v["entry"] * v["cost"] for v in voters) / risk
            join_max = max(v["entry"] for v in voters)
            min_q = min(v["q"] for v in voters)
            n_q50 = sum(1 for v in voters if v["q"] >= 50)
            n_q35 = sum(1 for v in voters if v["q"] >= 35)
            n_rel2 = sum(1 for v in voters if v["rel"] >= 2)
            lane_frac = sum(1 for v in voters if v["lane_ok"]) / n_dom
            grade, _ = compute_confidence(
                avg_roi, consensus_pct, 0.0, avg_net, n_dom, avg_q, n_ctr, rel
            )
            names = ",".join(sorted({v["username"] for v in voters})[:8])
            primary = max(voters, key=lambda v: v["cost"])["username"]
            rows.append({
                "filter_mode": tag,
                "conditionId": c["conditionId"],
                "side": c["side"],
                "title": c["title"],
                "event_slug": c["event_slug"],
                "sport_type": c["sport_type"],
                "market_type": c["market_type"],
                "submarket": c.get("submarket") or c["market_type"],
                "slug": c.get("slug") or "",
                "end_dt": c["end_dt"],
                "won": c["won"],
                "n_traders": n_dom,
                "n_counters": n_ctr,
                "consensus_pct": round(consensus_pct, 1),
                "total_size": round(risk, 2),
                "avg_q": round(avg_q, 1),
                "min_q": min_q,
                "avg_roi": round(avg_roi, 2),
                "rel_size": round(min(rel, 20.0), 2),
                "vwap": round(float(np.clip(vwap, 0.02, 0.98)), 4),
                "join_max": round(float(np.clip(join_max, 0.02, 0.98)), 4),
                "grade": grade,
                "n_q50": n_q50,
                "n_q35": n_q35,
                "n_rel2": n_rel2,
                "lane_frac": round(lane_frac, 2),
                "traders": names,
                "primary": primary,
                "price_band": price_bucket(vwap),
            })

    cl = pd.DataFrame(rows)
    cl["end_dt"] = pd.to_datetime(cl["end_dt"], utc=True)
    print(f"Scored rows: {len(cl):,} (raw+filtered)")

    # ── Strategies ────────────────────────────────────────────────────────────
    filt = cl[cl["filter_mode"] == "filtered"].copy()
    raw = cl[cl["filter_mode"] == "raw"].copy()
    if "submarket" not in filt.columns:
        filt["submarket"] = filt.get("market_type", "Moneyline")
    if "submarket" not in raw.columns:
        raw["submarket"] = raw.get("market_type", "Moneyline")

    def m_ge2(df: pd.DataFrame) -> pd.Series:
        return df["n_traders"] >= 2

    strategies: list[tuple[str, pd.DataFrame, pd.Series]] = []

    def add(name: str, df: pd.DataFrame, mask: pd.Series) -> None:
        strategies.append((name, df, mask.fillna(False).astype(bool)))

    # Core consensus
    add("raw_2plus_any", raw, m_ge2(raw))
    add("filt_2plus_any", filt, m_ge2(filt))
    add("filt_3plus_any", filt, filt["n_traders"] >= 3)
    add("filt_2plus_no_counter", filt, m_ge2(filt) & (filt["n_counters"] == 0))
    add("filt_2plus_q35", filt, m_ge2(filt) & (filt["min_q"] >= 35))
    add("filt_2plus_q50", filt, m_ge2(filt) & (filt["min_q"] >= 50))
    add("filt_2plus_both_q50", filt, (filt["n_q50"] >= 2))
    add("filt_2plus_q50_size1k", filt, m_ge2(filt) & (filt["min_q"] >= 50) & (filt["total_size"] >= 1000))
    add("filt_2plus_q50_rel2", filt, m_ge2(filt) & (filt["min_q"] >= 50) & (filt["n_rel2"] >= 1))
    add("filt_2plus_q50_lane", filt, m_ge2(filt) & (filt["min_q"] >= 50) & (filt["lane_frac"] >= 0.5))
    add("filt_2plus_grade60", filt, m_ge2(filt) & (filt["grade"] >= 60))
    add("filt_2plus_grade70", filt, m_ge2(filt) & (filt["grade"] >= 70))
    add("filt_2plus_grade80", filt, m_ge2(filt) & (filt["grade"] >= 80))
    add("filt_2plus_grade90", filt, m_ge2(filt) & (filt["grade"] >= 90))
    add("filt_3plus_grade70", filt, (filt["n_traders"] >= 3) & (filt["grade"] >= 70))
    add("filt_2plus_q50_grade70", filt, m_ge2(filt) & (filt["min_q"] >= 50) & (filt["grade"] >= 70))
    add("filt_2plus_q50_nocounter_grade70", filt,
        m_ge2(filt) & (filt["min_q"] >= 50) & (filt["n_counters"] == 0) & (filt["grade"] >= 70))

    # Price bands (live 10–90, drop stale >88)
    live_px = m_ge2(filt) & (filt["vwap"] >= LIVE_LO) & (filt["vwap"] <= LIVE_HI) & (filt["vwap"] <= STALE_ENTRY)
    add("filt_2plus_live_10_90", filt, live_px)
    add("filt_2plus_longshot_0_20", filt, m_ge2(filt) & (filt["vwap"] < 0.20))
    add("filt_2plus_underdog_20_40", filt, m_ge2(filt) & (filt["vwap"] >= 0.20) & (filt["vwap"] < 0.40))
    add("filt_2plus_flip_40_60", filt, m_ge2(filt) & (filt["vwap"] >= 0.40) & (filt["vwap"] < 0.60))
    add("filt_2plus_fav_60_80", filt, m_ge2(filt) & (filt["vwap"] >= 0.60) & (filt["vwap"] < 0.80))
    add("filt_2plus_safe_80_88", filt, m_ge2(filt) & (filt["vwap"] >= 0.80) & (filt["vwap"] <= STALE_ENTRY))

    # Price × quality
    add("filt_2q50_flip_40_60", filt, m_ge2(filt) & (filt["min_q"] >= 50) & (filt["vwap"] >= 0.40) & (filt["vwap"] < 0.60))
    add("filt_2q50_20_60", filt, m_ge2(filt) & (filt["min_q"] >= 50) & (filt["vwap"] >= 0.20) & (filt["vwap"] < 0.60))
    add("filt_2q50_40_70", filt, m_ge2(filt) & (filt["min_q"] >= 50) & (filt["vwap"] >= 0.40) & (filt["vwap"] < 0.70))
    add("filt_2q50_live_grade70", filt, live_px & (filt["min_q"] >= 50) & (filt["grade"] >= 70))
    add("filt_2q50_flip_grade70", filt,
        m_ge2(filt) & (filt["min_q"] >= 50) & (filt["grade"] >= 70) & (filt["vwap"] >= 0.40) & (filt["vwap"] < 0.60))
    add("filt_2q50_nocounter_flip", filt,
        m_ge2(filt) & (filt["min_q"] >= 50) & (filt["n_counters"] == 0) & (filt["vwap"] >= 0.40) & (filt["vwap"] < 0.60))
    add("filt_2plus_moneyline_q50", filt,
        m_ge2(filt) & (filt["min_q"] >= 50) & (filt["market_type"] == "Moneyline / Match"))
    add("filt_2plus_sports_q50", filt,
        m_ge2(filt) & (filt["min_q"] >= 50) & (filt["sport_type"] != "POLITICS"))
    add("filt_2q50_rel2_flip", filt,
        m_ge2(filt) & (filt["min_q"] >= 50) & (filt["n_rel2"] >= 1) & (filt["vwap"] >= 0.40) & (filt["vwap"] < 0.60))
    add("filt_3plus_q50_nocounter", filt,
        (filt["n_traders"] >= 3) & (filt["min_q"] >= 50) & (filt["n_counters"] == 0))
    add("filt_2q50_size2k_live", filt,
        live_px & (filt["min_q"] >= 50) & (filt["total_size"] >= 2000))
    no_cannae = ~filt["traders"].astype(str).str.contains("Cannae", na=False)
    add("filt_2plus_any_no_cannae", filt, m_ge2(filt) & no_cannae)
    add("filt_2plus_live_no_cannae", filt, live_px & no_cannae)
    add("filt_2plus_grade70_no_cannae", filt, m_ge2(filt) & (filt["grade"] >= 70) & no_cannae)
    add("filt_2plus_grade70_live_no_cannae", filt, live_px & (filt["grade"] >= 70) & no_cannae)
    add("filt_2plus_q35_live_no_cannae", filt, live_px & (filt["min_q"] >= 35) & no_cannae)

    is_ml = filt["submarket"].astype(str).isin(["Moneyline", "Moneyline / Match"]) | filt["market_type"].astype(str).str.contains("Moneyline", na=False)
    is_spread = filt["submarket"].astype(str).eq("Spread") | filt["market_type"].astype(str).str.contains("Spread", na=False)
    is_total = filt["submarket"].astype(str).eq("Total") | filt["market_type"].astype(str).str.contains("Total|O/U", na=False, regex=True)
    is_draw = filt["submarket"].astype(str).eq("Draw") | filt["market_type"].astype(str).str.contains("Draw", na=False)
    no_nfl = ~filt["sport_type"].astype(str).str.contains("NFL", na=False)
    soccer = filt["sport_type"].astype(str).str.startswith("SOCCER")
    add("core_2plus_live_no_cannae_no_nfl", filt, live_px & no_cannae & no_nfl)
    add("core_grade70_live_no_cannae_no_nfl", filt, live_px & no_cannae & no_nfl & (filt["grade"] >= 70))
    add("core_ml_live_no_cannae_no_nfl", filt, live_px & no_cannae & no_nfl & is_ml)
    add("core_ml_grade70_no_cannae_no_nfl", filt, live_px & no_cannae & no_nfl & is_ml & (filt["grade"] >= 70))
    add("sub_moneyline_2plus_live", filt, live_px & is_ml)
    add("sub_spread_2plus_live", filt, live_px & is_spread)
    add("sub_total_2plus_live", filt, live_px & is_total)
    add("sub_draw_2plus_live", filt, live_px & is_draw)
    add("soccer_2plus_live_no_cannae", filt, live_px & soccer & no_cannae)
    add("soccer_2plus_live_with_cannae", filt, live_px & soccer)
    add("soccer_ml_no_cannae", filt, live_px & soccer & is_ml & no_cannae)
    add("soccer_ml_with_cannae", filt, live_px & soccer & is_ml)

    # Grade bands for calibration
    add("band_grade_90", filt, m_ge2(filt) & (filt["grade"] >= 90))
    add("band_grade_80_89", filt, m_ge2(filt) & (filt["grade"] >= 80) & (filt["grade"] < 90))
    add("band_grade_70_79", filt, m_ge2(filt) & (filt["grade"] >= 70) & (filt["grade"] < 80))
    add("band_grade_60_69", filt, m_ge2(filt) & (filt["grade"] >= 60) & (filt["grade"] < 70))
    add("band_grade_lt60", filt, m_ge2(filt) & (filt["grade"] < 60))

    table_rows: list[dict] = []
    by_strategy: dict[str, dict] = {}
    print("\n" + "=" * 128)
    print(
        f"{'Strategy':<38} {'Fill':>8} {'Slip':>4} {'N':>5} {'WR':>6} {'Impl':>6} "
        f"{'Edge':>6} {'ROI':>7} {'PF':>6} {'Shp':>6} {'DD':>8} {'Days':>5}"
    )
    print("-" * 128)

    fill_modes = (("vwap", "vwap"), ("join", "join_max"))
    for name, df, mask in strategies:
        sub0 = df.loc[mask]
        block: dict[str, dict] = {}
        for fill_name, fill_col in fill_modes:
            for slip in SLIPS:
                stats = summarize(sub0, fill_col, slip)
                key = f"{fill_name}_{int(slip*100)}c"
                block[key] = stats
                table_rows.append({"strategy": name, "fill": fill_name, "slip": f"{int(slip*100)}c", **stats})
                if stats["n"] >= 20 and fill_name == "join" and slip in (0.0, 0.02):
                    print(
                        f"{name:<38} {fill_name:>8} {int(slip*100):>3}c {stats['n']:>5} "
                        f"{stats['win_rate']:>5.1f}% {stats['implied_wr']:>5.1f} "
                        f"{stats['edge']:>+5.1f} {stats['roi']:>6.1f}% "
                        f"{stats['profit_factor']:>6.2f} {stats['sharpe_daily_roi']:>6.2f} "
                        f"{stats['max_dd']:>8.0f} {stats['days']:>5}"
                    )
        by_strategy[name] = block

    # Honest production pick: fill at join_max+2c (cannot trade until the later
    # wallet is in). Reject thin price slices, single-year books, Cannae-only books.
    ALLOW_BEST = {
        "raw_2plus_any", "filt_2plus_any", "filt_2plus_no_counter",
        "filt_2plus_live_10_90", "filt_2plus_grade60", "filt_2plus_grade70",
        "filt_2plus_q35", "filt_2plus_q50", "filt_2plus_sports_q50",
        "filt_2plus_moneyline_q50", "filt_2plus_q50_size1k",
        "filt_2plus_any_no_cannae", "filt_2plus_live_no_cannae",
        "filt_2plus_grade70_no_cannae", "filt_3plus_any",
        "filt_2plus_fav_60_80", "filt_2plus_flip_40_60",
        "core_2plus_live_no_cannae_no_nfl", "core_grade70_live_no_cannae_no_nfl",
        "core_ml_live_no_cannae_no_nfl", "core_ml_grade70_no_cannae_no_nfl",
        "filt_2plus_grade70_live_no_cannae",
    }

    def pack_strategy(df: pd.DataFrame, mask: pd.Series) -> dict:
        sub = df.loc[mask]
        return {
            "s0": summarize(sub, "vwap", 0.0),
            "s2": summarize(sub, "vwap", 0.02),
            "sjoin0": summarize(sub, "join_max", 0.0),
            "sjoin2": summarize(sub, "join_max", 0.02),
            "sjoin5": summarize(sub, "join_max", 0.05),
            "years": year_split(sub, "join_max", 0.02),
            "primary_share": float(sub["primary"].value_counts(normalize=True).iloc[0]) if len(sub) else 1.0,
            "n_primaries": int(sub["primary"].nunique()) if len(sub) else 0,
            "top_primary": str(sub["primary"].value_counts().index[0]) if len(sub) else "",
        }

    ranked = []
    print("\n" + "=" * 128)
    print("Production candidates (join_max+2c, n≥200, ≥8 primaries, no wallet >50% of book):")
    for name, df, mask in strategies:
        if name not in ALLOW_BEST:
            continue
        pack = pack_strategy(df, mask)
        sj = pack["sjoin2"]
        years = pack["years"]
        y25 = years.get("2025") or {"n": 0, "roi": 0}
        y26 = years.get("2026") or {"n": 0, "roi": 0}
        ok = (
            sj["n"] >= 200
            and sj["days"] >= 90
            and sj["roi"] > 0
            and sj["edge"] > 0
            and pack["primary_share"] <= 0.50
            and pack["n_primaries"] >= 8
            and y26.get("n", 0) >= 80
            and (y25.get("n", 0) < 25 or y25.get("roi", 0) >= 0)
        )
        flag = "OK " if ok else "   "
        print(
            f"  {flag}{name:<36} n={sj['n']:<5} WR={sj['win_rate']:5.1f}% "
            f"impl={sj['implied_wr']:5.1f} ROI={sj['roi']:6.1f}% "
            f"prim={pack['top_primary'][:16]:<16} {pack['primary_share']*100:4.0f}%"
        )
        if ok:
            ranked.append((sj["roi"], sj["sharpe_daily_roi"], sj["n"], name, df, mask, pack))
    ranked.sort(reverse=True)

    if ranked:
        _roi, _shp, _n, best_name, best_df, best_mask, best_pack = ranked[0]
    else:
        print("\nNo book passed the production filter; using filt_2plus_fav_60_80.")
        fav_mask = m_ge2(filt) & (filt["vwap"] >= 0.60) & (filt["vwap"] < 0.80)
        best_name, best_df, best_mask = "filt_2plus_fav_60_80", filt, fav_mask
        best_pack = pack_strategy(best_df, best_mask)

    best_sub = best_df.loc[best_mask].sort_values("end_dt")
    print(f"\nBEST STRATEGY: {best_name}")
    print(
        f"  concentration: primary={best_pack.get('top_primary')} "
        f"{best_pack.get('primary_share', 0)*100:.0f}% of book, "
        f"{best_pack.get('n_primaries')} distinct primaries"
    )
    for label, st in (
        ("their VWAP", best_pack["s0"]),
        ("VWAP +2c", best_pack["s2"]),
        ("join_max (later entry)", best_pack.get("sjoin0") or best_pack["sjoin2"]),
        ("join_max +2c  <-- use this", best_pack["sjoin2"]),
        ("join_max +5c", best_pack.get("sjoin5") or best_pack["sjoin2"]),
    ):
        print(
            f"  {label:<28} n={st['n']} WR={st['win_rate']:.1f}% implied={st['implied_wr']:.1f}% "
            f"edge={st['edge']:+.1f} ROI={st['roi']:.1f}% PF={st['profit_factor']:.2f} "
            f"Sharpe={st['sharpe_daily_roi']:.2f} DD={st['max_dd']:.0f} Exp=${st['expectancy']:.2f}"
        )
    print("  by year @ join_max+2c:")
    for y, ys in sorted(best_pack["years"].items()):
        print(f"    {y}: n={ys['n']} WR={ys['win_rate']:.1f}% ROI={ys['roi']:.1f}% edge={ys['edge']:+.1f}")

    # Sport / submarket / price breakdown of best
    by_sport = {}
    for sport, grp in best_sub.groupby("sport_type"):
        by_sport[str(sport)] = {
            "vwap_0c": summarize(grp, "vwap", 0.0),
            "join_2c": summarize(grp, "join_max", 0.02),
        }
    by_band = {}
    for band, grp in best_sub.groupby("price_band"):
        by_band[str(band)] = {
            "vwap_0c": summarize(grp, "vwap", 0.0),
            "join_2c": summarize(grp, "join_max", 0.02),
        }
    by_submarket = breakdown_table(best_sub, "submarket")
    sport_x_sub = sport_submarket_rows(best_sub)
    print("\nBest strategy by sport × submarket (join_max+2¢):")
    for row in sport_x_sub[:25]:
        print(
            f"  {row['sport']:<12} {row['submarket']:<14} n={row['n']:<5} "
            f"WR={row['win_rate']:5.1f}% ROI={row['roi']:6.1f}% "
            f"{row['trades_per_day']:.2f}/day last={row.get('last')}"
        )

    filt_out = OUTPUT_DIR / "walkforward_consensus_filtered_2plus.csv"
    filt[m_ge2(filt)].to_csv(filt_out, index=False)

    last20_out = plays_payload(best_sub, 20)

    # Calibration of 2+ filtered grades
    calibration = []
    for lo, hi, label in (
        (90, 101, "90+"),
        (80, 90, "80-89"),
        (70, 80, "70-79"),
        (60, 70, "60-69"),
        (0, 60, "<60"),
    ):
        band = filt[m_ge2(filt) & (filt["grade"] >= lo) & (filt["grade"] < hi)]
        if band.empty:
            calibration.append({"band": label, "n": 0})
            continue
        st = summarize(band, "join_max", 0.02)
        calibration.append({"band": label, **st})

    def strategy_card(sid: str, df: pd.DataFrame, mask: pd.Series, **meta: object) -> dict:
        sub = df.loc[mask]
        pack = pack_strategy(df, mask)
        return {
            "id": sid,
            "join_max_plus_2c": pack["sjoin2"],
            "join_max": pack.get("sjoin0"),
            "vwap": pack["s0"],
            "vwap_plus_2c": pack["s2"],
            "years": pack["years"],
            "by_sport": breakdown_table(sub, "sport_type"),
            "by_submarket": breakdown_table(sub, "submarket"),
            "sport_x_submarket": sport_submarket_rows(sub),
            "last_20": plays_payload(sub, 20),
            "date_span": {
                "first": pack["sjoin2"].get("first"),
                "last": pack["sjoin2"].get("last"),
                "trades_per_day": pack["sjoin2"].get("trades_per_day"),
            },
            **meta,
        }

    named_lookup = {name: (df, mask) for name, df, mask in strategies}

    def named_or_empty(key: str) -> tuple[pd.DataFrame, pd.Series]:
        if key in named_lookup:
            return named_lookup[key]
        empty_mask = pd.Series(False, index=filt.index)
        return filt, empty_mask

    product: list[dict] = []
    product_specs = [
        {
            "id": "favorites_60_80",
            "name": "Favorites 60–80¢ (2+ live)",
            "backtest_key": "filt_2plus_fav_60_80",
            "recommended": True,
            "description": (
                "After including unredeemed losers, most 2+ books go negative at join_max+2¢. "
                "Fading longshots and sticking to 60–80¢ favorites is the only fat consensus band "
                "that stayed positive."
            ),
            "filters": {
                "minTraders": 2,
                "minGrade": 0,
                "minQ": 0,
                "priceLo": 0.60,
                "priceHi": 0.80,
                "excludeUsernames": ["Cannae"],
                "skipSports": ["NFL"],
                "marketTypes": [],
            },
        },
        {
            "id": "core_consensus",
            "name": "Core 2+ (no Cannae, no NFL)",
            "backtest_key": "core_2plus_live_no_cannae_no_nfl",
            "recommended": False,
            "description": (
                "2+ filtered wallets, live 10–88¢, join_max+2¢, exclude Cannae, skip NFL. "
                "Honest book after settled-open losers — usually flat to slightly negative. Shown for comparison."
            ),
            "filters": {
                "minTraders": 2,
                "minGrade": 0,
                "minQ": 0,
                "priceLo": 0.10,
                "priceHi": 0.88,
                "excludeUsernames": ["Cannae"],
                "skipSports": ["NFL"],
                "marketTypes": [],
            },
        },
        {
            "id": "grade70",
            "name": "Grade 70+ (no Cannae, no NFL)",
            "backtest_key": "core_grade70_live_no_cannae_no_nfl",
            "recommended": False,
            "description": "Same as Core, but only grade ≥70. Fewer trades; still not reliably positive at join_max+2¢ after settled-open losers.",
            "filters": {
                "minTraders": 2,
                "minGrade": 70,
                "minQ": 0,
                "priceLo": 0.10,
                "priceHi": 0.88,
                "excludeUsernames": ["Cannae"],
                "skipSports": ["NFL"],
                "marketTypes": [],
            },
        },
        {
            "id": "moneyline_only",
            "name": "Moneyline only (no Cannae, no NFL)",
            "backtest_key": "core_ml_live_no_cannae_no_nfl",
            "recommended": False,
            "description": "Core book restricted to moneyline / match winner. No spreads, totals, or draws.",
            "filters": {
                "minTraders": 2,
                "minGrade": 0,
                "minQ": 0,
                "priceLo": 0.10,
                "priceHi": 0.88,
                "excludeUsernames": ["Cannae"],
                "skipSports": ["NFL"],
                "marketTypes": ["Moneyline", "Moneyline / Match"],
            },
        },
        {
            "id": "grade70_moneyline",
            "name": "Grade 70+ moneyline",
            "backtest_key": "core_ml_grade70_no_cannae_no_nfl",
            "recommended": False,
            "description": "Tightest consensus: grade 70+, moneyline, no Cannae, no NFL.",
            "filters": {
                "minTraders": 2,
                "minGrade": 70,
                "minQ": 0,
                "priceLo": 0.10,
                "priceHi": 0.88,
                "excludeUsernames": ["Cannae"],
                "skipSports": ["NFL"],
                "marketTypes": ["Moneyline", "Moneyline / Match"],
            },
        },
        {
            "id": "with_cannae",
            "name": "2+ live including Cannae",
            "backtest_key": "filt_2plus_live_10_90",
            "recommended": False,
            "description": (
                "Same live band but Cannae votes. Inflated by 2026 soccer-NO clusters — "
                "do not treat as a stable edge."
            ),
            "filters": {
                "minTraders": 2,
                "minGrade": 0,
                "minQ": 0,
                "priceLo": 0.10,
                "priceHi": 0.88,
                "excludeUsernames": [],
                "skipSports": [],
                "marketTypes": [],
            },
        },
        {
            "id": "soccer_no_cannae",
            "name": "Soccer 2+ without Cannae",
            "backtest_key": "soccer_2plus_live_no_cannae",
            "recommended": False,
            "description": "Soccer consensus after stripping Cannae.",
            "filters": {
                "minTraders": 2,
                "minGrade": 0,
                "minQ": 0,
                "priceLo": 0.10,
                "priceHi": 0.88,
                "excludeUsernames": ["Cannae"],
                "skipSports": [],
                "sportIncludes": ["Soccer", "SOCCER", "UCL"],
                "marketTypes": [],
            },
        },
        {
            "id": "spreads",
            "name": "Spreads 2+ live",
            "backtest_key": "sub_spread_2plus_live",
            "recommended": False,
            "description": "Consensus on spread markets only. Usually worse than moneyline.",
            "filters": {
                "minTraders": 2,
                "minGrade": 0,
                "minQ": 0,
                "priceLo": 0.10,
                "priceHi": 0.88,
                "excludeUsernames": ["Cannae"],
                "skipSports": ["NFL"],
                "marketTypes": ["Spread"],
            },
        },
        {
            "id": "totals",
            "name": "Totals 2+ live",
            "backtest_key": "sub_total_2plus_live",
            "recommended": False,
            "description": "Consensus on O/U / total markets only.",
            "filters": {
                "minTraders": 2,
                "minGrade": 0,
                "minQ": 0,
                "priceLo": 0.10,
                "priceHi": 0.88,
                "excludeUsernames": ["Cannae"],
                "skipSports": ["NFL"],
                "marketTypes": ["Total", "Totals (O/U)"],
            },
        },
    ]
    for spec in product_specs:
        df_s, mask_s = named_or_empty(str(spec["backtest_key"]))
        product.append(strategy_card(str(spec["id"]), df_s, mask_s, **{k: v for k, v in spec.items() if k != "id"}))

    tail_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "as_of": datetime.now(timezone.utc).date().isoformat(),
        "fill": "join_max+2c",
        "stake": STAKE,
        "method": (
            "Hold-to-resolution walk-forward. Includes status=open tokens that already "
            "resolved (curPrice 0 or 1). Dates from endDate or slug/title YYYY-MM-DD."
        ),
        "copy_all": {
            "n": int(len(pos)),
            "win_rate": round(copy_wr, 2),
            "implied_wr": round(copy_imp, 1),
            "edge": round(copy_wr - copy_imp, 1),
            "roi": round(copy_roi, 2),
        },
        "strategies": product,
        "universe": {
            "trader_markets": int(len(pos)),
            "wallets": int(pos["wallet"].nunique()),
            "clusters": int(len(clusters)),
            "max_resolved_date": str(pos["end_dt"].max())[:10] if len(pos) else None,
        },
    }
    tail_path = OUTPUT_DIR / "tail_strategies.json"
    tail_path.write_text(json.dumps(tail_payload, indent=2, default=str), encoding="utf-8")

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": (
            "Hold-to-resolution walk-forward multi-trader consensus. "
            "Win iff curPrice>=0.99 (token paid $1), loss iff curPrice<=0.01. "
            "Includes unredeemed settled-open rows. Dates from endDate or slug/title. "
            "Play = conditionId+side. Trader Q/lane/median use only markets with "
            "event date <= this market date minus 1 day. Voters need 20 prior "
            "resolved markets and ≥$200 stake. Category doNotTail filters applied "
            "in 'filtered' strategies. $100/play. VWAP = their price; join_max = "
            "worse member entry; slips +1/2/5c."
        ),
        "bugfix": {
            "previous_error": (
                "First backtest treated realizedPnl>0 as a binary win and paid 1/price-1. "
                "Scalps on losing tokens were scored as huge underdog wins. "
                "Closed-only books also omitted unredeemed losers (win-biased)."
            ),
            "copy_all_hold_to_res": {
                "n": int(len(pos)),
                "win_rate": round(copy_wr, 2),
                "implied_wr": round(copy_imp, 1),
                "edge": round(copy_wr - copy_imp, 1),
                "roi": round(copy_roi, 2),
            },
        },
        "params": {
            "warmup": WARMUP,
            "knowledge_lag_days": 1,
            "min_vote_usd": MIN_VOTE_USD,
            "stale_entry": STALE_ENTRY,
            "stake": STAKE,
        },
        "universe": {
            "trader_markets": int(len(pos)),
            "wallets": int(pos["wallet"].nunique()),
            "clusters": int(len(clusters)),
            "filtered_2plus": int((m_ge2(filt)).sum()),
            "max_resolved_date": str(pos["end_dt"].max())[:10] if len(pos) else None,
            "min_resolved_date": str(pos["end_dt"].min())[:10] if len(pos) else None,
        },
        "calibration_2plus_filtered_join_2c": calibration,
        "strategies": by_strategy,
        "robust_ranked": [
            {
                "strategy": name,
                "roi_join_2c": pack["sjoin2"]["roi"],
                "sharpe": pack["sjoin2"]["sharpe_daily_roi"],
                "n": pack["sjoin2"]["n"],
                "edge": pack["sjoin2"]["edge"],
                "win_rate": pack["sjoin2"]["win_rate"],
                "implied": pack["sjoin2"]["implied_wr"],
                "trades_per_day": pack["sjoin2"].get("trades_per_day"),
                "last": pack["sjoin2"].get("last"),
                "primary_share": pack.get("primary_share"),
                "top_primary": pack.get("top_primary"),
                "years": pack["years"],
            }
            for _, _, _, name, _, _, pack in ranked[:12]
        ],
        "best_strategy": best_name,
        "best_stats": {
            "their_vwap": best_pack["s0"],
            "vwap_plus_2c": best_pack["s2"],
            "join_max": best_pack.get("sjoin0"),
            "join_max_plus_2c": best_pack["sjoin2"],
            "join_max_plus_5c": best_pack.get("sjoin5"),
            "years_join_2c": best_pack["years"],
            "concentration": {
                "top_primary": best_pack.get("top_primary"),
                "primary_share": best_pack.get("primary_share"),
                "n_primaries": best_pack.get("n_primaries"),
            },
            "by_sport": by_sport,
            "by_submarket": by_submarket,
            "sport_x_submarket": sport_x_sub,
            "by_price_band": by_band,
        },
        "last_20_plays": last20_out,
        "product_strategies": product,
    }

    out_json = OUTPUT_DIR / "walkforward_consensus_backtest.json"
    out_csv = OUTPUT_DIR / "walkforward_consensus_trades.csv"
    out_json.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    best_sub.to_csv(out_csv, index=False)
    print(f"\nWrote {out_json}")
    print(f"Wrote {out_csv} ({len(best_sub)} best-strategy trades)")
    print(f"Wrote {tail_path}")
    print("\nLast 20 plays this strategy would have taken:")
    for p in last20_out:
        print(
            f"  {p['end'][:10]}  {p['resolved']:<4}  {p['side']:<3}  "
            f"{p.get('submarket','')[:10]:<10}  "
            f"vwap={p['their_vwap']:.3f} join+2c={p.get('fill_join_plus_2c', 0):.3f}  "
            f"g={p['grade']} q={p['avg_q']:.0f} n={p['n_traders']} {p.get('traders','')[:36]}  "
            f"{p['title'][:64]}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
