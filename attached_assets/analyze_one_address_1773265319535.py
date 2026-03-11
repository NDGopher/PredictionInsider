#!/usr/bin/env python3
"""
One-off: paste a single Polymarket proxy wallet address → full analysis + CSV output.

Run:
  python analyze_one_address.py
  (then paste the address when prompted)

  python analyze_one_address.py 0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee
  (address as command-line argument)

Output:
  - Console: summary metrics, breakdown by type/category, sample rows.
  - output/<address_short>_trades.csv  (full trade history)
  - output/<address_short>_summary.txt (metrics)
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Reuse logic from main script
from polymarket_trader_history import (
    OUTPUT_DIR,
    fetch_all_activity,
    fetch_all_positions,
    fetch_all_closed_positions,
    build_history_df,
    build_positions_summary_df,
    build_breakdowns,
    analyze_history,
    add_open_positions_metrics,
    save_to_csv,
)

import pandas as pd


def normalize_address(raw: str) -> str | None:
    """Accept 0x + 40 hex (with or without 0x prefix). Return lowercase or None."""
    s = (raw or "").strip()
    if s.startswith("0x"):
        s = s[2:]
    if len(s) == 40 and all(c in "0123456789abcdefABCDEF" for c in s):
        return "0x" + s.lower()
    return None


def run_one(address: str) -> None:
    addr = normalize_address(address)
    if not addr:
        print("Invalid address: need 0x + 40 hex characters.")
        return

    print(f"Address: {addr}")
    print("Fetching full activity (for 10k+ positions expect ~1 min per 2.5k rows due to rate limit)...")
    print()

    def progress(total: int, page: int) -> None:
        print(f"  ... {total:,} rows (page {page})", flush=True)

    activity = fetch_all_activity(addr, on_progress=progress)
    print(f"  Done: {len(activity):,} activity rows.")

    print("Fetching open positions (unrealized PnL)...")
    positions = fetch_all_positions(addr)
    print(f"  Done: {len(positions)} open position rows.")
    print("Fetching closed positions (canonical realized PnL from API)...")
    closed_positions = fetch_all_closed_positions(addr)
    print(f"  Done: {len(closed_positions)} closed position rows.\n")

    if not activity:
        print("No activity found for this address.")
        return

    df = build_history_df(activity)
    metrics = analyze_history(df)
    # Use API realized PnL (sum of realizedPnl from closed-positions) so total matches Polymarket/analytics
    metrics = add_open_positions_metrics(metrics, positions, closed_positions=closed_positions)

    # Positions summary: one row per closed position for strategy analysis (markets, submarkets, win/loss)
    positions_summary_df = build_positions_summary_df(closed_positions)

    # Average trade size (per fill) and average position size (per closed position) for summary
    trades_only = df[df["type"] == "TRADE"]
    buy_trades = trades_only[trades_only["side"] == "BUY"] if "side" in trades_only.columns else trades_only
    avg_trade_size_usdc = float(buy_trades["cost_usdc"].dropna().mean()) if not buy_trades.empty and buy_trades["cost_usdc"].notna().any() else 0.0
    avg_position_size_usdc = float(positions_summary_df["total_bought_usdc"].mean()) if not positions_summary_df.empty and "total_bought_usdc" in positions_summary_df.columns else 0.0
    median_trade_size_usdc = float(buy_trades["cost_usdc"].dropna().median()) if not buy_trades.empty and buy_trades["cost_usdc"].notna().any() else 0.0
    metrics["avg_trade_size_usdc"] = avg_trade_size_usdc
    metrics["avg_position_size_usdc"] = avg_position_size_usdc
    metrics["median_trade_size_usdc"] = median_trade_size_usdc

    # Label for files (first 10 chars of address)
    label = addr[2:12] if addr.startswith("0x") else addr[:10]

    # Save full trades CSV (every trade), positions summary CSV, and text summary
    save_to_csv(label, df, metrics, positions_summary_df=positions_summary_df)

    # Breakdown: how they made money (by category, submarket, position-size bucket)
    breakdowns = build_breakdowns(positions_summary_df)
    safe_name = re.sub(r"[^\w\-]", "_", label)[:80]
    for key, bdf in breakdowns.items():
        if not bdf.empty:
            out_path = OUTPUT_DIR / f"{safe_name}_breakdown_{key}.csv"
            bdf.to_csv(out_path, index=False)

    # Append breakdown section to summary file
    with open(OUTPUT_DIR / f"{safe_name}_summary.txt", "a", encoding="utf-8") as f:
        f.write("\nHOW THEY MADE MONEY (closed positions)\n")
        f.write("=" * 50 + "\n")
        for name, bdf in [("By category", breakdowns["by_category"]), ("By submarket", breakdowns["by_submarket"]), ("By position size", breakdowns["by_position_size"])]:
            if bdf.empty:
                continue
            f.write(f"\n{name}\n")
            f.write("-" * 40 + "\n")
            for _, row in bdf.iterrows():
                seg = row.get("segment", "")
                pos = int(row.get("positions", 0))
                cost = row.get("total_bought_usdc", 0)
                pnl = row.get("realized_pnl_usdc", 0)
                roi = row.get("roi_pct", 0)
                wins = int(row.get("wins", 0))
                losses = int(row.get("losses", 0))
                wr = row.get("win_rate_pct", 0)
                f.write(f"  {seg}: positions={pos}, cost=${cost:,.0f}, PnL=${pnl:,.0f}, ROI={roi}%, win_rate={wr}% (W/L {wins}/{losses})\n")
        f.write("\n")

    print("--- SAVED FILES ---")
    print(f"  Trades CSV (every trade):     {OUTPUT_DIR / (label + '_trades.csv')}")
    print(f"  Positions summary (closed):  {OUTPUT_DIR / (label + '_positions_summary.csv')}")
    print(f"  Summary:                     {OUTPUT_DIR / (label + '_summary.txt')}")
    if any(not bdf.empty for bdf in breakdowns.values()):
        print(f"  Breakdown by category:       {OUTPUT_DIR / (safe_name + '_breakdown_by_category.csv')}")
        print(f"  Breakdown by submarket:      {OUTPUT_DIR / (safe_name + '_breakdown_by_submarket.csv')}")
        print(f"  Breakdown by position size: {OUTPUT_DIR / (safe_name + '_breakdown_by_position_size.csv')}")
    print()

    # --- PNL TIE-OUT (verify against Polymarket/analytics) ---
    realized = metrics.get("realized_pnl_usdc", metrics.get("pnl_usdc", 0))
    unrealized = metrics.get("unrealized_pnl_usdc", 0)
    total_pnl = metrics.get("total_pnl_usdc", realized + unrealized)
    print("=" * 60)
    print("PNL TIE-OUT (check against Polymarket / Polymarket Analytics)")
    print("=" * 60)
    print(f"  Realized PNL (closed positions, from API):  ${realized:,.2f}")
    print(f"  Unrealized PNL (open positions):           ${unrealized:,.2f}")
    print(f"  ----------------------------------------")
    print(f"  Total PNL:                                 ${total_pnl:,.2f}")
    print()

    # --- Key metrics: ROI, position sizes, win rate ---
    print("--- KEY METRICS ---")
    print(f"  ROI (%):                    {metrics['roi_pct']:.2f}%")
    print(f"  Win rate (%):               {metrics['win_rate_pct']:.1f}%  (winning: {metrics['winning_positions']}, losing: {metrics['losing_positions']})")
    print(f"  Average trade size (USDC):  ${avg_trade_size_usdc:,.2f}  (per BUY fill)")
    print(f"  Median trade size (USDC):   ${median_trade_size_usdc:,.2f}")
    print(f"  Average position size (USDC): ${avg_position_size_usdc:,.2f}  (per closed position)")
    print()

    # --- Counts and volume ---
    print("--- COUNTS & VOLUME ---")
    print(f"  Total trades (fills):   {metrics['total_trades']}")
    print(f"  Total redemptions:      {metrics['total_redemptions']}")
    print(f"  Closed positions:       {metrics['total_positions']}")
    print(f"  Open positions:        {metrics.get('open_positions_count', 0)}")
    print(f"  Total predictions:      {metrics.get('total_predictions', metrics['total_positions'])}")
    print(f"  Volume (USDC):          ${metrics['volume_usdc']:,.2f}")
    print(f"  Total cost (buys):     ${metrics['total_cost_usdc']:,.2f}")
    print(f"  Sell proceeds:          ${metrics['total_sell_proceeds_usdc']:,.2f}")
    print(f"  Redemption payouts:     ${metrics['total_redemption_usdc']:,.2f}")
    if metrics.get("other_income_usdc"):
        print(f"  Other income (REWARD/YIELD): ${metrics.get('other_income_usdc', 0):,.2f}")
    print()

    # How they made money: by category, submarket, position-size bucket
    if not positions_summary_df.empty and breakdowns:
        bcat = breakdowns["by_category"]
        breakdown_pnl_sum = bcat["realized_pnl_usdc"].sum() if not bcat.empty else positions_summary_df["realized_pnl_usdc"].sum()
        print("--- HOW THEY MADE MONEY (closed positions: PnL, ROI, win rate) ---")
        print(f"  (Breakdown realized PnL sum: ${breakdown_pnl_sum:,.2f}  — should match Realized PnL above)")
        for name, bdf in [("By category", breakdowns["by_category"]), ("By submarket", breakdowns["by_submarket"]), ("By position size", breakdowns["by_position_size"])]:
            if bdf.empty:
                continue
            print(f"\n  {name}:")
            print(bdf.to_string(index=False))
        print()

    # By type
    print("--- BY TYPE ---")
    for t in df["type"].dropna().unique():
        count = (df["type"] == t).sum()
        print(f"  {t}: {count}")
    print()

    # By category (inferred from slug)
    if "category" in df.columns:
        print("--- BY CATEGORY (from slug) ---")
        by_cat = df.groupby("category", dropna=False).agg(
            rows=("timestamp", "count"),
            cost=("cost_usdc", "sum"),
            payout=("payout_usdc", "sum"),
        ).round(2)
        by_cat = by_cat.sort_values("rows", ascending=False)
        print(by_cat.to_string())
        print()

    # Side breakdown (BUY vs SELL)
    trades = df[df["type"] == "TRADE"]
    if not trades.empty and "side" in trades.columns:
        print("--- TRADES BY SIDE ---")
        for side in ["BUY", "SELL"]:
            sub = trades[trades["side"] == side]
            if not sub.empty:
                n = len(sub)
                usdc = (sub["cost_usdc"].fillna(0)).sum()
                print(f"  {side}: {n} rows, USDC total: ${usdc:,.2f}")
        print()

    # Full trade history is in the CSV; row count ties out with activity
    print("--- TRADE HISTORY ---")
    print(f"  Full history: {len(df):,} rows in {label}_trades.csv (every trade in depth)")
    print()
    # Sample rows: show analysis-friendly columns
    print("--- SAMPLE TRADES (first 5 by time) ---")
    cols = ["timestamp", "type", "side", "market_title", "category", "submarket", "outcome", "entry_price", "bet_size_usdc", "size_shares", "cost_usdc", "payout_usdc"]
    cols = [c for c in cols if c in df.columns]
    print(df[cols].head(5).to_string())
    print()
    print("--- SAMPLE TRADES (last 5 by time) ---")
    print(df[cols].tail(5).to_string())
    if not positions_summary_df.empty:
        print()
        print("--- SAMPLE POSITIONS SUMMARY (first 5 by realized PnL) ---")
        ps_cols = [c for c in ["market_title", "category", "submarket", "outcome", "total_bought_usdc", "avg_entry_price", "realized_pnl_usdc", "win"] if c in positions_summary_df.columns]
        print(positions_summary_df.nlargest(5, "realized_pnl_usdc")[ps_cols].to_string())
    print()
    print("Done. Open the CSV in Excel or a text editor for full history.")


def main() -> None:
    if len(sys.argv) > 1:
        address = " ".join(sys.argv[1:]).strip()
    else:
        print("Paste the Polymarket proxy wallet address (0x...), then press Enter.")
        address = input("Address: ").strip()

    if not address:
        print("No address provided. Run: python analyze_one_address.py 0x...")
        return

    run_one(address)


if __name__ == "__main__":
    main()
