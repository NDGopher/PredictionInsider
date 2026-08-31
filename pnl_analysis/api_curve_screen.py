#!/usr/bin/env python3
"""API-first curve screen — no permanent mega-CSV required.

Pulls Polydata sports survivors (or a wallet list), streams a *bounded*
closed-positions sample from Polymarket data-api, scores equity/style in
memory, and only recommends full digest for scout-or-better books.

This is the forward path vs hoarding 30k-row local CSVs for every board name.

Usage:
  python pnl_analysis/api_curve_screen.py
  python pnl_analysis/api_curve_screen.py --wallets 0x27f7...,0xe40a...
  python pnl_analysis/api_curve_screen.py --fetch-scouts  # digest only passers
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from discover_polydata_boards import API as PD_API, PAGE  # noqa: E402
from position_utils import sport_family  # noqa: E402
from run_full_pipeline import OUTPUT_DIR, EXTRA_TRADERS_PATH  # noqa: E402

DATA_API = "https://data-api.polymarket.com"
OUT = OUTPUT_DIR / "api_curve_screen.json"
MAX_PAGES = 8  # 8×50 = 400 closed positions — enough to shape-score
PAGE_SIZE = 50


def get_closed(wallet: str, pages: int = MAX_PAGES) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for page in range(pages):
        try:
            r = requests.get(
                f"{DATA_API}/closed-positions",
                params={
                    "user": wallet,
                    "limit": PAGE_SIZE,
                    "offset": page * PAGE_SIZE,
                    "sortBy": "TIMESTAMP",
                    "sortDirection": "DESC",
                },
                timeout=30,
            )
            r.raise_for_status()
            batch = r.json()
        except Exception as exc:
            print(f"  [warn] {wallet[:10]} page {page}: {exc}")
            break
        if not isinstance(batch, list) or not batch:
            break
        for row in batch:
            cid = str(row.get("conditionId") or row.get("condition_id") or "")
            if not cid or cid in seen:
                continue
            seen.add(cid)
            rows.append(row)
        if len(batch) < PAGE_SIZE:
            break
        time.sleep(0.2)
    return rows


def score_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if len(rows) < 15:
        return {"ok": False, "reason": f"thin_n={len(rows)}"}
    pnls, costs, sports, ends = [], [], {}, []
    wins = 0
    sports_n = 0
    for row in rows:
        # realized PnL + size heuristics from data-api closed positions
        pnl = float(row.get("realizedPnl") or row.get("cashPnl") or 0)
        # cost basis approx
        avg = float(row.get("avgPrice") or row.get("avg_price") or 0)
        size = float(row.get("totalBought") or row.get("size") or row.get("amount") or 0)
        cost = avg * size if avg and size else abs(float(row.get("initialValue") or 0)) or 1.0
        title = str(row.get("title") or row.get("slug") or "")
        # sport guess from title keywords is weak — use outcome/sportsMarketType if present
        sport = str(row.get("sport") or row.get("sportsMarketType") or "OTHER")
        fam = sport_family(sport) if sport != "OTHER" else "OTHER"
        # crude sports detect from title
        t_up = title.upper()
        if any(k in t_up for k in ("NBA", "NFL", "MLB", "NHL", "ATP", "WTA", "SOCCER", "EPL", "UCL", "TENNIS", "VS.")):
            if fam == "OTHER":
                fam = "SPORTS"
        pnls.append(pnl)
        costs.append(cost)
        if pnl > 0:
            wins += 1
        if fam not in {"OTHER", "POLITICS", "CRYPTO", "FINANCE"} or fam == "SPORTS":
            sports_n += 1
        lane = sports.setdefault(sport or fam, {"n": 0, "pnl": 0.0, "cost": 0.0})
        lane["n"] += 1
        lane["pnl"] += pnl
        lane["cost"] += cost
        ts = row.get("endDate") or row.get("timestamp") or row.get("closedAt")
        ends.append(ts)

    invested = sum(costs) or 1.0
    roi = 100.0 * sum(pnls) / invested
    cum = np.cumsum(pnls)
    x = np.arange(len(cum), dtype=float)
    coef = np.polyfit(x, cum, 1)
    pred = coef[0] * x + coef[1]
    ss_res = float(((cum - pred) ** 2).sum())
    ss_tot = float(((cum - cum.mean()) ** 2).sum()) or 1.0
    r2 = max(0.0, min(1.0, 1.0 - ss_res / ss_tot))
    up = float((np.array(pnls) > 0).mean() * 100)
    med = float(np.median([c for c in costs if c >= 50] or costs))
    sports_frac = sports_n / len(rows)
    # politics/bot heuristic
    pol_n = sports.get("POLITICS", {}).get("n", 0) + sports.get("politics", {}).get("n", 0)
    other_n = sports.get("OTHER", {}).get("n", 0)
    bot_risk = (pol_n + other_n) / len(rows) > 0.75 and float(np.mean([1 if p > 0 else 0 for p in pnls])) < 0.40

    top = []
    for k, lane in sports.items():
        if lane["n"] < 5:
            continue
        top.append({"key": k, "n": lane["n"], "roi": round(100 * lane["pnl"] / (lane["cost"] or 1), 1)})
    top.sort(key=lambda x: -x["n"])

    curve = min(100.0, max(0.0, (25 if roi >= 5 else 10 if roi >= 0 else 0) + r2 * 40 + (15 if up >= 55 else 5)))
    scout = (
        not bot_risk
        and len(rows) >= 25
        and roi >= 3.0
        and sports_frac >= 0.45
        and med < 15_000
        and curve >= 45
        and r2 >= 0.25
    )
    return {
        "ok": True,
        "n": len(rows),
        "unique_roi_est": round(roi, 2),
        "r2": round(r2, 3),
        "up_pct": round(up, 1),
        "wr": round(100.0 * wins / len(rows), 1),
        "median_est": round(med, 2),
        "sports_frac_est": round(sports_frac, 2),
        "curve_est": round(curve, 1),
        "bot_risk": bot_risk,
        "scout_candidate": scout,
        "top_sports": top[:5],
    }


def board_wallets(limit: int = 40) -> list[tuple[str, str]]:
    path = OUTPUT_DIR / "polydata_boards.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = [r for r in (data.get("sports_survivors") or []) if r.get("window") in {"month", "week"}]
    rows.sort(key=lambda r: -float(r.get("pnl_vol") or 0))
    out = []
    seen = set()
    for r in rows:
        w = str(r.get("wallet") or "").lower()
        u = str(r.get("username") or "")
        if not w.startswith("0x") or w in seen:
            continue
        seen.add(w)
        out.append((u, w))
        if len(out) >= limit:
            break
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wallets", default="", help="comma wallets or user:wallet")
    ap.add_argument("--limit", type=int, default=30)
    args = ap.parse_args()

    pairs: list[tuple[str, str]] = []
    if args.wallets:
        for part in args.wallets.split(","):
            part = part.strip()
            if ":" in part:
                u, w = part.split(":", 1)
                pairs.append((u, w.lower()))
            else:
                pairs.append((part[:10], part.lower()))
    else:
        pairs = board_wallets(args.limit)

    # Always include user-flagged set if present
    flagged = [
        ("ic4cream", "0x27f738fe203827445690339104aae35b20bc44b0"),
        ("Shori888", "0xa36fcb6947c4ac1f09ee894aa1fd0756b90e180b"),
        ("Mysaria", "0xe40aaa5ce1dac0b7dc24c9d0284f27e17c3fe4a2"),
        ("RegardedMoney", "0x5c3a1a602848565bb16165fcd460b00c3d43020b"),
    ]
    have = {w for _, w in pairs}
    for u, w in flagged:
        if w not in have:
            pairs.insert(0, (u, w))

    results = []
    print(f"API curve screen  n={len(pairs)}  pages≤{MAX_PAGES}")
    for u, w in pairs:
        print(f"  {u}…", flush=True)
        rows = get_closed(w)
        sc = score_rows(rows)
        results.append({"username": u, "wallet": w, **sc})
        flag = "SCOUT?" if sc.get("scout_candidate") else ("BOT?" if sc.get("bot_risk") else "—")
        print(
            f"    {flag} n={sc.get('n')} roi≈{sc.get('unique_roi_est')}% "
            f"curve≈{sc.get('curve_est')} r2={sc.get('r2')} med≈{sc.get('median_est')}"
        )

    scouts = [r for r in results if r.get("scout_candidate")]
    bots = [r for r in results if r.get("bot_risk")]
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": (
            "Bounded data-api closed-positions sample (recent TIMESTAMP DESC). "
            "In-memory curve/style score. Full CSV digest only for scout_candidate=true. "
            "Avoids hoarding mega MM/bot tapes locally."
        ),
        "counts": {"screened": len(results), "scout_candidates": len(scouts), "bot_risk": len(bots)},
        "scout_candidates": scouts,
        "bot_risk": bots,
        "all": results,
    }
    OUT.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    print(f"\nWrote {OUT}  scouts={len(scouts)} bot_risk={len(bots)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
