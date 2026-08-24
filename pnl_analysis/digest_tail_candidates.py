#!/usr/bin/env python3
"""Digest who to tail: unique book + how they win + take-rule + CLV.

Runs on live + bench + priority watch from copy_universe / extra_traders.
Does not recrawl the whole roster. Writes:

  pnl_analysis/TAIL_DIGEST.md
  pnl_analysis/output/tail_digest.json

Usage:
  python pnl_analysis/digest_tail_candidates.py
  python pnl_analysis/digest_tail_candidates.py --clv-limit 120
  python pnl_analysis/digest_tail_candidates.py --no-clv
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
from asof_fullbook_backtest import STAKE, asof_stat, collect_plays  # noqa: E402
from copy_roster import EXTRA_PATH, OUTPUT_DIR, ROOT, load_universe  # noqa: E402
from evolve_copy_book import no_futures, take_mask  # noqa: E402
from position_utils import read_trader_csv  # noqa: E402
from robust_tail_research import (  # noqa: E402
    build_token_index,
    fetch_history,
    lookup_price,
)
from run_full_pipeline import csv_path_for  # noqa: E402
from screen_hot_copy import sport_mix, unique_book_slices  # noqa: E402
from walkforward_consensus_backtest import load_trader_markets  # noqa: E402

OUT_JSON = OUTPUT_DIR / "tail_digest.json"
OUT_MD = ROOT / "TAIL_DIGEST.md"

PRIORITY_WATCH = {
    "HongYunX",
    "HVAB",
    "0xE30E74595517de48f1FB19f4553dd3d9F1E96B87",
    "SineNooneEI",
    "theowalcott",
    "SDTrading",
    "Sassy-Bucket",
    "CoryLahey",
    "ShucksIt69",
    "UAEVALORANTFAN",
    "0x1b20a00709DfE648AFd26b326394b5e031f83ab0",
    "bigspending",
    "WTSA",
    "Supah9ga",
    "Vetch",
    "DLEK",
}


def _f(v: Any) -> float | None:
    try:
        if v is None:
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _load_extra_notes() -> dict[str, str]:
    data = json.loads(EXTRA_PATH.read_text(encoding="utf-8")) if EXTRA_PATH.exists() else []
    out: dict[str, str] = {}
    if not isinstance(data, list):
        return out
    for row in data:
        if isinstance(row, dict) and row.get("username"):
            out[str(row["username"])] = str(row.get("notes") or "")
    return out


def candidate_books(uni: dict[str, Any]) -> list[dict[str, Any]]:
    """Live + bench + every watch/bench name that has a CSV (not just PRIORITY_WATCH)."""
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for bucket in ("live", "bench", "watch"):
        for t in uni.get(bucket) or []:
            w = str(t.get("wallet") or "").lower()
            u = str(t.get("username") or "")
            if not w or w in seen:
                continue
            csv_p = csv_path_for(w, u)
            if bucket == "watch" and not csv_p.exists():
                continue
            seen.add(w)
            rows.append({**t, "bucket": bucket})
    return rows


def price_bucket(px: float) -> str:
    if px < 0.30:
        return "dog_<30c"
    if px < 0.45:
        return "dog_30_45"
    if px < 0.55:
        return "coin_45_55"
    if px < 0.70:
        return "fav_55_70"
    return "chalk_70plus"


def slice_table(df: pd.DataFrame, col: str, min_n: int = 8) -> list[dict[str, Any]]:
    if df.empty or col not in df.columns:
        return []
    out: list[dict[str, Any]] = []
    for key, grp in df.groupby(col):
        if len(grp) < min_n:
            continue
        st = asof_stat(grp, 0.02)
        out.append({
            "key": str(key),
            "n": st["n"],
            "win_rate": st["win_rate"],
            "roi_2c": st["roi"],
            "unit_pnl": st["unit_pnl"],
            "avg_fill": st["avg_fill"],
            "edge": st["edge"],
        })
    out.sort(key=lambda r: (-r["n"], -r["roi_2c"]))
    return out


def how_they_win(mk: pd.DataFrame) -> dict[str, Any]:
    """Hold-to-res unique markets after warmup filters are applied upstream."""
    if mk.empty:
        return {"n": 0}
    work = mk.copy()
    work["price_bucket"] = work["entry_price"].map(price_bucket)
    work["won"] = work["won"].astype(bool)
    # Fake asof columns for asof_stat
    work = work.rename(columns={"entry_price": "entry", "sport_type": "sport"})
    work["q"] = 0
    work["rel"] = 1.0
    sports = slice_table(work, "sport", min_n=5)
    subs = slice_table(work, "submarket", min_n=5)
    prices = slice_table(work, "price_bucket", min_n=5)
    # Outsized: cost >= 2x median
    med = float(work["cost"].median()) if len(work) else 0.0
    big = work[work["cost"] >= max(med * 2.0, 1.0)] if med > 0 else work.iloc[0:0]
    flat = work[work["cost"] < max(med * 2.0, 1.0)] if med > 0 else work
    return {
        "n": int(len(work)),
        "wr": round(float(work["won"].mean() * 100.0), 2) if len(work) else 0.0,
        "median_cost": round(med, 2),
        "by_sport": sports[:8],
        "by_submarket": subs[:8],
        "by_price": prices,
        "outsized_2x": asof_stat(big.rename(columns={"entry": "entry"}), 0.02) if not big.empty else {"n": 0},
        "under_2x": asof_stat(flat.rename(columns={"entry": "entry"}), 0.02) if not flat.empty else {"n": 0},
        "top_edge": sorted(
            [s for s in sports if s["n"] >= 12],
            key=lambda r: -r["roi_2c"],
        )[:3],
    }


def take_breakdown(sub: pd.DataFrame) -> dict[str, Any]:
    if sub.empty:
        return {"n": 0, "win_rate": 0.0, "roi_2c": 0.0, "by_sport": [], "by_submarket": [], "by_price": []}
    work = sub.copy()
    work["price_bucket"] = work["entry"].map(price_bucket)
    st = asof_stat(work, 0.02)
    return {
        "n": st["n"],
        "win_rate": st["win_rate"],
        "roi_2c": st["roi"],
        "unit_pnl": st["unit_pnl"],
        "first": st["first"],
        "last": st["last"],
        "by_sport": slice_table(work, "sport", min_n=3)[:8],
        "by_submarket": slice_table(work, "submarket", min_n=3)[:8],
        "by_price": slice_table(work, "price_bucket", min_n=3),
    }


def clv_for_plays(
    plays: pd.DataFrame,
    wallet: str,
    username: str,
    limit: int,
) -> dict[str, Any]:
    if plays.empty or limit <= 0:
        return {"n": 0, "n_with_close": 0, "coverage": 0.0}
    work = plays.sort_values("end_dt", ascending=False).head(limit).copy()
    keys: set[tuple[str, str]] = set()
    for r in work.itertuples(index=False):
        cid = str(getattr(r, "conditionId", "") or "")
        side = str(getattr(r, "side", "Yes") or "Yes")
        if cid:
            keys.add((cid, side))
    if not keys:
        return {"n": int(len(work)), "n_with_close": 0, "coverage": 0.0, "note": "no_conditionId"}
    idx = build_token_index(keys, [(wallet, username)])
    cache: dict[str, Any] = {}
    clv_cents: list[float] = []
    expected: list[float] = []
    realized: list[float] = []
    sample: list[dict[str, Any]] = []
    fetched = 0
    for r in work.itertuples(index=False):
        cid = str(getattr(r, "conditionId", "") or "")
        side = str(getattr(r, "side", "Yes") or "Yes")
        meta = idx.get(f"{cid}|{side}") or {}
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
        won = bool(r.won)
        realized.append((1.0 / fill - 1.0) if won else -1.0)
        close = None
        ask = None
        if asset and fetched < limit:
            hist = fetch_history(
                asset,
                int((alert - timedelta(days=2)).timestamp()),
                int((end_dt + timedelta(hours=2)).timestamp()),
                cache,
            )
            fetched += 1
            ask = lookup_price(hist, int(alert.timestamp()))
            # Thin sports books often miss exact t-30m; walk a few offsets.
            for mins in (30, 15, 5, 60, 120):
                close_p = lookup_price(hist, int((end_dt - timedelta(minutes=mins)).timestamp()))
                if close_p is not None and 0.02 < close_p < 0.98:
                    close = close_p
                    break
            if close is None and ask is not None and 0.02 < ask < 0.98:
                # Last resort: alert-time mid as close proxy when end-window is empty.
                close = ask
        if close is not None:
            clv_cents.append((close - fill) * 100.0)
            expected.append(close / fill - 1.0)
        if len(sample) < 8:
            sample.append({
                "end": str(end_dt)[:10],
                "title": str(r.title or "")[:70],
                "fill": round(fill, 3),
                "close": round(close, 3) if close is not None else None,
                "clv_cents": round((close - fill) * 100.0, 2) if close is not None else None,
                "won": won,
                "pnl": round(STAKE * ((1.0 / fill - 1.0) if won else -1.0), 2),
                "clob_ask": round(ask, 3) if ask is not None else None,
            })
    n = len(realized)
    n_clv = len(clv_cents)
    return {
        "n": n,
        "n_with_close": n_clv,
        "coverage": round(n_clv / max(n, 1), 3),
        "avg_clv_cents": round(float(np.mean(clv_cents)), 2) if n_clv else None,
        "expected_clv_roi": round(float(np.mean(expected) * 100.0), 2) if n_clv else None,
        "realized_roi_2c": round(float(np.mean(realized) * 100.0), 2) if n else None,
        "sample": sample,
    }


def score_tail(row: dict[str, Any]) -> tuple[float, str]:
    """Higher = better $100 joinable tail candidate."""
    take = row.get("take") or {}
    unique = row.get("unique") or {}
    clv = row.get("clv") or {}
    n = int(take.get("n") or 0)
    roi = _f(take.get("roi_2c")) or 0.0
    uroi = _f(unique.get("roi")) or 0.0
    med = _f(unique.get("median_stake")) or 0.0
    last30 = unique.get("last_30d") or {}
    last30_n = int(last30.get("n") or 0)
    last30_roi = _f(last30.get("roi")) or 0.0
    bucket = row.get("bucket") or ""
    joinable = bool(row.get("joinable"))
    wr = _f(unique.get("win_rate")) or 0.0

    if bucket == "live" and n >= 12 and roi > 0 and joinable:
        return 90.0 + min(roi, 20), "live + take-rule +ROI"
    if joinable and n >= 12 and roi >= 5 and 48 <= wr <= 75 and last30_n >= 8:
        return 80.0 + min(roi, 15), "joinable take-rule edge"
    if joinable and uroi >= 8 and last30_n >= 20 and last30_roi > -5 and n >= 8 and roi > 0:
        return 70.0 + min(uroi / 2, 10), "hot unique + thin take +"
    if joinable and uroi >= 5 and last30_n >= 8 and (n < 12 or roi >= 0):
        return 55.0 + min(uroi / 3, 8), "watch promote candidate"
    if not joinable and uroi >= 10 and n >= 12 and roi > 0:
        return 40.0, "whale — 10% size only"
    if n >= 12 and roi < 0:
        return 15.0, "take-rule bleed — do not promote"
    if last30_n < 8 and bucket != "live":
        return 20.0, "too quiet"
    clv_c = _f(clv.get("avg_clv_cents"))
    if clv_c is not None and clv_c > 0 and n >= 8 and roi > 0:
        return 65.0 + min(clv_c, 10), "beats close + take +"
    return 30.0 + min(uroi / 5, 10), "screen only"


def digest_one(
    t: dict[str, Any],
    plays_by_user: dict[str, pd.DataFrame],
    notes: dict[str, str],
    clv_limit: int,
) -> dict[str, Any]:
    username = str(t.get("username") or "")
    wallet = str(t.get("wallet") or "").lower()
    csv_p = csv_path_for(wallet, username)
    has_csv = csv_p.exists()
    unique: dict[str, Any] = {
        "roi": t.get("unique_roi"),
        "win_rate": t.get("win_rate"),
        "median_stake": t.get("median_stake"),
        "closed": t.get("closed"),
        "events": t.get("events"),
        "last_30d_n": t.get("last_30d_n"),
        "last_30d_roi": t.get("last_30d_roi"),
        "last_event_date": t.get("last_event_date"),
        "recency": t.get("recency"),
    }
    mix: dict[str, Any] = {}
    how: dict[str, Any] = {"n": 0}
    slices: dict[str, Any] = {}
    if has_csv:
        try:
            mix = sport_mix(csv_p)
            slices = unique_book_slices(csv_p, username, wallet)
            life = slices.get("lifetime") or {}
            last30 = slices.get("last_30d") or {}
            if life.get("n"):
                unique["roi"] = life.get("roi", unique.get("roi"))
                unique["win_rate"] = life.get("win_rate", unique.get("win_rate"))
            unique["last_30d"] = {
                "n": last30.get("n", unique.get("last_30d_n")),
                "roi": last30.get("roi", unique.get("last_30d_roi")),
                "wr": last30.get("win_rate"),
                "pnl": last30.get("pnl"),
            }
            unique["outsized"] = slices.get("outsized") or {}
            unique["outsized_30d"] = slices.get("outsized_30d") or {}
            json_p = csv_p.with_suffix(".json")
            if json_p.exists():
                try:
                    analysis = json.loads(json_p.read_text(encoding="utf-8"))
                    unique["dashboard_pnl"] = analysis.get("dashboard_pnl") or analysis.get("total_profit")
                    unique["median_stake"] = analysis.get("median_market_stake", unique.get("median_stake"))
                    unique["win_rate"] = analysis.get("win_rate", unique.get("win_rate"))
                    unique["roi"] = analysis.get("overall_roi", unique.get("roi"))
                except Exception:
                    pass
            mk = load_trader_markets(csv_p, username, wallet)
            how = how_they_win(mk)
        except Exception as exc:
            mix = {"error": str(exc)}
    take_df = plays_by_user.get(username, pd.DataFrame())
    take = take_breakdown(take_df)
    clv: dict[str, Any] = {"n": 0, "n_with_close": 0, "coverage": 0.0}
    if clv_limit > 0 and not take_df.empty:
        print(f"  CLV {username:<36} take_n={len(take_df)} limit={min(len(take_df), clv_limit)}")
        clv = clv_for_plays(take_df, wallet, username, min(len(take_df), clv_limit))
    row = {
        "username": username,
        "wallet": wallet,
        "bucket": t.get("bucket"),
        "joinable": t.get("joinable"),
        "reasons": t.get("reasons") or [],
        "has_csv": has_csv,
        "notes": notes.get(username, ""),
        "unique": unique,
        "mix": mix,
        "how_they_win": how,
        "take": take,
        "clv": clv,
    }
    score, why = score_tail(row)
    row["tail_score"] = round(score, 1)
    row["tail_why"] = why
    return row


def write_md(payload: dict[str, Any]) -> None:
    rows = payload.get("traders") or []
    live = [r for r in rows if r.get("bucket") == "live"]
    bleed = [r for r in rows if "bleed" in str(r.get("tail_why") or "").lower()]
    clv_ok = [r for r in rows if (r.get("clv") or {}).get("n_with_close")]
    lines = [
        "# Tail digest — who to copy and how they win",
        "",
        f"Generated **{payload['generated_at'][:19]} UTC**.",
        "",
        "Unique closed+open books are truth. Polydata month curves are discovery only.",
        "Take rule = product `asof_live_q60_sport_rel2` (Q≥60, sport ROI≥+5%, rel≥2×, 10–88¢, no NFL, VWAP+2¢).",
        "CLV = CLOB last trade ~30 min before event end minus our VWAP+2¢ fill (positive = beat the close).",
        "",
        "## Executive read",
        "",
        f"- **Live tonight:** {', '.join(r.get('username') or '?' for r in live) or '(none — empty Take these is honest)'}",
        f"- **Take-rule bleed (do not promote):** {', '.join(r.get('username') or '?' for r in bleed[:8]) or '—'}",
        f"- **CLV priced:** {len(clv_ok)}/{len(rows)} traders have ≥1 close print. "
        "UFC/NBA/tennis often return 0/n (thin CLOB history). Soccer whales usually have coverage. "
        "Negative CLV + positive hold-to-res = paid at settlement, not beating the line.",
        "- **Gap still real:** we digest live + bench + priority watch only — not every Polydata name. "
        "Promote only when take-rule n≥12 and +ROI, joinable median, WR 48–75, HOT, unique ROI≥5%.",
        "",
        "## Ranked tail list",
        "",
        "| Rank | Trader | Bucket | Score | Unique ROI | Take n / +2¢ | CLV¢ (cov) | How they win | Verdict |",
        "|---:|---|---|---:|---:|---|---|---|---|",
    ]
    for i, r in enumerate(rows, 1):
        u = r.get("unique") or {}
        take = r.get("take") or {}
        clv = r.get("clv") or {}
        how = r.get("how_they_win") or {}
        tops = how.get("top_edge") or []
        how_s = ", ".join(f"{t['key']} {t['roi_2c']}%" for t in tops[:2]) or "—"
        clv_s = (
            f"{clv.get('avg_clv_cents')} ({clv.get('n_with_close')}/{clv.get('n')})"
            if clv.get("n")
            else "—"
        )
        lines.append(
            f"| {i} | {r.get('username')} | {r.get('bucket')} | {r.get('tail_score')} | "
            f"{u.get('roi')}% | {take.get('n', 0)} / {take.get('roi_2c', '—')}% | {clv_s} | "
            f"{how_s} | {r.get('tail_why')} |"
        )
    lines += ["", "## Per-trader strategy cards", ""]
    for r in rows:
        u = r.get("unique") or {}
        take = r.get("take") or {}
        clv = r.get("clv") or {}
        how = r.get("how_they_win") or {}
        mix = r.get("mix") or {}
        lines += [
            f"### {r.get('username')} ({r.get('bucket')})",
            "",
            f"- **Verdict:** {r.get('tail_why')} (score {r.get('tail_score')})",
            f"- **Unique:** ROI {u.get('roi')}% · WR {u.get('win_rate')}% · median ${u.get('median_stake')} · "
            f"closed {u.get('closed')} · last event {u.get('last_event_date')} · "
            f"30d n={((u.get('last_30d') or {}).get('n'))} ROI={((u.get('last_30d') or {}).get('roi'))}%",
            f"- **Joinable $100:** {r.get('joinable')} · reasons: {', '.join(r.get('reasons') or []) or '—'}",
            f"- **Sport mix:** {mix.get('top') or mix.get('error') or '—'}",
            f"- **Take-rule:** n={take.get('n')} WR={take.get('win_rate')}% +2¢={take.get('roi_2c')}% "
            f"({take.get('first')} → {take.get('last')})",
            f"- **CLV:** avg {clv.get('avg_clv_cents')}¢ · expected CLV ROI {clv.get('expected_clv_roi')}% · "
            f"realized +2¢ {clv.get('realized_roi_2c')}% · coverage {clv.get('n_with_close')}/{clv.get('n')}",
        ]
        if how.get("top_edge"):
            lines.append("- **Best hold-to-res edges:**")
            for t in how["top_edge"]:
                lines.append(f"  - {t['key']}: n={t['n']} WR={t['win_rate']}% +2¢={t['roi_2c']}%")
        if take.get("by_sport"):
            lines.append("- **Take-rule by sport:**")
            for t in (take.get("by_sport") or [])[:5]:
                lines.append(f"  - {t['key']}: n={t['n']} WR={t['win_rate']}% +2¢={t['roi_2c']}%")
        if take.get("by_price"):
            lines.append("- **Take-rule by price:**")
            for t in take.get("by_price") or []:
                lines.append(f"  - {t['key']}: n={t['n']} WR={t['win_rate']}% +2¢={t['roi_2c']}%")
        outsized = how.get("outsized_2x") or {}
        under = how.get("under_2x") or {}
        if outsized.get("n") or under.get("n"):
            lines.append(
                f"- **Size:** ≥2× median n={outsized.get('n', 0)} +2¢={outsized.get('roi', '—')}% · "
                f"<2× n={under.get('n', 0)} +2¢={under.get('roi', '—')}%"
            )
        if r.get("notes"):
            lines.append(f"- **Notes:** {r['notes']}")
        if clv.get("sample"):
            lines.append("- **CLV sample:**")
            for s in clv["sample"][:5]:
                lines.append(
                    f"  - {s.get('end')} {s.get('title')} fill={s.get('fill')} close={s.get('close')} "
                    f"CLV={s.get('clv_cents')}¢ {'W' if s.get('won') else 'L'} ${s.get('pnl')}"
                )
        lines.append("")
    lines += [
        "## How to use this",
        "",
        "1. Tail only **live** on Take these tonight.",
        "2. Promote a watch name only if take-rule n≥12 and +ROI, joinable median, WR 48–75, HOT, unique ROI≥5%.",
        "3. Positive CLV + positive hold-to-res = sharp. Positive hold / negative CLV = getting paid at settlement, not beating the line.",
        "4. Rebuild: `python pnl_analysis/digest_tail_candidates.py`",
        "",
    ]
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-clv", action="store_true")
    parser.add_argument("--clv-limit", type=int, default=80, help="Max take-rule plays to price per trader")
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    uni = load_universe()
    notes = _load_extra_notes()
    cands = candidate_books(uni)
    print(f"[digest] candidates={len(cands)} live/bench/priority-watch")

    books = [{"wallet": c["wallet"], "username": c["username"]} for c in cands]
    take_book = uni.get("take_book_matched") or []
    df = collect_plays(take_book, extra_books=books)
    if df.empty:
        print("[digest] no plays")
        return 1
    if "conditionId" not in df.columns:
        df["conditionId"] = ""
    if "side" not in df.columns:
        df["side"] = "Yes"
    mask = take_mask(df) & no_futures(df)
    take_all = df.loc[mask.fillna(False)].copy()
    plays_by_user = {str(name): grp for name, grp in take_all.groupby("username")}

    clv_limit = 0 if args.no_clv else args.clv_limit
    traders: list[dict[str, Any]] = []
    for c in cands:
        print(f"[digest] {c.get('bucket'):<6} {c.get('username')}")
        traders.append(digest_one(c, plays_by_user, notes, clv_limit))
    traders.sort(key=lambda r: -float(r.get("tail_score") or 0))

    payload = {
        "generated_at": now.isoformat(),
        "method": (
            "Unique book + as-of take-rule + CLOB CLV. Ranked for $100 joinable tail. "
            "extra_watch never auto-live."
        ),
        "strategy": "asof_live_q60_sport_rel2",
        "counts": {
            "candidates": len(traders),
            "with_csv": sum(1 for t in traders if t.get("has_csv")),
            "take_plays": int(len(take_all)),
        },
        "traders": traders,
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    write_md(payload)
    print(f"[digest] wrote {OUT_JSON}")
    print(f"[digest] wrote {OUT_MD}")
    for t in traders[:12]:
        take = t.get("take") or {}
        clv = t.get("clv") or {}
        print(
            f"  {t['tail_score']:>5} {t['bucket']:<6} {t['username']:<32} "
            f"take n={take.get('n', 0):<3} roi={take.get('roi_2c')}% "
            f"CLV={clv.get('avg_clv_cents')}¢  {t['tail_why']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
