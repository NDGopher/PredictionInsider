#!/usr/bin/env python3
"""
Remove regenerable / stray files under pnl_analysis/output/.
Keeps: _all_analysis.json, _previous_ingest.json, .last_pipeline_run, per-trader CSV+JSON for ALL_TRADERS.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pnl_analysis"))
from run_full_pipeline import ALL_TRADERS, OUTPUT_DIR, csv_path_for, json_path_for  # noqa: E402

ALLOWED = {w.lower() for w, _ in ALL_TRADERS}


def main() -> int:
    removed: list[str] = []

    for f in OUTPUT_DIR.glob("grade_changes_*.json"):
        if f.is_file():
            f.unlink()
            removed.append(f.name)

    for f in OUTPUT_DIR.glob("*breakdown*.csv"):
        if f.is_file():
            f.unlink()
            removed.append(f.name)

    # One-off analyze_one_address / polymarket_trader_history exports (not used by run_full_pipeline)
    for pattern in ("*_trades.csv", "*_positions_summary.csv"):
        for f in OUTPUT_DIR.glob(pattern):
            if f.is_file():
                f.unlink()
                removed.append(f.name)

    for name in ("full_rerun.log", "full_rerun_final.log"):
        p = OUTPUT_DIR / name
        if p.is_file():
            p.unlink()
            removed.append(name)

    # Legacy duplicate JSON (same wallet as long-filename trader file)
    dup = OUTPUT_DIR / "0xD9E0AACa_0xd9e0aa.json"
    if dup.is_file():
        dup.unlink()
        removed.append(dup.name)

    for f in list(OUTPUT_DIR.glob("*.json")):
        if f.name.startswith("_") or "_trades" in f.name:
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        w = (data.get("wallet") or "").strip().lower()
        if w and w not in ALLOWED:
            if f.is_file():
                f.unlink()
                removed.append(f.name)
            stem = f.stem
            csvp = OUTPUT_DIR / f"{stem}.csv"
            if csvp.is_file():
                csvp.unlink()
                removed.append(csvp.name)

    if removed:
        print(f"Removed {len(removed)} file(s):")
        for n in sorted(set(removed)):
            print(f"  - {n}")
    else:
        print("Nothing to remove.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
