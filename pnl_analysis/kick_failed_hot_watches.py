#!/usr/bin/env python3
"""Auto-kick hot-discovered watches that fail after first CSV / take-rule proof.

Hot discovery enqueues unusual_flow_* wallets as watch. After their first unique
book lands, kick obvious fails so the watch list does not fill with Z-noise.

Kick when (any):
  - analysis Q < 22 and closed sample n ≥ 20
  - unique ROI ≤ −15% with ≥ 40 closed events
  - take-rule n ≥ 12 and take ROI < 0
  - hard sus: win rate > 78% with ≥ 30 events (winner-capped)

Never kicks take_book / matched. Writes notes + kicked_at.

Usage:
  python3 pnl_analysis/kick_failed_hot_watches.py
  python3 pnl_analysis/kick_failed_hot_watches.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from copy_roster import EXTRA_PATH, build_universe, write_universe  # noqa: E402
from run_full_pipeline import OUTPUT_DIR, csv_path_for, json_path_for  # noqa: E402

LOG_PATH = OUTPUT_DIR / "hot_kick_log.json"
LAB_PATH = OUTPUT_DIR / "adaptive_copy_lab.json"


def _f(v: Any) -> float | None:
    try:
        if v is None:
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _load_extra() -> list[dict[str, Any]]:
    if not EXTRA_PATH.exists():
        return []
    data = json.loads(EXTRA_PATH.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else []


def _save_extra(rows: list[dict[str, Any]]) -> None:
    EXTRA_PATH.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _lab_take(username: str) -> dict[str, Any]:
    if not LAB_PATH.exists():
        return {}
    try:
        lab = json.loads(LAB_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    for t in lab.get("traders") or []:
        if str(t.get("username") or "") == username:
            return t.get("product") or {}
    return {}


def _analysis(wallet: str, username: str) -> dict[str, Any]:
    p = json_path_for(wallet, username)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def should_kick(row: dict[str, Any], uni_row: dict[str, Any] | None) -> tuple[bool, str]:
    src = str(row.get("source") or "")
    if not src.startswith("unusual_flow"):
        return False, "not_hot"
    st = str(row.get("status") or "")
    if st in {"kicked", "kick", "take_book", "matched"}:
        return False, f"status_{st}"
    wallet = str(row.get("wallet") or "").lower()
    username = str(row.get("username") or "")
    if not csv_path_for(wallet, username).exists():
        return False, "no_csv_yet"

    analysis = _analysis(wallet, username)
    q = _f(analysis.get("quality_score") or analysis.get("q"))
    closed = int(analysis.get("closed_positions") or analysis.get("n_events") or uni_row.get("closed") or 0) if uni_row else int(analysis.get("closed_positions") or analysis.get("n_events") or 0)
    # Some analysis JSONs nest under unique / summary
    if closed <= 0 and uni_row:
        closed = int(uni_row.get("closed") or 0)
    roi = _f(uni_row.get("unique_roi") if uni_row else None)
    if roi is None:
        roi = _f(analysis.get("roi") or analysis.get("unique_roi"))
    wr = _f(uni_row.get("win_rate") if uni_row else None)
    if wr is None:
        wr = _f(analysis.get("win_rate"))

    take = _lab_take(username)
    take_n = int(take.get("n") or 0)
    take_roi = _f(take.get("roi"))

    if take_n >= 12 and take_roi is not None and take_roi < 0:
        return True, f"take_bleed n={take_n} roi={take_roi}%"
    if q is not None and q < 22 and closed >= 20:
        return True, f"low_q={int(q)} closed={closed}"
    if roi is not None and roi <= -15 and closed >= 40:
        return True, f"unique_roi={roi}% closed={closed}"
    if wr is not None and wr > 78 and closed >= 30:
        return True, f"sus_high_wr={wr}% closed={closed}"
    # Fresh hot with only 1–2 rows and deeply negative open PnL in analysis
    if closed <= 2 and q is not None and q <= 5 and roi is not None and roi <= -20:
        return True, f"thin_fail q={int(q)} roi={roi}%"
    return False, "pass"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    extra = _load_extra()
    uni = build_universe()
    by_w_uni = {
        str(t.get("wallet") or "").lower(): t
        for bucket in ("watch", "bench", "live", "skip", "kicked")
        for t in (uni.get(bucket) or [])
    }
    now = datetime.now(timezone.utc).isoformat()
    kicked: list[dict[str, Any]] = []
    kept = 0

    for row in extra:
        if not isinstance(row, dict):
            continue
        wallet = str(row.get("wallet") or "").lower()
        ok, why = should_kick(row, by_w_uni.get(wallet))
        if not ok:
            if why == "pass":
                kept += 1
            continue
        entry = {
            "username": row.get("username"),
            "wallet": wallet,
            "source": row.get("source"),
            "why": why,
            "kicked_at": now,
        }
        kicked.append(entry)
        print(f"  [kick] {row.get('username')} — {why}")
        if not args.dry_run:
            row["status"] = "kicked"
            row["kicked_at"] = now
            row["kick_reason"] = why
            notes = str(row.get("notes") or "")
            tag = f"[hot-kick {now[:10]}] {why}"
            if tag not in notes:
                row["notes"] = f"{tag} | {notes}".strip(" |")

    if not args.dry_run and kicked:
        _save_extra(extra)
        write_universe(build_universe())

    payload = {
        "generated_at": now,
        "dry_run": args.dry_run,
        "kicked": kicked,
        "kept_hot_pass": kept,
        "counts": {"kicked": len(kicked), "kept": kept},
    }
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    LOG_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"[hot-kick] kicked={len(kicked)} kept_pass={kept} → {LOG_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
