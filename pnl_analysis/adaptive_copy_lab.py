#!/usr/bin/env python3
"""Multi-strategy adaptive copy lab.

Compares several as-of copy rules across live / bench / watch (all CSV books),
scores easy-to-tail + equity consistency, proposes promote/demote/cold actions,
and writes illustrative forward projections.

This is the fluid layer on top of copy_roster + asof_live_q60_sport_rel2.
extra_watch never auto-promotes to live — proposals only.

Writes:
  pnl_analysis/ADAPTIVE_COPY_LAB.md
  pnl_analysis/output/adaptive_copy_lab.json

Usage:
  python pnl_analysis/adaptive_copy_lab.py
  python pnl_analysis/adaptive_copy_lab.py --slip 0.02
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from asof_fullbook_backtest import (  # noqa: E402
    STAKE,
    asof_stat,
    collect_plays,
    strategy_masks,
)
from copy_roster import (  # noqa: E402
    EXTRA_PATH,
    LIVE_MIN_LAST30_N,
    LIVE_MIN_ROI,
    MEDIAN_JOIN_MAX,
    OUTPUT_DIR,
    ROOT,
    WR_HI,
    WR_LO,
    load_universe,
)
from evolve_copy_book import no_futures  # noqa: E402
from equity_regime import regime_for_trader  # noqa: E402
from take_book_bankroll import equity_stats  # noqa: E402

OUT_JSON = OUTPUT_DIR / "adaptive_copy_lab.json"
OUT_MD = ROOT / "ADAPTIVE_COPY_LAB.md"

PRODUCT = "asof_live_q60_sport_rel2"

# Strategies we actually consider for $100 tail (not copy-all / raw tape).
COMPARE_STRATEGIES = [
    "asof_live_q60_sport_rel2",
    "asof_q60_sport_rel2",
    "asof_q60_sub_rel2",
    "asof_live_q50_sport",
    "asof_q50_sport_rel2",
    "asof_q60_sport",
    "asof_ml_sport",
    "asof_flip_sport",
    "live_10_88",
]

STRATEGY_BLURB = {
    "asof_live_q60_sport_rel2": "PRODUCT — Q≥60, sport +5%, rel≥2×, 10–88¢, no NFL",
    "asof_q60_sport_rel2": "Same gates without live price band (still no NFL)",
    "asof_q60_sub_rel2": "Q≥60 + submarket expert + rel≥2×, no NFL",
    "asof_live_q50_sport": "Looser grade (Q≥50) + sport lane + live band",
    "asof_q50_sport_rel2": "Q≥50 + sport + rel≥2×",
    "asof_q60_sport": "Q≥60 + sport lane only (no size / no price band)",
    "asof_ml_sport": "Sport expert moneylines only",
    "asof_flip_sport": "Sport expert coin-flips (40–60¢)",
    "live_10_88": "Baseline: any warmup print in 10–88¢",
}


def _f(v: Any, default: float = 0.0) -> float:
    try:
        if v is None:
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _books_from_universe(uni: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for bucket in ("live", "bench", "watch"):
        for t in uni.get(bucket) or []:
            w = str(t.get("wallet") or "").lower()
            if not w or w in seen:
                continue
            seen.add(w)
            rows.append({**t, "bucket": bucket})
    # Capman-era matched set (historical tape) — include if not already present
    for t in uni.get("take_book_matched") or []:
        w = str(t.get("wallet") or "").lower()
        u = str(t.get("username") or "")
        if not w or w in seen:
            continue
        seen.add(w)
        rows.append({
            "username": u,
            "wallet": w,
            "bucket": "matched_archive",
            "joinable": False,
            "unique_roi": None,
            "win_rate": None,
            "median_stake": None,
            "reasons": ["take_book_matched"],
        })
    return rows


def window_stat(sub: pd.DataFrame, days: int, slip: float) -> dict[str, Any]:
    if sub.empty:
        return {"n": 0, "win_rate": 0.0, "roi_2c": 0.0, "unit_pnl": 0.0}
    end = pd.to_datetime(sub["end_dt"], utc=True).max()
    cut = end - timedelta(days=days)
    w = sub[pd.to_datetime(sub["end_dt"], utc=True) >= cut]
    st = asof_stat(w, slip)
    return {
        "n": st["n"],
        "win_rate": st["win_rate"],
        "roi_2c": st["roi"],
        "unit_pnl": st["unit_pnl"],
        "sharpe": st["sharpe_daily_roi"],
        "max_dd": st["max_dd"],
    }


def flat_equity(sub: pd.DataFrame, slip: float) -> dict[str, Any]:
    if sub.empty:
        return {"n": 0}
    work = sub.sort_values("end_dt")
    fills = np.clip(work["entry"].to_numpy(dtype=float) + slip, 0.02, 0.98)
    won = work["won"].to_numpy()
    pnls = np.where(won, STAKE * (1.0 / fills - 1.0), -STAKE)
    dates = work["end_dt"].tolist()
    eq = equity_stats(pnls, dates, start=10_000.0)
    # Consistency: fraction of months with positive PnL + up-day %
    day = pd.to_datetime(dates, utc=True)
    by_day = pd.Series(pnls, index=day).groupby(day.date).sum()
    up_day_pct = float((by_day > 0).mean() * 100.0) if len(by_day) else 0.0
    month_key = day.tz_convert("UTC").strftime("%Y-%m")
    months = pd.Series(pnls, index=month_key).groupby(level=0).sum()
    up_month_pct = float((months > 0).mean() * 100.0) if len(months) else 0.0
    mean = float(by_day.mean()) if len(by_day) else 0.0
    std = float(by_day.std()) if len(by_day) > 1 else 0.0
    consistency = 0.0
    if mean > 0 and std > 0:
        consistency = float(min(100.0, (mean / std) * 40.0))
    elif mean > 0:
        consistency = 50.0
    eq["up_day_pct"] = round(up_day_pct, 1)
    eq["up_month_pct"] = round(up_month_pct, 1)
    eq["consistency_score"] = round(consistency, 1)
    eq["monthly_pnls"] = [
        {"month": str(k), "pnl": round(float(v), 2)} for k, v in months.items()
    ][-12:]
    return eq


def joinability_score(t: dict[str, Any]) -> dict[str, Any]:
    """Higher = easier $100 tail (size, WR band, activity)."""
    median = _f(t.get("median_stake"), 1e9)
    wr = _f(t.get("win_rate"), 0.0)
    roi = _f(t.get("unique_roi"), 0.0)
    last30 = int(t.get("last_30d_n") or 0)
    joinable = bool(t.get("joinable"))
    score = 0.0
    reasons: list[str] = []
    if joinable:
        score += 35
        reasons.append("joinable_gates")
    if median <= 2_000:
        score += 25
        reasons.append("median_le_2k")
    elif median <= 5_000:
        score += 18
        reasons.append("median_le_5k")
    elif median <= 10_000:
        score += 10
        reasons.append("median_le_10k")
    elif median < MEDIAN_JOIN_MAX:
        score += 5
        reasons.append("median_under_15k")
    else:
        reasons.append("whale_unjoinable")
    if WR_LO <= wr <= WR_HI:
        score += 15
        reasons.append("wr_band")
    if roi >= LIVE_MIN_ROI:
        score += 10
        reasons.append("unique_roi_ge_5")
    if last30 >= LIVE_MIN_LAST30_N:
        score += 15
        reasons.append("active_30d")
    elif last30 >= 3:
        score += 5
        reasons.append("sparse_30d")
    else:
        reasons.append("quiet_30d")
    return {"score": round(min(score, 100.0), 1), "reasons": reasons, "median": median, "wr": wr}


def adaptive_action(
    t: dict[str, Any],
    take: dict[str, Any],
    eq: dict[str, Any],
    join: dict[str, Any],
    w30: dict[str, Any],
    w60: dict[str, Any],
) -> dict[str, Any]:
    bucket = str(t.get("bucket") or "")
    n = int(take.get("n") or 0)
    roi = _f(take.get("roi"))
    last30_n = int(t.get("last_30d_n") or 0)
    reasons = list(t.get("reasons") or [])
    cons = _f(eq.get("consistency_score"))
    join_s = _f(join.get("score"))

    # Demote / cold
    if bucket == "live" and n >= 12 and roi <= -5:
        return {"action": "demote_bench", "why": f"live take-rule bleed n={n} roi={roi}%"}
    if bucket == "live" and last30_n < LIVE_MIN_LAST30_N:
        return {"action": "demote_bench", "why": f"went quiet last30_n={last30_n}"}
    if "take_rule_bleed" in reasons:
        return {"action": "keep_bench", "why": "already take_rule_bleed"}
    if bucket in {"bench", "watch"} and n >= 20 and roi <= -10:
        return {"action": "keep_cold", "why": f"take-rule cold n={n} roi={roi}%"}

    # Promote — automatic via auto_promote.py (watch→take_book); lab labels the action.
    if (
        bucket == "bench"
        and bool(t.get("joinable"))
        and n >= 12
        and roi >= 5
        and _f(t.get("unique_roi")) >= LIVE_MIN_ROI
        and join_s >= 55
        and cons >= 12
        and last30_n >= LIVE_MIN_LAST30_N
        and _f(w30.get("roi_2c")) > -8
        and str(t.get("recency") or "") in {"HOT", "WARM"}
    ):
        return {"action": "auto_promote_live", "why": f"bench take +{roi}% n={n}, join={join_s}, cons={cons}"}
    if (
        bucket == "watch"
        and bool(t.get("joinable"))
        and str(t.get("recency") or "") in {"HOT", "WARM"}
        and last30_n >= LIVE_MIN_LAST30_N
    ):
        # Regime turnaround / hot unique path — auto_promote applies to extra_traders
        if n >= 12 and roi >= 8 and join_s >= 60 and cons >= 15 and _f(t.get("unique_roi")) >= LIVE_MIN_ROI:
            return {
                "action": "auto_promote_live",
                "why": f"watch take +{roi}% n={n} — auto_promote will flip status to take_book",
            }
        # Thin take but strong unique/regime — still auto-promote for live allowlist
        if join_s >= 55 and (_f(t.get("unique_roi")) or 0) >= LIVE_MIN_ROI:
            return {
                "action": "auto_promote_live",
                "why": f"watch unique ROI ready — auto_promote (take n={n})",
            }
        return {
            "action": "auto_promote_if_regime",
            "why": "watch candidate — auto_promote checks turnaround/hot last30 gates",
        }
    if bucket == "live" and n >= 8 and roi > 0 and _f(w30.get("roi_2c"), 0) >= -10:
        return {"action": "keep_live", "why": f"live take ok n={n} roi={roi}%"}
    if bucket == "live" and n >= 8 and roi > 0:
        return {
            "action": "keep_live_caution",
            "why": (
                f"live hist take +{roi}% n={n} but rolling 30d take "
                f"{w30.get('roi_2c')}% n={w30.get('n')} — size down / wait for prints"
            ),
        }
    if bucket == "live":
        return {"action": "keep_live", "why": f"sole live book — monitor closely n={n} roi={roi}%"}
    if bucket == "bench":
        return {"action": "keep_bench", "why": "bench hold — not yet promote gates"}
    return {"action": "keep_watch", "why": "screen only / thin take / not joinable"}


def pool_mask(df: pd.DataFrame, names: set[str]) -> pd.Series:
    return df["username"].isin(names)


def strategy_slice(df: pd.DataFrame, sid: str) -> pd.DataFrame:
    masks = strategy_masks(df)
    m = masks.get(sid)
    if m is None:
        return df.iloc[0:0]
    base = m.fillna(False) & no_futures(df).fillna(False)
    # Moneyline / flip already sport-gated; still drop futures
    return df.loc[base]


def project_forward(
    hist: dict[str, Any],
    live_names: list[str],
    by_trader: list[dict[str, Any]],
    days: int = 30,
) -> dict[str, Any]:
    """Illustrative — not a promised edge. Uses hist trades/day × live expectancy."""
    tpd = _f(hist.get("trades_per_day"))
    roi = _f(hist.get("roi"))
    expectancy = _f(hist.get("expectancy"))
    n_proj = tpd * days
    pnl_proj = n_proj * expectancy
    # Bootstrap-ish band from daily sharpe / max_dd scale
    sharpe = _f(hist.get("sharpe_daily_roi"))
    vol_unit = abs(expectancy) * 1.5 if expectancy else 40.0
    if sharpe != 0:
        vol_unit = max(20.0, abs(expectancy) * (2.0 / max(abs(sharpe), 0.2)))
    low = pnl_proj - 1.28 * vol_unit * math.sqrt(max(n_proj, 1.0))
    high = pnl_proj + 1.28 * vol_unit * math.sqrt(max(n_proj, 1.0))
    live_rows = [r for r in by_trader if r.get("username") in live_names]
    per_live = []
    for r in live_rows:
        st = r.get("product") or {}
        etpd = _f(st.get("trades_per_day"))
        eexp = _f(st.get("expectancy"))
        per_live.append({
            "username": r.get("username"),
            "proj_n_30d": round(etpd * days, 1),
            "proj_pnl_30d": round(etpd * days * eexp, 2),
            "hist_roi_2c": st.get("roi"),
            "hist_n": st.get("n"),
        })
    return {
        "horizon_days": days,
        "method": (
            "trades_per_day × $100 expectancy from in-sample product rule on the scored pool. "
            "Bands are illustrative (±1.28σ-style), not a forecast of edge persistence."
        ),
        "pool_hist_n": hist.get("n"),
        "pool_hist_roi_2c": roi,
        "proj_n": round(n_proj, 1),
        "proj_pnl_usd": round(pnl_proj, 2),
        "proj_roi_pct": round(roi, 2),
        "band_low_usd": round(low, 2),
        "band_high_usd": round(high, 2),
        "live_traders": per_live,
        "caveat": (
            "Empty live open book ⇒ near-term n may be 0 even if hist tpd > 0. "
            "Cold weeks pause; do not force size."
        ),
    }


def score_trader_row(
    t: dict[str, Any],
    product_df: pd.DataFrame,
    slip: float,
) -> dict[str, Any]:
    name = str(t.get("username") or "")
    sub = product_df[product_df["username"] == name] if not product_df.empty else product_df
    st = asof_stat(sub, slip) if not sub.empty else asof_stat(sub, slip)
    eq = flat_equity(sub, slip)
    join = joinability_score(t)
    w30 = window_stat(sub, 30, slip)
    w60 = window_stat(sub, 60, slip)
    w90 = window_stat(sub, 90, slip)
    action = adaptive_action(t, st, eq, join, w30, w60)
    regime = regime_for_trader(str(t.get("wallet") or ""), name)
    # Composite: prioritize easy + consistent + take +ROI + regime
    composite = (
        0.30 * join["score"]
        + 0.20 * min(_f(eq.get("consistency_score")), 100.0)
        + 0.20 * (50.0 + min(max(st.get("roi") or 0.0, -50.0), 50.0))
        + 0.15 * min(100.0, (st.get("n") or 0) * 2.0)
        + 0.15 * min(_f(regime.get("score")), 100.0)
    )
    if (st.get("n") or 0) < 8:
        composite *= 0.7
    if not t.get("joinable"):
        composite *= 0.85
    if regime.get("regime") == "turnaround":
        composite = max(composite, 62.0)
    return {
        "username": name,
        "wallet": t.get("wallet"),
        "bucket": t.get("bucket"),
        "joinable": t.get("joinable"),
        "unique_roi": t.get("unique_roi"),
        "win_rate": t.get("win_rate"),
        "median_stake": t.get("median_stake"),
        "last_30d_n": t.get("last_30d_n"),
        "last_30d_roi": t.get("last_30d_roi"),
        "reasons": t.get("reasons") or [],
        "joinability": join,
        "regime": regime,
        "product": st,
        "equity": {
            "n": eq.get("n"),
            "total_pnl": eq.get("pnl"),
            "end_bank": eq.get("end"),
            "max_dd_usd": eq.get("max_dd_usd"),
            "max_dd_pct": eq.get("max_dd_pct"),
            "sharpe_pnl": eq.get("sharpe_daily_pnl"),
            "sortino": eq.get("sortino_daily_pnl"),
            "up_day_pct": eq.get("up_day_pct"),
            "up_month_pct": eq.get("up_month_pct"),
            "consistency_score": eq.get("consistency_score"),
            "monthly_pnls": eq.get("monthly_pnls"),
        },
        "rolling": {"d30": w30, "d60": w60, "d90": w90},
        "adaptive": action,
        "composite_score": round(composite, 1),
    }


def write_md(payload: dict[str, Any]) -> None:
    strat = payload.get("strategies") or {}
    traders = payload.get("traders") or []
    proj = payload.get("projection_30d") or {}
    adapt = payload.get("adaptation") or {}
    lines = [
        "# Adaptive copy lab — multi-strategy + fluid roster",
        "",
        f"Generated **{payload['generated_at'][:19]} UTC**.",
        "",
        "Unique closed+open books remain truth for ROI. This lab answers: "
        "**which rule × which books would we have tailed**, how smooth the $100 equity was, "
        "who is easy to join, and how the roster should adapt.",
        "",
        f"Product rule stays **`{PRODUCT}`** until an alt strategy beats it on "
        "live+joinable with better consistency for ≥60 days (proposal only — no silent swap).",
        "",
        "## What we would have tailed (product rule)",
        "",
    ]
    prod_pools = (payload.get("pools") or {}).get(PRODUCT) or {}
    for key in ("live_only", "easy_tail", "live_plus_bench", "all_csv", "joinable_csv"):
        p = prod_pools.get(key) or {}
        lines.append(
            f"- **{key}**: n={p.get('n', 0)} WR={p.get('win_rate')}% "
            f"+2¢ ROI={p.get('roi')}% PnL=${p.get('unit_pnl')} "
            f"Sharpe={p.get('sharpe_daily_roi')} maxDD=${p.get('max_dd')} "
            f"({p.get('first')} → {p.get('last')})"
        )
    lines += [
        "",
        "## Multi-strategy bake-off (all CSV live+bench+watch)",
        "",
        "| Strategy | n | WR | +2¢ ROI | PnL | Sharpe | maxDD | Consistency* | Verdict |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    # consistency from equity on that strategy full pool
    eq_by = payload.get("strategy_equity") or {}
    ranked = sorted(
        strat.items(),
        key=lambda kv: (-_f((kv[1] or {}).get("roi")), -_f((kv[1] or {}).get("n"))),
    )
    for sid, st in ranked:
        blurb = STRATEGY_BLURB.get(sid, "")
        cons = _f((eq_by.get(sid) or {}).get("consistency_score"))
        tag = "PRODUCT" if sid == PRODUCT else ""
        if sid == PRODUCT:
            verdict = "ship"
        elif _f(st.get("roi")) > _f((strat.get(PRODUCT) or {}).get("roi")) and _f(st.get("n")) >= 80:
            verdict = "watch alt"
        elif _f(st.get("roi")) < 0:
            verdict = "skip"
        else:
            verdict = "lab"
        lines.append(
            f"| `{sid}` {tag} | {st.get('n')} | {st.get('win_rate')}% | {st.get('roi')}% | "
            f"${st.get('unit_pnl')} | {st.get('sharpe_daily_roi')} | ${st.get('max_dd')} | "
            f"{cons} | {verdict} — {blurb[:48]} |"
        )
    lines.append("")
    lines.append("\\*Consistency = mean/std of daily $100 PnL scaled (higher = smoother green).")
    lines += [
        "",
        "## Ranked traders (easy + consistent + take-rule)",
        "",
        "| Rank | Trader | Bucket | Composite | Join | Cons | Take n/+2¢ | 30d | Action |",
        "|---:|---|---|---:|---:|---:|---|---|---|",
    ]
    for i, r in enumerate(traders[:30], 1):
        st = r.get("product") or {}
        eq = r.get("equity") or {}
        join = r.get("joinability") or {}
        roll = (r.get("rolling") or {}).get("d30") or {}
        act = r.get("adaptive") or {}
        lines.append(
            f"| {i} | {r.get('username')} | {r.get('bucket')} | {r.get('composite_score')} | "
            f"{join.get('score')} | {eq.get('consistency_score')} | "
            f"{st.get('n')}/{st.get('roi')}% | {roll.get('n')}/{roll.get('roi_2c')}% | "
            f"{act.get('action')} |"
        )
    lines += ["", "## Adaptive control loop (how we stay fluid)", ""]
    for step in adapt.get("loop") or []:
        lines.append(f"- {step}")
    lines += ["", "### Proposed actions now", ""]
    for a in adapt.get("actions") or []:
        lines.append(f"- **{a.get('action')}** — {a.get('username')}: {a.get('why')}")
    if not adapt.get("actions"):
        lines.append("- (none beyond keep)")
    lines += [
        "",
        "## Forward 30d projection (illustrative)",
        "",
        f"- Method: {proj.get('method')}",
        f"- Pool hist: n={proj.get('pool_hist_n')} ROI={proj.get('pool_hist_roi_2c')}%",
        f"- Projected plays: **{proj.get('proj_n')}** · PnL **${proj.get('proj_pnl_usd')}** "
        f"(band ${proj.get('band_low_usd')} → ${proj.get('band_high_usd')})",
        f"- Caveat: {proj.get('caveat')}",
        "",
    ]
    if proj.get("live_traders"):
        lines.append("| Live trader | Hist n | Hist +2¢ | Proj n 30d | Proj $ |")
        lines.append("|---|---:|---:|---:|---:|")
        for r in proj["live_traders"]:
            lines.append(
                f"| {r.get('username')} | {r.get('hist_n')} | {r.get('hist_roi_2c')}% | "
                f"{r.get('proj_n_30d')} | ${r.get('proj_pnl_30d')} |"
            )
    lines += [
        "",
        "## Machine-learning-style adaptation (without black-box ML yet)",
        "",
        "We treat the roster + rule as an online policy:",
        "",
        "1. **Features** each refresh: unique ROI/WR/median, last-30/60 prints, take-rule n/ROI/Sharpe/DD, "
        "joinability, consistency, CLV when available.",
        "2. **Policy**: hard gates in `copy_roster` (never auto-live `extra_watch`) + soft scores here.",
        "3. **Reward**: flat $100 hold-to-res PnL under product rule (not Polydata month curves).",
        "4. **Explore**: watch bucket + alt strategies in this lab; promote only when gates fire.",
        "5. **Exploit**: live = current best joinable + take-green books.",
        "6. **Cold path**: quiet_30d / take bleed → bench; PAUSE Take these if live open empty and 30d live ROI red.",
        "7. **Strategy drift**: if an alt mask beats product on `easy_tail` for 60+ days with n≥80 and better consistency, "
        "surface `propose_strategy_swap` — human confirms, then bump signal cache.",
        "",
        "Next ML step (optional): logistic / gradient model on as-of features to rank *plays* inside the product mask — "
        "not to replace unique-book truth.",
        "",
        "Rebuild: `python pnl_analysis/adaptive_copy_lab.py` · `npm run model:adaptive`",
        "",
    ]
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slip", type=float, default=0.02)
    args = parser.parse_args()
    slip = float(args.slip)
    now = datetime.now(timezone.utc)
    uni = load_universe()
    books = _books_from_universe(uni)
    print(f"[adaptive] books={len(books)} slip={slip}")

    take_matched = uni.get("take_book_matched") or []
    extras = [{"wallet": b["wallet"], "username": b["username"]} for b in books]
    df = collect_plays(take_matched, extra_books=extras)
    if df.empty:
        print("[adaptive] no plays")
        return 1
    if "conditionId" not in df.columns:
        df["conditionId"] = ""

    name_by_bucket: dict[str, set[str]] = {
        "live_only": {b["username"] for b in books if b.get("bucket") == "live"},
        "live_plus_bench": {b["username"] for b in books if b.get("bucket") in {"live", "bench"}},
        "all_csv": {b["username"] for b in books if b.get("bucket") in {"live", "bench", "watch", "matched_archive"}},
        "joinable_csv": {b["username"] for b in books if b.get("joinable") and b.get("bucket") in {"live", "bench", "watch"}},
        "easy_tail": {
            b["username"]
            for b in books
            if b.get("joinable")
            and _f(b.get("median_stake"), 1e9) <= 8_000
            and WR_LO <= _f(b.get("win_rate")) <= WR_HI
            and b.get("bucket") in {"live", "bench", "watch"}
        },
    }
    # Restrict all_csv to names that actually appear in df
    present = set(df["username"].unique())
    for k, v in list(name_by_bucket.items()):
        name_by_bucket[k] = {n for n in v if n in present}

    pools: dict[str, dict[str, Any]] = {}
    strategies: dict[str, Any] = {}
    strategy_equity: dict[str, Any] = {}

    for sid in COMPARE_STRATEGIES:
        sliced = strategy_slice(df, sid)
        st = asof_stat(sliced[sliced["username"].isin(name_by_bucket["all_csv"])], slip)
        strategies[sid] = st
        strategy_equity[sid] = flat_equity(
            sliced[sliced["username"].isin(name_by_bucket["all_csv"])], slip
        )
        print(f"  strategy {sid:<28} n={st['n']:<5} roi={st['roi']}% cons={strategy_equity[sid].get('consistency_score')}")
        pools[sid] = {}
        for pool_name, names in name_by_bucket.items():
            sub = sliced[sliced["username"].isin(names)]
            pools[sid][pool_name] = asof_stat(sub, slip)
            pools[sid][pool_name]["traders"] = sorted(names)

    product_df = strategy_slice(df, PRODUCT)
    trader_rows: list[dict[str, Any]] = []
    for b in books:
        if b.get("bucket") == "matched_archive" and b["username"] not in present:
            continue
        if b["username"] not in present and b.get("bucket") != "live":
            # still score joinability with empty take
            pass
        print(f"  trader {b.get('bucket'):<8} {b.get('username')}")
        trader_rows.append(score_trader_row(b, product_df, slip))
    trader_rows.sort(key=lambda r: -_f(r.get("composite_score")))

    actions = []
    for r in trader_rows:
        act = r.get("adaptive") or {}
        if act.get("action") not in {
            "keep_live",
            "keep_live_caution",
            "keep_bench",
            "keep_watch",
            "keep_cold",
        }:
            actions.append({
                "username": r.get("username"),
                "bucket": r.get("bucket"),
                "action": act.get("action"),
                "why": act.get("why"),
                "composite_score": r.get("composite_score"),
            })
        elif act.get("action") in {"keep_cold", "keep_live_caution"}:
            actions.append({
                "username": r.get("username"),
                "bucket": r.get("bucket"),
                "action": act.get("action"),
                "why": act.get("why"),
                "composite_score": r.get("composite_score"),
            })

    # Strategy swap proposal
    prod_easy = (pools.get(PRODUCT) or {}).get("easy_tail") or {}
    alt_proposals = []
    for sid, st in strategies.items():
        if sid == PRODUCT:
            continue
        easy = (pools.get(sid) or {}).get("easy_tail") or {}
        if (
            _f(easy.get("n")) >= 80
            and _f(easy.get("roi")) >= _f(prod_easy.get("roi")) + 3
            and _f((strategy_equity.get(sid) or {}).get("consistency_score"))
            >= _f((strategy_equity.get(PRODUCT) or {}).get("consistency_score"))
        ):
            alt_proposals.append({
                "action": "propose_strategy_swap",
                "from": PRODUCT,
                "to": sid,
                "why": (
                    f"easy_tail {sid} ROI {easy.get('roi')}% n={easy.get('n')} vs "
                    f"product {prod_easy.get('roi')}% n={prod_easy.get('n')}"
                ),
            })
    actions.extend(alt_proposals)

    live_names = sorted(name_by_bucket["live_only"])
    hist_live = (pools.get(PRODUCT) or {}).get("live_only") or {}
    projection = project_forward(hist_live, live_names, trader_rows, days=30)
    # Also project easy_tail policy if we tailed the scored easy set historically
    easy_hist = (pools.get(PRODUCT) or {}).get("easy_tail") or {}
    projection["if_tailed_easy_set"] = project_forward(
        easy_hist,
        sorted(name_by_bucket["easy_tail"]),
        trader_rows,
        days=30,
    )

    adaptation = {
        "loop": [
            "Refresh CSVs (live+bench+watch) → ranks → copy_universe.",
            "Adaptive lab: multi-strategy + joinability + consistency + equity regime.",
            "auto_promote.py: watch/bench → take_book automatically when gates fire (including turnaround).",
            "Rebuild copy_universe so Take these allowlist updates without human edits.",
            "Demote automatic: take_rule_bleed, quiet_30d, live take n≥12 deeply red.",
            "New traders: Polydata → watch → unique book → regime/lab → auto_promote.",
            "MM lane is separate (mm_maker_research) — not $100 copy.",
        ],
        "actions": actions,
        "gates": {
            "promote_bench_min_take_n": 12,
            "promote_bench_min_roi": 5,
            "promote_watch_min_roi": 8,
            "min_joinability": 55,
            "min_consistency_bench": 12,
            "min_consistency_watch": 15,
            "min_last30_n": LIVE_MIN_LAST30_N,
            "auto_promote": True,
            "turnaround_last30_min_roi": 8,
            "turnaround_last30_min_n": 30,
        },
    }

    payload = {
        "generated_at": now.isoformat(),
        "product_strategy": PRODUCT,
        "slip_cents": int(slip * 100),
        "stake_usd": STAKE,
        "counts": {
            "books": len(books),
            "plays_total": int(len(df)),
            "present_traders": len(present),
            **{k: len(v) for k, v in name_by_bucket.items()},
        },
        "strategies": strategies,
        "strategy_equity": {
            k: {kk: vv for kk, vv in (v or {}).items() if kk != "monthly_pnls"}
            for k, v in strategy_equity.items()
        },
        "pools": pools,
        "traders": trader_rows,
        "projection_30d": projection,
        "adaptation": adaptation,
        "method": (
            "Hold-to-res as-of masks; flat $100 +2¢; equity regime; "
            "auto_promote flips extra_traders watch→take_book when gates fire."
        ),
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    write_md(payload)
    print(f"[adaptive] wrote {OUT_JSON}")
    print(f"[adaptive] wrote {OUT_MD}")
    print(f"[adaptive] product live_only n={hist_live.get('n')} roi={hist_live.get('roi')}%")
    print(f"[adaptive] actions={len(actions)}")
    for a in actions[:12]:
        print(f"  {a.get('action')}: {a.get('username') or a.get('to')} — {a.get('why')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
