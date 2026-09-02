#!/usr/bin/env python3
"""Postgres access for the copy-desk live tape.

Trader CSVs are not the source of truth. Fills, wallets, cursors, and
unique books live in desk_* tables (see scripts/init-db.sql).
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Sequence

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
SCHEMA_SQL = Path(__file__).resolve().parent / "desk_schema.sql"


def load_database_url() -> str | None:
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if url:
        return url
    if ENV_PATH.exists():
        try:
            for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
                raw = line.strip()
                if not raw or raw.startswith("#") or "=" not in raw:
                    continue
                key, val = raw.split("=", 1)
                if key.strip() == "DATABASE_URL":
                    return val.strip().strip("'").strip('"')
        except OSError:
            return None
    return None


def _connect(url: str):
    try:
        import psycopg2  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "psycopg2 is required for the desk tape. pip install psycopg2-binary"
        ) from exc
    return psycopg2.connect(url)


@contextmanager
def connect(*, require: bool = True) -> Iterator[Any]:
    url = load_database_url()
    if not url:
        if require:
            raise RuntimeError(
                "DATABASE_URL is required. Copy .env.example to .env and start Postgres "
                "(npm run db:up && npm run db:init)."
            )
        yield None
        return
    conn = _connect(url)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def db_available() -> bool:
    try:
        with connect(require=True) as conn:
            if conn is None:
                return False
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
            return True
    except Exception:
        return False


def ensure_schema(conn: Any) -> None:
    """Idempotent CREATE for desk_* tables so ingest works before npm run db:init."""
    sql_path = ROOT / "scripts" / "init-db.sql"
    text = sql_path.read_text(encoding="utf-8")
    marker = "-- ── Copy-desk live tape"
    chunk = text[text.find(marker):] if marker in text else ""
    if not chunk:
        return
    with conn.cursor() as cur:
        cur.execute(chunk)


def _ts(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    try:
        raw = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def upsert_wallet(conn: Any, row: dict[str, Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO desk_wallets
              (username, display_name, wallet, eoa_wallet, source, resolved,
               unresolved_reason, last_resolved_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NOW())
            ON CONFLICT (username) DO UPDATE SET
              display_name = EXCLUDED.display_name,
              wallet = EXCLUDED.wallet,
              eoa_wallet = COALESCE(EXCLUDED.eoa_wallet, desk_wallets.eoa_wallet),
              source = EXCLUDED.source,
              resolved = EXCLUDED.resolved,
              unresolved_reason = EXCLUDED.unresolved_reason,
              last_resolved_at = EXCLUDED.last_resolved_at,
              updated_at = NOW()
            """,
            (
                str(row.get("username") or ""),
                str(row.get("display_name") or row.get("username") or ""),
                (str(row.get("wallet") or "").lower() or None),
                (str(row.get("eoa_wallet") or "").lower() or None),
                str(row.get("source") or ""),
                bool(row.get("resolved")),
                row.get("unresolved_reason"),
                _ts(row.get("last_resolved_at")) or datetime.now(timezone.utc),
            ),
        )


def list_unresolved(conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT username, display_name, unresolved_reason, source, updated_at
            FROM desk_wallets
            WHERE resolved IS NOT TRUE
            ORDER BY username
            """
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def get_cursor(conn: Any, wallet: str) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM desk_ingest_cursors WHERE wallet = %s",
            (wallet.lower(),),
        )
        row = cur.fetchone()
        if not row:
            return None
        cols = [d[0] for d in cur.description]
        return dict(zip(cols, row))


def save_cursor(conn: Any, row: dict[str, Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO desk_ingest_cursors
              (wallet, username, last_seen_ts, last_seen_unix, last_fetch_at,
               last_ok, last_error, fills_inserted, source)
            VALUES (%s,%s,%s,%s,NOW(),%s,%s,%s,%s)
            ON CONFLICT (wallet) DO UPDATE SET
              username = EXCLUDED.username,
              last_seen_ts = COALESCE(EXCLUDED.last_seen_ts, desk_ingest_cursors.last_seen_ts),
              last_seen_unix = GREATEST(
                COALESCE(EXCLUDED.last_seen_unix, 0),
                COALESCE(desk_ingest_cursors.last_seen_unix, 0)
              ),
              last_fetch_at = NOW(),
              last_ok = EXCLUDED.last_ok,
              last_error = EXCLUDED.last_error,
              fills_inserted = desk_ingest_cursors.fills_inserted + EXCLUDED.fills_inserted,
              source = EXCLUDED.source
            """,
            (
                str(row["wallet"]).lower(),
                str(row.get("username") or ""),
                _ts(row.get("last_seen_ts")),
                int(row["last_seen_unix"]) if row.get("last_seen_unix") is not None else None,
                bool(row.get("last_ok", True)),
                row.get("last_error"),
                int(row.get("fills_inserted") or 0),
                str(row.get("source") or "activity"),
            ),
        )


def upsert_fills(conn: Any, fills: Sequence[dict[str, Any]]) -> int:
    if not fills:
        return 0
    inserted = 0
    sql = """
        INSERT INTO desk_fills (
          wallet, event_timestamp, condition_id, side, price, size, transaction_hash,
          username, market_id, asset, outcome, title, slug, event_slug,
          usdc_size, event_type, sport, market_type, source
        ) VALUES (
          %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s
        )
        ON CONFLICT (wallet, event_timestamp, condition_id, side, price, size, transaction_hash)
        DO NOTHING
    """
    with conn.cursor() as cur:
        for f in fills:
            ts = _ts(f.get("event_timestamp") or f.get("timestamp"))
            if ts is None or not f.get("wallet") or not f.get("condition_id"):
                continue
            cur.execute(
                sql,
                (
                    str(f["wallet"]).lower(),
                    ts,
                    str(f.get("condition_id") or ""),
                    str(f.get("side") or ""),
                    round(float(f.get("price") or 0.0), 8),
                    round(float(f.get("size") or 0.0), 8),
                    str(f.get("transaction_hash") or ""),
                    str(f.get("username") or ""),
                    str(f.get("market_id") or ""),
                    str(f.get("asset") or ""),
                    str(f.get("outcome") or ""),
                    str(f.get("title") or "")[:500],
                    str(f.get("slug") or ""),
                    str(f.get("event_slug") or ""),
                    float(f.get("usdc_size") or 0.0),
                    str(f.get("event_type") or "TRADE"),
                    str(f.get("sport") or ""),
                    str(f.get("market_type") or ""),
                    str(f.get("source") or "activity"),
                ),
            )
            inserted += cur.rowcount or 0
    return inserted


def upsert_markets(conn: Any, markets: Sequence[dict[str, Any]]) -> int:
    if not markets:
        return 0
    n = 0
    sql = """
        INSERT INTO desk_markets (
          condition_id, title, slug, event_slug, end_date, closed,
          winning_outcome, outcome_prices, sport, market_type, updated_at
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
        ON CONFLICT (condition_id) DO UPDATE SET
          title = COALESCE(NULLIF(EXCLUDED.title, ''), desk_markets.title),
          slug = COALESCE(NULLIF(EXCLUDED.slug, ''), desk_markets.slug),
          event_slug = COALESCE(NULLIF(EXCLUDED.event_slug, ''), desk_markets.event_slug),
          end_date = COALESCE(EXCLUDED.end_date, desk_markets.end_date),
          closed = EXCLUDED.closed OR desk_markets.closed,
          winning_outcome = COALESCE(EXCLUDED.winning_outcome, desk_markets.winning_outcome),
          outcome_prices = COALESCE(EXCLUDED.outcome_prices, desk_markets.outcome_prices),
          sport = COALESCE(NULLIF(EXCLUDED.sport, ''), desk_markets.sport),
          market_type = COALESCE(NULLIF(EXCLUDED.market_type, ''), desk_markets.market_type),
          updated_at = NOW()
    """
    with conn.cursor() as cur:
        for m in markets:
            cid = str(m.get("condition_id") or "")
            if not cid:
                continue
            cur.execute(
                sql,
                (
                    cid,
                    str(m.get("title") or "")[:500],
                    str(m.get("slug") or ""),
                    str(m.get("event_slug") or ""),
                    _ts(m.get("end_date")),
                    bool(m.get("closed")),
                    m.get("winning_outcome"),
                    m.get("outcome_prices"),
                    str(m.get("sport") or ""),
                    str(m.get("market_type") or ""),
                ),
            )
            n += 1
    return n


def missing_market_ids(conn: Any, condition_ids: Sequence[str]) -> list[str]:
    ids = [c for c in {str(c) for c in condition_ids} if c]
    if not ids:
        return []
    with conn.cursor() as cur:
        cur.execute(
            "SELECT condition_id FROM desk_markets WHERE condition_id = ANY(%s)",
            (list(ids),),
        )
        have = {r[0] for r in cur.fetchall()}
    return [c for c in ids if c not in have]


def replace_unique_books(conn: Any, wallet: str, books: Sequence[dict[str, Any]]) -> int:
    w = wallet.lower()
    with conn.cursor() as cur:
        cur.execute("DELETE FROM desk_unique_books WHERE wallet = %s", (w,))
        n = 0
        for b in books:
            cur.execute(
                """
                INSERT INTO desk_unique_books (
                  wallet, condition_id, outcome, username, title, slug, event_slug,
                  sport, market_type, submarket, entry_price, cost, size, won,
                  resolved, end_date, first_fill_at, last_fill_at, fill_count,
                  hold_pnl, updated_at
                ) VALUES (
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW()
                )
                """,
                (
                    w,
                    str(b.get("condition_id") or ""),
                    str(b.get("outcome") or ""),
                    str(b.get("username") or ""),
                    str(b.get("title") or "")[:500],
                    str(b.get("slug") or ""),
                    str(b.get("event_slug") or ""),
                    str(b.get("sport") or ""),
                    str(b.get("market_type") or ""),
                    str(b.get("submarket") or ""),
                    float(b.get("entry_price") or 0.0),
                    float(b.get("cost") or 0.0),
                    float(b.get("size") or 0.0),
                    b.get("won"),
                    bool(b.get("resolved")),
                    _ts(b.get("end_date") or b.get("end_dt")),
                    _ts(b.get("first_fill_at")),
                    _ts(b.get("last_fill_at")),
                    int(b.get("fill_count") or 0),
                    b.get("hold_pnl"),
                ),
            )
            n += 1
    return n


def fetch_fills(conn: Any, wallet: str) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT * FROM desk_fills
            WHERE wallet = %s
            ORDER BY event_timestamp ASC
            """,
            (wallet.lower(),),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def fetch_markets_map(conn: Any, condition_ids: Sequence[str] | None = None) -> dict[str, dict[str, Any]]:
    with conn.cursor() as cur:
        if condition_ids:
            cur.execute(
                "SELECT * FROM desk_markets WHERE condition_id = ANY(%s)",
                (list(condition_ids),),
            )
        else:
            cur.execute("SELECT * FROM desk_markets")
        cols = [d[0] for d in cur.description]
        return {str(r[cols.index("condition_id")]): dict(zip(cols, r)) for r in cur.fetchall()}


def fetch_unique_books(conn: Any, wallets: Sequence[str] | None = None) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        if wallets:
            cur.execute(
                """
                SELECT * FROM desk_unique_books
                WHERE wallet = ANY(%s)
                ORDER BY end_date ASC NULLS LAST
                """,
                ([w.lower() for w in wallets],),
            )
        else:
            cur.execute("SELECT * FROM desk_unique_books ORDER BY end_date ASC NULLS LAST")
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def wallet_stats(conn: Any, wallet: str) -> dict[str, Any]:
    w = wallet.lower()
    now = datetime.now(timezone.utc)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              COUNT(*) FILTER (WHERE resolved) AS closed,
              COUNT(*) FILTER (
                WHERE resolved AND end_date >= NOW() - INTERVAL '30 days'
              ) AS last_30d_n,
              COUNT(*) FILTER (
                WHERE resolved AND end_date >= NOW() - INTERVAL '60 days'
              ) AS last_60d_n,
              AVG(hold_pnl) FILTER (WHERE resolved) AS avg_hold,
              SUM(hold_pnl) FILTER (WHERE resolved) AS sum_hold,
              SUM(cost) FILTER (WHERE resolved) AS sum_cost,
              SUM(hold_pnl) FILTER (
                WHERE resolved AND end_date >= NOW() - INTERVAL '30 days'
              ) AS sum_hold_30,
              SUM(cost) FILTER (
                WHERE resolved AND end_date >= NOW() - INTERVAL '30 days'
              ) AS sum_cost_30,
              SUM(hold_pnl) FILTER (
                WHERE resolved AND end_date >= NOW() - INTERVAL '60 days'
              ) AS sum_hold_60,
              SUM(cost) FILTER (
                WHERE resolved AND end_date >= NOW() - INTERVAL '60 days'
              ) AS sum_cost_60,
              AVG(CASE WHEN resolved AND won THEN 1.0 WHEN resolved THEN 0.0 END) AS win_rate,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cost)
                FILTER (WHERE resolved) AS median_stake,
              MAX(end_date) FILTER (WHERE resolved) AS last_event,
              COUNT(*) FILTER (WHERE resolved AND won) AS wins
            FROM desk_unique_books
            WHERE wallet = %s
            """,
            (w,),
        )
        cols = [d[0] for d in cur.description]
        row = dict(zip(cols, cur.fetchone() or []))
    sum_cost = float(row.get("sum_cost") or 0.0)
    sum_hold = float(row.get("sum_hold") or 0.0)
    sum_cost_30 = float(row.get("sum_cost_30") or 0.0)
    sum_hold_30 = float(row.get("sum_hold_30") or 0.0)
    sum_cost_60 = float(row.get("sum_cost_60") or 0.0)
    sum_hold_60 = float(row.get("sum_hold_60") or 0.0)
    last = row.get("last_event")
    days = None
    if last is not None:
        if getattr(last, "tzinfo", None) is None:
            last = last.replace(tzinfo=timezone.utc)
        days = max(0, int((now - last).total_seconds() // 86400))
    wr = row.get("win_rate")
    return {
        "closed": int(row.get("closed") or 0),
        "last_30d_n": int(row.get("last_30d_n") or 0),
        "last_60d_n": int(row.get("last_60d_n") or 0),
        "unique_roi": round(sum_hold / sum_cost * 100.0, 2) if sum_cost > 0 else None,
        "last_30d_roi": round(sum_hold_30 / sum_cost_30 * 100.0, 2) if sum_cost_30 > 0 else None,
        "last_60d_roi": round(sum_hold_60 / sum_cost_60 * 100.0, 2) if sum_cost_60 > 0 else None,
        "win_rate": round(float(wr) * 100.0, 2) if wr is not None else None,
        "median_stake": float(row.get("median_stake") or 0.0),
        "last_event_date": last.date().isoformat() if last is not None else None,
        "days_since_last": days,
        "wins": int(row.get("wins") or 0),
        "tape_source": "postgres",
    }


def monthly_pnl(conn: Any, wallet: str) -> dict[str, float]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT to_char(end_date AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
                   SUM(hold_pnl) AS pnl
            FROM desk_unique_books
            WHERE wallet = %s AND resolved AND end_date IS NOT NULL
            GROUP BY 1
            ORDER BY 1
            """,
            (wallet.lower(),),
        )
        return {str(m): float(p or 0.0) for m, p in cur.fetchall() if m}


def ingest_status(conn: Any) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM desk_fills")
        fills = int(cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM desk_wallets WHERE resolved")
        resolved = int(cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM desk_wallets WHERE resolved IS NOT TRUE")
        unresolved = int(cur.fetchone()[0])
        cur.execute("SELECT MAX(last_fetch_at) FROM desk_ingest_cursors")
        last = cur.fetchone()[0]
        cur.execute(
            """
            SELECT id, started_at, finished_at, ok, wallets_ok, wallets_unresolved,
                   fills_inserted, error
            FROM desk_ingest_runs
            ORDER BY id DESC
            LIMIT 1
            """
        )
        run = cur.fetchone()
        run_cols = [d[0] for d in cur.description] if cur.description else []
    return {
        "source": "postgres",
        "fills": fills,
        "wallets_resolved": resolved,
        "wallets_unresolved": unresolved,
        "last_fetch_at": last.isoformat() if last else None,
        "last_run": dict(zip(run_cols, run)) if run else None,
    }


def start_run(conn: Any) -> int:
    with conn.cursor() as cur:
        cur.execute("INSERT INTO desk_ingest_runs DEFAULT VALUES RETURNING id")
        return int(cur.fetchone()[0])


def finish_run(conn: Any, run_id: int, **kwargs: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE desk_ingest_runs
            SET finished_at = NOW(),
                ok = %s,
                wallets_ok = %s,
                wallets_unresolved = %s,
                fills_inserted = %s,
                error = %s
            WHERE id = %s
            """,
            (
                kwargs.get("ok"),
                int(kwargs.get("wallets_ok") or 0),
                int(kwargs.get("wallets_unresolved") or 0),
                int(kwargs.get("fills_inserted") or 0),
                kwargs.get("error"),
                run_id,
            ),
        )
