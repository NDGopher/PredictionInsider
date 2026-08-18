# Polydata 80+ / 90+ vs our books

As of **2026-08-18**. Polydata Smart Score 80–100 is their Elite band; 90+ is the top of that band. Sports rank comes from each profile’s category strip.

## 90+ Smart Score (any category)

| Trader | SS | WR | PnL | Sports # | Sports PnL | Our WR | Our PnL | Book |
|--------|---:|---:|----:|---------:|-----------:|-------:|--------:|------|
| [fengdubiying](https://polydata.pro/traders/fengdubiying) | 98 | 76.0% | +$3,035,821 | 563 | +$168,080 | 71.4% | +$3,033,760 | 97 closed |
| [0x5966Db1fE50763C9e3C014d756369BAd07E1F804](https://polydata.pro/traders/0x5966Db1fE50763C9e3C014d756369BAd07E1F804) | 94 | 62.0% | +$3,582,415 | 36 | +$2,665,879 | 58.2% | +$3,458,340 | 123 closed |
| [0x8a3aB8120807bD64a3De48695110e390fa2ceB9a](https://polydata.pro/traders/0x8a3aB8120807bD64a3De48695110e390fa2ceB9a) | 90 | 58.0% | +$681,089 | 172 | +$697,837 | 54.0% | +$674,530 | 423 closed |
| [Michie](https://polydata.pro/traders/Michie) | 90 | 77.0% | +$3,095,008 | — | — | — | — | missing |
| [Theo4](https://polydata.pro/traders/Theo4) | 90 | 86.0% | +$22,053,934 | — | — | — | — | missing |

## 80+ Smart Score with a sports book

| Trader | SS | PD WR | PD sports PnL | Sports # | Our WR | Our PnL | WR match | PnL match | Copy candidate |
|--------|---:|------:|--------------:|---------:|-------:|--------:|:---------|:----------|:---------------|
| [fengdubiying](https://polydata.pro/traders/fengdubiying) | 98 | 76.0% | +$168,080 | 563 | 71.4% | +$3,033,760 | yes | aligned | yes |
| [0x5966Db1fE50763C9e3C014d756369BAd07E1F804](https://polydata.pro/traders/0x5966Db1fE50763C9e3C014d756369BAd07E1F804) | 94 | 62.0% | +$2,665,879 | 36 | 58.2% | +$3,458,340 | yes | aligned | yes |
| [0x8a3aB8120807bD64a3De48695110e390fa2ceB9a](https://polydata.pro/traders/0x8a3aB8120807bD64a3De48695110e390fa2ceB9a) | 90 | 58.0% | +$697,837 | 172 | 54.0% | +$674,530 | yes | aligned | yes |
| [KeyTransporter](https://polydata.pro/traders/KeyTransporter) | 89 | 71.0% | +$5,711,460 | 11 | 76.9% | +$5,711,460 | yes | aligned | yes |
| [Vetch](https://polydata.pro/traders/Vetch) | 85 | 61.0% | +$195,476 | 494 | 60.9% | +$321,367 | yes | aligned | yes |
| [asparagus2012](https://polydata.pro/traders/asparagus2012) | 83 | 63.0% | +$3,562,640 | 28 | 68.8% | +$3,547,038 | yes | aligned | yes |
| [Supah9ga](https://polydata.pro/traders/Supah9ga) | 82 | 53.0% | +$1,946,119 | 56 | 52.2% | +$2,001,694 | yes | aligned | yes |
| [Capman](https://polydata.pro/traders/Capman) | 80 | 54.0% | +$263,421 | 379 | 55.3% | +$295,027 | yes | aligned | yes |

## What “full book” means here

- Polydata WR is event-level on their trade tape. Ours is PA-style market win rate on the CSV.
- Polymarket analytics PnL ≈ sum(closed `realizedPnl`) + open `cashPnl`. That is our `dashboard_pnl`.
- Mega-whales (RN1, swisstony) have tens of thousands of markets; `/closed-positions` caps at 10k per sort. Those books stay **untrusted for copy** until we can ingest the whole tape.
- Trusted copy candidates: sports 80+ (or aligned 70+ sports specialists), WR within 6pp of Polydata, same-sign PnL within 35% or $75k, not winner-capped, not a 94%+ grinder.

**Proud copy list (12, n≥40, WR/PnL matched, sports specialists):** 0x5966Db1fE50763C9e3C014d756369BAd07E1F804, 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a, Vetch, Supah9ga, Capman, HedgeMaster88, DLEK, WTSA, ckw, Bienville, tcp2, kch123

Dropped from copy even when Smart Score is 80+: fengdubiying (sports is 5% of PnL), KeyTransporter (11 closed), asparagus2012 (15 closed), Theo4/Michie (not sports), RN1/swisstony (10k/sort cap — book unfinished), Ghost (lifetime negative).

**Proud copy list (12, n≥40, WR/PnL matched, sports specialists):** 0x5966Db1fE50763C9e3C014d756369BAd07E1F804, 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a, Vetch, Supah9ga, Capman, HedgeMaster88, DLEK, WTSA, ckw, Bienville, tcp2, kch123

Dropped from copy even when Smart Score is 80+: fengdubiying (sports is 5% of PnL), KeyTransporter (11 closed), asparagus2012 (15 closed), Theo4/Michie (not sports), RN1/swisstony (10k/sort cap — book unfinished), Ghost (lifetime negative).

