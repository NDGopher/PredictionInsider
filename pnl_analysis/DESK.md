# Copy desk

The desk is `/desk` plus `/api/desk`. It is an OddsJam-style board, not only a TAKE strip:

1. **TOP / TAKE** — live copy tickets that pass the take rule (Q≥60, sport ROI, size, 10–88¢, no NFL). Empty TAKE stays honest.
2. **ALL PLAYS RANKED** — every open book/play from the universe, ranked by edge / Q / size / sport ROI / fillability, with English names and why-this-rank.
3. **30d would-have + promote reasons + equity** — unchanged.

It does not invent fills or PnL. Postgres is the tape.

Discovery is automatic. The operator does not add/remove traders by hand. `add-username` remains an escape hatch.

## Ingest architecture

```
auto_discover (sports/all LB + Gamma public-search + activity/trades heat)
    → resolve username → proxy trading wallet (never a CSV filename / random EOA)
    → recommended scouts (unresolved stay blocked — never fake 0-0)
    → live_ingest → Postgres desk_fills
    → desk_unique_books (BUY VWAP + market resolution / REDEEM)
    → would_have_30d + copy_roster + auto_promote gates
      (scout → watch → take_book / bench)
    → /api/desk  (TAKE strip + ranked all-plays)
```

**Source of truth is Postgres**, not `pnl_analysis/output/*.csv`. Those CSVs are leftover exports and are not the live book.

### Schema (Drizzle: `shared/deskSchema.ts`, SQL: `scripts/init-db.sql`)

| Table | Key / indexes | Role |
|-------|----------------|------|
| `desk_fills` | PK `(wallet, event_timestamp, condition_id, side, price, size, transaction_hash)`. Indexes: wallet, wallet+ts, ts, condition_id, username, slug, market_id | Raw activity/trades fills |
| `desk_wallets` | PK `username`. Indexes: wallet, resolved | Proxy wallet resolution; unresolved names stay flagged |
| `desk_ingest_cursors` | PK `wallet` | Last-seen unix timestamp — incremental, not a full re-download |
| `desk_markets` | PK `condition_id` | Resolution / end date (not a trader tape) |
| `desk_unique_books` | PK `(wallet, condition_id, outcome)`. Indexes: wallet, wallet+end, username, end, resolved | Fast would-have / promote |
| `desk_ingest_runs` | serial | Health / last run for the frontend |

### Refresh cadence

- **Desk load** (`GET /api/desk`): if the last kick is older than `PI_DESK_REFRESH_MINUTES` (default **15**), spawn auto-discover + incremental ingest in the background. The request itself queries Postgres/JSON and returns in seconds.
- **Loop**: `startDeskIngestLoop()` on server boot, same 15-minute interval.
- **Manual**: `POST /api/desk/refresh` or `npm run desk:refresh`.
- After ingest: `would_have_30d.py` then `copy_roster.py` then `auto_promote.py` on the **fresh** unique books.

### Auto discovery (no UI chore)

`pnl_analysis/auto_discover.py` continuously pulls:

- Polymarket sports / all leaderboards (all / month / week)
- Gamma `public-search` profiles (`proxyWallet`)
- Recent `/trades` activity heat

Each handle is resolved to the **proxy trading wallet**. Unresolved names are written to `desk_wallets` with `resolved=false` and shown as blocked — never a silent 0–0 book. Vetted names become **scout**; existing `auto_promote.py` gates move scout → watch → take_book / bench.

`add-username` is still there if you need to force a handle. The desk should fill itself.

### How wallets are resolved

1. Already a `0x` + 40 hex (or `0x…-timestamp` profile slug) → that address.
2. `extra_traders.json` / curated roster / known desk labels (`HVAB`, `20D6`, `8a3a`).
3. Gamma `public-search?search_profiles=true` → `proxyWallet`.
4. Sports / all-time leaderboard username match.

If none hit, the name is written to `desk_wallets` with `resolved=false` and shown on the desk as **blocked — unresolved**. That is why 8a3a / HVAB used to disappear: there was no CSV filename, so they were silently missing. They are no longer silent.

### Add a trader by username

```bash
# Resolve HVAB → proxy wallet, incremental ingest, add as watch
python pnl_analysis/roster_manage.py add-username HVAB
# or
python pnl_analysis/live_ingest.py --add HVAB
# or
npm run roster:add-username -- HVAB --status watch
```

Then `npm run desk:refresh` (or wait ≤15 minutes) so would-have + promote re-run.

## Promote / demote

`python pnl_analysis/auto_promote.py` (or `npm run roster:auto`, or `roster_manage.py auto`) applies status changes to `extra_traders.json` and rebuilds `copy_universe.json`. Gates are unchanged. Unique-book ROI / last-30 / equity now overlay from Postgres when the tape has rows.

**Promote** scout/watch/bench → `take_book` when all of these hold:

1. Joinable: WR 48–75 **or** Path-B specialist (walk-forward Elite, WR 75–85, unique ROI ≥10%, median &lt; $15k).
2. Recency HOT or WARM.
3. Not Vigilant-Environment / sentrio / Mysaria, not a 100k-fill MM, not a take-rule bleed bench.
4. Either unique-book ROI ≥5% and ≥8 settled prints in 30d, **or** equity regime `turnaround`/`hot` with last-30d ROI ≥8% and n≥30.
5. If the take-slice has n≥12, take ROI must be ≥0 (Path-B is the only exception).

**Scout → watch** when a unique book exists (closed ≥40, WR in band, not a 94%+ grinder) but live gates are not met yet.

**Demote** `take_book` → watch when take-slice n≥12 and ROI ≤ −10%, or last 60d **and** 90d take-slices are both negative (n≥15 each).

**Bench** at 90 days with no joinable prints. Empty TAKE because a book went cold is honest.

## How to read the 30d would-have table

| Column | Meaning |
|--------|---------|
| n | Tickets the **live take rule** would have taken whose events **resolved** in the last 30 **wall-clock** days |
| WR / ROI +2¢ / PnL | Flat $100, fill = their VWAP + 2¢, hold to resolution |
| Equity | Cumulative unit PnL in date order |
| Blocked | Unresolved wallet or no take-rule prints — **not** a 0–0 result |

This is *would have*, not *did fill*. A live CLOB ask can still reject a ticket that passed as-of gates.

## TAKE / NEAR / SKIP

- **TAKE** — Q≥60, as-of sport ROI ≥+5%, stake ≥2× own median, 10–88¢, not NFL, not futures, live ask still inside VWAP+2¢.
- **NEAR** — matched book, missing one or two of those gates.
- **SKIP** — three or more misses, futures, or NFL.

If TAKE is 0, that is a diagnose of the **rule**, not a dead UI.

## Run /desk (no hosted URL)

```bash
cp .env.example .env
npm run db:up && npm run db:init   # Postgres 16 on :5433
npm install
npm run ingest:live                # first incremental pull
npm run desk:refresh               # would-have + promote on that tape
npm run dev                        # http://127.0.0.1:5000/desk
```

Production start (after `npm run build`):

```bash
NODE_ENV=production PORT=5000 npm run start:desk
```

There is no Vercel config in this repo. Screenshot the local `/desk` after boot.

## Still blocked

- PTA (`PolymarketTraderAnalyst`) is paused and was not touched.
- SharpMoney is a separate live MM and was not changed.
- Empty TAKE is honest when the live rule has no fillable ticket.

## Unchanged

- Unique winner+loser+open books are truth (now materialized in Postgres, not CSVs).
- Sniper gates unchanged.
- No unsupervised auto-bet.
- Grinder kill (WR ≥94%) is not loosened.
- `auto_promote.py` gate functions are the same tests as PR #8.
