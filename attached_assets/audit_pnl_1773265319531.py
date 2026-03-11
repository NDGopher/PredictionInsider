"""One-off audit: load CSV and positions API to verify PnL components."""
import pandas as pd
from pathlib import Path

CSV = Path("output/0b9cae2b0d_trades.csv")
if not CSV.exists():
    print("CSV not found")
    exit(1)

df = pd.read_csv(CSV)
df["cost_usdc"] = pd.to_numeric(df["cost_usdc"], errors="coerce")
df["payout_usdc"] = pd.to_numeric(df["payout_usdc"], errors="coerce")

trades = df[df["type"] == "TRADE"]
redeems = df[df["type"] == "REDEEM"]
reward = df[df["type"] == "REWARD"]
yield_ = df[df["type"] == "YIELD"]

buy_cost = trades.loc[trades["side"] == "BUY", "cost_usdc"].fillna(0).sum()
sell_proceeds = trades.loc[trades["side"] == "SELL", "cost_usdc"].fillna(0).sum()
redemption = redeems["payout_usdc"].fillna(0).sum()
reward_income = reward["payout_usdc"].fillna(0).sum()
yield_income = yield_["payout_usdc"].fillna(0).sum()

print("=== From CSV (0b9cae2b0d) ===\n")
print("TRADE BUY  cost_usdc sum:", f"{buy_cost:,.2f}")
print("TRADE SELL cost_usdc sum:", f"{sell_proceeds:,.2f}")
print("REDEEM     payout_usdc sum:", f"{redemption:,.2f}")
print("REWARD     payout_usdc sum:", f"{reward_income:,.2f}")
print("YIELD      payout_usdc sum:", f"{yield_income:,.2f}")
print()
realized = redemption + sell_proceeds - buy_cost + reward_income + yield_income
print("Realized PNL (redeem + sell - buy + reward + yield):", f"{realized:,.2f}")
print()

# Check for any other types that might have cost/payout
for t in df["type"].unique():
    sub = df[df["type"] == t]
    c = sub["cost_usdc"].fillna(0).sum()
    p = sub["payout_usdc"].fillna(0).sum()
    if c != 0 or p != 0:
        print(f"  {t}: cost_usdc={c:,.2f}, payout_usdc={p:,.2f}")

# Positions and closed-positions: canonical PnL from API
import requests
addr = "0x0b9cae2b0dfe7a71c413e0604eaac1c352f87e44"
r = requests.get("https://data-api.polymarket.com/positions", params={"user": addr, "limit": 500}, timeout=15)
positions = r.json() if r.ok else []
unrealized = sum(float(p.get("cashPnl") or 0) for p in positions)

# Paginate closed-positions (limit 50 max)
closed = []
off = 0
while True:
    r2 = requests.get("https://data-api.polymarket.com/closed-positions", params={"user": addr, "limit": 50, "offset": off}, timeout=15)
    batch = r2.json() if r2.ok else []
    closed.extend(batch)
    if len(batch) < 50:
        break
    off += 50
    if off >= 100_000:
        break
api_realized = sum(float(c.get("realizedPnl") or 0) for c in closed)

value_r = requests.get("https://data-api.polymarket.com/value", params={"user": addr}, timeout=15)
total_value = (value_r.json()[0]["value"]) if value_r.ok and value_r.json() else None

print("\n=== Positions API ===")
print("Open position rows:", len(positions))
print("Sum(cashPnl) unrealized:", f"{unrealized:,.2f}")
print("\n=== Closed-positions API (canonical realized) ===")
print("Closed position rows:", len(closed))
print("Sum(realizedPnl):", f"{api_realized:,.2f}")
if total_value is not None:
    print("\nGET /value (portfolio value):", f"{total_value:,.2f}")
print("\nTotal PNL (API realized + unrealized):", f"{api_realized + unrealized:,.2f}")
print("Target (Polymarket): ~2,653,000")
