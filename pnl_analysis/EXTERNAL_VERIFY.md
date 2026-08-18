# Public vs our numbers — trader rank audit

As of **2026-08-18**.

## You were right to distrust the 98% / +$52M Ghost book

Same wallet: `0x0346afae2603313d2bbee96b628536c8cbe352a5` ([Polymarket](https://polymarket.com/@GoalLineGhost), [PolyPnL](https://polypnl.kaeose.me/profile/0x0346afae2603313d2bbee96b628536c8cbe352a5)).

Polymarket `GET /closed-positions` **defaults to biggest realized winners first**. We capped at 200 pages × 50 = **10,000 closed rows**. Ghost’s CSV was 10,000 closed and 10,005 `realizedPnl > 0`. The first five closed rows are the same $927k / $667k World Cup tickets the API returns for `REALIZEDPNL DESC`. `REALIZEDPNL ASC` starts at **−$1.31M / −$1.12M** on other USA/Germany tickets we never stored.

That win-sorted tape is also why a Ghost 2+ moneyline book printed **98% WR**: Ghost only appeared on sides we had ingested — mostly the winners.

## Public tape (not our CSV)

| Source | Ghost | RN1 | ferrari | kch123 |
|--------|-------|-----|---------|--------|
| PolyPnL / Polydata lifetime | **−$1.14M**, 52.8% WR (1925/3648 sports 30d), ~$87M 30d vol | **+$12.8M** all-time #4, Smart Score 75 | sports LB ~+$68k | **+$11.4M** all-time #5, Smart Score 59 |
| Polymarket `/value` (this run) | see table below | see table | see table | see table |
| Polymarket sports leaderboard (API window param is sticky — day/week/month/all returned the same 200) | rank 15, **+$33,896** | not in top 15 sports | rank 8, **+$68,507** | not on this sports page |

Polydata all-time PnL board (overall, not sports-only): swisstony +$23.5M, Theo4 +$22.1M, Fredi9999 +$16.6M, **RN1 +$12.8M**, **kch123 +$11.4M**. Ghost is **not** on that top 50 — consistent with a small or negative lifetime.

## Our CSV before / after loser-side fetch

| Trader | Before closed | Before WR | Before dash PnL | After closed | After WR | After dash PnL | Portfolio `/value` |
|--------|--------------:|----------:|----------------:|-------------:|---------:|---------------:|-------------------:|
| GoalLineGhost | 10000 | 71.41% | $51,997,353 | 20142 | 50.35% | $-1,159,220 | $22,556 |
| ferrariChampions2026 | 10000 | 41.29% | $56,557,114 | 20612 | 38.07% | $-6,492,884 | $180,689 |

## Live sports leaderboard (join these names, then weight by recency)

Official Polymarket sports PnL. Use this as the **who is printing now** list. Do not copy $200M volume books at $100/play.

| Rank | Trader | Sports PnL | Volume | Tracked? |
|-----:|--------|-----------:|-------:|----------|
| 1 | 0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563-1759935795465 | $185,758 | $861,506 | yes (0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563) |
| 2 | 0xE30E74595517de48f1FB19f4553dd3d9F1E96B87-1772612985000 | $130,589 | $431,148 | yes (0xE30E74595517de48f1FB19f4553dd3d9F1E96B87) |
| 3 | RWCS | $102,267 | $0 | **new** |
| 4 | AvrahamEisenberg - 10161 | $100,287 | $0 | **new** |
| 5 | wr0ngw4yb3tt0r | $100,231 | $231,132 | yes (wr0ngw4yb3tt0r) |
| 6 | HomeRunHazard | $98,709 | $1,252,525 | yes (HomeRunHazard) |
| 7 | 0xa8cf2ed8 | $85,547 | $0 | **new** |
| 8 | ferrariChampions2026 | $68,507 | $2,177,732 | yes (ferrariChampions2026) |
| 9 | SDTrading | $51,571 | $0 | **new** |
| 10 | Poyo | $50,767 | $0 | **new** |
| 11 | quavoo | $48,867 | $225,734 | yes (quavoo) |
| 12 | Penisya | $46,341 | $181,144 | **new** |
| 13 | monkeymashingkeyboard | $39,069 | $19,193 | **new** |
| 14 | Kulilun | $36,200 | $23,022 | **new** |
| 15 | GoalLineGhost | $33,896 | $419,102 | yes (GoalLineGhost) |
| 16 | winwin518168 | $32,100 | $0 | **new** |
| 17 | MonsieurDimanche | $29,727 | $0 | **new** |
| 18 | bigoon | $29,316 | $106,570 | **new** |
| 19 | kingflop | $28,954 | $16,480 | **new** |
| 20 | jarosbill | $28,482 | $78,549 | **new** |
| 21 | 0x0f35109c | $27,255 | $0 | **new** |
| 22 | alaskabaked | $27,079 | $85,786 | **new** |
| 23 | 0xwise | $26,681 | $46,456 | yes (0xwise) |
| 24 | sentrio | $25,877 | $85,406 | **new** |
| 25 | texaskid | $25,598 | $5,055 | **new** |

## Fluid roster rule

| Band | Days since last dated event | Live weight |
|------|----------------------------:|------------:|
| HOT | 0–7 | 1.00 |
| WARM | 8–14 | 0.70 |
| COLD | 15–21 | 0.35 (keep on roster, down-weight) |
| DARK | 22–45 | 0.00 (mute from 2+) |
| DROP | 45+ | remove / SIGNAL_KICK |

Discovery: `npm run discover:traders` scans sports ALL/MONTH/WEEK, screens closed+open, and writes `extra_traders.json` for names that pass hold-ROI and joinability.

## How to read win rate

- **Polydata / PolyPnL WR** = markets or trades they touched, including scalps and both sides.
- **Our hold-to-res WR** = each token we stored, won iff `curPrice ≥ 0.99`. Useless if the store is winner-sorted.
- **Copy WR at $100** is a third number: only joinable, live-priced, 2+ directional tickets. It will never match a whale’s 796k-trade 52% WR.

