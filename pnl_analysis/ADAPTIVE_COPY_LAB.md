# Adaptive copy lab — multi-strategy + fluid roster

Generated **2026-08-24T19:09:39 UTC**.

Unique closed+open books remain truth for ROI. This lab answers: **which rule × which books would we have tailed**, how smooth the $100 equity was, who is easy to join, and how the roster should adapt.

Product rule stays **`asof_live_q60_sport_rel2`** until an alt strategy beats it on live+joinable with better consistency for ≥60 days (proposal only — no silent swap).

## What we would have tailed (product rule)

- **live_only**: n=35 WR=62.86% +2¢ ROI=21.83% PnL=$763.93 Sharpe=4.5 maxDD=$-300.0 (2026-03-02 → 2026-08-17)
- **easy_tail**: n=611 WR=54.83% +2¢ ROI=-2.95% PnL=$-1804.56 Sharpe=-0.24 maxDD=$-4815.69 (2025-01-07 → 2026-05-17)
- **live_plus_bench**: n=399 WR=59.9% +2¢ ROI=3.75% PnL=$1495.88 Sharpe=2.17 maxDD=$-2101.63 (2025-01-07 → 2026-08-17)
- **all_csv**: n=953 WR=59.71% +2¢ ROI=1.95% PnL=$1860.11 Sharpe=0.22 maxDD=$-2812.33 (2025-01-07 → 2026-08-23)
- **joinable_csv**: n=622 WR=55.14% +2¢ ROI=-1.96% PnL=$-1218.18 Sharpe=0.58 maxDD=$-4815.69 (2025-01-07 → 2026-08-17)

## Multi-strategy bake-off (all CSV live+bench+watch)

| Strategy | n | WR | +2¢ ROI | PnL | Sharpe | maxDD | Consistency* | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `asof_q60_sub_rel2`  | 956 | 62.87% | 3.22% | $3077.76 | 0.23 | $-2239.26 | 3.2 | watch alt — Q≥60 + submarket expert + rel≥2×, no NFL |
| `asof_q50_sport_rel2`  | 2764 | 64.33% | 2.25% | $6226.42 | 0.84 | $-5301.13 | 3.2 | watch alt — Q≥50 + sport + rel≥2× |
| `asof_q60_sport_rel2`  | 1015 | 62.07% | 2.15% | $2181.88 | 0.05 | $-2803.59 | 2.2 | watch alt — Same gates without live price band (still no NFL |
| `asof_live_q60_sport_rel2` PRODUCT | 953 | 59.71% | 1.95% | $1860.11 | 0.22 | $-2812.33 | 1.9 | ship — PRODUCT — Q≥60, sport +5%, rel≥2×, 10–88¢, no NF |
| `asof_flip_sport`  | 10174 | 52.93% | 1.07% | $10876.11 | -0.69 | $-12286.0 | 2.2 | lab — Sport expert coin-flips (40–60¢) |
| `asof_q60_sport`  | 6714 | 56.81% | -1.4% | $-9406.45 | -0.12 | $-18730.67 | 0.0 | skip — Q≥60 + sport lane only (no size / no price band) |
| `asof_live_q50_sport`  | 10990 | 53.31% | -4.02% | $-44223.48 | -0.37 | $-49959.81 | 0.0 | skip — Looser grade (Q≥50) + sport lane + live band |
| `live_10_88`  | 48612 | 52.38% | -4.23% | $-205681.59 | -3.59 | $-212874.65 | 0.0 | skip — Baseline: any warmup print in 10–88¢ |
| `asof_ml_sport`  | 16684 | 54.77% | -7.15% | $-119360.66 | -1.05 | $-122284.57 | 0.0 | skip — Sport expert moneylines only |

\*Consistency = mean/std of daily $100 PnL scaled (higher = smoother green).

## Ranked traders (easy + consistent + take-rule)

| Rank | Trader | Bucket | Composite | Join | Cons | Take n/+2¢ | 30d | Action |
|---:|---|---|---:|---:|---:|---|---|---|
| 1 | JhonAlexanderHinestroza | bench | 64.3 | 90.0 | 12.2 | 108/19.49% | 38/19.36% | keep_bench |
| 2 | 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | live | 64.0 | 80.0 | 19.6 | 11/53.31% | 11/53.31% | keep_live |
| 3 | SDTrading | live | 62.0 | 83.0 | None | 0/0.0% | 0/0.0% | keep_live |
| 4 | UAEVALORANTFAN | watch | 62.0 | 83.0 | 0.0 | 19/-45.05% | 19/-45.05% | auto_promote_if_regime |
| 5 | ShortFlutterStock | watch | 61.4 | 90.0 | 0.0 | 198/-9.4% | 75/-3.02% | keep_watch |
| 6 | Vetch | bench | 60.3 | 100.0 | 10.3 | 84/12.6% | 14/7.0% | keep_bench |
| 7 | 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | live | 57.9 | 93.0 | 3.5 | 24/7.4% | 4/-54.24% | keep_live_caution |
| 8 | Andromeda1 | bench | 45.6 | 75.0 | 0.0 | 79/-17.19% | 23/-42.1% | keep_cold |
| 9 | Supah9ga | bench | 43.7 | 70.0 | 7.9 | 21/16.57% | 9/-14.58% | keep_bench |
| 10 | TTdes | bench | 42.0 | 100.0 | 0.0 | 15/-42.67% | 14/-49.8% | keep_bench |
| 11 | HedgeMaster88 | bench | 41.5 | 70.0 | 0.0 | 35/-7.71% | 35/-7.71% | keep_bench |
| 12 | DLEK | bench | 38.4 | 83.0 | 0.0 | 22/-23.24% | 18/-20.73% | keep_cold |
| 13 | HongYunX | live | 35.5 | 93.0 | None | 0/0.0% | 0/0.0% | keep_live |
| 14 | 0xheavy888 | bench | 30.1 | 90.0 | None | 0/0.0% | 0/0.0% | keep_bench |
| 15 | S-Works | watch | 27.5 | 90.0 | None | 0/0.0% | 0/0.0% | auto_promote_if_regime |
| 16 | Capman | matched_archive | 27.3 | 0.0 | 13.8 | 260/14.46% | 81/14.76% | keep_watch |
| 17 | SineNooneEI | watch | 26.9 | 50.0 | 0.0 | 14/-17.96% | 14/-17.96% | keep_watch |
| 18 | kch123 | matched_archive | 26.3 | 0.0 | 43.0 | 18/27.1% | 12/17.93% | keep_watch |
| 19 | JuniorB | bench | 24.8 | 80.0 | None | 0/0.0% | 0/0.0% | keep_bench |
| 20 | ShucksIt69 | watch | 24.6 | 75.0 | 0.1 | 6/0.4% | 6/0.4% | auto_promote_if_regime |
| 21 | norrisfan | watch | 23.0 | 40.0 | 0.0 | 28/-20.46% | 11/-25.81% | keep_cold |
| 22 | HVAB | watch | 21.8 | 50.0 | None | 0/0.0% | 0/0.0% | keep_watch |
| 23 | ckw | bench | 20.6 | 60.0 | None | 0/0.0% | 0/0.0% | keep_bench |
| 24 | WTSA | bench | 20.2 | 40.0 | None | 0/0.0% | 0/0.0% | keep_bench |
| 25 | bloodmaster | watch | 16.7 | 40.0 | None | 0/0.0% | 0/0.0% | keep_watch |
| 26 | Sassy-Bucket | watch | 15.4 | 15.0 | None | 0/0.0% | 0/0.0% | keep_watch |
| 27 | 0xE30E74595517de48f1FB19f4553dd3d9F1E96B87 | watch | 14.9 | 40.0 | 0.0 | 1/-100.0% | 1/-100.0% | keep_watch |
| 28 | predictionlegend | watch | 14.4 | 40.0 | 0.0 | 1/-100.0% | 1/-100.0% | keep_watch |
| 29 | Bienville | bench | 14.0 | 40.0 | None | 0/0.0% | 0/0.0% | keep_bench |
| 30 | theowalcott | watch | 12.6 | 30.0 | None | 0/0.0% | 0/0.0% | keep_watch |

## Adaptive control loop (how we stay fluid)

- Refresh CSVs (live+bench+watch) → ranks → copy_universe.
- Adaptive lab: multi-strategy + joinability + consistency + equity regime.
- auto_promote.py: watch/bench → take_book automatically when gates fire (including turnaround).
- Rebuild copy_universe so Take these allowlist updates without human edits.
- Demote automatic: take_rule_bleed, quiet_30d, live take n≥12 deeply red.
- New traders: Polydata → watch → unique book → regime/lab → auto_promote.
- MM lane is separate (mm_maker_research) — not $100 copy.

### Proposed actions now

- **auto_promote_if_regime** — UAEVALORANTFAN: watch candidate — auto_promote checks turnaround/hot last30 gates
- **keep_live_caution** — 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a: live hist take +7.4% n=24 but rolling 30d take -54.24% n=4 — size down / wait for prints
- **keep_cold** — Andromeda1: take-rule cold n=79 roi=-17.19%
- **keep_cold** — DLEK: take-rule cold n=22 roi=-23.24%
- **auto_promote_if_regime** — S-Works: watch candidate — auto_promote checks turnaround/hot last30 gates
- **auto_promote_if_regime** — ShucksIt69: watch candidate — auto_promote checks turnaround/hot last30 gates
- **keep_cold** — norrisfan: take-rule cold n=28 roi=-20.46%
- **propose_strategy_swap** — None: easy_tail asof_flip_sport ROI 2.52% n=6222 vs product -2.95% n=611

## Forward 30d projection (illustrative)

- Method: trades_per_day × $100 expectancy from in-sample product rule on the scored pool. Bands are illustrative (±1.28σ-style), not a forecast of edge persistence.
- Pool hist: n=35 ROI=21.83%
- Projected plays: **42.0** · PnL **$916.86** (band $750.95 → $1082.77)
- Caveat: Empty live open book ⇒ near-term n may be 0 even if hist tpd > 0. Cold weeks pause; do not force size.

| Live trader | Hist n | Hist +2¢ | Proj n 30d | Proj $ |
|---|---:|---:|---:|---:|
| 0x1b20a00709DfE648AFd26b326394b5e031f83ab0 | 11 | 53.31% | 36.6 | $1951.15 |
| SDTrading | 0 | 0.0% | 0.0 | $0.0 |
| 0x8a3aB8120807bD64a3De48695110e390fa2ceB9a | 24 | 7.4% | 45.0 | $333.0 |
| HongYunX | 0 | 0.0% | 0.0 | $0.0 |

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
