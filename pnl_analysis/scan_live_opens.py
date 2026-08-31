#!/usr/bin/env python3
"""One-shot open TAKE scan on current live copy books."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from take_book_daily import OPEN_OUT, OUT, load_trusted, scan_open  # noqa: E402


def main() -> int:
    trusted = load_trusted()
    print("trusted live", [t.get("username") for t in trusted])
    live, near = scan_open(trusted)
    print(f"LIVE={len(live)} NEAR={len(near)}")
    for r in live[:40]:
        play = str(r.get("play") or "")[:90]
        print(
            f"  TAKE {str(r.get('username')):<36} Q={r.get('q'):>3} "
            f"{float(r.get('rel') or 0):5.1f}x px={float(r.get('entry') or 0):.3f} "
            f"sport={r.get('sport')}  {play}"
        )
    print("--- NEAR (top 30) ---")
    for r in near[:30]:
        misses = ", ".join(r.get("misses") or [])[:75]
        play = str(r.get("play") or "")[:70]
        print(f"  NEAR {str(r.get('username')):<36} {misses:<75} {play}")

    payload_open = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "live": live,
        "near": near,
        "copy_books": [
            {"username": t.get("username"), "wallet": t.get("wallet")} for t in trusted
        ],
    }
    OPEN_OUT.write_text(json.dumps(payload_open, indent=2, default=str), encoding="utf-8")

    health: dict = {}
    if OUT.exists():
        try:
            health = json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            health = {}
    health.update(
        {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "as_of": datetime.now(timezone.utc).date().isoformat(),
            "status": "go",
            "pause_reason": None,
            "live_open": live,
            "near_open": near,
            "note": (
                "Open scan refreshed from live CSVs; "
                "rolling take ROI windows need asof_fullbook_plays.csv"
            ),
        }
    )
    OUT.write_text(json.dumps(health, indent=2, default=str), encoding="utf-8")
    print(f"wrote {OPEN_OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
