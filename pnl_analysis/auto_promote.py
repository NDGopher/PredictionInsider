#!/usr/bin/env python3
"""Auto promote / demote / bench from activity + equity curve — not vibes.

Writes status changes into extra_traders.json (history array) and
pnl_analysis/output/auto_promote_log.json. Then rebuilds copy_universe.

Promote watch/scout → take_book when:
  - Joinable (WR 48–75 or Path-B specialist 75–85)
  - HOT or WARM
  - Not hard-skip / MM mega / take-rule bleed
  - Either unique ROI ≥5% + last30 n≥8
    OR regime=turnaround/hot with last30 ROI ≥8% and n≥30
  - If take-rule n≥12: require take ROI ≥0

Promote scout → watch when the unique book validates (n≥40, WR band, not thin)
but live gates are not yet met.

Demote take_book → watch when take-slice n≥12 and ROI ≤ −10%, or last 60d AND
90d take-slice are both negative (n≥15 each) — same bar as take_book_daily
drop proposals, now applied.

Bench when 90+ days with no joinable prints.

Does not invent fills or PnL. Does not touch SharpMoney. PTA is out of scope.

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
    PATH_B_EXCLUDED_USERNAMES,
    STALE_BENCH_DAYS,
    TAKE_RULE_BLEED_BENCH,
    WR_HI,
    WR_HI_SPECIALIST,
    WR_LO,
    build_universe,
    is_path_b_specialist,
    load_elite_roster,
    write_universe,
)
from equity_regime import regime_for_trader  # noqa: E402
from trader_display import english_name  # noqa: E402

LOG_PATH = OUTPUT_DIR / "auto_promote_log.json"
WOULD_HAVE = OUTPUT_DIR / "would_have_30d.json"
TAKE_HEALTH = OUTPUT_DIR / "take_health.json"
DISCOVERED = OUTPUT_DIR / "discovered_candidates.json"


def _f(v: Any) -> float | None:
    try:
        if v is None:
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _load_extra() -> list[dict[str, Any]]:
    if not EXTRA_PATH.exists():
        return []
    try:
        data = json.loads(EXTRA_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[auto-promote] extra_traders.json: {exc}", file=sys.stderr)
        return []
    return data if isinstance(data, list) else []


def _save_extra(rows: list[dict[str, Any]]) -> None:
    EXTRA_PATH.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _take_slice(username: str) -> dict[str, Any]:
    """Prefer 30d would-have take-slice; fall back to take_health by_trader."""
    wh = _load_json(WOULD_HAVE)
    for t in wh.get("by_trader") or []:
        if str(t.get("username") or "") == username:
            return {
                "n": int((t.get("n") or 0)),
                "roi": _f(t.get("roi_2c")),
                "source": "would_have_30d",
            }
    health = _load_json(TAKE_HEALTH)
    for t in health.get("by_trader") or []:
        if str(t.get("username") or "") == username:
            w30 = t.get("last_30d") or {}
            w60 = t.get("last_60d") or {}
            w90 = t.get("last_90d") or {}
            return {
                "n": int(w30.get("n") or 0),
                "roi": _f(w30.get("roi_2c")),
                "n60": int(w60.get("n") or 0),
                "roi60": _f(w60.get("roi_2c")),
                "n90": int(w90.get("n") or 0),
                "roi90": _f(w90.get("roi_2c")),
                "source": "take_health",
            }
    return {}


def _set_status(row: dict[str, Any], status: str, action: str, reason: str, *, dry_run: bool) -> None:
    if dry_run:
        return
    old = str(row.get("status") or "")
    row["status"] = status
    row["updated_at"] = now_iso()
    hist = row.get("history")
    if not isinstance(hist, list):
        hist = []
    hist.append({
        "action": action,
        "old_status": old,
        "new_status": status,
        "timestamp": now_iso(),
        "reason": reason,
    })
    row["history"] = hist[-40:]


def should_auto_live(
    t: dict[str, Any],
    regime: dict[str, Any],
    take: dict[str, Any],
    elite_roster: dict[str, dict[str, Any]],
) -> tuple[bool, str]:
    username = str(t.get("username") or "")
    wallet = str(t.get("wallet") or "").lower()
    if username in PATH_B_EXCLUDED_USERNAMES:
        return False, "path_b_excluded_grinder_mm"
    if username in TAKE_RULE_BLEED_BENCH:
        return False, "take_rule_bleed_bench"
    wr = _f(t.get("win_rate")) or 0.0
    median = _f(t.get("median_stake")) or 1e9
    path_b_ok, path_b_why = is_path_b_specialist(
        username, wallet, wr, _f(t.get("unique_roi")), median, elite_roster
    )
    joinable = bool(t.get("joinable")) or path_b_ok
    if not joinable:
        return False, "not_joinable"
    if median >= MEDIAN_JOIN_MAX:
        return False, "whale_median"
    if not (WR_LO <= wr <= WR_HI) and not path_b_ok:
        return False, f"wr_out_of_band_{wr}"
    recency = str(t.get("recency") or "")
    if recency not in {"HOT", "WARM"}:
        return False, f"recency_{recency or 'UNKNOWN'}"
    last30_n = int(t.get("last_30d_n") or regime.get("last_30d_n") or 0)
    if last30_n < LIVE_MIN_LAST30_N and not path_b_ok:
        return False, f"quiet_30d_n={last30_n}"

    take_n = int(take.get("n") or 0)
    take_roi = _f(take.get("roi"))
    if take_n >= 12 and take_roi is not None and take_roi < 0 and not path_b_ok:
        return False, f"take_bleed_n={take_n}_roi={take_roi}"

    life_roi = _f(t.get("unique_roi"))
    l30_roi = _f(t.get("last_30d_roi"))
    if l30_roi is None:
        l30_roi = _f(regime.get("last_30d_roi"))
    reg = str(regime.get("regime") or "")

    if path_b_ok:
        return True, f"auto_live {path_b_why} last30_n={last30_n}"

    if life_roi is not None and life_roi >= LIVE_MIN_ROI and last30_n >= LIVE_MIN_LAST30_N:
        if take_n >= 12 and (take_roi or 0) >= 5:
            return True, f"auto_live unique_roi={life_roi}% take={take_n}/{take_roi}%"
        if take_n < 12:
            return True, f"auto_live unique_roi={life_roi}% awaiting_take_prints n={take_n}"
        if (take_roi or 0) >= 0:
            return True, f"auto_live unique_roi={life_roi}% take_ok {take_n}/{take_roi}%"

    if reg in {"turnaround", "hot"} and l30_roi is not None and l30_roi >= 8 and last30_n >= 30:
        if take_n >= 12 and take_roi is not None and take_roi < 0:
            return False, "turnaround_but_take_bleed"
        return True, (
            f"auto_live regime={reg} last30={l30_roi}% n={last30_n} "
            f"({regime.get('why')})"
        )

    return False, f"gates_fail life={life_roi} regime={reg} l30={l30_roi}"


def should_auto_watch(t: dict[str, Any]) -> tuple[bool, str]:
    """Scout → watch when a unique book exists and is not a grinder/MM."""
    closed = int(t.get("closed") or 0)
    wr = _f(t.get("win_rate")) or 0.0
    if closed < 40:
        return False, f"scout_thin closed={closed}"
    if wr >= 94:
        return False, f"scout_grinder wr={wr}"
    if not (WR_LO <= wr <= WR_HI_SPECIALIST):
        return False, f"scout_wr={wr}"
    roi = _f(t.get("unique_roi"))
    if roi is not None and roi < 0:
        return False, f"scout_neg_roi={roi}"
    return True, f"scout_book_valid closed={closed} wr={wr} roi={roi}"


def should_demote_live(take: dict[str, Any], t: dict[str, Any]) -> tuple[bool, str]:
    take_n = int(take.get("n") or 0)
    take_roi = _f(take.get("roi"))
    if take_n >= 12 and take_roi is not None and take_roi <= -10:
        return True, f"live take bleed n={take_n} roi={take_roi}%"
    n60 = int(take.get("n60") or 0)
    n90 = int(take.get("n90") or 0)
    roi60 = _f(take.get("roi60"))
    roi90 = _f(take.get("roi90"))
    if n60 >= 15 and n90 >= 15 and roi60 is not None and roi90 is not None:
        if roi60 < 0 and roi90 < 0:
            return True, f"take-slice 90d {roi90}% (n={n90}) and 60d {roi60}% (n={n60}) both negative"
    days = t.get("days_since_last")
    if days is not None and int(days) >= STALE_BENCH_DAYS:
        return True, f"stale_{days}d_no_joinable_prints"
    return False, "hold"


def _ensure_row(
    extra: list[dict[str, Any]],
    by_wallet: dict[str, dict[str, Any]],
    wallet: str,
    username: str,
    *,
    source: str,
) -> dict[str, Any]:
    row = by_wallet.get(wallet)
    if row is not None:
        return row
    row = {
        "wallet": wallet,
        "username": username,
        "source": source,
        "status": "watch",
        "why_tail": "",
        "notes": "",
        "add_date": today_iso(),
        "updated_at": now_iso(),
        "history": [],
    }
    extra.append(row)
    by_wallet[wallet] = row
    return row


def ingest_scouts(
    *,
    extra: list[dict[str, Any]],
    by_wallet: dict[str, dict[str, Any]],
    dry_run: bool,
    discovered_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Add vetted auto-discover / discover_traders candidates as scout — no live promotion here."""
    added: list[dict[str, Any]] = []
    payload = _load_json(discovered_path or DISCOVERED)
    for r in (payload.get("recommended") or [])[:8]:
        wallet = str(r.get("wallet") or "").lower()
        username = str(r.get("username") or "")
        if not wallet or wallet in by_wallet:
            continue
        if r.get("resolved") is False:
            continue
        why = (
            f"Scout {today_iso()}: screen={r.get('screen_score')} "
            f"hold_roi={r.get('sample_hold_roi') or r.get('sample_roi')} "
            f"n={r.get('sample_resolved_n') or r.get('sample_closed_rows')}"
        )
        added.append({
            "username": username,
            "wallet": wallet,
            "action": "scout_add",
            "why": why,
            "display_name": english_name(username, wallet),
        })
        if dry_run:
            continue
        row = {
            "wallet": wallet,
            "username": username,
            "source": str(r.get("source") or "auto_discover_scout"),
            "status": "scout",
            "why_tail": why,
            "add_date": today_iso(),
            "updated_at": now_iso(),
            "history": [{"action": "scout_add", "timestamp": now_iso(), "reason": why}],
        }
        extra.append(row)
        by_wallet[wallet] = row
    elite = load_elite_roster()
    # Elite-file scouts stay scout until unique books validate.
    roster = _load_json(OUTPUT_DIR / "verified_elite_roster.json")
    for r in roster.get("scout") or []:
        wallet = str(r.get("wallet") or "").lower()
        username = str(r.get("username") or "")
        if not wallet or wallet in by_wallet:
            continue
        why = str(r.get("why") or "elite-file scout")
        added.append({
            "username": username,
            "wallet": wallet,
            "action": "scout_add",
            "why": why,
            "display_name": english_name(username, wallet),
        })
        if dry_run:
            continue
        row = {
            "wallet": wallet,
            "username": username,
            "source": "verified_elite_scout",
            "status": "scout",
            "why_tail": why,
            "add_date": today_iso(),
            "updated_at": now_iso(),
            "history": [{"action": "scout_add", "timestamp": now_iso(), "reason": why}],
        }
        extra.append(row)
        by_wallet[wallet] = row
    _ = elite
    return added


def apply_promotions(*, dry_run: bool = False) -> dict[str, Any]:
    uni = build_universe()
    extra = _load_extra()
    by_wallet = {str(r.get("wallet") or "").lower(): r for r in extra if isinstance(r, dict)}
    elite_roster = load_elite_roster()
    promoted: list[dict[str, Any]] = []
    demoted: list[dict[str, Any]] = []
    watched: list[dict[str, Any]] = []
    benched: list[dict[str, Any]] = []
    held: list[dict[str, Any]] = []
    scouts_added = ingest_scouts(extra=extra, by_wallet=by_wallet, dry_run=dry_run)

    for t in uni.get("live") or []:
        username = str(t.get("username") or "")
        wallet = str(t.get("wallet") or "").lower()
        take = _take_slice(username)
        drop, why = should_demote_live(take, t)
        if not drop:
            continue
        action = "auto_bench" if "stale_" in why else "auto_demote_watch"
        new_status = "benched" if action == "auto_bench" else "watch"
        entry = {
            "username": username,
            "wallet": wallet,
            "action": action,
            "why": why,
            "display_name": english_name(username, wallet),
        }
        if new_status == "benched":
            benched.append(entry)
        else:
            demoted.append(entry)
        row = _ensure_row(extra, by_wallet, wallet, username, source="auto_promote")
        row["auto_demoted_at"] = now_iso()
        row["auto_demote_reason"] = why
        _set_status(row, new_status, action, why, dry_run=dry_run)

    candidates = list(uni.get("watch") or []) + list(uni.get("bench") or []) + list(uni.get("scout") or [])
    for t in candidates:
        username = str(t.get("username") or "")
        wallet = str(t.get("wallet") or "").lower()
        if not wallet:
            continue
        if username in PATH_B_EXCLUDED_USERNAMES:
            held.append({"username": username, "wallet": wallet, "why": "path_b_excluded_grinder_mm"})
            continue
        regime = regime_for_trader(wallet, username)
        take = _take_slice(username)
        days = t.get("days_since_last")
        if days is not None and int(days) >= STALE_BENCH_DAYS:
            why = f"stale_{days}d_no_joinable_prints"
            benched.append({
                "username": username,
                "wallet": wallet,
                "action": "auto_bench",
                "why": why,
                "display_name": english_name(username, wallet),
            })
            row = _ensure_row(extra, by_wallet, wallet, username, source="auto_promote")
            row["bench_reason"] = why
            row["bench_date"] = today_iso()
            _set_status(row, "benched", "auto_bench", why, dry_run=dry_run)
            continue

        ok, why = should_auto_live(t, regime, take, elite_roster)
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
            "display_name": english_name(username, wallet),
        }
        if ok:
            promoted.append({**entry, "action": "auto_promote_live"})
            row = _ensure_row(extra, by_wallet, wallet, username, source="auto_promote")
            row["auto_promoted_at"] = now_iso()
            row["auto_promote_reason"] = why
            row["why_tail"] = why
            row["regime"] = regime.get("regime")
            _set_status(row, "take_book", "auto_promote", why, dry_run=dry_run)
            continue
        if str(t.get("bucket") or t.get("extra_status") or "") == "scout":
            watch_ok, watch_why = should_auto_watch(t)
            if watch_ok:
                watched.append({**entry, "action": "scout_to_watch", "why": watch_why})
                row = _ensure_row(extra, by_wallet, wallet, username, source="auto_promote")
                row["why_tail"] = watch_why
                _set_status(row, "watch", "scout_to_watch", watch_why, dry_run=dry_run)
                continue
        held.append(entry)

    if not dry_run:
        _save_extra(extra)
        write_universe(build_universe())

    payload = {
        "generated_at": now_iso(),
        "dry_run": dry_run,
        "method": (
            "Automatic scout/watch/bench → take_book when joinable + HOT/WARM + "
            "(unique ROI≥5% or Path-B elite or regime turnaround/hot last30≥8% n≥30). "
            "Take-slice n≥12 with −ROI blocks (except Path-B). "
            "Demote on take bleed ≤−10% or 60d+90d both negative. "
            "Bench at 90d no prints. Unique-book stats overlay from Postgres desk tape. "
            "Rebuilds copy_universe."
        ),
        "promoted": promoted,
        "demoted": demoted,
        "watched": watched,
        "benched": benched,
        "scouts_added": scouts_added,
        "held_sample": held[:40],
        "counts": {
            "promoted": len(promoted),
            "demoted": len(demoted),
            "watched": len(watched),
            "benched": len(benched),
            "scouts_added": len(scouts_added),
            "held": len(held),
        },
    }
    if not dry_run:
        LOG_PATH.write_text(json.dumps(payload, indent=2, default=str, ensure_ascii=False), encoding="utf-8")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    payload = apply_promotions(dry_run=args.dry_run)
    c = payload["counts"]
    print(
        f"[auto-promote] promoted={c['promoted']} demoted={c['demoted']} "
        f"watched={c['watched']} benched={c['benched']} scouts={c['scouts_added']}"
    )
    for p in payload["promoted"]:
        print(f"  PROMOTE {p.get('display_name') or p['username']}: {p['why']}")
    for p in payload["demoted"]:
        print(f"  DEMOTE  {p.get('display_name') or p['username']}: {p['why']}")
    for p in payload["benched"]:
        print(f"  BENCH   {p.get('display_name') or p['username']}: {p['why']}")
    for p in payload["watched"]:
        print(f"  WATCH   {p.get('display_name') or p['username']}: {p['why']}")
    if not args.dry_run:
        print(f"[auto-promote] wrote {LOG_PATH} + {EXTRA_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
