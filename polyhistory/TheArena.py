import requests
import pandas as pd
import time
import csv

# ================================================================
# CHANGE THIS LINE ONLY FOR ANY NEW TRADER
# ================================================================
ADDRESS = "0xafd492974cd531aae7786210438ae46b42047e61"   #
FINAL_CSV = f"polymarket_full_positions_{ADDRESS[:8]}.csv"

print(f"🚀 DASHBOARD-MATCHING scraper for ({ADDRESS})")

# ================================================================
# Fetch function
# ================================================================
def fetch_positions(endpoint):
    base_url = f"https://data-api.polymarket.com/{endpoint}"
    params = {"user": ADDRESS, "limit": 50, "offset": 0}
    all_data = []
    page = 0
    while True:
        resp = requests.get(base_url, params=params)
        if resp.status_code == 400:
            print(f"🛑 {endpoint} hit 400 — end of data")
            break
        if resp.status_code != 200:
            print(f"❌ {endpoint} page {page} error {resp.status_code}")
            break
        data = resp.json()
        if not data:
            break
        all_data.extend(data)
        print(f"✅ {endpoint} page {page+1} → {len(data)} records (total: {len(all_data)})")
        params["offset"] += 50
        page += 1
        time.sleep(0.5)
    return pd.DataFrame(all_data)

df_closed = fetch_positions("closed-positions")
df_open = fetch_positions("positions")

df_closed['status'] = 'closed'
df_open['status'] = 'open'
df = pd.concat([df_closed, df_open], ignore_index=True)

# ================================================================
# CATEGORY CLASSIFIER
# ================================================================
def classify(row):
    slug = str(row.get('eventSlug', '') or row.get('slug', '')).lower()
    title = str(row.get('title', '')).lower()
    if any(x in slug for x in ['nba-', 'wnba-', 'nfl-', 'mlb-', 'nhl-', 'playoffs', 'super-bowl']) or any(x in title for x in ['spread', 'o/u', 'mvp']):
        return 'SPORTS', 'NBA'
    if any(x in slug for x in ['election', 'presidential', 'nominee', 'will-']):
        return 'POLITICS', 'WILL'
    return 'OTHER', 'Other'

df[['main_category', 'sub_category']] = df.apply(lambda r: pd.Series(classify(r)), axis=1)

# ================================================================
# CLEANUP & MATH
# ================================================================
if 'id' in df.columns:
    df = df.drop_duplicates(subset=['id'])

money_cols = ['realizedPnl', 'cashPnl', 'currentValue', 'initialValue']
for col in money_cols:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
    else:
        df[col] = 0.0

df['value'] = df['currentValue']
df['total_position_pnl'] = df['realizedPnl'] + df['cashPnl']

df['grouping_id'] = df['eventSlug'].fillna(df['slug'])

df.to_csv(FINAL_CSV, index=False, quoting=csv.QUOTE_ALL)
print(f"✅ DATABASE SAVED → {FINAL_CSV} ({len(df):,} unique rows)")

# ================================================================
# DEBUG — EVENT-LEVEL (dashboard exact match)
# ================================================================
event_pnl = df.groupby('grouping_id')['total_position_pnl'].sum()

gains = event_pnl[event_pnl > 0].sum()
losses = event_pnl[event_pnl < 0].sum()
total_profit = event_pnl.sum()

sports_df = df[df['main_category'] == 'SPORTS']
sports_event_pnl = sports_df.groupby('grouping_id')['total_position_pnl'].sum()
sports_total = sports_event_pnl.sum()

open_value = df[df['status'] == 'open']['value'].sum()

print("\n" + "="*90)
print("DEBUG: DASHBOARD EXACT MATCH")
print("="*90)
print(f"Total Net Gains      : +${gains:,.0f}")
print(f"Total Net Losses     : -${abs(losses):,.0f}")
print("-" * 90)
print(f"TOTAL ACCOUNT PROFIT : ${total_profit:,.0f}")
print(f"Sports Total Profit  : ${sports_total:,.0f}")
print(f"Current open value   : ${open_value:,.0f}")
print("\n✅ Run complete. Change ADDRESS and run again for any whale.")