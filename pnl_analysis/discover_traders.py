#!/usr/bin/env python3
"""
Scan Polymarket sports leaderboards for wallets we do not already track.

Writes:
  pnl_analysis/output/discovered_candidates.json
  pnl_analysis/extra_traders.json  (vetted new wallets, when --write-extra)

Usage:
  python3 pnl_analysis/discover_traders.py
  python3 pnl_analysis/discover_traders.py --max-new 12 --min-pnl 25000 --write-extra
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_full_pipeline import ALL_TRADERS, OUTPUT_DIR, csv_path_for  # noqa: E402

DATA_API = "https://data-api.polymarket.com"
ELITE_TS = Path(__file__).resolve().parents[1] / "server" / "eliteAnalysis.ts"
EXTRA_PATH = Path(__file__).resolve().parent / "extra_traders.json"
PAGE_LIMIT = 50
MAX_PAGES = 6  # API hard-caps ~50 per page
SLEEP_SEC = 0.35


def load_known_wallets() -> dict[str, str]:
    """wallet -> username from pipeline roster + eliteAnalysis.ts lists."""
    known: dict[str, str] = {}
    for wallet, username in ALL_TRADERS:
        known[wallet.lower()] = username
    if EXTRA_PATH.exists():
        try:
            extra = json.loads(EXTRA_PATH.read_text(encoding="utf-8"))
            if isinstance(extra, list):
                for row in extra:
                    w = str((row or {}).get("wallet") or "").strip().lower()
                    u = str((row or {}).get("username") or "").strip()
                    if w:
                        known[w] = u or known.get(w, w[:10])
        except Exception as e:
            print(f"[warn] extra_traders.json: {e}")
    if ELITE_TS.exists():
        text = ELITE_TS.read_text(encoding="utf-8")
        for m in re.finditer(
            r'wallet:\s*"(0x[a-fA-F0-9]+)"\s*,\s*username:\s*"([^"]+)"',
            text,
        ):
            known[m.group(1).lower()] = m.group(2)
    return known


def fetch_leaderboard(window: str, category: str) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for page in range(MAX_PAGES):
        params = {
            "window": window.lower(),
            "limit": PAGE_LIMIT,
            "offset": page * PAGE_LIMIT,
        }
        if category:
            params["category"] = category
        try:
            resp = requests.get(f"{DATA_API}/v1/leaderboard", params=params, timeout=45)
        except requests.RequestException as e:
            print(f"[warn] leaderboard {window}/{category} page {page}: {e}")
            break
        if resp.status_code != 200:
            print(f"[warn] leaderboard {window}/{category} HTTP {resp.status_code}")
            break
        try:
            data = resp.json()
        except Exception as e:
            print(f"[warn] leaderboard JSON: {e}")
            break
        if isinstance(data, dict):
            data = data.get("data") or data.get("leaderboard") or data.get("results") or []
        if not isinstance(data, list) or not data:
            break
        added = 0
        for row in data:
            if not isinstance(row, dict):
                continue
            wallet = str(row.get("proxyWallet") or row.get("wallet") or "").strip().lower()
            if not wallet.startswith("0x") or wallet in seen:
                continue
            seen.add(wallet)
            out.append(
                {
                    "wallet": wallet,
                    "username": str(row.get("userName") or row.get("username") or wallet[:12]),
                    "pnl": float(row.get("pnl") or 0),
                    "vol": float(row.get("vol") or row.get("volume") or 0),
                    "rank": int(str(row.get("rank") or 0) or 0),
                    "window": window.lower(),
                    "category": category or "all",
                }
            )
            added += 1
        time.sleep(SLEEP_SEC)
        if added == 0 or len(data) < PAGE_LIMIT:
            break
    return out


def merge_windows(rows: list[dict]) -> list[dict]:
    by_wallet: dict[str, dict] = {}
    for row in rows:
        w = row["wallet"]
        cur = by_wallet.get(w)
        if cur is None:
            by_wallet[w] = {
                **row,
                "windows": {row["window"]},
                "best_rank": row["rank"] or 999,
                "best_pnl": row["pnl"],
            }
            continue
        cur["windows"].add(row["window"])
        if row["pnl"] > cur["best_pnl"]:
            cur["best_pnl"] = row["pnl"]
            cur["pnl"] = row["pnl"]
            cur["vol"] = row["vol"]
        if row["rank"] and row["rank"] < cur["best_rank"]:
            cur["best_rank"] = row["rank"]
            cur["username"] = row["username"]
    merged = list(by_wallet.values())
    for m in merged:
        m["windows"] = sorted(m["windows"])
        m["recency"] = ("week" in m["windows"]) + ("month" in m["windows"])
    merged.sort(key=lambda r: (-r["recency"], -r["best_pnl"]))
    return merged


def sample_closed_pnl(wallet: str, pages: int = 4) -> dict:
    """Quick screen: a few closed-position pages. Not a full grade."""
    pnl = 0.0
    cost = 0.0
    n = 0
    for page in range(pages):
        try:
            resp = requests.get(
                f"{DATA_API}/closed-positions",
                params={"user": wallet, "limit": 50, "offset": page * 50},
                timeout=45,
            )
        except requests.RequestException:
            break
        if resp.status_code != 200:
            break
        try:
            data = resp.json()
        except Exception:
            break
        if not isinstance(data, list) or not data:
            break
        for row in data:
            if not isinstance(row, dict):
                continue
            try:
                rpnl = float(row.get("realizedPnl") or 0)
                bought = float(row.get("totalBought") or 0)
                avg = float(row.get("avgPrice") or 0)
            except (TypeError, ValueError):
                continue
            pnl += rpnl
            cost += bought * avg
            n += 1
        time.sleep(SLEEP_SEC)
        if len(data) < 50:
            break
    roi = (pnl / cost * 100) if cost > 0 else 0.0
    return {
        "sample_closed_rows": n,
        "sample_pnl": round(pnl, 2),
        "sample_cost": round(cost, 2),
        "sample_roi": round(roi, 2),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Discover new Polymarket sports traders")
    parser.add_argument("--max-new", type=int, default=12, help="Max new wallets to recommend")
    parser.add_argument("--min-pnl", type=float, default=20_000, help="Min leaderboard PnL (USD)")
    parser.add_argument("--min-vol", type=float, default=50_000, help="Min leaderboard volume (USD)")
    parser.add_argument("--sample-pages", type=int, default=4, help="Closed-position pages for screening")
    parser.add_argument("--write-extra", action="store_true", help="Write pnl_analysis/extra_traders.json")
    args = parser.parse_args()

    known = load_known_wallets()
    print(f"Known tracked wallets: {len(known)}")

    raw: list[dict] = []
    for window in ("all", "month", "week"):
        print(f"Fetching sports leaderboard window={window}…")
        chunk = fetch_leaderboard(window, "sports")
        print(f"  {len(chunk)} unique on this window")
        raw.extend(chunk)

    merged = merge_windows(raw)
    new_rows = [
        r
        for r in merged
        if r["wallet"] not in known and r["best_pnl"] >= args.min_pnl and r["vol"] >= args.min_vol
    ]
    already = [r for r in merged if r["wallet"] in known]

    print(f"\nLeaderboard unique wallets: {len(merged)}")
    print(f"Already tracked on LB: {len(already)}")
    print(f"New passing PnL/vol gates: {len(new_rows)}")

    scored: list[dict] = []
    for i, row in enumerate(new_rows[: max(args.max_new, 1)], 1):
        print(f"[{i}/{min(len(new_rows), args.max_new)}] sampling {row['username']} {row['wallet'][:10]}…")
        sample = sample_closed_pnl(row["wallet"], pages=max(1, args.sample_pages))
        entry = {**row, **sample}
        # Prefer directional-looking sports grinders: recent windows + sample ROI not insane MM-like.
        recency_pts = 20 * entry["recency"]
        pnl_pts = min(40.0, max(0.0, entry["best_pnl"] / 25_000))
        roi_pts = min(30.0, max(0.0, entry["sample_roi"]))
        # Very high sample ROI with tiny n is noisy; require some depth.
        if entry["sample_closed_rows"] < 15:
            roi_pts *= 0.4
        entry["screen_score"] = round(recency_pts + pnl_pts + roi_pts, 1)
        scored.append(entry)

    scored.sort(key=lambda r: (-r["screen_score"], -r["best_pnl"]))

    recommended = [
        r
        for r in scored
        if r["sample_closed_rows"] >= 8 and r["sample_roi"] >= 2.0 and r["screen_score"] >= 25
    ][: args.max_new]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "known_wallets": len(known),
        "leaderboard_unique": len(merged),
        "already_tracked_on_lb": [
            {"wallet": r["wallet"], "username": known.get(r["wallet"], r["username"]), "windows": r["windows"], "pnl": r["best_pnl"]}
            for r in already[:40]
        ],
        "new_candidates": scored,
        "recommended": recommended,
    }
    OUTPUT_DIR.mkdir(exist_ok=True)
    out_path = OUTPUT_DIR / "discovered_candidates.json"
    out_path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    print(f"\nWrote {out_path}")

    print("\nRecommended new traders:")
    if not recommended:
        print("  (none met sample ROI / depth gates)")
    for r in recommended:
        print(
            f"  {r['username']:<28} Qscreen={r['screen_score']:>5}  "
            f"LB PnL=${r['best_pnl']:>10,.0f}  sample ROI={r['sample_roi']:>6.1f}%  "
            f"windows={','.join(r['windows'])}"
        )

    if args.write_extra:
        existing: list[dict] = []
        if EXTRA_PATH.exists():
            try:
                existing = json.loads(EXTRA_PATH.read_text(encoding="utf-8"))
                if not isinstance(existing, list):
                    existing = []
            except Exception:
                existing = []
        have = {str(r.get("wallet") or "").lower() for r in existing}
        added = 0
        for r in recommended:
            if r["wallet"] in have:
                continue
            existing.append(
                {
                    "wallet": r["wallet"],
                    "username": r["username"],
                    "source": "sports_leaderboard",
                    "notes": (
                        f"screen={r['screen_score']} pnl={r['best_pnl']:.0f} "
                        f"sample_roi={r['sample_roi']:.1f}% windows={','.join(r['windows'])}"
                    ),
                }
            )
            have.add(r["wallet"])
            added += 1
        EXTRA_PATH.write_text(json.dumps(existing, indent=2), encoding="utf-8")
        print(f"Wrote {EXTRA_PATH} (+{added} new, {len(existing)} total)")

    missing_csv = []
    for w, u in ALL_TRADERS:
        if not csv_path_for(w, u).exists():
            missing_csv.append(u)
    if missing_csv:
        print(f"\nCurated traders still missing CSV (need full fetch): {', '.join(missing_csv)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
