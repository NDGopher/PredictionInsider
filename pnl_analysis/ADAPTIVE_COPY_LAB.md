# Adaptive copy lab — multi-strategy + fluid roster

Generated **2026-08-21T15:00:04 UTC**.

Unique closed+open books remain truth for ROI. This lab answers: **which rule × which books would we have tailed**, how smooth the $100 equity was, who is easy to join, and how the roster should adapt.

Product rule stays **`asof_live_q60_sport_rel2`** until an alt strategy beats it on live+joinable with better consistency for ≥60 days (proposal only — no silent swap).

## What we would have tailed (product rule)

- **live_only**: n=24 WR=58.33% +2¢ ROI=7.4% PnL=$177.55 Sharpe=2.41 maxDD=$-300.0 (2026-03-02 → 2026-05-17)
- **easy_tail**: n=696 WR=55.03% +2¢ ROI=-2.43% PnL=$-1693.16 Sharpe=-0.31 maxDD=$-4452.89 (2025-01-07 → 2026-05-17)
- **live_plus_bench**: n=437 WR=60.64% +2¢ ROI=4.66% PnL=$2034.59 Sharpe=2.94 maxDD=$-1824.89 (2025-01-07 → 2026-07-29)
- **all_csv**: n=1105 WR=60.36% +2¢ ROI=3.15% PnL=$3482.38 Sharpe=1.66 maxDD=$-2812.33 (2025-01-07 → 2026-08-22)
- **joinable_csv**: n=707 WR=55.3% +2¢ ROI=-1.57% PnL=$-1106.78 Sharpe=0.5 maxDD=$-4452.89 (2025-01-07 → 2026-08-17)

## Multi-strategy bake-off (all CSV live+bench+watch)

| Strategy | n | WR | +2¢ ROI | PnL | Sharpe | maxDD | Consistency* | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `asof_q60_sub_rel2`  | 1118 | 64.04% | 3.26% | $3643.18 | 1.03 | $-2977.88 | 3.4 | watch alt — Q≥60 + submarket expert + rel≥2×, no NFL |
| `asof_q60_sport_rel2`  | 1205 | 63.57% | 3.25% | $3910.59 | 1.67 | $-2803.59 | 3.4 | watch alt — Same gates without live price band (still no NFL |
| `asof_live_q60_sport_rel2` PRODUCT | 1105 | 60.36% | 3.15% | $3482.38 | 1.66 | $-2812.33 | 3.1 | ship — PRODUCT — Q≥60, sport +5%, rel≥2×, 10–88¢, no NF |
| `asof_q50_sport_rel2`  | 3074 | 64.7% | 2.35% | $7236.72 | 1.5 | $-5856.75 | 3.4 | lab — Q≥50 + sport + rel≥2× |
| `asof_flip_sport`  | 11340 | 52.95% | 1.24% | $14020.73 | -0.58 | $-13066.54 | 2.6 | lab — Sport expert coin-flips (40–60¢) |
| `asof_q60_sport`  | 7277 | 57.17% | -1.18% | $-8608.28 | -0.48 | $-18473.53 | 0.0 | skip — Q≥60 + sport lane only (no size / no price band) |
| `asof_live_q50_sport`  | 11723 | 53.49% | -3.72% | $-43553.01 | -0.79 | $-50131.58 | 0.0 | skip — Looser grade (Q≥50) + sport lane + live band |
| `live_10_88`  | 54445 | 52.41% | -3.92% | $-213425.13 | -3.53 | $-221912.71 | 0.0 | skip — Baseline: any warmup print in 10–88¢ |
| `asof_ml_sport`  | 18570 | 55.0% | -6.64% | $-123372.66 | -1.41 | $-125931.53 | 0.0 | skip — Sport expert moneylines only |

\*Consistency = mean/std of daily $100 PnL scaled (higher = smoother green).

## Ranked traders (easy + consistent + take-rule)

| Rank | Trader | Bucket | Composite | Join | Cons | Take n/+2¢ | 30d | Action |
|---:|---|---|---:|---:|---:|---|---|---|
| 1 | Vetch | bench | 68.2 | 100.0 | 10.3 | 84/12.6% | 14/7.0% | keep_bench |
| 2 | JhonAlexanderHinestroza | bench | 66.9 | 90.0 | 12.2 | 108/19.49% | 38/19.36% | keep_bench |
| 3 | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | watch | 61.2 | 80.0 | 19.6 | 11/53.31% | 11/53.31% | keep_watch |
| 4 | ShortFlutterStock | watch | 56.6 | 90.0 | 0.0 | 198/-9.4% | 75/-3.02% | keep_watch |
| 5 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | live | 55.0 | 93.0 | 3.5 | 24/7.4% | 4/-54.24% | keep_live_caution |
| 6 | CoryLahey | watch | 54.3 | 75.0 | 1.1 | 66/1.3% | 51/-2.97% | keep_watch |
| 7 | Andromeda1 | bench | 49.5 | 75.0 | 0.0 | 79/-17.19% | 23/-42.1% | keep_cold |
| 8 | Supah9ga | bench | 49.4 | 70.0 | 7.9 | 21/16.57% | 9/-14.58% | keep_bench |
| 9 | Bienville | bench | 48.9 | 75.0 | 68.6 | 5/55.35% | 5/55.35% | keep_bench |
| 10 | HedgeMaster88 | bench | 45.6 | 70.0 | 0.0 | 35/-7.71% | 35/-7.71% | keep_bench |
| 11 | DLEK | bench | 42.3 | 83.0 | 0.0 | 22/-23.24% | 18/-20.73% | keep_cold |
| 12 | SineNooneEI | watch | 42.0 | 85.0 | 0.0 | 14/-17.96% | 14/-17.96% | keep_watch |
| 13 | TTdes | bench | 41.3 | 100.0 | 0.0 | 15/-42.67% | 14/-49.8% | keep_bench |
| 14 | UAEVALORANTFAN | watch | 36.0 | 83.0 | 0.0 | 19/-45.05% | 19/-45.05% | keep_watch |
| 15 | HVAB | watch | 35.6 | 50.0 | 3.1 | 34/3.54% | 32/6.5% | keep_watch |
| 16 | 0x5966Db1fE50763C9e3C014d756369BAd07E1F804 | bench | 33.8 | 25.0 | 14.7 | 32/21.07% | 23/23.53% | keep_bench |
| 17 | HongYunX | watch | 31.5 | 93.0 | None | 0/0.0% | 0/0.0% | keep_watch |
| 18 | 0xheavy888 | bench | 30.8 | 90.0 | None | 0/0.0% | 0/0.0% | keep_bench |
| 19 | S-Works | watch | 30.8 | 90.0 | None | 0/0.0% | 0/0.0% | keep_watch |
| 20 | WTSA | bench | 30.2 | 40.0 | 7.3 | 12/14.5% | 12/14.5% | keep_bench |
| 21 | kch123 | matched_archive | 30.1 | 0.0 | 43.0 | 18/27.1% | 12/17.93% | keep_watch |
| 22 | Capman | matched_archive | 29.4 | 0.0 | 13.8 | 260/14.46% | 81/14.76% | keep_watch |
| 23 | SDTrading | watch | 29.1 | 83.0 | None | 0/0.0% | 0/0.0% | keep_watch |
| 24 | ShucksIt69 | watch | 28.5 | 75.0 | 0.1 | 6/0.4% | 6/0.4% | keep_watch |
| 25 | JuniorB | bench | 28.3 | 80.0 | None | 0/0.0% | 0/0.0% | keep_bench |
| 26 | norrisfan | watch | 25.3 | 40.0 | 0.0 | 28/-20.46% | 11/-25.81% | keep_cold |
| 27 | ckw | bench | 23.4 | 60.0 | None | 0/0.0% | 0/0.0% | keep_bench |
| 28 | theowalcott | watch | 18.5 | 30.0 | 8.3 | 5/18.18% | 5/18.18% | keep_watch |
| 29 | predictionlegend | watch | 15.8 | 40.0 | None | 0/0.0% | 0/0.0% | keep_watch |
| 30 | bloodmaster | watch | 15.8 | 40.0 | None | 0/0.0% | 0/0.0% | keep_watch |

## Adaptive control loop (how we stay fluid)

- Refresh CSVs (live+bench+watch only) → rebuild unique ranks → copy_universe gates.
- Run product take-rule + this lab (multi-strategy + consistency + joinability).
- Demote: take_rule_bleed, quiet_30d, unique ROI collapse — automatic in copy_roster.
- Promote bench→live: only when propose_promote_live gates fire (joinable + take n≥12 +ROI + active).
- Promote watch→live: human edits extra_traders status (never auto).
- Cold: keep fetching bench/watch; pause live sizing if live 30d take ROI deeply red.
- New traders: Polydata boards → extra_watch → unique book → digest → lab score → human promote.
- New strategies: compete in COMPARE_STRATEGIES; swap only via propose_strategy_swap + cache bump.

### Proposed actions now

- **keep_live_caution** — 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a: live hist take +7.4% n=24 but rolling 30d take -54.24% n=4 — size down / wait for prints
- **keep_cold** — Andromeda1: take-rule cold n=79 roi=-17.19%
- **keep_cold** — DLEK: take-rule cold n=22 roi=-23.24%
- **keep_cold** — norrisfan: take-rule cold n=28 roi=-20.46%

## Forward 30d projection (illustrative)

- Method: trades_per_day × $100 expectancy from in-sample product rule on the scored pool. Bands are illustrative (±1.28σ-style), not a forecast of edge persistence.
- Pool hist: n=24 ROI=7.4%
- Projected plays: **45.0** · PnL **$333.0** (band $161.27 → $504.73)
- Caveat: Empty live open book ⇒ near-term n may be 0 even if hist tpd > 0. Cold weeks pause; do not force size.

| Live trader | Hist n | Hist +2¢ | Proj n 30d | Proj $ |
|---|---:|---:|---:|---:|
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | 24 | 7.4% | 45.0 | $333.0 |

## Machine-learning-style adaptation (without black-box ML yet)

We treat the roster + rule as an online policy:

1. **Features** each refresh: unique ROI/WR/median, last-30/60 prints, take-rule n/ROI/Sharpe/DD, joinability, consistency, CLV when available.
2. **Policy**: hard gates in `copy_roster` (never auto-live `extra_watch`) + soft scores here.
3. **Reward**: flat $100 hold-to-res PnL under product rule (not Polydata month curves).
4. **Explore**: watch bucket + alt strategies in this lab; promote only when gates fire.
5. **Exploit**: live = current best joinable + take-green books.
6. **Cold path**: quiet_30d / take bleed → bench; PAUSE Take these if live open empty and 30d live ROI red.
7. **Strategy drift**: if an alt mask beats product on `easy_tail` for 60+ days with n≥80 and better consistency, surface `propose_strategy_swap` — human confirms, then bump signal cache.

Next ML step (optional): logistic / gradient model on as-of features to rank *plays* inside the product mask — not to replace unique-book truth.

Rebuild: `python pnl_analysis/adaptive_copy_lab.py` · `npm run model:adaptive`
