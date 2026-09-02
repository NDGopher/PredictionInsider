# Live Roster Management

This document describes how to add, remove, bench, and scout traders for the live copy list without making code changes.

## Quick Reference

```bash
# List all traders by status
python roster_manage.py list
python roster_manage.py list --status live -v

# Add a new trader to watch
python roster_manage.py add 0x1234... "NewTrader" --why "Strong +ROI curve, 40% on recent 30d"

# Kick a trader (requires reason)
python roster_manage.py kick 0x1234... --reason "Collapsed to -ROI after loser-side fetch"

# Bench a stale trader
python roster_manage.py bench 0x1234... --reason "No prints since 2026-05-01"

# Auto-bench all traders with 90+ days no activity
python roster_manage.py stale --days 90 --apply

# View scout candidates from leaderboard discovery
python roster_manage.py scout --max-new 10
python roster_manage.py scout --write  # Add them to roster as scouts

# Promote a scout/watch to take_book (checks elite gates)
python roster_manage.py promote 0x1234... --reason "Passed Q>=60, sport ROI>=5%"
```

## Data Flow

```
extra_traders.json  →  copy_roster.py  →  copy_universe.json
        ↓                    ↓
   roster_manage.py    build_insider_ranks.py
        ↓                    ↓
   (CLI operations)    insider_ranks.json
```

The **single source of truth** for operational roster changes is `pnl_analysis/extra_traders.json`. This file is read by:
- `copy_roster.py` → determines who gets refreshed and who goes to live alerts
- `build_insider_ranks.py` → carries status/notes into the insider ranks JSON

## Status Values

| Status | Refresh? | Live Alerts? | Description |
|--------|----------|--------------|-------------|
| `take_book` | Yes | Yes | On the live Telegram alert list. Must pass elite gates. |
| `watch` | Yes | No | Tracked, books refreshed, not on live alerts. |
| `scout` | Yes | No | Discovered candidate, needs full vetting. |
| `benched` | Yes | No | Was live or watch, auto-benched for staleness (90+ days). |
| `kicked` | No | No | Removed from roster. Reason required. |
| `removed` | No | No | Manually removed by operator. |

## Staleness Policy

Traders are **auto-benched** when they have no joinable prints in **90 days** (configurable via `STALE_BENCH_DAYS` in `copy_roster.py`).

- "Joinable" means: closed events we could actually tail (not mega-stakes, not market-maker fills)
- The benched status persists in `extra_traders.json` with a `bench_date` and `bench_reason`
- Benched traders still get refreshed so we can see if they come back
- Empty TAKE because they went cold is honest — we don't fire stale signals

To manually bench or auto-bench:

```bash
# Manual bench with custom reason
python roster_manage.py bench 0x1234... --reason "Went cold May 2026, revisit Q4"

# Auto-bench all stale traders (dry run)
python roster_manage.py stale --days 90

# Auto-bench all stale traders (apply)
python roster_manage.py stale --days 90 --apply
```

## Scout / Up-and-Coming Lane

The scout lane is for discovered candidates who haven't been fully vetted yet.

### Discovery Flow

1. **Run discovery**: `python discover_traders.py --max-new 12`
   - Scans sports leaderboards (ALL/MONTH/WEEK windows)
   - Screens closed+open positions for honest hold-ROI
   - Writes `pnl_analysis/output/discovered_candidates.json`

2. **Review candidates**: `python roster_manage.py scout --max-new 10`
   - Shows recommended candidates with screen scores
   - Each candidate has a one-line `why_tail` reason

3. **Add to roster**: `python roster_manage.py scout --write`
   - Adds candidates as `scout` status
   - They get refreshed but don't go to live alerts

4. **After full pipeline run**: Review scout books in insider_ranks
   - Check `quality_score`, `win_rate`, `median_stake`, `recency_band`
   - Scouts auto-promote to `watch` on next pipeline if books validate

### Scout Screening Criteria

Candidates must pass:
- Sample hold-ROI >= 3% (closed + open resolved, not winner-only)
- Sample resolved events >= 12
- Closed-only bias < 25 (winner-sorted samples collapse when losers added)
- Screen score >= 25 (recency + PnL magnitude + hold-ROI)
- Win rate < 94% (grinders don't count)

### Promotion to Live

To promote a scout or watch to `take_book`:

```bash
python roster_manage.py promote 0x1234... --reason "Passed elite gates: Q=67, sport ROI=+12%"
```

Promotion is blocked unless the trader passes elite gates:
- Win rate 48–75%
- Median stake < $15k (joinable)
- Closed events >= 40
- Quality score >= 60 (if available)
- Recency not DROP or DARK

Use `--force` to override (e.g., for HVAB-class Path-B specialists):

```bash
python roster_manage.py promote 0x1234... --reason "HVAB-class specialist exception" --force
```

## Adding a Trader

```bash
python roster_manage.py add <wallet> <username> [options]
```

Options:
- `--status`: Initial status (default: `watch`)
- `--why`: One-line reason for tailing this trader (required for good practice)
- `--source`: Discovery source (default: `manual`)
- `--notes`: Additional notes

Example:

```bash
python roster_manage.py add \
  0x1234567890abcdef1234567890abcdef12345678 \
  "SharpTrader99" \
  --why "Strong equity curve +$500k, 55% WR on 300 events, median $2k joinable" \
  --source "manual_discovery"
```

## Kicking a Trader

Kicking requires a reason. This is intentional — we want an audit trail.

```bash
python roster_manage.py kick <wallet> --reason "<reason>"
```

Common reasons:
- "Collapsed to -ROI after loser-side fetch"
- "Dashboard PnL was 10k winner-cap fake"
- "Market maker fills, not copyable"
- "Grinder: 97% WR on moneylines, $0.01 edge"

Example:

```bash
python roster_manage.py kick \
  0xfake123... \
  --reason "PolyPnL -$1.14M / 52.8% WR. Old +$52M/73% was winner-sorted closed book."
```

## Listing the Roster

```bash
# All statuses
python roster_manage.py list

# Specific status
python roster_manage.py list --status live
python roster_manage.py list --status benched

# Verbose (show why_tail reasons)
python roster_manage.py list --status watch -v
```

## Extra Traders JSON Schema

The `extra_traders.json` file uses this schema:

```json
{
  "wallet": "0x...",
  "username": "TraderName",
  "source": "sports_leaderboard|polydata_smart_score|manual",
  "status": "take_book|watch|scout|benched|kicked|removed",
  "why_tail": "One-line reason for tailing this trader",
  "notes": "Additional notes (reason for kick, bench, etc.)",
  "add_date": "2026-08-18",
  "updated_at": "2026-08-18T12:00:00+00:00",
  "kick_date": "2026-08-18",
  "bench_date": "2026-08-18",
  "bench_reason": "No prints since 2026-05-01",
  "promote_date": "2026-08-18",
  "promote_reason": "Passed elite gates: Q>=60",
  "history": [
    {"action": "add", "timestamp": "...", "reason": "..."},
    {"action": "bench", "old_status": "watch", "timestamp": "...", "reason": "..."}
  ]
}
```

## Integration with Existing Pipeline

The roster management integrates with the existing pipeline:

1. **Daily pipeline** (`npm run daily-pipeline`):
   - Runs `copy_roster.py` which reads `extra_traders.json`
   - Builds `copy_universe.json` with live/bench/watch/scout buckets
   - Only refreshes traders in those buckets (saves API budget)

2. **Insider ranks** (`build_insider_ranks.py`):
   - Reads `extra_traders.json` for status/notes
   - Carries kicked/benched status into the product lane

3. **Telegram alerts** (`telegramTakeAlerts.ts`):
   - Uses `copy_universe.json` live bucket
   - Only fires for HOT/WARM recency, joinable books

## Unchanged Behavior

The following are **not changed** by this roster management:

- **Unique winner+loser+open books as truth**: PnL comes from our CSVs, never from winner-sorted 10k caps
- **Sniper gates**: Elite qualification gates unchanged
- **Path-B specialist exception**: HVAB-class books can be promoted with `--force`
- **Vigilant-Environment/sentrio/Mysaria**: Stay not-live (reference only)
- **No PMA as live source**: Polymarket API is reference, not product PnL
- **MM/grinder kills**: Win rate >= 94% is still a grinder kill, no loosening

## Troubleshooting

**Q: I added a trader but they're not showing in copy_universe.json**

A: Run the roster rebuild: `python copy_roster.py`. The trader needs to be in `insider_ranks.json` first, which means running `build_insider_ranks.py` after fetching their book.

**Q: A scout isn't getting promoted automatically**

A: Scouts don't auto-promote to live. They promote to `watch` if their books validate. To move to `take_book` (live), use `roster_manage.py promote` which checks elite gates.

**Q: How do I see the full history of a trader?**

A: Check `extra_traders.json` directly. The `history` array tracks all status changes with timestamps and reasons.

**Q: A trader was auto-benched but I want them back**

A: Use `roster_manage.py add` with the desired status:

```bash
python roster_manage.py add 0x1234... "TraderName" --status watch --why "Back from hiatus, Q4 2026"
```
