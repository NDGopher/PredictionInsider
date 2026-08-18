# Full-book strategies (hold-to-resolution)

Polydata 80+/90+ sports books whose **WR and PnL match** Polydata (and therefore Polymarket analytics: `realizedPnl + cashPnl`) are the only names in this tape. Copy is **hold to resolution**, not scalp PnL. Q / sport / submarket / relative size are **as-of**: only markets that had already resolved at least one day earlier.

## Polydata Elite sports vs our score

| SS | Sports # | Trader | PD WR | Our WR | PD PnL | Our PnL | n closed |
|---:|---------:|--------|------:|-------:|-------:|--------:|---------:|
| 94 | 36 | 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | 62.0% | 58.24% | $3,582,415 | $3,458,340 | 123 |
| 90 | 172 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | 58.0% | 54.01% | $681,089 | $674,530 | 423 |
| 85 | 494 | Vetch | 61.0% | 60.87% | $321,721 | $321,367 | 694 |
| 82 | 56 | Supah9ga | 53.0% | 52.23% | $2,010,190 | $2,001,694 | 659 |
| 80 | 379 | Capman | 54.0% | 55.3% | $266,957 | $295,027 | 15806 |
| 75 | 134 | HedgeMaster88 | 53.0% | 53.39% | $931,923 | $931,923 | 137 |
| 71 | 74 | DLEK | 55.0% | 55.62% | $1,568,905 | $1,434,196 | 1165 |
| 64 | 98 | WTSA | 55.0% | 54.2% | $1,220,433 | $1,154,833 | 71 |
| 64 | 152 | ckw | 56.0% | 54.93% | $820,583 | $839,272 | 2533 |
| 62 | 234 | Bienville | 52.0% | 50.15% | $405,447 | $391,645 | 2404 |
| 60 | 220 | tcp2 | 55.0% | 49.99% | $537,191 | $585,084 | 20811 |
| 59 | 3 | kch123 | 55.0% | 58.25% | $11,386,691 | $12,200,722 | 4032 |

## Honest copy results

Copy-all of these 12 after warmup: **n=33696 WR=54.04% ROI -1.93% at their price, -6.14% at +2¢.**

2+ consensus among them is almost empty (they rarely land on the same contract). The old 98% Ghost 2+ book was a winner-sorted CSV, not an edge.

| Strategy | n | WR | ROI 0¢ | ROI +2¢ | PF |
|----------|--:|---:|-------:|--------:|---:|
| `asof_live_q60_sport_rel2` | 578 | 67.13% | 14.89% | 10.78% | 1.45 |
| `asof_q60_sport_rel2` | 634 | 69.72% | 14.09% | 10.14% | 1.47 |
| `asof_q60_sub_rel2` | 581 | 69.36% | 14.07% | 10.1% | 1.46 |
| `asof_q50_sport_rel2` | 2017 | 67.18% | 8.17% | 4.5% | 1.25 |
| `asof_rel2` | 7687 | 65.71% | 6.67% | 3.07% | 1.19 |
| `asof_flip_sport` | 6073 | 52.17% | 3.02% | -0.93% | 1.06 |
| `asof_q60_sport` | 5248 | 57.77% | 2.56% | -1.62% | 1.06 |
| `asof_q70` | 3851 | 58.3% | 1.65% | -2.37% | 1.04 |
| `asof_q60` | 7935 | 57.67% | 1.66% | -2.44% | 1.04 |
| `asof_sub_expert` | 17044 | 53.8% | 0.7% | -3.84% | 1.02 |
| `live_10_88` | 30581 | 52.46% | -0.81% | -4.94% | 0.98 |
| `asof_live_q50_sport` | 8874 | 54.2% | -0.94% | -5.02% | 0.98 |
| `asof_q50` | 17879 | 54.4% | -1.22% | -5.41% | 0.97 |
| `asof_sport_expert` | 14622 | 54.68% | -1.88% | -6.08% | 0.96 |
| `copy_all_warmup` | 33696 | 54.04% | -1.93% | -6.14% | 0.96 |
| `asof_q50_sport` | 9781 | 55.5% | -2.54% | -6.54% | 0.94 |
| `asof_ml_sport` | 10225 | 53.41% | -4.62% | -8.75% | 0.9 |

### Per trader (hold-to-res, after warmup, unfiltered)

| Trader | n | WR | ROI 0¢ | ROI +2¢ | mean as-of Q |
|--------|--:|---:|-------:|--------:|-------------:|
| 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | 161 | 56.52% | 9.49% | 4.9% | 77.5 |
| WTSA | 108 | 52.78% | 8.21% | 3.73% | 57.4 |
| DLEK | 1541 | 54.9% | 8.8% | 3.63% | 30.7 |
| HedgeMaster88 | 210 | 54.29% | 5.43% | 1.23% | 77.2 |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | 415 | 54.22% | 3.72% | -0.48% | 61.0 |
| Vetch | 634 | 57.73% | 2.84% | -1.45% | 78.3 |
| Supah9ga | 650 | 51.69% | 3.21% | -1.54% | 38.5 |
| Capman | 7304 | 60.77% | 1.22% | -2.58% | 65.1 |
| ckw | 2372 | 52.95% | -0.06% | -4.43% | 17.2 |
| Bienville | 3050 | 50.2% | -0.52% | -4.97% | 18.8 |
| tcp2 | 13473 | 51.54% | -5.34% | -9.63% | 50.5 |
| kch123 | 3778 | 53.07% | -6.03% | -9.96% | 39.0 |

## Robustness on books that print after +2¢

### `asof_rel2` — 7687 plays, +2¢ ROI 3.07%, top=tcp2 34.9%

| Dropped | n left | WR | +2¢ ROI |
|---------|-------:|---:|--------:|
| Capman | 6900 | 64.36% | 2.38% |
| Supah9ga | 7480 | 65.9% | 2.71% |
| Vetch | 7501 | 65.47% | 2.83% |
| DLEK | 7061 | 66.19% | 2.86% |
| 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | 7611 | 65.67% | 2.91% |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | 7612 | 65.73% | 2.99% |
| WTSA | 7654 | 65.73% | 3.03% |
| HedgeMaster88 | 7616 | 65.78% | 3.07% |
| tcp2 | 5003 | 62.62% | 3.4% |
| Bienville | 7143 | 66.15% | 3.56% |
| ckw | 6818 | 66.54% | 3.57% |
| kch123 | 6158 | 67.7% | 3.72% |

| Trader | n | share | WR | +2¢ ROI |
|--------|--:|------:|---:|--------:|
| tcp2 | 2684 | 34.9% | 71.46% | 2.45% |
| kch123 | 1529 | 19.9% | 57.68% | 0.42% |
| ckw | 869 | 11.3% | 59.15% | -0.89% |
| Capman | 787 | 10.2% | 77.51% | 9.13% |
| DLEK | 626 | 8.1% | 60.22% | 5.44% |
| Bienville | 544 | 7.1% | 59.93% | -3.38% |
| Supah9ga | 207 | 2.7% | 58.94% | 16.0% |
| Vetch | 186 | 2.4% | 75.27% | 12.5% |
| 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | 76 | 1.0% | 69.74% | 18.89% |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | 75 | 1.0% | 64.0% | 10.4% |
| HedgeMaster88 | 71 | 0.9% | 57.75% | 2.37% |
| WTSA | 33 | 0.4% | 60.61% | 11.25% |

| Quarter | n | WR | +2¢ ROI |
|---------|--:|---:|--------:|
| 2024Q4 | 7 | 28.57% | -55.83% |
| 2025Q1 | 115 | 57.39% | -1.82% |
| 2025Q2 | 105 | 66.67% | 11.81% |
| 2025Q3 | 525 | 69.14% | 0.09% |
| 2025Q4 | 2750 | 66.87% | 3.77% |
| 2026Q1 | 3650 | 65.37% | 2.9% |
| 2026Q2 | 430 | 60.0% | 0.56% |
| 2026Q3 | 105 | 63.81% | 16.12% |

| Sport | n | WR | +2¢ ROI |
|-------|--:|---:|--------:|
| NBA | 2165 | 66.14% | 3.08% |
| Tennis | 1516 | 70.05% | 3.11% |
| NHL | 955 | 60.63% | 0.33% |
| NFL | 951 | 63.83% | -1.4% |
| Other | 837 | 65.11% | 4.81% |
| Soccer | 776 | 63.27% | 5.86% |
| MLB | 318 | 65.41% | 4.3% |
| Esports | 132 | 76.52% | 22.11% |
| WNBA | 34 | 70.59% | 11.76% |

### `asof_q50_sport_rel2` — 2017 plays, +2¢ ROI 4.5%, top=tcp2 42.2%

| Dropped | n left | WR | +2¢ ROI |
|---------|-------:|---:|--------:|
| Capman | 1602 | 66.29% | 2.9% |
| Vetch | 1871 | 66.6% | 3.91% |
| 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | 1985 | 67.1% | 4.23% |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | 1986 | 67.22% | 4.36% |
| Bienville | 2012 | 67.15% | 4.37% |
| WTSA | 1998 | 67.27% | 4.47% |
| Supah9ga | 1936 | 67.92% | 4.48% |
| DLEK | 1984 | 67.39% | 4.67% |
| HedgeMaster88 | 1982 | 67.41% | 4.71% |
| tcp2 | 1165 | 63.52% | 5.85% |
| kch123 | 1649 | 69.86% | 5.98% |

| Trader | n | share | WR | +2¢ ROI |
|--------|--:|------:|---:|--------:|
| tcp2 | 852 | 42.2% | 72.18% | 2.65% |
| Capman | 415 | 20.6% | 70.6% | 10.67% |
| kch123 | 368 | 18.2% | 55.16% | -2.14% |
| Vetch | 146 | 7.2% | 74.66% | 12.01% |
| Supah9ga | 81 | 4.0% | 49.38% | 4.87% |
| HedgeMaster88 | 35 | 1.7% | 54.29% | -7.71% |
| DLEK | 33 | 1.6% | 54.55% | -6.11% |
| 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | 32 | 1.6% | 71.88% | 21.07% |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | 31 | 1.5% | 64.52% | 13.38% |
| WTSA | 19 | 0.9% | 57.89% | 7.1% |
| Bienville | 5 | 0.2% | 80.0% | 55.35% |

| Quarter | n | WR | +2¢ ROI |
|---------|--:|---:|--------:|
| 2025Q1 | 29 | 58.62% | -2.74% |
| 2025Q2 | 4 | 25.0% | -30.56% |
| 2025Q3 | 20 | 75.0% | 20.05% |
| 2025Q4 | 811 | 70.28% | 5.41% |
| 2026Q1 | 968 | 66.32% | 3.51% |
| 2026Q2 | 121 | 59.5% | 3.28% |
| 2026Q3 | 64 | 59.38% | 10.81% |

| Sport | n | WR | +2¢ ROI |
|-------|--:|---:|--------:|
| Tennis | 644 | 72.67% | 5.05% |
| NBA | 350 | 68.0% | 6.85% |
| NFL | 324 | 64.81% | -1.54% |
| Other | 222 | 60.81% | 3.35% |
| NHL | 213 | 64.32% | 0.86% |
| Soccer | 171 | 56.14% | 0.95% |
| Esports | 80 | 75.0% | 29.27% |
| MLB | 11 | 90.91% | 52.0% |

### `asof_q60_sport_rel2` — 634 plays, +2¢ ROI 10.14%, top=Capman 45.3%

| Dropped | n left | WR | +2¢ ROI |
|---------|-------:|---:|--------:|
| Capman | 347 | 66.28% | 8.0% |
| 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | 602 | 69.6% | 9.56% |
| kch123 | 616 | 69.48% | 9.64% |
| Bienville | 629 | 69.63% | 9.78% |
| WTSA | 622 | 69.94% | 10.06% |
| Vetch | 491 | 68.43% | 10.15% |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | 609 | 70.11% | 10.25% |
| Supah9ga | 591 | 70.9% | 10.25% |
| tcp2 | 623 | 69.82% | 10.43% |
| HedgeMaster88 | 599 | 70.62% | 11.18% |
| DLEK | 611 | 70.38% | 11.34% |

| Trader | n | share | WR | +2¢ ROI |
|--------|--:|------:|---:|--------:|
| Capman | 287 | 45.3% | 73.87% | 12.72% |
| Vetch | 143 | 22.6% | 74.13% | 10.11% |
| Supah9ga | 43 | 6.8% | 53.49% | 8.62% |
| HedgeMaster88 | 35 | 5.5% | 54.29% | -7.71% |
| 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | 32 | 5.0% | 71.88% | 21.07% |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | 25 | 3.9% | 60.0% | 7.45% |
| DLEK | 23 | 3.6% | 52.17% | -21.8% |
| kch123 | 18 | 2.8% | 77.78% | 27.11% |
| WTSA | 12 | 1.9% | 58.33% | 14.5% |
| tcp2 | 11 | 1.7% | 63.64% | -6.14% |
| Bienville | 5 | 0.8% | 80.0% | 55.35% |

| Quarter | n | WR | +2¢ ROI |
|---------|--:|---:|--------:|
| 2025Q1 | 23 | 52.17% | -21.8% |
| 2025Q3 | 8 | 75.0% | 22.36% |
| 2025Q4 | 119 | 75.63% | 9.67% |
| 2026Q1 | 348 | 72.41% | 12.21% |
| 2026Q2 | 79 | 60.76% | 7.86% |
| 2026Q3 | 57 | 59.65% | 12.82% |

| Sport | n | WR | +2¢ ROI |
|-------|--:|---:|--------:|
| NBA | 251 | 71.71% | 7.72% |
| Soccer | 113 | 59.29% | 5.89% |
| Other | 74 | 68.92% | 9.16% |
| Esports | 66 | 71.21% | 22.65% |
| NHL | 65 | 80.0% | 18.85% |
| Tennis | 56 | 66.07% | 0.4% |
| MLB | 9 | 88.89% | 44.99% |

### `asof_q60_sub_rel2` — 581 plays, +2¢ ROI 10.1%, top=Capman 44.2%

| Dropped | n left | WR | +2¢ ROI |
|---------|-------:|---:|--------:|
| Capman | 324 | 66.67% | 7.74% |
| 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | 557 | 69.12% | 9.5% |
| kch123 | 563 | 69.09% | 9.56% |
| Bienville | 576 | 69.27% | 9.71% |
| Vetch | 435 | 67.59% | 9.99% |
| HedgeMaster88 | 557 | 69.84% | 10.2% |
| WTSA | 571 | 69.7% | 10.4% |
| tcp2 | 571 | 69.53% | 10.5% |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | 558 | 69.89% | 10.54% |
| Supah9ga | 540 | 70.74% | 10.56% |
| DLEK | 558 | 70.07% | 11.41% |

| Trader | n | share | WR | +2¢ ROI |
|--------|--:|------:|---:|--------:|
| Capman | 257 | 44.2% | 72.76% | 13.07% |
| Vetch | 146 | 25.1% | 74.66% | 10.43% |
| Supah9ga | 41 | 7.1% | 51.22% | 4.07% |
| 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | 24 | 4.1% | 75.0% | 24.09% |
| HedgeMaster88 | 24 | 4.1% | 58.33% | 7.85% |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | 23 | 4.0% | 56.52% | -0.63% |
| DLEK | 23 | 4.0% | 52.17% | -21.8% |
| kch123 | 18 | 3.1% | 77.78% | 27.11% |
| WTSA | 10 | 1.7% | 50.0% | -6.85% |
| tcp2 | 10 | 1.7% | 60.0% | -12.75% |
| Bienville | 5 | 0.9% | 80.0% | 55.35% |

| Quarter | n | WR | +2¢ ROI |
|---------|--:|---:|--------:|
| 2025Q1 | 23 | 52.17% | -21.8% |
| 2025Q3 | 7 | 71.43% | 16.98% |
| 2025Q4 | 121 | 75.21% | 8.48% |
| 2026Q1 | 304 | 72.37% | 13.8% |
| 2026Q2 | 73 | 61.64% | 9.45% |
| 2026Q3 | 53 | 56.6% | 6.41% |

| Sport | n | WR | +2¢ ROI |
|-------|--:|---:|--------:|
| NBA | 231 | 70.13% | 6.06% |
| Soccer | 93 | 58.06% | 6.51% |
| Other | 68 | 70.59% | 12.98% |
| Esports | 65 | 70.77% | 20.98% |
| NHL | 64 | 79.69% | 19.06% |
| Tennis | 50 | 66.0% | -1.92% |
| MLB | 10 | 90.0% | 49.37% |

### `asof_live_q60_sport_rel2` — 578 plays, +2¢ ROI 10.78%, top=Capman 43.9%

| Dropped | n left | WR | +2¢ ROI |
|---------|-------:|---:|--------:|
| Capman | 324 | 64.51% | 8.65% |
| 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | 546 | 66.85% | 10.17% |
| kch123 | 560 | 66.79% | 10.25% |
| Bienville | 573 | 67.02% | 10.39% |
| Vetch | 455 | 65.93% | 10.39% |
| WTSA | 566 | 67.31% | 10.7% |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | 554 | 67.51% | 10.92% |
| Supah9ga | 535 | 68.22% | 10.95% |
| tcp2 | 568 | 67.25% | 11.1% |
| HedgeMaster88 | 543 | 67.96% | 11.97% |
| DLEK | 556 | 67.81% | 12.12% |

| Trader | n | share | WR | +2¢ ROI |
|--------|--:|------:|---:|--------:|
| Capman | 254 | 43.9% | 70.47% | 13.49% |
| Vetch | 123 | 21.3% | 71.54% | 12.2% |
| Supah9ga | 43 | 7.4% | 53.49% | 8.62% |
| HedgeMaster88 | 35 | 6.1% | 54.29% | -7.71% |
| 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | 32 | 5.5% | 71.88% | 21.07% |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | 24 | 4.2% | 58.33% | 7.4% |
| DLEK | 22 | 3.8% | 50.0% | -23.24% |
| kch123 | 18 | 3.1% | 77.78% | 27.11% |
| WTSA | 12 | 2.1% | 58.33% | 14.5% |
| tcp2 | 10 | 1.7% | 60.0% | -7.86% |
| Bienville | 5 | 0.9% | 80.0% | 55.35% |

| Quarter | n | WR | +2¢ ROI |
|---------|--:|---:|--------:|
| 2025Q1 | 22 | 50.0% | -23.24% |
| 2025Q3 | 7 | 71.43% | 23.97% |
| 2025Q4 | 104 | 73.08% | 10.95% |
| 2026Q1 | 314 | 69.43% | 12.78% |
| 2026Q2 | 77 | 59.74% | 7.81% |
| 2026Q3 | 54 | 59.26% | 15.19% |

| Sport | n | WR | +2¢ ROI |
|-------|--:|---:|--------:|
| NBA | 218 | 67.89% | 8.25% |
| Soccer | 110 | 58.18% | 5.82% |
| Other | 71 | 67.61% | 9.23% |
| Esports | 65 | 72.31% | 24.53% |
| NHL | 56 | 76.79% | 20.87% |
| Tennis | 50 | 62.0% | -0.46% |
| MLB | 8 | 87.5% | 49.25% |

## What we take from this

1. **Data first.** 80+ Polydata sports names with finishable books now match their WR/PnL. Mega-whales (RN1, swisstony, Ghost) do not — do not backtest them as copy-sharps.
2. **Do not use 2+ consensus on this list.** Overlap is too thin and it lost.
3. **New product is single-name as-of copy:** only fire when the trader’s *prior* Q and sport/submarket lane said they were an expert, and size vs their own median showed conviction.
4. Unfiltered copy of kch123 / tcp2 is negative at our fill even though their lifetime Polydata PnL is huge — they win dollars on size, not on a copyable 54% coin flip.

### Recommended

| Strategy | n | WR | +2¢ ROI | Why |
|----------|--:|---:|--------:|-----|
| **As-of Q60 + sport expert + 2× size (live 10–88¢)** | 578 | 67.13% | **10.78%** | n≥200, +ROI after 2¢, leave-one-out and quarters hold |
| **As-of Q60 + sport expert + 2× size (any price, no NFL)** | 634 | 69.72% | **10.14%** | n≥200, +ROI after 2¢, leave-one-out and quarters hold |
| **As-of Q60 + submarket expert + 2× size (no NFL)** | 581 | 69.36% | **10.1%** | n≥200, +ROI after 2¢, leave-one-out and quarters hold |

### Skip

| Book | n | +2¢ ROI | Why |
|------|--:|--------:|-----|
| As-of Q50 + sport expert + 2× size — thinner | 2017 | 4.5% | Prints after 2¢ but kch123 is negative here, NFL drags, and tcp2 is 42% of the tape. Prefer Q60. |
| Conviction size only (≥2× own median) — thinner | 7687 | 3.07% | Prints after 2¢ but NFL is negative and Bienville/ckw bleed. Prefer Q60 + sport + size. |
| Copy-all of the 12 matched books — skip | 33696 | -6.14% | Do not copy every play. After warmup this tape is ~54% WR and negative after juice. |
| As-of Q60 with no size/sport gate — skip | 7935 | -2.44% | Q ≥ 60 alone is not enough. +2¢ ROI is negative. You need sport expertise and size. |
| GoalLineGhost 2+ moneyline — DO NOT TAKE | — | 0.0% | INVALID. Closed-positions were winner-sorted. Ghost public WR is ~53% / PnL −$1.14M. |

