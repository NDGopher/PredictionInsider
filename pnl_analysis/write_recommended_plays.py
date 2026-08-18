#!/usr/bin/env python3
"""Rewrite tail_strategies.json with a short, ranked list of plays to take.

Uses the walk-forward 2+ consensus tape. Fill = join_max + 2¢, $100/play, hold to res.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_full_pipeline import OUTPUT_DIR  # noqa: E402
from walkforward_consensus_backtest import (  # noqa: E402
    LIVE_HI,
    LIVE_LO,
    STAKE,
    STALE_ENTRY,
    breakdown_table,
    plays_payload,
    sport_submarket_rows,
    summarize,
    year_split,
)

CSV = OUTPUT_DIR / "walkforward_consensus_filtered_2plus.csv"
OUT = OUTPUT_DIR / "tail_strategies.json"
MD = Path(__file__).resolve().parent / "RECOMMENDED_PLAYS.md"


def _nameset(raw: object) -> set[str]:
    return {x.strip() for x in str(raw or "").split(",") if x.strip()}


def load_tape() -> pd.DataFrame:
    df = pd.read_csv(CSV)
    df["end_dt"] = pd.to_datetime(df["end_dt"], utc=True)
    df["won"] = df["won"].astype(str).str.lower().isin(["true", "1", "yes"])
    for col in ("vwap", "join_max", "grade", "avg_q", "min_q", "n_traders", "n_counters"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df["name_set"] = df["traders"].map(_nameset)
    return df


def card(sub: pd.DataFrame, **meta: object) -> dict:
    sjoin2 = summarize(sub, "join_max", 0.02)
    return {
        "join_max_plus_2c": sjoin2,
        "join_max": summarize(sub, "join_max", 0.0),
        "vwap": summarize(sub, "vwap", 0.0),
        "vwap_plus_2c": summarize(sub, "vwap", 0.02),
        "years": year_split(sub, "join_max", 0.02),
        "by_submarket": breakdown_table(sub, "submarket"),
        "sport_x_submarket": sport_submarket_rows(sub),
        "last_20": plays_payload(sub, 20),
        "date_span": {
            "first": sjoin2.get("first"),
            "last": sjoin2.get("last"),
            "trades_per_day": sjoin2.get("trades_per_day"),
        },
        **meta,
    }


def write_markdown(payload: dict) -> str:
    lines = [
        "# Recommended plays to take",
        "",
        f"As of **{payload.get('as_of')}**. Last resolved game **{payload.get('universe', {}).get('max_resolved_date')}**. "
        f"$100/play, hold to resolution, fill at **join_max + 2¢** (the later voter’s price plus two cents).",
        "",
        "Copy-all of every tailable wallet is **−1.5% ROI**. Ghost/ferrari closed books were winner-sorted; do not take the 98% Ghost cluster.",
        "",
        "## Take these",
        "",
        "| # | When to take it | n | WR | Their price | Your fill (+2¢) | Last |",
        "|---|-----------------|--:|---:|------------:|----------------:|------|",
    ]
    rank = 0
    for s in payload.get("strategies") or []:
        if not s.get("recommended"):
            continue
        rank += 1
        st = s.get("join_max_plus_2c") or {}
        vw = s.get("vwap") or {}
        lines.append(
            f"| {rank} | **{s.get('name')}** — {s.get('rule')} | {st.get('n')} | {st.get('win_rate')}% | "
            f"{vw.get('roi')}% | **{st.get('roi')}%** | {st.get('last')} |"
        )
    lines += [
        "",
        "## Do not take",
        "",
        "| Book | n | WR | Your fill (+2¢) | Why |",
        "|------|--:|---:|----------------:|-----|",
    ]
    for s in payload.get("strategies") or []:
        if s.get("recommended"):
            continue
        st = s.get("join_max_plus_2c") or {}
        lines.append(
            f"| **{s.get('name')}** | {st.get('n')} | {st.get('win_rate')}% | **{st.get('roi')}%** | {s.get('rule')} |"
        )
    lines += [
        "",
        "- Grade under 60 (2+ still **−43%**).",
        "- Cannae as an unfiltered 2+ voter (soccer 2+ falls from +14% to +7%). Overlay soccer ML **NO** only.",
        "- NFL, spreads as a default, quitters, $30k+ median wallets, 94% WR grinders.",
        "",
        "## How to fill",
        "",
        "1. Wait until the second wallet is in (that is the alert).",
        "2. Pay up to their worse entry (**join_max**) plus **2¢**. Do not assume you get their VWAP.",
        "3. Hold to resolution. CLV vs the close is negative — we are not beating the close.",
        "",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    if not CSV.exists():
        print(f"Missing {CSV}; run npm run backtest:consensus first")
        return 1
    df = load_tape()
    live = (
        (df["n_traders"] >= 2)
        & (df["vwap"] >= LIVE_LO)
        & (df["vwap"] <= LIVE_HI)
        & (df["vwap"] <= STALE_ENTRY)
    )
    is_ml = df["submarket"].astype(str).isin(["Moneyline", "Moneyline / Match"]) | df[
        "market_type"
    ].astype(str).str.contains("Moneyline", na=False)
    no_cannae = ~df["traders"].astype(str).str.contains("Cannae", na=False)
    no_nfl = ~df["sport_type"].astype(str).str.contains("NFL", na=False)
    soccer = df["sport_type"].astype(str).str.startswith("SOCCER")

    def has(name: str) -> pd.Series:
        return df["name_set"].map(lambda s, n=name: n in s)

    specs = [
        {
            "id": "ghost_2plus_ml",
            "name": "GoalLineGhost moneyline (2+) — DO NOT TAKE",
            "recommended": False,
            "priority": 1,
            "rule": "INVALID. Closed-positions were winner-sorted. Ghost public WR is ~53% / PnL −$1.14M. The 98% book was missing losers.",
            "description": (
                "This is the book to take. Ghost’s soccer/other moneylines with a second voter. "
                "Without Ghost, 2+ Q50 moneyline is −52%. You are tailing Ghost, not a 12-name consensus. "
                "Pay join_max+2¢ and hold to the game."
            ),
            "mask": live & is_ml & has("GoalLineGhost") & no_cannae & no_nfl,
            "filters": {
                "minTraders": 2,
                "minGrade": 0,
                "minQ": 0,
                "priceLo": 0.10,
                "priceHi": 0.88,
                "excludeUsernames": ["Cannae"],
                "requireUsernames": ["GoalLineGhost"],
                "skipSports": ["NFL"],
                "marketTypes": ["Moneyline", "Moneyline / Match"],
            },
        },
        {
            "id": "ghost_ferrari_ml",
            "name": "Ghost + ferrari moneyline — DO NOT TAKE",
            "recommended": False,
            "priority": 2,
            "rule": "Same as #1, and ferrariChampions2026 is also on the ticket.",
            "description": (
                "Tightest pair. Highest win rate. Size down if you only want Ghost+ferrari, not every Ghost 2+."
            ),
            "mask": live & is_ml & has("GoalLineGhost") & has("ferrariChampions2026") & no_cannae & no_nfl,
            "filters": {
                "minTraders": 2,
                "minGrade": 0,
                "minQ": 0,
                "priceLo": 0.10,
                "priceHi": 0.88,
                "excludeUsernames": ["Cannae"],
                "requireUsernames": ["GoalLineGhost", "ferrariChampions2026"],
                "skipSports": ["NFL"],
                "marketTypes": ["Moneyline", "Moneyline / Match"],
            },
        },
        {
            "id": "ghost_rn1_ml",
            "name": "Ghost + RN1 moneyline — DO NOT TAKE",
            "recommended": False,
            "priority": 3,
            "rule": "Same as #1, and RN1 is also on the ticket.",
            "description": "Second-best pair. Still Ghost’s moneyline with RN1 confirming.",
            "mask": live & is_ml & has("GoalLineGhost") & has("RN1") & no_cannae & no_nfl,
            "filters": {
                "minTraders": 2,
                "minGrade": 0,
                "minQ": 0,
                "priceLo": 0.10,
                "priceHi": 0.88,
                "excludeUsernames": ["Cannae"],
                "requireUsernames": ["GoalLineGhost", "RN1"],
                "skipSports": ["NFL"],
                "marketTypes": ["Moneyline", "Moneyline / Match"],
            },
        },
        {
            "id": "favorites_60_80",
            "name": "Favorites 60–80¢ — contaminated tape",
            "recommended": False,
            "priority": 4,
            "rule": "2+ wallets, price 60–80¢, no Cannae, no NFL. Use when you do not want Ghost-sized variance.",
            "description": (
                "Slower book. Less concentrated than Ghost moneylines. Still positive after 2¢ slip."
            ),
            "mask": live & (df["vwap"] >= 0.60) & (df["vwap"] < 0.80) & no_cannae & no_nfl,
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
            "id": "soccer_ml_no_cannae",
            "name": "Soccer moneyline, no Cannae — contaminated tape",
            "recommended": False,
            "priority": 5,
            "rule": "Soccer match-winner, 2+ wallets, Cannae does not vote. Optional if Ghost is not on the play.",
            "description": (
                "Soccer 2+ is worse with Cannae in the cluster (+7% vs +14%). "
                "Cannae soccer ML NO is an overlay, never a 2+ voter."
            ),
            "mask": live & soccer & is_ml & no_cannae,
            "filters": {
                "minTraders": 2,
                "minGrade": 0,
                "minQ": 0,
                "priceLo": 0.10,
                "priceHi": 0.88,
                "excludeUsernames": ["Cannae"],
                "skipSports": ["NFL"],
                "sportIncludes": ["Soccer", "SOCCER", "UCL"],
                "marketTypes": ["Moneyline", "Moneyline / Match"],
            },
        },
        {
            "id": "core_consensus",
            "name": "Any 2+ (no Cannae, no NFL) — comparison",
            "recommended": False,
            "priority": 90,
            "rule": "Do not take unfiltered. Shown so you can see Ghost is doing the work.",
            "description": "Unfiltered 2+ live. Positive only because Ghost moneylines sit inside it.",
            "mask": live & no_cannae & no_nfl,
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
            "id": "q50_no_ghost",
            "name": "Q50 moneyline without Ghost — skip",
            "recommended": False,
            "priority": 91,
            "rule": "Do not take. This is the control that proves the Q50 book is Ghost.",
            "description": "Same 2+ Q50 moneyline filter with GoalLineGhost removed. Negative.",
            "mask": live & is_ml & (df["min_q"] >= 50) & ~has("GoalLineGhost"),
            "filters": {
                "minTraders": 2,
                "minGrade": 0,
                "minQ": 50,
                "priceLo": 0.10,
                "priceHi": 0.88,
                "excludeUsernames": ["Cannae", "GoalLineGhost"],
                "skipSports": ["NFL"],
                "marketTypes": ["Moneyline", "Moneyline / Match"],
            },
        },
    ]

    strategies = []
    print(f"{'id':<22} {'n':>5} {'WR':>6} {'VWAP':>8} {'+2c':>8}")
    for spec in specs:
        mask = spec.pop("mask")
        sub = df.loc[mask]
        rec = card(sub, **{k: v for k, v in spec.items() if k != "mask"})
        st = rec["join_max_plus_2c"]
        vw = rec["vwap"]
        print(f"{spec['id']:<22} {st.get('n', 0):>5} {st.get('win_rate', 0):>5.1f}% {vw.get('roi', 0):>7.1f}% {st.get('roi', 0):>7.1f}%")
        strategies.append(rec)

    existing = {}
    if OUT.exists():
        try:
            existing = json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            existing = {}
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "as_of": datetime.now(timezone.utc).date().isoformat(),
        "fill": "join_max+2c",
        "stake": STAKE,
        "method": (
            "Hold-to-resolution walk-forward. Fill = later voter (join_max) + 2¢. "
            "Dates from endDate or slug/title. Recommended books require GoalLineGhost on moneylines, "
            "or 60–80¢ favorites, or soccer ML without Cannae."
        ),
        "copy_all": existing.get("copy_all") or {
            "n": 214024, "win_rate": 53.24, "implied_wr": 50.8, "edge": 2.5, "roi": -1.52,
        },
        "strategies": strategies,
        "universe": existing.get("universe") or {
            "max_resolved_date": str(df["end_dt"].max())[:10],
        },
    }
    if "max_resolved_date" not in payload["universe"]:
        payload["universe"]["max_resolved_date"] = str(df["end_dt"].max())[:10]
    OUT.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    MD.write_text(write_markdown(payload), encoding="utf-8")
    print(f"Wrote {OUT}")
    print(f"Wrote {MD}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
