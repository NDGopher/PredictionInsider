# Recommended plays to take

As of **2026-08-18**.

**Current take list:** see [`FULL_BOOK_STRATEGIES.md`](./FULL_BOOK_STRATEGIES.md). Copy is single-name **as-of** (prior Q ≥ 60, sport expert, ≥2× own median, no NFL) on 12 Polydata-matched sports books. Fill VWAP + 2¢, hold to resolution. Copy-all of those 12 is **−6.1%** after 2¢ — do not unfilter.

The 98% Ghost 2+ book below is a data bug. Do not take it.

## Stop: the 98% Ghost book was a data bug

You were right not to believe it.

Same wallet as Polydata / PolyPnL / Polymarket: [`0x0346afae2603313d2bbee96b628536c8cbe352a5`](https://polymarket.com/@GoalLineGhost) · [PolyPnL](https://polypnl.kaeose.me/profile/0x0346afae2603313d2bbee96b628536c8cbe352a5).

| Source | Ghost PnL | Ghost WR | Notes |
|--------|-----------|----------|-------|
| [PolyPnL](https://polypnl.kaeose.me/profile/0x0346afae2603313d2bbee96b628536c8cbe352a5) | **−$1.14M** | **52.8%** (1925/3648 sports, 30d) | ~$87M 30d volume; ~$247M lifetime volume |
| [Polydata all-time board](https://polydata.pro/traders) | not in top 50 | Smart Score ~67 on some trackers | RN1 is #4 at **+$12.8M**; kch123 #5 at **+$11.4M** |
| Polymarket sports leaderboard | rank 15, **+$33,896** | — | API `window` day/week/month/all returned the same page |
| Polymarket `/value` | portfolio **$22,556** | — | live API this run |
| **Our CSV before fix** | **+$52.0M** | **71.4%** | 10,000 closed rows, 10,005 with `realizedPnl>0` |
| **Our CSV after loser-side fetch** | **−$1.16M** | **50.4% / 52.3%** | matches PolyPnL |

Root cause: `GET /closed-positions` defaults to **REALIZEDPNL DESC**. We stored the 10,000 biggest winners and never pulled `REALIZEDPNL ASC` (starts at −$1.31M / −$1.12M USA/Germany tickets). Ghost 2+ “98% WR” was Ghost appearing only on those winning tokens.

ferrari had the same 10k closed cap: **+$56.6M → −$6.5M** after the loser fetch. Sports LB still shows them rank 8 (~+$68k) — a different, shorter window. Do not copy either book as a 14–70% ROI tail.

## What to actually follow

Copy-all of every tailable wallet remains **−1.5%**. There is **no** 98% moneyline list to take until we rebuild the 2+ tape on dual-sorted closed books.

**Lifetime PnL (Polydata overall, all-time)** — who actually made money:

| Rank | Trader | Lifetime PnL | Smart Score | Our status |
|-----:|--------|-------------:|------------:|------------|
| 4 | **RN1** | +$12.8M | 75 | Tracked. CSV WR ~47% (honest depth). Mute NFL. HOT. |
| 5 | **kch123** | +$11.4M | 59 | Tracked. CSV WR ~52% matches public. **DARK** for live tail (quiet since ~Jul 1) — weight 0, do not drop the name from history. |
| — | GoalLineGhost | ~−$1.1M | ~67 | Sports LB HOT rank 15 (+$34k) but lifetime negative / 52% WR / heavy two-sided hedges. Not a copy-sharp. |
| — | ferrariChampions2026 | sports LB +$68k | — | Rank 8 on sports LB now; repaired dashboard **−$6.5M**. Flow only, not a 14% ROI expert. |

**Sports leaderboard right now** (Polymarket, sticky window): 0x2c3350 +$186k, 0xE30E +$131k, RWCS +$102k, wr0ngw4yb3tt0r +$100k, HomeRunHazard +$99k, ferrari +$69k, Ghost +$34k. Several of those we already **KICK** for grind/negative hold-to-res. Being #1 on today’s sports PnL is not the same as a joinable copy edge.

**Expert lanes (after Ghost repair)** — soccer still prints on *event* ROI, but Ghost’s hedge book lost **−$4.7M**. Treat soccer/other as *their* inventory, not a $100 copy:

| Lane | n | WR | Event ROI | Copy? |
|------|--:|---:|----------:|-------|
| Ghost soccer (other) | 4750 | 52.5% | +18.0% | No — two-sided / hedge-heavy |
| Ghost soccer UCL | 394 | 55.9% | +21.3% | No until 2+ rebuild |
| Ghost moneyline | 2270 | **48.6%** | +10.8% | WR matches public ~53%, not 98% |
| RN1 (Polydata #4) | 46k mkts | ~47% | +19% on our older CSV | Best *lifetime* name we already track; mute NFL |

## Fluid roster

| Band | Days quiet | Live weight |
|------|-----------:|------------:|
| HOT | 0–7 | 1.00 |
| WARM | 8–14 | 0.70 |
| COLD | 15–21 | 0.35 |
| DARK | 22–45 | 0.00 (mute 2+) |
| DROP | 45+ | SIGNAL_KICK |

Discovery already scans sports ALL/MONTH/WEEK. This run: 9 new names passed PnL/vol; **0** passed honest closed+open hold-ROI (Penisya, Kulilun, bigoon, …). They stay off `DISCOVERED_ELITES` until a full unique book grades.

Pipeline fix: closed fetch now pulls **winners + losers + recent** (`REALIZEDPNL DESC/ASC` + `TIMESTAMP DESC`). Re-run `npm run backtest:consensus` only after more 10k-capped CSVs are repaired.

## Do not take

- Ghost 2+ / Ghost+ferrari / Ghost+RN1 **98%** books (artifact).
- Unfiltered copy-all (−1.5%).
- Grade &lt;60.
- Cannae as a 2+ voter.
- 94% WR grinders, $30k+ median wallets, quitters.
