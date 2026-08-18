#!/usr/bin/env python3
"""
Walk-forward (no look-ahead) tailing backtest.

For every closed directional play we:
  1. Grade the *trader* using only plays that had already resolved.
  2. Grade the *play* with the live signal formula (sport-lane ROI, relative
     size vs prior median, quality, conviction) — still using only prior data.
  3. Simulate tailing $100 at their entry price vs +1c / +2c / +5c slippage.

Never uses the current play's outcome, or any later play, in the grade.

Writes:
  pnl_analysis/output/walkforward_tail_backtest.json
  pnl_analysis/output/walkforward_strategy_table.csv
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_trader import get_market_type, get_sport, price_bucket  # noqa: E402
from backtest_high_grade import _hedged_ids  # noqa: E402
from run_full_pipeline import OUTPUT_DIR, csv_path_for, roster_traders  # noqa: E402

STAKE = 100.0
WARMUP_EVENTS = 20
MIN_LANE_EVENTS = 8
MIN_LANE_ROI = 5.0
SLIPS = (0.0, 0.01, 0.02, 0.05)  # dollars on a $1 binary contract


# ── Load closed directional events ───────────────────────────────────────────

def load_closed_events(csv_path: Path, username: str, wallet: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path, low_memory=False)
    for col in ("realizedPnl", "cashPnl", "currentValue", "initialValue", "totalBought", "avgPrice"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        else:
            df[col] = 0.0
    if "total_position_pnl" not in df.columns:
        df["total_position_pnl"] = df["realizedPnl"] + df["cashPnl"]
    df["grouping_id"] = df["eventSlug"].fillna(df.get("slug", ""))
    closed = (
        df["status"].astype(str).str.lower().eq("closed")
        if "status" in df.columns
        else pd.Series(True, index=df.index)
    )
    df["calculated_cost"] = np.where(closed, df["totalBought"] * df["avgPrice"], df["initialValue"])
    df["sport_type"] = df.apply(get_sport, axis=1)
    df["market_type"] = df.apply(get_market_type, axis=1)
    outcome = df["outcome"].astype(str).str.strip().str.lower() if "outcome" in df.columns else ""
    df["bet_side"] = np.where(outcome == "yes", "Yes", np.where(outcome == "no", "No", "Specific Selection"))

    hedged = _hedged_ids(df)
    if hedged and "conditionId" in df.columns:
        df = df[~df["conditionId"].isin(hedged)].copy()
    df["is_bond"] = (df["bet_side"] == "No") & (df["avgPrice"] >= 0.95)
    if "status" in df.columns:
        df = df[df["status"].astype(str).str.lower() == "closed"].copy()
    df = df[~df["is_bond"]].copy()
    if df.empty:
        return df

    def wavg(g: pd.DataFrame) -> float:
        w = g["calculated_cost"].replace(0, 1e-9)
        return float(np.average(g["avgPrice"], weights=w))

    agg = df.groupby("grouping_id", dropna=False).agg(
        total_pnl=("total_position_pnl", "sum"),
        total_cost=("calculated_cost", "sum"),
        sport_type=("sport_type", "first"),
        market_type=("market_type", "first"),
        title=("title", "first"),
        end_date=("endDate", "first"),
        timestamp=("timestamp", "min") if "timestamp" in df.columns else ("endDate", "first"),
    ).reset_index()
    prices = df.groupby("grouping_id", group_keys=False).apply(wavg, include_groups=False)
    agg["entry_price"] = agg["grouping_id"].map(prices).fillna(0.5)
    agg = agg[agg["total_cost"] > 1.0].copy()
    # Scratches / dust
    agg = agg[agg["total_pnl"].abs() >= 0.5].copy()
    agg["end_dt"] = pd.to_datetime(agg["end_date"], errors="coerce", utc=True)
    agg = agg.dropna(subset=["end_dt"])
    agg["entry_price"] = agg["entry_price"].clip(0.02, 0.98)
    agg["username"] = username
    agg["wallet"] = wallet.lower()
    agg["won"] = agg["total_pnl"] > 0
    agg["event_roi"] = agg["total_pnl"] / agg["total_cost"]
    return agg.sort_values("end_dt").reset_index(drop=True)


# ── Expanding trader book (O(1) updates) ─────────────────────────────────────

@dataclass
class Lane:
    n: int = 0
    pnl: float = 0.0
    cost: float = 0.0
    wins: int = 0
    losses: int = 0

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

    def update(self, row: pd.Series) -> None:
        pnl = float(row["total_pnl"])
        cost = float(row["total_cost"])
        won = bool(row["won"])
        self.n += 1
        self.pnl += pnl
        self.cost += cost
        if won:
            self.wins += 1
        else:
            self.losses += 1
        for store, key in (
            (self.sports, str(row["sport_type"])),
            (self.markets, str(row["market_type"])),
            (self.buckets, price_bucket(float(row["entry_price"]))),
        ):
            lane = store[key]
            lane.n += 1
            lane.pnl += pnl
            lane.cost += cost
            if won:
                lane.wins += 1
            else:
                lane.losses += 1
        day = row["end_dt"].date() if hasattr(row["end_dt"], "date") else row["end_dt"]
        self.daily[day] = self.daily.get(day, 0.0) + pnl
        self.costs.append(cost)

    def median_stake(self) -> float:
        if not self.costs:
            return 0.0
        return float(np.median(self.costs))

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
        if self.n < WARMUP_EVENTS:
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

    def lane_ok(self, sport: str) -> bool:
        lane = self.sports.get(sport)
        if not lane or lane.n < MIN_LANE_EVENTS:
            return False
        return lane.roi() >= MIN_LANE_ROI

    def sport_roi(self, sport: str) -> float:
        lane = self.sports.get(sport)
        if lane and lane.n >= MIN_LANE_EVENTS:
            return lane.roi()
        return self.overall_roi()


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


def grade_play(book: ExpandingBook, row: pd.Series) -> dict:
    """Live-signal confidence clone. Prior book only — no current outcome."""
    q = book.quality_score()
    sport_roi = book.sport_roi(str(row["sport_type"]))
    median = book.median_stake()
    stake = float(row["total_cost"])
    rel = (stake / median) if median > 0 else 1.0
    p = float(row["entry_price"])

    roi_pct = int(round(min(max(sport_roi / 25.0, 0.0), 1.0) * 40))
    # Single-trader consensus: 15 pts max at 100% (we are tailing one wallet)
    cons_pct = 15
    # At their entry, valueDelta = 0 → 10 of 20 value pts
    value_pct = 10
    size_pct = int(round(min(stake / 15_000.0, 1.0) * 10))
    rel_pts = rel_size_pts(rel)
    quality_boost = 6 if q >= 80 else 4 if q >= 70 else 2 if q >= 55 else 0
    tier_bonus = 3 if q >= 75 else 0
    base = roi_pct + cons_pct + value_pct + size_pct + rel_pts + quality_boost
    single_cap = 82 if rel >= 5 else 76 if rel >= 3 else 72 if rel >= 2 else 68
    score = min(base + tier_bonus, single_cap)
    uncapped = min(base + tier_bonus, 100)
    if book.n < WARMUP_EVENTS:
        score = 0
        uncapped = 0
    score = max(score, 0)

    return {
        "trader_q": q,
        "trader_roi": round(book.overall_roi(), 2),
        "trader_wr": round(book.win_rate(), 2),
        "trader_n": book.n,
        "sport_roi": round(sport_roi, 2),
        "lane_ok": book.lane_ok(str(row["sport_type"])),
        "rel_size": round(rel, 2),
        "median_stake": round(median, 2),
        "play_grade": int(score),
        "play_grade_uncapped": int(uncapped),
        "entry_price": round(p, 4),
        "breakdown": {
            "roi_pct": roi_pct,
            "cons_pct": cons_pct,
            "value_pct": value_pct,
            "size_pct": size_pct,
            "rel_pts": rel_pts,
            "quality_boost": quality_boost,
            "tier_bonus": tier_bonus,
        },
    }


def unit_pnl(won: bool, fill_price: float, stake: float = STAKE) -> float:
    p = min(max(fill_price, 0.02), 0.98)
    if won:
        return stake * (1.0 / p - 1.0)
    return -stake


def max_drawdown(series: list[float]) -> float:
    if not series:
        return 0.0
    peak = 0.0
    dd = 0.0
    eq = 0.0
    for x in series:
        eq += x
        peak = max(peak, eq)
        dd = min(dd, eq - peak)
    return float(dd)


def profit_factor(pnls: np.ndarray) -> float:
    gp = float(pnls[pnls > 0].sum()) if len(pnls) else 0.0
    gl = float(-pnls[pnls < 0].sum()) if len(pnls) else 0.0
    if gl <= 0:
        return float("inf") if gp > 0 else 0.0
    return gp / gl


def daily_sharpe(dates: list, pnls: np.ndarray) -> float:
    if len(pnls) < 5:
        return 0.0
    by: dict[object, float] = defaultdict(float)
    for d, x in zip(dates, pnls):
        day = d.date() if hasattr(d, "date") else d
        by[day] += float(x)
    vals = np.array(list(by.values()), dtype=float)
    if len(vals) < 5 or float(vals.std()) == 0:
        return 0.0
    return float(vals.mean() / vals.std() * math.sqrt(365.0))


def summarize(mask: np.ndarray, plays: pd.DataFrame, slip: float) -> dict:
    sub = plays.loc[mask].copy()
    if sub.empty:
        return {
            "n": 0, "wins": 0, "losses": 0, "win_rate": 0.0,
            "unit_pnl": 0.0, "expectancy": 0.0, "roi_on_stake": 0.0,
            "profit_factor": 0.0, "sharpe": 0.0, "max_dd": 0.0,
            "avg_grade": 0.0, "avg_trader_q": 0.0, "avg_entry": 0.0,
            "avg_fill": 0.0, "implied_wr": 0.0, "edge_vs_implied": 0.0,
            "avg_rel_size": 0.0,
        }
    fills = np.clip(sub["entry_price"].to_numpy() + slip, 0.02, 0.98)
    won = sub["won"].to_numpy()
    pnls = np.where(won, STAKE * (1.0 / fills - 1.0), -STAKE)
    n = int(len(sub))
    wins = int(won.sum())
    losses = n - wins
    wr = wins / n * 100.0
    upnl = float(pnls.sum())
    dates = sub["end_dt"].tolist()
    implied = float(sub["entry_price"].mean() * 100.0)
    fill_mean = float(fills.mean())
    return {
        "n": n,
        "wins": wins,
        "losses": losses,
        "win_rate": round(wr, 2),
        "unit_pnl": round(upnl, 2),
        "expectancy": round(float(pnls.mean()), 2),
        "roi_on_stake": round(upnl / (n * STAKE) * 100.0, 2),
        "profit_factor": round(profit_factor(pnls), 3),
        "sharpe": round(daily_sharpe(dates, pnls), 2),
        "max_dd": round(max_drawdown(pnls.tolist()), 2),
        "avg_grade": round(float(sub["play_grade"].mean()), 1),
        "avg_trader_q": round(float(sub["trader_q"].mean()), 1),
        "avg_entry": round(float(sub["entry_price"].mean()), 3),
        "avg_fill": round(fill_mean, 3),
        "implied_wr": round(implied, 1),
        "edge_vs_implied": round(wr - implied, 1),
        "avg_rel_size": round(float(sub["rel_size"].mean()), 2),
        "calmar": round(upnl / abs(max_drawdown(pnls.tolist()) or 1.0), 2),
    }


def walk_trader(df: pd.DataFrame) -> pd.DataFrame:
    book = ExpandingBook()
    rows = []
    for _, row in df.iterrows():
        g = grade_play(book, row)
        rec = {
            "username": row["username"],
            "wallet": row["wallet"],
            "grouping_id": row["grouping_id"],
            "sport_type": row["sport_type"],
            "market_type": row["market_type"],
            "end_dt": row["end_dt"],
            "total_cost": float(row["total_cost"]),
            "total_pnl": float(row["total_pnl"]),
            "won": bool(row["won"]),
            **{k: v for k, v in g.items() if k != "breakdown"},
        }
        rows.append(rec)
        book.update(row)
    return pd.DataFrame(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Walk-forward tailing backtest (no look-ahead)")
    parser.parse_args()

    roster = roster_traders()
    chunks = []
    print(f"Walk-forward tailing backtest  warmup={WARMUP_EVENTS}  stake=${STAKE:.0f}")
    print("-" * 96)

    for wallet, username in roster:
        csv_p = csv_path_for(wallet, username)
        if not csv_p.exists():
            continue
        try:
            ev = load_closed_events(csv_p, username, wallet)
        except Exception as e:
            print(f"  skip {username}: {e}")
            continue
        if len(ev) < WARMUP_EVENTS + 5:
            continue
        graded = walk_trader(ev)
        chunks.append(graded)
        tailable = graded[graded["trader_n"] >= WARMUP_EVENTS]
        print(
            f"{username:<32} {len(ev):>5} closed  → {len(tailable):>5} after warmup  "
            f"mean Q={tailable['trader_q'].mean():.0f}  mean grade={tailable['play_grade'].mean():.0f}"
        )

    if not chunks:
        print("No traders loaded.")
        return 1

    plays = pd.concat(chunks, ignore_index=True).sort_values("end_dt").reset_index(drop=True)
    rated = plays[plays["trader_n"] >= WARMUP_EVENTS].copy()
    print(f"\nUniverse: {len(plays):,} plays / {len(rated):,} after warmup across {rated['username'].nunique()} traders")

    # Strategy masks (all evaluated on rated set)
    g = rated
    strategies: list[tuple[str, pd.Series]] = [
        ("all_after_warmup", pd.Series(True, index=g.index)),
        ("grade_90plus", g["play_grade"] >= 90),
        ("grade_uncapped_90plus", g["play_grade_uncapped"] >= 90),
        ("grade_uncapped_85plus", g["play_grade_uncapped"] >= 85),
        ("grade_80plus", g["play_grade"] >= 80),
        ("grade_70plus", g["play_grade"] >= 70),
        ("grade_60plus", g["play_grade"] >= 60),
        ("grade_50plus", g["play_grade"] >= 50),
        ("band_90_100", g["play_grade"] >= 90),
        ("band_80_89", (g["play_grade"] >= 80) & (g["play_grade"] < 90)),
        ("band_70_79", (g["play_grade"] >= 70) & (g["play_grade"] < 80)),
        ("band_60_69", (g["play_grade"] >= 60) & (g["play_grade"] < 70)),
        ("band_50_59", (g["play_grade"] >= 50) & (g["play_grade"] < 60)),
        ("band_below_50", g["play_grade"] < 50),
        ("Q70_and_grade70", (g["trader_q"] >= 70) & (g["play_grade"] >= 70)),
        ("Q50_and_grade70", (g["trader_q"] >= 50) & (g["play_grade"] >= 70)),
        ("Q50_lane_2x", (g["trader_q"] >= 50) & g["lane_ok"] & (g["rel_size"] >= 2)),
        ("Q50_lane_3x", (g["trader_q"] >= 50) & g["lane_ok"] & (g["rel_size"] >= 3)),
        ("grade70_moneyline", (g["play_grade"] >= 70) & (g["market_type"] == "Moneyline / Match")),
        ("grade70_flip_40_60", (g["play_grade"] >= 70) & (g["entry_price"] >= 0.40) & (g["entry_price"] < 0.60)),
        ("grade70_underdog", (g["play_grade"] >= 70) & (g["entry_price"] < 0.45)),
        ("grade70_favorite", (g["play_grade"] >= 70) & (g["entry_price"] >= 0.60)),
        ("S_tier_any_play", g["trader_q"] >= 70),
        ("A_tier_lane_2x", (g["trader_q"] >= 50) & (g["trader_q"] < 70) & g["lane_ok"] & (g["rel_size"] >= 2)),
        ("grade70_no_other_sport", (g["play_grade"] >= 70) & (g["sport_type"] != "OTHER")),
        ("grade80_lane", (g["play_grade"] >= 80) & g["lane_ok"]),
        ("grade70_rel3x", (g["play_grade"] >= 70) & (g["rel_size"] >= 3)),
    ]

    table_rows = []
    by_strategy: dict[str, dict] = {}
    print("\n" + "=" * 110)
    print(f"{'Strategy':<28} {'Slip':>4} {'N':>6} {'WR':>6} {'Exp$':>7} {'ROI%':>7} {'PF':>6} {'Sharpe':>7} {'MaxDD':>8} {'Edge':>6}")
    print("-" * 110)

    for name, mask in strategies:
        mask = mask.fillna(False).astype(bool)
        slip_block = {}
        for slip in SLIPS:
            stats = summarize(mask, g, slip)
            slip_key = f"{int(slip * 100)}c"
            slip_block[slip_key] = stats
            if stats["n"] >= 15:
                print(
                    f"{name:<28} {slip_key:>4} {stats['n']:>6} {stats['win_rate']:>5.1f}% "
                    f"{stats['expectancy']:>7.2f} {stats['roi_on_stake']:>6.1f}% "
                    f"{stats['profit_factor']:>6.2f} {stats['sharpe']:>7.2f} "
                    f"{stats['max_dd']:>8.0f} {stats['edge_vs_implied']:>+5.1f}"
                )
            table_rows.append({"strategy": name, "slip": slip_key, **stats})
        by_strategy[name] = slip_block

    # Rank best strategies at 0c and 2c with n>=50
    def rank_key(r: dict) -> tuple:
        return (r["sharpe"], r["roi_on_stake"], r["n"])

    viable_0 = [r for r in table_rows if r["slip"] == "0c" and r["n"] >= 50]
    viable_2 = [r for r in table_rows if r["slip"] == "2c" and r["n"] >= 50]
    best_0 = sorted(viable_0, key=rank_key, reverse=True)[:8]
    best_2 = sorted(viable_2, key=rank_key, reverse=True)[:8]

    # Sport breakdown for the default recommended book: Q50 + winning lane + 2x
    rec_mask = ((g["trader_q"] >= 50) & g["lane_ok"] & (g["rel_size"] >= 2)).fillna(False)
    by_sport = {}
    for sport, grp in g.loc[rec_mask].groupby("sport_type"):
        idx = grp.index
        m = pd.Series(g.index.isin(idx), index=g.index)
        by_sport[str(sport)] = {f"{int(s*100)}c": summarize(m, g, s) for s in (0.0, 0.02)}

    by_year = {}
    years = g.loc[rec_mask, "end_dt"].dt.year
    for year, grp in g.loc[rec_mask].groupby(years):
        idx = grp.index
        m = pd.Series(g.index.isin(idx), index=g.index)
        by_year[str(int(year))] = {f"{int(s*100)}c": summarize(m, g, s) for s in (0.0, 0.02)}

    # Calibration: actual WR by grade band
    calibration = []
    for lo, hi, label, col in (
        (90, 101, "90+ (dashboard cap)", "play_grade"),
        (90, 101, "90+ (uncapped formula)", "play_grade_uncapped"),
        (80, 90, "80-89", "play_grade"),
        (70, 80, "70-79", "play_grade"),
        (60, 70, "60-69", "play_grade"),
        (50, 60, "50-59", "play_grade"),
        (0, 50, "<50", "play_grade"),
    ):
        band = g[(g[col] >= lo) & (g[col] < hi)]
        if band.empty:
            continue
        calibration.append({
            "band": label,
            "n": int(len(band)),
            "avg_grade": round(float(band["play_grade"].mean()), 1),
            "win_rate": round(float(band["won"].mean() * 100), 2),
            "implied_wr": round(float(band["entry_price"].mean() * 100), 1),
            "avg_trader_q": round(float(band["trader_q"].mean()), 1),
        })

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": (
            "Resolved-history walk-forward: each play is graded using only that trader's "
            "already-resolved directional events (endDate strictly before this play). "
            "Trader quality uses the pipeline formula (Sharpe/ROI/WR/consistency/volume + "
            "flip bonus − leakage). Play grade clones computeConfidence for a single trader "
            "at their entry (valueDelta=0). Single-trader dashboard cap is 68–82, so a "
            "90+ *dashboard* grade almost never fires on one wallet (that’s a multi-trader "
            "signal). Uncapped formula (max 100) is also reported. "
            "Tailing is $100/play; win pays (1/fill - 1), "
            "loss is −$100. Slippage buys the same side at entry+1/2/5 cents."
        ),
        "params": {
            "warmup_events": WARMUP_EVENTS,
            "unit_stake_usd": STAKE,
            "min_lane_events": MIN_LANE_EVENTS,
            "min_lane_roi": MIN_LANE_ROI,
            "slips": list(SLIPS),
        },
        "universe": {
            "traders": int(rated["username"].nunique()),
            "plays_total": int(len(plays)),
            "plays_after_warmup": int(len(rated)),
            "mean_play_grade": round(float(rated["play_grade"].mean()), 1),
            "mean_trader_q": round(float(rated["trader_q"].mean()), 1),
        },
        "calibration_by_grade_band": calibration,
        "strategies": by_strategy,
        "best_at_entry_fill_n50": best_0,
        "best_at_2c_slip_n50": best_2,
        "recommended_q50_lane_2x_by_sport": by_sport,
        "recommended_q50_lane_2x_by_year": by_year,
    }

    out_json = OUTPUT_DIR / "walkforward_tail_backtest.json"
    out_csv = OUTPUT_DIR / "walkforward_strategy_table.csv"
    out_json.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    pd.DataFrame(table_rows).to_csv(out_csv, index=False)

    print("\n" + "=" * 110)
    print("BEST at their entry price (n≥50), ranked by Sharpe then ROI")
    for r in best_0:
        print(
            f"  {r['strategy']:<28} n={r['n']:<5} WR={r['win_rate']:.1f}%  "
            f"ROI={r['roi_on_stake']:.1f}%  PF={r['profit_factor']:.2f}  "
            f"Sharpe={r['sharpe']:.2f}  DD={r['max_dd']:.0f}  Exp=${r['expectancy']:.2f}"
        )
    print("\nBEST with +2¢ slippage (n≥50)")
    for r in best_2:
        print(
            f"  {r['strategy']:<28} n={r['n']:<5} WR={r['win_rate']:.1f}%  "
            f"ROI={r['roi_on_stake']:.1f}%  PF={r['profit_factor']:.2f}  "
            f"Sharpe={r['sharpe']:.2f}  DD={r['max_dd']:.0f}  Exp=${r['expectancy']:.2f}"
        )
    print(f"\nWrote {out_json}")
    print(f"Wrote {out_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
