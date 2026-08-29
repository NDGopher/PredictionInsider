# Elite automation roadmap

Goal: **always-on** wallet discovery → book fetch → grade/backtest → play board → promote/kick → alert — with no manual cron.

## Status (shipped)

| Item | Status |
|------|--------|
| Hot discover 10m (Z→light Q→watch→ingest) | ✅ |
| Micro grade 15m + promote 45m | ✅ |
| Smart full pipeline hourly check | ✅ |
| Entry-time as-of (first_fill − lag) | ✅ |
| Auto-kick failed hot watches | ✅ |
| Telegram promote / demote / hot-kick / PAUSE | ✅ |
| Labeled Explorer lane | ✅ |
| Bet sizing + slip on TAKE cards | ✅ |
| CLOB depth gate for TAKE | ✅ |
| Paper → live checklist | ✅ |
| Sports-biased hot radar (~70% sports) | ✅ |
| Multi-wallet consensus badge | ✅ |
| Trust surface (health / walkforward / bankroll) | ✅ |

## Always-on loops (`npm run dev`)

| Loop | Cadence |
|------|---------|
| Signals / take-plays / ticket lifecycle | 30–60s |
| Hot wallet discover | **10m** |
| Elite micro (ranked + health + tg ops) | **15m** |
| Elite promote (lab + promote + hot-kick + roster) | **45m** |
| Smart full pipeline | **hourly check** (runs if ingest &gt; `PI_SMART_REFRESH_HOURS`) |

```
hot markets (sports-biased)
  → Z-score → light Q → watch enqueue
  → CSV + ingest → after-hot ranked
  → kick fails → promote winners
  → micro regrade + take-health
  → TAKE Telegram when Sniper gates clear (depth + size checked)
```

## Product lanes

| Lane | Rule | Telegram |
|------|------|----------|
| **Sniper TAKE** | `asof_live_q60_sport_rel2` | Yes |
| **Explorer** | Q≥60 · sports · rel≥2× (labeled, not auto-TAKE) | No |
| **Consensus** | 2+ wallets same condition+side | Badge only |

## Manual ticks

```bash
npm run model:hot-discover
npm run model:elite-micro
npm run model:elite-promote
python3 pnl_analysis/kick_failed_hot_watches.py
python3 pnl_analysis/telegram_ops_alerts.py
python3 pnl_analysis/asof_fullbook_backtest.py --write-product   # after entry-time change
```

## Success metrics

- Hot watches appear without editing `extra_traders.json`
- Failed hot watches get kicked after first CSV
- Ranked board age &lt; ~20m while server is up
- Promote/demote/kick show up on Telegram when configured
- Sniper TAKE never fires on thin books (&lt;~$75 ask depth or &lt;0.75× stake)
- Discover tab shows take-health + walkforward + bankroll (DB/CSV truth)
