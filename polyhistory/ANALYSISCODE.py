import pandas as pd
import numpy as np

# ================================================================
# SETTINGS
# ================================================================
FILE_NAME = 'RN1.csv'  # Change this to any of your whale CSVs

# ================================================================
# 1. LOAD & PRE-PROCESS
# ================================================================
df = pd.read_csv(FILE_NAME)

# Calculate true cost basis
# For closed positions: shares * entry price. For open: initial investment.
df['calculated_cost'] = df.apply(
    lambda row: row['totalBought'] * row['avgPrice'] if row['status'] == 'closed' else row['initialValue'], 
    axis=1
)

# Identify the Event (Grouping by eventSlug nets out hedges/opposing bets on the same game)
df['grouping_id'] = df['eventSlug'].fillna(df['slug'])

# ================================================================
# 2. SPORT SUB-CLASSIFIER
# ================================================================
def sub_classify_sports(row):
    slug = str(row.get('slug', '')).lower()
    title = str(row.get('title', '')).lower()
    combined = slug + " " + title
    
    if any(x in combined for x in ['nba-', 'basketball', 'nba:']): return 'NBA'
    if any(x in combined for x in ['nfl-', 'football', 'super-bowl', 'cfb-']): return 'FOOTBALL'
    if any(x in combined for x in ['nhl-', 'hockey']): return 'NHL'
    if any(x in combined for x in ['mlb-', 'baseball']): return 'MLB'
    if any(x in combined for x in ['soccer', 'ucl-', 'lal-', 'fl1-', 'epl-', 'bundesliga']): return 'SOCCER'
    if any(x in combined for x in ['tennis', 'atp-', 'wta-']): return 'TENNIS'
    if any(x in combined for x in ['lol-', 'league-of-legends', 'counter-strike', 'cs2', 'esports']): return 'ESPORTS'
    return 'OTHER_OR_NICHE'

df['sport_type'] = df.apply(sub_classify_sports, axis=1)

# ================================================================
# 3. AGGREGATE TO EVENT LEVEL (The "Dashboard Match" Logic)
# ================================================================
event_agg = df.groupby('grouping_id').agg({
    'total_position_pnl': 'sum',
    'calculated_cost': 'sum',
    'main_category': 'first',
    'sport_type': 'first',
    'avgPrice': 'mean',
    'status': 'first',
    'title': 'first'
}).reset_index()

event_agg['is_win'] = event_agg['total_position_pnl'] > 0

# ================================================================
# 4. ANALYTICS: PRICE BUCKETS
# ================================================================
bins = [0, 0.2, 0.4, 0.6, 0.8, 1.0]
labels = ['Longshot (0-20c)', 'Underdog (20-40c)', 'Flip (40-60c)', 'Favorite (60-80c)', 'Safe (80-100c)']
event_agg['price_bucket'] = pd.cut(event_agg['avgPrice'], bins=bins, labels=labels)

price_stats = event_agg.groupby('price_bucket', observed=False).agg({
    'total_position_pnl': 'sum',
    'calculated_cost': 'sum',
    'is_win': ['sum', 'count']
})
price_stats.columns = ['Net_Profit', 'Total_Risked', 'Wins', 'Total_Events']
price_stats['ROI_Pct'] = (price_stats['Net_Profit'] / price_stats['Total_Risked']) * 100
price_stats['Win_Rate'] = (price_stats['Wins'] / price_stats['Total_Events']) * 100

# ================================================================
# 5. ANALYTICS: SPORT TYPES
# ================================================================
sport_stats = event_agg[event_agg['main_category'] == 'SPORTS'].groupby('sport_type').agg({
    'total_position_pnl': 'sum',
    'calculated_cost': 'sum',
    'is_win': ['sum', 'count']
})
sport_stats.columns = ['Net_Profit', 'Total_Risked', 'Wins', 'Total_Events']
sport_stats['ROI_Pct'] = (sport_stats['Net_Profit'] / sport_stats['Total_Risked']) * 100

# ================================================================
# 6. PRINT REPORT
# ================================================================
print(f"\n--- TRADER REPORT CARD: {FILE_NAME} ---")
print(f"Total Profit: ${event_agg['total_position_pnl'].sum():,.2f}")
print(f"Total Risked: ${event_agg['calculated_cost'].sum():,.2f}")
print(f"Overall ROI:  {(event_agg['total_position_pnl'].sum() / event_agg['calculated_cost'].sum())*100:.2f}%")
print(f"Win Rate:     {event_agg['is_win'].mean()*100:.2f}%")

print("\n--- PERFORMANCE BY PRICE RANGE ---")
print(price_stats[['Net_Profit', 'ROI_Pct', 'Win_Rate']])

print("\n--- PERFORMANCE BY SPORT ---")
print(sport_stats[['Net_Profit', 'ROI_Pct']].sort_values(by='Net_Profit', ascending=False))

print("\n--- TOP 3 BIGGEST WINS ---")
print(event_agg.sort_values(by='total_position_pnl', ascending=False)[['title', 'total_position_pnl']].head(3))