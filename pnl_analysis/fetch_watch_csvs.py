#!/usr/bin/env python3
"""Incremental CSV fetch for watch-list traders missing local books.

Polydata discovery adds names to extra_traders.json; this pulls their first
unique closed+open book so digest / ranked scan can grade them.

Usage:
  python pnl_analysis/fetch_watch_csvs.py
  python pnl_analysis/fetch_watch_csvs.py --limit 8
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from copy_roster import load_universe  # noqa: E402
from run_full_pipeline import csv_path_for  # noqa: E402

ROOT = Path(__file__).resolve().parent


def need_fetch(uni: dict) -> list[str]:
    names: list[str] = []
    for bucket in ("watch", "bench"):
        for t in uni.get(bucket) or []:
            u = str(t.get("username") or "")
            w = str(t.get("wallet") or "")
            if not u or not w:
                continue
            if not csv_path_for(w, u).exists():
                names.append(u)
    return names


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=8, help="Max new traders per run")
    args = ap.parse_args()
    uni = load_universe()
    pending = need_fetch(uni)
    if not pending:
        print("[fetch-watch] all watch/bench entries have CSVs")
        return 0
    batch = pending[: max(1, args.limit)]
    print(f"[fetch-watch] {len(pending)} missing CSV; fetching {len(batch)}: {batch}")
    cmd = [
        sys.executable,
        str(ROOT / "run_full_pipeline.py"),
        "--incremental",
        "--full-open",
        "--traders",
        ",".join(batch),
    ]
    proc = subprocess.run(cmd, cwd=str(ROOT.parent))
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
