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


def _fetch_pages(endpoint: str, wallet: str, pages: int, limit: int) -> list[dict]:
    rows: list[dict] = []
    for page in range(pages):
        try:
            resp = requests.get(
                f"{DATA_API}/{endpoint}",
                params={"user": wallet, "limit": limit, "offset": page * limit},
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
        rows.extend([r for r in data if isinstance(r, dict)])
        time.sleep(SLEEP_SEC)
        if len(data) < limit:
            break
    return rows


def _row_cost(row: dict) -> float:
    try:
        bought = float(row.get("totalBought") or 0)
        avg = float(row.get("avgPrice") or 0)
        initial = float(row.get("initialValue") or 0)
    except (TypeError, ValueError):
        return 0.0
    cost = bought * avg
    return cost if cost > 0 else initial


def _is_resolved(row: dict) -> bool:
    try:
        cur = float(row.get("curPrice") or 0)
    except (TypeError, ValueError):
        cur = 0.0
    redeem = str(row.get("redeemable") or "").strip().lower() in ("true", "1", "yes")
    return cur >= 0.99 or cur <= 0.01 or redeem


def sample_closed_pnl(wallet: str, pages: int = 4) -> dict:
    """Quick screen: a few closed-position pages. Not a full grade."""
    closed = _fetch_pages("closed-positions", wallet, pages, 50)
    pnl = 0.0
    cost = 0.0
    n = 0
    for row in closed:
        try:
            rpnl = float(row.get("realizedPnl") or 0)
        except (TypeError, ValueError):
            rpnl = 0.0
        c = _row_cost(row)
        pnl += rpnl
        cost += c
        n += 1
    roi = (pnl / cost * 100) if cost > 0 else 0.0
    return {
        "sample_closed_rows": n,
        "sample_pnl": round(pnl, 2),
        "sample_cost": round(cost, 2),
        "sample_roi": round(roi, 2),
    }


def sample_honest_book(wallet: str, closed_pages: int = 4, open_pages: int = 3) -> dict:
    """Closed pages plus price-resolved open rows so winners-only samples cannot fake a KEEP.

    Still a screen, not a full unique open-book grade. Full-open is required before tailing.
    """
    closed = _fetch_pages("closed-positions", wallet, closed_pages, 50)
    opened = _fetch_pages("positions", wallet, open_pages, 100)
    dash_pnl = 0.0
    dash_cost = 0.0
    hold_pnl = 0.0
    hold_cost = 0.0
    wins = 0
    n_res = 0
    n_open_res = 0
    seen: set[str] = set()
    for src, rows in (("closed", closed), ("open", opened)):
        for row in rows:
            asset = str(row.get("asset") or row.get("id") or "")
            key = asset or f"{row.get('conditionId')}|{row.get('outcome')}"
            if key in seen:
                continue
            seen.add(key)
            if not _is_resolved(row):
                continue
            n_res += 1
            if src == "open":
                n_open_res += 1
            cost = _row_cost(row)
            if cost < 25:
                continue
            try:
                realized = float(row.get("realizedPnl") or 0)
                cash = float(row.get("cashPnl") or 0)
                cur = float(row.get("curPrice") or 0)
                avg = float(row.get("avgPrice") or 0) or 0.5
            except (TypeError, ValueError):
                continue
            dash_pnl += realized + cash
            dash_cost += cost
            won = cur >= 0.99
            entry = min(max(avg, 0.02), 0.98)
            hp = cost * (1.0 / entry - 1.0) if won else -cost
            hold_pnl += hp
            hold_cost += cost
            if won:
                wins += 1
    dash_roi = (dash_pnl / dash_cost * 100) if dash_cost > 0 else 0.0
    hold_roi = (hold_pnl / hold_cost * 100) if hold_cost > 0 else 0.0
    wr = (wins / n_res * 100) if n_res else 0.0
    closed_only = sample_closed_pnl(wallet, pages=closed_pages)
    return {
        **closed_only,
        "sample_resolved_n": n_res,
        "sample_open_resolved": n_open_res,
        "sample_dash_roi": round(dash_roi, 2),
        "sample_hold_roi": round(hold_roi, 2),
        "sample_hold_wr": round(wr, 1),
        "closed_only_bias": round(closed_only["sample_roi"] - hold_roi, 1),
    }


def scan_new_traders(
    *,
    max_new: int = 12,
    min_pnl: float = 20_000,
    min_vol: float = 50_000,
    sample_pages: int = 4,
) -> dict:
    """Sports leaderboard scan with honest closed+open screening. Writes discovered_candidates.json."""
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
        if r["wallet"] not in known and r["best_pnl"] >= min_pnl and r["vol"] >= min_vol
    ]
    already = [r for r in merged if r["wallet"] in known]

    print(f"\nLeaderboard unique wallets: {len(merged)}")
    print(f"Already tracked on LB: {len(already)}")
    print(f"New passing PnL/vol gates: {len(new_rows)}")

    scored: list[dict] = []
    for i, row in enumerate(new_rows[: max(max_new, 1)], 1):
        print(f"[{i}/{min(len(new_rows), max_new)}] sampling {row['username']} {row['wallet'][:10]}…")
        sample = sample_honest_book(row["wallet"], closed_pages=max(1, sample_pages), open_pages=3)
        entry = {**row, **sample}
        recency_pts = 20 * entry["recency"]
        pnl_pts = min(40.0, max(0.0, entry["best_pnl"] / 25_000))
        hold_roi = float(entry.get("sample_hold_roi") or entry.get("sample_roi") or 0)
        roi_pts = min(30.0, max(0.0, hold_roi))
        if entry.get("sample_resolved_n", entry.get("sample_closed_rows", 0)) < 15:
            roi_pts *= 0.4
        # Closed-only samples that collapse once open losers are included are fake KEEP names.
        bias = float(entry.get("closed_only_bias") or 0)
        if bias >= 15:
            roi_pts *= 0.3
        wr = float(entry.get("sample_hold_wr") or 0)
        if wr >= 94 and hold_roi < 8:
            roi_pts = 0
        entry["screen_score"] = round(recency_pts + pnl_pts + roi_pts, 1)
        scored.append(entry)

    scored.sort(key=lambda r: (-r["screen_score"], -r["best_pnl"]))

    recommended = [
        r
        for r in scored
        if r.get("sample_resolved_n", r.get("sample_closed_rows", 0)) >= 12
        and float(r.get("sample_hold_roi") or r.get("sample_roi") or 0) >= 3.0
        and float(r.get("sample_hold_wr") or 0) < 94
        and r["screen_score"] >= 25
        and float(r.get("closed_only_bias") or 0) < 25
    ][: max_new]

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
            f"LB PnL=${r['best_pnl']:>10,.0f}  hold ROI={r.get('sample_hold_roi', r['sample_roi']):>6.1f}%  "
            f"closed ROI={r['sample_roi']:>6.1f}%  bias={r.get('closed_only_bias', 0):+.0f}  "
            f"windows={','.join(r['windows'])}"
        )

    missing_csv = []
    for w, u in ALL_TRADERS:
        if not csv_path_for(w, u).exists():
            missing_csv.append(u)
    if missing_csv:
        print(f"\nCurated traders still missing CSV (need full fetch): {', '.join(missing_csv)}")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Discover new Polymarket sports traders")
    parser.add_argument("--max-new", type=int, default=12, help="Max new wallets to recommend")
    parser.add_argument("--min-pnl", type=float, default=20_000, help="Min leaderboard PnL (USD)")
    parser.add_argument("--min-vol", type=float, default=50_000, help="Min leaderboard volume (USD)")
    parser.add_argument("--sample-pages", type=int, default=4, help="Closed-position pages for screening")
    parser.add_argument("--write-extra", action="store_true", help="Write pnl_analysis/extra_traders.json")
    args = parser.parse_args()
    payload = scan_new_traders(
        max_new=args.max_new,
        min_pnl=args.min_pnl,
        min_vol=args.min_vol,
        sample_pages=args.sample_pages,
    )
    recommended = payload.get("recommended") or []
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
                        f"hold_roi={r.get('sample_hold_roi', r.get('sample_roi')):.1f}% "
                        f"closed_bias={r.get('closed_only_bias', 0):+.0f} "
                        f"windows={','.join(r['windows'])}"
                    ),
                }
            )
            have.add(r["wallet"])
            added += 1
        EXTRA_PATH.write_text(json.dumps(existing, indent=2), encoding="utf-8")
        print(f"Wrote {EXTRA_PATH} (+{added} new, {len(existing)} total)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
