"""
Polymarket Trader Analysis Engine
Exact Gemini framework: sport ROI, price buckets, bet side, Sharpe, quality score, tier, tags
Outputs a structured dict / JSON for every trader CSV.
"""

import pandas as pd
import numpy as np
import json
import csv as csv_module
import sys
from pathlib import Path

# ================================================================
# CLASSIFIERS  (exact logic from Gemini's framework)
# ================================================================

def get_sport(row):
    comb = (str(row.get("eventSlug", "") or "") + " " + str(row.get("slug", "") or "") + " " + str(row.get("title", "") or "")).lower()
    if "epl-" in comb or "premier-league" in comb or "premier league" in comb: return "SOCCER (EPL)"
    if "lal-" in comb or "la-liga" in comb or "la liga" in comb:               return "SOCCER (LaLiga)"
    if "ucl-" in comb or "champions-league" in comb or "champions league" in comb: return "SOCCER (UCL)"
    if "serie-a" in comb or "seri-a" in comb:                                   return "SOCCER (SerieA)"
    if any(x in comb for x in ["bundesliga", "bun-", "fl1-", "ligue-1", "ligue1", "eredivisie", "mls-", "sea-", "csa-", "arg-", "bra-", "mex-"]): return "SOCCER (Other)"
    if any(x in comb for x in ["soccer", "football-", " fc ", "united", "athletic", "sporting"]): return "SOCCER (Other)"
    # WNBA slugs are "wnba-..." — they contain the substring "nba-" (e.g. wnba-phx-min → …nba-…).
    # Classify WNBA before the generic NBA rule or the whole league is mislabeled as NBA.
    if "wnba-" in comb:                                                         return "WNBA"
    if any(x in comb for x in ["nba-", "basketball", "nba:"]):                  return "NBA"
    if any(x in comb for x in ["nfl-", "super-bowl", "cfb-"]):                  return "NFL"
    if any(x in comb for x in ["nhl-", "hockey"]):                              return "NHL"
    if any(x in comb for x in ["mlb-", "baseball"]):                            return "MLB"
    if any(x in comb for x in ["tennis", "atp-", "wta-", "wimbledon", "us-open", "french-open", "australian-open"]): return "TENNIS"
    if any(x in comb for x in ["lol-", "cs2", "esports", "dota", "iem-", "pgl-", "valorant"]): return "ESPORTS"
    if any(x in comb for x in ["election", "presidential", "nominee", "senate", "congress", "parliament", "governor"]): return "POLITICS"
    return "OTHER"

def get_market_type(row):
    title = str(row.get("title", "") or "").lower()
    if "spread" in title or "(+" in title or "(-" in title:                     return "Spread"
    if "o/u" in title or " over " in title or " under " in title or "total" in title: return "Totals (O/U)"
    if "win the" in title or "champion" in title or "mvp" in title or "award" in title or "draft" in title or "season" in title: return "Futures"
    return "Moneyline / Match"

def get_bet_side(row):
    outcome = str(row.get("outcome", "") or "").strip().lower()
    if outcome == "yes": return "Yes"
    if outcome == "no":  return "No"
    return "Specific Selection"

def price_bucket(price):
    if price < 0.20:  return "Longshot (0-20c)"
    if price < 0.40:  return "Underdog (20-40c)"
    if price < 0.60:  return "Flip (40-60c)"
    if price < 0.80:  return "Favorite (60-80c)"
    return "Safe (80-100c)"

# ================================================================
# CORE ANALYSIS FUNCTION
# ================================================================

def analyze_csv(csv_path: Path, username: str, wallet: str) -> dict:
    df = pd.read_csv(csv_path, low_memory=False)

    # ── Pre-process ──────────────────────────────────────────────
    money_cols = ["realizedPnl", "cashPnl", "currentValue", "initialValue", "totalBought", "avgPrice"]
    for col in money_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        else:
            df[col] = 0.0

    if "total_position_pnl" not in df.columns:
        df["total_position_pnl"] = df["realizedPnl"] + df["cashPnl"]

    # True PNL: raw sum(realizedPnl) — matches Polymarket display; not used in analysis
    raw_realized_pnl = float(df["realizedPnl"].sum())

    # Grouping ID (event-level; matches polyhistory ANALYSISCODE / Cannae.py)
    df["grouping_id"] = df["eventSlug"].fillna(df.get("slug", ""))

    # Cost basis
    df["calculated_cost"] = df.apply(
        lambda r: r["totalBought"] * r["avgPrice"] if r.get("status") == "closed" else r["initialValue"],
        axis=1
    )

    # Classifiers
    df["sport_type"]  = df.apply(get_sport,       axis=1)
    df["market_type"] = df.apply(get_market_type, axis=1)
    df["bet_side"]    = df.apply(get_bet_side,     axis=1)

    # ── Dashboard-match metrics (polyhistory / ANALYSISCODE style) ──
    # Event-level aggregation on ALL rows (no hedge/bond strip). ROI = realized PNL / total risked.
    # This matches Polymarket dashboard and polyhistory ANALYSISCODE.py so CSV ROIs are accurate.
    event_agg_all = df.groupby("grouping_id").agg(
        total_position_pnl=("total_position_pnl", "sum"),
        calculated_cost=("calculated_cost", "sum"),
    )
    total_risked_dashboard = float(event_agg_all["calculated_cost"].sum())
    roi_dashboard = (
        (raw_realized_pnl / total_risked_dashboard * 100) if total_risked_dashboard > 0 else 0.0
    )

    # ── Perfect Hedge Filter ─────────────────────────────────────
    # Identify conditionIds where the trader simultaneously held BOTH sides
    # (Yes + No on a binary, or two specific selections on the same market).
    # These are arb/market-maker positions — not directional bets — and would
    # inflate volume while diluting ROI.  Strip them before any analysis.
    if "conditionId" in df.columns and "outcome" in df.columns:
        cond_outcomes = (
            df.groupby("conditionId")["outcome"]
              .apply(lambda s: {str(v).strip().lower() for v in s if pd.notna(v)})
              .reset_index()
        )
        cond_outcomes.columns = ["conditionId", "outcomes_set"]
        def _is_hedged(s):
            # Classic binary: Yes + No both present
            if "yes" in s and "no" in s:
                return True
            # Multi-outcome: 2+ distinct specific selections on same conditionId
            specific = {o for o in s if o not in ("yes", "no")}
            return len(specific) >= 2
        cond_outcomes["is_hedge"] = cond_outcomes["outcomes_set"].apply(_is_hedged)
        hedged_ids = set(cond_outcomes.loc[cond_outcomes["is_hedge"], "conditionId"])
        hedge_df       = df[df["conditionId"].isin(hedged_ids)].copy()
        df             = df[~df["conditionId"].isin(hedged_ids)].copy()
        hedge_risk     = hedge_df["calculated_cost"].sum()
        hedge_profit   = hedge_df["total_position_pnl"].sum()
        hedge_count    = len(hedge_df)
    else:
        hedge_risk = hedge_profit = hedge_count = 0

    # ── Bond Yield Filter ────────────────────────────────────────
    # bet_side already classified at line 86 — no need to recompute
    df["is_bond"]  = (df["bet_side"] == "No") & (df["avgPrice"] >= 0.95)
    bond_df        = df[df["is_bond"]]
    directional_df = df[~df["is_bond"]].copy()

    bond_risk   = bond_df["calculated_cost"].sum()
    bond_profit = bond_df["total_position_pnl"].sum()
    bond_count  = len(bond_df)

    # ── Event-Level Aggregation ──────────────────────────────────
    def w_avg_price(group):
        w = group["calculated_cost"].replace(0, 1e-9)
        return np.average(group["avgPrice"], weights=w)

    agg = directional_df.groupby("grouping_id").agg(
        total_pnl      = ("total_position_pnl", "sum"),
        total_cost     = ("calculated_cost",    "sum"),
        sport_type     = ("sport_type",         "first"),
        market_type    = ("market_type",        "first"),
        bet_side       = ("bet_side",           lambda s: s.mode()[0] if len(s) else "Specific Selection"),
        status         = ("status",             "last"),
        end_date       = ("endDate",            "first"),
        title          = ("title",              "first"),
    ).reset_index()

    avg_price_series = directional_df.groupby("grouping_id", group_keys=False).apply(w_avg_price, include_groups=False).reset_index(name="avg_price")
    agg = agg.merge(avg_price_series, on="grouping_id", how="left")
    agg["avg_price"] = agg["avg_price"].fillna(0)
    agg["is_win"]    = agg["total_pnl"] > 0
    agg["price_bucket"] = agg["avg_price"].apply(price_bucket)

    # ── Polymarket Analytics–aligned win rate (per conditionId / market, not eventSlug bucket) ──
    # Merging many markets under one eventSlug inflated win% toward ~90% vs PA’s “% of markets won”.
    def _norm_sport(raw: str) -> str:
        if "UCL" in raw:
            return "UCL"
        if "SOCCER" in raw:
            return "Soccer"
        if raw == "TENNIS":
            return "Tennis"
        if raw == "ESPORTS":
            return "eSports"
        if raw == "POLITICS":
            return "Politics"
        if raw == "OTHER":
            return "Other"
        return raw

    def _material_outcome(pnl: float, cost: float) -> str:
        t = max(0.5, 0.0001 * max(float(cost), 1.0))
        if pnl > t:
            return "win"
        if pnl < -t:
            return "loss"
        return "neutral"

    def _pa_win_rate_from_markets(cg: pd.DataFrame) -> float:
        if cg.empty:
            return 0.0
        w = l = 0
        for _, r in cg.iterrows():
            o = _material_outcome(float(r["total_pnl"]), float(r["total_cost"]))
            if o == "win":
                w += 1
            elif o == "loss":
                l += 1
        return (w / (w + l) * 100) if (w + l) > 0 else 0.0

    cond_key = "conditionId" if "conditionId" in directional_df.columns else "grouping_id"
    cond_agg = (
        directional_df.groupby(cond_key, dropna=False)
        .agg(
            total_pnl=("total_position_pnl", "sum"),
            total_cost=("calculated_cost", "sum"),
        )
        .reset_index()
    )
    win_rate = round(_pa_win_rate_from_markets(cond_agg[["total_pnl", "total_cost"]]), 2)

    directional_df = directional_df.copy()
    directional_df["sport_norm"] = directional_df["sport_type"].apply(_norm_sport)

    # Per-market (condition) stakes — actionable for tailing vs event-slug averages
    markets_traded = int(len(cond_agg))
    mean_market_stake = float(cond_agg["total_cost"].mean()) if markets_traded else 0.0
    median_market_stake = float(np.median(cond_agg["total_cost"])) if markets_traded else 0.0

    # ── Core Metrics (directional: for quality score, sport breakdown, tags) ──
    total_profit_directional   = agg["total_pnl"].sum()
    total_risked_directional   = agg["total_cost"].sum()
    directional_overall_roi    = (total_profit_directional / total_risked_directional * 100) if total_risked_directional > 0 else 0
    # Account-level "avg bet" = mean USDC deployed per **market** (condition), not per eventSlug bucket
    avg_bet_size   = round(mean_market_stake, 2)
    total_events   = len(agg)

    # Internal consistency: market PnL sums must match directional position totals
    sum_market_pnl = float(cond_agg["total_pnl"].sum())
    sum_pos_pnl = float(directional_df["total_position_pnl"].sum())
    pnl_drift = abs(sum_market_pnl - sum_pos_pnl)
    if sum_pos_pnl and pnl_drift / max(abs(sum_pos_pnl), 1.0) > 0.02:
        print(
            f"[analyze_csv] {username}: WARN market vs position PnL drift ${pnl_drift:,.2f}",
            file=sys.stderr,
        )

    # Pseudo-Sharpe (daily PnL consistency)
    agg["date"] = pd.to_datetime(agg["end_date"], errors="coerce").dt.date
    daily_pnl   = agg.groupby("date")["total_pnl"].sum()
    if len(daily_pnl) > 1 and daily_pnl.std() != 0:
        pseudo_sharpe = (daily_pnl.mean() / daily_pnl.std()) * np.sqrt(365)
    else:
        pseudo_sharpe = 0.0
    profitable_days = (daily_pnl > 0).sum()
    total_days      = len(daily_pnl)

    # ── Sport Breakdown ──────────────────────────────────────────
    sport_stats = {}
    for sport, dgrp in directional_df.groupby("sport_type"):
        s_profit = dgrp["total_position_pnl"].sum()
        s_cost   = dgrp["calculated_cost"].sum()
        s_roi    = (s_profit / s_cost * 100) if s_cost > 0 else 0
        cg = (
            dgrp.groupby(cond_key, dropna=False)
            .agg(
                total_pnl=("total_position_pnl", "sum"),
                total_cost=("calculated_cost", "sum"),
            )
            .reset_index()
        )
        s_wr = round(_pa_win_rate_from_markets(cg[["total_pnl", "total_cost"]]), 2)
        sport_stats[sport] = {
            "net_profit": round(float(s_profit), 2),
            "roi":        round(float(s_roi), 2),
            "win_rate":   s_wr,
            "events":     int(len(cg)),
            "avg_bet":    round(float(dgrp["calculated_cost"].mean()), 2),
            "median_bet": round(float(dgrp["calculated_cost"].median()), 2),
        }

    # ── Market Type Breakdown ────────────────────────────────────
    market_stats = {}
    for mtype, dgrp in directional_df.groupby("market_type"):
        m_profit = dgrp["total_position_pnl"].sum()
        m_cost   = dgrp["calculated_cost"].sum()
        m_roi    = (m_profit / m_cost * 100) if m_cost > 0 else 0
        cg = (
            dgrp.groupby(cond_key, dropna=False)
            .agg(
                total_pnl=("total_position_pnl", "sum"),
                total_cost=("calculated_cost", "sum"),
            )
            .reset_index()
        )
        m_wr = round(_pa_win_rate_from_markets(cg[["total_pnl", "total_cost"]]), 2)
        market_stats[mtype] = {
            "net_profit": round(float(m_profit), 2),
            "roi":        round(float(m_roi), 2),
            "win_rate":   m_wr,
            "events":     int(len(cg)),
            "avg_bet":    round(float(dgrp["calculated_cost"].mean()), 2),
            "median_bet": round(float(dgrp["calculated_cost"].median()), 2),
        }

    # ── Sport × Market Type Breakdown (deep conviction analysis) ─
    # Keys use normalized sport names matching routes.ts classifySportFull output.
    agg["sport_norm"] = agg["sport_type"].apply(_norm_sport)
    sport_market_stats = {}
    for (s_norm, mtype), dgrp in directional_df.groupby(["sport_norm", "market_type"]):
        sm_profit = dgrp["total_position_pnl"].sum()
        sm_cost   = dgrp["calculated_cost"].sum()
        sm_roi    = (sm_profit / sm_cost * 100) if sm_cost > 0 else 0
        cg = (
            dgrp.groupby(cond_key, dropna=False)
            .agg(
                total_pnl=("total_position_pnl", "sum"),
                total_cost=("calculated_cost", "sum"),
            )
            .reset_index()
        )
        sm_wr = round(_pa_win_rate_from_markets(cg[["total_pnl", "total_cost"]]), 2)
        key = f"{s_norm}|{mtype}"
        sport_market_stats[key] = {
            "net_profit": round(float(sm_profit), 2),
            "roi":        round(float(sm_roi), 2),
            "win_rate":   sm_wr,
            "events":     int(len(cg)),
            "avg_bet":    round(float(dgrp["calculated_cost"].mean()), 2),
            "median_bet": round(float(dgrp["calculated_cost"].median()), 2),
        }

    # ── Price Bucket Breakdown (per-market bucket = cost-weighted avg price on condition) ─
    bucket_rows: list[dict] = []
    for _, g in directional_df.groupby(cond_key, dropna=False):
        w = g["calculated_cost"].replace(0, 1e-9)
        ap = float(np.average(g["avgPrice"], weights=w))
        bucket_rows.append(
            {
                "bucket": str(price_bucket(ap)),
                "total_pnl": float(g["total_position_pnl"].sum()),
                "total_cost": float(g["calculated_cost"].sum()),
            }
        )
    bdf = pd.DataFrame(bucket_rows)
    price_stats = {}
    if not bdf.empty:
        for bucket, sub in bdf.groupby("bucket"):
            p_profit = sub["total_pnl"].sum()
            p_cost = sub["total_cost"].sum()
            p_roi = (p_profit / p_cost * 100) if p_cost > 0 else 0
            p_wr = round(_pa_win_rate_from_markets(sub[["total_pnl", "total_cost"]]), 2)
            price_stats[str(bucket)] = {
                "net_profit": round(float(p_profit), 2),
                "roi":        round(float(p_roi), 2),
                "win_rate":   p_wr,
                "events":     int(len(sub)),
            }

    # ── Bet Side (Yes / No / Specific) ───────────────────────────
    side_stats = {}
    for side, grp in directional_df.groupby("bet_side"):
        s_profit = grp["total_position_pnl"].sum()
        s_cost   = grp["calculated_cost"].sum()
        s_roi    = (s_profit / s_cost * 100) if s_cost > 0 else 0
        side_stats[side] = {
            "net_profit": round(s_profit, 2),
            "roi":        round(s_roi, 2),
            "positions":  len(grp),
        }

    # ── Top wins / losses: single **markets** (conditionId), not merged eventSlug buckets
    market_rows: list[dict] = []
    for ck, g in directional_df.groupby(cond_key, dropna=False):
        pnl_m = float(g["total_position_pnl"].sum())
        cost_m = float(g["calculated_cost"].sum())
        idx = g["calculated_cost"].idxmax()
        r = g.loc[idx]
        ap_m = float(np.average(g["avgPrice"], weights=g["calculated_cost"].replace(0, 1e-9)))
        market_rows.append(
            {
                "title": str(r.get("title") or ""),
                "slug": str(r.get("slug") or ""),
                "eventSlug": str(r.get("eventSlug") or ""),
                "sport_type": str(r.get("sport_type") or ""),
                "outcome": str(r.get("outcome") or ""),
                "conditionId": str(ck) if cond_key == "conditionId" else str(r.get("conditionId") or ""),
                "total_pnl": round(pnl_m, 2),
                "total_cost": round(cost_m, 2),
                "avg_price": round(ap_m, 4),
                "status": str(r.get("status") or "closed"),
            }
        )
    market_rows.sort(key=lambda x: x["total_pnl"], reverse=True)
    top_wins = market_rows[:5]
    top_losses = sorted(market_rows, key=lambda x: x["total_pnl"])[:5]

    # ── Open Positions ────────────────────────────────────────────
    open_agg   = agg[agg["status"] == "open"]
    open_count  = len(open_agg)
    open_risk   = open_agg["total_cost"].sum()
    open_value  = df[df["status"] == "open"]["currentValue"].sum() if "currentValue" in df.columns else 0
    open_pnl    = open_agg["total_pnl"].sum()

    # ── Monthly PnL ───────────────────────────────────────────────
    _ed = pd.to_datetime(agg["end_date"], errors="coerce", utc=True)
    agg["month"] = _ed.dt.tz_convert(None).dt.to_period("M")
    monthly_pnl = agg.groupby("month", observed=True)["total_pnl"].sum()
    monthly_data = {str(k): round(float(v), 2) for k, v in monthly_pnl.items() if pd.notna(k)}

    # ── Quality Score & Tier (Gemini Copy-Trade Metric v2) ───────
    #
    # Philosophy: reward Sharpe heavily (predictable daily edge),
    # penalise "leakage" (sports where blindly tailing loses money),
    # bonus for operating in the hardest-to-beat 20–60c price zone.
    #
    # Base components (max 85 pts):
    #   Sharpe  30 pts — max at Sharpe=8  (best proxy for copy-trade safety)
    #   ROI     25 pts — max at 15% ROI   (reduced; volume no longer inflates)
    #   WinRate 15 pts — bonus above 50%
    #   Consist 10 pts — % profitable days
    #   Volume   5 pts — log-scaled (secondary signal)
    #
    # Adjustments:
    #   Flip/Underdog Bonus  +15 pts max — ROI > 0 in 20–60c zone proves edge
    #   Leakage Penalty      -15 pts max — large net losses in a sport category
    #
    # ROI blend: Many top accounts are hedge/MM-heavy — directional-only ROI can be
    # negative while dashboard PnL is strongly positive. Using only directional ROI
    # then labels them Q≈0. Blend in dashboard ROI when hedge profit is material.
    # Leakage anchor: loss_ratio used max(total_profit_directional, 1) which explodes
    # when directional PnL ≤ 0 (denominator becomes 1). Anchor to account-scale PnL.

    hedge_share = (hedge_profit / max(raw_realized_pnl, 1e-6)) if raw_realized_pnl > 0 else 0.0
    hedge_risk_frac = hedge_risk / max(total_risked_dashboard, 1e-6)
    material_hedge = hedge_risk_frac >= 0.22 or hedge_share >= 0.18
    if material_hedge and raw_realized_pnl > 0 and roi_dashboard > 0:
        # Weight dashboard more as hedge share grows (MM / arb is real edge, not "noise")
        w = min(0.82, 0.35 + 0.65 * max(hedge_risk_frac, hedge_share * 0.9))
        roi_for_quality = w * roi_dashboard + (1 - w) * directional_overall_roi
    else:
        roi_for_quality = directional_overall_roi

    # Base components
    sharpe_score = min(max(pseudo_sharpe / 8  * 30, 0), 30)   # 30 pts, ceil Sharpe=8
    roi_score    = min(max(roi_for_quality / 15 * 25, 0), 25)   # 25 pts, ceil ROI=15%
    wr_score     = min(max((win_rate - 48) / 15 * 15, 0), 15) # 15 pts; partial credit from 48%
    cons_score   = min(max(profitable_days / max(total_days, 1) * 10, 0), 10)
    vol_score    = min(max(np.log10(max(total_risked_directional, 1)) / np.log10(5_000_000) * 5, 0), 5)

    base_score = sharpe_score + roi_score + wr_score + cons_score + vol_score  # 0–85

    # Flip / Underdog Multiplier (+15 pts max)
    # Average ROI across the 20–60c price buckets (where edge is hardest to find)
    flip_data     = price_stats.get("Flip (40-60c)",    {})
    underdog_data = price_stats.get("Underdog (20-40c)", {})
    midzone_vals  = []
    if flip_data.get("events", 0)     >= 10: midzone_vals.append(flip_data["roi"])
    if underdog_data.get("events", 0) >= 10: midzone_vals.append(underdog_data["roi"])
    midzone_roi = sum(midzone_vals) / len(midzone_vals) if midzone_vals else 0

    if   midzone_roi >= 15: flip_bonus = 15
    elif midzone_roi >= 10: flip_bonus = 10
    elif midzone_roi >=  5: flip_bonus =  5
    else:                   flip_bonus =  0

    # Leakage Penalty (-15 pts max)
    # Penalise sports where a blindly tailing user would lose money.
    # Anchor loss size to account-scale profit so MM/hedge-heavy accounts are not
    # max-penalised when directional subtotal is ≤ 0 (old code used max(dir,1)→1).
    profit_anchor = max(raw_realized_pnl, abs(total_profit_directional), 1)
    leakage_pts = 0
    for sport, stat in sport_stats.items():
        if stat["events"] >= 10 and stat["roi"] < -5 and stat["net_profit"] < -5_000:
            loss_ratio = abs(stat["net_profit"]) / profit_anchor
            if   loss_ratio >= 0.30: leakage_pts += 10
            elif loss_ratio >= 0.10: leakage_pts +=  5
            else:                    leakage_pts +=  2
    # Spread always penalised if meaningful negative ROI
    sp = market_stats.get("Spread", {})
    if sp.get("events", 0) >= 10 and sp.get("roi", 0) < -10:
        leakage_pts += 3
    leakage_penalty = min(leakage_pts, 15)

    quality_score = round(base_score + flip_bonus - leakage_penalty)
    quality_score = max(0, min(quality_score, 100))

    if   quality_score >= 70: tier = "S-Tier"
    elif quality_score >= 50: tier = "A-Tier"
    elif quality_score >= 30: tier = "B-Tier"
    else:                      tier = "C-Tier"

    # ── Tags ─────────────────────────────────────────────────────
    tags = []

    # Tier tag
    tags.append(f"{'⭐⭐⭐' if tier == 'S-Tier' else '⭐⭐' if tier == 'A-Tier' else '⭐'} {tier}")

    if material_hedge and raw_realized_pnl > 50_000:
        tags.append("⚖️ Hedge / MM-heavy — quality blends dashboard + directional ROI")

    # Sport specialty tags (positive ROI + meaningful volume)
    SPORT_EMOJIS = {
        "SOCCER (EPL)": "🏴󠁧󠁢󠁥󠁮󠁧󠁿 EPL Expert",
        "SOCCER (LaLiga)": "🇪🇸 LaLiga Expert",
        "SOCCER (UCL)": "🏆 UCL Specialist",
        "SOCCER (SerieA)": "🇮🇹 Serie A Expert",
        "SOCCER (Other)": "⚽ Global Soccer",
        "NBA": "🏀 NBA Expert",
        "NFL": "🏈 NFL Specialist",
        "NHL": "🏒 NHL Pro",
        "MLB": "⚾ MLB Expert",
        "TENNIS": "🎾 Tennis Expert",
        "ESPORTS": "🎮 Esports Analyst",
        "POLITICS": "🗳️ Politics Trader",
        "OTHER": None,
    }
    soccer_total_profit = sum(v["net_profit"] for k, v in sport_stats.items() if "SOCCER" in k)
    soccer_total_events = sum(v["events"]     for k, v in sport_stats.items() if "SOCCER" in k)
    if soccer_total_events >= 30 and soccer_total_profit > 0:
        # Pick the best soccer subtype to display
        best_soccer = max(
            [(k, v) for k, v in sport_stats.items() if "SOCCER" in k and v["events"] >= 10],
            key=lambda x: x[1]["net_profit"], default=(None, None)
        )
        if best_soccer[0] and SPORT_EMOJIS.get(best_soccer[0]):
            tags.append(SPORT_EMOJIS[best_soccer[0]])
    for sport, stat in sport_stats.items():
        if sport in ("SOCCER (EPL)", "SOCCER (LaLiga)", "SOCCER (UCL)", "SOCCER (SerieA)", "SOCCER (Other)"):
            continue  # already handled above
        emoji = SPORT_EMOJIS.get(sport)
        if emoji and stat["events"] >= 15 and stat["roi"] > 3 and stat["net_profit"] > 0:
            tags.append(emoji)

    # Strategy tags
    no_profit   = side_stats.get("No", {}).get("net_profit", 0)
    yes_profit  = side_stats.get("Yes", {}).get("net_profit", 0)
    spec_profit = side_stats.get("Specific Selection", {}).get("net_profit", 0)
    total_side_profit = no_profit + yes_profit + spec_profit
    if total_side_profit > 0 and no_profit / total_side_profit > 0.55:
        tags.append("❌ No-Contract Fader")
    if total_side_profit > 0 and yes_profit / total_side_profit > 0.55:
        tags.append("✅ Yes-Side Specialist")

    underdog_profit = price_stats.get("Underdog (20-40c)", {}).get("net_profit", 0)
    if total_profit_directional > 0 and underdog_profit / max(total_profit_directional, 1) > 0.4:
        tags.append("🎯 Underdog Sniper")

    if pseudo_sharpe >= 8:
        tags.append("💎 Consistent Grinder")
    elif pseudo_sharpe >= 4:
        tags.append("📈 Steady Performer")

    if mean_market_stake >= 10_000:
        tags.append("🐋 Mega Whale")
    elif mean_market_stake >= 2_000:
        tags.append("🐋 Big Bettor")

    ml_stat = market_stats.get("Moneyline / Match", {})
    if ml_stat.get("events", 0) >= 20 and ml_stat.get("roi", 0) > 10:
        tags.append("📈 Moneyline Pro")

    ou_stat = market_stats.get("Totals (O/U)", {})
    if ou_stat.get("events", 0) >= 10 and ou_stat.get("roi", 0) > 10:
        tags.append("📊 O/U Specialist")

    # Warning tags (fatal flaws — what NOT to tail)
    WARN_SPORTS = {
        "NBA":          "⛔ Fade NBA",
        "NFL":          "⛔ Fade NFL",
        "SOCCER (UCL)": "⛔ Fade UCL",
        "SOCCER (LaLiga)": "⛔ Fade LaLiga",
        "ESPORTS":      "⛔ Fade Esports",
    }
    for sport, warn in WARN_SPORTS.items():
        stat = sport_stats.get(sport, {})
        if stat.get("events", 0) >= 10 and stat.get("roi", 0) < -5 and stat.get("net_profit", 0) < -5_000:
            tags.append(warn)
    spread_stat = market_stats.get("Spread", {})
    if spread_stat.get("events", 0) >= 10 and spread_stat.get("roi", 0) < -5:
        tags.append("⛔ Fade Spreads")

    # ── Best markets to tail ──────────────────────────────────────
    # Top sport: highest net_profit with >= 10 events
    valid_sports = [(k, v) for k, v in sport_stats.items() if v["events"] >= 10 and v["net_profit"] > 0]
    top_sport = max(valid_sports, key=lambda x: x[1]["net_profit"])[0] if valid_sports else "OTHER"

    # Best price bucket
    valid_buckets = [(k, v) for k, v in price_stats.items() if v["events"] >= 10 and v["net_profit"] > 0]
    best_price_bucket = max(valid_buckets, key=lambda x: x[1]["roi"])[0] if valid_buckets else None

    # Best market type
    valid_markets = [(k, v) for k, v in market_stats.items() if v["events"] >= 10]
    best_market   = max(valid_markets, key=lambda x: x[1]["net_profit"])[0] if valid_markets else "Moneyline / Match"

    # ── Summary / Tailing guide ───────────────────────────────────
    tail_guide = _build_tail_guide(
        username,
        tier,
        sport_stats,
        market_stats,
        price_stats,
        side_stats,
        median_market_stake,
        mean_market_stake,
        best_price_bucket,
        best_market,
        top_sport,
    )

    # ── Structured do-not-tail / tail-for-sure (for ingest and signals) ───
    auto_tail_sports = [k for k, v in sport_stats.items()
                        if v["events"] >= 20 and v["roi"] > 5 and v["net_profit"] > 0]
    do_not_tail_sports = [k for k, v in sport_stats.items()
                          if v["events"] >= 10 and (v["roi"] < -2 or v["win_rate"] < 45) and v["net_profit"] < -2_000]
    do_not_tail_market_types = []
    if market_stats.get("Spread", {}).get("events", 0) >= 10 and market_stats.get("Spread", {}).get("roi", 0) < -5:
        do_not_tail_market_types.append("Spread")
    if market_stats.get("Totals (O/U)", {}).get("events", 0) >= 10 and market_stats.get("Totals (O/U)", {}).get("roi", 0) < -5:
        do_not_tail_market_types.append("Totals (O/U)")
    do_not_tail_sides = []
    for side_name, stat in side_stats.items():
        if stat.get("events", 0) >= 30 and stat.get("roi", 0) < -5 and stat.get("net_profit", 0) < -5_000:
            do_not_tail_sides.append(side_name)  # "Yes", "No", or "Specific Selection"

    # ── Final result dict ─────────────────────────────────────────
    return {
        "wallet":   wallet,
        "username": username,

        # Summary metrics
        "total_profit":       round(raw_realized_pnl, 2),   # display = Polymarket-matching realized PNL
        "raw_realized_pnl":   round(raw_realized_pnl, 2),   # Polymarket-matching true PNL (display only)
        "total_risked":       round(total_risked_dashboard, 2),  # dashboard-match (polyhistory) for ROI denominator
        "overall_roi":      round(roi_dashboard, 2),        # ROI = raw_realized_pnl / total_risked (accurate CSV ROIs)
        "win_rate":         round(win_rate, 2),
        "avg_bet_size":     avg_bet_size,
        "median_market_stake": round(median_market_stake, 2),
        "mean_market_stake": round(mean_market_stake, 2),
        "markets_traded":   markets_traded,
        "total_events":     total_events,
        "pseudo_sharpe":    round(float(pseudo_sharpe), 2),
        "profitable_days":  int(profitable_days),
        "total_days":       int(total_days),

        # Perfect hedge (arb) info — stripped before directional analysis
        "hedge_count":      hedge_count,
        "hedge_risk":       round(hedge_risk, 2),
        "hedge_profit":     round(hedge_profit, 2),

        # Bond yield info
        "bond_count":       bond_count,
        "bond_risk":        round(bond_risk, 2),
        "bond_profit":      round(bond_profit, 2),

        # Open positions
        "open_count":       open_count,
        "open_risk":        round(float(open_risk), 2),
        "open_value":       round(float(open_value), 2),
        "open_pnl":         round(float(open_pnl), 2),

        # Breakdowns
        "sport_stats":      sport_stats,
        "market_stats":     market_stats,
        "sport_market_stats": sport_market_stats,
        "price_stats":      price_stats,
        "side_stats":       side_stats,
        "monthly_pnl":      monthly_data,

        # Top bets
        "top_wins":         top_wins,
        "top_losses":       top_losses,

        # Classification
        "top_sport":        top_sport,
        "best_price_bucket": best_price_bucket,
        "best_market":      best_market,
        "quality_score":    quality_score,
        "tier":             tier,
        "tags":             tags,
        "tail_guide":       tail_guide,

        # Structured tail filters (for ingest → signals; re-analyzed with each run)
        "do_not_tail_sports":       do_not_tail_sports,
        "auto_tail_sports":         auto_tail_sports,
        "do_not_tail_market_types": do_not_tail_market_types,
        "do_not_tail_sides":        do_not_tail_sides,

        # Score breakdown (for transparency / debugging)
        "score_breakdown": {
            "sharpe_score":     round(sharpe_score, 1),
            "roi_score":        round(roi_score, 1),
            "wr_score":         round(wr_score, 1),
            "cons_score":       round(cons_score, 1),
            "vol_score":        round(vol_score, 1),
            "base_score":       round(base_score, 1),
            "flip_bonus":       flip_bonus,
            "leakage_penalty":  leakage_penalty,
            "midzone_roi":      round(midzone_roi, 1),
            "directional_roi":  round(directional_overall_roi, 2),
            "roi_dashboard":    round(roi_dashboard, 2),
            "roi_for_quality":  round(roi_for_quality, 2),
            "hedge_risk_frac":  round(hedge_risk_frac, 3),
            "hedge_profit_share": round(hedge_share, 3),
            "markets_traded": markets_traded,
            "median_market_stake": round(median_market_stake, 2),
            "mean_market_stake": round(mean_market_stake, 2),
            "pnl_sum_check_ok": pnl_drift < max(abs(sum_pos_pnl) * 0.02, 1.0),
        },
    }


# ================================================================
# TAIL GUIDE BUILDER
# ================================================================

def _build_tail_guide(
    username,
    tier,
    sport_stats,
    market_stats,
    price_stats,
    side_stats,
    median_market_stake: float,
    mean_market_stake: float,
    best_price_bucket,
    best_market,
    top_sport,
):
    lines = [f"How to Tail {username} [{tier}]"]
    lines.append("")

    # ── GREEN zone: AUTO-TAIL signals (ROI > 5%, events > 20) ────
    auto_tail = [(k, v) for k, v in sport_stats.items()
                 if v["events"] >= 20 and v["roi"] > 5 and v["net_profit"] > 0]
    auto_tail.sort(key=lambda x: x[1]["net_profit"], reverse=True)
    if auto_tail:
        lines.append("🟢 AUTO-TAIL:")
        for sport, stat in auto_tail[:3]:
            lines.append(f"   {sport} — {stat['roi']:.1f}% ROI, {stat['events']} markets, +${stat['net_profit']:,.0f}")
    elif any(v["events"] >= 10 and v["net_profit"] > 0 for v in sport_stats.values()):
        # Fall back to profitable sports with fewer events
        valid = [(k, v) for k, v in sport_stats.items() if v["events"] >= 10 and v["net_profit"] > 0]
        valid.sort(key=lambda x: x[1]["net_profit"], reverse=True)
        lines.append("✅ FOLLOW on:")
        for sport, stat in valid[:3]:
            lines.append(f"   {sport} — {stat['roi']:.1f}% ROI, {stat['events']} mkts, +${stat['net_profit']:,.0f}")

    lines.append("")

    # ── RED zone: DO NOT TAIL (ROI < -2% OR win rate < 45%) ──────
    do_not_tail = [(k, v) for k, v in sport_stats.items()
                   if v["events"] >= 10 and (v["roi"] < -2 or v["win_rate"] < 45) and v["net_profit"] < -2_000]
    do_not_tail.sort(key=lambda x: x[1]["net_profit"])
    if do_not_tail:
        lines.append("🔴 DO NOT TAIL:")
        for sport, stat in do_not_tail[:3]:
            reason = f"ROI {stat['roi']:.1f}%" if stat["roi"] < -2 else f"Win Rate {stat['win_rate']:.0f}%"
            lines.append(f"   {sport} — {reason}, ${stat['net_profit']:,.0f}")
        lines.append("")

    # Market type filter
    ml = market_stats.get("Moneyline / Match", {})
    sp = market_stats.get("Spread", {})
    ou = market_stats.get("Totals (O/U)", {})
    if ml.get("roi", 0) > 0:
        lines.append(f"📈 Stick to Moneylines ({ml.get('roi',0):.1f}% ROI over {ml.get('events',0)} markets)")
    if sp.get("events", 0) >= 10 and sp.get("roi", 0) < -3:
        lines.append(f"⛔ Mute all Spread bets ({sp['roi']:.1f}% ROI)")
    if ou.get("events", 0) >= 10 and ou.get("roi", 0) < -3:
        lines.append(f"⛔ Mute all O/U bets ({ou['roi']:.1f}% ROI)")

    # Price sweet spot
    if best_price_bucket:
        bucket = price_stats.get(best_price_bucket, {})
        lines.append(f"🎯 Best price zone: {best_price_bucket} ({bucket.get('roi',0):.1f}% ROI, {bucket.get('events',0)} markets)")

    # Bond filter reminder if applicable
    lines.append("⚠️  Strip any bet at avgPrice ≥ 0.95 — those are bond-yield trades, not signals")

    # Bet side
    no_profit   = side_stats.get("No", {}).get("net_profit", 0)
    yes_profit  = side_stats.get("Yes", {}).get("net_profit", 0)
    spec_profit = side_stats.get("Specific Selection", {}).get("net_profit", 0)
    total_side  = no_profit + yes_profit + spec_profit
    if total_side > 0:
        pcts = [(k, v, round(v / total_side * 100)) for k, v in
                [("No", no_profit), ("Yes", yes_profit), ("Specific", spec_profit)] if v > 0]
        pcts.sort(key=lambda x: -x[1])
        if pcts[0][2] > 55:
            lines.append(f"💡 {pcts[0][2]}% of edge from '{pcts[0][0]}' side — copy that side only")

    # Typical stake: **median** per market (robust); mean shown when skew differs
    med = median_market_stake
    mean = mean_market_stake
    if med >= 2_000:
        lines.append(
            f"⚡ Typical market stake ~${med:,.0f} (median per market) — alert at 3× for high conviction"
        )
    else:
        lines.append(f"💰 Typical market stake ~${med:,.0f} (median)")
    if mean > med * 1.35 and mean > 1_000:
        lines.append(f"   (Mean ${mean:,.0f} — some very large markets; size to the median unless you match their whale plays)")

    return "\n".join(lines)


# ================================================================
# MAIN (single CSV mode)
# ================================================================

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 4:
        print("Usage: python analyze_trader.py <csv_path> <username> <wallet>")
        sys.exit(1)

    csv_path = Path(sys.argv[1])
    username = sys.argv[2]
    wallet   = sys.argv[3]

    result = analyze_csv(csv_path, username, wallet)

    # Human-readable report
    print(f"\n{'='*70}")
    print(f"📊  TRADER REPORT: {username}  [{result['tier']}]")
    print(f"{'='*70}")
    print(f"  Net Profit:    ${result['total_profit']:>14,.2f}")
    print(f"  Total Risked:  ${result['total_risked']:>14,.2f}")
    print(f"  Overall ROI:   {result['overall_roi']:>14.2f}%")
    print(f"  Win Rate:      {result['win_rate']:>14.2f}%  (markets won / lost, PA-style)")
    print(f"  Mean $/market: ${result['avg_bet_size']:>14,.2f}")
    print(f"  Median $/mkt:  ${result['median_market_stake']:>14,.2f}")
    print(f"  Markets:       {result['markets_traded']:>14,}  |  event buckets: {result['total_events']:>6,}")
    print(f"  Pseudo-Sharpe: {result['pseudo_sharpe']:>14.2f}")
    print(f"  Quality Score: {result['quality_score']:>14}")
    print()
    print(f"  Tags: {', '.join(result['tags'])}")
    print()

    print("── Sport Breakdown ──")
    for sport, stat in sorted(result["sport_stats"].items(), key=lambda x: -x[1]["net_profit"]):
        pnl = stat["net_profit"]
        roi = stat["roi"]
        ev  = stat["events"]
        bar = "✅" if pnl > 0 else "❌"
        print(f"  {bar} {sport:<22} ${pnl:>12,.0f}  ROI: {roi:>6.1f}%  ({ev} mkts)")

    print()
    print("── Price Bucket ──")
    for bucket in ["Longshot (0-20c)", "Underdog (20-40c)", "Flip (40-60c)", "Favorite (60-80c)", "Safe (80-100c)"]:
        stat = result["price_stats"].get(bucket, {})
        if stat:
            pnl = stat["net_profit"]
            roi = stat["roi"]
            ev  = stat["events"]
            bar = "✅" if pnl > 0 else "❌"
            print(f"  {bar} {bucket:<22} ${pnl:>12,.0f}  ROI: {roi:>6.1f}%  ({ev} mkts)")

    print()
    print("── Bet Side ──")
    for side, stat in result["side_stats"].items():
        pnl = stat["net_profit"]
        roi = stat["roi"]
        bar = "✅" if pnl > 0 else "❌"
        print(f"  {bar} {side:<22} ${pnl:>12,.0f}  ROI: {roi:>6.1f}%")

    print()
    print("── Tailing Guide ──")
    print(result["tail_guide"])

    # Save JSON
    json_path = csv_path.with_suffix(".json")
    with open(json_path, "w") as f:
        json.dump(result, f, indent=2, default=str)
    print(f"\n✅ JSON saved → {json_path}")
