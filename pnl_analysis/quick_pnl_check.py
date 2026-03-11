#!/usr/bin/env python3
"""
Quick PNL check: fetch closed-positions + open positions for test wallets.
Uses /closed-positions realizedPnl (canonical, matches Polymarket/Analytics).
No rate-limit sleep for speed. Run with: python3 quick_pnl_check.py
"""
import requests
import time

DATA_API = "https://data-api.polymarket.com"
SLEEP = 0.5  # seconds between calls (gentler than 2.0)

WALLETS = [
    ("kch123",              "0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee"),
    ("DLEK",                "0x6e82b93eb57b01a63027bd0c6d2f3f04934a752c"),
    ("geniusMC",            "0x0b9cae2b0dfe7a71c413e0604eaac1c352f87e44"),
    ("ShortFlutterStock",   "0x13414a77a4be48988851c73dfd824d0168e70853"),
    ("EIf",                 "0xd6966eb1ae7b52320ba7ab1016680198c9e08a49"),
    ("Andromeda1",          "0x39932ca2b7a1b8ab6cbf0b8f7419261b950ccded"),
    ("TTdes",               "0x25867077c891354137bbaf7fde12eec6949cc893"),
]

def fetch_closed_positions(addr):
    """Paginate /closed-positions (limit 50). Returns list of records."""
    all_cp = []
    offset = 0
    while True:
        try:
            r = requests.get(f"{DATA_API}/closed-positions",
                params={"user": addr, "limit": 50, "offset": offset}, timeout=20)
            time.sleep(SLEEP)
            if not r.ok:
                print(f"  [closed-positions] HTTP {r.status_code}")
                break
            batch = r.json()
        except Exception as e:
            print(f"  [closed-positions] error: {e}")
            break
        if not batch:
            break
        all_cp.extend(batch)
        if len(batch) < 50:
            break
        offset += 50
        if offset >= 100_000:
            break
    return all_cp

def fetch_open_positions(addr):
    """Fetch /positions (open). Returns list."""
    try:
        r = requests.get(f"{DATA_API}/positions",
            params={"user": addr, "limit": 500, "sizeThreshold": 0}, timeout=20)
        time.sleep(SLEEP)
        return r.json() if r.ok else []
    except Exception as e:
        print(f"  [positions] error: {e}")
        return []

def fetch_value(addr):
    """GET /value endpoint for total portfolio value."""
    try:
        r = requests.get(f"{DATA_API}/value", params={"user": addr}, timeout=15)
        time.sleep(SLEEP)
        if r.ok:
            data = r.json()
            if isinstance(data, list) and data:
                return float(data[0].get("value") or 0)
            if isinstance(data, dict):
                return float(data.get("value") or 0)
    except:
        pass
    return None

print("=" * 80)
print("POLYMARKET PNL TIE-OUT — closed-positions API method")
print("=" * 80)
print(f"{'Name':<25} {'Closed rows':>11} {'Realized':>14} {'Open rows':>9} {'Unrealized':>11} {'TOTAL PNL':>12} {'Portfolio $':>11}")
print("-" * 95)

results = []
for name, addr in WALLETS:
    print(f"\nFetching {name} ({addr[:12]}...)...")
    
    cp = fetch_closed_positions(addr)
    realized = sum(float(c.get("realizedPnl") or 0) for c in cp)
    
    op = fetch_open_positions(addr)
    unrealized = sum(float(p.get("cashPnl") or 0) for p in op)
    
    portfolio = fetch_value(addr)
    total = realized + unrealized
    
    print(f"  {name:<23} cp={len(cp):>5}  realized=${realized:>13,.2f}  open={len(op):>4}  unrealized=${unrealized:>10,.2f}  TOTAL=${total:>12,.2f}  portfolio=${portfolio if portfolio is not None else '?':>10}")
    
    results.append({
        "name": name, "addr": addr,
        "closed_rows": len(cp), "realized": realized,
        "open_rows": len(op), "unrealized": unrealized,
        "total": total, "portfolio": portfolio,
    })

print("\n" + "=" * 80)
print("SUMMARY TABLE")
print("=" * 80)
print(f"{'Name':<25} {'Realized':>14} {'Unrealized':>11} {'TOTAL PNL':>12}")
print("-" * 65)
for r in sorted(results, key=lambda x: x["total"], reverse=True):
    print(f"{r['name']:<25} ${r['realized']:>13,.0f}  ${r['unrealized']:>10,.0f}  ${r['total']:>12,.0f}")

print("\nNote: Realized = sum(realizedPnl) from /closed-positions — matches Polymarket/Analytics")
print("      Unrealized = sum(cashPnl) from /positions — current open position P&L")
