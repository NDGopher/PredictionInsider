# Market making research (not live trading)

Generated **2026-08-23T13:36:56 UTC**.

This is a **separate lane** from Take these / copy-tail. We study mega/MM books to estimate inventory/hedge edge from history. **No orders are placed.**

## Feasibility

- Automate live MM on Poly today? **False**
- Verdict: Market making is a separate product lane from Take these. History shows hedge inventory can be profitable for mega books, but automating live MM on Poly is not ready as a $100 retail strategy.

### Why not yet

- Polymarket CLOB requires continuous two-sided quoting, cancel/replace, and inventory caps.
- Historical CSVs give filled inventory, not the full quote tape (missed fills / queue position).
- RN1-class books run 100k–3M+ fills — infrastructure and capital, not a $100 copy bot.
- Latency, gas/bridge, and adverse selection vs informed flow dominate retail MM.

### Near-term viable steps

- Research + alert when locked yes+no VWAP < 1.00 on markets we already trade.
- Hedge overlay: when our take-book print is one-sided, optionally buy cheap opposite if sum < 0.98.
- Separate MM desk paper-trading with hard inventory limits before any live quoting.

## Books profiled

| Trader | Unique ROI | Hedge n / $ | Dir n / $ | Avg locked edge | Sim $/100 hedges |
|---|---:|---|---|---:|---:|
| kch123 | 35.51% | 4/412347.61 | 2458/11801653.0 | 0.0078 | 77.87 |
| tcp2 | 12.74% | 1841/78018.6 | 10358/461780.09 | 0.025 | 250.24 |
| RN1 | 27.31% | 14404/2926574.65 | 37722/5112916.38 | 0.0568 | 567.61 |
| GoalLineGhost | -0.73% | None/None | None/None | None | None |
| HomeRunHazard | 0.78% | None/None | None/None | None | None |
| BoomLaLa | 18.27% | 556/-6452.35 | 21411/744212.83 | 0.0813 | 812.79 |
| 0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563 | -4.03% | None/None | None/None | None | None |
| swisstony | None% | None/None | None/None | None | None |
| Cannae | 44.14% | 6694/9850208.46 | 12744/1505151.37 | 0.0101 | 100.66 |
| geniusMC | -13.64% | 40/-807404.26 | 1017/2824393.54 | -0.0527 | -527.47 |
| quavoo | None% | None/None | None/None | None | None |
| wr0ngw4yb3tt0r | None% | None/None | None/None | None | None |

## How to rebuild

`python pnl_analysis/mm_maker_research.py` · `npm run research:mm`
