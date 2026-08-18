#!/usr/bin/env python3
"""
Backtest: copy highly graded (high-conviction, winning-lane) closed plays from top traders.

A play is "high grade" when ALL of:
  - Trader quality_score >= --min-quality (default 50 = A/S tier)
  - Event is in a sport lane with ROI >= --lane-roi and >= --lane-events
  - Stake >= --conviction-x × that trader's median market stake
  - Closed, directional (hedges and 95c+ NO bonds stripped, same as analyze_trader)

Writes pnl_analysis/output/backtest_high_grade.json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_trader import get_market_type, get_sport  # noqa: E402
from run_full_pipeline import OUTPUT_DIR, csv_path_for, json_path_for, roster_traders  # noqa: E402

STAKE_USD = 100.0  # flat unit stake for the copy-trade portfolio


def _metrics(rows: pd.DataFrame) -> dict:
    if rows is None or rows.empty:
        return {
            "events": 0,
            "wins": 0,
            "losses": 0,
            "win_rate": 0.0,
            "pnl": 0.0,
            "risked": 0.0,
            "roi": 0.0,
            "unit_pnl": 0.0,
            "avg_stake": 0.0,
        }
    events = int(len(rows))
    wins = int((rows["total_pnl"] > 0).sum())
    losses = int((rows["total_pnl"] < 0).sum())
    pnl = float(rows["total_pnl"].sum())
    risked = float(rows["total_cost"].sum())
    roi = (pnl / risked * 100) if risked > 0 else 0.0
    wr_den = wins + losses
    # $STAKE_USD per event, scaled by actual event ROI
    unit_pnl = float(((rows["total_pnl"] / rows["total_cost"].replace(0, np.nan)) * STAKE_USD).fillna(0).sum())
    return {
        "events": events,
        "wins": wins,
        "losses": losses,
        "win_rate": round((wins / wr_den * 100) if wr_den else 0.0, 2),
        "pnl": round(pnl, 2),
        "risked": round(risked, 2),
        "roi": round(roi, 2),
        "unit_pnl": round(unit_pnl, 2),
        "avg_stake": round(risked / events, 2) if events else 0.0,
    }


def _hedged_ids(df: pd.DataFrame) -> set:
    if "conditionId" not in df.columns or "outcome" not in df.columns:
        return set()
    cond_outcomes = (
        df.groupby("conditionId")["outcome"]
        .apply(lambda s: {str(v).strip().lower() for v in s if pd.notna(v)})
    )
    hedged = set()
    for cid, outcomes in cond_outcomes.items():
        if "yes" in outcomes and "no" in outcomes:
            hedged.add(cid)
            continue
        specific = {o for o in outcomes if o not in ("yes", "no")}
        if len(specific) >= 2:
            hedged.add(cid)
    return hedged


def load_closed_events(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path, low_memory=False)
    for col in ("realizedPnl", "cashPnl", "currentValue", "initialValue", "totalBought", "avgPrice"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        else:
            df[col] = 0.0
    if "total_position_pnl" not in df.columns:
        df["total_position_pnl"] = df["realizedPnl"] + df["cashPnl"]
    df["grouping_id"] = df["eventSlug"].fillna(df.get("slug", ""))
    df["calculated_cost"] = df.apply(
        lambda r: r["totalBought"] * r["avgPrice"] if str(r.get("status", "")).lower() == "closed" else r["initialValue"],
        axis=1,
    )
    df["sport_type"] = df.apply(get_sport, axis=1)
    df["market_type"] = df.apply(get_market_type, axis=1)
    outcome = df["outcome"].astype(str).str.strip().str.lower() if "outcome" in df.columns else ""
    df["bet_side"] = np.where(outcome == "yes", "Yes", np.where(outcome == "no", "No", "Specific Selection"))

    hedged = _hedged_ids(df)
    if hedged:
        df = df[~df["conditionId"].isin(hedged)].copy()
    df["is_bond"] = (df["bet_side"] == "No") & (df["avgPrice"] >= 0.95)
    df = df[~df["is_bond"]].copy()
    df = df[df["status"].astype(str).str.lower() == "closed"].copy()
    if df.empty:
        return df

    agg = df.groupby("grouping_id").agg(
        total_pnl=("total_position_pnl", "sum"),
        total_cost=("calculated_cost", "sum"),
        sport_type=("sport_type", "first"),
        market_type=("market_type", "first"),
        title=("title", "first"),
        end_date=("endDate", "first"),
    ).reset_index()
    agg = agg[agg["total_cost"] > 0].copy()
    return agg


def winning_lanes(sport_stats: dict, min_roi: float, min_events: int) -> set[str]:
    lanes = set()
    if not isinstance(sport_stats, dict):
        return lanes
    for sport, stats in sport_stats.items():
        if not isinstance(stats, dict):
            continue
        events = int(stats.get("events") or 0)
        roi = float(stats.get("roi") or 0)
        if events >= min_events and roi >= min_roi:
            lanes.add(sport)
    return lanes


def main() -> int:
    parser = argparse.ArgumentParser(description="Backtest high-grade plays from top traders")
    parser.add_argument("--min-quality", type=int, default=50, help="Min quality_score (50=A-Tier)")
    parser.add_argument("--lane-roi", type=float, default=5.0, help="Min sport-lane ROI %% to copy")
    parser.add_argument("--lane-events", type=int, default=8, help="Min events in that sport lane")
    parser.add_argument("--conviction-x", type=float, default=2.0, help="Stake vs median market stake")
    parser.add_argument("--moneyline-only", action="store_true", help="Skip spreads/totals/futures")
    args = parser.parse_args()

    roster = roster_traders()
    traders_out = []
    all_high = []
    all_baseline = []

    print(f"Backtest high-grade plays  Q>={args.min_quality}  lane ROI>={args.lane_roi}%  {args.conviction_x}× median")
    print("-" * 88)

    for wallet, username in roster:
        json_p = json_path_for(wallet, username)
        csv_p = csv_path_for(wallet, username)
        if not json_p.exists() or not csv_p.exists():
            continue
        try:
            profile = json.loads(json_p.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  skip {username}: bad JSON ({e})")
            continue
        q = int(profile.get("quality_score") or 0)
        if q < args.min_quality:
            continue
        try:
            events = load_closed_events(csv_p)
        except Exception as e:
            print(f"  skip {username}: CSV ({e})")
            continue
        if events.empty:
            continue

        median_stake = float(profile.get("median_market_stake") or events["total_cost"].median() or 0)
        lanes = winning_lanes(profile.get("sport_stats") or {}, args.lane_roi, args.lane_events)
        high = events[events["sport_type"].isin(lanes)].copy() if lanes else events.iloc[0:0].copy()
        if median_stake > 0:
            high = high[high["total_cost"] >= args.conviction_x * median_stake]
        if args.moneyline_only:
            high = high[high["market_type"] == "Moneyline / Match"]

        base_m = _metrics(events)
        high_m = _metrics(high)
        delta = round(high_m["roi"] - base_m["roi"], 2)
        traders_out.append(
            {
                "username": username,
                "wallet": wallet.lower(),
                "tier": profile.get("tier"),
                "quality_score": q,
                "winning_lanes": sorted(lanes),
                "median_stake": round(median_stake, 2),
                "baseline": base_m,
                "high_grade": high_m,
                "roi_lift_pts": delta,
            }
        )
        events = events.copy()
        events["username"] = username
        high = high.copy()
        high["username"] = username
        all_baseline.append(events)
        all_high.append(high)
        print(
            f"{profile.get('tier','?'):<8} Q={q:>3}  {username:<32}  "
            f"all {base_m['events']:>5} ROI {base_m['roi']:>6.1f}%  |  "
            f"high {high_m['events']:>4} ROI {high_m['roi']:>6.1f}%  lift {delta:>+6.1f}  "
            f"unit ${high_m['unit_pnl']:>8,.0f}"
        )

    high_all = pd.concat(all_high, ignore_index=True) if all_high else pd.DataFrame()
    base_all = pd.concat(all_baseline, ignore_index=True) if all_baseline else pd.DataFrame()
    portfolio_high = _metrics(high_all)
    portfolio_base = _metrics(base_all)

    # Equal-trader blend (avoid whales dominating)
    eq_unit = 0.0
    eq_n = 0
    for t in traders_out:
        if t["high_grade"]["events"] > 0:
            eq_unit += t["high_grade"]["unit_pnl"]
            eq_n += 1

    by_sport: dict[str, dict] = {}
    if not high_all.empty and "sport_type" in high_all.columns:
        for sport, grp in high_all.groupby("sport_type"):
            by_sport[str(sport)] = _metrics(grp)

    traders_out.sort(key=lambda t: t["quality_score"], reverse=True)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "params": {
            "min_quality": args.min_quality,
            "lane_roi": args.lane_roi,
            "lane_events": args.lane_events,
            "conviction_x": args.conviction_x,
            "moneyline_only": args.moneyline_only,
            "unit_stake_usd": STAKE_USD,
        },
        "traders_included": len(traders_out),
        "portfolio": {
            "copy_all_closed": portfolio_base,
            "copy_high_grade": portfolio_high,
            "roi_lift_pts": round(portfolio_high["roi"] - portfolio_base["roi"], 2),
            "equal_trader_high_grade_unit_pnl": round(eq_unit, 2),
            "equal_trader_count": eq_n,
        },
        "by_sport": by_sport,
        "traders": traders_out,
    }
    out_path = OUTPUT_DIR / "backtest_high_grade.json"
    out_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")

    print("\n" + "=" * 88)
    print(
        f"PORTFOLIO  copy-all: {portfolio_base['events']} events  "
        f"ROI {portfolio_base['roi']:.1f}%  WR {portfolio_base['win_rate']:.1f}%"
    )
    print(
        f"PORTFOLIO  high-grade: {portfolio_high['events']} events  "
        f"ROI {portfolio_high['roi']:.1f}%  WR {portfolio_high['win_rate']:.1f}%  "
        f"lift {report['portfolio']['roi_lift_pts']:+.1f} pts"
    )
    print(
        f"Equal-weight unit PnL (${STAKE_USD:.0f}/play) across {eq_n} traders: "
        f"${eq_unit:,.0f}"
    )
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
