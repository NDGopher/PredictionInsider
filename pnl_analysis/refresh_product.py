#!/usr/bin/env python3
"""Rebuild product files after CSVs/ingest are current.

The app keeps serving the previous JSON until each file is replaced, so
Take these / Insider Ranks stay up during a refresh-all.

Usage:
  python pnl_analysis/refresh_product.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STEPS: list[tuple[str, list[str]]] = [
    ("polydata discovery → watch", [sys.executable, str(ROOT / "discover_polydata_boards.py")]),
    ("take-book health", [sys.executable, str(ROOT / "take_book_daily.py")]),
    ("copy universe", [sys.executable, str(ROOT / "copy_roster.py")]),
    ("insider ranks", [sys.executable, str(ROOT / "build_insider_ranks.py"), "--offline"]),
    ("working copy model", [sys.executable, str(ROOT / "rebuild_working_model.py")]),
    ("tail digest + CLV", [sys.executable, str(ROOT / "digest_tail_candidates.py")]),
    ("adaptive multi-strategy lab", [sys.executable, str(ROOT / "adaptive_copy_lab.py")]),
    ("hot-copy screen", [sys.executable, str(ROOT / "screen_hot_copy.py")]),
    ("verify copy books", [sys.executable, str(ROOT / "verify_copy_books.py")]),
]


def main() -> int:
    print("=" * 70)
    print("Refreshing product files (ranks, copy list, take-book). App stays up.")
    print("=" * 70)
    failed: list[str] = []
    for label, cmd in STEPS:
        print(f"\n--- {label} ---")
        proc = subprocess.run(cmd, cwd=str(ROOT.parent))
        if proc.returncode != 0:
            print(f"[warn] {label} exited {proc.returncode}")
            failed.append(label)
            # Ranks/copy list are the reason refresh-all exists. Stop if those fail.
            if label in {"insider ranks", "copy universe"}:
                return proc.returncode
    if failed:
        print(f"\n[warn] finished with warnings: {', '.join(failed)}")
        return 1
    print("\n[OK] Ranks, copy universe, and take-book rebuilt. Refresh the browser.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
