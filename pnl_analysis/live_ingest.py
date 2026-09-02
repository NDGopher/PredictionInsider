#!/usr/bin/env python3
"""Incremental Polymarket activity/trades ingest → Postgres desk tape.

FAST path: each wallet remembers last_seen_unix. We page newest-first until we
hit that cursor (or a 90-day backfill on first run). Desk load and the
scheduled loop call this; they do not re-parse trader CSVs.

Usage:
  python pnl_analysis/live_ingest.py
  python pnl_analysis/live_ingest.py --copy-focus
  python pnl_analysis/live_ingest.py --username HVAB
  python pnl_analysis/live_ingest.py --add 20D6
"""
from __future__ import annotations

import argparse
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from desk_db import (  # noqa: E402
    connect,
    ensure_schema,
    fetch_fills,
    fetch_markets_map,
    fetch_unique_books,
    finish_run,
    get_cursor,
    ingest_status,
    missing_market_ids,
    replace_unique_books,
    save_cursor,
    start_run,
    upsert_fills,
    upsert_markets,
    upsert_wallet,
)
from desk_tape import activity_to_fill, parse_gamma_market, unique_books_from_fills  # noqa: E402
from trader_display import english_name  # noqa: E402
from wallet_resolve import (  # noqa: E402
    normalize_wallet,
    resolve_targets,
    resolve_username,
)

DATA = "https://data-api.polymarket.com"
GAMMA = "https://gamma-api.polymarket.com"
PAGE = 500
TRADES_PAGE = 1000
SLEEP = 0.25
BACKFILL_DAYS = 90
MAX_PAGES_FIRST = 12
MAX_PAGES_INCR = 4


def _sleep() -> None:
    time.sleep(SLEEP + random.uniform(0.0, 0.15))


def _get(url: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    for attempt in range(5):
        try:
            r = requests.get(url, params=params, timeout=30)
        except requests.RequestException as exc:
            if attempt == 4:
                print(f"  [ingest] {url} {exc}")
                return []
            time.sleep(min(12.0, (2**attempt) + 0.4))
            continue
        if r.status_code == 200:
            try:
                data = r.json()
            except Exception:
                return []
            return data if isinstance(data, list) else []
        if r.status_code == 400:
            return []
        if r.status_code in (429, 502, 503) and attempt < 4:
            time.sleep(min(12.0, (2**attempt) + 0.5))
            continue
        print(f"  [ingest] HTTP {r.status_code} {url}")
        return []
    return []


def fetch_activity_incremental(wallet: str, *, since_unix: int | None, first: bool) -> list[dict[str, Any]]:
    """Newest-first activity pages. Stop at last-seen cursor or backfill horizon."""
    out: list[dict[str, Any]] = []
    end_ts: int | None = None
    floor = since_unix
    if floor is None:
        floor = int((datetime.now(timezone.utc) - timedelta(days=BACKFILL_DAYS)).timestamp())
    max_pages = MAX_PAGES_FIRST if first else MAX_PAGES_INCR
    for page in range(max_pages):
        params: dict[str, Any] = {
            "user": wallet,
            "limit": PAGE,
            "sortBy": "TIMESTAMP",
            "sortDirection": "DESC",
        }
        if end_ts is not None:
            params["end"] = end_ts
        batch = _get(f"{DATA}/activity", params)
        _sleep()
        if not batch:
            break
        hit_floor = False
        for ev in batch:
            ts = ev.get("timestamp") or 0
            try:
                ts_n = int(float(ts))
            except (TypeError, ValueError):
                continue
            if ts_n > 10_000_000_000:
                ts_n = ts_n // 1000
            if since_unix is not None and ts_n <= since_unix:
                hit_floor = True
                break
            if floor is not None and ts_n < floor and since_unix is None:
                hit_floor = True
                break
            out.append(ev)
        if hit_floor or len(batch) < PAGE:
            break
        oldest = min(int(float(b.get("timestamp") or 0)) for b in batch)
        if oldest > 10_000_000_000:
            oldest = oldest // 1000
        end_ts = oldest - 1
        if page == max_pages - 1:
            print(f"    activity page cap {max_pages} for {wallet[:10]}… ({len(out)} rows)")
    return out


def fetch_trades_incremental(wallet: str, *, since_unix: int | None) -> list[dict[str, Any]]:
    """Newest trades page(s). Offset 0 is recent; stop once we pass the cursor."""
    out: list[dict[str, Any]] = []
    offset = 0
    max_pages = MAX_PAGES_INCR if since_unix else min(MAX_PAGES_FIRST, 6)
    for _ in range(max_pages):
        batch = _get(
            f"{DATA}/trades",
            {"user": wallet, "limit": TRADES_PAGE, "offset": offset, "takerOnly": "false"},
        )
        _sleep()
        if not batch:
            break
        hit = False
        for ev in batch:
            ts = ev.get("timestamp") or ev.get("matchTime") or 0
            try:
                ts_n = int(float(ts))
            except (TypeError, ValueError):
                continue
            if ts_n > 10_000_000_000:
                ts_n = ts_n // 1000
            if since_unix is not None and ts_n <= since_unix:
                hit = True
                break
            ev = dict(ev)
            ev.setdefault("type", "TRADE")
            ev["timestamp"] = ts_n
            out.append(ev)
        if hit or len(batch) < TRADES_PAGE:
            break
        offset += TRADES_PAGE
    return out


def fetch_closed_resolution(wallet: str, *, since_unix: int | None, deep: bool = False) -> list[dict[str, Any]]:
    """Incremental closed-positions for resolution/end-date only — not a CSV dump."""
    out: list[dict[str, Any]] = []
    offset = 0
    if deep:
        max_pages = 40
    elif since_unix:
        max_pages = 4
    else:
        max_pages = 8
    for _ in range(max_pages):
        batch = _get(
            f"{DATA}/closed-positions",
            {
                "user": wallet,
                "limit": 50,
                "offset": offset,
                "sortBy": "TIMESTAMP",
                "sortDirection": "DESC",
            },
        )
        _sleep()
        if not batch:
            break
        hit = False
        for ev in batch:
            ts = ev.get("timestamp") or 0
            try:
                ts_n = int(float(ts))
            except (TypeError, ValueError):
                ts_n = 0
            if ts_n > 10_000_000_000:
                ts_n = ts_n // 1000
            if since_unix is not None and ts_n and ts_n <= since_unix:
                hit = True
                break
            cur = _safe_float(ev.get("curPrice") or ev.get("cur_price"))
            outcome_name = str(ev.get("outcome") or "").strip()
            opposite = str(ev.get("oppositeOutcome") or ev.get("opposite_outcome") or "").strip()
            winning = None
            if cur is not None and cur >= 0.99 and outcome_name:
                winning = outcome_name
            elif cur is not None and cur <= 0.01:
                winning = opposite or _outcome_yes_no_flip(outcome_name)
            parsed = {
                "condition_id": str(ev.get("conditionId") or ev.get("condition_id") or ""),
                "title": str(ev.get("title") or ""),
                "slug": str(ev.get("slug") or ""),
                "event_slug": str(ev.get("eventSlug") or ev.get("event_slug") or ""),
                "end_date": ev.get("endDate") or ev.get("end_date"),
                "closed": winning is not None,
                "winning_outcome": winning,
                "outcome_prices": None,
                "sport": "",
                "market_type": "",
            }
            if parsed["condition_id"] and winning:
                out.append(parsed)
        if hit or len(batch) < 50:
            break
        offset += 50
    return out


def _safe_float(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _outcome_yes_no(value: Any) -> str | None:
    s = str(value or "").strip().lower()
    if s == "yes":
        return "Yes"
    if s == "no":
        return "No"
    return None


def _outcome_yes_no_flip(value: Any) -> str | None:
    s = _outcome_yes_no(value)
    if s == "Yes":
        return "No"
    if s == "No":
        return "Yes"
    return None


def fetch_gamma_markets(condition_ids: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for cid in condition_ids:
        if not cid:
            continue
        batch = _get(f"{GAMMA}/markets", {"condition_id": cid, "limit": 5})
        _sleep()
        if not batch:
            # some gateways want conditionId
            batch = _get(f"{GAMMA}/markets", {"conditionId": cid, "limit": 5})
            _sleep()
        if not batch:
            continue
        for raw in batch:
            parsed = parse_gamma_market(raw) if isinstance(raw, dict) else None
            if parsed:
                out.append(parsed)
    return out


def _newest_unix(fills: list[dict[str, Any]]) -> int | None:
    vals: list[int] = []
    for f in fills:
        try:
            vals.append(int(float(f.get("timestamp") or f.get("event_timestamp") or 0)))
        except (TypeError, ValueError):
            continue
    return max(vals) if vals else None


def ingest_wallet(conn: Any, rec: dict[str, Any]) -> dict[str, Any]:
    username = str(rec.get("username") or "")
    wallet = str(rec.get("wallet") or "").lower()
    display = str(rec.get("display_name") or english_name(username, wallet))
    cur = get_cursor(conn, wallet)
    since = int(cur["last_seen_unix"]) if cur and cur.get("last_seen_unix") else None
    first = since is None
    print(f"  {display:<22} {wallet[:12]}… cursor={since or 'backfill90d'}")
    try:
        activity = fetch_activity_incremental(wallet, since_unix=since, first=first)
        trades = fetch_trades_incremental(wallet, since_unix=since)
    except Exception as exc:
        save_cursor(conn, {
            "wallet": wallet,
            "username": username,
            "last_ok": False,
            "last_error": str(exc),
            "fills_inserted": 0,
            "source": "activity",
        })
        return {"wallet": wallet, "username": username, "ok": False, "error": str(exc), "inserted": 0}

    fills: list[dict[str, Any]] = []
    for ev in activity:
        row = activity_to_fill(ev, username=username, wallet=wallet, source="activity")
        if row:
            fills.append(row)
    for ev in trades:
        row = activity_to_fill(ev, username=username, wallet=wallet, source="trades")
        if row:
            fills.append(row)
    inserted = upsert_fills(conn, fills)
    try:
        # Resolution overlay from newest closed-positions (winners and losers).
        # Deep page on a thin book so as-of warmup can run; incremental stays short.
        existing = [b for b in fetch_unique_books(conn, [wallet]) if b.get("resolved")]
        upsert_markets(
            conn,
            fetch_closed_resolution(wallet, since_unix=None, deep=len(existing) < 40),
        )
    except Exception as exc:
        print(f"    closed-positions resolution skipped: {exc}")
    newest = _newest_unix(fills)
    save_cursor(conn, {
        "wallet": wallet,
        "username": username,
        "last_seen_ts": newest,
        "last_seen_unix": newest,
        "last_ok": True,
        "last_error": None,
        "fills_inserted": inserted,
        "source": "activity+trades",
    })

    all_fills = fetch_fills(conn, wallet)
    cids = list({str(f.get("condition_id") or "") for f in all_fills if f.get("condition_id")})
    redeem_cids = {
        str(f.get("condition_id") or "")
        for f in all_fills
        if str(f.get("event_type") or "").upper() == "REDEEM" and f.get("condition_id")
    }
    newest_trade = sorted(
        [f for f in all_fills if str(f.get("event_type") or "TRADE").upper() == "TRADE"],
        key=lambda r: float(r.get("timestamp") or 0),
        reverse=True,
    )
    recent_cids: list[str] = []
    for f in newest_trade:
        cid = str(f.get("condition_id") or "")
        if cid and cid not in recent_cids:
            recent_cids.append(cid)
        if len(recent_cids) >= 20:
            break
    priority = [c for c in list(redeem_cids) + recent_cids if c]
    need = missing_market_ids(conn, priority)
    if need:
        # Cap metadata fetch per run so desk load stays seconds, not a CSV re-download.
        upsert_markets(conn, fetch_gamma_markets(need[:24]))
    markets = fetch_markets_map(conn, cids)
    books = unique_books_from_fills(all_fills, markets, username=username, wallet=wallet)
    n_books = replace_unique_books(conn, wallet, books)
    resolved_n = sum(1 for b in books if b.get("resolved"))
    print(
        f"    +{inserted} fills (page {len(fills)}) unique_books={n_books} "
        f"resolved={resolved_n}"
    )
    return {
        "wallet": wallet,
        "username": username,
        "display_name": display,
        "ok": True,
        "inserted": inserted,
        "books": n_books,
        "resolved_books": resolved_n,
    }


def add_username(name: str, *, status: str = "watch") -> dict[str, Any]:
    """Resolve a username, persist wallet, ingest. Used to add a trader by handle."""
    rec = resolve_username(name)
    with connect() as conn:
        ensure_schema(conn)
        upsert_wallet(conn, rec)
        if rec.get("resolved") and rec.get("wallet"):
            ingest_wallet(conn, rec)
    if rec.get("resolved") and rec.get("wallet"):
        # Keep extra_traders in sync so copy_roster sees them.
        try:
            from roster_manage import add_trader
            add_trader(str(rec["wallet"]), rec.get("username") or name, status=status, why=f"live_ingest --add {name}")
        except Exception as exc:
            print(f"[ingest] roster add skipped: {exc}")
    return rec


def run(*, usernames: list[str], copy_focus: bool, add: str | None) -> dict[str, Any]:
    if add:
        rec = add_username(add)
        print(
            f"[ingest] add {rec.get('display_name')}: "
            f"{'resolved '+rec.get('wallet','') if rec.get('resolved') else rec.get('unresolved_reason')}"
        )
        return {"added": rec}

    names = list(usernames)
    resolved, unresolved = resolve_targets(names if names else None)
    if not copy_focus and names:
        # Only the named traders
        resolved = [r for r in resolved if r.get("username") in names or r.get("display_name") in names]
        extra_unres = [u for u in unresolved if u.get("username") in names]
        unresolved = extra_unres

    with connect() as conn:
        ensure_schema(conn)
        run_id = start_run(conn)
        inserted = 0
        ok_n = 0
        err: str | None = None
        try:
            for rec in unresolved:
                upsert_wallet(conn, rec)
                print(f"  UNRESOLVED {rec.get('display_name') or rec.get('username')}: {rec.get('unresolved_reason')}")
            for rec in resolved:
                upsert_wallet(conn, rec)
                result = ingest_wallet(conn, rec)
                if result.get("ok"):
                    ok_n += 1
                    inserted += int(result.get("inserted") or 0)
            finish_run(
                conn,
                run_id,
                ok=True,
                wallets_ok=ok_n,
                wallets_unresolved=len(unresolved),
                fills_inserted=inserted,
            )
            status = ingest_status(conn)
        except Exception as exc:
            err = str(exc)
            finish_run(
                conn,
                run_id,
                ok=False,
                wallets_ok=ok_n,
                wallets_unresolved=len(unresolved),
                fills_inserted=inserted,
                error=err,
            )
            raise
    print(
        f"[ingest] ok={ok_n} unresolved={len(unresolved)} new_fills={inserted} "
        f"source=postgres last={status.get('last_fetch_at')}"
    )
    return {
        "ok": err is None,
        "wallets_ok": ok_n,
        "unresolved": [
            {
                "username": u.get("username"),
                "display_name": u.get("display_name"),
                "why": u.get("unresolved_reason"),
            }
            for u in unresolved
        ],
        "fills_inserted": inserted,
        "status": status,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Incremental desk tape ingest")
    parser.add_argument("--copy-focus", action="store_true", help="Live/watch/scout/bench only (default)")
    parser.add_argument("--username", action="append", default=[], help="Also ingest this username")
    parser.add_argument("--add", type=str, default="", help="Resolve + add a new trader by username")
    args = parser.parse_args()
    try:
        run(usernames=args.username, copy_focus=True, add=args.add or None)
    except RuntimeError as exc:
        print(f"[ingest] BLOCKED {exc}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
