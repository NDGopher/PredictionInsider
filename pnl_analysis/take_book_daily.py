#!/usr/bin/env python3
"""Daily take-book health: rolling ROI, open/near plays, roster proposals.

Anti-overfit rules (do NOT auto-add/remove from a hot week):
  Pause live copy if last 30d n≥25 and +2¢ ROI < 0, or last 60d n≥40 and ROI < −5%.
  Propose ADD only if Polydata-matched, n≥40, sports specialist, and hold-to-res
  copy of that name after warmup is not a juice-bleed.
  Propose DROP only if last 90d AND last 60d take-slice are both negative (n≥15).

Writes pnl_analysis/output/take_health.json
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_trader import get_market_type, get_sport  # noqa: E402
from position_utils import (  # noqa: E402
    attach_event_dates,
    classify_submarket,
    mark_resolved,
    play_label,
    read_trader_csv,
    sport_family,
)
from run_full_pipeline import OUTPUT_DIR, csv_path_for, roster_traders  # noqa: E402
from take_book_bankroll import (  # noqa: E402
    FLAT_STAKE,
    START_BANK,
    fill_price,
    take_mask,
)
from walkforward_consensus_backtest import (  # noqa: E402
    KNOWLEDGE_LAG,
    LIVE_HI,
    LIVE_LO,
    MIN_COST,
    MIN_LANE_ROI,
    STALE_ENTRY,
    WARMUP,
    build_snapshots,
    load_trader_markets,
    lookup_snap,
)

PLAYS = OUTPUT_DIR / "asof_fullbook_plays.csv"
TRUSTED = OUTPUT_DIR / "trusted_full_books.json"
OUT = OUTPUT_DIR / "take_health.json"
OPEN_OUT = OUTPUT_DIR / "take_open_scan.json"
HEALTH_SENT = OUTPUT_DIR / "telegram_take_health_sent.json"
TITLE_DATE = re.compile(r"(20\d{2})-(\d{2})-(\d{2})")


def title_is_stale(title: str, now: datetime) -> bool:
    m = TITLE_DATE.search(title or "")
    if not m:
        return False
    try:
        dt = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=timezone.utc)
    except ValueError:
        return False
    return dt < now - timedelta(hours=12)


def send_health_telegram(payload: dict) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN") or ""
    chat = os.environ.get("TELEGRAM_CHAT_ID") or ""
    if not token or not chat:
        return
    as_of = str(payload.get("as_of") or "")
    try:
        prev = json.loads(HEALTH_SENT.read_text(encoding="utf-8")) if HEALTH_SENT.exists() else {}
    except json.JSONDecodeError:
        prev = {}
    if prev.get("as_of") == as_of:
        return
    w30 = payload.get("windows", {}).get("last_30d") or {}
    w60 = payload.get("windows", {}).get("last_60d") or {}
    status = str(payload.get("status") or "go").upper()
    live_n = len(payload.get("live_open") or [])
    near_n = len(payload.get("near_open") or [])
    drops = payload.get("propose_drop") or []
    pause = payload.get("pause_reason")
    lines = [
        f"📊 Take-book {as_of} · {status}",
        f"30d n={w30.get('n')} · WR {w30.get('win_rate')}% · ROI {w30.get('roi_2c')}% after 2¢",
        f"60d n={w60.get('n')} · ROI {w60.get('roi_2c')}%",
        f"CSV live TAKEs: {live_n} · near: {near_n}",
        f"Drop proposals: {len(drops)} (never auto-applied)",
        "Human fill $100. No auto-bet. Do not retune Q/rel from a cold week.",
    ]
    if pause:
        lines.insert(1, f"⏸ {pause}")
    text = "\n".join(lines)
    body = json.dumps({"chat_id": chat, "text": text}).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status >= 300:
                print(f"telegram health digest HTTP {resp.status}", file=sys.stderr)
                return
    except (urllib.error.URLError, TimeoutError) as err:
        print(f"telegram health digest failed: {err}", file=sys.stderr)
        return
    HEALTH_SENT.write_text(json.dumps({"as_of": as_of}, indent=2), encoding="utf-8")


def load_trusted() -> list[dict]:
    uni_path = OUTPUT_DIR / "copy_universe.json"
    if uni_path.exists():
        try:
            live = list((json.loads(uni_path.read_text(encoding="utf-8")).get("live") or []))
            if live:
                return live
        except Exception:
            pass
    return list(json.loads(TRUSTED.read_text(encoding="utf-8")).get("trusted") or [])


def window_stats(sub: pd.DataFrame, days: int, now: pd.Timestamp) -> dict:
    cut = now - pd.Timedelta(days=days)
    w = sub[sub["end_dt"] >= cut]
    n = int(len(w))
    if n == 0:
        return {"n": 0, "win_rate": None, "roi_2c": None, "pnl_2c": None}
    pnl = float(w["pnl_2c"].sum())
    return {
        "n": n,
        "win_rate": round(float(w["won"].mean() * 100.0), 2),
        "roi_2c": round(pnl / (n * FLAT_STAKE) * 100.0, 2),
        "pnl_2c": round(pnl, 2),
    }


def pause_reason(w30: dict, w60: dict) -> str | None:
    if (w30.get("n") or 0) >= 25 and (w30.get("roi_2c") or 0) < 0:
        return f"last 30d n={w30['n']} ROI {w30['roi_2c']}% < 0 — pause new copies"
    if (w60.get("n") or 0) >= 40 and (w60.get("roi_2c") or 0) < -5:
        return f"last 60d n={w60['n']} ROI {w60['roi_2c']}% < −5% — pause new copies"
    return None


def scan_open(trusted: list[dict]) -> tuple[list[dict], list[dict]]:
    now = datetime.now(timezone.utc)
    takes: list[dict] = []
    close: list[dict] = []
    for t in trusted:
        w = str(t.get("wallet") or "").lower()
        username = str(t.get("username") or "")
        if not w.startswith("0x") or not username:
            continue
        csv_p = csv_path_for(w, username)
        if not csv_p.exists():
            continue
        mk = load_trader_markets(csv_p, username, w)
        snaps = build_snapshots(mk) if len(mk) >= WARMUP else []
        snap = lookup_snap(snaps, now - KNOWLEDGE_LAG) if snaps else None
        q = int(snap["q"]) if snap else 0
        median = float(snap["median"]) if snap else 0.0
        roi = float(snap["roi"]) if snap else 0.0
        sport_roi_map = (snap.get("sport_roi") or {}) if snap else {}

        raw = mark_resolved(read_trader_csv(csv_p))
        for col in ("avgPrice", "totalBought", "initialValue", "curPrice"):
            if col not in raw.columns:
                raw[col] = 0.0
            raw[col] = pd.to_numeric(raw[col], errors="coerce").fillna(0.0)
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
        if "timestamp" in open_df.columns:
            ts = pd.to_datetime(open_df["timestamp"], utc=True, errors="coerce", unit="s")
            if ts.isna().all():
                ts = pd.to_datetime(open_df["timestamp"], utc=True, errors="coerce")
            undated = undated & ts.notna() & (ts >= pd.Timestamp(now) - pd.Timedelta(days=5))
        else:
            undated = undated & False
        open_df = open_df[dated | undated]
        if open_df.empty:
            continue
        open_df["sport_type"] = open_df.apply(get_sport, axis=1)
        open_df["market_type"] = open_df.apply(get_market_type, axis=1)
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
            row = {
                "username": username,
                "wallet": w,
                "title": title,
                "slug": slug,
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
            }
            if not misses:
                takes.append(row)
            elif len(misses) <= 2 and (q >= 50 or rel >= 1.5 or lane_ok):
                close.append(row)
    takes.sort(key=lambda r: (-r["rel"], -r["q"]))
    close.sort(key=lambda r: (-r["rel"], -r["q"]))
    return takes, close


def trader_windows(df: pd.DataFrame, now: pd.Timestamp) -> list[dict]:
    rows: list[dict] = []
    for name, grp in df.groupby("username"):
        rows.append({
            "username": str(name),
            "last_30d": window_stats(grp, 30, now),
            "last_60d": window_stats(grp, 60, now),
            "last_90d": window_stats(grp, 90, now),
            "all": window_stats(grp, 5000, now),
        })
    return rows


def drop_proposals(by_trader: list[dict]) -> list[dict]:
    out: list[dict] = []
    for r in by_trader:
        a, b = r["last_90d"], r["last_60d"]
        if (a.get("n") or 0) >= 15 and (b.get("n") or 0) >= 15:
            if (a.get("roi_2c") or 0) < 0 and (b.get("roi_2c") or 0) < 0:
                out.append({
                    "username": r["username"],
                    "action": "propose_drop",
                    "reason": (
                        f"take-slice 90d ROI {a['roi_2c']}% (n={a['n']}) and "
                        f"60d {b['roi_2c']}% (n={b['n']}) both negative"
                    ),
                })
    return out


def main() -> int:
    now = pd.Timestamp(datetime.now(timezone.utc))
    trusted = load_trusted()
    print("Scanning open books for live / near take plays…")
    live, close = scan_open(trusted)
    if not PLAYS.exists():
        print(
            f"[warn] Missing {PLAYS}; open scan still ran. "
            "Rolling take ROI windows need asof_fullbook_backtest.py."
        )
        stub = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "as_of": datetime.now(timezone.utc).date().isoformat(),
            "status": "go",
            "pause_reason": None,
            "windows": {},
            "by_trader": [],
            "propose_drop": [],
            "propose_add": [],
            "live_open": live,
            "near_open": close,
            "note": "Open scan OK; rolling windows skipped (missing asof_fullbook_plays.csv)",
        }
        OUT.write_text(json.dumps(stub, indent=2, default=str), encoding="utf-8")
        OPEN_OUT.write_text(
            json.dumps(
                {
                    "generated_at": stub["generated_at"],
                    "live": live,
                    "near": close,
                    "copy_books": [
                        {"username": t.get("username"), "wallet": t.get("wallet")}
                        for t in trusted
                    ],
                },
                indent=2,
                default=str,
            ),
            encoding="utf-8",
        )
        print(f"LIVE take opens: {len(live)}   near: {len(close)}")
        for r in live[:12]:
            print(f"  TAKE {r['username']:<20} Q={r['q']:>3} {r['rel']:4.1f}×  {r['entry']:.2f}  {r['play'][:80]}")
        for r in close[:12]:
            print(f"  NEAR {r['username']:<20} {', '.join(r['misses'])}  {r['play'][:70]}")
        print(f"Wrote {OUT}")
        return 0
    df = pd.read_csv(PLAYS)
    df["end_dt"] = pd.to_datetime(df["end_dt"], utc=True)
    df["won"] = df["won"].astype(str).str.lower().isin(["true", "1", "yes"])
    take = df.loc[take_mask(df)].sort_values("end_dt")
    w30 = window_stats(take, 30, now)
    w60 = window_stats(take, 60, now)
    w90 = window_stats(take, 90, now)
    wall = window_stats(take, 5000, now)
    pause = pause_reason(w30, w60)
    by_trader = trader_windows(take, now)
    drops = drop_proposals(by_trader)
    status = "pause" if pause else "go"
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "as_of": datetime.now(timezone.utc).date().isoformat(),
        "status": status,
        "pause_reason": pause,
        "windows": {"last_30d": w30, "last_60d": w60, "last_90d": w90, "all": wall},
        "by_trader": by_trader,
        "propose_drop": drops,
        "propose_add": [],
        "live_open": live,
        "near_open": close,
        "rules": {
            "pause_30d": "n≥25 and ROI+2¢ < 0",
            "pause_60d": "n≥40 and ROI+2¢ < −5%",
            "drop": "last 90d AND 60d take-slice both negative, n≥15 each",
            "add": "never from a 7-day heat — Polydata match + n≥40 + sports specialist + hold-to-res not juice-bleed",
        },
        "start_bank_ref": START_BANK,
    }
    OUT.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    OPEN_OUT.write_text(json.dumps({"live": live, "near": close}, indent=2, default=str), encoding="utf-8")
    print(f"status={status}  30d n={w30['n']} ROI={w30['roi_2c']}  60d n={w60['n']} ROI={w60['roi_2c']}")
    print(f"LIVE take opens: {len(live)}   near: {len(close)}   drop proposals: {len(drops)}")
    for r in live[:12]:
        print(f"  TAKE {r['username']:<20} Q={r['q']:>3} {r['rel']:4.1f}×  {r['entry']:.2f}  {r['play'][:80]}")
    for r in close[:12]:
        print(f"  NEAR {r['username']:<20} {', '.join(r['misses'])}  {r['play'][:70]}")
    print(f"Wrote {OUT}")
    send_health_telegram(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
