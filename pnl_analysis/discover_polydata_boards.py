#!/usr/bin/env python3
"""Pull Polydata.org leaderboards (the UI at polydata.org/leaderboard).

PnL/volume is the first filter: month sports grinders print huge PnL on
$50M–$100M volume (~1% ROI). Copyables print on a few million volume.

Writes: pnl_analysis/output/polydata_boards.json

Usage:
  python pnl_analysis/discover_polydata_boards.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from copy_roster import HARD_SKIP_USERNAMES, HARD_SKIP_WALLETS, load_extra_status  # noqa: E402
from run_full_pipeline import EXTRA_TRADERS_PATH, OUTPUT_DIR, roster_traders  # noqa: E402

API = "https://www.polydata.org/api/leaderboard"
OUT = OUTPUT_DIR / "polydata_boards.json"
PAGE = 25
MAX_OFFSET = 150  # 7 pages → ~175 per board (was 4×25=100)
MIN_VOL = 250_000.0  # was 400k — catch earlier specialists
MIN_PNL = 40_000.0   # was 80k
MIN_PNL_VOL = 0.05  # 5% — below this is usually a bonder/grinder/MM
MAX_AUTO_WATCH = 50  # was 12 — digestion bottleneck, not "no elites exist"


def fetch_board(time_period: str, category: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for offset in range(0, MAX_OFFSET + 1, PAGE):
        try:
            resp = requests.get(
                API,
                params={
                    "orderBy": "PNL",
                    "timePeriod": time_period,
                    "category": category,
                    "limit": PAGE,
                    "offset": offset,
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            print(f"[warn] {time_period}/{category} offset={offset}: {exc}")
            break
        if not isinstance(data, list) or not data:
            break
        for row in data:
            if not isinstance(row, dict):
                continue
            w = str(row.get("proxyWallet") or "").strip().lower()
            if not w.startswith("0x") or w in seen:
                continue
            seen.add(w)
            pnl = float(row.get("pnl") or 0)
            vol = float(row.get("vol") or 0)
            name = str(row.get("userName") or w[:12])
            if "-" in name and name.split("-")[0].startswith("0x"):
                name = name.split("-")[0]
            rows.append(
                {
                    "wallet": w,
                    "username": name,
                    "rank": int(str(row.get("rank") or 0) or 0),
                    "pnl": pnl,
                    "vol": vol,
                    "pnl_vol": round(pnl / vol, 4) if vol > 0 else 0.0,
                    "window": time_period.lower(),
                    "category": category.lower(),
                }
            )
        if len(data) < PAGE:
            break
    return rows


def screen_row(
    row: dict[str, Any],
    known: dict[str, str],
    extra: dict[str, str],
    *,
    min_vol: float,
    min_pnl: float,
) -> dict[str, Any]:
    w = row["wallet"]
    u = row["username"]
    reasons: list[str] = []
    if u in HARD_SKIP_USERNAMES or w in HARD_SKIP_WALLETS:
        reasons.append("hard_skip_mega")
    if extra.get(w) in {"kicked", "kick", "grinder"}:
        reasons.append("already_kicked")
    if row["vol"] < min_vol:
        reasons.append("thin_volume")
    if row["pnl"] < min_pnl:
        reasons.append("thin_pnl")
    if row["pnl_vol"] < MIN_PNL_VOL:
        reasons.append(f"pnl/vol={row['pnl_vol']:.1%}_grinder")
    return {
        **row,
        "on_roster": w in known,
        "roster_username": known.get(w),
        "reasons": reasons,
    }


def upsert_watch(survivors: list[dict[str, Any]], known: dict[str, str]) -> int:
    """Add new month-sports survivors as watch. Never overwrite kicked/take_book."""
    existing: list[dict[str, Any]] = []
    if EXTRA_TRADERS_PATH.exists():
        try:
            data = json.loads(EXTRA_TRADERS_PATH.read_text(encoding="utf-8"))
            if isinstance(data, list):
                existing = [r for r in data if isinstance(r, dict)]
        except Exception as exc:
            print(f"[warn] extra_traders.json: {exc}")
            return 0
    by_w = {str(r.get("wallet") or "").lower(): r for r in existing if r.get("wallet")}
    added = 0
    new_rows: list[dict[str, Any]] = []
    eligible = [
        row for row in survivors
        if row.get("window") in {"month", "week"}
        and row.get("category") == "sports"
        and not row.get("on_roster")
        and str(row.get("wallet") or "").lower() not in known
        and str(row.get("wallet") or "").lower() not in by_w
    ]
    # Prefer month sports (more stable) then week; rank by pnl_vol then pnl
    eligible.sort(
        key=lambda r: (
            0 if r.get("window") == "month" else 1,
            -float(r.get("pnl_vol") or 0),
            -float(r.get("pnl") or 0),
        )
    )
    for row in eligible[:MAX_AUTO_WATCH]:
        w = str(row.get("wallet") or "").lower()
        u = str(row.get("username") or "").strip()
        if not w.startswith("0x") or not u:
            continue
        rec = {
            "wallet": w,
            "username": u,
            "source": f"polydata_{row.get('window', 'month')}_{row.get('category', 'sports')}",
            "status": "watch",
            "notes": (
                f"Auto from Polydata {row.get('window')} {row.get('category')} "
                f"#{row.get('rank')} PnL/vol={row.get('pnl_vol', 0):.1%}. "
                "Unique book + take-rule required before live."
            ),
        }
        by_w[w] = rec
        new_rows.append(rec)
        added += 1
        print(f"  [watch+] {u} ({w[:10]}…) PnL/vol={row.get('pnl_vol', 0):.1%}")
    if added:
        EXTRA_TRADERS_PATH.write_text(
            json.dumps(existing + new_rows, indent=2) + "\n",
            encoding="utf-8",
        )
    return added


def main() -> int:
    known = {w.lower(): u for w, u in roster_traders()}
    extra = load_extra_status()
    boards: dict[str, list[dict[str, Any]]] = {}
    for period in ("WEEK", "MONTH", "ALL"):
        for cat in ("SPORTS", "OVERALL"):
            key = f"{period.lower()}_{cat.lower()}"
            print(f"Fetching Polydata {key}…")
            boards[key] = fetch_board(period, cat)
            print(f"  {len(boards[key])} wallets")

    survivors: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    seen_surv: set[str] = set()
    # Week volume is smaller. ALL-time is scored for the report but never auto-watched
    # (crypto/politics whales print 40%+ PnL/vol on that board).
    windows = (
        ("week_sports", MIN_VOL * 0.35, MIN_PNL * 0.35),
        ("month_sports", MIN_VOL, MIN_PNL),
        ("all_sports", MIN_VOL, MIN_PNL * 2.0),
    )
    for key, min_vol, min_pnl in windows:
        for row in boards.get(key) or []:
            entry = screen_row(row, known, extra, min_vol=min_vol, min_pnl=min_pnl)
            if entry["reasons"]:
                skipped.append(entry)
                continue
            w = entry["wallet"]
            if w in seen_surv:
                continue
            seen_surv.add(w)
            survivors.append(entry)

    added = upsert_watch(survivors, known)
    month_surv = [r for r in survivors if r.get("window") == "month"]
    month_skip = [r for r in skipped if r.get("window") == "month" and r.get("category") == "sports"]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": API,
        "method": (
            "Polydata.org leaderboard API (same as the public week/month/all UI). "
            "Sports boards: keep PnL/vol >= 5%. Sub-5% is usually a favorite/bond "
            "grinder (ferrari, HomeRunHazard, RN1, swisstony). "
            "Up to 50 new week/month-sports survivors are appended to extra_traders.json as watch — "
            "never auto-live. ALL-time is report-only. Digestion (CSV fetch) is the bottleneck "
            "for finding HVAB-class tails — raise fetch --limit in refresh_product accordingly."
        ),
        "gates": {
            "min_vol": MIN_VOL,
            "min_pnl": MIN_PNL,
            "min_pnl_vol": MIN_PNL_VOL,
            "max_auto_watch": MAX_AUTO_WATCH,
        },
        "counts": {k: len(v) for k, v in boards.items()},
        "watch_added": added,
        "sports_survivors": survivors,
        "sports_month_survivors": month_surv,
        "sports_month_skipped": month_skip,
        "sports_skipped": skipped,
        "boards": boards,
    }
    OUT.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    print(f"\nWrote {OUT}  watch+={added}")
    print("Sports SURVIVORS (copy-screen these):")
    for r in survivors:
        flag = "ROSTER" if r["on_roster"] else "NEW"
        print(
            f"  {flag:<6} {r.get('window'):<6} #{r['rank']:<3} {r['username']:<28} "
            f"PnL=${r['pnl']:>10,.0f}  vol=${r['vol']:>12,.0f}  "
            f"PnL/vol={r['pnl_vol']:.1%}"
        )
    print("\nSports SKIPPED grinders (first 8):")
    for r in month_skip[:8]:
        print(f"  #{r['rank']:<3} {r['username']:<28} {r['reasons']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
