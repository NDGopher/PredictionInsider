#!/usr/bin/env python3
"""Bankroll, Kelly, Sharpe, drawdown, Q/rel buckets for the take book.

Take book = as-of Q≥60 + sport expert + ≥2× own median + live 10–88¢ + no NFL.
Hold to resolution. Default fill = their VWAP + 2¢.

Writes:
  pnl_analysis/output/take_book_bankroll.json
  pnl_analysis/TAKE_BOOK_BANKROLL.md
"""
from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_full_pipeline import OUTPUT_DIR  # noqa: E402
from walkforward_consensus_backtest import (  # noqa: E402
    LIVE_HI,
    LIVE_LO,
    STALE_ENTRY,
    daily_roi_sharpe,
    max_drawdown,
    profit_factor,
)

PLAYS = OUTPUT_DIR / "asof_fullbook_plays.csv"
OUT = OUTPUT_DIR / "take_book_bankroll.json"
MD = Path(__file__).resolve().parent / "TAKE_BOOK_BANKROLL.md"

FLAT_STAKE = 100.0
START_BANK = 10_000.0  # 100 units of the $100 flat bet
KELLY_WARMUP = 40
PER_BET_CAP = 0.25  # never more than 25% of bank on one ticket
DAY_CAP = 0.50      # never more than 50% of bank on one resolution day
MIN_STAKE = 1.0


def take_mask(df: pd.DataFrame) -> pd.Series:
    live = (df["entry"] >= LIVE_LO) & (df["entry"] <= LIVE_HI) & (df["entry"] <= STALE_ENTRY)
    no_nfl = ~df["sport_family"].astype(str).str.contains("NFL", case=False, na=False)
    return live & (df["q"] >= 60) & df["lane_ok"] & (df["rel"] >= 2) & no_nfl


def fill_price(entry: np.ndarray, slip: float) -> np.ndarray:
    return np.clip(entry + slip, 0.02, 0.98)


def binary_pnl(won: np.ndarray, fill: np.ndarray, stake: np.ndarray) -> np.ndarray:
    return np.where(won, stake * (1.0 / fill - 1.0), -stake)


def kelly_fraction(p: float, fill: float) -> float:
    """Stake as a fraction of bankroll for a $1 binary at price `fill`."""
    if fill <= 0.02 or fill >= 0.98:
        return 0.0
    p = min(max(p, 0.01), 0.99)
    raw = (p - fill) / (1.0 - fill)
    return float(min(max(raw, 0.0), PER_BET_CAP))


def equity_stats(pnls: np.ndarray, dates: list, *, start: float) -> dict:
    n = int(len(pnls))
    if n == 0:
        return {"n": 0}
    eq = start + np.cumsum(pnls)
    peak = np.maximum.accumulate(eq)
    dd = eq - peak
    max_dd_usd = float(dd.min()) if len(dd) else 0.0
    max_dd_pct = float((dd / np.clip(peak, 1.0, None)).min() * 100.0)
    end = float(eq[-1])
    total = end - start
    wins = pnls[pnls > 0]
    losses = pnls[pnls < 0]
    days = pd.to_datetime(dates, utc=True)
    day_key = [d.date() for d in days]
    by_day: dict[object, float] = {}
    n_day: dict[object, int] = {}
    for d, x in zip(day_key, pnls):
        by_day[d] = by_day.get(d, 0.0) + float(x)
        n_day[d] = n_day.get(d, 0) + 1
    day_pnls = np.array(list(by_day.values()), dtype=float)
    sharpe_roi = daily_roi_sharpe(list(days), pnls)
    if len(day_pnls) >= 10 and float(day_pnls.std()) > 0:
        sharpe_pnl = float(day_pnls.mean() / day_pnls.std() * math.sqrt(365.0))
    else:
        sharpe_pnl = 0.0
    downside = day_pnls[day_pnls < 0]
    if len(downside) >= 5 and float(downside.std()) > 0:
        sortino = float(day_pnls.mean() / downside.std() * math.sqrt(365.0))
    else:
        sortino = 0.0
    # Investor sitting in cash on off days — include calendar zeros.
    span_days = int((days.max() - days.min()).days) + 1 if n else 0
    cal_idx = pd.date_range(days.min().normalize(), days.max().normalize(), freq="D", tz="UTC")
    cal_map = {d: 0.0 for d in cal_idx.date}
    for d, x in by_day.items():
        cal_map[d] = x
    cal_pnls = np.array(list(cal_map.values()), dtype=float)
    if len(cal_pnls) >= 10 and float(cal_pnls.std()) > 0:
        sharpe_cal = float(cal_pnls.mean() / cal_pnls.std() * math.sqrt(365.0))
    else:
        sharpe_cal = 0.0
    cal_down = cal_pnls[cal_pnls < 0]
    if len(cal_down) >= 5 and float(cal_down.std()) > 0:
        sortino_cal = float(cal_pnls.mean() / cal_down.std() * math.sqrt(365.0))
    else:
        sortino_cal = 0.0
    calmar = (total / abs(max_dd_usd)) if max_dd_usd < 0 else 0.0
    unique_days = int(len(by_day))
    streak_l = streak_w = cur_l = cur_w = 0
    for x in pnls:
        if x < 0:
            cur_l += 1
            cur_w = 0
        elif x > 0:
            cur_w += 1
            cur_l = 0
        streak_l = max(streak_l, cur_l)
        streak_w = max(streak_w, cur_w)
    ruin = bool(np.any(eq <= 0))
    return {
        "n": n,
        "start": round(start, 2),
        "end": round(end, 2),
        "pnl": round(total, 2),
        "roi_on_start": round(total / start * 100.0, 2),
        "max_dd_usd": round(max_dd_usd, 2),
        "max_dd_pct": round(max_dd_pct, 2),
        "sharpe_daily_roi": round(sharpe_roi, 2),
        "sharpe_daily_pnl": round(sharpe_pnl, 2),
        "sharpe_calendar": round(sharpe_cal, 2),
        "sortino_daily_pnl": round(sortino, 2),
        "sortino_calendar": round(sortino_cal, 2),
        "calmar": round(calmar, 2),
        "profit_factor": round(profit_factor(pnls), 3),
        "expectancy": round(float(pnls.mean()), 2),
        "avg_win": round(float(wins.mean()), 2) if len(wins) else 0.0,
        "avg_loss": round(float(losses.mean()), 2) if len(losses) else 0.0,
        "win_rate": round(float((pnls > 0).mean() * 100.0), 2),
        "profitable_days_pct": round(float((day_pnls > 0).mean() * 100.0), 1) if len(day_pnls) else 0.0,
        "longest_lose_streak": int(streak_l),
        "longest_win_streak": int(streak_w),
        "unique_days": unique_days,
        "calendar_days": span_days,
        "bets_per_active_day": round(n / max(unique_days, 1), 2),
        "bets_per_calendar_day": round(n / max(span_days, 1), 2),
        "median_bets_on_active_day": round(float(np.median(list(n_day.values()))), 2) if n_day else 0.0,
        "max_bets_one_day": int(max(n_day.values()) if n_day else 0),
        "ruin": ruin,
        "first": str(days.min())[:10],
        "last": str(days.max())[:10],
    }


def replay_flat(sub: pd.DataFrame, fill: np.ndarray, start: float, stake: float) -> tuple[dict, np.ndarray]:
    won = sub["won"].to_numpy()
    stakes = np.full(len(sub), stake, dtype=float)
    # Stop betting if bankroll < stake
    pnls = np.zeros(len(sub), dtype=float)
    bank = start
    for i in range(len(sub)):
        if bank < stake:
            pnls[i] = 0.0
            continue
        pnls[i] = float(binary_pnl(np.array([won[i]]), np.array([fill[i]]), np.array([stake]))[0])
        bank += pnls[i]
    stats = equity_stats(pnls, sub["end_dt"].tolist(), start=start)
    staked = float((pnls != 0).sum() * stake)
    stats["total_staked"] = round(staked, 2)
    stats["roi_on_staked"] = round(float(pnls.sum()) / staked * 100.0, 2) if staked else 0.0
    stats["avg_stake"] = round(stake, 2)
    return stats, pnls


def replay_proportional(sub: pd.DataFrame, fill: np.ndarray, start: float, frac: float) -> tuple[dict, np.ndarray]:
    """Same-day bets share start-of-day bankroll. Stake = frac * that bank (capped)."""
    won = sub["won"].to_numpy()
    days = pd.to_datetime(sub["end_dt"], utc=True).dt.date.to_numpy()
    pnls = np.zeros(len(sub), dtype=float)
    stakes_out = np.zeros(len(sub), dtype=float)
    bank = start
    i = 0
    n = len(sub)
    while i < n:
        d = days[i]
        j = i
        while j < n and days[j] == d:
            j += 1
        n_day = j - i
        day_bank = bank
        raw = np.full(n_day, day_bank * frac, dtype=float)
        raw = np.clip(raw, 0.0, day_bank * PER_BET_CAP)
        tot = float(raw.sum())
        if tot > day_bank * DAY_CAP and tot > 0:
            raw *= (day_bank * DAY_CAP) / tot
        raw = np.minimum(raw, day_bank)
        raw = np.where(raw >= MIN_STAKE, raw, 0.0)
        chunk = binary_pnl(won[i:j], fill[i:j], raw)
        pnls[i:j] = chunk
        stakes_out[i:j] = raw
        bank += float(chunk.sum())
        if bank <= 0:
            bank = 0.0
            break
        i = j
    stats = equity_stats(pnls, sub["end_dt"].tolist(), start=start)
    staked = float(stakes_out.sum())
    stats["total_staked"] = round(staked, 2)
    stats["roi_on_staked"] = round(float(pnls.sum()) / staked * 100.0, 2) if staked else 0.0
    stats["avg_stake"] = round(float(stakes_out[stakes_out > 0].mean()) if np.any(stakes_out > 0) else 0.0, 2)
    stats["max_stake"] = round(float(stakes_out.max()), 2)
    stats["fraction"] = frac
    return stats, pnls


def replay_kelly(
    sub: pd.DataFrame,
    fill: np.ndarray,
    start: float,
    *,
    fraction: float,
    walk_forward: bool,
) -> tuple[dict, np.ndarray]:
    won = sub["won"].to_numpy()
    days = pd.to_datetime(sub["end_dt"], utc=True).dt.date.to_numpy()
    pnls = np.zeros(len(sub), dtype=float)
    stakes_out = np.zeros(len(sub), dtype=float)
    fracs_out = np.zeros(len(sub), dtype=float)
    bank = start
    prior_w: list[float] = []
    prior_f: list[float] = []
    i = 0
    n = len(sub)
    in_sample_p = float(won.mean())
    while i < n:
        d = days[i]
        j = i
        while j < n and days[j] == d:
            j += 1
        n_day = j - i
        day_bank = bank
        raw = np.zeros(n_day, dtype=float)
        for k, idx in enumerate(range(i, j)):
            if walk_forward:
                if len(prior_w) < KELLY_WARMUP:
                    p = fill[idx]  # no edge known yet → skip
                else:
                    p_hat = float(np.mean(prior_w))
                    imp = float(np.mean(prior_f))
                    edge = p_hat - imp
                    p = min(max(fill[idx] + edge, 0.05), 0.95)
            else:
                p = in_sample_p
            f = kelly_fraction(p, float(fill[idx])) * fraction
            fracs_out[idx] = f
            raw[k] = day_bank * f
        raw = np.clip(raw, 0.0, day_bank * PER_BET_CAP)
        tot = float(raw.sum())
        if tot > day_bank * DAY_CAP and tot > 0:
            raw *= (day_bank * DAY_CAP) / tot
        raw = np.minimum(raw, max(day_bank, 0.0))
        raw = np.where(raw >= MIN_STAKE, raw, 0.0)
        chunk = binary_pnl(won[i:j], fill[i:j], raw)
        pnls[i:j] = chunk
        stakes_out[i:j] = raw
        bank += float(chunk.sum())
        for idx in range(i, j):
            prior_w.append(1.0 if bool(won[idx]) else 0.0)
            prior_f.append(float(fill[idx]))
        if bank <= 0:
            bank = 0.0
            break
        i = j
    stats = equity_stats(pnls, sub["end_dt"].tolist(), start=start)
    staked = float(stakes_out.sum())
    stats["total_staked"] = round(staked, 2)
    stats["roi_on_staked"] = round(float(pnls.sum()) / staked * 100.0, 2) if staked else 0.0
    stats["avg_stake"] = round(float(stakes_out[stakes_out > 0].mean()) if np.any(stakes_out > 0) else 0.0, 2)
    stats["max_stake"] = round(float(stakes_out.max()), 2)
    stats["avg_kelly_frac"] = round(float(fracs_out[stakes_out > 0].mean()) if np.any(stakes_out > 0) else 0.0, 4)
    stats["kelly_mult"] = fraction
    stats["walk_forward"] = walk_forward
    stats["warmup_skipped"] = int((stakes_out == 0).sum()) if walk_forward else 0
    return stats, pnls


def bucket_table(sub: pd.DataFrame, fill: np.ndarray, labels: pd.Series, *, min_n: int = 8) -> list[dict]:
    won = sub["won"].to_numpy()
    rows: list[dict] = []
    for lab in labels.dropna().unique():
        m = labels == lab
        n = int(m.sum())
        if n < min_n:
            continue
        pnls = binary_pnl(won[m.to_numpy()], fill[m.to_numpy()], np.full(n, FLAT_STAKE))
        wr = float(won[m.to_numpy()].mean() * 100.0)
        implied = float(fill[m.to_numpy()].mean() * 100.0)
        roi = float(pnls.sum() / (n * FLAT_STAKE) * 100.0)
        rows.append({
            "bucket": str(lab),
            "n": n,
            "win_rate": round(wr, 2),
            "implied_wr": round(implied, 1),
            "edge": round(wr - implied, 1),
            "roi_2c": round(roi, 2),
            "pnl_2c": round(float(pnls.sum()), 2),
            "avg_fill": round(float(fill[m.to_numpy()].mean()), 3),
            "avg_rel": round(float(sub.loc[m, "rel"].mean()), 2),
            "avg_q": round(float(sub.loc[m, "q"].mean()), 1),
            "pf": round(profit_factor(pnls), 2),
        })
    rows.sort(key=lambda r: str(r["bucket"]))
    return rows


def q_label(q: int) -> str:
    if q < 65:
        return "60–64"
    if q < 70:
        return "65–69"
    if q < 75:
        return "70–74"
    if q < 80:
        return "75–79"
    if q < 90:
        return "80–89"
    return "90–100"


def rel_label(rel: float) -> str:
    if rel < 3:
        return "2–3×"
    if rel < 5:
        return "3–5×"
    if rel < 7:
        return "5–7×"
    if rel < 10:
        return "7–10×"
    return "10×+"


def money(v: float) -> str:
    sign = "−" if v < 0 else ""
    return f"{sign}${abs(v):,.0f}"


def pct(v: float) -> str:
    return f"{v:+.1f}%" if v not in (None, 0) else f"{v:.1f}%"


def write_md(payload: dict) -> str:
    u = payload["universe"]
    flat = payload["flat_100"]
    lines = [
        "# Take-book bankroll (Q60 + sport expert + 2×, no NFL)",
        "",
        f"As of **{payload['as_of']}**. Hold to resolution. Fill = **VWAP + 2¢**. "
        f"Start bankroll **{money(START_BANK)}**. Same-day tickets share that morning’s bank "
        f"(day cap 50%, per-bet cap 25%).",
        "",
        f"Tape: **{u['n']} plays**, {u['win_rate']}% WR, {u['first']} → {u['last']}, "
        f"**{u['bets_per_active_day']} bets / active day** "
        f"({u['unique_days']} days with a bet, {u['bets_per_calendar_day']}/calendar day). "
        f"Busiest day: {u['max_bets_one_day']} tickets.",
        "",
        "## Headline: $100 flat vs growing the stake",
        "",
        "| Sizing | End bank | PnL | ROI on start | Max DD $ | Max DD % | Sharpe (calendar) | Sortino (cal.) | Calmar | PF | Avg stake |",
        "|--------|---------:|----:|-------------:|---------:|---------:|------------------:|---------------:|-------:|---:|----------:|",
    ]
    order = [
        ("flat_100", "$100 flat"),
        ("proportional_1pct", "1% of bank (compounds from $10k)"),
        ("kelly_quarter_wf", "¼ Kelly, walk-forward"),
        ("kelly_half_wf", "½ Kelly, walk-forward"),
        ("kelly_full_wf", "Full Kelly, walk-forward"),
        ("kelly_half_insample", "½ Kelly, in-sample p (optimistic)"),
    ]
    for key, name in order:
        s = payload["sizing"][key]
        lines.append(
            f"| **{name}** | {money(s['end'])} | {money(s['pnl'])} | {s['roi_on_start']}% | "
            f"{money(s['max_dd_usd'])} | {s['max_dd_pct']}% | {s.get('sharpe_calendar', s['sharpe_daily_roi'])} | "
            f"{s.get('sortino_calendar', s['sortino_daily_pnl'])} | {s['calmar']} | {s['profit_factor']} | "
            f"{money(s.get('avg_stake') or FLAT_STAKE)} |"
        )
    lines += [
        "",
        f"Flat $100 never resizes: you made **{money(flat['pnl'])}** on **{money(flat['total_staked'])}** "
        f"turned over ({flat['roi_on_staked']}% ROI on staked), ending at **{money(flat['end'])}**. "
        f"Max drawdown **{money(flat['max_dd_usd'])}** ({flat['max_dd_pct']}% of peak equity). "
        f"Longest losing streak **{flat['longest_lose_streak']}**. "
        f"{flat['profitable_days_pct']}% of active days were green.",
        "",
        "Walk-forward Kelly uses only *prior* take-book results (40-play warmup) to estimate edge, "
        "then `f* = (p − fill) / (1 − fill)`. In-sample Kelly peeks at the whole-tape win rate and is **not** a live recipe.",
        "",
        "## $100 flat — ratios",
        "",
        "| Metric | Value |",
        "|--------|------:|",
        f"| Plays | {flat['n']} |",
        f"| Win rate | {flat['win_rate']}% |",
        f"| Expectancy / $100 | {money(flat['expectancy'])} |",
        f"| Avg win / avg loss | {money(flat['avg_win'])} / {money(flat['avg_loss'])} |",
        f"| Profit factor | {flat['profit_factor']} |",
        f"| Sharpe (calendar days, incl. zeros, √365) | {flat.get('sharpe_calendar')} |",
        f"| Sharpe (active days only, daily $ PnL) | {flat['sharpe_daily_pnl']} |",
        f"| Sharpe (active-day ROI, √365) | {flat['sharpe_daily_roi']} |",
        f"| Sortino (calendar) | {flat.get('sortino_calendar')} |",
        f"| Sortino (active days) | {flat['sortino_daily_pnl']} |",
        f"| Calmar (total PnL / abs max DD) | {flat['calmar']} |",
        f"| Max drawdown | {money(flat['max_dd_usd'])} ({flat['max_dd_pct']}%) |",
        f"| Longest lose / win streak | {flat['longest_lose_streak']} / {flat['longest_win_streak']} |",
        f"| Bets per active day | {flat['bets_per_active_day']} (median {flat['median_bets_on_active_day']}, max {flat['max_bets_one_day']}) |",
        f"| Bets per calendar day | {flat['bets_per_calendar_day']} |",
        f"| Date span | {flat['first']} → {flat['last']} ({flat['calendar_days']} days) |",
        "",
        "## Monthly PnL ($100 flat)",
        "",
        "| Month | n | WR | ROI +2¢ | PnL |",
        "|-------|--:|---:|--------:|----:|",
    ]
    for r in payload.get("by_month") or []:
        lines.append(
            f"| {r['month']} | {r['n']} | {r['win_rate']}% | {r['roi_2c']}% | {money(r['pnl_2c'])} |"
        )
    lines += [
        "",
        "## As-of Q (grade at the time of the bet)",
        "",
        "| Q bucket | n | WR | Implied | Edge | ROI +2¢ | PnL @ $100 | Avg rel | PF |",
        "|----------|--:|---:|--------:|-----:|--------:|-----------:|--------:|---:|",
    ]
    for r in payload["by_q"]:
        lines.append(
            f"| {r['bucket']} | {r['n']} | {r['win_rate']}% | {r['implied_wr']}% | {r['edge']} | "
            f"**{r['roi_2c']}%** | {money(r['pnl_2c'])} | {r['avg_rel']}× | {r['pf']} |"
        )
    lines += [
        "",
        "## Relative size vs that trader’s own median (at the time)",
        "",
        "Every row is already ≥2× (the take filter). This is *how much* larger.",
        "",
        "| Size vs own median | n | WR | Implied | Edge | ROI +2¢ | PnL @ $100 | Avg Q | PF |",
        "|--------------------|--:|---:|--------:|-----:|--------:|-----------:|------:|---:|",
    ]
    for r in payload["by_rel"]:
        lines.append(
            f"| {r['bucket']} | {r['n']} | {r['win_rate']}% | {r['implied_wr']}% | {r['edge']} | "
            f"**{r['roi_2c']}%** | {money(r['pnl_2c'])} | {r['avg_q']} | {r['pf']} |"
        )
    lines += [
        "",
        "## Notes",
        "",
        "- **Flat vs compound:** compounding (1% of bank) is the honest “sized up as we grew” path. "
        f"It is the same average risk as $100 on $10k on day one, then the stake rides the equity curve.",
        "- **Kelly:** walk-forward ¼ Kelly is the only Kelly column that stays in a liveable drawdown "
        "(~21%). Half and full Kelly turn a +$6k edge into a casino path (−39% / −68% peak-to-trough). "
        "In-sample ½ Kelly is *worse* than walk-forward because a constant 67% p refuses tickets priced "
        "above ~67¢ and still full-sizes the cold 2025Q1 open. Do not live-trade full Kelly on this tape.",
        "- **Sharpe:** headline number is **calendar Sharpe** (zeros on days with no bet). Active-day "
        "Sharpe ~3.7 annualizes as if you bet 365 days a year — that is not the investor experience.",
        "- This is the **same tape we used to pick the filter**, not a holdout. The $6,229 is the "
        "backtest path at +2¢, not a live guarantee.",
        "- Replay is by **resolution date**, not fill time. Several games can settle the same night; "
        "those tickets share that day’s bank.",
        "",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    if not PLAYS.exists():
        print(f"Missing {PLAYS}; run python pnl_analysis/asof_fullbook_backtest.py first")
        return 1
    df = pd.read_csv(PLAYS)
    df["end_dt"] = pd.to_datetime(df["end_dt"], utc=True)
    df["won"] = df["won"].astype(str).str.lower().isin(["true", "1", "yes"])
    sub = df.loc[take_mask(df)].sort_values("end_dt").reset_index(drop=True)
    if sub.empty:
        print("Take book is empty.")
        return 1
    fill = fill_price(sub["entry"].to_numpy(dtype=float), 0.02)
    won = sub["won"].to_numpy()
    n = len(sub)
    wr = float(won.mean() * 100.0)
    print(f"Take book n={n} WR={wr:.1f}%  {str(sub['end_dt'].min())[:10]} → {str(sub['end_dt'].max())[:10]}")

    flat, _ = replay_flat(sub, fill, START_BANK, FLAT_STAKE)
    prop, _ = replay_proportional(sub, fill, START_BANK, FLAT_STAKE / START_BANK)
    kq, _ = replay_kelly(sub, fill, START_BANK, fraction=0.25, walk_forward=True)
    kh, _ = replay_kelly(sub, fill, START_BANK, fraction=0.50, walk_forward=True)
    kf, _ = replay_kelly(sub, fill, START_BANK, fraction=1.00, walk_forward=True)
    kh_in, _ = replay_kelly(sub, fill, START_BANK, fraction=0.50, walk_forward=False)

    by_q = bucket_table(sub, fill, sub["q"].map(q_label))
    by_rel = bucket_table(sub, fill, sub["rel"].map(rel_label))
    month_lab = pd.to_datetime(sub["end_dt"], utc=True).dt.strftime("%Y-%m")
    by_month = bucket_table(sub, fill, month_lab, min_n=1)
    by_month.sort(key=lambda r: str(r["bucket"]))
    for r in by_month:
        r["month"] = r.pop("bucket")
    # Keep rel buckets in size order
    rel_order = {"2–3×": 0, "3–5×": 1, "5–7×": 2, "7–10×": 3, "10×+": 4}
    by_rel.sort(key=lambda r: rel_order.get(r["bucket"], 9))

    universe = {
        "n": n,
        "win_rate": round(wr, 2),
        "implied_wr": round(float(fill.mean() * 100.0), 1),
        "edge": round(wr - float(fill.mean() * 100.0), 1),
        "first": str(sub["end_dt"].min())[:10],
        "last": str(sub["end_dt"].max())[:10],
        "unique_days": flat["unique_days"],
        "calendar_days": flat["calendar_days"],
        "bets_per_active_day": flat["bets_per_active_day"],
        "bets_per_calendar_day": flat["bets_per_calendar_day"],
        "max_bets_one_day": flat["max_bets_one_day"],
    }
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "as_of": datetime.now(timezone.utc).date().isoformat(),
        "method": (
            "Take book: as-of Q≥60, sport-lane ROI≥+5%, rel≥2× own median, price 10–88¢, no NFL. "
            "Fill VWAP+2¢. Hold to resolution. Start $10k. Same-day bets share AM bankroll."
        ),
        "universe": universe,
        "flat_100": flat,
        "sizing": {
            "flat_100": flat,
            "proportional_1pct": prop,
            "kelly_quarter_wf": kq,
            "kelly_half_wf": kh,
            "kelly_full_wf": kf,
            "kelly_half_insample": kh_in,
        },
        "by_q": by_q,
        "by_rel": by_rel,
        "by_month": by_month,
        "assumptions": {
            "start_bank": START_BANK,
            "flat_stake": FLAT_STAKE,
            "kelly_warmup": KELLY_WARMUP,
            "per_bet_cap": PER_BET_CAP,
            "day_cap": DAY_CAP,
            "slip": 0.02,
        },
    }
    OUT.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    MD.write_text(write_md(payload), encoding="utf-8")

    print(f"\n{'Sizing':<32} {'End':>12} {'PnL':>12} {'DD$':>10} {'Sharpe':>7} {'Calmar':>7}")
    for key, name in [
        ("flat_100", "$100 flat"),
        ("proportional_1pct", "1% compound"),
        ("kelly_quarter_wf", "1/4 Kelly WF"),
        ("kelly_half_wf", "1/2 Kelly WF"),
        ("kelly_full_wf", "Full Kelly WF"),
        ("kelly_half_insample", "1/2 Kelly in-sample"),
    ]:
        s = payload["sizing"][key]
        print(
            f"{name:<32} {s['end']:12,.0f} {s['pnl']:12,.0f} {s['max_dd_usd']:10,.0f} "
            f"{s['sharpe_daily_roi']:7.2f} {s['calmar']:7.2f}"
        )
    print("\nQ buckets:")
    for r in by_q:
        print(f"  {r['bucket']:<8} n={r['n']:>4} WR={r['win_rate']:5.1f}% ROI={r['roi_2c']:6.1f}%")
    print("Rel buckets:")
    for r in by_rel:
        print(f"  {r['bucket']:<8} n={r['n']:>4} WR={r['win_rate']:5.1f}% ROI={r['roi_2c']:6.1f}%")
    print(f"\nWrote {OUT}\nWrote {MD}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
