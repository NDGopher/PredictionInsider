#!/usr/bin/env python3
"""One-off walk-forward + style analysis for user-flagged wallets.

Usage:
  python pnl_analysis/analyze_user_wallets.py \\
    --pairs "Vigilant-Environment:0xdbdd...,sentrio:0xdb83..."
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from copy_roster import OUTPUT_DIR  # noqa: E402
from run_full_pipeline import csv_path_for  # noqa: E402
from walkforward_consensus_backtest import attach_event_dates  # noqa: E402
from walkforward_elite_discovery import (  # noqa: E402
    style_from_history,
    walk_trader,
)
from walkforward_elite_sniper import load_markets_with_entry  # noqa: E402

OUT = OUTPUT_DIR / "user_flagged_two_analysis.json"


def full_style(username: str, wallet: str, mk: pd.DataFrame) -> dict[str, Any]:
    """Style card on entire unique closed book."""
    rows = []
    for r in mk.itertuples(index=False):
        rows.append({
            "cost": float(r.cost),
            "hold_pnl": float(r.hold_pnl),
            "won": bool(r.won),
            "sport": str(r.sport_type),
            "sport_family": str(getattr(r, "sport_family", r.sport_type)),
            "submarket": str(getattr(r, "submarket", r.market_type)),
        })
    end_dts = [pd.Timestamp(r.end_dt).to_pydatetime() for r in mk.itertuples(index=False)]
    now = datetime.now(timezone.utc)
    card = style_from_history(rows, end_dts, now, end_dts[0] if end_dts else None)
    # last 90d slice
    cut90 = now - pd.Timedelta(days=90)
    idx90 = [i for i, d in enumerate(end_dts) if cut90 <= d.replace(tzinfo=timezone.utc) <= now]
    l90_pnl = sum(rows[i]["hold_pnl"] for i in idx90) if idx90 else 0.0
    l90_cost = sum(rows[i]["cost"] for i in idx90) or 1.0
    return {
        "n": len(rows),
        "unique_roi": round(card.unique_roi, 2),
        "median": round(card.median, 2),
        "wr": round(card.wr, 1),
        "sports_frac": round(card.sports_frac, 2),
        "last90_n": len(idx90),
        "last90_roi": round(100.0 * l90_pnl / l90_cost, 2),
        "top_sports": card.top_sports,
        "top_submarkets": card.top_submarkets,
        "curve_score": round(card.curve_score, 1),
        "curve": card.curve,
    }


def walk_summary(walk) -> dict[str, Any]:
    first_scout = first_elite = None
    scout_why = elite_why = None
    for ch in walk.roster_log:
        if ch.get("to") == "scout" and first_scout is None:
            first_scout = str(ch.get("at") or "")[:10]
            scout_why = ch.get("why")
        if ch.get("to") == "elite" and first_elite is None:
            first_elite = str(ch.get("at") or "")[:10]
            elite_why = ch.get("why")
    trade_roi = 0.0
    if walk.trades:
        trade_roi = round(100.0 * sum(t["unit_pnl"] for t in walk.trades) / (100 * len(walk.trades)), 2)
    return {
        "first_scout": first_scout,
        "first_scout_why": scout_why,
        "first_elite": first_elite,
        "first_elite_why": elite_why,
        "tier": walk.final.get("tier"),
        "why": walk.final.get("why"),
        "trades": len(walk.trades),
        "curve_score": walk.final.get("curve_score"),
        "take_n": walk.final.get("take_n"),
        "take_roi": walk.final.get("take_roi"),
        "active_30d": walk.final.get("active_30d"),
        "trade_roi": trade_roi,
        "sample_trades": walk.trades[:12],
    }


def why_missed(label: str, wallet: str, style: dict, walk: dict, api: dict | None) -> list[str]:
    reasons: list[str] = []
    if not csv_path_for(wallet, label.split("/")[0]).exists():
        reasons.append("never_ingested_no_local_csv")
    if float(style.get("unique_roi") or 0) < 0:
        reasons.append(f"lifetime_unique_negative={style.get('unique_roi')}%")
    if int(style.get("n") or 0) > 20_000:
        reasons.append(f"mega_tape_{style.get('n')}_rows_skipped_by_discovery_max")
    if api and not api.get("scout_candidate"):
        if float(api.get("sports_frac_est") or 0) < 0.45:
            reasons.append(f"api_screen_sports_frac={api.get('sports_frac_est')}<0.45")
    if walk.get("first_scout") is None:
        reasons.append("walkforward_never_scouted")
    elif walk.get("first_elite") is None:
        reasons.append("walkforward_scouted_never_elited")
    return reasons


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--pairs",
        default=(
            "Vigilant-Environment:0xdbdd45150249e229eb4ca8aa48a30dca21faa5de,"
            "sentrio:0xdb83e85ffd22faa4009273034770f96ffc5b1e50"
        ),
    )
    args = ap.parse_args()

    api_path = OUTPUT_DIR / "api_curve_screen.json"
    api_by_wallet: dict[str, dict] = {}
    if api_path.exists():
        for row in json.loads(api_path.read_text()).get("all") or []:
            api_by_wallet[str(row.get("wallet") or "").lower()] = row

    results: list[dict[str, Any]] = []
    for part in args.pairs.split(","):
        part = part.strip()
        if ":" not in part:
            continue
        label, wallet = part.split(":", 1)
        wallet = wallet.lower()
        csv_p = csv_path_for(wallet, label)
        if not csv_p.exists():
            results.append({"label": label, "wallet": wallet, "error": f"missing_csv {csv_p.name}"})
            continue
        print(f"Analyzing {label} ({wallet[:10]}…) rows≈{sum(1 for _ in open(csv_p)) - 1}", flush=True)
        mk_full = attach_event_dates(load_markets_with_entry(csv_p, label, wallet))
        mk_full = mk_full[mk_full["won"].notna()].copy()
        style = full_style(label, wallet, mk_full)
        # Walk-forward is O(n²); cap to recent resolved closed for timing (full book style above).
        mk = mk_full.sort_values("end_dt").copy()
        if len(mk) > 3_000:
            mk = mk.iloc[-3_000:].copy()
            print(f"  walk-forward capped to last {len(mk)} resolved markets", flush=True)
        walk = walk_trader(label, wallet, mk)
        wsum = walk_summary(walk)
        api = api_by_wallet.get(wallet)
        results.append({
            "label": label,
            "username": label,
            "wallet": wallet,
            "style": style,
            "walk": wsum,
            "api_screen": api,
            "miss_reasons": why_missed(label, wallet, style, wsum, api),
            "roster_log": walk.roster_log[:20],
        })

    OUT.write_text(json.dumps(results, indent=2, default=str) + "\n", encoding="utf-8")
    print(f"Wrote {OUT}", flush=True)
    for r in results:
        w = r.get("walk") or {}
        s = r.get("style") or {}
        print(
            f"  {r.get('label')}: unique={s.get('unique_roi')}% last90={s.get('last90_roi')}% "
            f"scout={w.get('first_scout')} elite={w.get('first_elite')} tier={w.get('tier')} "
            f"sniper_n={w.get('trades')}",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
