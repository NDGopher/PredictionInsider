#!/usr/bin/env python3
"""Walk-forward Verified Elite Sniper — true as-of backtest.

Honesty contract (no peeking):
  1. Features (Q, sport ROI, median, rel) use only markets that had already
     resolved ≥ KNOWLEDGE_LAG before the *alert* time.
  2. Alert time = first fill timestamp when available; else endDate − 12h.
  3. Elite promote / demote / stale-kick uses ONLY markets resolved before
     that same alert as-of. The play being graded is never in the roster stats.
  4. We only "trade" a play if the trader was already elite at alert time
     AND the Sniper gates fire (Q≥60, sport ROI≥+5%, rel≥2×, 10–88¢, no NFL).
  5. Labels are hold-to-resolution (curPrice ≥ 0.99). Fill = VWAP + 2¢.
  6. ROI is $100 flat stake per alerted play — what we would have traded.

Fluid roster:
  - Promote when take-rule history clears gates + active + joinable.
  - Kick when stale (quiet 30d) or take-slice bleed.
  - Re-promote when gates clear again (up-and-comers + comebacks).

Writes:
  pnl_analysis/output/walkforward_elite_sniper.json
  pnl_analysis/output/verified_elite_roster.json
  pnl_analysis/VERIFIED_ELITE_SNIPER.md

Usage:
  python pnl_analysis/walkforward_elite_sniper.py
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from asof_fullbook_backtest import asof_stat, load_trusted  # noqa: E402
from copy_roster import OUTPUT_DIR, ROOT, load_universe  # noqa: E402
from position_utils import play_label, sport_family  # noqa: E402
from run_full_pipeline import csv_path_for  # noqa: E402
from walkforward_consensus_backtest import (  # noqa: E402
    KNOWLEDGE_LAG,
    LIVE_HI,
    LIVE_LO,
    MIN_COST,
    MIN_LANE_ROI,
    STAKE,
    STALE_ENTRY,
    WARMUP,
    ExpandingBook,
    attach_event_dates,
    build_snapshots,
    classify_submarket,
    get_market_type,
    get_sport,
    lookup_snap,
    read_trader_csv,
)

OUT_JSON = OUTPUT_DIR / "walkforward_elite_sniper.json"
ROSTER_JSON = OUTPUT_DIR / "verified_elite_roster.json"
OUT_MD = ROOT / "VERIFIED_ELITE_SNIPER.md"

# ── Elite membership (as-of only) ────────────────────────────────────────────
ELITE_MIN_TAKE_N = 40
ELITE_MIN_TAKE_ROI = 8.0          # +2¢ unit ROI on historical take-gate plays
ELITE_REPROMOTE_ROI = 8.0
ELITE_MIN_ACTIVE_30D = 8          # any resolved markets in last 30d (anti-stale)
ELITE_STALE_30D = 5               # kick if fewer than this in last 30d
ELITE_BLEED_60D_N = 12
ELITE_BLEED_60D_ROI = -5.0
ELITE_LIFE_FLOOR_N = 40
ELITE_LIFE_FLOOR_ROI = 5.0        # demote if lifetime take ROI collapses below product bar
MEDIAN_JOIN_MAX = 15_000.0
WR_LO = 48.0
WR_HI = 75.0
WR_HI_SPECIALIST = 85.0           # allow high-WR only if take n/roi proven
ALERT_FALLBACK_HOURS = 12
# Sports-share: reject books that are mostly politics/other on the take-slice
ELITE_MIN_SPORTS_FRAC = 0.60


def _parse_ts(raw: Any) -> datetime | None:
    """Unix s/ms/ns or ISO → UTC datetime."""
    if raw is None or (isinstance(raw, float) and np.isnan(raw)):
        return None
    try:
        if isinstance(raw, (int, float, np.integer, np.floating)):
            v = float(raw)
            if v > 1e17:  # ns
                v /= 1e9
            elif v > 1e14:  # µs
                v /= 1e6
            elif v > 1e11:  # ms
                v /= 1e3
            if v < 1e9:
                return None
            return datetime.fromtimestamp(v, tz=timezone.utc)
        ts = pd.Timestamp(raw)
        if pd.isna(ts):
            return None
        if ts.tzinfo is None:
            ts = ts.tz_localize("UTC")
        else:
            ts = ts.tz_convert("UTC")
        return ts.to_pydatetime()
    except Exception:
        return None


def load_markets_with_entry(csv_path: Path, username: str, wallet: str) -> pd.DataFrame:
    """Resolved directional markets + first_fill_ts for alert-time as-of."""
    df = read_trader_csv(csv_path)
    need = [
        "conditionId", "avgPrice", "totalBought", "realizedPnl", "cashPnl",
        "curPrice", "title", "slug", "eventSlug", "outcome", "endDate", "status",
        "timestamp", "initialValue",
    ]
    for col in need:
        if col not in df.columns:
            df[col] = np.nan
    for col in ("avgPrice", "totalBought", "realizedPnl", "cashPnl", "curPrice", "initialValue"):
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)
    price_res = (df["curPrice"] >= 0.99) | (df["curPrice"] <= 0.01)
    if "redeemable" in df.columns:
        redeem_res = df["redeemable"].astype(str).str.lower().isin(["true", "1", "yes"])
        resolved = price_res | redeem_res
    else:
        resolved = price_res
    df = df[resolved].copy()
    if df.empty:
        return df
    df["side"] = df["outcome"].astype(str).str.strip().str.lower()
    df.loc[df["side"].eq("yes"), "side"] = "Yes"
    df.loc[df["side"].eq("no"), "side"] = "No"
    bought_cost = df["totalBought"] * df["avgPrice"]
    df["cost"] = bought_cost.where(bought_cost > 0, df["initialValue"])
    df["sport_type"] = df.apply(get_sport, axis=1)
    df["market_type"] = df.apply(get_market_type, axis=1)
    df["submarket"] = df.apply(classify_submarket, axis=1)
    df = df[~((df["side"] == "No") & (df["avgPrice"] >= 0.95))].copy()
    if "conditionId" in df.columns:
        sides = df.groupby("conditionId")["side"].agg(lambda s: set(s))
        hedged = {cid for cid, ss in sides.items() if "Yes" in ss and "No" in ss}
        if hedged:
            df = df[~df["conditionId"].isin(hedged)].copy()
    df = df[df["cost"] >= MIN_COST].copy()
    df = attach_event_dates(df)
    df["end_dt"] = df["event_dt"]
    df = df.dropna(subset=["end_dt", "conditionId"])
    horizon = datetime.now(timezone.utc) + timedelta(days=1)
    df = df[df["end_dt"] <= horizon]
    if df.empty:
        return df
    df["won"] = df["curPrice"] >= 0.99
    df["entry_price"] = df["avgPrice"].clip(0.02, 0.98)
    df["hold_pnl"] = np.where(
        df["won"],
        df["cost"] * (1.0 / df["entry_price"] - 1.0),
        -df["cost"],
    )
    df["_fill_ts"] = df["timestamp"].map(_parse_ts)

    def _wavg(g: pd.DataFrame) -> float:
        w = g["cost"].replace(0, 1e-9)
        return float(np.average(g["entry_price"], weights=w))

    g = df.groupby(["conditionId", "side"], dropna=False)
    prices = g.apply(_wavg, include_groups=False)
    first_ts = g["_fill_ts"].min()
    agg = g.agg(
        cost=("cost", "sum"),
        hold_pnl=("hold_pnl", "sum"),
        won=("won", "first"),
        cur_price=("curPrice", "first"),
        sport_type=("sport_type", "first"),
        market_type=("market_type", "first"),
        submarket=("submarket", "first"),
        title=("title", "first"),
        event_slug=("eventSlug", "first"),
        slug=("slug", "first"),
        end_dt=("end_dt", "min"),
    ).reset_index()
    agg["entry_price"] = agg.set_index(["conditionId", "side"]).index.map(prices)
    agg["first_fill_ts"] = agg.set_index(["conditionId", "side"]).index.map(first_ts)
    agg["username"] = username
    agg["wallet"] = wallet.lower()
    agg["entry_price"] = agg["entry_price"].clip(0.02, 0.98)
    return agg


def alert_time(row: Any) -> datetime:
    end_dt = pd.Timestamp(row.end_dt).to_pydatetime()
    if end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=timezone.utc)
    fill = getattr(row, "first_fill_ts", None)
    if fill is not None and not (isinstance(fill, float) and np.isnan(fill)):
        if isinstance(fill, pd.Timestamp):
            fill = fill.to_pydatetime()
        if isinstance(fill, datetime):
            if fill.tzinfo is None:
                fill = fill.replace(tzinfo=timezone.utc)
            # Sanity: fill should be before or near end; else fall back
            if fill <= end_dt + timedelta(days=2):
                return fill
    return end_dt - timedelta(hours=ALERT_FALLBACK_HOURS)


def unit_pnl(won: bool, entry: float, slip: float = 0.02) -> float:
    px = min(max(float(entry) + slip, 0.02), 0.98)
    return STAKE * (1.0 / px - 1.0) if won else -STAKE


@dataclass
class EliteState:
    is_elite: bool = False
    take_n: int = 0
    take_roi: float = 0.0
    active_30d: int = 0
    median: float = 0.0
    wr: float = 0.0
    why: str = "init"
    promoted_at: str | None = None
    kicked_at: str | None = None


@dataclass
class TraderWalk:
    username: str
    wallet: str
    events: list[dict[str, Any]] = field(default_factory=list)
    trades: list[dict[str, Any]] = field(default_factory=list)
    roster_log: list[dict[str, Any]] = field(default_factory=list)


def take_window_stats(prior_takes: list[dict[str, Any]], as_of: datetime, days: int) -> tuple[int, float]:
    cut = as_of - timedelta(days=days)
    rows = [t for t in prior_takes if t["end_dt"] >= cut]
    if not rows:
        return 0, 0.0
    pnls = [t["pnl_2c"] for t in rows]
    return len(rows), float(sum(pnls) / (len(rows) * STAKE) * 100.0)


def joinable(median: float, wr: float, take_n: int, take_roi: float) -> tuple[bool, str]:
    if median <= 0 or median >= MEDIAN_JOIN_MAX:
        return False, f"median=${median:,.0f}"
    if WR_LO <= wr <= WR_HI:
        return True, "wr_band"
    if wr <= WR_HI_SPECIALIST and take_n >= ELITE_MIN_TAKE_N and take_roi >= ELITE_MIN_TAKE_ROI:
        return True, f"specialist_wr={wr:.0f}"
    return False, f"wr={wr:.0f}_out"


def decide_elite(
    *,
    was_elite: bool,
    prior_takes: list[dict[str, Any]],
    active_30d: int,
    median: float,
    wr: float,
    as_of: datetime,
) -> EliteState:
    take_n = len(prior_takes)
    if take_n:
        take_roi = float(sum(t["pnl_2c"] for t in prior_takes) / (take_n * STAKE) * 100.0)
        sports_n = sum(
            1 for t in prior_takes if _is_sports_family(str(t.get("sport_family") or ""))
        )
        sports_frac = sports_n / take_n
    else:
        take_roi = 0.0
        sports_frac = 0.0
    n60, roi60 = take_window_stats(prior_takes, as_of, 60)

    ok_join, join_why = joinable(median, wr, take_n, take_roi)

    # Kick paths (apply even if previously elite)
    if was_elite:
        if active_30d < ELITE_STALE_30D:
            return EliteState(
                False, take_n, take_roi, active_30d, median, wr,
                f"stale_30d_n={active_30d}",
            )
        if n60 >= ELITE_BLEED_60D_N and roi60 < ELITE_BLEED_60D_ROI:
            return EliteState(
                False, take_n, take_roi, active_30d, median, wr,
                f"bleed_60d_n={n60}_roi={roi60:.1f}",
            )
        if take_n >= ELITE_LIFE_FLOOR_N and take_roi < ELITE_LIFE_FLOOR_ROI:
            return EliteState(
                False, take_n, take_roi, active_30d, median, wr,
                f"life_floor_roi={take_roi:.1f}",
            )
        if sports_frac < ELITE_MIN_SPORTS_FRAC:
            return EliteState(
                False, take_n, take_roi, active_30d, median, wr,
                f"sports_frac={sports_frac:.2f}",
            )
        if not ok_join:
            return EliteState(
                False, take_n, take_roi, active_30d, median, wr,
                f"unjoinable_{join_why}",
            )
        return EliteState(
            True, take_n, take_roi, active_30d, median, wr,
            f"keep_elite take={take_n}/{take_roi:.1f}% active30={active_30d}",
        )

    # Promote path
    if not ok_join:
        return EliteState(False, take_n, take_roi, active_30d, median, wr, f"not_joinable_{join_why}")
    if take_n < ELITE_MIN_TAKE_N:
        return EliteState(False, take_n, take_roi, active_30d, median, wr, f"thin_take_n={take_n}")
    if take_roi < ELITE_MIN_TAKE_ROI:
        return EliteState(False, take_n, take_roi, active_30d, median, wr, f"take_roi={take_roi:.1f}<{ELITE_MIN_TAKE_ROI}")
    if sports_frac < ELITE_MIN_SPORTS_FRAC:
        return EliteState(
            False, take_n, take_roi, active_30d, median, wr,
            f"sports_frac={sports_frac:.2f}<{ELITE_MIN_SPORTS_FRAC}",
        )
    if active_30d < ELITE_MIN_ACTIVE_30D:
        return EliteState(False, take_n, take_roi, active_30d, median, wr, f"quiet_30d_n={active_30d}")
    if n60 >= ELITE_BLEED_60D_N and roi60 < 0:
        return EliteState(False, take_n, take_roi, active_30d, median, wr, f"recent_bleed_60d={roi60:.1f}")
    return EliteState(
        True, take_n, take_roi, active_30d, median, wr,
        f"promote take={take_n}/{take_roi:.1f}% {join_why} active30={active_30d} sports={sports_frac:.0%}",
    )


def _is_sports_family(fam: str) -> bool:
    f = (fam or "").upper()
    if not f or f in {"OTHER", "POLITICS", "CRYPTO", "FINANCE"}:
        return False
    if "NFL" in f:
        return False  # product skips NFL
    return True


def sniper_gates(q: int, lane_ok: bool, rel: float, entry: float, sport_family_name: str) -> list[str]:
    misses: list[str] = []
    if q < 60:
        misses.append(f"Q {q}<60")
    if not lane_ok:
        misses.append("sport_lane")
    if rel < 2:
        misses.append(f"rel {rel:.1f}<2")
    live_ok = LIVE_LO <= entry <= min(LIVE_HI, STALE_ENTRY)
    if not live_ok:
        misses.append(f"entry {entry:.2f}")
    if "NFL" in (sport_family_name or "").upper():
        misses.append("NFL")
    return misses


def walk_trader(username: str, wallet: str, mk: pd.DataFrame) -> TraderWalk:
    import heapq

    out = TraderWalk(username=username, wallet=wallet)
    if len(mk) < WARMUP + 5:
        return out
    snaps = build_snapshots(mk)
    rows = list(mk.itertuples(index=False))
    rows.sort(key=lambda r: (alert_time(r), pd.Timestamp(r.end_dt).to_pydatetime()))

    # Pending resolutions: (end_dt, is_take, pnl_2c, sport_family)
    pending: list[tuple[datetime, bool, float, str]] = []
    known_ends: list[datetime] = []
    prior_takes: list[dict[str, Any]] = []
    state = EliteState()

    def flush_resolved(as_of: datetime) -> None:
        while pending and pending[0][0] <= as_of:
            end_dt, is_take, pnl, fam = heapq.heappop(pending)
            known_ends.append(end_dt)
            if is_take:
                prior_takes.append({
                    "end_dt": end_dt,
                    "pnl_2c": pnl,
                    "won": pnl > 0,
                    "sport_family": fam,
                })

    for r in rows:
        end_dt = pd.Timestamp(r.end_dt).to_pydatetime()
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)
        alert_at = alert_time(r)
        as_of = alert_at - KNOWLEDGE_LAG
        flush_resolved(as_of)

        snap = lookup_snap(snaps, as_of)
        n_prior = int(snap["n"]) if snap else 0
        if n_prior < WARMUP:
            heapq.heappush(pending, (end_dt, False, 0.0, ""))
            continue

        q = int(snap["q"]) if snap else 0
        median = float(snap["median"]) if snap else 0.0
        roi = float(snap["roi"]) if snap else 0.0
        wr_use = float(snap.get("wr") or 0.0) if snap else 0.0
        if wr_use <= 0:
            wr_use = 50.0
        sport = str(r.sport_type)
        sub = str(getattr(r, "submarket", None) or r.market_type)
        sport_roi = float((snap.get("sport_roi") or {}).get(sport, roi)) if snap else roi
        lane_ok = sport in (snap.get("sport_roi") or {}) and sport_roi >= MIN_LANE_ROI
        rel = (float(r.cost) / median) if median > 0 else 1.0
        rel = min(rel, 30.0)
        entry = float(np.clip(r.entry_price, 0.02, 0.98))
        fam = sport_family(sport)
        misses = sniper_gates(q, lane_ok, rel, entry, fam)
        product_ok = len(misses) == 0

        active_30d = sum(
            1 for e in known_ends if (as_of - timedelta(days=30)) <= e <= as_of
        )
        new_state = decide_elite(
            was_elite=state.is_elite,
            prior_takes=prior_takes,
            active_30d=active_30d,
            median=median,
            wr=wr_use,
            as_of=as_of,
        )

        if new_state.is_elite != state.is_elite:
            out.roster_log.append({
                "at": as_of.isoformat(),
                "alert_ref": alert_at.isoformat(),
                "action": "promote" if new_state.is_elite else "kick",
                "why": new_state.why,
                "take_n": new_state.take_n,
                "take_roi": round(new_state.take_roi, 2),
                "active_30d": new_state.active_30d,
                "median": round(median, 2),
            })
            if new_state.is_elite:
                new_state.promoted_at = as_of.isoformat()
            else:
                new_state.kicked_at = as_of.isoformat()
        state = new_state

        if product_ok and state.is_elite:
            pnl = unit_pnl(bool(r.won), entry, 0.02)
            out.trades.append({
                "username": username,
                "wallet": wallet,
                "alerted_at": alert_at.isoformat(),
                "as_of": as_of.isoformat(),
                "event_end": end_dt.isoformat(),
                "title": str(r.title or ""),
                "side": str(r.side),
                "sport": sport,
                "sport_family": fam,
                "submarket": sub,
                "play": play_label(str(r.title or ""), str(r.side), sport, sub),
                "q": q,
                "rel": round(rel, 2),
                "sport_roi": round(sport_roi, 1),
                "entry": round(entry, 4),
                "fill_plus_2c": round(min(entry + 0.02, 0.98), 4),
                "cost": round(float(r.cost), 2),
                "won": bool(r.won),
                "unit_pnl": round(pnl, 2),
                "elite_why": state.why,
                "conditionId": str(r.conditionId),
            })

        # Schedule resolution into known history only after end_dt (no peek)
        pnl_2c = unit_pnl(bool(r.won), entry, 0.02) if product_ok else 0.0
        heapq.heappush(pending, (end_dt, product_ok, pnl_2c, fam))

    # Flush remaining for final elite status at "now"
    now = datetime.now(timezone.utc)
    flush_resolved(now)
    active_30d = sum(1 for e in known_ends if (now - timedelta(days=30)) <= e <= now)
    # Final decide with last known median/wr from last snap
    last_snap = snaps[-1] if snaps else None
    final = decide_elite(
        was_elite=state.is_elite,
        prior_takes=prior_takes,
        active_30d=active_30d,
        median=float(last_snap["median"]) if last_snap else 0.0,
        wr=float(last_snap.get("wr") or 50.0) if last_snap else 50.0,
        as_of=now,
    )
    if final.is_elite != state.is_elite:
        out.roster_log.append({
            "at": now.isoformat(),
            "alert_ref": now.isoformat(),
            "action": "promote" if final.is_elite else "kick",
            "why": final.why,
            "take_n": final.take_n,
            "take_roi": round(final.take_roi, 2),
            "active_30d": final.active_30d,
            "median": round(float(last_snap["median"]) if last_snap else 0.0, 2),
        })
    state = final

    out.events.append({
        "username": username,
        "final_elite": state.is_elite,
        "final_why": state.why,
        "take_n": state.take_n,
        "take_roi": round(state.take_roi, 2),
        "active_30d": state.active_30d,
        "median": round(float(last_snap["median"]) if last_snap else 0.0, 2),
        "trades": len(out.trades),
        "roster_changes": len(out.roster_log),
    })
    return out


def enrich_snap_wr() -> None:
    """Monkey-patch ExpandingBook.snapshot to expose wr/wins for joinable checks."""
    _orig = ExpandingBook.snapshot

    def _snapshot(self: ExpandingBook, end_dt: datetime) -> dict:
        s = _orig(self, end_dt)
        s["wr"] = self.win_rate()
        s["wins"] = self.wins
        return s

    ExpandingBook.snapshot = _snapshot  # type: ignore[method-assign]


def candidate_books() -> list[tuple[str, str]]:
    """Joinable-scale live/bench/watch + trusted only (skip mega MM CSVs)."""
    from copy_roster import CSV_ROWS_BOT, CLOSED_MAX_COPY

    pairs: list[tuple[str, str]] = []
    seen: set[str] = set()
    uni = load_universe()
    for bucket in ("live", "bench", "watch"):
        for t in uni.get(bucket) or []:
            w = str(t.get("wallet") or "").lower()
            u = str(t.get("username") or "")
            if not w or w in seen:
                continue
            csv_p = csv_path_for(w, u)
            if not csv_p.exists():
                continue
            # Hard skip mega tapes — walk-forward is O(n) per market
            rows = int(t.get("rows") or 0)
            closed = int(t.get("closed") or 0)
            if rows >= CSV_ROWS_BOT or closed >= CLOSED_MAX_COPY:
                print(f"  skip mega {u}: rows={rows} closed={closed}", flush=True)
                continue
            pairs.append((u, w))
            seen.add(w)
    for t in load_trusted():
        w = str(t.get("wallet") or "").lower()
        u = str(t.get("username") or "")
        if not w or w in seen:
            continue
        csv_p = csv_path_for(w, u)
        if not csv_p.exists():
            continue
        # Capman etc. allowed even if large — but skip absurd
        try:
            line_est = sum(1 for _ in open(csv_p, "rb")) - 1
        except OSError:
            line_est = 0
        if line_est >= CSV_ROWS_BOT:
            print(f"  skip mega trusted {u}: ~{line_est} rows", flush=True)
            continue
        pairs.append((u, w))
        seen.add(w)
    return pairs


def leave_one_out(trades: pd.DataFrame) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if trades.empty:
        return out
    for user in sorted(trades["username"].unique()):
        sub = trades[trades["username"] != user].copy()
        sub["end_dt"] = pd.to_datetime(sub["event_end"], utc=True)
        st = asof_stat(sub, 0.02)
        out.append({
            "dropped": user,
            "n_remaining": st["n"],
            "win_rate": st["win_rate"],
            "roi_2c": st["roi"],
            "unit_pnl": st["unit_pnl"],
        })
    return out


def write_md(payload: dict[str, Any]) -> None:
    st = payload.get("portfolio") or {}
    cur = payload.get("current_elite") or []
    lines = [
        "# Verified Elite Sniper — walk-forward backtest",
        "",
        f"Generated **{payload['generated_at'][:19]} UTC**.",
        "",
        "## Honesty contract",
        "",
        "- Alert time = first fill timestamp (else endDate−12h).",
        "- Q / sport ROI / rel / median use only markets resolved ≥1 day before alert.",
        "- Elite promote/kick uses only take-gate history resolved before alert.",
        "- Trade only if trader was **already elite** at alert AND Sniper gates clear.",
        "- Fill = VWAP+2¢, $100/play, hold to resolution. No peeking at the outcome for ranking.",
        "",
        "## Portfolio (what we would have traded)",
        "",
        f"- **n={st.get('n')}** · WR **{st.get('win_rate')}%** · ROI+2¢ **{st.get('roi')}%** · "
        f"PnL **${st.get('unit_pnl')}** · PF {st.get('profit_factor')} · maxDD ${st.get('max_dd')}",
        f"- Span {st.get('first')} → {st.get('last')} · ~{st.get('trades_per_day')}/day",
        f"- Avg Q {st.get('avg_q')} · avg rel {st.get('avg_rel')}× · edge {st.get('edge')}%",
        "",
        "### Rolling windows",
        "",
    ]
    for key in ("last_30d", "last_60d", "last_90d"):
        w = (payload.get("windows") or {}).get(key) or {}
        lines.append(
            f"- **{key}**: n={w.get('n')} WR={w.get('win_rate')}% ROI+2¢={w.get('roi')}% PnL=${w.get('unit_pnl')}"
        )
    lines += ["", "### By quarter", ""]
    for q, w in (payload.get("quarters") or {}).items():
        lines.append(f"- **{q}**: n={w.get('n')} WR={w.get('win_rate')}% ROI={w.get('roi')}%")
    lines += ["", "### Leave-one-out (robustness)", ""]
    for row in payload.get("leave_one_out") or []:
        lines.append(
            f"- Drop **{row['dropped']}**: n={row['n_remaining']} WR={row['win_rate']}% ROI={row['roi_2c']}%"
        )
    lines += ["", "### By trader (contributors)", ""]
    for row in payload.get("by_trader") or []:
        lines.append(
            f"- **{row['username']}**: n={row['n']} WR={row['win_rate']}% ROI={row['roi']}% "
            f"PnL=${row['unit_pnl']} elite_days≈{row.get('elite_periods')}"
        )
    lines += [
        "",
        "## Current elite roster (as-of now)",
        "",
    ]
    if not cur:
        lines.append("_No one currently elite — gates are strict; waiting for promote._")
    for e in cur:
        lines.append(
            f"- **{e['username']}** — take n={e['take_n']} ROI={e['take_roi']}% "
            f"active30={e['active_30d']} median=${e.get('median') or 0:,.0f} · {e['why']}"
        )
    lines += [
        "",
        "## Proven bench (cleared gates, currently stale — will re-promote when active)",
        "",
    ]
    bench = payload.get("proven_bench") or []
    if not bench:
        lines.append("_None._")
    for e in bench:
        lines.append(
            f"- **{e['username']}** — take n={e['take_n']} ROI={e['take_roi']}% · {e['why']}"
        )
    lines += [
        "",
        "## Recent roster changes (fluid)",
        "",
    ]
    for ch in (payload.get("recent_roster_changes") or [])[:25]:
        lines.append(
            f"- {str(ch.get('at') or '')[:10]} **{ch['action']}** {ch['username']}: {ch['why']}"
        )
    lines += [
        "",
        "## Last 20 trades we would have taken",
        "",
    ]
    for t in (payload.get("last_trades") or [])[:20]:
        wl = "W" if t.get("won") else "L"
        lines.append(
            f"- {str(t.get('alerted_at') or '')[:10]} {wl} ${t.get('unit_pnl')} "
            f"Q={t.get('q')} rel={t.get('rel')}× **{t.get('username')}** — {str(t.get('title') or '')[:55]}"
        )
    lines += [
        "",
        "## Rules",
        "",
        f"- Promote: take-gate n≥{ELITE_MIN_TAKE_N}, ROI+2¢≥{ELITE_MIN_TAKE_ROI}%, "
        f"sports_frac≥{ELITE_MIN_SPORTS_FRAC:.0%}, active30≥{ELITE_MIN_ACTIVE_30D}, "
        f"joinable median < ${MEDIAN_JOIN_MAX:,.0f}, "
        f"WR {WR_LO}–{WR_HI} (or ≤{WR_HI_SPECIALIST} if take proven).",
        f"- Kick: active30<{ELITE_STALE_30D}, or 60d take ROI<{ELITE_BLEED_60D_ROI}% (n≥{ELITE_BLEED_60D_N}), "
        f"or life take ROI<{ELITE_LIFE_FLOOR_ROI}% (n≥{ELITE_LIFE_FLOOR_N}).",
        "- Sniper play: Q≥60, sport ROI≥+5%, rel≥2×, 10–88¢, no NFL.",
        "",
    ]
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    enrich_snap_wr()
    books = candidate_books()
    print(f"Verified Elite walk-forward  books={len(books)}  stake=${STAKE:.0f}", flush=True)
    walks: list[TraderWalk] = []
    for username, wallet in books:
        csv_p = csv_path_for(wallet, username)
        try:
            mk = load_markets_with_entry(csv_p, username, wallet)
        except Exception as exc:
            print(f"  skip {username}: {exc}", flush=True)
            continue
        if len(mk) < WARMUP + 5:
            print(f"  skip {username}: n={len(mk)}", flush=True)
            continue
        tw = walk_trader(username, wallet, mk)
        walks.append(tw)
        ev = tw.events[0] if tw.events else {}
        print(
            f"  {username:<36} markets={len(mk):>5} trades={len(tw.trades):>4} "
            f"elite_now={ev.get('final_elite')} take={ev.get('take_n')}/{ev.get('take_roi')}%",
            flush=True,
        )

    all_trades = [t for w in walks for t in w.trades]
    roster_changes = []
    for w in walks:
        for ch in w.roster_log:
            roster_changes.append({"username": w.username, **ch})
    roster_changes.sort(key=lambda x: x.get("at") or "")

    if all_trades:
        tdf = pd.DataFrame(all_trades)
        tdf["end_dt"] = pd.to_datetime(tdf["event_end"], utc=True)
        tdf["entry"] = tdf["entry"].astype(float)
        portfolio = asof_stat(tdf, 0.02)
        # windows from max end
        end = tdf["end_dt"].max()
        windows = {}
        for days, key in ((30, "last_30d"), (60, "last_60d"), (90, "last_90d")):
            cut = end - timedelta(days=days)
            windows[key] = asof_stat(tdf[tdf["end_dt"] >= cut], 0.02)
        quarters: dict[str, Any] = {}
        q = tdf["end_dt"].dt.tz_convert("UTC").dt.to_period("Q").astype(str)
        tmp = tdf.copy()
        tmp["_q"] = q.to_numpy()
        for key, grp in tmp.groupby("_q"):
            quarters[str(key)] = asof_stat(grp.drop(columns=["_q"]), 0.02)
        by_trader = []
        for user, grp in tdf.groupby("username"):
            st = asof_stat(grp, 0.02)
            by_trader.append({
                "username": user,
                **{k: st[k] for k in ("n", "win_rate", "roi", "unit_pnl", "first", "last")},
                "elite_periods": sum(1 for w in walks if w.username == user for _ in w.roster_log if _.get("action") == "promote"),
            })
        by_trader.sort(key=lambda r: -r["n"])
        loo = leave_one_out(tdf)
        last_trades = (
            tdf.sort_values("end_dt", ascending=False)
            .head(20)
            .drop(columns=["end_dt"], errors="ignore")
            .to_dict(orient="records")
        )
    else:
        portfolio = asof_stat(pd.DataFrame(), 0.02)
        windows, quarters, by_trader, loo, last_trades = {}, {}, [], [], []

    current_elite = []
    proven_bench = []
    for w in walks:
        if not w.events:
            continue
        ev = w.events[0]
        row = {
            "username": w.username,
            "wallet": w.wallet,
            "take_n": ev.get("take_n"),
            "take_roi": ev.get("take_roi"),
            "active_30d": ev.get("active_30d"),
            "median": ev.get("median"),
            "why": ev.get("final_why"),
            "trades_in_backtest": len(w.trades),
        }
        if ev.get("final_elite"):
            current_elite.append(row)
        elif (
            int(ev.get("take_n") or 0) >= ELITE_MIN_TAKE_N
            and float(ev.get("take_roi") or 0) >= ELITE_MIN_TAKE_ROI
            and str(ev.get("final_why") or "").startswith("stale")
        ):
            row["status"] = "proven_bench_stale"
            proven_bench.append(row)
    current_elite.sort(key=lambda x: -(x.get("take_roi") or 0))
    proven_bench.sort(key=lambda x: -(x.get("take_roi") or 0))

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": (
            "Walk-forward Verified Elite: promote/kick from as-of take-gate history only; "
            "trade only if elite at first-fill alert AND Sniper gates; fill VWAP+2¢; hold to res."
        ),
        "rules": {
            "elite_min_take_n": ELITE_MIN_TAKE_N,
            "elite_min_take_roi": ELITE_MIN_TAKE_ROI,
            "elite_min_active_30d": ELITE_MIN_ACTIVE_30D,
            "elite_stale_30d": ELITE_STALE_30D,
            "elite_bleed_60d": {"n": ELITE_BLEED_60D_N, "roi": ELITE_BLEED_60D_ROI},
            "median_join_max": MEDIAN_JOIN_MAX,
            "wr_band": [WR_LO, WR_HI],
            "wr_specialist_max": WR_HI_SPECIALIST,
            "sniper": "Q>=60, sport ROI>=+5%, rel>=2x, 10-88c, no NFL",
            "alert_time": "first_fill_ts else endDate-12h",
            "knowledge_lag_days": KNOWLEDGE_LAG.days,
            "stake_usd": STAKE,
            "slip_cents": 2,
        },
        "books_scanned": len(walks),
        "portfolio": portfolio,
        "windows": windows,
        "quarters": quarters,
        "by_trader": by_trader,
        "leave_one_out": loo,
        "current_elite": current_elite,
        "proven_bench": proven_bench,
        "recent_roster_changes": list(reversed(roster_changes[-40:])),
        "last_trades": last_trades,
        "trader_summaries": [w.events[0] for w in walks if w.events],
        "passes_product_bar": bool(portfolio.get("n", 0) >= 80 and (portfolio.get("roi") or 0) >= 5.0),
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")

    roster_payload = {
        "generated_at": payload["generated_at"],
        "rule": "walkforward_verified_elite",
        "sniper_strategy": "asof_live_q60_sport_rel2",
        "elite": current_elite,
        "proven_bench": proven_bench,
        "backtest": {
            "n": portfolio.get("n"),
            "win_rate": portfolio.get("win_rate"),
            "roi_2c": portfolio.get("roi"),
            "unit_pnl": portfolio.get("unit_pnl"),
            "passes_5pct_bar": payload["passes_product_bar"],
        },
        "note": (
            "Telegram / main tracking = elite (live) only. "
            "proven_bench = historically cleared gates but currently stale — auto-repromotes when active again. "
            "Watch/Radar heat is separate and must not dilute this book."
        ),
    }
    ROSTER_JSON.write_text(json.dumps(roster_payload, indent=2) + "\n", encoding="utf-8")
    write_md(payload)

    print("\n=== PORTFOLIO ===")
    print(
        f"n={portfolio.get('n')} WR={portfolio.get('win_rate')}% "
        f"ROI+2c={portfolio.get('roi')}% PnL=${portfolio.get('unit_pnl')} "
        f"pass_5%={payload['passes_product_bar']}"
    )
    print(f"Current elite ({len(current_elite)}):", ", ".join(e["username"] for e in current_elite) or "(none)")
    print(f"Wrote {OUT_JSON}")
    print(f"Wrote {ROSTER_JSON}")
    print(f"Wrote {OUT_MD}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
