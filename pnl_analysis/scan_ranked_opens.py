#!/usr/bin/env python3
"""Scan open positions across live + bench + watch (CSV books) → ranked play board.

OddsJam-style output: every open graded 0–100 with why/misses, sorted by grade.
Product TAKEs (0 misses) are recommended; NEAR (1–2 misses) are close;
WATCH (3+ misses) still shown so the board is never empty when books have opens.

Writes:
  pnl_analysis/output/ranked_play_board.json
  pnl_analysis/RANKED_PLAYS.md

Usage:
  python pnl_analysis/scan_ranked_opens.py
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from copy_roster import OUTPUT_DIR, ROOT, load_universe  # noqa: E402
from run_full_pipeline import csv_path_for  # noqa: E402
from take_book_daily import scan_open  # noqa: E402

OUT_JSON = OUTPUT_DIR / "ranked_play_board.json"
OUT_MD = ROOT / "RANKED_PLAYS.md"

OTHER_SPORTS = re.compile(r"politic|crypto|finance|culture|weather", re.I)
LONG_TITLE = re.compile(
    r"worlds?\s+20\d{2}|champion|mvp|ballon|nomination|win the 20\d{2}|"
    r"before 20\d{2}|control the (senate|house)|midterm|presidential election",
    re.I,
)


def play_lane(sport: str, submarket: str) -> str:
    sm = str(submarket or "")
    s = str(sport or "")
    if sm == "Futures" or sm.lower().startswith("future"):
        return "futures"
    if OTHER_SPORTS.search(s) or s.upper() in ("POLITICS", "OTHER"):
        return "other"
    return "sports"


def market_timing(title: str, event_dt, now: datetime) -> str:
    """live | upcoming | long | unknown — for sports vs macro separation in UI."""
    t = (title or "").lower()
    if LONG_TITLE.search(title or ""):
        return "long"
    if event_dt is not None:
        try:
            import pandas as pd

            if pd.isna(event_dt):
                event_dt = None
            else:
                ed = pd.Timestamp(event_dt).to_pydatetime()
                if ed.tzinfo is None:
                    ed = ed.replace(tzinfo=timezone.utc)
                hours = (ed - now).total_seconds() / 3600.0
                if hours < 0:
                    return "live"
                if hours <= 6:
                    return "live"
                if hours <= 72:
                    return "upcoming"
                if hours <= 24 * 14:
                    return "upcoming"
                return "long"
        except Exception:
            pass
    if " vs " in t or " vs. " in t:
        return "upcoming"
    return "unknown"


def effective_lane(sport: str, submarket: str, title: str, timing: str) -> str:
    base = play_lane(sport, submarket)
    if base in ("other", "futures"):
        return base
    if timing == "long" or LONG_TITLE.search(title or ""):
        return "futures"
    return "sports"


def enrich_row(row: dict, now: datetime) -> None:
    sport = str(row.get("sport") or "")
    subm = str(row.get("submarket") or "Moneyline")
    title = str(row.get("title") or row.get("play") or "")
    timing = market_timing(title, row.get("event_dt"), now)
    lane = effective_lane(sport, subm, title, timing)
    row["timing"] = timing
    row["lane"] = lane
    row["submarket"] = subm


def scan_books(uni: dict) -> list[dict]:
    """All live/bench/watch with a CSV on disk."""
    rows: list[dict] = []
    seen: set[str] = set()
    for bucket in ("live", "bench", "watch"):
        for t in uni.get(bucket) or []:
            w = str(t.get("wallet") or "").lower()
            u = str(t.get("username") or "")
            if not w or w in seen:
                continue
            if not csv_path_for(w, u).exists():
                continue
            seen.add(w)
            rows.append({
                "username": u,
                "wallet": w,
                "bucket": bucket,
                "unique_roi": t.get("unique_roi"),
                "recency": t.get("recency"),
            })
    return rows


def tier_for(misses: list[str]) -> str:
    if not misses:
        return "take"
    if len(misses) <= 2:
        return "near"
    return "watch"


def grade_row(row: dict) -> int:
    q = int(row.get("q") or 0)
    rel = float(row.get("rel") or 0)
    misses = row.get("misses") or []
    g = max(0, min(100, q))
    if not misses:
        if q >= 70:
            g = min(100, g + 3)
        if rel >= 3:
            g = min(100, g + 2)
        if rel >= 5:
            g = min(100, g + 2)
    elif len(misses) == 1:
        g = max(0, g - 5)
    elif len(misses) == 2:
        g = max(0, g - 12)
    else:
        g = max(0, g - 25)
    if rel >= 2:
        g = min(100, g + 4)
    return g


def why_for(row: dict, bucket: str) -> list[str]:
    why: list[str] = []
    misses = row.get("misses") or []
    q = int(row.get("q") or 0)
    rel = float(row.get("rel") or 0)
    sport_roi = row.get("sport_roi")
    user = str(row.get("username") or "")
    if not misses:
        why.append("Passes Take these gates (Q≥60, sport ROI≥+5%, ≥2× size, 10–88¢, no NFL)")
    elif len(misses) <= 2:
        why.append(f"Near miss — {len(misses)} gate(s) away from product TAKE")
    else:
        why.append("Watch only — multiple gates failed; track the book, don't force the play")
    if q > 0:
        why.append(f"Trader quality Q {q}/100")
    if rel > 0:
        why.append(f"Stake {rel:.1f}× their own median")
    if sport_roi is not None:
        why.append(f"As-of sport-lane ROI {float(sport_roi):.0f}%")
    if user:
        why.append(f"Copy book: {user} ({bucket})")
    for m in misses:
        why.append(f"Missing: {m}")
    return why


def write_md(payload: dict) -> None:
    plays = payload.get("plays") or []
    lines = [
        "# Ranked plays board",
        "",
        f"Generated **{payload['generated_at'][:19]} UTC**.",
        "",
        f"Scanned **{payload['books_scanned']}** CSV books (live + bench + watch). "
        f"**{payload['counts']['take']}** product TAKE · "
        f"**{payload['counts']['near']}** near · "
        f"**{payload['counts']['watch']}** watch.",
        "",
        "| Rank | Tier | Grade | Book | Bucket | Play | Why (summary) |",
        "|---:|---|---:|---|---|---|---|",
    ]
    for i, p in enumerate(plays[:40], 1):
        why = "; ".join((p.get("why") or [])[:3])
        play = str(p.get("play") or "")[:55]
        lines.append(
            f"| {i} | {p.get('tier')} | {p.get('grade')} | {p.get('username')} | "
            f"{p.get('bucket')} | {play} | {why[:90]} |"
        )
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    uni = load_universe()
    books = scan_books(uni)
    bucket_by_wallet = {b["wallet"]: b["bucket"] for b in books}
    for b in books:
        b.setdefault("bucket", bucket_by_wallet.get(b["wallet"], "watch"))

    live_rows, near_rows = scan_open(books)
    all_rows: list[dict] = []
    for row in live_rows:
        row["tier"] = "take"
        row["bucket"] = bucket_by_wallet.get(str(row.get("wallet") or "").lower(), "live")
        all_rows.append(row)
    for row in near_rows:
        row["tier"] = "near"
        row["bucket"] = bucket_by_wallet.get(str(row.get("wallet") or "").lower(), "watch")
        all_rows.append(row)

    # WATCH tier: re-scan with relaxed near filter — any open with q>=40
    seen_keys = {
        (str(r.get("wallet")), str(r.get("slug")), str(r.get("side")))
        for r in all_rows
    }
    # Pull extra opens by scanning each book with a looser post-filter
    from position_utils import attach_event_dates, classify_submarket, mark_resolved, play_label, read_trader_csv  # noqa: E402
    from analyze_trader import get_market_type, get_sport  # noqa: E402
    from walkforward_consensus_backtest import (  # noqa: E402
        KNOWLEDGE_LAG,
        LIVE_HI,
        LIVE_LO,
        MIN_LANE_ROI,
        STALE_ENTRY,
        WARMUP,
        build_snapshots,
        load_trader_markets,
        lookup_snap,
        sport_family,
    )
    from take_book_daily import MIN_COST, title_is_stale  # noqa: E402
    import numpy as np  # noqa: E402
    import pandas as pd  # noqa: E402

    now = datetime.now(timezone.utc)
    for b in books:
        w = b["wallet"]
        username = b["username"]
        csv_p = csv_path_for(w, username)
        mk = load_trader_markets(csv_p, username, w)
        snaps = build_snapshots(mk) if len(mk) >= WARMUP else []
        snap = lookup_snap(snaps, now - KNOWLEDGE_LAG) if snaps else None
        q = int(snap["q"]) if snap else 0
        if q < 40:
            continue
        median = float(snap["median"]) if snap else 0.0
        roi = float(snap["roi"]) if snap else 0.0
        sport_roi_map = (snap.get("sport_roi") or {}) if snap else {}
        raw = mark_resolved(read_trader_csv(csv_p))
        for col in ("avgPrice", "totalBought", "initialValue", "curPrice"):
            raw[col] = pd.to_numeric(raw.get(col, 0), errors="coerce").fillna(0.0)
        bought = raw["totalBought"] * raw["avgPrice"]
        raw["cost"] = bought.where(bought > 0, raw["initialValue"])
        open_df = raw.loc[~raw["is_resolved"] & (raw["cost"] >= MIN_COST)].copy()
        open_df = open_df[(open_df["curPrice"] > 0.02) & (open_df["curPrice"] < 0.98)]
        if open_df.empty:
            continue
        open_df = attach_event_dates(open_df)
        horizon = pd.Timestamp(now) - pd.Timedelta(hours=12)
        dated = open_df["event_dt"].notna() & (open_df["event_dt"] >= horizon)
        undated = open_df["event_dt"].isna()
        open_df = open_df[dated | undated]
        open_df["sport_type"] = open_df.apply(get_sport, axis=1)
        open_df["submarket"] = open_df.apply(classify_submarket, axis=1)
        open_df["side"] = open_df["outcome"].astype(str).str.strip()
        g = open_df.groupby(["conditionId", "side"], dropna=False)
        for (cid, side), grp in g:
            cost = float(grp["cost"].sum())
            if cost < MIN_COST:
                continue
            entry = float(np.average(grp["avgPrice"], weights=grp["cost"].replace(0, 1e-9)))
            live = float(grp["curPrice"].iloc[-1])
            sport = str(grp["sport_type"].iloc[0])
            fam = sport_family(sport)
            subm = str(grp["submarket"].iloc[0])
            if str(subm).lower().startswith("future"):
                continue
            title = str(grp["title"].iloc[0] or "")
            slug = str(grp["slug"].iloc[0] or grp["eventSlug"].iloc[0] or "")
            if title_is_stale(title, now) or title_is_stale(slug, now):
                continue
            key = (w, slug, str(side))
            if key in seen_keys:
                continue
            sport_roi = float(sport_roi_map.get(sport, roi))
            lane_ok = sport in sport_roi_map and sport_roi >= MIN_LANE_ROI
            rel = (cost / median) if median > 0 else 1.0
            fill = min(max(entry + 0.02, 0.02), 0.98)
            live_ok = LIVE_LO <= entry <= min(LIVE_HI, STALE_ENTRY)
            nfl = "NFL" in fam.upper()
            misses: list[str] = []
            if q < 60:
                misses.append(f"Q {q} < 60")
            if not lane_ok:
                misses.append(f"sport {sport} ROI {sport_roi:.0f}% (need +{MIN_LANE_ROI:.0f}% as-of)")
            if rel < 2:
                misses.append(f"rel {rel:.1f}× < 2×")
            if not live_ok:
                misses.append(f"entry {entry:.2f} outside 10–88¢")
            if nfl:
                misses.append("NFL skipped")
            if len(misses) <= 2:
                continue
            row = {
                "username": username,
                "wallet": w,
                "title": title,
                "slug": slug,
                "conditionId": str(cid or ""),
                "side": side,
                "sport": sport,
                "sport_family": fam,
                "submarket": subm,
                "play": play_label(title, str(side), sport, subm),
                "entry": round(entry, 3),
                "live": round(live, 3),
                "fill_plus_2c": round(fill, 3),
                "cost": round(cost, 2),
                "q": q,
                "rel": round(min(rel, 30.0), 2),
                "sport_roi": round(sport_roi, 1),
                "lane_ok": lane_ok,
                "misses": misses,
                "url": f"https://polymarket.com/event/{slug}" if slug else None,
                "tier": "watch",
                "bucket": b.get("bucket", "watch"),
                "event_dt": grp["event_dt"].iloc[0] if "event_dt" in grp.columns else None,
            }
            enrich_row(row, now)
            all_rows.append(row)
            seen_keys.add(key)

    for row in all_rows:
        enrich_row(row, now)
        row["grade"] = grade_row(row)
        row["why"] = why_for(row, str(row.get("bucket") or "watch"))

    all_rows.sort(key=lambda r: (-r["grade"], -float(r.get("rel") or 0), -int(r.get("q") or 0)))
    for i, row in enumerate(all_rows, 1):
        row["rank"] = i

    counts = {
        "take": sum(1 for r in all_rows if r.get("tier") == "take"),
        "near": sum(1 for r in all_rows if r.get("tier") == "near"),
        "watch": sum(1 for r in all_rows if r.get("tier") == "watch"),
    }
    lane_counts = {
        "sports": sum(1 for r in all_rows if r.get("lane") == "sports"),
        "other": sum(1 for r in all_rows if r.get("lane") == "other"),
        "futures": sum(1 for r in all_rows if r.get("lane") == "futures"),
    }
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": "Live+bench+watch CSV open scan. Grade=Q with tier penalty. Lanes: sports (live/upcoming) vs politics/other vs futures.",
        "rule": "asof_live_q60_sport_rel2",
        "books_scanned": len(books),
        "counts": {**counts, **lane_counts},
        "plays": all_rows[:120],
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    write_md(payload)
    print(
        f"[ranked] books={len(books)} plays={len(all_rows)} "
        f"TAKE={counts['take']} NEAR={counts['near']} WATCH={counts['watch']}"
    )
    for r in all_rows[:15]:
        print(
            f"  #{r['rank']:2d} [{r['tier']:5s}] G={r['grade']:3d} "
            f"{str(r['username'])[:28]:28s} {str(r.get('play',''))[:50]}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
