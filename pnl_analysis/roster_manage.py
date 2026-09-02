#!/usr/bin/env python3
"""Manage the live copy roster without code changes.

Operations:
  add       Add a trader to the roster (watch by default, or specify status)
  remove    Remove a trader (sets status to "removed")
  kick      Kick a trader (sets status to "kicked" with reason)
  bench     Bench a stale trader (sets status to "benched")
  promote   Promote a scout/watch to take_book (requires elite gates)
  scout     Show scout candidates and optionally add to watch
  list      List all traders by status
  stale     Auto-bench traders with no joinable prints in 90+ days
  auto      Apply activity+equity promote/demote (see auto_promote.py)

Examples:
  python roster_manage.py add 0x1234... "NewTrader" --why "Strong +ROI curve, recent 30d"
  python roster_manage.py kick 0x1234... --reason "Collapsed to -ROI after loser-side fetch"
  python roster_manage.py bench 0x1234... --reason "No prints since 2026-05-01"
  python roster_manage.py scout --max-new 5 --write
  python roster_manage.py stale --days 90 --apply
  python roster_manage.py list --status live
  python roster_manage.py promote 0x1234... --reason "Passed elite gates: Q>=60, sport ROI>=5%"

The roster is stored in pnl_analysis/extra_traders.json. This file is the single
source of truth for operational roster changes. Changes flow into copy_roster.py
(copy_universe.json) and build_insider_ranks.py (insider_ranks.json) on the next
pipeline run.

Status values:
  take_book  - On the live Telegram alert list (must pass elite gates)
  watch      - Tracked, books refreshed, not on live alerts
  benched    - Was live or watch, auto-benched for staleness
  scout      - Discovered candidate, needs vetting
  kicked     - Removed from roster (reason required)
  removed    - Manually removed by operator
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output"
EXTRA_PATH = ROOT / "extra_traders.json"
COPY_UNIVERSE_PATH = OUTPUT_DIR / "copy_universe.json"
INSIDER_RANKS_PATH = OUTPUT_DIR / "insider_ranks.json"
TRUSTED_PATH = OUTPUT_DIR / "trusted_full_books.json"

STALE_DAYS_DEFAULT = 90
SCOUT_MIN_ROI = 5.0
SCOUT_MIN_EVENTS = 30
SCOUT_MAX_MEDIAN = 15_000.0

VALID_STATUSES = {"take_book", "watch", "benched", "scout", "kicked", "removed"}
LIVE_STATUSES = {"take_book"}
REFRESH_STATUSES = {"take_book", "watch", "scout"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def load_extra() -> list[dict[str, Any]]:
    if not EXTRA_PATH.exists():
        return []
    try:
        data = json.loads(EXTRA_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception as e:
        print(f"[warn] could not read {EXTRA_PATH}: {e}")
        return []


def save_extra(data: list[dict[str, Any]]) -> None:
    EXTRA_PATH.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    print(f"[roster] wrote {EXTRA_PATH} ({len(data)} entries)")


def find_trader(data: list[dict], wallet: str | None = None, username: str | None = None) -> int:
    """Return index of trader in data, or -1 if not found."""
    if wallet:
        w = wallet.lower().strip()
        for i, row in enumerate(data):
            if str(row.get("wallet") or "").lower().strip() == w:
                return i
    if username:
        u = username.lower().strip()
        for i, row in enumerate(data):
            if str(row.get("username") or "").lower().strip() == u:
                return i
    return -1


def load_copy_universe() -> dict[str, Any]:
    if not COPY_UNIVERSE_PATH.exists():
        return {}
    try:
        return json.loads(COPY_UNIVERSE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def load_insider_ranks() -> dict[str, Any]:
    if not INSIDER_RANKS_PATH.exists():
        return {}
    try:
        return json.loads(INSIDER_RANKS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def load_trusted_books() -> list[str]:
    """Return list of wallets on the take book."""
    if not TRUSTED_PATH.exists():
        return []
    try:
        data = json.loads(TRUSTED_PATH.read_text(encoding="utf-8"))
        return [str(t.get("wallet") or "").lower() for t in (data.get("trusted") or []) if t.get("wallet")]
    except Exception:
        return []


def get_trader_metrics(wallet: str) -> dict[str, Any] | None:
    """Pull last_event_date and joinable metrics from insider_ranks or copy_universe."""
    ranks = load_insider_ranks()
    for t in ranks.get("traders") or []:
        if str(t.get("wallet") or "").lower() == wallet.lower():
            return {
                "last_event_date": t.get("our", {}).get("last_event_date"),
                "recency_band": t.get("recency_band"),
                "days_since_last": t.get("days_since_last"),
                "win_rate": t.get("our", {}).get("win_rate"),
                "median_stake": t.get("our", {}).get("median_stake"),
                "dashboard_pnl": t.get("our", {}).get("dashboard_pnl"),
                "closed": t.get("book", {}).get("closed"),
                "lane": t.get("lane"),
                "copyable": t.get("copyable"),
                "quality_score": t.get("our", {}).get("quality_score"),
            }
    uni = load_copy_universe()
    for t in uni.get("traders") or []:
        if str(t.get("wallet") or "").lower() == wallet.lower():
            return {
                "last_event_date": t.get("last_event_date"),
                "recency_band": t.get("recency"),
                "days_since_last": None,
                "win_rate": t.get("win_rate"),
                "median_stake": t.get("median_stake"),
                "dashboard_pnl": None,
                "closed": t.get("closed"),
                "lane": t.get("bucket"),
                "copyable": t.get("bucket") == "live",
                "quality_score": None,
            }
    return None


def cmd_add(args: argparse.Namespace) -> int:
    """Add a trader to the roster."""
    wallet = args.wallet.lower().strip()
    username = args.username.strip()
    status = args.status or "watch"
    why_tail = args.why or ""
    source = args.source or "manual"

    if status not in VALID_STATUSES:
        print(f"[error] invalid status: {status}. Must be one of {VALID_STATUSES}")
        return 1

    data = load_extra()
    idx = find_trader(data, wallet=wallet)
    now = now_iso()

    entry = {
        "wallet": wallet,
        "username": username,
        "source": source,
        "status": status,
        "why_tail": why_tail,
        "add_date": today_iso(),
        "updated_at": now,
        "notes": args.notes or "",
    }

    if idx >= 0:
        old = data[idx]
        entry["add_date"] = old.get("add_date") or today_iso()
        entry["history"] = old.get("history") or []
        entry["history"].append({
            "action": "update",
            "old_status": old.get("status"),
            "new_status": status,
            "timestamp": now,
            "reason": args.notes or "manual update",
        })
        data[idx] = entry
        print(f"[roster] updated {username} ({wallet[:10]}...) -> status={status}")
    else:
        entry["history"] = [{
            "action": "add",
            "status": status,
            "timestamp": now,
            "reason": why_tail or "manual add",
        }]
        data.append(entry)
        print(f"[roster] added {username} ({wallet[:10]}...) -> status={status}")

    save_extra(data)
    return 0


def cmd_kick(args: argparse.Namespace) -> int:
    """Kick a trader from the roster."""
    wallet = args.wallet.lower().strip()
    reason = args.reason or "Operator kick — no reason given"

    data = load_extra()
    idx = find_trader(data, wallet=wallet)
    now = now_iso()

    if idx < 0:
        print(f"[warn] wallet {wallet[:10]}... not in extra_traders.json; adding as kicked")
        entry = {
            "wallet": wallet,
            "username": wallet[:12],
            "source": "manual",
            "status": "kicked",
            "notes": reason,
            "add_date": today_iso(),
            "kick_date": today_iso(),
            "updated_at": now,
            "history": [{
                "action": "kick",
                "timestamp": now,
                "reason": reason,
            }],
        }
        data.append(entry)
    else:
        old = data[idx]
        old["status"] = "kicked"
        old["notes"] = reason
        old["kick_date"] = today_iso()
        old["updated_at"] = now
        old.setdefault("history", []).append({
            "action": "kick",
            "old_status": old.get("status"),
            "timestamp": now,
            "reason": reason,
        })
        print(f"[roster] kicked {old.get('username')} ({wallet[:10]}...): {reason}")

    save_extra(data)
    return 0


def cmd_bench(args: argparse.Namespace) -> int:
    """Bench a stale trader."""
    wallet = args.wallet.lower().strip()
    reason = args.reason or "Benched for staleness"

    data = load_extra()
    idx = find_trader(data, wallet=wallet)
    now = now_iso()

    if idx < 0:
        print(f"[error] wallet {wallet[:10]}... not in extra_traders.json")
        return 1

    old = data[idx]
    old["status"] = "benched"
    old["bench_date"] = today_iso()
    old["bench_reason"] = reason
    old["updated_at"] = now
    old.setdefault("history", []).append({
        "action": "bench",
        "old_status": old.get("status"),
        "timestamp": now,
        "reason": reason,
    })
    print(f"[roster] benched {old.get('username')} ({wallet[:10]}...): {reason}")

    save_extra(data)
    return 0


def cmd_remove(args: argparse.Namespace) -> int:
    """Remove a trader from the roster."""
    wallet = args.wallet.lower().strip()
    reason = args.reason or "Manually removed"

    data = load_extra()
    idx = find_trader(data, wallet=wallet)
    now = now_iso()

    if idx < 0:
        print(f"[error] wallet {wallet[:10]}... not in extra_traders.json")
        return 1

    old = data[idx]
    old["status"] = "removed"
    old["remove_date"] = today_iso()
    old["notes"] = reason
    old["updated_at"] = now
    old.setdefault("history", []).append({
        "action": "remove",
        "old_status": old.get("status"),
        "timestamp": now,
        "reason": reason,
    })
    print(f"[roster] removed {old.get('username')} ({wallet[:10]}...): {reason}")

    save_extra(data)
    return 0


def cmd_promote(args: argparse.Namespace) -> int:
    """Promote a trader to take_book (requires validation)."""
    wallet = args.wallet.lower().strip()
    reason = args.reason or "Manual promotion"

    data = load_extra()
    idx = find_trader(data, wallet=wallet)
    now = now_iso()

    if idx < 0:
        print(f"[error] wallet {wallet[:10]}... not in extra_traders.json. Add first with 'add'.")
        return 1

    old = data[idx]
    metrics = get_trader_metrics(wallet)

    if not args.force:
        if metrics:
            wr = metrics.get("win_rate") or 0
            median = metrics.get("median_stake") or 0
            closed = metrics.get("closed") or 0
            qs = metrics.get("quality_score") or 0
            recency = metrics.get("recency_band") or "UNKNOWN"

            issues = []
            if wr < 48 or wr > 75:
                issues.append(f"WR {wr:.1f}% outside 48-75 band")
            if median > 15_000:
                issues.append(f"Median ${median:,.0f} > $15k unjoinable")
            if closed < 40:
                issues.append(f"Only {closed} closed events (<40)")
            if qs and qs < 60:
                issues.append(f"Quality score {qs} < 60")
            if recency in {"DROP", "DARK"}:
                issues.append(f"Recency {recency} is stale")

            if issues:
                print(f"[warn] Promotion blocked by elite gates:")
                for issue in issues:
                    print(f"  - {issue}")
                print("Use --force to override.")
                return 1
        else:
            print(f"[warn] No metrics found for {wallet[:10]}... Run pipeline first or use --force.")
            return 1

    old["status"] = "take_book"
    old["promote_date"] = today_iso()
    old["promote_reason"] = reason
    old["updated_at"] = now
    old.setdefault("history", []).append({
        "action": "promote",
        "old_status": old.get("status"),
        "timestamp": now,
        "reason": reason,
    })
    print(f"[roster] promoted {old.get('username')} ({wallet[:10]}...) to take_book: {reason}")

    save_extra(data)
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    """List traders by status."""
    data = load_extra()
    status_filter = args.status.lower() if args.status else None

    by_status: dict[str, list[dict]] = {}
    for row in data:
        st = str(row.get("status") or "unknown").lower()
        by_status.setdefault(st, []).append(row)

    if status_filter:
        if status_filter not in by_status:
            print(f"[info] No traders with status={status_filter}")
            return 0
        statuses = [status_filter]
    else:
        statuses = ["take_book", "watch", "scout", "benched", "kicked", "removed"]

    for st in statuses:
        traders = by_status.get(st, [])
        if not traders:
            continue
        print(f"\n=== {st.upper()} ({len(traders)}) ===")
        for t in traders:
            wallet = str(t.get("wallet") or "")[:10]
            username = str(t.get("username") or "")
            why = t.get("why_tail") or t.get("notes") or ""
            last = t.get("updated_at") or t.get("add_date") or ""
            metrics = get_trader_metrics(str(t.get("wallet") or ""))
            if metrics:
                recency = metrics.get("recency_band") or "?"
                wr = metrics.get("win_rate") or 0
                last_event = metrics.get("last_event_date") or "?"
                print(f"  {username:<28} {wallet}... rec={recency:<4} WR={wr:.0f}% last={last_event}")
            else:
                print(f"  {username:<28} {wallet}...")
            if why and args.verbose:
                print(f"    why: {why[:80]}")

    uni = load_copy_universe()
    live_wallets = {str(t.get("wallet") or "").lower() for t in (uni.get("live") or [])}
    extra_wallets = {str(t.get("wallet") or "").lower() for t in data}
    live_not_in_extra = live_wallets - extra_wallets
    if live_not_in_extra and not status_filter:
        print(f"\n=== LIVE (from copy_universe, not in extra_traders) ===")
        for w in list(live_not_in_extra)[:10]:
            for t in uni.get("live") or []:
                if str(t.get("wallet") or "").lower() == w:
                    print(f"  {t.get('username'):<28} {w[:10]}... rec={t.get('recency')}")

    return 0


def cmd_stale(args: argparse.Namespace) -> int:
    """Auto-bench traders with no joinable prints in N days."""
    days = args.days or STALE_DAYS_DEFAULT
    apply = args.apply
    data = load_extra()
    now = datetime.now(timezone.utc)
    now_date = now.date()

    to_bench: list[tuple[int, str, str]] = []

    for i, row in enumerate(data):
        status = str(row.get("status") or "").lower()
        if status in {"kicked", "removed", "benched"}:
            continue

        wallet = str(row.get("wallet") or "").lower()
        metrics = get_trader_metrics(wallet)

        if not metrics:
            continue

        last_event = metrics.get("last_event_date")
        if not last_event:
            continue

        try:
            last_dt = datetime.fromisoformat(str(last_event)[:10]).date()
            days_since = (now_date - last_dt).days
        except (TypeError, ValueError):
            continue

        if days_since >= days:
            username = str(row.get("username") or wallet[:10])
            reason = f"Auto-benched: no joinable prints in {days_since}d (last={last_event}, threshold={days}d)"
            to_bench.append((i, username, reason))

    if not to_bench:
        print(f"[stale] No traders meet the {days}-day staleness threshold.")
        return 0

    print(f"[stale] Found {len(to_bench)} stale traders (>={days}d no activity):")
    for _, username, reason in to_bench:
        print(f"  - {username}: {reason}")

    if not apply:
        print("\nUse --apply to actually bench these traders.")
        return 0

    now_iso_str = now_iso()
    for idx, username, reason in to_bench:
        data[idx]["status"] = "benched"
        data[idx]["bench_date"] = today_iso()
        data[idx]["bench_reason"] = reason
        data[idx]["updated_at"] = now_iso_str
        data[idx].setdefault("history", []).append({
            "action": "auto_bench_stale",
            "old_status": data[idx].get("status"),
            "timestamp": now_iso_str,
            "reason": reason,
        })
        print(f"[stale] benched {username}")

    save_extra(data)
    return 0


def cmd_scout(args: argparse.Namespace) -> int:
    """Show scout candidates from discovered_candidates.json."""
    candidates_path = OUTPUT_DIR / "discovered_candidates.json"
    if not candidates_path.exists():
        print(f"[scout] No discovered_candidates.json. Run: python discover_traders.py first.")
        return 1

    try:
        payload = json.loads(candidates_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[error] Could not read discovered_candidates.json: {e}")
        return 1

    recommended = payload.get("recommended") or []
    max_new = args.max_new or 10

    if not recommended:
        print("[scout] No recommended candidates in discovered_candidates.json")
        return 0

    data = load_extra()
    existing_wallets = {str(r.get("wallet") or "").lower() for r in data}

    new_scouts: list[dict] = []
    print(f"\n=== SCOUT CANDIDATES (top {max_new}) ===")
    for r in recommended[:max_new]:
        wallet = str(r.get("wallet") or "").lower()
        username = str(r.get("username") or "")
        score = r.get("screen_score") or 0
        hold_roi = r.get("sample_hold_roi") or r.get("sample_roi") or 0
        pnl = r.get("best_pnl") or 0
        windows = r.get("windows") or []
        n_res = r.get("sample_resolved_n") or r.get("sample_closed_rows") or 0
        bias = r.get("closed_only_bias") or 0

        already = wallet in existing_wallets
        flag = " [ALREADY IN ROSTER]" if already else ""

        why_tail = (
            f"Scout {today_iso()}: Qscreen={score:.0f}, hold_roi={hold_roi:.1f}%, "
            f"LB_pnl=${pnl:,.0f}, n={n_res}, bias={bias:+.0f}, windows={','.join(windows)}"
        )

        print(f"  {username:<24} Qscreen={score:>5.1f}  ROI={hold_roi:>6.1f}%  PnL=${pnl:>10,.0f}  n={n_res:<4}{flag}")

        if not already:
            new_scouts.append({
                "wallet": wallet,
                "username": username,
                "source": "sports_leaderboard_scout",
                "status": "scout",
                "why_tail": why_tail,
                "add_date": today_iso(),
                "updated_at": now_iso(),
                "screen_score": score,
                "sample_hold_roi": hold_roi,
                "notes": "",
                "history": [{
                    "action": "scout_add",
                    "timestamp": now_iso(),
                    "reason": why_tail,
                }],
            })

    if not args.write:
        if new_scouts:
            print(f"\n{len(new_scouts)} new candidates. Use --write to add them as scouts.")
        return 0

    if new_scouts:
        data.extend(new_scouts)
        save_extra(data)
        print(f"[scout] Added {len(new_scouts)} new scouts to roster.")

    return 0


def cmd_auto(args: argparse.Namespace) -> int:
    """Apply promote/demote/bench from activity + equity (auto_promote.py)."""
    from auto_promote import apply_promotions

    payload = apply_promotions(dry_run=bool(args.dry_run))
    c = payload.get("counts") or {}
    print(
        f"[roster auto] promoted={c.get('promoted')} demoted={c.get('demoted')} "
        f"benched={c.get('benched')} watched={c.get('watched')}"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Manage the live copy roster without code changes",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # add
    p_add = subparsers.add_parser("add", help="Add a trader to the roster")
    p_add.add_argument("wallet", help="Trader wallet address (0x...)")
    p_add.add_argument("username", help="Trader username")
    p_add.add_argument("--status", default="watch", help="Initial status (default: watch)")
    p_add.add_argument("--why", help="Why we're tailing this trader (one-line reason)")
    p_add.add_argument("--source", default="manual", help="Discovery source")
    p_add.add_argument("--notes", help="Additional notes")

    # kick
    p_kick = subparsers.add_parser("kick", help="Kick a trader from the roster")
    p_kick.add_argument("wallet", help="Trader wallet address")
    p_kick.add_argument("--reason", required=True, help="Reason for kicking (required)")

    # bench
    p_bench = subparsers.add_parser("bench", help="Bench a stale trader")
    p_bench.add_argument("wallet", help="Trader wallet address")
    p_bench.add_argument("--reason", help="Reason for benching")

    # remove
    p_remove = subparsers.add_parser("remove", help="Remove a trader from the roster")
    p_remove.add_argument("wallet", help="Trader wallet address")
    p_remove.add_argument("--reason", help="Reason for removal")

    # promote
    p_promote = subparsers.add_parser("promote", help="Promote a trader to take_book")
    p_promote.add_argument("wallet", help="Trader wallet address")
    p_promote.add_argument("--reason", help="Reason for promotion")
    p_promote.add_argument("--force", action="store_true", help="Skip elite gate validation")

    # list
    p_list = subparsers.add_parser("list", help="List traders by status")
    p_list.add_argument("--status", help="Filter by status")
    p_list.add_argument("--verbose", "-v", action="store_true", help="Show why_tail reasons")

    # stale
    p_stale = subparsers.add_parser("stale", help="Auto-bench stale traders")
    p_stale.add_argument("--days", type=int, default=STALE_DAYS_DEFAULT, help=f"Days threshold (default: {STALE_DAYS_DEFAULT})")
    p_stale.add_argument("--apply", action="store_true", help="Actually bench the stale traders")

    # scout
    p_scout = subparsers.add_parser("scout", help="Show scout candidates")
    p_scout.add_argument("--max-new", type=int, default=10, help="Max candidates to show")
    p_scout.add_argument("--write", action="store_true", help="Add candidates to roster as scouts")

    p_auto = subparsers.add_parser("auto", help="Apply activity+equity promote/demote")
    p_auto.add_argument("--dry-run", action="store_true", help="Do not write extra_traders.json")

    args = parser.parse_args()

    commands = {
        "add": cmd_add,
        "kick": cmd_kick,
        "bench": cmd_bench,
        "remove": cmd_remove,
        "promote": cmd_promote,
        "list": cmd_list,
        "stale": cmd_stale,
        "scout": cmd_scout,
        "auto": cmd_auto,
    }

    return commands[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
