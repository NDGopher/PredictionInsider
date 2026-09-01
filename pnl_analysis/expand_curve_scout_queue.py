#!/usr/bin/env python3
"""Expand the curve-scout digestion queue from Polydata sports boards.

Problem: walk-forward only sees ~35–45 digested CSVs, so "1 live elite"
is a coverage failure — not proof that HVAB is uniquely elite.

This script:
  1. Reads polydata_boards.json sports survivors (week+month)
  2. Upserts missing wallets into extra_traders.json as watch
  3. Writes a prioritized fetch queue for run_full_pipeline / fetch_watch_csvs
  4. Reports coverage gap (board survivors vs local CSVs)

Usage:
  python pnl_analysis/expand_curve_scout_queue.py
  python pnl_analysis/expand_curve_scout_queue.py --fetch 15
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_full_pipeline import EXTRA_TRADERS_PATH, OUTPUT_DIR, csv_path_for, roster_traders  # noqa: E402

BOARDS = OUTPUT_DIR / "polydata_boards.json"
QUEUE_OUT = OUTPUT_DIR / "curve_scout_queue.json"


def _key(wallet: str) -> str:
    return (wallet or "").lower()[:8]


def local_csv_keys() -> set[str]:
    keys: set[str] = set()
    for p in OUTPUT_DIR.glob("*_0x*.csv"):
        m = re.search(r"(0x[0-9a-fA-F]+)", p.name)
        if m:
            keys.add(m.group(1).lower()[:8])
    return keys


def load_survivors() -> list[dict[str, Any]]:
    if not BOARDS.exists():
        print(f"[warn] missing {BOARDS} — run discover_polydata_boards.py first")
        return []
    data = json.loads(BOARDS.read_text(encoding="utf-8"))
    rows = list(data.get("sports_survivors") or [])
    # Prefer month then week sports
    rows = [r for r in rows if r.get("category") == "sports" and r.get("window") in {"month", "week"}]
    rows.sort(
        key=lambda r: (
            0 if r.get("window") == "month" else 1,
            -float(r.get("pnl_vol") or 0),
            -float(r.get("pnl") or 0),
        )
    )
    return rows


def upsert_all_watch(survivors: list[dict[str, Any]]) -> tuple[int, list[dict[str, Any]]]:
    known = {w.lower(): u for w, u in roster_traders()}
    existing: list[dict[str, Any]] = []
    if EXTRA_TRADERS_PATH.exists():
        try:
            raw = json.loads(EXTRA_TRADERS_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                existing = [r for r in raw if isinstance(r, dict)]
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[warn] extra_traders: {exc}")
            return 0, []
    by_w = {str(r.get("wallet") or "").lower(): r for r in existing if r.get("wallet")}
    added = 0
    new_rows: list[dict[str, Any]] = []
    for row in survivors:
        w = str(row.get("wallet") or "").lower()
        u = str(row.get("username") or "").strip()
        if not w.startswith("0x") or not u:
            continue
        if w in known or w in by_w:
            continue
        if row.get("reasons"):
            continue
        rec = {
            "wallet": w,
            "username": u,
            "source": f"curve_scout_queue_{row.get('window')}_{row.get('category')}",
            "status": "watch",
            "notes": (
                f"Curve-scout queue from Polydata {row.get('window')} sports "
                f"#{row.get('rank')} PnL=${row.get('pnl'):,.0f} "
                f"PnL/vol={float(row.get('pnl_vol') or 0):.1%}. Digest CSV then scout."
            ),
        }
        by_w[w] = rec
        new_rows.append(rec)
        added += 1
        print(f"  [watch+] {u}  pnl/vol={float(row.get('pnl_vol') or 0):.1%}")
    if added:
        EXTRA_TRADERS_PATH.write_text(
            json.dumps(existing + new_rows, indent=2) + "\n", encoding="utf-8"
        )
    return added, new_rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", type=int, default=0, help="Fetch N missing CSVs now via pipeline")
    args = ap.parse_args()

    survivors = load_survivors()
    have = local_csv_keys()
    queue: list[dict[str, Any]] = []
    for row in survivors:
        w = str(row.get("wallet") or "").lower()
        u = str(row.get("username") or "")
        digested = _key(w) in have
        queue.append(
            {
                **{k: row.get(k) for k in ("wallet", "username", "rank", "pnl", "vol", "pnl_vol", "window")},
                "has_csv": digested,
                "priority": "digest_now" if not digested else "rescore",
            }
        )

    missing = [q for q in queue if not q["has_csv"]]
    present = [q for q in queue if q["has_csv"]]
    added, _ = upsert_all_watch(survivors)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": (
            "Polydata week+month sports survivors → watch queue. "
            "Coverage gap explains sparse live elite pocket."
        ),
        "counts": {
            "board_survivors": len(survivors),
            "have_csv": len(present),
            "missing_csv": len(missing),
            "watch_added": added,
            "local_digest_csvs": len(have),
        },
        "missing_priority": missing[:60],
        "already_digested": present[:40],
        "note": (
            "Fetch missing with: python pnl_analysis/fetch_watch_csvs.py --limit 25 "
            "after copy_roster rebuild, or --fetch N on this script."
        ),
    }
    QUEUE_OUT.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    print(
        f"\nBoard survivors={len(survivors)}  have_csv={len(present)}  "
        f"missing={len(missing)}  watch+={added}"
    )
    print(f"Wrote {QUEUE_OUT}")
    print("Top undigested (manual priority):")
    for q in missing[:15]:
        print(
            f"  {q['username']:<28} pnl/vol={float(q.get('pnl_vol') or 0):5.1%}  "
            f"pnl=${float(q.get('pnl') or 0):,.0f}  {q['wallet'][:12]}…"
        )

    if args.fetch > 0 and missing:
        names = [str(q["username"]) for q in missing[: args.fetch]]
        print(f"\nFetching {len(names)}: {names}")
        cmd = [
            sys.executable,
            str(Path(__file__).resolve().parent / "run_full_pipeline.py"),
            "--incremental",
            "--full-open",
            "--traders",
            ",".join(names),
        ]
        return subprocess.run(cmd, cwd=str(Path(__file__).resolve().parent.parent)).returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
