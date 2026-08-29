# Elite automation roadmap

Goal: **always-on** wallet discovery → book fetch → grade/backtest → play board → promote/kick → alert — with no manual cron.

## What is always-on now (with `npm run dev`)

| Loop | Cadence | What it does |
|------|---------|----------------|
| Signals / take-plays / ticket lifecycle | 30–60s | Live asks, paper fills, kickoff/settle |
| Hot wallet discover | **10m** | Top markets → Z≥2 → light Q → watch enqueue → CSV+**ingest** → after-hot ranked refresh |
| Elite micro tick | **15m** | `scan_ranked_opens` + `take_book_daily` (board + pause switch) |
| Elite promote tick | **45m** | adaptive lab → `auto_promote` → copy roster → ranked + health |
| Smart full pipeline | **hourly check** | Runs incremental ingest + `refresh_product` when last ingest > `PI_SMART_REFRESH_HOURS` (default 6h) |
| Telegram TAKE tape | continuous | Pins/updates when Sniper TAKE gates clear |

APIs:
- `GET/POST /api/hot-wallet-discover`
- `GET/POST /api/elite-continuous` (`mode`: `micro` \| `promote` \| `after-hot` \| `full-lite`)

Manual:
```bash
npm run model:hot-discover
npm run model:elite-micro
npm run model:elite-promote
```

## Closed loop (how elite stays elite)

```
hot markets (10m)
    → Z-score / unusual tags
    → light Q (alerts only)
    → watch enqueue (sports vs politics lanes)
    → first CSV + ingest
    → after-hot: roster + ranked board
    → promote tick (45m): take-rule proof → take_book / demote bleed
    → micro tick (15m): regrade opens + health pause
    → take-plays (30s): Telegram when TAKE appears
```

Cold/stale books are **never** the discovery path. Full roster refresh is the 6h smart pipeline only.

## Recommended next phases (ordered)

### Phase A — Harden the closed loop (next 1–2 PRs)
1. **Entry-time as-of backtest** — snap features at first-fill timestamp, not `endDate−1d` (`asof_fullbook_backtest.py`). Removes mild feature look-ahead; makes Sniper grades more honest.
2. **Auto-kick hot watches** that fail take-rule / light Q after first CSV (status → `kicked` with reason). Keeps watch list from filling with Z-noise.
3. **Health Telegram** on promote/demote and on take-health PAUSE — ops without staring at the UI.
4. **Explorer lane (labeled)** — optional lower bar (`asof_q60_sub_rel2`) separate from Sniper TAKE so the board is never empty while Sniper stays strict.

### Phase B — Sizing & execution quality
5. **Bet sizing + slippage %** on TAKE cards (OddsJam-style bankroll fraction from `take_book_bankroll.py`).
6. **Fill realism** — VWAP+2¢ already; add depth/liquidity gate so thin books never become TAKE.
7. **Paper → live handoff checklist** when Telegram is configured (size, max slip, cancel-if-not-filled).

### Phase C — Coverage & moat
8. **Sports-heavy market radar** — bias hot discover events toward live/upcoming sports so politics Z-noise does not dominate enqueue budget.
9. **Consensus / multi-wallet plays** — grade opens where 2+ high-Q watches agree (lab already has pieces).
10. **Walk-forward dashboard** — surface `walkforward_tail_backtest` + take-health windows on `/insiders` so “elite” is always evidenced by real ROI, not vibes.

### Phase D — Ops polish
11. **Environment** — Postgres ingest always on locally (`db:up` + `db:init`); golden rule stays DB for ROI.
12. **Single status page** — wire `/api/elite-continuous` into Discover tab “Automation heartbeat” (last hot / micro / promote / pipeline).
13. **Bump signals cache** whenever scoring logic changes (`signals-elite-v59-…`).

## What not to do
- Do not run full `run_full_pipeline` on every hot Z-hit.
- Do not auto-live from Polydata PnL/vol alone — unique book + take-rule still required.
- Do not mix politics futures into the Sports Sniper board (lane tabs stay).

## Success metrics
- Hot watches added weekly without manual `extra_traders` edits
- Ranked board age &lt; 20 minutes while server is up
- Promote/demote log shows activity without human pushes
- Sniper TAKE alerts fire when gates clear; empty TAKE book is OK
- 30d take-health ROI stays the north star (DB / as-of CSV — never live API PnL)
