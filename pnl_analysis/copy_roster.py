#!/usr/bin/env python3
"""Copy-universe rules: who we fetch, who we copy, who we ignore.

Mega/high-frequency books (100k+ Polydata trades or 50k+ CSV rows) are not
copyable at $100 and are skipped by the daily pipeline so we spend the
refresh budget on joinable sports books.

Copy-focus (daily refresh): live + bench + watch + scout. Skip/kicked/reference
stay on disk but are not re-fetched.

Live also requires unique-book ROI ≥5% (or a last-30d turnaround), ≥8 settled
prints in 30d, and not a take-rule bleed. Path-B: walk-forward Elite names
with WR 75–85, unique ROI ≥10%, joinable median (HVAB-class). Vigilant-
Environment / sentrio / Mysaria stay excluded.

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
# Unique closed+open book — Polydata month curves are discovery, not copy truth.
LIVE_MIN_ROI = 5.0
LIVE_MIN_EVENTS = 40
LIVE_MAX_LAST60_ROI = -5.0
LIVE_MIN_LAST60_N = 20
# One print in 30d is HOT recency, not a live book.
LIVE_MIN_LAST30_N = 8
TAKE_RULE_BLEED_BENCH = {
    "TTdes",  # NHL ML take slice deeply red in last digest
}

# Path-B specialist exception: WR 75–85 allowed if walk-forward Elite AND:
#   curve-book unique≥10%, joinable median, sports specialty, not hedge-MM
WR_HI_SPECIALIST = 85.0
ELITE_PATH_B_MIN_UNIQUE_ROI = 10.0
ELITE_ROSTER_PATH = OUTPUT_DIR / "verified_elite_roster.json"
PATH_B_EXCLUDED_USERNAMES = {
    "Vigilant-Environment",
    "sentrio",
    "Mysaria",
}

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
    "HOG993",
    "betterfasterstronger",
    "mentionmarket",
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


def load_elite_roster() -> dict[str, dict[str, Any]]:
    """Load verified_elite_roster.json and return wallet→elite_info map."""
    data = _load_json(ELITE_ROSTER_PATH)
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(data, dict):
        return out
    for entry in data.get("elite") or []:
        if not isinstance(entry, dict):
            continue
        w = str(entry.get("wallet") or "").strip().lower()
        if w:
            out[w] = entry
    return out


def is_path_b_specialist(
    username: str,
    wallet: str,
    wr: float,
    roi: float | None,
    median: float,
    elite_roster: dict[str, dict[str, Any]],
) -> tuple[bool, str]:
    """Path-B: WR 75–85 for walk-forward Elite with unique ROI ≥10% and joinable median."""
    if username in PATH_B_EXCLUDED_USERNAMES:
        return False, "path_b_excluded_grinder_mm"
    if wr < WR_HI or wr > WR_HI_SPECIALIST:
        return False, f"wr={wr:.0f}_not_specialist_range"
    elite_info = elite_roster.get(wallet.lower())
    if elite_info is None:
        return False, "not_walkforward_elite"
    elite_unique = _f(elite_info.get("unique_roi"))
    if elite_unique is None or elite_unique < ELITE_PATH_B_MIN_UNIQUE_ROI:
        return False, f"elite_unique={elite_unique}_lt_{ELITE_PATH_B_MIN_UNIQUE_ROI}"
    if median >= MEDIAN_JOIN_MAX:
        return False, f"median=${median:,.0f}_unjoinable"
    return True, f"path_b_specialist wr={wr:.0f} elite_unique={elite_unique:.1f}%"


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
    elite_roster: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    elite_roster = elite_roster or {}
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
    roi = _f(our.get("roi"))
    extra = extra_status.get(wallet, "")
    extra_row = (extra_full or {}).get(wallet) or {}
    why_tail = str(extra_row.get("why_tail") or extra_row.get("auto_promote_reason") or extra_row.get("notes") or "")

    elite_info = elite_roster.get(wallet)
    is_elite_roster = elite_info is not None
    if is_elite_roster:
        elite_median = _f(elite_info.get("median"))
        elite_unique = _f(elite_info.get("unique_roi"))
        if (median <= 0 or median >= 1e8) and elite_median is not None:
            median = elite_median
        if roi is None and elite_unique is not None:
            roi = elite_unique
        if wr <= 0:
            wr = _f(elite_info.get("win_rate")) or wr

    try:
        events = int(our.get("events") or 0)
    except (TypeError, ValueError):
        events = 0
    last_60_roi = _f(our.get("last_60d_roi"))
    try:
        last_60_n = int(our.get("last_60d_n") or 0)
    except (TypeError, ValueError):
        last_60_n = 0
    try:
        last_30_n = int(our.get("last_30d_n") or 0)
    except (TypeError, ValueError):
        last_30_n = 0
    last_30_roi = _f(our.get("last_30d_roi"))
    matched = bool(acc.get("matched") or lane == "take_book")
    take_book = bool(row.get("take_book") or lane == "take_book")
    if extra in {"take_book", "live", "auto_live"}:
        take_book = True
        matched = True

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
    # Unique-book gates are copy truth. Polydata bot_class is not a skip by itself.
    if row.get("market_maker") and pd_trades >= PD_TRADES_BOT:
        reasons.append("market_maker")
    if row.get("winner_capped"):
        reasons.append("winner_capped")

    hard = _is_hard_skip(reasons)
    closed_ok = (CLOSED_MIN <= closed <= CLOSED_MAX_COPY) or is_elite_roster
    standard_joinable = (
        closed_ok
        and WR_LO <= wr <= WR_HI
        and median < MEDIAN_JOIN_MAX
        and not hard
        and lane not in {"kicked", "reference"}
    )
    path_b_ok, path_b_why = is_path_b_specialist(username, wallet, wr, roi, median, elite_roster)
    specialist_joinable = (
        path_b_ok
        and closed_ok
        and not hard
        and lane not in {"kicked", "reference"}
    )
    joinable = standard_joinable or specialist_joinable
    if specialist_joinable and not standard_joinable:
        reasons.append(path_b_why)
    if is_elite_roster and not standard_joinable:
        reasons.append(f"elite_roster_bypass closed={closed}")

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

    live = joinable and (matched or is_elite_roster) and recency in LIVE_RECENCY and not auto_benched
    if live and extra == "watch" and not is_elite_roster:
        reasons.append("extra_watch_pending_auto_promote")
        live = False
    elif live and extra == "watch" and is_elite_roster:
        reasons.append("elite_roster_overrides_watch")
    if live and extra == "scout":
        reasons.append("scout_pending_auto_promote")
        live = False

    turnaround_ok = (
        last_30_n >= 30
        and last_30_roi is not None
        and last_30_roi >= 8.0
        and (roi is None or roi < LIVE_MIN_ROI)
    )
    if live and (roi is None or roi < LIVE_MIN_ROI) and not is_elite_roster:
        if turnaround_ok and extra in {"take_book", "live", "auto_live"}:
            reasons.append(f"turnaround_last30_roi={last_30_roi}%_n={last_30_n}")
        else:
            reasons.append(f"unique_roi={roi}_lt_{LIVE_MIN_ROI}")
            live = False
    if live and events < LIVE_MIN_EVENTS and not turnaround_ok and not is_elite_roster:
        reasons.append(f"events={events}<{LIVE_MIN_EVENTS}")
        live = False
    if live and last_60_n >= LIVE_MIN_LAST60_N and last_60_roi is not None and last_60_roi < LIVE_MAX_LAST60_ROI:
        reasons.append(f"last60d_roi={last_60_roi}%_n={last_60_n}")
        live = False
    if live and last_30_n < LIVE_MIN_LAST30_N and not is_elite_roster:
        reasons.append(f"quiet_30d_n={last_30_n}<{LIVE_MIN_LAST30_N}")
        live = False
    if live and (
        username in TAKE_RULE_BLEED_BENCH
        or wallet in {a.lower() for a in TAKE_RULE_BLEED_BENCH if a.startswith("0x")}
    ):
        reasons.append("take_rule_bleed")
        live = False

    bench = False
    wr_ok = WR_LO <= wr <= WR_HI or (path_b_ok and WR_HI < wr <= WR_HI_SPECIALIST)
    if not live and not hard and lane not in {"kicked", "reference"}:
        if auto_benched:
            bench = True
        elif extra not in {"watch", "scout"} or is_elite_roster:
            if take_book or (matched and CLOSED_MIN <= closed <= CLOSED_MAX_COPY and wr_ok):
                bench = True
                if recency in {"DROP", "DARK"}:
                    reasons.append(f"stale_{recency}")
                elif not joinable and median >= MEDIAN_JOIN_MAX:
                    reasons.append("unjoinable_keep_book")
                elif roi is not None and roi < LIVE_MIN_ROI and not turnaround_ok:
                    reasons.append(f"unique_roi={roi}_bench")
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
    elif closed < 1 and extra not in {"watch", "take_book", "scout"} and not take_book:
        reasons.append("no_csv_book")
        bucket = "skip"
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
        "unique_roi": round(roi, 2) if roi is not None else None,
        "events": events,
        "last_30d_n": last_30_n,
        "last_30d_roi": last_30_roi,
        "last_60d_n": last_60_n,
        "last_60d_roi": last_60_roi,
        "extra_status": extra or None,
        "last_event_date": our.get("last_event_date"),
        "days_since_last": days_since,
        "why_tail": why_tail,
        "path_b": bool(specialist_joinable and not standard_joinable),
        "reasons": reasons,
        "refresh": bucket in {"live", "bench", "watch", "scout"},
    }


def _overlay_db_stats(traders: list[dict[str, Any]]) -> None:
    """Replace stale file stats with fresh Postgres unique-book stats when present."""
    try:
        from desk_db import connect, wallet_stats
    except Exception:
        return
    try:
        with connect(require=False) as conn:
            if conn is None:
                return
            for t in traders:
                w = str(t.get("wallet") or "").lower()
                if not w:
                    continue
                stats = wallet_stats(conn, w)
                if not stats or int(stats.get("closed") or 0) <= 0:
                    continue
                t["closed"] = stats["closed"]
                t["last_30d_n"] = stats["last_30d_n"]
                t["last_30d_roi"] = stats["last_30d_roi"]
                t["last_60d_n"] = stats["last_60d_n"]
                t["last_60d_roi"] = stats["last_60d_roi"]
                if stats.get("unique_roi") is not None:
                    t["unique_roi"] = stats["unique_roi"]
                if stats.get("win_rate") is not None:
                    t["win_rate"] = stats["win_rate"]
                if stats.get("median_stake"):
                    t["median_stake"] = stats["median_stake"]
                t["days_since_last"] = stats.get("days_since_last")
                t["last_event_date"] = stats.get("last_event_date")
                t["tape_source"] = "postgres"
    except Exception as exc:
        print(f"[copy-roster] postgres overlay skipped: {exc}")


def build_universe() -> dict[str, Any]:
    ranks = _load_json(RANKS_PATH) or {}
    extra_status = load_extra_status()
    extra_full = load_extra_full()
    elite_roster = load_elite_roster()
    take = load_take_book()
    traders: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in ranks.get("traders") or []:
        if not isinstance(row, dict):
            continue
        classified = classify_trader(row, extra_status, extra_full, elite_roster)
        w = classified["wallet"]
        if not w or w in seen:
            continue
        seen.add(w)
        traders.append(classified)
    for wallet, elite in elite_roster.items():
        if wallet in seen:
            continue
        # Elite file only — no invented WR/PnL. Missing fields stay missing.
        wr = _f(elite.get("win_rate"))
        stub = {
            "username": str(elite.get("username") or "unknown"),
            "wallet": wallet,
            "lane": "take_book",
            "take_book": True,
            "recency_band": "HOT" if int(elite.get("active_30d") or 0) >= 8 else "WARM",
            "days_since_last": elite.get("days_since_last"),
            "our": {
                "win_rate": wr,
                "median_stake": _f(elite.get("median")) or 0.0,
                "roi": _f(elite.get("unique_roi")),
                "events": int(elite.get("events") or elite.get("active_30d") or 0),
                "last_30d_n": int(elite.get("last_30d_n") or elite.get("active_30d") or 0),
                "last_30d_roi": _f(elite.get("last_30d_roi")),
                "last_60d_n": int(elite.get("last_60d_n") or 0),
                "last_60d_roi": _f(elite.get("last_60d_roi")),
                "last_event_date": elite.get("last_event_date"),
                "top_sport": ((elite.get("top_sports") or [{}])[0] or {}).get("key"),
            },
            "book": {
                "closed": int(elite.get("closed") or elite.get("active_30d") or 0),
                "rows": int(elite.get("rows") or elite.get("active_30d") or 0),
            },
            "polydata": {},
            "accuracy": {"matched": True},
        }
        classified = classify_trader(stub, extra_status, extra_full, elite_roster)
        seen.add(wallet)
        traders.append(classified)

    buckets = {"live": [], "bench": [], "watch": [], "scout": [], "kicked": [], "skip": [], "reference": []}
    _overlay_db_stats(traders)

    for t in traders:
        buckets.setdefault(t["bucket"], []).append(t)

    stale_benched = [t for t in traders if any("stale_" in r and "no_joinable" in r for r in t.get("reasons", []))]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": (
            "Live copy = Polydata-matched, joinable (40–12k closed, WR 48–75, median <$15k), "
            "HOT/WARM, unique-book ROI ≥5% (or last-30d turnaround ≥8% n≥30), ≥8 settled "
            f"prints in 30d. Path-B: walk-forward Elite WR 75–85 + unique≥10%. "
            f"Auto-bench after {STALE_BENCH_DAYS}d no joinable prints. "
            "Scout = discovered candidates, refresh for vetting; auto_promote applies "
            "activity+equity gates (not vibes). Vigilant-Environment/sentrio/Mysaria excluded. "
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
