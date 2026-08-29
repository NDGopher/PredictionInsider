#!/usr/bin/env python3
"""Elite continuous ticks — thin product refreshes without cold full pipeline.

Modes:
  micro     ranked opens + take-book health          (~every 15–20m)
  promote   adaptive lab + auto_promote + roster     (~every 45–60m)
  after-hot roster + ranked opens after hot discover
  full-lite micro + promote (manual / cron)

Usage:
  python3 pnl_analysis/elite_continuous_tick.py --mode micro
  python3 pnl_analysis/elite_continuous_tick.py --mode promote
  python3 pnl_analysis/elite_continuous_tick.py --mode after-hot
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "output"
STATUS = OUT / "elite_continuous_status.json"

MODES: dict[str, list[tuple[str, list[str]]]] = {
    "micro": [
        ("ranked play board", [sys.executable, str(ROOT / "scan_ranked_opens.py")]),
        ("take-book health", [sys.executable, str(ROOT / "take_book_daily.py")]),
    ],
    "promote": [
        ("adaptive multi-strategy lab", [sys.executable, str(ROOT / "adaptive_copy_lab.py")]),
        ("auto-promote / demote", [sys.executable, str(ROOT / "auto_promote.py")]),
        ("copy universe", [sys.executable, str(ROOT / "copy_roster.py")]),
        ("ranked play board", [sys.executable, str(ROOT / "scan_ranked_opens.py")]),
        ("take-book health", [sys.executable, str(ROOT / "take_book_daily.py")]),
    ],
    "after-hot": [
        ("copy universe", [sys.executable, str(ROOT / "copy_roster.py")]),
        ("ranked play board", [sys.executable, str(ROOT / "scan_ranked_opens.py")]),
    ],
    "full-lite": [],  # filled below
}
MODES["full-lite"] = MODES["promote"]  # promote already includes micro steps


def run_steps(label: str, steps: list[tuple[str, list[str]]]) -> dict:
    started = datetime.now(timezone.utc).isoformat()
    failed: list[str] = []
    print(f"[elite-tick] mode={label} steps={len(steps)}")
    for name, cmd in steps:
        print(f"  --- {name} ---")
        proc = subprocess.run(cmd, cwd=str(ROOT.parent))
        if proc.returncode != 0:
            print(f"  [warn] {name} exited {proc.returncode}")
            failed.append(name)
    finished = datetime.now(timezone.utc).isoformat()
    payload = {
        "generated_at": finished,
        "mode": label,
        "started_at": started,
        "finished_at": finished,
        "failed": failed,
        "ok": len(failed) == 0,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    STATUS.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"[elite-tick] done ok={payload['ok']} failed={failed or 'none'}")
    return payload


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--mode",
        choices=sorted(MODES.keys()),
        default="micro",
        help="Which continuous tick to run",
    )
    args = ap.parse_args()
    steps = MODES[args.mode]
    if not steps:
        print(f"[elite-tick] no steps for mode={args.mode}")
        return 1
    result = run_steps(args.mode, steps)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
