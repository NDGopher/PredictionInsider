# Live Roster Contract

Single source of truth for who we copy tonight.

## The Contract

**Live tail list** = `pnl_analysis/output/verified_elite_roster.json` → `elite[]`

The backend (`server/takePlays.ts`) loads:
1. **Primary**: `verified_elite_roster.json` elite array (walk-forward proven)
2. **Fallback**: `copy_universe.json` live array (only if elite is empty)

Telegram and Take-these signals fire **only for elite roster names** that pass Sniper gates.

## File Roles

| File | Purpose | Live tail? |
|------|---------|-----------|
| `verified_elite_roster.json` | Walk-forward Elite = Telegram/Sniper tail list | **Yes** (elite only) |
| `copy_universe.json` | Daily fetch + screening roster (live/bench/watch/skip) | Fallback only |
| `extra_traders.json` | Manual status overrides (watch, take_book, kicked) | Promotion gate |
| `auto_promote_log.json` | Auto-promotion audit trail | No |
| `trusted_full_books.json` | Legacy take-book 12 (frozen) | No |

## Roster Tiers

### Elite (verified_elite_roster.json)
- Walk-forward curve + specialty confirmed
- Active in last 30d (≥8 prints)
- Joinable median (<$15k)
- **Tail tonight via Telegram/Sniper**

### Scout (verified_elite_roster.json)
- Early curve pass, not yet Elite
- Watch only — not Telegram yet
- Re-evaluated daily

### Proven Bench (verified_elite_roster.json)
- Historically good but stale (DARK/COLD)
- Re-enters Elite when active + curve holds

### Live (copy_universe.json) — Fallback
- Polydata-matched + joinable + HOT/WARM + unique ROI≥5%
- Only used if no Elite names exist

## WR Gates

| Band | Condition |
|------|-----------|
| 48–75% | Standard joinable |
| 75–85% | Path-B specialist: walk-forward Elite + unique ROI≥10% + sports specialty |
| >85% | Never live (lottery books) |

## Excluded from Live (always)

- `Vigilant-Environment` — grinder
- `sentrio` — grinder  
- `Mysaria` — politics/OTHER temperature-bot
- 100k+ Polydata fills (RN1, MM bots)
- Kicked grinders in `extra_traders.json`

## Sniper Gates (when to TAKE)

All must pass:
- Q ≥ 60
- Sport-lane ROI ≥ +5%
- Relative size ≥ 2× trader's median
- Entry price 10–88¢
- No NFL
- VWAP +2¢ fill
- Hold to resolution

If gates fail, `diagnose.json` says **which gate missed** — not "not in live set."

## Rebuilding

```bash
# Regenerate elite roster from walk-forward
python pnl_analysis/walkforward_elite_discovery.py

# Rebuild copy_universe with Path-B specialist exception
python pnl_analysis/copy_roster.py

# Auto-promote watch→take_book (optional, runs daily)
python pnl_analysis/auto_promote.py
```

## Empty TAKE is Honest When

1. HVAB (or other Elite) **is** in the live tail set, AND
2. No opens pass Sniper gates tonight

If 0 TAKE and HVAB is Elite, check `diagnose.json` for which gate failed (price, sport ROI, etc).
