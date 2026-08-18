#!/usr/bin/env python3
"""
Walk-forward MULTI-TRADER consensus tailing backtest.

Fixes vs the first tailing backtest (which produced fake 70–95% ROIs):
  * Win = token resolved to $1 (curPrice >= 0.99), loss = resolved to $0.
    Never treat realizedPnl > 0 (scalps / early exits) as a binary win.
  * Unit of a play = conditionId + side, not eventSlug blends of ML/spread/total.
  * Trader Q / lane ROI / median stake use only markets that had already
    resolved at least 1 day before this market's endDate (no same-day leak).
  * A tailable signal requires 2+ warmed-up tracked wallets on the same side
    with size, matching how live /api/signals actually grades.

Fills:
  * their_vwap  — dollar-weighted average of members' avgPrice (got their price)
  * join_max    — max member avgPrice (worse of the group)
  * +1c / +2c / +5c on each of those

Writes:
  pnl_analysis/output/walkforward_consensus_backtest.json
  pnl_analysis/output/walkforward_consensus_trades.csv  (best strategy only)
"""
from __future__ import annotations

import json
import math
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_trader import get_market_type, get_sport, price_bucket  # noqa: E402
from run_full_pipeline import OUTPUT_DIR, csv_path_for, roster_traders  # noqa: E402

STAKE = 100.0
WARMUP = 20
MIN_LANE_N = 8
MIN_LANE_ROI = 5.0
KNOWLEDGE_LAG = timedelta(days=1)
MIN_VOTE_USD = 200.0
MIN_COST = 25.0
STALE_ENTRY = 0.88  # live signals drop avgEntry > 0.88
LIVE_LO, LIVE_HI = 0.10, 0.90
SLIPS = (0.0, 0.01, 0.02, 0.05)
MARKET_MAKERS = {"0xd9e0aaca471f489be338fd0f91a26e8669a805f2"}
ELITE_TS = Path(__file__).resolve().parents[1] / "server" / "eliteAnalysis.ts"


# ── Category filters (same lists the live scorer uses) ────────────────────────

def _parse_ts_string_arrays(block: str, key: str) -> list[str]:
    m = re.search(rf"{key}:\s*\[(.*?)\]", block, re.S)
    if not m:
        return []
    return re.findall(r'"([^"]+)"', m.group(1))


def load_category_filters() -> dict[str, dict[str, list[str]]]:
    if not ELITE_TS.exists():
        return {}
    text = ELITE_TS.read_text(encoding="utf-8")
    start = text.find("export const TRADER_CATEGORY_FILTERS")
    if start < 0:
        return {}
    # Cut at the next top-level export after the filters object.
    rest = text[start:]
    end = rest.find("\nexport const", 40)
    chunk = rest if end < 0 else rest[:end]
    out: dict[str, dict[str, list[str]]] = {}
    for m in re.finditer(
        r'"((?:0x)[0-9a-fA-F]+)"\s*:\s*\{(.*?)\n  \},',
        chunk,
        re.S,
    ):
        wallet = m.group(1).lower()
        body = m.group(2)
        out[wallet] = {
            "doNotTail": _parse_ts_string_arrays(body, "doNotTail"),
            "doNotTailMarketTypes": _parse_ts_string_arrays(body, "doNotTailMarketTypes"),
            "doNotTailSides": _parse_ts_string_arrays(body, "doNotTailSides"),
            "doNotTailTitleKeywords": _parse_ts_string_arrays(body, "doNotTailTitleKeywords"),
        }
    return out


def load_aliases() -> dict[str, str]:
    """username-or-wallet -> canonical wallet."""
    if not ELITE_TS.exists():
        return {}
    text = ELITE_TS.read_text(encoding="utf-8")
    out: dict[str, str] = {}
    for m in re.finditer(
        r"canonicalWallet:\s*\"((?:0x)[0-9a-fA-F]+)\"",
        text,
    ):
        # pair with the object key one block up
        pass
    for m in re.finditer(
        r"^\s*([a-zA-Z0-9_-]+):\s*\{\s*canonicalWallet:\s*\"((?:0x)[0-9a-fA-F]+)\"",
        text,
        re.M,
    ):
        out[m.group(1).lower()] = m.group(2).lower()
        out[m.group(2).lower()] = m.group(2).lower()
    return out


def sport_keys(sport: str) -> list[str]:
    s = str(sport)
    keys = [s]
    if s.startswith("SOCCER"):
        keys += ["Soccer"]
        if "UCL" in s:
            keys += ["UCL"]
    elif s == "ESPORTS":
        keys += ["eSports", "LoL", "CS2", "Valorant", "Dota2", "CoD"]
    elif s == "OTHER":
        keys += ["Other", "College Sports"]
    elif s == "POLITICS":
        keys += ["Politics"]
    return keys


def market_keys(market_type: str) -> list[str]:
    m = str(market_type).lower()
    if "spread" in m:
        return ["spread"]
    if "total" in m or "o/u" in m:
        return ["total"]
    if "future" in m:
        return ["futures"]
    return ["moneyline"]


def trader_blocked(
    filters: dict[str, dict[str, list[str]]],
    wallet: str,
    sport: str,
    market_type: str,
    side: str,
    title: str,
) -> bool:
    spec = filters.get(wallet.lower())
    if not spec:
        return False
    sk = set(sport_keys(sport))
    if sk & set(spec.get("doNotTail") or []):
        return True
    mk = set(market_keys(market_type))
    if mk & set(spec.get("doNotTailMarketTypes") or []):
        return True
    sides = {x.lower() for x in (spec.get("doNotTailSides") or [])}
    if side.lower() in sides:
        return True
    title_l = (title or "").lower()
    for kw in spec.get("doNotTailTitleKeywords") or []:
        if kw.lower() in title_l:
            return True
    return False


# ── Expanding quality book (hold-to-resolution PnL, not scalp PnL) ───────────

@dataclass
class Lane:
    n: int = 0
    pnl: float = 0.0
    cost: float = 0.0
    wins: int = 0

    def roi(self) -> float:
        return (self.pnl / self.cost * 100.0) if self.cost > 0 else 0.0


@dataclass
class ExpandingBook:
    n: int = 0
    pnl: float = 0.0
    cost: float = 0.0
    wins: int = 0
    losses: int = 0
    sports: dict[str, Lane] = field(default_factory=lambda: defaultdict(Lane))
    markets: dict[str, Lane] = field(default_factory=lambda: defaultdict(Lane))
    buckets: dict[str, Lane] = field(default_factory=lambda: defaultdict(Lane))
    daily: dict[object, float] = field(default_factory=dict)
    costs: list[float] = field(default_factory=list)

    def update(self, *, pnl: float, cost: float, won: bool, sport: str, market: str, entry: float, day) -> None:
        self.n += 1
        self.pnl += pnl
        self.cost += cost
        if won:
            self.wins += 1
        else:
            self.losses += 1
        for store, key in (
            (self.sports, sport),
            (self.markets, market),
            (self.buckets, price_bucket(entry)),
        ):
            lane = store[key]
            lane.n += 1
            lane.pnl += pnl
            lane.cost += cost
            if won:
                lane.wins += 1
        self.daily[day] = self.daily.get(day, 0.0) + pnl
        self.costs.append(cost)

    def median_stake(self) -> float:
        return float(np.median(self.costs)) if self.costs else 0.0

    def overall_roi(self) -> float:
        return (self.pnl / self.cost * 100.0) if self.cost > 0 else 0.0

    def win_rate(self) -> float:
        d = self.wins + self.losses
        return (self.wins / d * 100.0) if d else 0.0

    def sharpe(self) -> float:
        vals = np.array(list(self.daily.values()), dtype=float)
        if len(vals) < 2 or float(vals.std()) == 0:
            return 0.0
        return float(vals.mean() / vals.std() * math.sqrt(365.0))

    def quality_score(self) -> int:
        if self.n < WARMUP:
            return 0
        roi = self.overall_roi()
        wr = self.win_rate()
        sharpe = self.sharpe()
        days = list(self.daily.values())
        profitable_days = sum(1 for x in days if x > 0)
        total_days = max(len(days), 1)
        sharpe_score = min(max(sharpe / 8 * 30, 0), 30)
        roi_score = min(max(roi / 15 * 25, 0), 25)
        wr_score = min(max((wr - 48) / 15 * 15, 0), 15)
        cons_score = min(max(profitable_days / total_days * 10, 0), 10)
        vol_score = min(max(math.log10(max(self.cost, 1)) / math.log10(5_000_000) * 5, 0), 5)
        base = sharpe_score + roi_score + wr_score + cons_score + vol_score
        mid = []
        flip = self.buckets.get("Flip (40-60c)")
        und = self.buckets.get("Underdog (20-40c)")
        if flip and flip.n >= 10:
            mid.append(flip.roi())
        if und and und.n >= 10:
            mid.append(und.roi())
        midzone = sum(mid) / len(mid) if mid else 0.0
        if midzone >= 15:
            flip_bonus = 15
        elif midzone >= 10:
            flip_bonus = 10
        elif midzone >= 5:
            flip_bonus = 5
        else:
            flip_bonus = 0
        anchor = max(self.pnl, abs(self.pnl), 1.0)
        leakage = 0
        for lane in self.sports.values():
            if lane.n >= 10 and lane.roi() < -5 and lane.pnl < -5_000:
                ratio = abs(lane.pnl) / anchor
                if ratio >= 0.30:
                    leakage += 10
                elif ratio >= 0.10:
                    leakage += 5
                else:
                    leakage += 2
        sp = self.markets.get("Spread")
        if sp and sp.n >= 10 and sp.roi() < -10:
            leakage += 3
        q = int(round(base + flip_bonus - min(leakage, 15)))
        return max(0, min(q, 100))

    def sport_roi(self, sport: str) -> float:
        lane = self.sports.get(sport)
        if lane and lane.n >= MIN_LANE_N:
            return lane.roi()
        return self.overall_roi()

    def lane_ok(self, sport: str) -> bool:
        lane = self.sports.get(sport)
        if not lane or lane.n < MIN_LANE_N:
            return False
        return lane.roi() >= MIN_LANE_ROI

    def snapshot(self, end_dt: datetime) -> dict:
        sport_roi = {k: v.roi() for k, v in self.sports.items() if v.n >= MIN_LANE_N}
        return {
            "end_dt": end_dt,
            "q": self.quality_score(),
            "n": self.n,
            "roi": round(self.overall_roi(), 2),
            "wr": round(self.win_rate(), 2),
            "median": self.median_stake(),
            "sport_roi": sport_roi,
        }


def rel_size_pts(rel: float) -> int:
    if rel >= 10:
        return 15
    if rel >= 7:
        return 13
    if rel >= 5:
        return 10
    if rel >= 3:
        return 7
    if rel >= 2:
        return 4
    return 0


def compute_confidence(
    avg_roi: float,
    consensus_pct: float,
    value_delta: float,
    avg_net: float,
    trader_count: int,
    avg_q: float,
    counters: int,
    rel: float,
) -> tuple[int, dict[str, int]]:
    roi_pct = int(round(min(max(avg_roi / 25.0, 0.0), 1.0) * 40))
    counter_penalty = min(counters * 20, 40) if counters > 0 else 0
    adj = max(0.0, consensus_pct - counter_penalty)
    cons_weight = 0.15 if trader_count == 1 else 0.30
    cons_pct = int(round(min(max(adj - 50.0, 0.0) / 50.0, 1.0) * 100 * cons_weight))
    value_pct = int(round(min(max((value_delta + 0.05) / 0.10, 0.0), 1.0) * 20))
    size_pct = int(round(min(avg_net / 15_000.0, 1.0) * 10))
    rel_pts = rel_size_pts(rel)
    if trader_count >= 3 and avg_q >= 50:
        tier_bonus = 8
    elif trader_count >= 2:
        tier_bonus = 4
    elif avg_q >= 75:
        tier_bonus = 3
    else:
        tier_bonus = 0
    quality_boost = 6 if avg_q >= 80 else 4 if avg_q >= 70 else 2 if avg_q >= 55 else 0
    base = roi_pct + cons_pct + value_pct + size_pct + rel_pts + quality_boost
    single_cap = 82 if rel >= 5 else 76 if rel >= 3 else 72 if rel >= 2 else 68
    cap = single_cap if trader_count == 1 else 100
    score = int(max(min(base + tier_bonus, cap), 0))
    return score, {
        "roi_pct": roi_pct,
        "cons_pct": cons_pct,
        "value_pct": value_pct,
        "size_pct": size_pct,
        "rel_pts": rel_pts,
        "tier_bonus": tier_bonus,
        "quality_boost": quality_boost,
    }


# ── Load directional resolved markets ─────────────────────────────────────────

def load_trader_markets(csv_path: Path, username: str, wallet: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path, low_memory=False)
    need = [
        "conditionId", "avgPrice", "totalBought", "realizedPnl", "cashPnl",
        "curPrice", "title", "slug", "eventSlug", "outcome", "endDate", "status",
    ]
    for col in need:
        if col not in df.columns:
            df[col] = np.nan
    for col in ("avgPrice", "totalBought", "realizedPnl", "cashPnl", "curPrice"):
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)
    df = df[df["status"].astype(str).str.lower().eq("closed")].copy()
    if df.empty:
        return df
    df["side"] = df["outcome"].astype(str).str.strip().str.lower()
    df.loc[df["side"].eq("yes"), "side"] = "Yes"
    df.loc[df["side"].eq("no"), "side"] = "No"
    df["cost"] = df["totalBought"] * df["avgPrice"]
    df["sport_type"] = df.apply(get_sport, axis=1)
    df["market_type"] = df.apply(get_market_type, axis=1)
    # Drop 95c+ NO bonds
    df = df[~((df["side"] == "No") & (df["avgPrice"] >= 0.95))].copy()
    # Both-sides hedge: drop the whole condition for this trader
    if "conditionId" in df.columns:
        sides = df.groupby("conditionId")["side"].agg(lambda s: set(s))
        hedged = {cid for cid, ss in sides.items() if "Yes" in ss and "No" in ss}
        if hedged:
            df = df[~df["conditionId"].isin(hedged)].copy()
    df = df[df["cost"] >= MIN_COST].copy()
    df["end_dt"] = pd.to_datetime(df["endDate"], errors="coerce", utc=True)
    df = df.dropna(subset=["end_dt", "conditionId"])
    resolved = (df["curPrice"] >= 0.99) | (df["curPrice"] <= 0.01)
    df = df[resolved].copy()
    if df.empty:
        return df
    df["won"] = df["curPrice"] >= 0.99
    df["entry_price"] = df["avgPrice"].clip(0.02, 0.98)
    # Hold-to-resolution PnL (what a tailer who copies and holds would get)
    df["hold_pnl"] = np.where(
        df["won"],
        df["cost"] * (1.0 / df["entry_price"] - 1.0),
        -df["cost"],
    )
    def _wavg(g: pd.DataFrame) -> float:
        w = g["cost"].replace(0, 1e-9)
        return float(np.average(g["entry_price"], weights=w))

    g = df.groupby(["conditionId", "side"], dropna=False)
    prices = g.apply(_wavg, include_groups=False)
    agg = g.agg(
        cost=("cost", "sum"),
        hold_pnl=("hold_pnl", "sum"),
        won=("won", "first"),
        cur_price=("curPrice", "first"),
        sport_type=("sport_type", "first"),
        market_type=("market_type", "first"),
        title=("title", "first"),
        event_slug=("eventSlug", "first"),
        slug=("slug", "first"),
        end_dt=("end_dt", "min"),
    ).reset_index()
    agg["entry_price"] = agg.set_index(["conditionId", "side"]).index.map(prices)
    agg["username"] = username
    agg["wallet"] = wallet.lower()
    agg["entry_price"] = agg["entry_price"].clip(0.02, 0.98)
    return agg


def build_snapshots(markets: pd.DataFrame) -> list[dict]:
    book = ExpandingBook()
    snaps: list[dict] = []
    for row in markets.sort_values("end_dt").itertuples(index=False):
        # Snapshot BEFORE this market is known (knowledge is this end_dt)
        # Caller looks up snaps with end_dt <= as_of.
        book.update(
            pnl=float(row.hold_pnl),
            cost=float(row.cost),
            won=bool(row.won),
            sport=str(row.sport_type),
            market=str(row.market_type),
            entry=float(row.entry_price),
            day=row.end_dt.date(),
        )
        snaps.append(book.snapshot(row.end_dt))
    return snaps


def lookup_snap(snaps: list[dict], as_of: datetime) -> dict | None:
    lo, hi, found = 0, len(snaps) - 1, None
    while lo <= hi:
        mid = (lo + hi) // 2
        if snaps[mid]["end_dt"] <= as_of:
            found = snaps[mid]
            lo = mid + 1
        else:
            hi = mid - 1
    return found


# ── Stats ─────────────────────────────────────────────────────────────────────

def max_drawdown(pnls: np.ndarray) -> float:
    if len(pnls) == 0:
        return 0.0
    eq = np.cumsum(pnls)
    peak = np.maximum.accumulate(eq)
    return float((eq - peak).min())


def profit_factor(pnls: np.ndarray) -> float:
    gp = float(pnls[pnls > 0].sum()) if len(pnls) else 0.0
    gl = float(-pnls[pnls < 0].sum()) if len(pnls) else 0.0
    if gl <= 0:
        return float("inf") if gp > 0 else 0.0
    return gp / gl


def daily_roi_sharpe(dates: list, pnls: np.ndarray) -> float:
    if len(pnls) < 10:
        return 0.0
    by_pnl: dict[object, float] = defaultdict(float)
    by_n: dict[object, int] = defaultdict(int)
    for d, x in zip(dates, pnls):
        day = d.date() if hasattr(d, "date") else d
        by_pnl[day] += float(x)
        by_n[day] += 1
    rois = np.array([by_pnl[d] / (by_n[d] * STAKE) for d in by_pnl], dtype=float)
    if len(rois) < 10 or float(rois.std()) == 0:
        return 0.0
    return float(rois.mean() / rois.std() * math.sqrt(365.0))


def summarize(sub: pd.DataFrame, fill_col: str, slip: float) -> dict:
    if sub.empty:
        return {
            "n": 0, "wins": 0, "losses": 0, "win_rate": 0.0,
            "unit_pnl": 0.0, "expectancy": 0.0, "roi": 0.0,
            "profit_factor": 0.0, "sharpe_daily_roi": 0.0, "max_dd": 0.0,
            "avg_grade": 0.0, "avg_q": 0.0, "avg_fill": 0.0, "avg_vwap": 0.0,
            "implied_wr": 0.0, "edge": 0.0, "avg_traders": 0.0, "avg_rel": 0.0,
            "calmar": 0.0, "days": 0,
        }
    fills = np.clip(sub[fill_col].to_numpy(dtype=float) + slip, 0.02, 0.98)
    won = sub["won"].to_numpy()
    pnls = np.where(won, STAKE * (1.0 / fills - 1.0), -STAKE)
    n = int(len(sub))
    wins = int(won.sum())
    wr = wins / n * 100.0
    upnl = float(pnls.sum())
    implied = float(fills.mean() * 100.0)
    dates = sub["end_dt"].tolist()
    dd = max_drawdown(pnls)
    return {
        "n": n,
        "wins": wins,
        "losses": n - wins,
        "win_rate": round(wr, 2),
        "unit_pnl": round(upnl, 2),
        "expectancy": round(float(pnls.mean()), 2),
        "roi": round(upnl / (n * STAKE) * 100.0, 2),
        "profit_factor": round(profit_factor(pnls), 3),
        "sharpe_daily_roi": round(daily_roi_sharpe(dates, pnls), 2),
        "max_dd": round(dd, 2),
        "avg_grade": round(float(sub["grade"].mean()), 1),
        "avg_q": round(float(sub["avg_q"].mean()), 1),
        "avg_fill": round(float(fills.mean()), 3),
        "avg_vwap": round(float(sub["vwap"].mean()), 3),
        "implied_wr": round(implied, 1),
        "edge": round(wr - implied, 1),
        "avg_traders": round(float(sub["n_traders"].mean()), 2),
        "avg_rel": round(float(sub["rel_size"].mean()), 2),
        "calmar": round(upnl / abs(dd or 1.0), 2),
        "days": int(sub["end_dt"].dt.date.nunique()),
    }


def year_split(sub: pd.DataFrame, fill_col: str, slip: float) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if sub.empty:
        return out
    years = sub["end_dt"].dt.year
    for year, grp in sub.groupby(years):
        out[str(int(year))] = summarize(grp, fill_col, slip)
    return out


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    filters = load_category_filters()
    aliases = load_aliases()
    print(f"Loaded {len(filters)} category filters, {len(aliases)} alias keys")

    all_markets: list[pd.DataFrame] = []
    snaps_by_wallet: dict[str, list[dict]] = {}
    print("Loading directional resolved markets (curPrice 0/1, hedges stripped)…")
    for wallet, username in roster_traders():
        w = wallet.lower()
        if w in MARKET_MAKERS:
            continue
        # Collapse known aliases onto the canonical wallet id for consensus counting
        canon = aliases.get(username.lower()) or aliases.get(w) or w
        csv_p = csv_path_for(wallet, username)
        if not csv_p.exists():
            continue
        try:
            mk = load_trader_markets(csv_p, username, canon)
        except Exception as e:
            print(f"  skip {username}: {e}")
            continue
        if len(mk) < WARMUP + 5:
            continue
        snaps_by_wallet[canon] = build_snapshots(mk)
        all_markets.append(mk)
        last_q = snaps_by_wallet[canon][-1]["q"] if snaps_by_wallet[canon] else 0
        print(f"  {username:<32} {len(mk):>5} markets  final Q={last_q}")

    if not all_markets:
        print("No markets loaded.")
        return 1

    pos = pd.concat(all_markets, ignore_index=True)
    print(f"\nUniverse: {len(pos):,} trader-markets across {pos['wallet'].nunique()} wallets")

    # ── Diagnostic: copy-all hold-to-res vs fake pnl-win (single name, no consensus)
    copy_all_won = pos["won"].to_numpy()
    copy_fills = pos["entry_price"].to_numpy()
    copy_pnls = np.where(copy_all_won, STAKE * (1.0 / copy_fills - 1.0), -STAKE)
    copy_roi = float(copy_pnls.sum() / (len(pos) * STAKE) * 100)
    copy_wr = float(copy_all_won.mean() * 100)
    copy_imp = float(copy_fills.mean() * 100)
    print(
        f"SANITY copy-all hold-to-res: n={len(pos):,} WR={copy_wr:.1f}% "
        f"implied={copy_imp:.1f}% edge={copy_wr-copy_imp:+.1f} ROI={copy_roi:.1f}%"
    )

    # ── Build one cluster per conditionId (dominant side, 1+ traders) ─────────
    clusters: list[dict] = []
    grouped = pos.groupby("conditionId", sort=False)
    for cid, g in grouped:
        yes = g[g["side"] == "Yes"]
        no = g[g["side"] == "No"]
        # Unique wallets per side (alias already collapsed)
        def pack(side_df: pd.DataFrame) -> pd.DataFrame:
            if side_df.empty:
                return side_df
            return (
                side_df.sort_values("cost", ascending=False)
                .drop_duplicates("wallet", keep="first")
            )

        yes_u = pack(yes)
        no_u = pack(no)
        # Dominant by trader count, then size
        yes_n, no_n = len(yes_u), len(no_u)
        yes_sz = float(yes_u["cost"].sum()) if yes_n else 0.0
        no_sz = float(no_u["cost"].sum()) if no_n else 0.0
        if yes_n > no_n or (yes_n == no_n and yes_sz >= no_sz):
            dom, opp, side = yes_u, no_u, "Yes"
        else:
            dom, opp, side = no_u, yes_u, "No"
        if dom.empty:
            continue
        end_dt = pd.Timestamp(dom["end_dt"].min())
        as_of = end_dt.to_pydatetime() - KNOWLEDGE_LAG
        if as_of.tzinfo is None:
            as_of = as_of.replace(tzinfo=timezone.utc)

        voters = []
        for r in dom.itertuples(index=False):
            snap = lookup_snap(snaps_by_wallet.get(str(r.wallet), []), as_of)
            n_prior = int(snap["n"]) if snap else 0
            q = int(snap["q"]) if snap else 0
            median = float(snap["median"]) if snap and snap["median"] else 0.0
            roi = float(snap["roi"]) if snap else 0.0
            sport_roi = 0.0
            lane_ok = False
            if snap:
                sport_roi = float(snap["sport_roi"].get(str(r.sport_type), roi))
                lane = snap["sport_roi"].get(str(r.sport_type))
                lane_ok = lane is not None and lane >= MIN_LANE_ROI
            rel = (float(r.cost) / median) if median > 0 else 1.0
            blocked = trader_blocked(
                filters, str(r.wallet), str(r.sport_type), str(r.market_type),
                str(r.side), str(r.title or ""),
            )
            voters.append({
                "wallet": str(r.wallet),
                "username": str(r.username),
                "cost": float(r.cost),
                "entry": float(r.entry_price),
                "q": q,
                "n_prior": n_prior,
                "roi": roi,
                "sport_roi": sport_roi,
                "lane_ok": lane_ok,
                "rel": rel,
                "blocked": blocked,
                "warm": n_prior >= WARMUP,
            })

        counters = []
        for r in opp.itertuples(index=False):
            snap = lookup_snap(snaps_by_wallet.get(str(r.wallet), []), as_of)
            q = int(snap["q"]) if snap else 0
            n_prior = int(snap["n"]) if snap else 0
            blocked = trader_blocked(
                filters, str(r.wallet), str(r.sport_type), str(r.market_type),
                str(r.side), str(r.title or ""),
            )
            counters.append({
                "wallet": str(r.wallet),
                "q": q,
                "cost": float(r.cost),
                "warm": n_prior >= WARMUP,
                "blocked": blocked,
            })

        title = str(dom["title"].iloc[0] or "")
        sport = str(dom["sport_type"].iloc[0])
        mtype = str(dom["market_type"].iloc[0])
        won = bool(dom["won"].iloc[0])
        # If members disagree on resolution, skip
        if int(dom["won"].nunique()) != 1:
            continue

        clusters.append({
            "conditionId": str(cid),
            "side": side,
            "title": title,
            "event_slug": str(dom["event_slug"].iloc[0] or ""),
            "slug": str(dom["slug"].iloc[0] or ""),
            "sport_type": sport,
            "market_type": mtype,
            "end_dt": end_dt,
            "won": won,
            "voters": voters,
            "counters": counters,
        })

    print(f"Clusters (unique markets): {len(clusters):,}")

    # Score every cluster under two voter definitions: raw vs category-filtered
    rows = []
    for c in clusters:
        for use_filters, tag in ((False, "raw"), (True, "filtered")):
            voters = [
                v for v in c["voters"]
                if v["warm"] and v["cost"] >= MIN_VOTE_USD and (not use_filters or not v["blocked"])
            ]
            counters = [
                v for v in c["counters"]
                if v["warm"] and v["cost"] >= MIN_VOTE_USD and (not use_filters or not v["blocked"])
            ]
            n_dom = len(voters)
            n_ctr = len(counters)
            if n_dom < 1:
                continue
            total_on_market = n_dom + n_ctr
            consensus_pct = (n_dom / total_on_market * 100.0) if total_on_market else 100.0
            risk = sum(v["cost"] for v in voters) or 1.0
            avg_q = sum(v["q"] * v["cost"] for v in voters) / risk
            avg_roi = sum(v["sport_roi"] * v["cost"] for v in voters) / risk
            avg_net = risk / n_dom
            rel = sum(v["rel"] * v["cost"] for v in voters) / risk
            vwap = sum(v["entry"] * v["cost"] for v in voters) / risk
            join_max = max(v["entry"] for v in voters)
            min_q = min(v["q"] for v in voters)
            n_q50 = sum(1 for v in voters if v["q"] >= 50)
            n_q35 = sum(1 for v in voters if v["q"] >= 35)
            n_rel2 = sum(1 for v in voters if v["rel"] >= 2)
            lane_frac = sum(1 for v in voters if v["lane_ok"]) / n_dom
            grade, _ = compute_confidence(
                avg_roi, consensus_pct, 0.0, avg_net, n_dom, avg_q, n_ctr, rel
            )
            names = ",".join(sorted({v["username"] for v in voters})[:6])
            rows.append({
                "filter_mode": tag,
                "conditionId": c["conditionId"],
                "side": c["side"],
                "title": c["title"],
                "event_slug": c["event_slug"],
                "sport_type": c["sport_type"],
                "market_type": c["market_type"],
                "end_dt": c["end_dt"],
                "won": c["won"],
                "n_traders": n_dom,
                "n_counters": n_ctr,
                "consensus_pct": round(consensus_pct, 1),
                "total_size": round(risk, 2),
                "avg_q": round(avg_q, 1),
                "min_q": min_q,
                "avg_roi": round(avg_roi, 2),
                "rel_size": round(rel, 2),
                "vwap": round(float(np.clip(vwap, 0.02, 0.98)), 4),
                "join_max": round(float(np.clip(join_max, 0.02, 0.98)), 4),
                "grade": grade,
                "n_q50": n_q50,
                "n_q35": n_q35,
                "n_rel2": n_rel2,
                "lane_frac": round(lane_frac, 2),
                "traders": names,
                "price_band": price_bucket(vwap),
            })

    cl = pd.DataFrame(rows)
    cl["end_dt"] = pd.to_datetime(cl["end_dt"], utc=True)
    print(f"Scored rows: {len(cl):,} (raw+filtered)")

    # ── Strategies ────────────────────────────────────────────────────────────
    filt = cl[cl["filter_mode"] == "filtered"].copy()
    raw = cl[cl["filter_mode"] == "raw"].copy()

    def m_ge2(df: pd.DataFrame) -> pd.Series:
        return df["n_traders"] >= 2

    strategies: list[tuple[str, pd.DataFrame, pd.Series]] = []

    def add(name: str, df: pd.DataFrame, mask: pd.Series) -> None:
        strategies.append((name, df, mask.fillna(False).astype(bool)))

    # Core consensus
    add("raw_2plus_any", raw, m_ge2(raw))
    add("filt_2plus_any", filt, m_ge2(filt))
    add("filt_3plus_any", filt, filt["n_traders"] >= 3)
    add("filt_2plus_no_counter", filt, m_ge2(filt) & (filt["n_counters"] == 0))
    add("filt_2plus_q35", filt, m_ge2(filt) & (filt["min_q"] >= 35))
    add("filt_2plus_q50", filt, m_ge2(filt) & (filt["min_q"] >= 50))
    add("filt_2plus_both_q50", filt, (filt["n_q50"] >= 2))
    add("filt_2plus_q50_size1k", filt, m_ge2(filt) & (filt["min_q"] >= 50) & (filt["total_size"] >= 1000))
    add("filt_2plus_q50_rel2", filt, m_ge2(filt) & (filt["min_q"] >= 50) & (filt["n_rel2"] >= 1))
    add("filt_2plus_q50_lane", filt, m_ge2(filt) & (filt["min_q"] >= 50) & (filt["lane_frac"] >= 0.5))
    add("filt_2plus_grade60", filt, m_ge2(filt) & (filt["grade"] >= 60))
    add("filt_2plus_grade70", filt, m_ge2(filt) & (filt["grade"] >= 70))
    add("filt_2plus_grade80", filt, m_ge2(filt) & (filt["grade"] >= 80))
    add("filt_2plus_grade90", filt, m_ge2(filt) & (filt["grade"] >= 90))
    add("filt_3plus_grade70", filt, (filt["n_traders"] >= 3) & (filt["grade"] >= 70))
    add("filt_2plus_q50_grade70", filt, m_ge2(filt) & (filt["min_q"] >= 50) & (filt["grade"] >= 70))
    add("filt_2plus_q50_nocounter_grade70", filt,
        m_ge2(filt) & (filt["min_q"] >= 50) & (filt["n_counters"] == 0) & (filt["grade"] >= 70))

    # Price bands (live 10–90, drop stale >88)
    live_px = m_ge2(filt) & (filt["vwap"] >= LIVE_LO) & (filt["vwap"] <= LIVE_HI) & (filt["vwap"] <= STALE_ENTRY)
    add("filt_2plus_live_10_90", filt, live_px)
    add("filt_2plus_longshot_0_20", filt, m_ge2(filt) & (filt["vwap"] < 0.20))
    add("filt_2plus_underdog_20_40", filt, m_ge2(filt) & (filt["vwap"] >= 0.20) & (filt["vwap"] < 0.40))
    add("filt_2plus_flip_40_60", filt, m_ge2(filt) & (filt["vwap"] >= 0.40) & (filt["vwap"] < 0.60))
    add("filt_2plus_fav_60_80", filt, m_ge2(filt) & (filt["vwap"] >= 0.60) & (filt["vwap"] < 0.80))
    add("filt_2plus_safe_80_88", filt, m_ge2(filt) & (filt["vwap"] >= 0.80) & (filt["vwap"] <= STALE_ENTRY))

    # Price × quality
    add("filt_2q50_flip_40_60", filt, m_ge2(filt) & (filt["min_q"] >= 50) & (filt["vwap"] >= 0.40) & (filt["vwap"] < 0.60))
    add("filt_2q50_20_60", filt, m_ge2(filt) & (filt["min_q"] >= 50) & (filt["vwap"] >= 0.20) & (filt["vwap"] < 0.60))
    add("filt_2q50_40_70", filt, m_ge2(filt) & (filt["min_q"] >= 50) & (filt["vwap"] >= 0.40) & (filt["vwap"] < 0.70))
    add("filt_2q50_live_grade70", filt, live_px & (filt["min_q"] >= 50) & (filt["grade"] >= 70))
    add("filt_2q50_flip_grade70", filt,
        m_ge2(filt) & (filt["min_q"] >= 50) & (filt["grade"] >= 70) & (filt["vwap"] >= 0.40) & (filt["vwap"] < 0.60))
    add("filt_2q50_nocounter_flip", filt,
        m_ge2(filt) & (filt["min_q"] >= 50) & (filt["n_counters"] == 0) & (filt["vwap"] >= 0.40) & (filt["vwap"] < 0.60))
    add("filt_2plus_moneyline_q50", filt,
        m_ge2(filt) & (filt["min_q"] >= 50) & (filt["market_type"] == "Moneyline / Match"))
    add("filt_2plus_sports_q50", filt,
        m_ge2(filt) & (filt["min_q"] >= 50) & (filt["sport_type"] != "POLITICS"))
    add("filt_2q50_rel2_flip", filt,
        m_ge2(filt) & (filt["min_q"] >= 50) & (filt["n_rel2"] >= 1) & (filt["vwap"] >= 0.40) & (filt["vwap"] < 0.60))
    add("filt_3plus_q50_nocounter", filt,
        (filt["n_traders"] >= 3) & (filt["min_q"] >= 50) & (filt["n_counters"] == 0))
    add("filt_2q50_size2k_live", filt,
        live_px & (filt["min_q"] >= 50) & (filt["total_size"] >= 2000))

    # Grade bands for calibration
    add("band_grade_90", filt, m_ge2(filt) & (filt["grade"] >= 90))
    add("band_grade_80_89", filt, m_ge2(filt) & (filt["grade"] >= 80) & (filt["grade"] < 90))
    add("band_grade_70_79", filt, m_ge2(filt) & (filt["grade"] >= 70) & (filt["grade"] < 80))
    add("band_grade_60_69", filt, m_ge2(filt) & (filt["grade"] >= 60) & (filt["grade"] < 70))
    add("band_grade_lt60", filt, m_ge2(filt) & (filt["grade"] < 60))

    table_rows: list[dict] = []
    by_strategy: dict[str, dict] = {}
    print("\n" + "=" * 128)
    print(
        f"{'Strategy':<38} {'Fill':>8} {'Slip':>4} {'N':>5} {'WR':>6} {'Impl':>6} "
        f"{'Edge':>6} {'ROI':>7} {'PF':>6} {'Shp':>6} {'DD':>8} {'Days':>5}"
    )
    print("-" * 128)

    fill_modes = (("vwap", "vwap"), ("join", "join_max"))
    for name, df, mask in strategies:
        sub0 = df.loc[mask]
        block: dict[str, dict] = {}
        for fill_name, fill_col in fill_modes:
            for slip in SLIPS:
                stats = summarize(sub0, fill_col, slip)
                key = f"{fill_name}_{int(slip*100)}c"
                block[key] = stats
                table_rows.append({"strategy": name, "fill": fill_name, "slip": f"{int(slip*100)}c", **stats})
                if stats["n"] >= 20 and fill_name == "vwap" and slip in (0.0, 0.02):
                    print(
                        f"{name:<38} {fill_name:>8} {int(slip*100):>3}c {stats['n']:>5} "
                        f"{stats['win_rate']:>5.1f}% {stats['implied_wr']:>5.1f} "
                        f"{stats['edge']:>+5.1f} {stats['roi']:>6.1f}% "
                        f"{stats['profit_factor']:>6.2f} {stats['sharpe_daily_roi']:>6.2f} "
                        f"{stats['max_dd']:>8.0f} {stats['days']:>5}"
                    )
        by_strategy[name] = block

    # Pick best: honest fill = vwap+2c, require n>=80, days>=60, +2c ROI>0, edge>0,
    # both years non-negative when n>=25. Rank by vwap+2c ROI then Sharpe then n.
    def robustness_ok(name: str, df: pd.DataFrame, mask: pd.Series) -> tuple[bool, dict]:
        sub = df.loc[mask]
        s2 = summarize(sub, "vwap", 0.02)
        s0 = summarize(sub, "vwap", 0.0)
        sj = summarize(sub, "join_max", 0.02)
        years = year_split(sub, "vwap", 0.02)
        year_ok = True
        for y, ys in years.items():
            if ys["n"] >= 25 and ys["roi"] < -2:
                year_ok = False
        ok = (
            s2["n"] >= 80
            and s2["days"] >= 60
            and s2["roi"] > 0
            and s2["edge"] > 0
            and s0["edge"] > 0
            and year_ok
        )
        return ok, {"s0": s0, "s2": s2, "sjoin2": sj, "years": years}

    ranked = []
    for name, df, mask in strategies:
        if name.startswith("band_"):
            continue
        ok, pack = robustness_ok(name, df, mask)
        if not ok:
            continue
        ranked.append((pack["s2"]["roi"], pack["s2"]["sharpe_daily_roi"], pack["s2"]["n"], name, df, mask, pack))
    ranked.sort(reverse=True)

    print("\n" + "=" * 128)
    print("ROBUST candidates (n≥80, ≥60 days, +2¢ VWAP ROI>0 and edge>0, no year < −2%):")
    for roi, shp, n, name, *_ in ranked[:15]:
        print(f"  {name:<42} ROI@2c={roi:6.2f}%  Sharpe={shp:5.2f}  n={n}")

    if ranked:
        _roi, _shp, _n, best_name, best_df, best_mask, best_pack = ranked[0]
    else:
        # Fallback: highest +2c ROI with n>=50 even if robustness fails
        fallback = []
        for name, df, mask in strategies:
            if name.startswith("band_"):
                continue
            s2 = summarize(df.loc[mask], "vwap", 0.02)
            if s2["n"] >= 50:
                fallback.append((s2["roi"], s2["sharpe_daily_roi"], s2["n"], name, df, mask, {
                    "s0": summarize(df.loc[mask], "vwap", 0.0),
                    "s2": s2,
                    "sjoin2": summarize(df.loc[mask], "join_max", 0.02),
                    "years": year_split(df.loc[mask], "vwap", 0.02),
                }))
        fallback.sort(reverse=True)
        if not fallback:
            print("No strategy produced 50+ trades.")
            return 1
        _roi, _shp, _n, best_name, best_df, best_mask, best_pack = fallback[0]
        print(f"\nNo fully robust book; falling back to largest +2c ROI with n≥50: {best_name}")

    best_sub = best_df.loc[best_mask].sort_values("end_dt")
    print(f"\nBEST STRATEGY: {best_name}")
    for label, st in (("their VWAP", best_pack["s0"]), ("VWAP +2c", best_pack["s2"]), ("join_max +2c", best_pack["sjoin2"])):
        print(
            f"  {label:<16} n={st['n']} WR={st['win_rate']:.1f}% implied={st['implied_wr']:.1f}% "
            f"edge={st['edge']:+.1f} ROI={st['roi']:.1f}% PF={st['profit_factor']:.2f} "
            f"Sharpe={st['sharpe_daily_roi']:.2f} DD={st['max_dd']:.0f} Exp=${st['expectancy']:.2f}"
        )
    print("  by year @ VWAP+2c:")
    for y, ys in sorted(best_pack["years"].items()):
        print(f"    {y}: n={ys['n']} WR={ys['win_rate']:.1f}% ROI={ys['roi']:.1f}% edge={ys['edge']:+.1f}")

    # Sport / price breakdown of best
    by_sport = {}
    for sport, grp in best_sub.groupby("sport_type"):
        by_sport[str(sport)] = {
            "0c": summarize(grp, "vwap", 0.0),
            "2c": summarize(grp, "vwap", 0.02),
        }
    by_band = {}
    for band, grp in best_sub.groupby("price_band"):
        by_band[str(band)] = {
            "0c": summarize(grp, "vwap", 0.0),
            "2c": summarize(grp, "vwap", 0.02),
        }

    last20 = best_sub.sort_values("end_dt", ascending=False).head(20)
    last20_out = []
    for r in last20.itertuples(index=False):
        fill = min(max(float(r.vwap) + 0.02, 0.02), 0.98)
        pnl = STAKE * (1.0 / fill - 1.0) if bool(r.won) else -STAKE
        last20_out.append({
            "end": r.end_dt.isoformat(),
            "title": r.title,
            "side": r.side,
            "sport": r.sport_type,
            "market": r.market_type,
            "traders": r.traders,
            "n_traders": int(r.n_traders),
            "n_counters": int(r.n_counters),
            "grade": int(r.grade),
            "avg_q": float(r.avg_q),
            "min_q": int(r.min_q),
            "rel_size": float(r.rel_size),
            "their_vwap": float(r.vwap),
            "join_max": float(r.join_max),
            "fill_vwap_plus_2c": round(fill, 4),
            "resolved": "WIN" if bool(r.won) else "LOSS",
            "unit_pnl_at_2c": round(pnl, 2),
            "total_size": float(r.total_size),
            "event_slug": r.event_slug,
        })

    # Calibration of 2+ filtered grades
    calibration = []
    for lo, hi, label in (
        (90, 101, "90+"),
        (80, 90, "80-89"),
        (70, 80, "70-79"),
        (60, 70, "60-69"),
        (0, 60, "<60"),
    ):
        band = filt[m_ge2(filt) & (filt["grade"] >= lo) & (filt["grade"] < hi)]
        if band.empty:
            calibration.append({"band": label, "n": 0})
            continue
        st = summarize(band, "vwap", 0.02)
        calibration.append({"band": label, **st})

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": (
            "Hold-to-resolution walk-forward multi-trader consensus. "
            "Win iff curPrice>=0.99 (token paid $1), loss iff curPrice<=0.01. "
            "Play = conditionId+side. Trader Q/lane/median use only markets with "
            "endDate <= this market endDate minus 1 day. Voters need 20 prior "
            "resolved markets and ≥$200 stake. Category doNotTail filters applied "
            "in 'filtered' strategies. $100/play. VWAP = their price; join_max = "
            "worse member entry; slips +1/2/5c."
        ),
        "bugfix": {
            "previous_error": (
                "First backtest treated realizedPnl>0 as a binary win and paid 1/price-1. "
                "Scalps on losing tokens were scored as huge underdog wins."
            ),
            "copy_all_hold_to_res": {
                "n": int(len(pos)),
                "win_rate": round(copy_wr, 2),
                "implied_wr": round(copy_imp, 1),
                "edge": round(copy_wr - copy_imp, 1),
                "roi": round(copy_roi, 2),
            },
        },
        "params": {
            "warmup": WARMUP,
            "knowledge_lag_days": 1,
            "min_vote_usd": MIN_VOTE_USD,
            "stale_entry": STALE_ENTRY,
            "stake": STAKE,
        },
        "universe": {
            "trader_markets": int(len(pos)),
            "wallets": int(pos["wallet"].nunique()),
            "clusters": int(len(clusters)),
            "filtered_2plus": int((m_ge2(filt)).sum()),
        },
        "calibration_2plus_filtered_vwap_2c": calibration,
        "strategies": by_strategy,
        "robust_ranked": [
            {
                "strategy": name,
                "roi_vwap_2c": pack["s2"]["roi"],
                "sharpe": pack["s2"]["sharpe_daily_roi"],
                "n": pack["s2"]["n"],
                "edge": pack["s2"]["edge"],
                "win_rate": pack["s2"]["win_rate"],
                "implied": pack["s2"]["implied_wr"],
                "years": pack["years"],
            }
            for _, _, _, name, _, _, pack in ranked[:12]
        ],
        "best_strategy": best_name,
        "best_stats": {
            "their_vwap": best_pack["s0"],
            "vwap_plus_2c": best_pack["s2"],
            "join_max_plus_2c": best_pack["sjoin2"],
            "years_vwap_2c": best_pack["years"],
            "by_sport": by_sport,
            "by_price_band": by_band,
        },
        "last_20_plays": last20_out,
    }

    out_json = OUTPUT_DIR / "walkforward_consensus_backtest.json"
    out_csv = OUTPUT_DIR / "walkforward_consensus_trades.csv"
    out_json.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    best_sub.to_csv(out_csv, index=False)
    print(f"\nWrote {out_json}")
    print(f"Wrote {out_csv} ({len(best_sub)} best-strategy trades)")
    print("\nLast 20 plays this strategy would have taken:")
    for p in last20_out:
        print(
            f"  {p['end'][:10]}  {p['resolved']:<4}  {p['side']:<3}  "
            f"vwap={p['their_vwap']:.3f} +2c={p['fill_vwap_plus_2c']:.3f}  "
            f"g={p['grade']} q={p['avg_q']:.0f} n={p['n_traders']}  "
            f"{p['title'][:70]}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
