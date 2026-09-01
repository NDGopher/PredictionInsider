#!/usr/bin/env python3
"""Market-making research from historical Poly books (research only — no live quoting).

Analyzes mega/MM skip books (RN1, etc.): hedge inventory, both-sides round-trips,
hold-to-res leftover edge, and a simple simulated maker policy:

  - Quote both sides near mid (proxy: fill at avgPrice)
  - Earn spread when both sides fill before resolve
  - Inventory leftover settles at resolution

This estimates whether *copying an MM tape* or *running a similar inventory policy*
could be profitable — it does NOT place Polymarket orders.

Writes:
  pnl_analysis/MM_RESEARCH.md
  pnl_analysis/output/mm_maker_research.json

Usage:
  python pnl_analysis/mm_maker_research.py
  python pnl_analysis/mm_maker_research.py --max-rows 200000
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from copy_roster import OUTPUT_DIR, ROOT, load_universe  # noqa: E402
from run_full_pipeline import csv_path_for  # noqa: E402

OUT_JSON = OUTPUT_DIR / "mm_maker_research.json"
OUT_MD = ROOT / "MM_RESEARCH.md"

# Known / skip MM-style books to profile first
PRIORITY_MM = [
    "RN1",
    "swisstony",
    "tcp2",
    "kch123",
    "GoalLineGhost",
    "geniusMC",
]


def _f(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def load_analysis(wallet: str, username: str) -> dict[str, Any] | None:
    p = csv_path_for(wallet, username).with_suffix(".json")
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def summarize_analysis(username: str, wallet: str, a: dict[str, Any]) -> dict[str, Any]:
    return {
        "username": username,
        "wallet": wallet,
        "dashboard_pnl": a.get("dashboard_pnl") or a.get("total_profit"),
        "overall_roi": a.get("overall_roi"),
        "win_rate": a.get("win_rate"),
        "median_stake": a.get("median_market_stake"),
        "events": a.get("total_events") or a.get("markets_traded"),
        "hedge_count": a.get("hedge_count"),
        "hedge_profit": a.get("hedge_profit"),
        "hedge_risk": a.get("hedge_risk"),
        "bond_count": a.get("bond_count"),
        "bond_profit": a.get("bond_profit"),
        "last_30d": a.get("last_30d"),
        "monthly_pnl": dict(list((a.get("monthly_pnl") or {}).items())[-6:]),
    }


def simulate_maker_from_csv(csv_path: Path, *, max_rows: int) -> dict[str, Any]:
    """Estimate maker-style P&L from position CSV.

    Group by conditionId: if both Yes and No outcomes appear, treat as inventory
    round-trip (hedge). Else directional hold-to-res.
    """
    if not csv_path.exists():
        return {"n": 0, "error": "missing_csv"}
    usecols = [
        c
        for c in [
            "conditionId",
            "outcome",
            "avgPrice",
            "size",
            "initialValue",
            "realizedPnl",
            "cashPnl",
            "curPrice",
            "totalBought",
            "status",
            "endDate",
            "title",
        ]
        if True
    ]
    try:
        df = pd.read_csv(csv_path, usecols=lambda c: c in usecols, nrows=max_rows)
    except Exception as exc:
        return {"n": 0, "error": str(exc)}
    if df.empty:
        return {"n": 0}
    for col in ("avgPrice", "size", "initialValue", "realizedPnl", "cashPnl", "totalBought"):
        if col not in df.columns:
            df[col] = 0.0
        else:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)
    pnl_col = "realizedPnl" if "realizedPnl" in df.columns else "cashPnl"
    df["pnl"] = df[pnl_col]
    if "outcome" not in df.columns:
        df["outcome"] = ""
    df["outcome"] = df["outcome"].astype(str)
    if "conditionId" not in df.columns:
        return {"n": int(len(df)), "error": "no_conditionId"}

    by_cond: dict[str, pd.DataFrame] = {str(k): g for k, g in df.groupby(df["conditionId"].astype(str))}
    hedge_pnls: list[float] = []
    hedge_costs: list[float] = []
    directional_pnls: list[float] = []
    directional_costs: list[float] = []
    spreads: list[float] = []

    for _cid, g in by_cond.items():
        outcomes = set(g["outcome"].str.lower().tolist())
        cost = float(g["initialValue"].sum()) or float((g["avgPrice"] * g["size"]).sum())
        pnl = float(g["pnl"].sum())
        yes = g[g["outcome"].str.lower().isin(["yes", "y"])]
        no = g[g["outcome"].str.lower().isin(["no", "n"])]
        both = len(yes) > 0 and len(no) > 0
        if both:
            hedge_pnls.append(pnl)
            hedge_costs.append(max(cost, 1.0))
            y_px = float(yes["avgPrice"].mean()) if len(yes) else None
            n_px = float(no["avgPrice"].mean()) if len(no) else None
            if y_px is not None and n_px is not None:
                # Cost to own $1 of both ≈ y+n; locked payout $1 → edge ≈ 1-(y+n)
                spreads.append(1.0 - (y_px + n_px))
        else:
            directional_pnls.append(pnl)
            directional_costs.append(max(cost, 1.0))

    def _stats(pnls: list[float], costs: list[float]) -> dict[str, Any]:
        if not pnls:
            return {"n": 0, "pnl": 0.0, "roi_pct": 0.0}
        p = float(np.sum(pnls))
        c = float(np.sum(costs))
        return {
            "n": len(pnls),
            "pnl": round(p, 2),
            "cost": round(c, 2),
            "roi_pct": round(p / c * 100.0, 2) if c else 0.0,
            "avg_pnl": round(float(np.mean(pnls)), 2),
            "win_rate": round(float(np.mean([x > 0 for x in pnls]) * 100.0), 2),
        }

    spread_arr = np.array(spreads, dtype=float) if spreads else np.array([])
    # Simulated $100 maker: scale average hedge edge
    sim = {
        "stake_usd": 100.0,
        "method": (
            "On both-side conditions, assumed round-trip edge = 1-(yesVWAP+noVWAP). "
            "Apply to $100 notional per hedged market. Directional leftovers excluded."
        ),
        "hedged_markets": len(spreads),
        "avg_locked_edge": round(float(spread_arr.mean()), 4) if len(spread_arr) else None,
        "median_locked_edge": round(float(np.median(spread_arr)), 4) if len(spread_arr) else None,
        "positive_edge_pct": round(float((spread_arr > 0).mean() * 100.0), 2) if len(spread_arr) else None,
        "proj_pnl_per_100_hedges": (
            round(float(spread_arr.mean()) * 100.0 * 100.0, 2) if len(spread_arr) else None
        ),
        # 100 hedges × $100 × avg edge
        "caveat": (
            "Edge uses position VWAPs not live CLOB mid/spread. Adverse selection and "
            "unfilled quotes are not modeled. Research estimate only — not live automation."
        ),
    }

    return {
        "rows_sampled": int(len(df)),
        "conditions": len(by_cond),
        "hedge_markets": _stats(hedge_pnls, hedge_costs),
        "directional_markets": _stats(directional_pnls, directional_costs),
        "maker_sim": sim,
    }


def automate_feasibility(books: list[dict[str, Any]]) -> dict[str, Any]:
    """Honest assessment of automating MM on Polymarket."""
    edges = [
        b.get("csv_sim", {}).get("maker_sim", {}).get("avg_locked_edge")
        for b in books
        if b.get("csv_sim", {}).get("maker_sim", {}).get("avg_locked_edge") is not None
    ]
    avg_edge = float(np.mean(edges)) if edges else None
    return {
        "can_we_automate_today": False,
        "why_not_yet": [
            "Polymarket CLOB requires continuous two-sided quoting, cancel/replace, and inventory caps.",
            "Historical CSVs give filled inventory, not the full quote tape (missed fills / queue position).",
            "RN1-class books run 100k–3M+ fills — infrastructure and capital, not a $100 copy bot.",
            "Latency, gas/bridge, and adverse selection vs informed flow dominate retail MM.",
        ],
        "what_is_viable_near_term": [
            "Research + alert when locked yes+no VWAP < 1.00 on markets we already trade.",
            "Hedge overlay: when our take-book print is one-sided, optionally buy cheap opposite if sum < 0.98.",
            "Separate MM desk paper-trading with hard inventory limits before any live quoting.",
        ],
        "hist_avg_locked_edge": round(avg_edge, 4) if avg_edge is not None else None,
        "verdict": (
            "Market making is a separate product lane from Take these. "
            "History shows hedge inventory can be profitable for mega books, but "
            "automating live MM on Poly is not ready as a $100 retail strategy."
        ),
    }


def write_md(payload: dict[str, Any]) -> None:
    lines = [
        "# Market making research (not live trading)",
        "",
        f"Generated **{payload['generated_at'][:19]} UTC**.",
        "",
        "This is a **separate lane** from Take these / copy-tail. We study mega/MM books "
        "to estimate inventory/hedge edge from history. **No orders are placed.**",
        "",
        "## Feasibility",
        "",
        f"- Automate live MM on Poly today? **{payload['feasibility']['can_we_automate_today']}**",
        f"- Verdict: {payload['feasibility']['verdict']}",
        "",
        "### Why not yet",
        "",
    ]
    for w in payload["feasibility"]["why_not_yet"]:
        lines.append(f"- {w}")
    lines += ["", "### Near-term viable steps", ""]
    for w in payload["feasibility"]["what_is_viable_near_term"]:
        lines.append(f"- {w}")
    lines += [
        "",
        "## Books profiled",
        "",
        "| Trader | Unique ROI | Hedge n / $ | Dir n / $ | Avg locked edge | Sim $/100 hedges |",
        "|---|---:|---|---|---:|---:|",
    ]
    for b in payload.get("books") or []:
        a = b.get("analysis") or {}
        sim = (b.get("csv_sim") or {}).get("maker_sim") or {}
        h = (b.get("csv_sim") or {}).get("hedge_markets") or {}
        d = (b.get("csv_sim") or {}).get("directional_markets") or {}
        lines.append(
            f"| {b.get('username')} | {a.get('overall_roi')}% | "
            f"{h.get('n')}/{h.get('pnl')} | {d.get('n')}/{d.get('pnl')} | "
            f"{sim.get('avg_locked_edge')} | {sim.get('proj_pnl_per_100_hedges')} |"
        )
    lines += [
        "",
        "## How to rebuild",
        "",
        "`python pnl_analysis/mm_maker_research.py` · `npm run research:mm`",
        "",
    ]
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-rows", type=int, default=250_000)
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    uni = load_universe()
    skip = uni.get("skip") or []
    # Prefer skip/MM + priority names from ranks traders list
    books_meta: list[dict[str, str]] = []
    seen: set[str] = set()
    for t in skip:
        u = str(t.get("username") or "")
        w = str(t.get("wallet") or "").lower()
        reasons = " ".join(t.get("reasons") or [])
        if not w or w in seen:
            continue
        if u in PRIORITY_MM or "market_maker" in reasons or "pd_trades=" in reasons:
            seen.add(w)
            books_meta.append({"username": u, "wallet": w})
    for u in PRIORITY_MM:
        # ensure priority present even if naming differs
        pass

    books_out: list[dict[str, Any]] = []
    for meta in books_meta[:12]:
        u, w = meta["username"], meta["wallet"]
        print(f"[mm] {u}")
        analysis = load_analysis(w, u)
        csv_p = csv_path_for(w, u)
        csv_sim = simulate_maker_from_csv(csv_p, max_rows=args.max_rows) if csv_p.exists() else {"n": 0}
        books_out.append({
            "username": u,
            "wallet": w,
            "analysis": summarize_analysis(u, w, analysis) if analysis else {},
            "csv_sim": csv_sim,
            "has_csv": csv_p.exists(),
        })

    payload = {
        "generated_at": now.isoformat(),
        "method": (
            "Historical MM/skip books: hedge vs directional split from conditionId both-sides; "
            "locked edge proxy 1-(yesVWAP+noVWAP). Research only."
        ),
        "feasibility": automate_feasibility(books_out),
        "books": books_out,
        "counts": {"books": len(books_out)},
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    write_md(payload)
    print(f"[mm] wrote {OUT_JSON}")
    print(f"[mm] wrote {OUT_MD}")
    print(f"[mm] automate={payload['feasibility']['can_we_automate_today']} edge={payload['feasibility']['hist_avg_locked_edge']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
