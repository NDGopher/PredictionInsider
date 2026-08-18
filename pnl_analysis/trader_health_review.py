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
    sport_family,
)
from run_full_pipeline import OUTPUT_DIR, csv_path_for, roster_traders  # noqa: E402

MIN_COST = 25.0
AS_OF = datetime.now(timezone.utc)
CANNAE = "0x7ea571c40408f340c1c8fc8eaacebab53c1bde7b"
MM = {"0xd9e0aaca471f489be338fd0c91a26e8669a805f2", "0xd9e0aaca471f489be338fd0f91a26e8669a805f2"}


def _stats(sub: pd.DataFrame) -> dict:
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


def _group_stats(sub: pd.DataFrame, col: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if sub.empty or col not in sub.columns:
        return out
    for key, grp in sub.groupby(col):
        out[str(key)] = _stats(grp)
    return out


def load_resolved(csv_path: Path, username: str, wallet: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path, low_memory=False)
    for col in ("avgPrice", "totalBought", "realizedPnl", "cashPnl", "curPrice", "initialValue"):
        if col not in df.columns:
            df[col] = 0.0
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)
    for col in ("title", "slug", "eventSlug", "outcome", "endDate", "status", "conditionId", "timestamp"):
        if col not in df.columns:
            df[col] = np.nan
    resolved = (df["curPrice"] >= 0.99) | (df["curPrice"] <= 0.01)
    df = df[resolved].copy()
    if df.empty:
        return df
    df["side"] = df["outcome"].astype(str).str.strip().str.lower()
    df.loc[df["side"].eq("yes"), "side"] = "Yes"
    df.loc[df["side"].eq("no"), "side"] = "No"
    df.loc[df["side"].eq("over"), "side"] = "Over"
    df.loc[df["side"].eq("under"), "side"] = "Under"
    df.loc[~df["side"].isin(["Yes", "No", "Over", "Under"]), "side"] = "Specific"
    df["cost"] = cost_basis(df)
    df["sport_type"] = df.apply(get_sport, axis=1)
    df["sport_family"] = df["sport_type"].map(sport_family)
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

    def _wavg(g: pd.DataFrame) -> float:
        w = g["cost"].replace(0, 1e-9)
        return float(np.average(g["entry_price"], weights=w))

    g = df.groupby(["conditionId", "side"], dropna=False)
    prices = g.apply(_wavg, include_groups=False)
    agg = g.agg(
        cost=("cost", "sum"),
        hold_pnl=("hold_pnl", "sum"),
        won=("won", "first"),
        sport_type=("sport_type", "first"),
        sport_family=("sport_family", "first"),
        market_type=("market_type", "first"),
        submarket=("submarket", "first"),
        title=("title", "first"),
        slug=("slug", "first"),
        end_dt=("end_dt", "min"),
        status=("status", "first"),
    ).reset_index()
    agg["entry_price"] = agg.set_index(["conditionId", "side"]).index.map(prices)
    agg["username"] = username
    agg["wallet"] = wallet.lower()
    return agg


def decide(row: dict) -> tuple[str, str]:
    """Return (action, reason)."""
    wallet = row["wallet"]
    if wallet in MM:
        return "KICK", "Confirmed market-maker / both-sides bot. Do not tail."
    overall = row["overall"]
    last90 = row["last_90d"]
    last30 = row["last_30d"]
    n = overall["n"]
    roi = overall["roi"]
    n90 = last90["n"]
    roi90 = last90["roi"]
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
        return (
            "OVERLAY",
            "Keep only as a soccer moneyline overlay, never an unfiltered 2+ voter. "
            f"Honest hold-to-res is {roi:.1f}% on {n} markets and last 90d is {roi90:.1f}% (n={n90}), "
            "but volume collapsed after April (Jan–Apr was ~60 markets/day; May–Aug is a thin book). "
            "Spreads/totals/draws/UCL/NBA/NFL and YES-side stay blocked. Leave-one-out showed he "
            "inflates 2+ soccer-NO clusters.",
        )

    if n < 15:
        if roi >= 20 and n >= 8:
            return "WATCH", f"Thin sample ({n} resolved). ROI looks high ({roi:.1f}%) but do not size up yet."
        return "WATCH", f"Thin sample ({n} resolved markets). Not enough to keep or kick."

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
            + f". Full {roi:.1f}% / last90 {roi90:.1f}%.",
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

    return "WATCH", f"Mixed: full {roi:.1f}% (n={n}), last90 {roi90:.1f}% (n={n90}). Revisit after more games."


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
    print(f"Trader health review as of {AS_OF.date().isoformat()} (resolved-by-price, dated via slug/endDate)")
    for wallet, username in roster_traders():
        w = wallet.lower()
        csv_p = csv_path_for(wallet, username)
        if not csv_p.exists():
            print(f"  skip {username}: no CSV")
            continue
        try:
            mk = load_resolved(csv_p, username, w)
        except Exception as e:
            print(f"  skip {username}: {e}")
            continue
        if mk.empty:
            print(f"  {username:<32} 0 resolved")
            continue
        last90 = mk[mk["end_dt"] >= AS_OF - timedelta(days=90)]
        last30 = mk[mk["end_dt"] >= AS_OF - timedelta(days=30)]
        recency = mk[mk["end_dt"] >= datetime(2026, 5, 1, tzinfo=timezone.utc)]
        rec = {
            "username": username,
            "wallet": w,
            "rows": int(len(mk)),
            "max_date": str(mk["end_dt"].max())[:10],
            "min_date": str(mk["end_dt"].min())[:10],
            "n_may_aug": int(len(recency)),
            "overall": _stats(mk),
            "last_90d": _stats(last90),
            "last_30d": _stats(last30),
            "may_aug_2026": _stats(recency),
            "by_sport": _group_stats(mk, "sport_family"),
            "by_submarket": _group_stats(mk, "submarket"),
            "by_side": _group_stats(mk, "side"),
            "by_sport_submarket": [],
        }
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
            f"90d={rec['last_90d']['roi']:7.1f}% n90={rec['last_90d']['n']:<4} "
            f"last={rec['max_date']} {action}"
        )
        if w == CANNAE:
            cannae_detail = rec

    rows.sort(key=lambda r: (r["action"], -r["overall"]["n"]))
    payload = {
        "generated_at": AS_OF.isoformat(),
        "as_of": AS_OF.date().isoformat(),
        "method": (
            "Hold-to-resolution on every price-resolved row (curPrice 0/1), including "
            "status=open unredeemed losers. Event date from endDate or slug/title. "
            "Hedges and 95¢ NO bonds stripped. ROI = hold PnL / cost, not scalp realizedPnl."
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
        f"As of **{AS_OF.date().isoformat()}**. Closed-only CSVs were win-biased: losers stay `status=open` until redeem. "
        "This review treats `curPrice` 0 or 1 as settled and dates games from `endDate` or the slug/title.",
        "",
        "## Cannae",
        "",
    ]
    if cannae_detail:
        c = cannae_detail
        lines += [
            f"- **Action: {c['action']}** — {c['reason']}",
            f"- Full honest book: n={c['overall']['n']}, WR={c['overall']['win_rate']}%, ROI=**{c['overall']['roi']}%**, last date={c['max_date']}",
            f"- Last 90d: n={c['last_90d']['n']}, ROI={c['last_90d']['roi']}%",
            f"- Last 30d: n={c['last_30d']['n']}, ROI={c['last_30d']['roi']}%",
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
        "| Trader | Action | n | ROI | 90d n | 90d ROI | Last date | Why |",
        "|--------|--------|--:|----:|------:|--------:|-----------|-----|",
    ]
    order = {"KICK": 0, "WATCH": 1, "TIGHTEN": 2, "OVERLAY": 3, "KEEP": 4}
    for r in sorted(rows, key=lambda x: (order.get(x["action"], 9), x["overall"]["roi"])):
        lines.append(
            f"| {r['username']} | **{r['action']}** | {r['overall']['n']} | {r['overall']['roi']}% | "
            f"{r['last_90d']['n']} | {r['last_90d']['roi']}% | {r['max_date']} | {r['reason']} |"
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
