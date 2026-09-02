#!/usr/bin/env python3
"""Copy-universe rules: who we fetch, who we copy, who we ignore.

Mega/high-frequency books (100k+ Polydata trades or 50k+ CSV rows) are not
copyable at $100 and are skipped by the daily pipeline so we spend the
refresh budget on joinable sports books.

Copy-focus (daily refresh): live + bench + watch + scout. Skip/kicked/reference
stay on disk but are not re-fetched.

Status values from extra_traders.json:
  take_book  - On the live Telegram alert list (must pass elite gates)
  watch      - Tracked, books refreshed, not on live alerts
  benched    - Was live or watch, auto-benched for staleness (90+ days)
  scout      - Discovered candidate, needs vetting (refreshed)
  kicked     - Removed from roster (reason required)
  removed    - Manually removed by operator

Writes: pnl_analysis/output/copy_universe.json
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output"
RANKS_PATH = OUTPUT_DIR / "insider_ranks.json"
TRUSTED_PATH = OUTPUT_DIR / "trusted_full_books.json"
EXTRA_PATH = ROOT / "extra_traders.json"
OUT_PATH = OUTPUT_DIR / "copy_universe.json"

# Polydata "trades" is fills. Hundreds of thousands = bot / uncopyable tape.
PD_TRADES_BOT = 100_000
CSV_ROWS_BOT = 50_000
CLOSED_MIN = 40
CLOSED_MAX_COPY = 12_000
MEDIAN_JOIN_MAX = 15_000.0
WR_LO = 48.0
WR_HI = 75.0
LIVE_RECENCY = {"HOT", "WARM"}
STALE_BENCH_DAYS = 90

# Reasons that mean "do not fetch / do not copy" vs size that is just unjoinable.
HARD_REASON_PREFIXES = (
    "hard_skip",
    "extra_kicked",
    "lane_kicked",
    "pd_trades=",
    "csv_rows=",
    "closed=",
    "market_maker",
    "winner_capped",
)


def _is_hard_skip(reasons: list[str]) -> bool:
    for reason in reasons:
        for prefix in HARD_REASON_PREFIXES:
            if reason == prefix or reason.startswith(prefix):
                return True
    return False
HARD_SKIP_USERNAMES = {
    "RN1",
    "swisstony",
    "0xD9E0AACa471f48F91A26E8669A805f2",
    "GoalLineGhost",
    "ferrariChampions2026",
    "HomeRunHazard",
    "wr0ngw4yb3tt0r",
    "quavoo",
    "LynxTitan",
    "Cannae",
    "BoomLaLa",
}

HARD_SKIP_WALLETS = {
    "0xd9e0aaca471f489be338fd0f91a26e8669a805f2",
    "0x2005d16a84ceefa912d4e380cd32e7ff827875ea",  # RN1
}


def _load_json(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def load_take_book() -> list[dict[str, Any]]:
    data = _load_json(TRUSTED_PATH) or {}
    return [t for t in (data.get("trusted") or []) if isinstance(t, dict) and t.get("wallet")]


def load_extra_status() -> dict[str, str]:
    """Load status values from extra_traders.json (wallet -> status)."""
    data = _load_json(EXTRA_PATH)
    out: dict[str, str] = {}
    if not isinstance(data, list):
        return out
    for row in data:
        if not isinstance(row, dict):
            continue
        w = str(row.get("wallet") or "").strip().lower()
        st = str(row.get("status") or "").strip().lower()
        if w and st:
            out[w] = st
    return out


def load_extra_full() -> dict[str, dict[str, Any]]:
    """Load full extra_traders.json records (wallet -> full record)."""
    data = _load_json(EXTRA_PATH)
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(data, list):
        return out
    for row in data:
        if not isinstance(row, dict):
            continue
        w = str(row.get("wallet") or "").strip().lower()
        if w:
            out[w] = row
    return out


def _f(v: Any) -> float | None:
    try:
        if v is None:
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def classify_trader(
    row: dict[str, Any],
    extra_status: dict[str, str],
    extra_full: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    username = str(row.get("username") or "")
    wallet = str(row.get("wallet") or "").lower()
    our = row.get("our") or {}
    book = row.get("book") or {}
    pd = row.get("polydata") or {}
    acc = row.get("accuracy") or {}
    lane = str(row.get("lane") or "")
    recency = str(row.get("recency_band") or "")
    closed = int(book.get("closed") or 0)
    rows = int(book.get("rows") or closed)
    pd_trades = int(pd.get("trades") or 0)
    wr = _f(our.get("win_rate")) or 0.0
    median = _f(our.get("median_stake")) or 0.0
    matched = bool(acc.get("matched") or lane == "take_book")
    take_book = bool(row.get("take_book") or lane == "take_book")
    extra = extra_status.get(wallet, "")
    extra_row = (extra_full or {}).get(wallet) or {}
    why_tail = str(extra_row.get("why_tail") or "")

    reasons: list[str] = []
    if username in HARD_SKIP_USERNAMES or wallet in HARD_SKIP_WALLETS:
        reasons.append("hard_skip_mega_or_mm")
    if extra in {"kicked", "kick", "grinder", "removed"}:
        reasons.append("extra_kicked")
    if lane == "kicked":
        reasons.append("lane_kicked")
    if pd_trades >= PD_TRADES_BOT:
        reasons.append(f"pd_trades={pd_trades}>=100k")
    if rows >= CSV_ROWS_BOT:
        reasons.append(f"csv_rows={rows}>=50k")
    if median >= MEDIAN_JOIN_MAX:
        reasons.append(f"median=${median:,.0f}_unjoinable")
    if closed > CLOSED_MAX_COPY:
        reasons.append(f"closed={closed}>12k")
    if row.get("market_maker"):
        reasons.append("market_maker")
    if row.get("winner_capped"):
        reasons.append("winner_capped")

    hard = _is_hard_skip(reasons)
    joinable = (
        CLOSED_MIN <= closed <= CLOSED_MAX_COPY
        and WR_LO <= wr <= WR_HI
        and median < MEDIAN_JOIN_MAX
        and not hard
        and lane not in {"kicked", "reference"}
    )

    days_since = row.get("days_since_last")
    if days_since is None:
        last_event = our.get("last_event_date")
        if last_event:
            try:
                last_dt = datetime.fromisoformat(str(last_event)[:10]).replace(tzinfo=timezone.utc)
                days_since = max(0, int((datetime.now(timezone.utc) - last_dt).total_seconds() // 86400))
            except (TypeError, ValueError):
                pass

    auto_benched = False
    if extra == "benched":
        auto_benched = True
        reasons.append("operator_benched")
    elif days_since is not None and days_since >= STALE_BENCH_DAYS and extra not in {"kicked", "kick", "removed"}:
        auto_benched = True
        reasons.append(f"stale_{days_since}d_no_joinable_prints")

    live = joinable and matched and recency in LIVE_RECENCY and not auto_benched
    bench = False
    if not live and not hard and lane not in {"kicked", "reference"}:
        if auto_benched:
            bench = True
        elif take_book or (matched and CLOSED_MIN <= closed <= CLOSED_MAX_COPY and WR_LO <= wr <= WR_HI):
            bench = True
            if recency in {"DROP", "DARK"}:
                reasons.append(f"stale_{recency}")
            elif not joinable and median >= MEDIAN_JOIN_MAX:
                reasons.append("unjoinable_keep_book")
            elif not matched:
                reasons.append("unmatched_pd")
            else:
                reasons.append(f"recency_{recency or 'UNKNOWN'}")

    if hard:
        bucket = "skip"
    elif live:
        bucket = "live"
    elif bench:
        bucket = "bench"
    elif lane == "kicked" or extra in {"kicked", "kick", "removed"}:
        bucket = "kicked"
    elif lane == "reference":
        bucket = "reference"
    elif extra == "scout":
        bucket = "scout"
    else:
        bucket = "watch"

    return {
        "username": username,
        "wallet": wallet,
        "bucket": bucket,
        "take_book": take_book,
        "matched": matched,
        "joinable": joinable,
        "recency": recency,
        "closed": closed,
        "rows": rows,
        "pd_trades": pd_trades,
        "win_rate": round(wr, 2),
        "median_stake": round(median, 2),
        "last_event_date": our.get("last_event_date"),
        "days_since_last": days_since,
        "why_tail": why_tail,
        "reasons": reasons,
        "refresh": bucket in {"live", "bench", "watch", "scout"},
    }


def build_universe() -> dict[str, Any]:
    ranks = _load_json(RANKS_PATH) or {}
    extra_status = load_extra_status()
    extra_full = load_extra_full()
    take = load_take_book()
    traders: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in ranks.get("traders") or []:
        if not isinstance(row, dict):
            continue
        classified = classify_trader(row, extra_status, extra_full)
        w = classified["wallet"]
        if not w or w in seen:
            continue
        seen.add(w)
        traders.append(classified)

    buckets = {"live": [], "bench": [], "watch": [], "scout": [], "kicked": [], "skip": [], "reference": []}
    for t in traders:
        buckets.setdefault(t["bucket"], []).append(t)

    stale_benched = [t for t in traders if any("stale_" in r and "no_joinable" in r for r in t.get("reasons", []))]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": (
            "Live copy = Polydata-matched, joinable (40–12k closed, WR 48–75, median <$15k), "
            "HOT/WARM. Skip = 100k+ Polydata trades, 50k+ CSV rows, MM, kicked grinders. "
            "Bench = matched but stale/cold — keep full books, do not fire live. "
            f"Auto-bench after {STALE_BENCH_DAYS}d no joinable prints. "
            "Scout = discovered candidates, refresh for vetting. "
            "Futures are not a copy lane (n=5, −37% after 2¢)."
        ),
        "rules": {
            "pd_trades_bot": PD_TRADES_BOT,
            "csv_rows_bot": CSV_ROWS_BOT,
            "closed_min": CLOSED_MIN,
            "closed_max_copy": CLOSED_MAX_COPY,
            "median_join_max": MEDIAN_JOIN_MAX,
            "wr": [WR_LO, WR_HI],
            "live_recency": sorted(LIVE_RECENCY),
            "stale_bench_days": STALE_BENCH_DAYS,
        },
        "take_book_matched": [{"username": t.get("username"), "wallet": str(t.get("wallet") or "").lower()} for t in take],
        "counts": {k: len(v) for k, v in buckets.items()},
        "stale_benched_count": len(stale_benched),
        "live": buckets["live"],
        "bench": buckets["bench"],
        "watch": buckets["watch"],
        "scout": buckets["scout"],
        "kicked": buckets["kicked"],
        "skip": buckets["skip"],
        "reference": buckets["reference"],
        "traders": traders,
    }
    return payload


def write_universe(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload or build_universe()
    OUT_PATH.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    return data


def load_universe() -> dict[str, Any]:
    data = _load_json(OUT_PATH)
    if isinstance(data, dict) and data.get("live") is not None:
        return data
    return build_universe()


def live_copy_books() -> list[dict[str, str]]:
    uni = load_universe()
    live = uni.get("live") or []
    if live:
        return [{"username": t["username"], "wallet": t["wallet"]} for t in live]
    return [
        {"username": str(t.get("username") or ""), "wallet": str(t.get("wallet") or "")}
        for t in (uni.get("take_book_matched") or [])
    ]


def copy_focus_buckets() -> tuple[str, ...]:
    return ("live", "bench", "watch", "scout")


def refresh_usernames() -> set[str]:
    uni = load_universe()
    names: set[str] = set()
    for key in copy_focus_buckets():
        for t in uni.get(key) or []:
            names.add(str(t.get("username") or ""))
    return {n for n in names if n}


def should_skip_pipeline(username: str, wallet: str, csv_rows: int = 0) -> str | None:
    """Return skip reason for daily fetch, or None to process."""
    w = (wallet or "").lower()
    u = username or ""
    if u in HARD_SKIP_USERNAMES or w in HARD_SKIP_WALLETS:
        return "mega_or_mm"
    if csv_rows >= CSV_ROWS_BOT:
        return f"csv_rows={csv_rows}"
    uni = _load_json(OUT_PATH)
    if not isinstance(uni, dict):
        extra = load_extra_status()
        if extra.get(w) in {"kicked", "kick", "grinder"}:
            return "extra_kicked"
        return None
    refresh = {
        str(t.get("username") or "")
        for key in copy_focus_buckets()
        for t in (uni.get(key) or [])
    }
    skip_names = {str(t.get("username") or "") for t in (uni.get("skip") or []) + (uni.get("kicked") or [])}
    if u in refresh:
        return None
    if u in skip_names:
        return "not_copy_focus"
    extra = load_extra_status()
    if extra.get(w) in {"kicked", "kick", "grinder"}:
        return "extra_kicked"
    return "not_copy_focus"


def main() -> int:
    payload = write_universe()
    print(f"[copy-roster] wrote {OUT_PATH}")
    counts = payload.get("counts") or {}
    stale_n = payload.get("stale_benched_count") or 0
    print(
        f"  live={counts.get('live')} bench={counts.get('bench')} watch={counts.get('watch')} "
        f"scout={counts.get('scout')} skip={counts.get('skip')} kicked={counts.get('kicked')}"
    )
    if stale_n:
        print(f"  {stale_n} trader(s) auto-benched for staleness (>={STALE_BENCH_DAYS}d no joinable prints)")
    for t in payload.get("live") or []:
        print(f"  LIVE  {t['username']:<32} closed={t['closed']:<5} wr={t['win_rate']} rec={t['recency']}")
    for t in payload.get("bench") or []:
        print(f"  BENCH {t['username']:<32} closed={t['closed']:<5} wr={t['win_rate']} rec={t['recency']} {t.get('reasons')}")
    for t in payload.get("watch") or []:
        print(f"  WATCH {t['username']:<32} closed={t['closed']:<5} wr={t['win_rate']} rec={t['recency']}")
    for t in payload.get("scout") or []:
        why = t.get("why_tail") or ""
        print(f"  SCOUT {t['username']:<32} closed={t['closed']:<5} wr={t['win_rate']} why={why[:50]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
