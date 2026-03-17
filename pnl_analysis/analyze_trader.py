"""
Polymarket Trader Analysis Engine
Exact Gemini framework: sport ROI, price buckets, bet side, Sharpe, quality score, tier, tags
Outputs a structured dict / JSON for every trader CSV.
"""

import pandas as pd
import numpy as np
import json
import csv as csv_module
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
    df = pd.read_csv(csv_path)

    # ── Pre-process ──────────────────────────────────────────────
    money_cols = ["realizedPnl", "cashPnl", "currentValue", "initialValue", "totalBought", "avgPrice"]
    for col in money_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        else:
            df[col] = 0.0

    if "total_position_pnl" not in df.columns:
        df["total_position_pnl"] = df["realizedPnl"] + df["cashPnl"]

    # Grouping ID (nets out hedges on the same event)
    df["grouping_id"] = df["eventSlug"].fillna(df.get("slug", "")).where(
        df["eventSlug"].notna(), df.get("slug", "")
    )

    # Cost basis
    df["calculated_cost"] = df.apply(
        lambda r: r["totalBought"] * r["avgPrice"] if r.get("status") == "closed" else r["initialValue"],
        axis=1
    )

    # Classifiers
    df["sport_type"]  = df.apply(get_sport,       axis=1)
    df["market_type"] = df.apply(get_market_type, axis=1)
    df["bet_side"]    = df.apply(get_bet_side,     axis=1)

    # ── Bond Yield Filter ────────────────────────────────────────
    df["is_bond"] = (df["bet_side"] == "No") & (df["avgPrice"] >= 0.95)
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

    avg_price_series = directional_df.groupby("grouping_id").apply(w_avg_price).reset_index(name="avg_price")
    agg = agg.merge(avg_price_series, on="grouping_id", how="left")
    agg["avg_price"] = agg["avg_price"].fillna(0)
    agg["is_win"]    = agg["total_pnl"] > 0
    agg["price_bucket"] = agg["avg_price"].apply(price_bucket)

    # ── Core Metrics ─────────────────────────────────────────────
    total_profit   = agg["total_pnl"].sum()
    total_risked   = agg["total_cost"].sum()
    overall_roi    = (total_profit / total_risked * 100) if total_risked > 0 else 0
    win_rate       = agg["is_win"].mean() * 100 if len(agg) > 0 else 0
    avg_bet_size   = agg["total_cost"].mean() if len(agg) > 0 else 0
    total_events   = len(agg)

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
    for sport, grp in agg.groupby("sport_type"):
        s_profit = grp["total_pnl"].sum()
        s_cost   = grp["total_cost"].sum()
        s_roi    = (s_profit / s_cost * 100) if s_cost > 0 else 0
        s_wr     = grp["is_win"].mean() * 100 if len(grp) > 0 else 0
        sport_stats[sport] = {
            "net_profit": round(s_profit, 2),
            "roi":        round(s_roi, 2),
            "win_rate":   round(s_wr, 2),
            "events":     len(grp),
            "avg_bet":    round(grp["total_cost"].mean(), 2),
        }

    # ── Market Type Breakdown ────────────────────────────────────
    market_stats = {}
    for mtype, grp in agg.groupby("market_type"):
        m_profit = grp["total_pnl"].sum()
        m_cost   = grp["total_cost"].sum()
        m_roi    = (m_profit / m_cost * 100) if m_cost > 0 else 0
        market_stats[mtype] = {
            "net_profit": round(m_profit, 2),
            "roi":        round(m_roi, 2),
            "win_rate":   round(grp["is_win"].mean() * 100, 2),
            "events":     len(grp),
        }

    # ── Price Bucket Breakdown ───────────────────────────────────
    price_stats = {}
    for bucket, grp in agg.groupby("price_bucket"):
        p_profit = grp["total_pnl"].sum()
        p_cost   = grp["total_cost"].sum()
        p_roi    = (p_profit / p_cost * 100) if p_cost > 0 else 0
        price_stats[str(bucket)] = {
            "net_profit": round(p_profit, 2),
            "roi":        round(p_roi, 2),
            "win_rate":   round(grp["is_win"].mean() * 100, 2),
            "events":     len(grp),
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

    # ── Top Wins & Losses (event-level) ──────────────────────────
    top_wins   = agg.sort_values("total_pnl", ascending=False).head(5)[["title","sport_type","total_pnl","total_cost","avg_price","status"]].to_dict("records")
    top_losses = agg.sort_values("total_pnl").head(5)[["title","sport_type","total_pnl","total_cost","avg_price","status"]].to_dict("records")

    # ── Open Positions ────────────────────────────────────────────
    open_agg   = agg[agg["status"] == "open"]
    open_count  = len(open_agg)
    open_risk   = open_agg["total_cost"].sum()
    open_value  = df[df["status"] == "open"]["currentValue"].sum() if "currentValue" in df.columns else 0
    open_pnl    = open_agg["total_pnl"].sum()

    # ── Monthly PnL ───────────────────────────────────────────────
    agg["month"] = pd.to_datetime(agg["end_date"], errors="coerce").dt.to_period("M")
    monthly_pnl  = agg.groupby("month")["total_pnl"].sum()
    monthly_data = {str(k): round(v, 2) for k, v in monthly_pnl.items()}

    # ── Quality Score & Tier ─────────────────────────────────────
    # ROI contribution (max 40 pts — reaches max at ~20% ROI)
    roi_score    = min(max(overall_roi / 20 * 40, 0), 40)
    # Sharpe contribution (max 25 pts — reaches max at Sharpe 12)
    sharpe_score = min(max(pseudo_sharpe / 12 * 25, 0), 25)
    # Win rate bonus above 50% (max 15 pts)
    wr_score     = min(max((win_rate - 50) / 15 * 15, 0), 15)
    # Volume (log-scaled, max 10 pts — reaches max at $5M risked)
    vol_score    = min(max(np.log10(max(total_risked, 1)) / np.log10(5_000_000) * 10, 0), 10)
    # Consistency bonus: profitable days (max 10 pts)
    cons_score   = min(max(profitable_days / max(total_days, 1) * 10, 0), 10)

    quality_score = round(roi_score + sharpe_score + wr_score + vol_score + cons_score)

    if   quality_score >= 70: tier = "S-Tier"
    elif quality_score >= 50: tier = "A-Tier"
    elif quality_score >= 30: tier = "B-Tier"
    else:                      tier = "C-Tier"

    # ── Tags ─────────────────────────────────────────────────────
    tags = []

    # Tier tag
    tags.append(f"{'⭐⭐⭐' if tier == 'S-Tier' else '⭐⭐' if tier == 'A-Tier' else '⭐'} {tier}")

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
    if total_profit > 0 and underdog_profit / max(total_profit, 1) > 0.4:
        tags.append("🎯 Underdog Sniper")

    if pseudo_sharpe >= 8:
        tags.append("💎 Consistent Grinder")
    elif pseudo_sharpe >= 4:
        tags.append("📈 Steady Performer")

    if avg_bet_size >= 10_000:
        tags.append("🐋 Mega Whale")
    elif avg_bet_size >= 2_000:
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
        username, tier, sport_stats, market_stats, price_stats,
        side_stats, avg_bet_size, best_price_bucket, best_market, top_sport
    )

    # ── Final result dict ─────────────────────────────────────────
    return {
        "wallet":   wallet,
        "username": username,

        # Summary metrics
        "total_profit":     round(total_profit, 2),
        "total_risked":     round(total_risked, 2),
        "overall_roi":      round(overall_roi, 2),
        "win_rate":         round(win_rate, 2),
        "avg_bet_size":     round(avg_bet_size, 2),
        "total_events":     total_events,
        "pseudo_sharpe":    round(float(pseudo_sharpe), 2),
        "profitable_days":  int(profitable_days),
        "total_days":       int(total_days),

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
    }


# ================================================================
# TAIL GUIDE BUILDER
# ================================================================

def _build_tail_guide(username, tier, sport_stats, market_stats, price_stats,
                       side_stats, avg_bet, best_price_bucket, best_market, top_sport):
    lines = [f"How to Tail {username} [{tier}]"]
    lines.append("")

    # Best sport
    valid_sports = [(k, v) for k, v in sport_stats.items() if v["events"] >= 10 and v["net_profit"] > 0]
    valid_sports.sort(key=lambda x: x[1]["net_profit"], reverse=True)
    if valid_sports:
        top3 = ", ".join([f"{k} (+${v['net_profit']:,.0f}, {v['roi']:.1f}% ROI)" for k, v in valid_sports[:3]])
        lines.append(f"✅ FOLLOW on: {top3}")

    # Avoid sports
    avoid_sports = [(k, v) for k, v in sport_stats.items() if v["events"] >= 10 and v["roi"] < -5 and v["net_profit"] < -5_000]
    if avoid_sports:
        avoid3 = ", ".join([f"{k} ({v['roi']:.1f}% ROI)" for k, v in avoid_sports])
        lines.append(f"🚫 AVOID on: {avoid3}")

    # Market type
    ml = market_stats.get("Moneyline / Match", {})
    sp = market_stats.get("Spread", {})
    ou = market_stats.get("Totals (O/U)", {})
    if ml.get("roi", 0) > 0:
        lines.append(f"📈 Stick to Moneylines ({ml.get('roi',0):.1f}% ROI over {ml.get('events',0)} events)")
    if sp.get("events", 0) >= 10 and sp.get("roi", 0) < -3:
        lines.append(f"⛔ Never tail Spread bets ({sp['roi']:.1f}% ROI)")
    if ou.get("events", 0) >= 10 and ou.get("roi", 0) < -3:
        lines.append(f"⛔ Never tail O/U bets ({ou['roi']:.1f}% ROI)")

    # Price sweet spot
    if best_price_bucket:
        bucket = price_stats.get(best_price_bucket, {})
        lines.append(f"🎯 Best price range: {best_price_bucket} ({bucket.get('roi',0):.1f}% ROI, {bucket.get('events',0)} events)")

    # Bet side
    no_profit   = side_stats.get("No", {}).get("net_profit", 0)
    yes_profit  = side_stats.get("Yes", {}).get("net_profit", 0)
    spec_profit = side_stats.get("Specific Selection", {}).get("net_profit", 0)
    total_side  = no_profit + yes_profit + spec_profit
    if total_side > 0:
        pcts = [(k, v, round(v / total_side * 100)) for k, v in [("No", no_profit), ("Yes", yes_profit), ("Specific", spec_profit)] if v > 0]
        pcts.sort(key=lambda x: -x[1])
        if pcts[0][2] > 55:
            lines.append(f"💡 {pcts[0][2]}% of profit comes from '{pcts[0][0]}' contracts — copy that side")

    # Average bet sizing
    if avg_bet >= 2_000:
        lines.append(f"⚡ Normal bet ~${avg_bet:,.0f} — set alert for 3x above average (high-conviction)")
    else:
        lines.append(f"💰 Avg bet ~${avg_bet:,.0f}")

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
    print(f"  Win Rate:      {result['win_rate']:>14.2f}%")
    print(f"  Avg Bet Size:  ${result['avg_bet_size']:>14,.2f}")
    print(f"  Events:        {result['total_events']:>14,}")
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
        print(f"  {bar} {sport:<22} ${pnl:>12,.0f}  ROI: {roi:>6.1f}%  ({ev} events)")

    print()
    print("── Price Bucket ──")
    for bucket in ["Longshot (0-20c)", "Underdog (20-40c)", "Flip (40-60c)", "Favorite (60-80c)", "Safe (80-100c)"]:
        stat = result["price_stats"].get(bucket, {})
        if stat:
            pnl = stat["net_profit"]
            roi = stat["roi"]
            ev  = stat["events"]
            bar = "✅" if pnl > 0 else "❌"
            print(f"  {bar} {bucket:<22} ${pnl:>12,.0f}  ROI: {roi:>6.1f}%  ({ev} events)")

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
