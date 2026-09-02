# Copy desk

The desk is `/desk` plus `/api/desk`. It shows **now** (TAKE / NEAR / SKIP) next to the **last 30 days the same rule would have taken**. It does not invent fills or PnL.

## Promote / demote

`python pnl_analysis/auto_promote.py` (or `npm run roster:auto`, or `roster_manage.py auto`) applies status changes to `extra_traders.json` and rebuilds `copy_universe.json`.

**Promote** scout/watch/bench → `take_book` when all of these hold:

1. Joinable: WR 48–75 **or** Path-B specialist (walk-forward Elite, WR 75–85, unique ROI ≥10%, median &lt; $15k).
2. Recency HOT or WARM.
3. Not Vigilant-Environment / sentrio / Mysaria, not a 100k-fill MM, not a take-rule bleed bench.
4. Either unique-book ROI ≥5% and ≥8 settled prints in 30d, **or** equity regime `turnaround`/`hot` with last-30d ROI ≥8% and n≥30.
5. If the take-slice has n≥12, take ROI must be ≥0 (Path-B is the only exception).

**Scout → watch** when a unique book exists (closed ≥40, WR in band, not a 94%+ grinder) but live gates are not met yet.

**Demote** `take_book` → watch when take-slice n≥12 and ROI ≤ −10%, or last 60d **and** 90d take-slices are both negative (n≥15 each) — the same bar `take_book_daily.py` used to *propose*.

**Bench** at 90 days with no joinable prints. Empty TAKE because a book went cold is honest.

Reasons are stored on the extra-trader row (`auto_promote_reason`, `auto_demote_reason`, `history`) and shown on the desk.

## How to read the 30d would-have table

| Column | Meaning |
|--------|---------|
| n | Tickets the **live take rule** would have taken whose events **resolved** in the last 30 days |
| WR / ROI +2¢ / PnL | Flat $100, fill = their VWAP + 2¢, hold to resolution |
| Equity | Cumulative unit PnL in date order |
| Blocked | No CSV or no take-rule prints — **not** a 0–0 result |

Source: `asof_fullbook_plays.csv` if present, otherwise `collect_plays` from trader CSVs already on disk. Rebuild: `npm run backtest:would-have` or `npm run backtest:asof`.

This is *would have*, not *did fill*. A live CLOB ask can still reject a ticket that passed as-of gates.

## TAKE / NEAR / SKIP

- **TAKE** — Q≥60, as-of sport ROI ≥+5%, stake ≥2× own median, 10–88¢, not NFL, not futures, live ask still inside VWAP+2¢.
- **NEAR** — matched book, missing one or two of those gates.
- **SKIP** — three or more misses, futures, or NFL.

If TAKE is 0, that is a diagnose of the **rule**, not a dead UI. The open-book scan (`take_health.json`) is now wired into `csvOpen.live` (it was hardcoded empty).

## Still blocked

- PTA (`PolymarketTraderAnalyst`) is paused and was not touched.
- SharpMoney is a separate live MM and was not changed.
- HVAB Path-B uses the walk-forward elite snapshot (last event 2026-08-21). A fresh unique-book ingest is still required before we treat HVAB take-slice PnL as current.
- 30d would-have on this checkout is the last 30 days of **resolved tape** (as-of **2026-04-13**), not wall-clock September 2026. CSVs here do not contain later take-rule prints. `take_health.json` (2026-08-18 digest, n=32 / +14.7%) is a different plays CSV that is not in git.

## Unchanged

- Unique winner+loser+open books are truth.
- Sniper gates unchanged.
- No unsupervised auto-bet.
- Grinder kill (WR ≥94%) is not loosened.
