#!/usr/bin/env python3
"""Gate: every live/bench/watch trader has a current CSV + analysis with PnL and sport/submarket breakdowns.

Compares JSON dashboard_pnl to the CSV (realizedPnl + cashPnl). Writes
pnl_analysis/output/copy_book_verify.json. Exit 1 if copy-focus books are incomplete.

Usage:
  python pnl_analysis/verify_copy_books.py
  python pnl_analysis/verify_copy_books.py --max-age-hours 36
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from copy_roster import copy_focus_buckets, load_universe  # noqa: E402
from position_utils import dashboard_pnl, read_trader_csv  # noqa: E402
from run_full_pipeline import csv_path_for, json_path_for  # noqa: E402

OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUT_PATH = OUTPUT_DIR / "copy_book_verify.json"

REQUIRED_KEYS = (
    "wallet",
    "username",
    "overall_roi",
    "win_rate",
    "dashboard_pnl",
    "total_profit",
    "sport_stats",
    "market_stats",
    "sport_market_stats",
    "last_30d",
    "last_60d",
    "last_90d",
    "quality_score",
    "tier",
)
BREAKDOWN_KEYS = ("net_profit", "roi", "win_rate", "events")
WINDOW_KEYS = ("pnl", "roi", "events")


def _f(v: Any) -> float | None:
    try:
        if v is None:
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _csv_dashboard(csv_path: Path) -> tuple[float, int]:
    df = read_trader_csv(csv_path)
    pnl = float(pd.to_numeric(dashboard_pnl(df), errors="coerce").fillna(0).sum())
    return pnl, int(len(df))


def _check_breakdown(name: str, stats: Any, *, require_rows: bool) -> list[str]:
    errors: list[str] = []
    if not isinstance(stats, dict):
        return [f"{name} must be an object"]
    if require_rows and not stats:
        errors.append(f"{name} is empty")
        return errors
    for key, row in stats.items():
        if not isinstance(row, dict):
            errors.append(f"{name}[{key}] must be an object")
            continue
        for field in BREAKDOWN_KEYS:
            if field not in row:
                errors.append(f"{name}[{key}] missing '{field}'")
    return errors


def _check_window(name: str, window: Any) -> list[str]:
    if not isinstance(window, dict):
        return [f"{name} must be an object"]
    missing = [k for k in WINDOW_KEYS if k not in window]
    return [f"{name} missing '{k}'" for k in missing]


def audit_trader(row: dict[str, Any], *, max_age_hours: float | None) -> dict[str, Any]:
    username = str(row.get("username") or "")
    wallet = str(row.get("wallet") or "").lower()
    bucket = str(row.get("bucket") or "")
    csv_p = csv_path_for(wallet, username)
    json_p = json_path_for(wallet, username)
    errors: list[str] = []
    warnings: list[str] = []
    csv_age_h: float | None = None
    json_age_h: float | None = None
    csv_pnl: float | None = None
    json_pnl: float | None = None
    csv_rows = 0
    sports: list[str] = []
    markets: list[str] = []

    if not csv_p.exists():
        errors.append(f"missing CSV {csv_p.name}")
    else:
        csv_age_h = (time.time() - csv_p.stat().st_mtime) / 3600.0
        if csv_p.stat().st_size < 50:
            errors.append(f"CSV too small ({csv_p.stat().st_size} bytes)")
        else:
            try:
                csv_pnl, csv_rows = _csv_dashboard(csv_p)
            except Exception as exc:
                errors.append(f"CSV unreadable: {exc}")

    if not json_p.exists():
        errors.append(f"missing analysis JSON {json_p.name}")
        return {
            "username": username,
            "wallet": wallet,
            "bucket": bucket,
            "ok": False,
            "errors": errors,
            "warnings": warnings,
            "csv": csv_p.name,
            "json": json_p.name,
            "csv_age_hours": round(csv_age_h, 2) if csv_age_h is not None else None,
            "json_age_hours": None,
            "csv_rows": csv_rows,
            "csv_dashboard_pnl": csv_pnl,
            "json_dashboard_pnl": None,
            "overall_roi": None,
            "win_rate": None,
            "sports": sports,
            "markets": markets,
        }

    json_age_h = (time.time() - json_p.stat().st_mtime) / 3600.0
    try:
        data = json.loads(json_p.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"invalid JSON: {exc}")
        data = {}

    if isinstance(data, dict):
        for key in REQUIRED_KEYS:
            if key not in data:
                errors.append(f"missing key '{key}'")
        json_pnl = _f(data.get("dashboard_pnl"))
        if json_pnl is None:
            json_pnl = _f(data.get("total_profit"))
        sports = sorted(str(k) for k in (data.get("sport_stats") or {}) if k)
        markets = sorted(str(k) for k in (data.get("market_stats") or {}) if k)
        closed = int(row.get("closed") or data.get("markets_traded") or 0)
        require_rows = closed >= 10 or csv_rows >= 10
        errors.extend(_check_breakdown("sport_stats", data.get("sport_stats"), require_rows=require_rows))
        errors.extend(_check_breakdown("market_stats", data.get("market_stats"), require_rows=require_rows))
        errors.extend(_check_breakdown("sport_market_stats", data.get("sport_market_stats"), require_rows=require_rows))
        for win_name in ("last_30d", "last_60d", "last_90d"):
            errors.extend(_check_window(win_name, data.get(win_name)))
        if csv_pnl is not None and json_pnl is not None:
            tol = max(1.0, abs(csv_pnl) * 0.005)
            if abs(csv_pnl - json_pnl) > tol:
                errors.append(
                    f"PnL mismatch CSV ${csv_pnl:,.2f} vs JSON ${json_pnl:,.2f} (tol ${tol:,.2f})"
                )
        if csv_p.exists() and json_p.stat().st_mtime + 2 < csv_p.stat().st_mtime:
            warnings.append("analysis JSON is older than CSV — re-analyze needed")

    if max_age_hours is not None and csv_age_h is not None and csv_age_h > max_age_hours:
        if bucket in {"live", "bench"}:
            errors.append(f"CSV stale {csv_age_h:.1f}h > {max_age_hours:.0f}h")
        else:
            warnings.append(f"CSV stale {csv_age_h:.1f}h > {max_age_hours:.0f}h")

    return {
        "username": username,
        "wallet": wallet,
        "bucket": bucket,
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "csv": csv_p.name,
        "json": json_p.name,
        "csv_age_hours": round(csv_age_h, 2) if csv_age_h is not None else None,
        "json_age_hours": round(json_age_h, 2) if json_age_h is not None else None,
        "csv_rows": csv_rows,
        "csv_dashboard_pnl": round(csv_pnl, 2) if csv_pnl is not None else None,
        "json_dashboard_pnl": round(json_pnl, 2) if json_pnl is not None else None,
        "overall_roi": _f(data.get("overall_roi")) if isinstance(data, dict) else None,
        "win_rate": _f(data.get("win_rate")) if isinstance(data, dict) else None,
        "sports": sports,
        "markets": markets,
    }


def run_audit(*, max_age_hours: float | None = None) -> dict[str, Any]:
    uni = load_universe()
    traders: list[dict[str, Any]] = []
    seen: set[str] = set()
    for key in copy_focus_buckets():
        for row in uni.get(key) or []:
            if not isinstance(row, dict):
                continue
            w = str(row.get("wallet") or "").lower()
            if not w or w in seen:
                continue
            seen.add(w)
            traders.append(audit_trader(row, max_age_hours=max_age_hours))

    failed = [t for t in traders if not t["ok"]]
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "max_age_hours": max_age_hours,
        "ok": not failed,
        "counts": {
            "checked": len(traders),
            "passed": len(traders) - len(failed),
            "failed": len(failed),
        },
        "failed": [{"username": t["username"], "bucket": t["bucket"], "errors": t["errors"]} for t in failed],
        "traders": traders,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify live/bench/watch CSV + sport/submarket PnL")
    parser.add_argument(
        "--max-age-hours",
        type=float,
        default=None,
        help="Fail live/bench (warn watch) if CSV is older than this many hours",
    )
    args = parser.parse_args()
    payload = run_audit(max_age_hours=args.max_age_hours)
    counts = payload["counts"]
    print(
        f"[copy-books] {counts['passed']}/{counts['checked']} ok "
        f"({counts['failed']} failed) -> {OUT_PATH}"
    )
    for t in payload.get("traders") or []:
        flag = "OK" if t["ok"] else "FAIL"
        age = t.get("csv_age_hours")
        age_s = f"{age:.1f}h" if isinstance(age, (int, float)) else "no-csv"
        pnl = t.get("json_dashboard_pnl")
        pnl_s = f"${pnl:,.0f}" if isinstance(pnl, (int, float)) else "—"
        sports = ",".join(t.get("sports") or []) or "—"
        markets = ",".join(t.get("markets") or []) or "—"
        print(
            f"  {flag:<4} {t['bucket']:<6} {t['username']:<32} "
            f"age={age_s:<7} pnl={pnl_s:<12} sports={sports}  mkts={markets}"
        )
        for err in t.get("errors") or []:
            print(f"       ! {err}")
        for warn in t.get("warnings") or []:
            print(f"       ~ {warn}")
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
