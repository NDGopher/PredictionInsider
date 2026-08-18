#!/usr/bin/env python3
"""Screen joinable books through the take rule and write copy_universe + lane stats.

Does not bump the signals cache. Rebuilds take_lane_backtest.json with futures
carved out of Other (politics stays; futures are not shown).
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from asof_fullbook_backtest import (  # noqa: E402
    STAKE,
    asof_stat,
    collect_plays,
    strategy_masks,
)
from copy_roster import (  # noqa: E402
    OUTPUT_DIR,
    build_universe,
    write_universe,
)

LANE_OUT = OUTPUT_DIR / "take_lane_backtest.json"
EVOLVE_OUT = OUTPUT_DIR / "copy_evolve_backtest.json"


def _lane_stats(sub: pd.DataFrame) -> dict[str, Any]:
    st = asof_stat(sub, 0.02)
    return {"n": st["n"], "win_rate": st["win_rate"], "roi_2c": st["roi"]}


def take_mask(df: pd.DataFrame) -> pd.Series:
    masks = strategy_masks(df)
    return masks["asof_live_q60_sport_rel2"]


def no_futures(df: pd.DataFrame) -> pd.Series:
    sm = df["submarket"].astype(str)
    return ~sm.str.contains("Future", case=False, na=False)


def politics_other(df: pd.DataFrame) -> pd.Series:
    sport = df["sport"].astype(str)
    fam = df["sport_family"].astype(str) if "sport_family" in df.columns else sport
    blob = sport + " " + fam
    return blob.str.contains("politic|crypto|finance|culture|weather", case=False, na=False)


def pool_stat(df: pd.DataFrame, names: list[str], label: str) -> dict[str, Any]:
    if df.empty or not names:
        return {"label": label, "n": 0, "win_rate": 0.0, "roi_2c": 0.0, "traders": names}
    sub = df[df["username"].isin(names)]
    mask = take_mask(sub) & no_futures(sub)
    st = asof_stat(sub.loc[mask.fillna(False)], 0.02)
    by = []
    for name, grp in sub.loc[mask.fillna(False)].groupby("username"):
        s = asof_stat(grp, 0.02)
        by.append({"username": str(name), "n": s["n"], "win_rate": s["win_rate"], "roi_2c": s["roi"]})
    by.sort(key=lambda r: -r["n"])
    return {
        "label": label,
        "n": st["n"],
        "win_rate": st["win_rate"],
        "roi_2c": st["roi"],
        "traders": names,
        "by_trader": by,
    }


def main() -> int:
    uni = write_universe(build_universe())
    live_names = [t["username"] for t in uni.get("live") or []]
    bench_names = [t["username"] for t in uni.get("bench") or []]
    take_names = [t["username"] for t in uni.get("take_book_matched") or []]
    skip_names = {t["username"] for t in uni.get("skip") or []}
    screen = live_names + [n for n in bench_names if n not in live_names]
    # Always evaluate the matched 12 so we can show what dropping bots does.
    extra = [{"wallet": t["wallet"], "username": t["username"]} for t in uni.get("live") or []]
    extra += [{"wallet": t["wallet"], "username": t["username"]} for t in uni.get("bench") or []]
    trusted = uni.get("take_book_matched") or []
    print(f"[evolve] live={live_names} bench={bench_names}")
    df = collect_plays(trusted, extra_books=extra)
    if df.empty:
        print("[evolve] no plays")
        return 1
    df = df.copy()
    take_all = take_mask(df)
    sports_m = ~politics_other(df) & no_futures(df)
    other_m = politics_other(df) & no_futures(df)
    fut = ~no_futures(df)

    pools = [
        pool_stat(df, take_names, "matched_12"),
        pool_stat(df, [n for n in take_names if n not in skip_names], "matched_12_minus_bots"),
        pool_stat(df, live_names, "live_joinable"),
        pool_stat(df, screen, "live_plus_bench"),
    ]
    live_pool = next((p for p in pools if p["label"] == "live_joinable"), None)
    demoted: list[str] = []
    for row in (live_pool or {}).get("by_trader") or []:
        if int(row.get("n") or 0) >= 12 and float(row.get("roi_2c") or 0) < 0:
            demoted.append(str(row["username"]))
    if demoted:
        print(f"[evolve] demote from live (take-rule −ROI): {demoted}")
        live_set = set(live_names)
        for t in uni.get("live") or []:
            if t["username"] in demoted:
                t["bucket"] = "bench"
                t["reasons"] = list(t.get("reasons") or []) + ["take_rule_negative"]
                uni.setdefault("bench", []).append(t)
                live_set.discard(t["username"])
        uni["live"] = [t for t in (uni.get("live") or []) if t["username"] not in demoted]
        live_names = [t["username"] for t in uni["live"]]
        bench_names = [t["username"] for t in uni.get("bench") or []]
        pools.append(pool_stat(df, live_names, "live_after_demote"))
    uni["counts"] = {
        **(uni.get("counts") or {}),
        "live": len(uni.get("live") or []),
        "bench": len(uni.get("bench") or []),
    }

    live_m = df["username"].isin(live_names)
    take_nf = df.loc[(take_all & no_futures(df) & live_m).fillna(False)]
    lane_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "rule": "asof_live_q60_sport_rel2 (Q>=60, sport ROI>=5%, rel>=2, 10-88c, no NFL, fill VWAP+2c). Futures excluded from product.",
        "all": _lane_stats(take_nf),
        "sports": _lane_stats(df.loc[(take_all & sports_m & live_m).fillna(False)]),
        "other": _lane_stats(df.loc[(take_all & other_m & live_m).fillna(False)]),
        "futures_excluded": _lane_stats(df.loc[(take_all & fut).fillna(False)]),
        "by_submarket": {},
        "note": (
            "Sports = game ML/spread/total. Other = politics / non-game (no futures). "
            "Futures n is too small and −ROI — not shown and not copied. "
            "Live copy list is joinable HOT/WARM books only (see copy_universe.json)."
        ),
    }
    for key, grp in take_nf.groupby("submarket"):
        if str(key).lower().startswith("future"):
            continue
        lane_payload["by_submarket"][str(key)] = _lane_stats(grp)

    LANE_OUT.write_text(json.dumps(lane_payload, indent=2), encoding="utf-8")
    EVOLVE_OUT.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "pools": pools,
                "live": live_names,
                "bench": bench_names,
                "lane": lane_payload,
            },
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )
    uni["backtest"] = {p["label"]: {"n": p["n"], "win_rate": p["win_rate"], "roi_2c": p["roi_2c"]} for p in pools}
    write_universe(uni)
    print(f"[evolve] wrote {LANE_OUT} and {EVOLVE_OUT}")
    for p in pools:
        print(f"  {p['label']:<24} n={p['n']:>4} WR={p['win_rate']}% +2¢={p['roi_2c']}%")
        for t in p.get("by_trader") or []:
            print(f"      {t['username']:<32} n={t['n']:<4} WR={t['win_rate']}% roi={t['roi_2c']}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
