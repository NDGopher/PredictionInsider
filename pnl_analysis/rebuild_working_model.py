#!/usr/bin/env python3
"""Fluid working copy model: live / bench / watch / demoted + recent TAKE tape.

Re-runs as-of take-rule backtests on the books we copy, the ones we benched or
demoted, and the ones still on watch. Writes grab-able JSON/MD (not CSVs).

Writes:
  pnl_analysis/WORKING_COPY_MODEL.md
  pnl_analysis/output/working_copy_model.json
  pnl_analysis/output/recent_take_alerts.json
  pnl_analysis/output/copy_universe.json
  pnl_analysis/output/take_lane_backtest.json
  pnl_analysis/output/copy_evolve_backtest.json
  pnl_analysis/output/asof_fullbook_plays.csv  (gitignored)

Usage:
  python pnl_analysis/rebuild_working_model.py
  python pnl_analysis/rebuild_working_model.py --no-clv
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from asof_fullbook_backtest import (  # noqa: E402
    PLAYS_CSV,
    STAKE,
    asof_stat,
    collect_plays,
)
from copy_roster import (  # noqa: E402
    OUTPUT_DIR,
    ROOT,
    build_universe,
    write_universe,
)
from evolve_copy_book import (  # noqa: E402
    EVOLVE_OUT,
    LANE_OUT,
    _lane_stats,
    no_futures,
    politics_other,
    pool_stat,
    take_mask,
)
from robust_tail_research import (  # noqa: E402
    build_token_index,
    fetch_history,
    lookup_price,
)
from run_full_pipeline import csv_path_for  # noqa: E402

MODEL_JSON = OUTPUT_DIR / "working_copy_model.json"
ALERTS_JSON = OUTPUT_DIR / "recent_take_alerts.json"
MODEL_MD = ROOT / "WORKING_COPY_MODEL.md"
STRATEGY_ID = "asof_live_q60_sport_rel2"
WINDOWS = (7, 14, 30)

WATCH_PRIORITY = {
    "HongYunX",
    "HVAB",
    "0xE30E74595517de48f1FB19f4553dd3d9F1E96B87",
    "SineNooneEI",
    "theowalcott",
    "TennisLove",
    "SDTrading",
    "Sassy-Bucket",
    "CoryLahey",
    "ShucksIt69",
    "UAEVALORANTFAN",
    "musholius722",
    "sainttroplay",
    "predictionlegend",
    "bigspending",
    "midwicket72",
}

ARCHIVE_STALE = {
    "Capman",
    "HedgeMaster88",
    "Bienville",
    "tcp2",
    "kch123",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _books(uni: dict[str, Any], *keys: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for key in keys:
        for row in uni.get(key) or []:
            w = str(row.get("wallet") or "").lower()
            u = str(row.get("username") or "")
            if not w or w in seen:
                continue
            seen.add(w)
            out.append({"wallet": w, "username": u})
    return out


def _names(uni: dict[str, Any], key: str) -> list[str]:
    return [str(t.get("username") or "") for t in (uni.get(key) or []) if t.get("username")]


def _has_csv(row: dict[str, Any]) -> bool:
    return csv_path_for(str(row.get("wallet") or ""), str(row.get("username") or "")).exists()


def apply_take_rule_demotes(uni: dict[str, Any], live_pool: dict[str, Any]) -> list[str]:
    demoted: list[str] = []
    for row in live_pool.get("by_trader") or []:
        if int(row.get("n") or 0) >= 12 and float(row.get("roi_2c") or 0) < 0:
            demoted.append(str(row["username"]))
    if not demoted:
        return []
    demote_set = set(demoted)
    moved: list[dict[str, Any]] = []
    kept: list[dict[str, Any]] = []
    for t in uni.get("live") or []:
        if t["username"] in demote_set:
            t = dict(t)
            t["bucket"] = "bench"
            t["reasons"] = list(t.get("reasons") or []) + ["take_rule_negative"]
            moved.append(t)
        else:
            kept.append(t)
    uni["live"] = kept
    bench = [t for t in (uni.get("bench") or []) if t["username"] not in demote_set]
    uni["bench"] = moved + bench
    uni["counts"] = {
        **(uni.get("counts") or {}),
        "live": len(uni["live"]),
        "bench": len(uni["bench"]),
    }
    return demoted


def take_slice(df: pd.DataFrame, names: list[str] | None = None) -> pd.DataFrame:
    if df.empty:
        return df
    if names is None:
        sub = df
    else:
        sub = df[df["username"].isin(names)]
    if sub.empty:
        return sub
    mask = take_mask(sub) & no_futures(sub)
    return sub.loc[mask.fillna(False)].copy()


def window_stats(sub: pd.DataFrame, days: int, now: datetime) -> dict[str, Any]:
    if sub.empty:
        return {"days": days, "n": 0, "wins": 0, "win_rate": 0.0, "roi_2c": 0.0, "unit_pnl": 0.0}
    end = pd.to_datetime(sub["end_dt"], utc=True)
    cut = now - timedelta(days=days)
    hit = sub.loc[end >= cut]
    st = asof_stat(hit, 0.02)
    return {
        "days": days,
        "n": st["n"],
        "wins": st["wins"],
        "win_rate": st["win_rate"],
        "roi_2c": st["roi"],
        "unit_pnl": st["unit_pnl"],
        "first": st["first"],
        "last": st["last"],
    }


def play_row(r: Any, alert_ts: str | None, clv: dict[str, Any] | None) -> dict[str, Any]:
    fill = float(np.clip(float(r.entry) + 0.02, 0.02, 0.98))
    won = bool(r.won)
    pnl = STAKE * (1.0 / fill - 1.0) if won else -STAKE
    end_dt = pd.Timestamp(r.end_dt)
    if end_dt.tzinfo is None:
        end_iso = end_dt.tz_localize("UTC").isoformat()
    else:
        end_iso = end_dt.isoformat()
    close = (clv or {}).get("close_line")
    clv_cents = None
    clv_roi = None
    if close is not None:
        clv_cents = round((float(close) - fill) * 100.0, 2)
        clv_roi = round((float(close) / fill - 1.0) * 100.0, 2)
    return {
        "alerted_at": alert_ts or end_iso,
        "event_end": end_iso,
        "username": str(r.username),
        "title": str(r.title or "")[:120],
        "sport": str(r.sport),
        "submarket": str(r.submarket),
        "q": int(getattr(r, "q", 0) or 0),
        "rel": round(float(getattr(r, "rel", 1.0) or 1.0), 2),
        "their_vwap": round(float(r.entry), 3),
        "fill_vwap_plus_2c": round(fill, 3),
        "result": "won" if won else "lost",
        "unit_pnl": round(pnl, 2),
        "close_line": close,
        "clv_cents": clv_cents,
        "expected_clv_roi": clv_roi,
        "clob_ask_at_alert": (clv or {}).get("clob_ask"),
        "conditionId": str(getattr(r, "conditionId", "") or ""),
    }


def attach_clv(plays: pd.DataFrame, wallets: list[dict[str, str]], limit: int) -> dict[str, dict[str, Any]]:
    """CLOB close vs VWAP+2¢ fill. Keyed by conditionId|username."""
    if plays.empty or limit <= 0:
        return {}
    work = plays.sort_values("end_dt", ascending=False).head(limit).copy()
    keys: set[tuple[str, str]] = set()
    for r in work.itertuples(index=False):
        cid = str(getattr(r, "conditionId", "") or "")
        side = str(getattr(r, "side", "Yes") or "Yes")
        if cid:
            keys.add((cid, side))
    if not keys:
        return {}
    pairs = [(t["wallet"], t["username"]) for t in wallets]
    idx = build_token_index(keys, pairs)
    cache: dict[str, Any] = {}
    out: dict[str, dict[str, Any]] = {}
    fetched = 0
    for r in work.itertuples(index=False):
        cid = str(getattr(r, "conditionId", "") or "")
        side = str(getattr(r, "side", "Yes") or "Yes")
        meta = idx.get(f"{cid}|{side}") or idx.get(cid) or {}
        asset = str(meta.get("asset") or "")
        end_dt = pd.Timestamp(r.end_dt).to_pydatetime()
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)
        alert = None
        if meta.get("alert_ts"):
            try:
                alert = datetime.fromisoformat(str(meta["alert_ts"]).replace("Z", "+00:00"))
            except ValueError:
                alert = None
        if alert is None or alert >= end_dt:
            alert = end_dt - timedelta(hours=6)
        fill = float(np.clip(float(r.entry) + 0.02, 0.02, 0.98))
        ask = None
        close = None
        if asset and fetched < limit:
            hist = fetch_history(
                asset,
                int((alert - timedelta(days=2)).timestamp()),
                int((end_dt + timedelta(hours=2)).timestamp()),
                cache,
            )
            fetched += 1
            ask = lookup_price(hist, int(alert.timestamp()))
            close_p = lookup_price(hist, int((end_dt - timedelta(minutes=30)).timestamp()))
            if close_p is not None and 0.02 < close_p < 0.98:
                close = close_p
        key = f"{cid}|{r.username}|{str(r.end_dt)[:16]}"
        out[key] = {
            "alert_ts": alert.isoformat(),
            "clob_ask": round(ask, 4) if ask is not None else None,
            "close_line": round(close, 4) if close is not None else None,
            "fill": round(fill, 4),
        }
    return out


def clv_key(r: Any) -> str:
    cid = str(getattr(r, "conditionId", "") or "")
    return f"{cid}|{r.username}|{str(r.end_dt)[:16]}"


def unique_snapshot(uni: dict[str, Any], names: set[str] | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for t in uni.get("traders") or []:
        if names and t.get("username") not in names:
            continue
        rows.append({
            "username": t.get("username"),
            "wallet": t.get("wallet"),
            "bucket": t.get("bucket"),
            "take_book": t.get("take_book"),
            "joinable": t.get("joinable"),
            "recency": t.get("recency"),
            "unique_roi": t.get("unique_roi"),
            "win_rate": t.get("win_rate"),
            "median_stake": t.get("median_stake"),
            "closed": t.get("closed"),
            "events": t.get("events"),
            "last_30d_n": t.get("last_30d_n"),
            "last_30d_roi": t.get("last_30d_roi"),
            "last_60d_n": t.get("last_60d_n"),
            "last_60d_roi": t.get("last_60d_roi"),
            "last_event_date": t.get("last_event_date"),
            "reasons": t.get("reasons") or [],
            "has_csv": _has_csv(t),
        })
    return rows


def md_escape(s: str) -> str:
    return str(s or "").replace("|", "/")


def write_markdown(model: dict[str, Any]) -> None:
    uni = model["universe"]
    pools = {p["label"]: p for p in model["pools"]}
    live = ", ".join(uni.get("live") or []) or "(none)"
    bench = ", ".join(uni.get("bench") or []) or "(none)"
    lines = [
        "# Working copy model",
        "",
        f"Generated **{model['generated_at'][:19]} UTC**. Pull this file plus "
        "`pnl_analysis/output/working_copy_model.json` and "
        "`pnl_analysis/output/recent_take_alerts.json` — they are committed, not CSVs.",
        "",
        "Product rule: **`asof_live_q60_sport_rel2`** — Q≥60, sport-lane ROI≥+5%, "
        "rel≥2× median, 10–88¢, no NFL, fill VWAP+2¢, hold to resolution. "
        "Unique-book ROI/PnL is truth. Polydata month curves are discovery only.",
        "",
        "## Live copy (Take these tails these names tonight)",
        "",
        f"**{live}**",
        "",
        "| Trader | Unique ROI | WR | Median | 30d n | 30d ROI | Take-rule n | Take +2¢ | Why live |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    live_take = {t["username"]: t for t in (pools.get("live_joinable") or {}).get("by_trader") or []}
    for row in model["roster"]["live"]:
        tk = live_take.get(row["username"]) or {}
        lines.append(
            f"| {md_escape(row['username'])} | {row.get('unique_roi')}% | {row.get('win_rate')}% | "
            f"${row.get('median_stake'):,.0f} | {row.get('last_30d_n')} | {row.get('last_30d_roi')}% | "
            f"{tk.get('n', 0)} | {tk.get('roi_2c', '—')}% | joinable HOT/WARM, unique ROI≥5%, ≥8 prints/30d |"
        )
    if not model["roster"]["live"]:
        lines.append("| — | | | | | | | | Empty live book is honest. Do not fall back to Capman 12. |")
    lines += [
        "",
        "## Bench / demoted (keep the book, do not fire live)",
        "",
        f"{bench}",
        "",
        "| Trader | Bucket reason | Unique ROI | Recency | Last event | Take n | Take +2¢ |",
        "|---|---|---:|---|---|---:|---:|",
    ]
    bench_take = {t["username"]: t for t in (pools.get("live_plus_bench") or {}).get("by_trader") or []}
    matched_take = {t["username"]: t for t in (pools.get("matched_12") or {}).get("by_trader") or []}
    for row in model["roster"]["bench"]:
        tk = bench_take.get(row["username"]) or matched_take.get(row["username"]) or {}
        why = ", ".join(row.get("reasons") or []) or row.get("bucket")
        lines.append(
            f"| {md_escape(row['username'])} | {md_escape(why)} | {row.get('unique_roi')}% | "
            f"{row.get('recency')} | {row.get('last_event_date')} | {tk.get('n', 0)} | {tk.get('roi_2c', '—')}% |"
        )
    lines += [
        "",
        "## Watch (thinking about — never auto-live)",
        "",
        "| Trader | Unique ROI | WR | Median | 30d n | CSV | Take n | Take +2¢ | Stance |",
        "|---|---:|---:|---:|---:|---|---:|---:|---|",
    ]
    watch_take = {t["username"]: t for t in (pools.get("watch_candidates") or {}).get("by_trader") or []}
    for row in model["roster"]["watch"]:
        if row["username"] not in WATCH_PRIORITY and not row.get("has_csv"):
            continue
        tk = watch_take.get(row["username"]) or {}
        stance = "whale/unjoinable" if not row.get("joinable") else "screen only"
        if row.get("win_rate") and (row["win_rate"] < 48 or row["win_rate"] > 75):
            stance = "WR outside 48–75"
        if (row.get("closed") or 0) < 40:
            stance = "lottery / thin book"
        lines.append(
            f"| {md_escape(row['username'])} | {row.get('unique_roi')}% | {row.get('win_rate')}% | "
            f"${(row.get('median_stake') or 0):,.0f} | {row.get('last_30d_n')} | "
            f"{'yes' if row.get('has_csv') else 'missing'} | {tk.get('n', 0)} | {tk.get('roi_2c', '—')}% | {stance} |"
        )
    lines += [
        "",
        "## Take-rule backtests (hold to resolution, $100, VWAP+2¢)",
        "",
        "| Pool | n | WR | +2¢ ROI | Meaning |",
        "|---|---:|---:|---:|---|",
    ]
    meaning = {
        "matched_12": "Frozen historical take-book 12 (Capman-heavy). Not who we tail tonight.",
        "matched_12_minus_bots": "Take-book 12 minus 100k-fill bots.",
        "live_joinable": "Current live copy list under the product rule.",
        "live_plus_bench": "Live + demoted/quiet/whale take-book names.",
        "watch_candidates": "Names we are thinking about. extra_watch never auto-live.",
        "archive_stale": "Capman / HedgeMaster / Bienville / tcp2 / kch123 — months stale.",
        "live_after_demote": "Live list after take-rule −ROI demote (n≥12).",
    }
    for p in model["pools"]:
        lines.append(
            f"| `{p['label']}` | {p['n']} | {p['win_rate']}% | {p['roi_2c']}% | "
            f"{meaning.get(p['label'], '')} |"
        )
    recent = model.get("recent") or {}
    lines += [
        "",
        "## Recent would-fire TAKE alerts",
        "",
        "Alert time = first unique-book fill timestamp (what `/api/take-plays` would have "
        "seen on the next 90s refresh). Fill = their VWAP+2¢. Result = hold to resolution. "
        "CLV = CLOB last trade ~30 min before event end minus our fill (positive = beat the close).",
        "",
    ]
    for w in recent.get("windows") or []:
        label = "Live copy" if w.get("pool") == "live" else "Live+bench+watch hypothetical"
        lines.append(
            f"- {label} last **{w['days']}d**: n={w['n']} WR={w['win_rate']}% "
            f"+2¢ ROI={w['roi_2c']}% PnL=${w['unit_pnl']}"
        )
    clv = recent.get("clv") or {}
    lines += [
        "",
        f"CLV on the recent hypothetical tape: **{clv.get('n_with_close_line', 0)}/{clv.get('n', 0)}** "
        f"plays had a CLOB close. Avg CLV **{clv.get('avg_clv_cents', '—')}¢**, "
        f"expected CLV ROI **{clv.get('expected_clv_roi', '—')}%**, realized +2¢ ROI "
        f"**{clv.get('realized_roi', '—')}%**.",
        "",
        "### Last live-copy TAKEs (all-time as-of tape, not just 30d)",
        "",
        "| Alerted | Trader | Play | Fill | Close | CLV¢ | Result | $100 PnL |",
        "|---|---|---|---:|---:|---:|---|---:|",
    ]
    hist = recent.get("live_history") or recent.get("live_alerts") or []
    if hist:
        for a in hist[:15]:
            lines.append(
                f"| {str(a.get('alerted_at') or '')[:16]} | {md_escape(a.get('username') or '')} | "
                f"{md_escape(str(a.get('title') or '')[:48])} | {a.get('fill_vwap_plus_2c')} | "
                f"{a.get('close_line') if a.get('close_line') is not None else '—'} | "
                f"{a.get('clv_cents') if a.get('clv_cents') is not None else '—'} | "
                f"{a.get('result')} | {a.get('unit_pnl')} |"
            )
    else:
        lines.append("| — | | | | | | none on live names | |")
    lines += [
        "",
        "### Last 30d hypothetical TAKEs (bench + watch, would have fired if live)",
        "",
        "| Alerted | Pool | Trader | Play | Fill | Close | CLV¢ | Result | $100 PnL |",
        "|---|---|---|---|---:|---:|---:|---|---:|",
    ]
    hypo_rows = recent.get("hypo_alerts") or []
    if hypo_rows:
        for a in hypo_rows[:25]:
            lines.append(
                f"| {str(a.get('alerted_at') or '')[:16]} | {a.get('pool')} | "
                f"{md_escape(a.get('username') or '')} | "
                f"{md_escape(str(a.get('title') or '')[:40])} | {a.get('fill_vwap_plus_2c')} | "
                f"{a.get('close_line') if a.get('close_line') is not None else '—'} | "
                f"{a.get('clv_cents') if a.get('clv_cents') is not None else '—'} | "
                f"{a.get('result')} | {a.get('unit_pnl')} |"
            )
    else:
        lines.append("| — | | | | | | | none | |")
    lines += [
        "",
        "Full tape: `pnl_analysis/output/recent_take_alerts.json`.",
        "",
        "## Grab locally",
        "",
        "```bat",
        "git fetch origin",
        "git checkout cursor/hot-copy-polydata-51c7",
        "git pull origin cursor/hot-copy-polydata-51c7",
        "```",
        "",
        "Then copy these (small, committed):",
        "",
        "- `pnl_analysis/WORKING_COPY_MODEL.md` (this file)",
        "- `pnl_analysis/output/working_copy_model.json`",
        "- `pnl_analysis/output/recent_take_alerts.json`",
        "- `pnl_analysis/extra_traders.json`",
        "- `pnl_analysis/output/copy_universe.json`",
        "",
        "Rebuild after a unique-book ingest:",
        "",
        "```bat",
        "python pnl_analysis/rebuild_working_model.py",
        "```",
        "",
        "Do not recrawl 89 wallets to refresh this model. Incremental ingest of live+bench+watch is enough.",
        "",
        "## Fluid rules (do not retune Q/rel from a cold week)",
        "",
        "- Pause live copy if last 30d take-slice n≥25 and +2¢ ROI < 0, or last 60d n≥40 and ROI < −5%.",
        "- extra_traders `watch` never auto-promotes. Human status change required.",
        "- Unique ROI < 5%, quiet 30d n<8, median ≥$15k, WR outside 48–75, or 100k+ fills → not $100 live.",
        "- RN1 / HOG993 / mentionmarket / MM bots stay skipped.",
        "- Empty Take these is honest when nothing passes Q/rel/price tonight.",
        "",
    ]
    MODEL_MD.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild the fluid working copy model")
    parser.add_argument("--no-clv", action="store_true", help="Skip CLOB close-line fetches")
    parser.add_argument("--clv-limit", type=int, default=80, help="Max recent plays to price for CLV")
    args = parser.parse_args()
    now = _now()

    uni = write_universe(build_universe())
    live_names = _names(uni, "live")
    bench_names = _names(uni, "bench")
    watch_names = _names(uni, "watch")
    take_names = [t["username"] for t in uni.get("take_book_matched") or []]
    skip_names = {t["username"] for t in uni.get("skip") or []}
    kicked_names = {t["username"] for t in uni.get("kicked") or []}

    extra = _books(uni, "live", "bench", "watch")
    # Frozen take-book 12 (including stale Capman/tcp2/kch123) comes in via trusted.
    # Do not pull skip mega books (RN1, BoomLaLa, …) into collect_plays.
    print(f"[model] live={live_names}")
    print(f"[model] bench={bench_names}")
    df = collect_plays(uni.get("take_book_matched") or [], extra_books=extra)
    if df.empty:
        print("[model] no as-of plays")
        return 1
    df = df.copy()
    if "conditionId" not in df.columns:
        df["conditionId"] = ""
    if "side" not in df.columns:
        df["side"] = "Yes"

    take_all = take_mask(df)
    sports_m = ~politics_other(df) & no_futures(df)
    other_m = politics_other(df) & no_futures(df)
    fut = ~no_futures(df)

    watch_priority = [n for n in watch_names if n in WATCH_PRIORITY]
    pools = [
        pool_stat(df, take_names, "matched_12"),
        pool_stat(df, [n for n in take_names if n not in skip_names], "matched_12_minus_bots"),
        pool_stat(df, live_names, "live_joinable"),
        pool_stat(df, live_names + [n for n in bench_names if n not in live_names], "live_plus_bench"),
        pool_stat(df, watch_priority, "watch_candidates"),
        pool_stat(df, [n for n in take_names if n in ARCHIVE_STALE], "archive_stale"),
    ]
    live_pool = next((p for p in pools if p["label"] == "live_joinable"), {"by_trader": []})
    demoted = apply_take_rule_demotes(uni, live_pool)
    if demoted:
        print(f"[model] demote from live (take-rule −ROI n≥12): {demoted}")
        live_names = _names(uni, "live")
        bench_names = _names(uni, "bench")
        pools.append(pool_stat(df, live_names, "live_after_demote"))

    live_m = df["username"].isin(live_names)
    take_nf = df.loc[(take_all & no_futures(df) & live_m).fillna(False)]
    lane_payload = {
        "generated_at": now.isoformat(),
        "rule": (
            "asof_live_q60_sport_rel2 (Q>=60, sport ROI>=5%, rel>=2, 10-88c, no NFL, "
            "fill VWAP+2c). Futures excluded from product."
        ),
        "all": _lane_stats(take_nf),
        "sports": _lane_stats(df.loc[(take_all & sports_m & live_m).fillna(False)]),
        "other": _lane_stats(df.loc[(take_all & other_m & live_m).fillna(False)]),
        "futures_excluded": _lane_stats(df.loc[(take_all & fut).fillna(False)]),
        "by_submarket": {},
        "note": (
            "Sports = game ML/spread/total. Other = politics / non-game (no futures). "
            "Live copy list is joinable HOT/WARM unique-ROI books only (see copy_universe.json)."
        ),
    }
    for key, grp in take_nf.groupby("submarket"):
        if str(key).lower().startswith("future"):
            continue
        lane_payload["by_submarket"][str(key)] = _lane_stats(grp)

    LANE_OUT.write_text(json.dumps(lane_payload, indent=2), encoding="utf-8")
    EVOLVE_OUT.write_text(
        json.dumps(
            {
                "generated_at": now.isoformat(),
                "pools": pools,
                "live": live_names,
                "bench": bench_names,
                "watch": watch_names,
                "demoted_take_rule": demoted,
                "lane": lane_payload,
            },
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )
    uni["backtest"] = {p["label"]: {"n": p["n"], "win_rate": p["win_rate"], "roi_2c": p["roi_2c"]} for p in pools}
    write_universe(uni)

    cols = [c for c in [
        "username", "wallet", "end_dt", "conditionId", "side", "sport", "sport_family",
        "submarket", "title", "won", "entry", "cost", "q", "rel", "n_prior",
        "sport_roi", "lane_ok", "pnl_2c",
    ] if c in df.columns]
    df.loc[take_all.fillna(False), cols].to_csv(PLAYS_CSV, index=False)
    print(f"[model] wrote {PLAYS_CSV} n={int(take_all.fillna(False).sum())}")

    live_takes = take_slice(df, live_names)
    bench_takes = take_slice(df, bench_names)
    watch_takes = take_slice(df, watch_priority)
    recent_live = live_takes
    if not live_takes.empty:
        end = pd.to_datetime(live_takes["end_dt"], utc=True)
        recent_live = live_takes.loc[end >= now - timedelta(days=30)]
    hypo = pd.concat([live_takes, bench_takes, watch_takes], ignore_index=True) if not live_takes.empty or not bench_takes.empty or not watch_takes.empty else live_takes
    if not hypo.empty:
        hypo = hypo.drop_duplicates(subset=["username", "conditionId", "end_dt"], keep="first")
        end = pd.to_datetime(hypo["end_dt"], utc=True)
        hypo_recent = hypo.loc[end >= now - timedelta(days=30)]
    else:
        hypo_recent = hypo

    clv_map: dict[str, dict[str, Any]] = {}
    clv_src_df = hypo_recent
    if not live_takes.empty:
        live_hist_df = live_takes.sort_values("end_dt", ascending=False).head(20)
        clv_src_df = pd.concat([hypo_recent, live_hist_df], ignore_index=True)
        clv_src_df = clv_src_df.drop_duplicates(subset=["username", "conditionId", "end_dt"], keep="first")
    if not args.no_clv and not clv_src_df.empty:
        print(f"[model] fetching CLOB CLV for {min(len(clv_src_df), args.clv_limit)} recent/history plays")
        clv_map = attach_clv(clv_src_df, extra, args.clv_limit)

    live_alerts = []
    live_history = []
    if not live_takes.empty:
        recent_sorted = live_takes.sort_values("end_dt", ascending=False)
        end = pd.to_datetime(live_takes["end_dt"], utc=True)
        recent_only = live_takes.loc[end >= now - timedelta(days=30)].sort_values("end_dt", ascending=False)
        for r in recent_only.itertuples(index=False):
            meta = clv_map.get(clv_key(r), {})
            live_alerts.append(play_row(r, meta.get("alert_ts"), meta))
        for r in recent_sorted.head(20).itertuples(index=False):
            meta = clv_map.get(clv_key(r), {})
            live_history.append(play_row(r, meta.get("alert_ts"), meta))

    hypo_alerts = []
    if not hypo_recent.empty:
        for r in hypo_recent.sort_values("end_dt", ascending=False).itertuples(index=False):
            meta = clv_map.get(clv_key(r), {})
            row = play_row(r, meta.get("alert_ts"), meta)
            if r.username in live_names:
                row["pool"] = "live"
            elif r.username in bench_names:
                row["pool"] = "bench"
            else:
                row["pool"] = "watch"
            hypo_alerts.append(row)

    clv_src = hypo_alerts or live_history
    clv_rows = [a for a in clv_src if a.get("close_line") is not None]
    realized = [a["unit_pnl"] / STAKE for a in clv_src]
    clv_summary = {
        "n": len(clv_src),
        "n_with_close_line": len(clv_rows),
        "coverage": round(len(clv_rows) / max(len(clv_src), 1), 3),
        "avg_clv_cents": round(float(np.mean([a["clv_cents"] for a in clv_rows])), 2) if clv_rows else None,
        "expected_clv_roi": round(float(np.mean([a["expected_clv_roi"] for a in clv_rows])), 2) if clv_rows else None,
        "realized_roi": round(float(np.mean(realized) * 100.0), 2) if realized else None,
        "note": (
            "CLV uses CLOB prices-history last trade ~30 min before event end vs VWAP+2¢ fill. "
            "Resolved 0/1 is the result; CLV is whether we beat the close line. "
            "Live copy fired 0 TAKEs in the last 30d — CLV below is the hypothetical bench+watch tape."
        ),
    }

    windows = []
    for days in WINDOWS:
        w = window_stats(live_takes, days, now)
        w["pool"] = "live"
        windows.append(w)
        w2 = window_stats(hypo, days, now)
        w2["pool"] = "live_bench_watch"
        windows.append(w2)

    roster = {
        "live": unique_snapshot(uni, set(live_names)),
        "bench": unique_snapshot(uni, set(bench_names)),
        "watch": unique_snapshot(uni, set(watch_names) | WATCH_PRIORITY),
        "kicked": unique_snapshot(uni, kicked_names),
        "archive_stale": unique_snapshot(uni, ARCHIVE_STALE),
    }
    model = {
        "generated_at": now.isoformat(),
        "strategy": STRATEGY_ID,
        "stake": STAKE,
        "fill": "vwap_plus_2c",
        "universe": {
            "generated_at": uni.get("generated_at"),
            "counts": uni.get("counts"),
            "live": live_names,
            "bench": bench_names,
            "watch": watch_names,
            "demoted_take_rule": demoted,
            "method": uni.get("method"),
        },
        "pools": [
            {
                "label": p["label"],
                "n": p["n"],
                "win_rate": p["win_rate"],
                "roi_2c": p["roi_2c"],
                "by_trader": p.get("by_trader") or [],
            }
            for p in pools
        ],
        "lane": lane_payload,
        "roster": roster,
        "recent": {
            "windows": windows,
            "clv": clv_summary,
            "live_alerts": live_alerts[:80],
            "live_history": live_history[:20],
            "hypo_alerts": hypo_alerts[:40],
        },
        "missing_csv": [
            {"username": t.get("username"), "wallet": t.get("wallet"), "bucket": t.get("bucket")}
            for t in (uni.get("live") or []) + (uni.get("bench") or []) + (uni.get("watch") or [])
            if not _has_csv(t) and (t.get("username") in WATCH_PRIORITY or t.get("bucket") in {"live", "bench"})
        ],
    }
    MODEL_JSON.write_text(json.dumps(model, indent=2, default=str), encoding="utf-8")
    ALERTS_JSON.write_text(
        json.dumps(
            {
                "generated_at": now.isoformat(),
                "strategy": STRATEGY_ID,
                "clv": clv_summary,
                "windows": windows,
                "live": live_alerts,
                "live_history": live_history,
                "hypothetical_live_bench_watch": hypo_alerts[:120],
            },
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )
    write_markdown(model)
    print(f"[model] wrote {MODEL_JSON}")
    print(f"[model] wrote {ALERTS_JSON}")
    print(f"[model] wrote {MODEL_MD}")
    print(f"  LIVE {live_names}  take n={lane_payload['all']['n']} WR={lane_payload['all']['win_rate']}% roi={lane_payload['all']['roi_2c']}%")
    for w in windows:
        if w.get("pool") == "live":
            print(f"  last {w['days']:>2}d live TAKEs n={w['n']:<3} WR={w['win_rate']}% roi={w['roi_2c']}% pnl=${w['unit_pnl']}")
    print(f"  CLV {clv_summary['n_with_close_line']}/{clv_summary['n']} avg={clv_summary['avg_clv_cents']}¢")
    for p in pools:
        print(f"  {p['label']:<24} n={p['n']:>4} WR={p['win_rate']}% +2¢={p['roi_2c']}%")
        for t in (p.get("by_trader") or [])[:8]:
            print(f"      {t['username']:<32} n={t['n']:<4} WR={t['win_rate']}% roi={t['roi_2c']}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
