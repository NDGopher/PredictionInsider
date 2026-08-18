#!/usr/bin/env python3
"""
Re-grade every roster wallet with hold-to-resolution PnL.

Includes unredeemed settled-open rows (curPrice 0/1) and parses event dates from
endDate / slug / title so May–August 2026 games are not dropped.

Writes:
  pnl_analysis/output/trader_health.json
  pnl_analysis/TRADER_HEALTH_REPORT.md
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_trader import get_market_type, get_sport  # noqa: E402
from position_utils import (  # noqa: E402
    attach_event_dates,
    classify_submarket,
    cost_basis,
    dashboard_pnl,
    is_redeemable_flag,
    sport_family,
)
from run_full_pipeline import OUTPUT_DIR, csv_path_for, roster_traders  # noqa: E402

MIN_COST = 25.0
AS_OF = datetime.now(timezone.utc)
CANNAE = "0x7ea571c40408f340c1c8fc8eaacebab53c1bde7b"
MM = {"0xd9e0aaca471f489be338fd0c91a26e8669a805f2", "0xd9e0aaca471f489be338fd0f91a26e8669a805f2"}
QUIT_DAYS = 45
UNTAILABLE_MEDIAN = 50_000.0
GRINDER_WR = 94.0
GRINDER_MIN_N = 200


def _stats(sub: pd.DataFrame) -> dict:
    """Hold-to-resolution copy-and-hold PnL."""
    if sub is None or sub.empty:
        return {
            "n": 0, "wins": 0, "win_rate": 0.0, "cost": 0.0, "pnl": 0.0,
            "roi": 0.0, "first": None, "last": None,
        }
    n = int(len(sub))
    wins = int(sub["won"].sum())
    cost = float(sub["cost"].sum())
    pnl = float(sub["hold_pnl"].sum())
    roi = (pnl / cost * 100.0) if cost > 0 else 0.0
    wr = wins / n * 100.0 if n else 0.0
    return {
        "n": n,
        "wins": wins,
        "win_rate": round(wr, 1),
        "cost": round(cost, 2),
        "pnl": round(pnl, 2),
        "roi": round(roi, 2),
        "first": str(sub["end_dt"].min())[:10],
        "last": str(sub["end_dt"].max())[:10],
    }


def _dash_stats(sub: pd.DataFrame) -> dict:
    """Dashboard recency: sum(realizedPnl+cashPnl) / cost on event-dated rows."""
    if sub is None or sub.empty:
        return {
            "n": 0, "wins": 0, "win_rate": 0.0, "cost": 0.0, "pnl": 0.0,
            "roi": 0.0, "first": None, "last": None,
        }
    n = int(len(sub))
    wins = int(sub["won"].sum()) if "won" in sub.columns else 0
    cost = float(sub["cost"].sum())
    pnl = float(sub["dash_pnl"].sum()) if "dash_pnl" in sub.columns else float(sub["hold_pnl"].sum())
    roi = (pnl / cost * 100.0) if cost > 0 else 0.0
    wr = wins / n * 100.0 if n else 0.0
    return {
        "n": n,
        "wins": wins,
        "win_rate": round(wr, 1),
        "cost": round(cost, 2),
        "pnl": round(pnl, 2),
        "roi": round(roi, 2),
        "first": str(sub["end_dt"].min())[:10],
        "last": str(sub["end_dt"].max())[:10],
    }


def _group_stats(sub: pd.DataFrame, col: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if sub.empty or col not in sub.columns:
        return out
    for key, grp in sub.groupby(col):
        out[str(key)] = _stats(grp)
    return out


def load_books(csv_path: Path, username: str, wallet: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (directional hold-to-res agg, all resolved rows for dashboard recency)."""
    df = pd.read_csv(csv_path, low_memory=False)
    for col in ("avgPrice", "totalBought", "realizedPnl", "cashPnl", "curPrice", "initialValue"):
        if col not in df.columns:
            df[col] = 0.0
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)
    for col in ("title", "slug", "eventSlug", "outcome", "endDate", "status", "conditionId", "timestamp", "redeemable"):
        if col not in df.columns:
            df[col] = np.nan
    price_res = (df["curPrice"] >= 0.99) | (df["curPrice"] <= 0.01)
    redeem_res = df["redeemable"].map(is_redeemable_flag).fillna(False)
    df = df[price_res | redeem_res].copy()
    if df.empty:
        return df, df
    df["side"] = df["outcome"].astype(str).str.strip().str.lower()
    df.loc[df["side"].eq("yes"), "side"] = "Yes"
    df.loc[df["side"].eq("no"), "side"] = "No"
    df.loc[df["side"].eq("over"), "side"] = "Over"
    df.loc[df["side"].eq("under"), "side"] = "Under"
    df.loc[~df["side"].isin(["Yes", "No", "Over", "Under"]), "side"] = "Specific"
    df["cost"] = cost_basis(df)
    df["dash_pnl"] = dashboard_pnl(df)
    df["sport_type"] = df.apply(get_sport, axis=1)
    df["sport_family"] = df["sport_type"].map(sport_family)
    df["market_type"] = df.apply(get_market_type, axis=1)
    df["submarket"] = df.apply(classify_submarket, axis=1)
    df = attach_event_dates(df)
    df["end_dt"] = df["event_dt"]
    df = df.dropna(subset=["end_dt"])
    horizon = datetime.now(timezone.utc) + timedelta(days=1)
    df = df[df["end_dt"] <= horizon]
    if df.empty:
        return df, df
    df["won"] = df["curPrice"] >= 0.99
    dash = df[df["cost"] >= MIN_COST].copy()

    hold_src = df.copy()
    hold_src = hold_src[~((hold_src["side"] == "No") & (hold_src["avgPrice"] >= 0.95))].copy()
    if "conditionId" in hold_src.columns:
        sides = hold_src.groupby("conditionId")["side"].agg(lambda s: set(s))
        hedged = {cid for cid, ss in sides.items() if "Yes" in ss and "No" in ss}
        if hedged:
            hold_src = hold_src[~hold_src["conditionId"].isin(hedged)].copy()
    hold_src = hold_src[hold_src["cost"] >= MIN_COST].copy()
    if hold_src.empty:
        return hold_src, dash
    hold_src["entry_price"] = hold_src["avgPrice"].clip(0.02, 0.98)
    hold_src["hold_pnl"] = np.where(
        hold_src["won"],
        hold_src["cost"] * (1.0 / hold_src["entry_price"] - 1.0),
        -hold_src["cost"],
    )

    def _wavg(g: pd.DataFrame) -> float:
        w = g["cost"].replace(0, 1e-9)
        return float(np.average(g["entry_price"], weights=w))

    g = hold_src.groupby(["conditionId", "side"], dropna=False)
    prices = g.apply(_wavg, include_groups=False)
    agg = g.agg(
        cost=("cost", "sum"),
        hold_pnl=("hold_pnl", "sum"),
        dash_pnl=("dash_pnl", "sum"),
        won=("won", "first"),
        sport_type=("sport_type", "first"),
        sport_family=("sport_family", "first"),
        market_type=("market_type", "first"),
        submarket=("submarket", "first"),
        title=("title", "first"),
        slug=("slug", "first"),
        end_dt=("end_dt", "min"),
        status=("status", "first"),
        avg_price=("avgPrice", "mean"),
    ).reset_index()
    agg["entry_price"] = agg.set_index(["conditionId", "side"]).index.map(prices)
    agg["username"] = username
    agg["wallet"] = wallet.lower()
    return agg, dash


def load_resolved(csv_path: Path, username: str, wallet: str) -> pd.DataFrame:
    hold, _dash = load_books(csv_path, username, wallet)
    return hold


def decide(row: dict) -> tuple[str, str]:
    """Return (action, reason). Recency uses dashboard PnL (realized+cash), not redeem timestamps."""
    wallet = row["wallet"]
    if wallet in MM:
        return "KICK", "Confirmed market-maker / both-sides bot. Do not tail."
    if row.get("untailable"):
        return "KICK", str(row.get("untailable_reason") or "Impossible to tail (size / both-sides / bond grind).")
    if row.get("possibly_quit"):
        return "KICK", (
            f"No dated activity in {QUIT_DAYS}+ days (last={row.get('max_date')}). "
            "Account looks quit or dormant — do not tail stale markers."
        )

    overall = row["overall"]
    last90 = row["last_90d"]
    last60 = row["last_60d"]
    last30 = row["last_30d"]
    n = overall["n"]
    roi = overall["roi"]
    n90 = last90["n"]
    roi90 = last90["roi"]
    n60 = last60["n"]
    roi60 = last60["roi"]
    n30 = last30["n"]
    roi30 = last30["roi"]
    sports = row["by_sport"]
    subs = row["by_submarket"]
    sides = row["by_side"]

    pos_sports = [k for k, v in sports.items() if v["n"] >= 20 and v["roi"] >= 8]
    neg_sports = [k for k, v in sports.items() if v["n"] >= 20 and v["roi"] <= -8]
    pos_subs = [k for k, v in subs.items() if v["n"] >= 20 and v["roi"] >= 8]
    neg_subs = [k for k, v in subs.items() if v["n"] >= 20 and v["roi"] <= -8]

    soccer = sports.get("Soccer") or {}
    yes = sides.get("Yes") or {"n": 0, "roi": 0}
    no = sides.get("No") or {"n": 0, "roi": 0}

    if wallet == CANNAE:
        ml = subs.get("Moneyline") or {"n": 0, "roi": 0}
        soccer_ok = soccer.get("n", 0) >= 30 and soccer.get("roi", 0) >= 0
        if n60 >= 20 and roi60 <= -15:
            return (
                "KICK",
                f"Last 60d dashboard PnL is {roi60:.1f}% (n={n60}, ${last60.get('pnl', 0):,.0f}). "
                "Polymarket last-60d is negative; do not tail until form recovers. "
                "Soccer ML NO overlay is frozen.",
            )
        if soccer_ok and (ml.get("roi", 0) >= 0 or soccer.get("roi", 0) >= 3):
            return (
                "OVERLAY",
                "Keep only as a soccer moneyline overlay, never an unfiltered 2+ voter. "
                f"Hold-to-res {roi:.1f}% on {n}; last 60d dashboard {roi60:.1f}% (n={n60}). "
                "Spreads/totals/draws/UCL/NBA/NFL and YES-side stay blocked.",
            )
        return (
            "OVERLAY",
            "Soccer overlay only, with extra caution: last 60d dashboard "
            f"{roi60:.1f}% (n={n60}). Mute everything except soccer ML NO.",
        )

    wr = overall.get("win_rate") or 0
    if n >= GRINDER_MIN_N and wr >= GRINDER_WR and roi < 8:
        return "KICK", f"{wr:.1f}% WR on {n} markets at {roi:.1f}% ROI — favorite/bond grinder, impossible to copy."

    if n < 15:
        if roi >= 20 and n >= 8:
            return "WATCH", f"Thin sample ({n} resolved). ROI looks high ({roi:.1f}%) but do not size up yet."
        return "WATCH", f"Thin sample ({n} resolved markets). Not enough to keep or kick."

    if n60 >= 20 and roi60 <= -20:
        return "KICK", f"Last 60d dashboard {roi60:.1f}% (n={n60}). Recent form is not copyable."

    if n >= 80 and roi <= -5:
        return "KICK", f"Honest hold-to-res ROI {roi:.1f}% over {n} markets. Negative at volume."

    if n90 >= 25 and roi90 <= -15 and roi < 8:
        return "KICK", f"Last 90d collapsed ({roi90:.1f}% on {n90}). Full-sample {roi:.1f}% is not enough to keep."

    if n30 >= 15 and roi30 <= -20 and roi90 < 0:
        return "KICK", f"Last 30d {roi30:.1f}% (n={n30}) and last 90d still negative."

    if pos_sports and (neg_sports or neg_subs) and roi < 12:
        return (
            "TIGHTEN",
            f"Keep only {', '.join(pos_sports) or 'winning lanes'}"
            + (f"; mute {', '.join(neg_sports)}" if neg_sports else "")
            + (f"; skip {', '.join(neg_subs)}" if neg_subs else "")
            + f". Full {roi:.1f}% / last60d dash {roi60:.1f}%.",
        )

    if no["n"] >= 40 and no["roi"] >= 8 and yes["n"] >= 20 and yes["roi"] <= -5:
        return "TIGHTEN", f"NO-side only (NO {no['roi']:.1f}% vs YES {yes['roi']:.1f}%). Mute YES."

    if yes["n"] >= 40 and yes["roi"] >= 8 and no["n"] >= 20 and no["roi"] <= -5:
        return "TIGHTEN", f"YES-side only (YES {yes['roi']:.1f}% vs NO {no['roi']:.1f}%). Mute NO."

    if n90 >= 15 and roi90 >= 5 and roi >= 0:
        return "KEEP", f"Still printing: last 90d {roi90:.1f}% (n={n90}), full {roi:.1f}% on {n}."

    if roi >= 8 and n >= 30 and (n90 < 10 or roi90 >= -5):
        return "KEEP", f"Full-sample {roi:.1f}% on {n}. Recent book is thin or flat, not a blow-up."

    if roi >= 3 and n90 >= 20 and roi90 >= 0:
        return "KEEP", f"Modest but positive: {roi:.1f}% full, {roi90:.1f}% last 90d."

    if n90 >= 20 and roi90 < 0 and roi < 5:
        return "TIGHTEN", f"Edge faded recently ({roi90:.1f}% last 90d). Restrict to proven sports/types or sit out."

    return "WATCH", f"Mixed: full {roi:.1f}% (n={n}), last60d dash {roi60:.1f}% (n={n60}). Revisit after more games."


def quality_proxy(overall: dict, last90: dict) -> int:
    """0–100-ish score from honest hold-to-res, not scalp PnL."""
    n = overall["n"]
    roi = overall["roi"]
    wr = overall["win_rate"]
    roi90 = last90["roi"] if last90["n"] >= 8 else roi
    base = 40 + min(roi, 40) * 0.8 + min(max(roi90, -20), 30) * 0.4
    if n < 20:
        base -= 15
    elif n < 50:
        base -= 5
    if wr < 45:
        base -= 8
    return int(max(0, min(100, round(base))))


def main() -> int:
    rows: list[dict] = []
    cannae_detail: dict = {}
    print(f"Trader health review as of {AS_OF.date().isoformat()} (dashboard last-Nd + hold-to-res)")
    for wallet, username in roster_traders():
        w = wallet.lower()
        csv_p = csv_path_for(wallet, username)
        if not csv_p.exists():
            print(f"  skip {username}: no CSV")
            continue
        try:
            mk, dash = load_books(csv_p, username, w)
        except Exception as e:
            print(f"  skip {username}: {e}")
            continue
        if mk.empty and (dash is None or dash.empty):
            print(f"  {username:<32} 0 resolved")
            continue
        last90_hold = mk[mk["end_dt"] >= AS_OF - timedelta(days=90)] if not mk.empty else mk
        last30_hold = mk[mk["end_dt"] >= AS_OF - timedelta(days=30)] if not mk.empty else mk
        recency = mk[mk["end_dt"] >= datetime(2026, 5, 1, tzinfo=timezone.utc)] if not mk.empty else mk
        d30 = dash[dash["end_dt"] >= AS_OF - timedelta(days=30)] if dash is not None and not dash.empty else dash
        d60 = dash[dash["end_dt"] >= AS_OF - timedelta(days=60)] if dash is not None and not dash.empty else dash
        d90 = dash[dash["end_dt"] >= AS_OF - timedelta(days=90)] if dash is not None and not dash.empty else dash
        max_date = None
        if dash is not None and not dash.empty:
            max_date = str(dash["end_dt"].max())[:10]
        elif not mk.empty:
            max_date = str(mk["end_dt"].max())[:10]
        min_date = str(mk["end_dt"].min())[:10] if not mk.empty else None
        days_since = None
        if max_date:
            try:
                last_dt = datetime.fromisoformat(max_date).replace(tzinfo=timezone.utc)
                days_since = int((AS_OF - last_dt).total_seconds() // 86400)
            except ValueError:
                days_since = None
        median_cost = float(mk["cost"].median()) if not mk.empty else 0.0
        wr = _stats(mk)["win_rate"] if not mk.empty else 0.0
        untailable = False
        untailable_reason = ""
        if w in MM:
            untailable, untailable_reason = True, "Market maker"
        elif median_cost >= UNTAILABLE_MEDIAN:
            untailable, untailable_reason = True, f"Median stake ${median_cost:,.0f} — too large to join."
        elif not mk.empty and len(mk) >= GRINDER_MIN_N and wr >= GRINDER_WR and _stats(mk)["roi"] < 8:
            untailable, untailable_reason = True, f"{wr:.1f}% WR grinder — favorite/bond, not copyable."
        possibly_quit = bool(days_since is not None and days_since >= QUIT_DAYS and _dash_stats(d30)["n"] == 0)
        rec = {
            "username": username,
            "wallet": w,
            "rows": int(len(mk)),
            "max_date": max_date,
            "min_date": min_date,
            "days_since_last": days_since,
            "possibly_quit": possibly_quit,
            "untailable": untailable,
            "untailable_reason": untailable_reason,
            "n_may_aug": int(len(recency)) if recency is not None and not recency.empty else 0,
            "overall": _stats(mk),
            "last_90d": _dash_stats(d90),
            "last_60d": _dash_stats(d60),
            "last_30d": _dash_stats(d30),
            "last_90d_hold": _stats(last90_hold),
            "last_30d_hold": _stats(last30_hold),
            "may_aug_2026": _stats(recency) if recency is not None else _stats(mk),
            "by_sport": _group_stats(mk, "sport_family") if not mk.empty else {},
            "by_submarket": _group_stats(mk, "submarket") if not mk.empty else {},
            "by_side": _group_stats(mk, "side") if not mk.empty else {},
            "by_sport_submarket": [],
        }
        if not mk.empty:
            for (sp, sm), grp in mk.groupby(["sport_family", "submarket"]):
                rec["by_sport_submarket"].append({"sport": str(sp), "submarket": str(sm), **_stats(grp)})
            rec["by_sport_submarket"].sort(key=lambda r: -r["n"])
        rec["quality_proxy"] = quality_proxy(rec["overall"], rec["last_90d"])
        action, reason = decide(rec)
        rec["action"] = action
        rec["reason"] = reason
        rows.append(rec)
        print(
            f"  {username:<32} n={rec['overall']['n']:<5} ROI={rec['overall']['roi']:7.1f}% "
            f"60d={rec['last_60d']['roi']:7.1f}% n60={rec['last_60d']['n']:<4} "
            f"last={rec['max_date']} {action}"
        )
        if w == CANNAE:
            cannae_detail = rec

    rows.sort(key=lambda r: (r["action"], -r["overall"]["n"]))
    payload = {
        "generated_at": AS_OF.isoformat(),
        "as_of": AS_OF.date().isoformat(),
        "method": (
            "Hold-to-resolution on directional price-resolved rows (curPrice 0/1 or redeemable), "
            "including status=open unredeemed losers. Last 30/60/90d use dashboard PnL "
            "(realizedPnl+cashPnl) on ALL resolved rows dated from endDate or slug/title — "
            "never fill/redeem timestamps. Hedges and 95¢ NO bonds stripped from hold-to-res only. "
            "Quit = no dated activity in 45+ days. Untailable = MM, $50k+ median, or 94%+ WR grinders."
        ),
        "cannae": cannae_detail,
        "traders": rows,
        "counts": {
            "KEEP": sum(1 for r in rows if r["action"] == "KEEP"),
            "TIGHTEN": sum(1 for r in rows if r["action"] == "TIGHTEN"),
            "OVERLAY": sum(1 for r in rows if r["action"] == "OVERLAY"),
            "WATCH": sum(1 for r in rows if r["action"] == "WATCH"),
            "KICK": sum(1 for r in rows if r["action"] == "KICK"),
        },
    }
    out_json = OUTPUT_DIR / "trader_health.json"
    out_json.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")

    md = Path(__file__).resolve().parent / "TRADER_HEALTH_REPORT.md"
    lines = [
        "# Trader health re-grade (hold-to-resolution through today)",
        "",
        f"As of **{AS_OF.date().isoformat()}**. Last 30/60/90d are **dashboard PnL** (`realizedPnl + cashPnl`) "
        "on event-dated resolved rows, including unredeemed losers. Fill/redeem timestamps are never used "
        "(that bug made Cannae last-60d look like all winners). Hold-to-res is still used for overall copy-edge.",
        "",
        "## Cannae",
        "",
    ]
    if cannae_detail:
        c = cannae_detail
        lines += [
            f"- **Action: {c['action']}** — {c['reason']}",
            f"- Full honest hold-to-res: n={c['overall']['n']}, WR={c['overall']['win_rate']}%, ROI=**{c['overall']['roi']}%**, last date={c['max_date']}",
            f"- Last 90d dashboard: n={c['last_90d']['n']}, PnL=${c['last_90d']['pnl']:,}, ROI={c['last_90d']['roi']}%",
            f"- Last 60d dashboard: n={c['last_60d']['n']}, PnL=${c['last_60d']['pnl']:,}, ROI=**{c['last_60d']['roi']}%**",
            f"- Last 30d dashboard: n={c['last_30d']['n']}, PnL=${c['last_30d']['pnl']:,}, ROI={c['last_30d']['roi']}%",
            f"- May–Aug 2026 dated subset: n={c['may_aug_2026']['n']}, ROI={c['may_aug_2026']['roi']}%",
            "",
            "By sport:",
            "",
            "| Sport | n | WR | ROI |",
            "|-------|--:|---:|----:|",
        ]
        for k, v in sorted(c["by_sport"].items(), key=lambda kv: -kv[1]["n"]):
            lines.append(f"| {k} | {v['n']} | {v['win_rate']}% | {v['roi']}% |")
        lines += ["", "By submarket:", "", "| Type | n | WR | ROI |", "|------|--:|---:|----:|"]
        for k, v in sorted(c["by_submarket"].items(), key=lambda kv: -kv[1]["n"]):
            lines.append(f"| {k} | {v['n']} | {v['win_rate']}% | {v['roi']}% |")
        lines += ["", "By side (Yes/No/Over/Under/Specific only):", "", "| Side | n | WR | ROI |", "|------|--:|---:|----:|"]
        canonical_sides = {"Yes", "No", "Over", "Under", "Specific"}
        for k, v in sorted(c["by_side"].items(), key=lambda kv: -kv[1]["n"]):
            if k not in canonical_sides:
                continue
            lines.append(f"| {k} | {v['n']} | {v['win_rate']}% | {v['roi']}% |")
        lines.append("")
    else:
        lines.append("Cannae CSV was not loaded.\n")

    lines += [
        "## Roster decisions",
        "",
        f"KEEP {payload['counts']['KEEP']} · TIGHTEN {payload['counts']['TIGHTEN']} · "
        f"OVERLAY {payload['counts']['OVERLAY']} · WATCH {payload['counts']['WATCH']} · "
        f"KICK {payload['counts']['KICK']}",
        "",
        "| Trader | Action | n | ROI | 60d n | 60d dash ROI | Last date | Why |",
        "|--------|--------|--:|----:|------:|-------------:|-----------|-----|",
    ]
    order = {"KICK": 0, "WATCH": 1, "TIGHTEN": 2, "OVERLAY": 3, "KEEP": 4}
    for r in sorted(rows, key=lambda x: (order.get(x["action"], 9), x["overall"]["roi"])):
        lines.append(
            f"| {r['username']} | **{r['action']}** | {r['overall']['n']} | {r['overall']['roi']}% | "
            f"{r['last_60d']['n']} | {r['last_60d']['roi']}% | {r['max_date']} | {r['reason']} |"
        )
    lines += [
        "",
        "## Method",
        "",
        payload["method"],
        "",
    ]
    md.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nWrote {out_json}")
    print(f"Wrote {md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
