#!/usr/bin/env python3
"""
Verify every ALL_TRADERS row has CSV + analysis JSON with ROI, win rate, and sport/market breakdowns.
Exit 0 if OK, 1 with errors printed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pnl_analysis"))
from run_full_pipeline import ALL_TRADERS, csv_path_for, json_path_for  # noqa: E402

REQUIRED_KEYS = (
    "wallet",
    "username",
    "overall_roi",
    "win_rate",
    "sport_stats",
    "market_stats",
    "sport_market_stats",
    "quality_score",
    "tier",
)


def main() -> int:
    errors: list[str] = []
    for wallet, username in ALL_TRADERS:
        w = wallet.lower()
        csv_p = csv_path_for(wallet, username)
        json_p = json_path_for(wallet, username)
        if not csv_p.exists():
            errors.append(f"{username} ({w[:10]}...): missing CSV {csv_p.name}")
            continue
        if csv_p.stat().st_size < 50:
            errors.append(f"{username}: CSV too small ({csv_p.stat().st_size} bytes)")
        if not json_p.exists():
            errors.append(f"{username}: missing JSON {json_p.name}")
            continue
        try:
            data = json.loads(json_p.read_text(encoding="utf-8"))
        except Exception as e:
            errors.append(f"{username}: invalid JSON ({e})")
            continue
        for k in REQUIRED_KEYS:
            if k not in data:
                errors.append(f"{username}: missing key '{k}'")
        if not isinstance(data.get("sport_stats"), dict):
            errors.append(f"{username}: sport_stats must be object")
        if not isinstance(data.get("market_stats"), dict):
            errors.append(f"{username}: market_stats must be object")
        if not isinstance(data.get("sport_market_stats"), dict):
            errors.append(f"{username}: sport_market_stats must be object")

    if errors:
        print(f"FAILED: {len(errors)} issue(s)")
        for e in errors:
            print(f"  {e}")
        return 1
    print(f"OK: all {len(ALL_TRADERS)} curated traders have CSV + JSON with ROI, win_rate, sport_stats, market_stats, sport_market_stats.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
