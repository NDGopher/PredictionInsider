#!/usr/bin/env python3
"""Auto-promote joinable books to live copy when adaptive + regime gates fire.

Writes status changes into extra_traders.json (watch → take_book) and
pnl_analysis/output/auto_promote_log.json. Then rebuild copy_universe.

Rules (automatic, no human gate):
  - Joinable median / WR / closed band
  - HOT or WARM
  - Not hard-skip / MM mega / take_rule_bleed with deep take losses
  - Either: unique ROI ≥5% + last30 n≥8
    OR regime=turnaround/hot with last30 ROI ≥8% and n≥30 (SDTrading-style)
  - If take-rule n≥12: require take ROI ≥0 (else demote path)
  - Watch never stays blocked once gates pass — status becomes take_book

Usage:
  python pnl_analysis/auto_promote.py
  python pnl_analysis/auto_promote.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from copy_roster import (  # noqa: E402
    EXTRA_PATH,
    LIVE_MIN_LAST30_N,
    LIVE_MIN_ROI,
    MEDIAN_JOIN_MAX,
    OUTPUT_DIR,
    TAKE_RULE_BLEED_BENCH,
    WR_HI,
    WR_LO,
    build_universe,
    write_universe,
)
from equity_regime import regime_for_trader  # noqa: E402

LOG_PATH = OUTPUT_DIR / "auto_promote_log.json"
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


def should_auto_live(t: dict[str, Any], regime: dict[str, Any], take: dict[str, Any]) -> tuple[bool, str]:
    username = str(t.get("username") or "")
    if username in TAKE_RULE_BLEED_BENCH:
        return False, "take_rule_bleed_bench"
    if not t.get("joinable"):
        return False, "not_joinable"
    median = _f(t.get("median_stake")) or 1e9
    wr = _f(t.get("win_rate")) or 0.0
    if median >= MEDIAN_JOIN_MAX:
        return False, "whale_median"
    if not (WR_LO <= wr <= WR_HI):
        return False, f"wr_out_of_band_{wr}"
    recency = str(t.get("recency") or "")
    if recency not in {"HOT", "WARM"}:
        return False, f"recency_{recency or 'UNKNOWN'}"
    last30_n = int(t.get("last_30d_n") or regime.get("last_30d_n") or 0)
    if last30_n < LIVE_MIN_LAST30_N:
        return False, f"quiet_30d_n={last30_n}"

    take_n = int(take.get("n") or 0)
    take_roi = _f(take.get("roi"))
    if take_n >= 12 and take_roi is not None and take_roi < 0:
        return False, f"take_bleed_n={take_n}_roi={take_roi}"

    life_roi = _f(t.get("unique_roi"))
    l30_roi = _f(t.get("last_30d_roi"))
    if l30_roi is None:
        l30_roi = _f(regime.get("last_30d_roi"))
    reg = str(regime.get("regime") or "")

    # Path A: classic unique-book live
    if life_roi is not None and life_roi >= LIVE_MIN_ROI and last30_n >= LIVE_MIN_LAST30_N:
        if take_n >= 12 and (take_roi or 0) >= 5:
            return True, f"auto_live unique_roi={life_roi}% take={take_n}/{take_roi}%"
        if take_n < 12:
            return True, f"auto_live unique_roi={life_roi}% awaiting_take_prints n={take_n}"
        if (take_roi or 0) >= 0:
            return True, f"auto_live unique_roi={life_roi}% take_ok {take_n}/{take_roi}%"

    # Path B: equity turnaround / hot regime (SDTrading-style)
    if reg in {"turnaround", "hot"} and l30_roi is not None and l30_roi >= 8 and last30_n >= 30:
        if take_n >= 12 and take_roi is not None and take_roi < 0:
            return False, "turnaround_but_take_bleed"
        return True, (
            f"auto_live regime={reg} last30={l30_roi}% n={last30_n} "
            f"({regime.get('why')})"
        )

    return False, f"gates_fail life={life_roi} regime={reg} l30={l30_roi}"


def apply_promotions(*, dry_run: bool = False) -> dict[str, Any]:
    uni = build_universe()
    extra = _load_extra()
    by_wallet = {str(r.get("wallet") or "").lower(): r for r in extra if isinstance(r, dict)}
    now = datetime.now(timezone.utc).isoformat()
    promoted: list[dict[str, Any]] = []
    demoted: list[dict[str, Any]] = []
    held: list[dict[str, Any]] = []

    candidates = list(uni.get("watch") or []) + list(uni.get("bench") or [])
    # Also re-check current live for demote
    for t in uni.get("live") or []:
        username = str(t.get("username") or "")
        wallet = str(t.get("wallet") or "").lower()
        regime = regime_for_trader(wallet, username)
        take = _lab_take(username)
        take_n = int(take.get("n") or 0)
        take_roi = _f(take.get("roi"))
        if take_n >= 12 and take_roi is not None and take_roi <= -10:
            demoted.append({
                "username": username,
                "wallet": wallet,
                "action": "auto_demote_bench",
                "why": f"live take bleed n={take_n} roi={take_roi}%",
            })
            row = by_wallet.get(wallet)
            if row is not None and not dry_run:
                row["status"] = "watch"
                row["auto_demoted_at"] = now
                row["auto_demote_reason"] = demoted[-1]["why"]
                notes = str(row.get("notes") or "")
                tag = f"[auto-demote {now[:10]}] {demoted[-1]['why']}"
                if tag not in notes:
                    row["notes"] = f"{tag} | {notes}".strip(" |")

    for t in candidates:
        username = str(t.get("username") or "")
        wallet = str(t.get("wallet") or "").lower()
        if not wallet:
            continue
        regime = regime_for_trader(wallet, username)
        take = _lab_take(username)
        ok, why = should_auto_live(t, regime, take)
        entry = {
            "username": username,
            "wallet": wallet,
            "from_bucket": t.get("bucket"),
            "regime": regime.get("regime"),
            "why": why,
            "unique_roi": t.get("unique_roi"),
            "last_30d_roi": t.get("last_30d_roi") or regime.get("last_30d_roi"),
            "last_30d_n": t.get("last_30d_n") or regime.get("last_30d_n"),
            "take_n": take.get("n"),
            "take_roi": take.get("roi"),
        }
        if not ok:
            held.append(entry)
            continue
        promoted.append({**entry, "action": "auto_promote_live"})
        row = by_wallet.get(wallet)
        if row is None:
            row = {
                "wallet": wallet,
                "username": username,
                "source": "auto_promote",
                "status": "take_book",
                "notes": "",
            }
            extra.append(row)
            by_wallet[wallet] = row
        if not dry_run:
            row["status"] = "take_book"
            row["auto_promoted_at"] = now
            row["auto_promote_reason"] = why
            row["regime"] = regime.get("regime")
            notes = str(row.get("notes") or "")
            tag = f"[auto-promote {now[:10]}] {why}"
            if tag not in notes:
                row["notes"] = f"{tag} | {notes}".strip(" |")

    if not dry_run:
        _save_extra(extra)
        write_universe(build_universe())

    payload = {
        "generated_at": now,
        "dry_run": dry_run,
        "method": (
            "Automatic watch/bench → take_book when joinable + HOT/WARM + "
            "(unique ROI≥5% or regime turnaround/hot last30≥8% n≥30). "
            "Take-rule n≥12 with −ROI blocks. Rebuilds copy_universe."
        ),
        "promoted": promoted,
        "demoted": demoted,
        "held_sample": held[:40],
        "counts": {
            "promoted": len(promoted),
            "demoted": len(demoted),
            "held": len(held),
        },
    }
    if not dry_run:
        LOG_PATH.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    payload = apply_promotions(dry_run=args.dry_run)
    print(f"[auto-promote] promoted={payload['counts']['promoted']} demoted={payload['counts']['demoted']}")
    for p in payload["promoted"]:
        print(f"  PROMOTE {p['username']}: {p['why']}")
    for p in payload["demoted"]:
        print(f"  DEMOTE  {p['username']}: {p['why']}")
    if not args.dry_run:
        print(f"[auto-promote] wrote {LOG_PATH} + {EXTRA_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
