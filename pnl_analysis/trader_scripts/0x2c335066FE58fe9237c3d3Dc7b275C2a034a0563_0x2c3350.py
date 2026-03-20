"""
Trader CSV fetcher: 0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563 — same logic as polyhistory/Cannae.py.
Writes to pnl_analysis/output so pipeline and ingest stay in sync.
Run from repo root: python pnl_analysis/trader_scripts/0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563_0x2c3350.py
"""
import requests
import pandas as pd
import time
import csv
from pathlib import Path

ADDRESS = "0x2c335066fe58fe9237c3d3dc7b275c2a034a0563"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)
FINAL_CSV = OUTPUT_DIR / "0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563_0x2c3350.csv"

print(f"Dashboard-matching scraper for {ADDRESS} -> {FINAL_CSV.name}")

def fetch_positions(endpoint):
    base_url = "https://data-api.polymarket.com/{}".format(endpoint)
    params = {"user": ADDRESS, "limit": 50, "offset": 0}
    all_data = []
    page = 0
    while True:
        resp = requests.get(base_url, params=params)
        if resp.status_code == 400:
            break
        if resp.status_code != 200:
            print(f"{endpoint} page {page} error {resp.status_code}")
            break
        data = resp.json()
        if not data:
            break
        all_data.extend(data)
        params["offset"] += 50
        page += 1
        time.sleep(0.5)
    return pd.DataFrame(all_data)

df_closed = fetch_positions("closed-positions")
df_open = fetch_positions("positions")
df_closed["status"] = "closed"
df_open["status"] = "open"
df = pd.concat([df_closed, df_open], ignore_index=True)

def classify(row):
    slug = str(row.get("eventSlug", "") or row.get("slug", "")).lower()
    title = str(row.get("title", "")).lower()
    if any(x in slug for x in ["nba-", "wnba-", "nfl-", "mlb-", "nhl-", "playoffs", "super-bowl"]) or any(x in title for x in ["spread", "o/u", "mvp"]):
        return "SPORTS", "NBA"
    if any(x in slug for x in ["election", "presidential", "nominee", "will-"]):
        return "POLITICS", "WILL"
    return "OTHER", "Other"

df[["main_category", "sub_category"]] = df.apply(lambda r: pd.Series(classify(r)), axis=1)
if "id" in df.columns:
    df = df.drop_duplicates(subset=["id"])
money_cols = ["realizedPnl", "cashPnl", "currentValue", "initialValue"]
for col in money_cols:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    else:
        df[col] = 0.0
df["value"] = df["currentValue"]
df["total_position_pnl"] = df["realizedPnl"] + df["cashPnl"]
df["grouping_id"] = df["eventSlug"].fillna(df["slug"])

df.to_csv(FINAL_CSV, index=False, quoting=csv.QUOTE_ALL)
print(f"Saved {len(df):,} rows -> {FINAL_CSV}")
