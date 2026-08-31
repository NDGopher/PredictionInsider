#!/usr/bin/env python3
"""Diagnose why live books' opens aren't TAKE."""
from __future__ import annotations

import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_trader import get_sport  # noqa: E402
from copy_roster import load_universe  # noqa: E402
from position_utils import classify_submarket, mark_resolved, read_trader_csv  # noqa: E402
from run_full_pipeline import csv_path_for  # noqa: E402
from take_book_daily import title_is_stale  # noqa: E402
from walkforward_consensus_backtest import (  # noqa: E402
    KNOWLEDGE_LAG,
    LIVE_HI,
    LIVE_LO,
    MIN_LANE_ROI,
    STALE_ENTRY,
    WARMUP,
    build_snapshots,
    load_trader_markets,
    lookup_snap,
)


def main() -> int:
    uni = load_universe()
    now = datetime.now(timezone.utc)
    for t in uni.get("live") or []:
        u = str(t["username"])
        w = str(t["wallet"])
        csv_p = csv_path_for(w, u)
        if not csv_p.exists():
            print(u, "NO CSV")
            continue
        mk = load_trader_markets(csv_p, u, w.lower())
        snaps = build_snapshots(mk) if len(mk) >= WARMUP else []
        snap = lookup_snap(snaps, now - KNOWLEDGE_LAG) if snaps else None
        q = int(snap["q"]) if snap else 0
        median = float(snap["median"]) if snap else 0.0
        sport_roi_map = (snap.get("sport_roi") or {}) if snap else {}
        raw = mark_resolved(read_trader_csv(csv_p))
        for col in ("avgPrice", "totalBought", "initialValue", "curPrice"):
            raw[col] = pd.to_numeric(raw[col], errors="coerce").fillna(0.0)
        statuses = (
            raw["status"].astype(str).value_counts().to_dict()
            if "status" in raw.columns
            else {}
        )
        print(f"\n=== {u} Q={q} median=${median:,.0f}")
        print("  as-of sport ROI:", list(sport_roi_map.items())[:10])
        print("  status counts", statuses)
        cand = raw[(raw["curPrice"] > 0.02) & (raw["curPrice"] < 0.98)].copy()
        if "status" in cand.columns:
            cand = cand[~cand["status"].astype(str).str.lower().eq("closed")]
        print(f"  openish rows={len(cand)}")
        misses_count: Counter[str] = Counter()
        almost: list[tuple] = []
        for r in cand.itertuples(index=False):
            title = str(getattr(r, "title", "") or "")
            if title_is_stale(title, now):
                continue
            px = float(r.avgPrice)
            c = float(r.initialValue) if float(r.initialValue) > 0 else float(r.totalBought) * px
            row_dict = {
                "title": title,
                "slug": str(getattr(r, "slug", "") or ""),
                "eventSlug": str(getattr(r, "eventSlug", "") or ""),
            }
            sport = get_sport(row_dict)
            sub = classify_submarket(row_dict)
            rel = (c / median) if median > 0 else 0.0
            sport_roi = float(sport_roi_map.get(sport, -999.0))
            lane_ok = sport in sport_roi_map and sport_roi >= MIN_LANE_ROI
            miss: list[str] = []
            if q < 60:
                miss.append(f"Q{q}<60")
            if not (LIVE_LO <= px <= min(LIVE_HI, STALE_ENTRY)):
                miss.append(f"px{px:.2f}")
            if rel < 2:
                miss.append(f"rel{rel:.1f}<2")
            if not lane_ok:
                roi_s = f"{sport_roi:.0f}%" if sport_roi > -900 else "n/a"
                miss.append(f"{sport}ROI={roi_s}")
            if "NFL" in str(sport).upper():
                miss.append("NFL")
            if "Future" in str(sub):
                miss.append("fut")
            key = "|".join(miss) if miss else "TAKE"
            misses_count[key] += 1
            if len(miss) <= 2:
                almost.append((miss, sport, sub, px, rel, title[:75]))
        print("  miss buckets:")
        for k, v in misses_count.most_common(12):
            print(f"    {v:4d}  {k}")
        print("  closest:")
        for m, sp, sub, px, rel, title in sorted(almost, key=lambda x: len(x[0]))[:10]:
            print(f"    {m} {sp}/{sub} px={px:.2f} rel={rel:.1f}x  {title}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
