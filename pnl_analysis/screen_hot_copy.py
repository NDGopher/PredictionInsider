#!/usr/bin/env python3
"""Honest unique-book screen + take-rule / 10% copy backtest for hot names.

Does not use Polydata equity curves as product truth. Unique closed+open CSV
→ dashboard PnL, sport mix, joinability, hold-to-res take rule, 10% size bankroll.

Writes:
  pnl_analysis/output/hot_copy_screen.json
  pnl_analysis/HOT_COPY_SCREEN.md

Usage:
  python pnl_analysis/discover_polydata_boards.py
  python pnl_analysis/run_full_pipeline.py --incremental --traders NAME1,NAME2
  python pnl_analysis/screen_hot_copy.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_trader import analyze_csv, get_market_type, get_sport  # noqa: E402
from asof_fullbook_backtest import collect_plays  # noqa: E402
from copy_roster import MEDIAN_JOIN_MAX, WR_HI, WR_LO  # noqa: E402
from evolve_copy_book import no_futures, take_mask  # noqa: E402
from position_utils import read_trader_csv  # noqa: E402
from run_full_pipeline import OUTPUT_DIR, csv_path_for, json_path_for  # noqa: E402
from walkforward_consensus_backtest import load_trader_markets  # noqa: E402

OUT_JSON = OUTPUT_DIR / "hot_copy_screen.json"
OUT_MD = Path(__file__).resolve().parent / "HOT_COPY_SCREEN.md"

# User-named + Polydata month sports names we must digest this pass.
NAMED: list[tuple[str, str, str]] = [
    ("0x8a3ab8120807bd64a3de48695110e390fa2ceb9a", "0x8a3aB8120807bD64a3De48695110e390fa2ceB9a", "live_flat_curve"),
    ("0x5966db1fe50763c9e3c014d756369bad07e1f804", "0x5966Db1fE50763C9e3C014d756369BAd07E1F804", "elite_curve_stale"),
    ("0xc5b5bbd42624a8f0c8dfa90221913007d8c77e80", "Capman", "quit_4mo"),
    ("0x036c159d5a348058a81066a76b89f35926d4178d", "HedgeMaster88", "quit_3mo"),
    ("0x04d5524a0a5af2eca6e39e03defc261d42fe66d8", "WTSA", "user_wants_live"),
    ("0x5268527977f700f9bf9b6d5cd843859e4e70135d", "HomeRunHazard", "user_equity_curve"),
    ("0xfe787d2da716d60e8acff57fb87eb13cd4d10319", "ferrariChampions2026", "user_equity_curve"),
    ("0x4bff30af91642dc7d2b19a8664378fe55c45fc26", "Sassy-Bucket", "user_month_hot"),
    ("0x16bb9951a36fce71e2ef57890b786145e0ba8492", "SDTrading", "user_month_hot"),
    ("0x6ac5bb06a9eb05641fd5e82640268b92f3ab4b6e", "0p0jogggg", "Lakersfan111_volatile"),
    ("0xe30e74595517de48f1fb19f4553dd3d9f1e96b87", "0xE30E74595517de48f1FB19f4553dd3d9F1E96B87", "user_1m_curve"),
    ("0x7ad71d79a3bb90d0a87a06500fa0fe11663842aa", "theowalcott", "user_soccer"),
    ("0x38337de21ff0bb0a11a40761507d51e318d633d1", "SineNooneEI", "user_esports_tennis"),
    ("0x9319a045cdd0c2180e5eb7ad44374383db9a6410", "sainttroplay", "pd_month_sports_1"),
    ("0x9f138019d5481fdc5c59b93b0ae4b9b817cce0fd", "Bienville", "stale_history"),
    ("0x6b7c75862e64d6e976d2c08ad9f9b54add6c5f83", "tcp2", "stale_bot"),
    ("0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee", "kch123", "stale_unjoinable"),
]

POLITICS_FUTURES = {"POLITICS", "Futures"}


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def sport_mix(csv_path: Path) -> dict[str, Any]:
    df = read_trader_csv(csv_path)
    if df.empty:
        return {"sports_frac": 0.0, "politics_frac": 0.0, "futures_frac": 0.0, "n": 0, "top": []}
    sports = df.apply(get_sport, axis=1)
    mkts = df.apply(get_market_type, axis=1)
    n = len(df)
    pol = int((sports == "POLITICS").sum())
    fut = int((mkts == "Futures").sum())
    counts = sports.value_counts().head(6)
    return {
        "n": n,
        "politics_frac": round(pol / n, 3) if n else 0.0,
        "futures_frac": round(fut / n, 3) if n else 0.0,
        "sports_frac": round(1.0 - (pol + fut) / n, 3) if n else 0.0,
        "top": [{"sport": str(k), "n": int(v)} for k, v in counts.items()],
    }


def _slice_stat(df: pd.DataFrame) -> dict[str, Any]:
    if df is None or df.empty:
        return {"n": 0, "win_rate": 0.0, "roi": 0.0, "pnl": 0.0, "median": 0.0, "mean": 0.0}
    cost = pd.to_numeric(df["cost"], errors="coerce").fillna(0.0)
    pnl = pd.to_numeric(df["hold_pnl"], errors="coerce").fillna(0.0)
    tot = float(cost.sum())
    n = int(len(df))
    wins = int(df["won"].sum()) if "won" in df.columns else 0
    return {
        "n": n,
        "win_rate": round(100.0 * wins / n, 1) if n else 0.0,
        "roi": round(100.0 * float(pnl.sum()) / tot, 2) if tot > 0 else 0.0,
        "pnl": round(float(pnl.sum()), 2),
        "median": round(float(cost.median()), 2) if n else 0.0,
        "mean": round(float(cost.mean()), 2) if n else 0.0,
    }


def unique_book_slices(csv_path: Path, username: str, wallet: str) -> dict[str, Any]:
    """Hold-to-res unique book: lifetime, last 30d, 2×-median outsized, last-30d outsized.

    Hedges and 95¢ NO bonds are already dropped by load_trader_markets.
    """
    empty = {
        "ok": False,
        "lifetime": _slice_stat(pd.DataFrame()),
        "last_30d": _slice_stat(pd.DataFrame()),
        "outsized": _slice_stat(pd.DataFrame()),
        "outsized_30d": _slice_stat(pd.DataFrame()),
        "politics_or_futures_frac": 0.0,
        "hold_to_expiry": True,
    }
    try:
        mk = load_trader_markets(csv_path, username, wallet)
    except Exception as exc:
        empty["error"] = str(exc)
        return empty
    if mk is None or mk.empty:
        return empty
    sports = ~mk["sport_type"].astype(str).isin(POLITICS_FUTURES)
    fut = mk["market_type"].astype(str).str.contains("Future", case=False, na=False)
    sports = sports & ~fut
    n_all = max(int(len(mk)), 1)
    sports_mk = mk.loc[sports].copy()
    if sports_mk.empty:
        empty["ok"] = True
        empty["politics_or_futures_frac"] = 1.0
        return empty
    median = float(pd.to_numeric(sports_mk["cost"], errors="coerce").median() or 0)
    out = sports_mk[pd.to_numeric(sports_mk["cost"], errors="coerce") >= max(median * 2.0, 1.0)]
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    end = pd.to_datetime(sports_mk["end_dt"], utc=True, errors="coerce")
    recent = sports_mk.loc[end >= cutoff]
    recent_out = out.loc[pd.to_datetime(out["end_dt"], utc=True, errors="coerce") >= cutoff] if not out.empty else out
    return {
        "ok": True,
        "lifetime": _slice_stat(sports_mk),
        "last_30d": _slice_stat(recent),
        "outsized": _slice_stat(out),
        "outsized_30d": _slice_stat(recent_out),
        "politics_or_futures_frac": round(1.0 - len(sports_mk) / n_all, 3),
        "hold_to_expiry": True,
        "note": (
            "Copy always holds to resolution (token $1 or $0). "
            "These numbers are that P&L, not marked-to-market scalps."
        ),
    }


def take_rule_stat(username: str, wallet: str) -> dict[str, Any]:
    extra = [{"username": username, "wallet": wallet}]
    try:
        df = collect_plays([], extra_books=extra)
    except Exception as exc:
        return {"ok": False, "error": str(exc), "n": 0}
    if df is None or df.empty:
        return {"ok": True, "n": 0, "win_rate": 0.0, "roi_2c": 0.0}
    mask = take_mask(df) & no_futures(df)
    sub = df.loc[mask.fillna(False)]
    from asof_fullbook_backtest import asof_stat

    st = asof_stat(sub, 0.02)
    return {
        "ok": True,
        "n": st["n"],
        "win_rate": st["win_rate"],
        "roi_2c": st["roi"],
        "all_n": int(len(df)),
    }


def copy_10pct(median: float, take: dict[str, Any]) -> dict[str, Any]:
    """Copy 10% of their median market. Bankroll = 20 concurrent units."""
    copy_stake = max(0.0, median * 0.10)
    bankroll = copy_stake * 20.0
    n = int(take.get("n") or 0)
    roi = _f(take.get("roi_2c"))
    expected = n * copy_stake * (roi / 100.0)
    return {
        "copy_stake": round(copy_stake, 2),
        "starting_bankroll_20_units": round(bankroll, 2),
        "take_prints": n,
        "expected_pnl_at_10pct": round(expected, 2),
        "note": (
            "Bankroll is 20× one 10%-of-median fill so we can hold several at once. "
            "Expected PnL applies the take-rule ROI after 2¢ to those prints only."
        ),
    }


def verdict(row: dict[str, Any]) -> str:
    reasons = row.get("flags") or []
    if "no_csv" in reasons:
        return "NEED_FETCH"
    if "politics_or_futures_book" in reasons:
        return "SKIP_WEIRD"
    if "grinder_or_mm" in reasons or "hard_skip_volume" in reasons:
        return "KICK_GRINDER"
    if "unjoinable_median" in reasons:
        return "WATCH_WHALE"
    if "stale" in reasons:
        return "ARCHIVE"
    if "take_rule_negative" in reasons or "outsized_negative" in reasons:
        return "WATCH_NEGATIVE"
    if row.get("joinable") and row.get("recency") in {"HOT", "WARM"}:
        take_n = int((row.get("take_rule") or {}).get("n") or 0)
        take_roi = _f((row.get("take_rule") or {}).get("roi_2c"))
        if take_n >= 12 and take_roi >= 5:
            return "LIVE_CANDIDATE"
        return "WATCH_HOT"
    return "WATCH"


def recency_band(days: int | None) -> str:
    if days is None:
        return "UNKNOWN"
    if days <= 7:
        return "HOT"
    if days <= 14:
        return "WARM"
    if days <= 21:
        return "COLD"
    if days <= 45:
        return "DARK"
    return "DROP"


def screen_one(wallet: str, username: str, why: str) -> dict[str, Any]:
    csv_p = csv_path_for(wallet, username)
    json_p = json_path_for(wallet, username)
    flags: list[str] = []
    analysis: dict[str, Any] = {}
    mix: dict[str, Any] = {}
    if not csv_p.exists():
        flags.append("no_csv")
        return {
            "username": username,
            "wallet": wallet,
            "why": why,
            "flags": flags,
            "joinable": False,
            "recency": "UNKNOWN",
            "verdict": "NEED_FETCH",
        }
    mix = sport_mix(csv_p)
    if mix.get("politics_frac", 0) + mix.get("futures_frac", 0) >= 0.70:
        flags.append("politics_or_futures_book")
    try:
        if json_p.exists():
            analysis = json.loads(json_p.read_text(encoding="utf-8"))
        else:
            analysis = analyze_csv(csv_p, username, wallet)
            json_p.write_text(json.dumps(analysis, indent=2, default=str), encoding="utf-8")
    except Exception as exc:
        flags.append(f"analyze_fail:{exc}")
        analysis = {}

    dash = _f(analysis.get("dashboard_pnl") or analysis.get("total_profit"))
    roi = _f(analysis.get("overall_roi"))
    wr = _f(analysis.get("win_rate"))
    median = _f(analysis.get("median_market_stake"))
    days = analysis.get("days_since_last_event")
    try:
        days_i = int(days) if days is not None else None
    except (TypeError, ValueError):
        days_i = None
    rec = recency_band(days_i)
    closed = int(analysis.get("markets_traded") or 0)
    if median >= MEDIAN_JOIN_MAX:
        flags.append("unjoinable_median")
    if wr < WR_LO or wr > WR_HI:
        flags.append("wr_out_of_band")
    if rec in {"DROP", "DARK"}:
        flags.append("stale")
    if closed > 12_000 or median < 5:
        flags.append("hard_skip_volume")
    last30 = analysis.get("last_30d") or {}
    joinable = (
        40 <= closed <= 12_000
        and WR_LO <= wr <= WR_HI
        and median < MEDIAN_JOIN_MAX
        and "politics_or_futures_book" not in flags
        and "hard_skip_volume" not in flags
    )
    take = {"n": 0, "win_rate": 0.0, "roi_2c": 0.0}
    slices = unique_book_slices(csv_p, username, wallet)
    if csv_p.exists() and closed >= 30:
        take = take_rule_stat(username, wallet)
        if int(take.get("n") or 0) >= 12 and _f(take.get("roi_2c")) < 0:
            flags.append("take_rule_negative")
    out_roi = _f((slices.get("outsized") or {}).get("roi"))
    out_n = int((slices.get("outsized") or {}).get("n") or 0)
    if out_n >= 20 and out_roi < 0:
        flags.append("outsized_negative")

    row = {
        "username": username,
        "wallet": wallet,
        "why": why,
        "dashboard_pnl": round(dash, 2),
        "overall_roi": round(roi, 2),
        "win_rate": round(wr, 2),
        "median_stake": round(median, 2),
        "closed_markets": closed,
        "last_event": analysis.get("last_event_date"),
        "days_since_last": days_i,
        "recency": rec,
        "last_30d_pnl": _f(last30.get("pnl")),
        "last_30d_roi": _f(last30.get("roi")),
        "last_30d_n": int(last30.get("n") or 0),
        "mix": mix,
        "top_sport": analysis.get("top_sport"),
        "joinable": joinable,
        "take_rule": take,
        "unique_slices": slices,
        "copy_10pct": copy_10pct(median, take),
        "flags": flags,
        "hold_to_expiry": True,
    }
    row["verdict"] = verdict(row)
    return row


def render_md(rows: list[dict[str, Any]]) -> str:
    lines = [
        "# Hot copy screen",
        "",
        f"As of {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}.",
        "",
        "Polydata month curves are **not** copy truth. Unique closed+open books + hold-to-res take rule are.",
        "Live copy still needs: HOT/WARM, joinable median, sports (not politics/futures), take-rule +ROI at n≥12.",
        "",
        "| Trader | Verdict | Recency | Dash PnL | ROI | WR | Median | 30d unique ROI | Outsized n/ROI | Take n / ROI | 10% stake / bankroll |",
        "|---|---|---|---:|---:|---:|---:|---:|---|---|---|",
    ]
    for r in rows:
        c10 = r.get("copy_10pct") or {}
        take = r.get("take_rule") or {}
        sl = r.get("unique_slices") or {}
        last = sl.get("last_30d") or {}
        out = sl.get("outsized") or {}
        lines.append(
            f"| {r['username']} | **{r['verdict']}** | {r.get('recency')} | "
            f"${r.get('dashboard_pnl', 0):,.0f} | {r.get('overall_roi', 0):.1f}% | "
            f"{r.get('win_rate', 0):.1f}% | ${r.get('median_stake', 0):,.0f} | "
            f"{last.get('roi', 0):.1f}% n={last.get('n', 0)} | "
            f"{out.get('n', 0)} / {out.get('roi', 0)}% | "
            f"{take.get('n', 0)} / {take.get('roi_2c', 0)}% | "
            f"${c10.get('copy_stake', 0):,.0f} / ${c10.get('starting_bankroll_20_units', 0):,.0f} |"
        )
    lines += [
        "",
        "## Why the frozen 12 looks dead",
        "",
        "Insider Ranks defaulted to **Take book** = the historical 12 matched Polydata books "
        "(Capman, Bienville, tcp2, kch123, HedgeMaster88…). Copyability was forced to 80 "
        "even when last print was months ago. That is archive, not a live menu.",
        "",
        "Take these only fires **live** HOT/WARM joinable books. We will never have 50 live "
        "sharps — we need a rotating HOT watch list that gets unique-booked weekly from "
        "Polydata sports month/week (PnL/vol ≥ 5%).",
        "",
        "## Named notes",
        "",
    ]
    for r in rows:
        flags = ", ".join(r.get("flags") or []) or "—"
        mix = r.get("mix") or {}
        sl = r.get("unique_slices") or {}
        out = sl.get("outsized") or {}
        out30 = sl.get("outsized_30d") or {}
        last = sl.get("last_30d") or {}
        top = ", ".join(f"{x['sport']} n={x['n']}" for x in (mix.get("top") or [])[:4]) or "—"
        c10 = r.get("copy_10pct") or {}
        lines.append(
            f"- **{r['username']}** ({r['why']}): {r['verdict']}. "
            f"Last {r.get('last_event')}. Mix: {top}. "
            f"Unique sports last-30d: n={last.get('n', 0)} ROI={last.get('roi', 0)}% "
            f"PnL=${last.get('pnl', 0):,.0f}. "
            f"Outsized (≥2× median): n={out.get('n', 0)} ROI={out.get('roi', 0)}% "
            f"(last 30d n={out30.get('n', 0)} ROI={out30.get('roi', 0)}%). "
            f"Copy 10% of median = ${c10.get('copy_stake', 0):,.0f} "
            f"(~${c10.get('starting_bankroll_20_units', 0):,.0f} for 20 units). "
            f"Hold to expiry: yes (our copy always does). Flags: {flags}."
        )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    rows = [screen_one(w, u, why) for w, u, why in NAMED]
    rows.sort(key=lambda r: (0 if r["verdict"] == "LIVE_CANDIDATE" else 1, -_f(r.get("last_30d_pnl"))))
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "named": rows,
        "verdicts": {r["username"]: r["verdict"] for r in rows},
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    OUT_MD.write_text(render_md(rows), encoding="utf-8")
    print(f"Wrote {OUT_JSON} and {OUT_MD}")
    for r in rows:
        print(
            f"  {r['verdict']:<16} {r['username']:<32} rec={r.get('recency'):<6} "
            f"med=${r.get('median_stake', 0):>8,.0f} 30d=${r.get('last_30d_pnl', 0):>10,.0f} "
            f"take n={((r.get('take_rule') or {}).get('n') or 0)}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
