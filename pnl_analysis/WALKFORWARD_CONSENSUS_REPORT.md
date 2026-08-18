# Honest walk-forward consensus backtest

Run: `npm run backtest:consensus`  
Scripts/data: `walkforward_consensus_backtest.py`, `output/walkforward_consensus_backtest.json`, `output/walkforward_consensus_recommended.json`

## Why the first ROIs were fake

The first tailing backtest treated `realizedPnl > 0` as a **binary $1 win** and paid `stake × (1/price − 1)`.

Traders who **scalped a losing token** for a small profit were scored as huge underdog payouts.

Per-row check (hold-to-resolution using `curPrice` 0 or 1):

| Book | Fake (PnL>0 as $1 win) | Real (token settled at $1) |
|------|------------------------|----------------------------|
| All closed rows | ~77% ROI | **~13%** (ungrouped) |
| Underdogs &lt;45¢ | **~196% ROI** | **~1%** |
| Directional markets, hedges stripped | — | **3.7% ROI**, 58.2% WR vs 53.0% implied |

That 95% “underdog 70+” number was the scalp bug, not an edge.

## Method (no look-ahead)

- **Win** = this wallet’s token `curPrice ≥ 0.99`. **Loss** = `≤ 0.01`. Mids skipped (didn’t hold to resolution).
- **Play** = `conditionId` + side (not eventSlug blends of ML/spread/total).
- **Hedges** (both Yes and No on the same market) and 95¢+ NO bonds stripped.
- **Trader Q / lane ROI / median stake** use only that trader’s markets with `endDate ≤ this market’s endDate − 1 day`.
- Voter must already have **20 resolved markets** and **≥ $200** on this side.
- **Category `doNotTail`** lists from `eliteAnalysis.ts` applied in filtered books.
- **$100/play**. Fills: dollar-weighted **VWAP** (their price) vs **join_max** (worse member entry — you cannot confirm consensus until the later wallet is in) plus **+1/2/5¢**.

Copy-all (every directional hold-to-res market, no consensus): **n=267,698, WR 58.2%, implied 53.0%, ROI 3.7%**. That is the sane baseline.

## Multi-trader results (join_max + 2¢)

| Strategy | n | WR | Implied | Edge | ROI | 2025 ROI | 2026 ROI |
|----------|--:|---:|--------:|-----:|----:|---------:|---------:|
| 2+ filtered (includes Cannae) | 1,367 | 83.7% | 66.7% | +17.0 | 29.0% | +0.8% | **+39.9%** |
| 2+ **without Cannae** | 756 | 70.5% | 66.1% | +4.4 | **2.5%** | +0.8% | +3.0% |
| 2+ live 10–88¢, no Cannae | 619 | 70.0% | 64.6% | +5.4 | **8.4%** | +3.4% | +12.1% |
| Grade ≥70, no Cannae | 298 | 79.5% | 68.7% | +10.8 | **19.4%** | +11.2% | +21.5% |
| Grade ≥70 + min Q≥35, 10–88¢, no Cannae | 113 | 78.8% | 65.0% | +13.8 | 24.4% | n=19 | n=94 |
| NFL consensus (inside 2+ no Cannae) | 32 | 28.1% | — | — | **−68%** | — | — |

Leave-one-out: **Cannae is the 2026 soccer-NO mirage**. He is a Q=100 domestic-soccer fader. Pairing him with RN1 / CemeterySun / Jhon produces 90%+ WR books that did not exist in 2025 (2+ without him is +0.8% in 2025).

Price buckets (2+ filtered, still includes Cannae — do not trade these as standalone edges):

- Longshot 0–20¢: **negative**
- 20–40¢: high WR vs implied but small n and Cannae-heavy
- 40–60¢ / 60–80¢: look great only with Cannae in the cluster
- 80–88¢: ~7% ROI at join+2¢ (favorite grind)

## Best strategy to actually tail

**Core (what I would run):**

1. **2+ tracked wallets** on the same `conditionId` + side after `doNotTail` filters  
2. **Live price 10–88¢** (same band as `/api/signals`)  
3. **Fill at join_max + 2¢** (worse of their entries, plus slippage)  
4. **Exclude Cannae** from the voter set (treat his soccer NO as a separate, concentrated overlay if you insist)  
5. **Do not tail NFL consensus** (−68% in this roster)  
6. Optional tightening: **grade ≥ 70** (drops n 619 → 298, lifts join+2¢ ROI 8.4% → 19.4%, 2025 still positive)

Do **not** run “Q≥50 and $1k” or “20–60¢ Q50” — those are Cannae 2026.

Expected core book if you skip the grade-70 cut: **~5–12% ROI** after 2¢, ~70% WR at ~65¢ implied. That matches copy-all’s 4% plus a small consensus lift, not a 50–95% machine.

## Last 20 plays (grade ≥70, min Q≥35 at T, 10–88¢, no Cannae)

Fill = join_max + 2¢. $100/play.

| Date | Res | Side | Their VWAP | Join+2¢ | Grade | Min Q | Traders | Market |
|------|-----|------|------------|---------|------:|------:|---------|--------|
| 2026-04-13 | WIN | No | 0.879 | 0.901 | 98 | 38 | BoomLaLa, CoryLahey, Supah9ga | Scheffler Masters |
| 2026-04-13 | WIN | No | 0.683 | 0.740 | 93 | 42 | CoryLahey, Supah9ga | Cameron Young Masters |
| 2026-04-12 | WIN | Yes | 0.637 | 0.854 | 92 | 58 | Avarice31, CemeterySun | Chicago Fire |
| 2026-04-12 | WIN | No | 0.687 | 0.720 | 70 | 55 | RN1, TTdes | Real Betis |
| 2026-04-12 | WIN | Yes | 0.724 | 0.980 | 99 | 55 | CemeterySun, RN1 | Bologna |
| 2026-04-12 | WIN | No | 0.781 | 0.874 | 100 | 55 | Andromeda1, RN1 | NEC |
| 2026-04-12 | WIN | Yes | 0.574 | 0.726 | 100 | 55 | CemeterySun, RN1 | Sunderland |
| 2026-04-12 | WIN | No | 0.627 | 0.670 | 91 | 55 | CemeterySun, RN1 | KFUM Oslo |
| 2026-04-11 | WIN | No | 0.599 | 0.743 | 83 | 45 | CoryLahey, RN1 | Dortmund |
| 2026-04-11 | WIN | No | 0.767 | 0.789 | 77 | 55 | CemeterySun, RN1 | Atalanta |
| 2026-04-11 | WIN | No | 0.763 | 0.955 | 92 | 64 | Avarice31, CemeterySun | FC Cincinnati |
| 2026-04-11 | WIN | No | 0.530 | 0.568 | 92 | 56 | CemeterySun, Supah9ga | Bodø/Glimt |
| 2026-04-09 | WIN | No | 0.847 | 0.915 | 86 | 54 | JhonAlexanderHinestroza, RN1 | Nottingham Forest |
| 2026-04-07 | WIN | No | 0.681 | 0.850 | 87 | 54 | RN1, Supah9ga | Aalesunds |
| 2026-04-07 | WIN | No | 0.800 | 0.820 | 76 | 35 | CemeterySun, S-Works | Sporting CP |
| 2026-04-06 | WIN | No | 0.701 | 0.783 | 82 | 54 | CemeterySun, RN1, Supah9ga | Villarreal |
| 2026-04-05 | WIN | No | 0.640 | 0.660 | 100 | 38 | CoryLahey, norrisfan | Osasuna |
| 2026-04-05 | WIN | No | 0.466 | 0.510 | 94 | 44 | Andromeda1, CoryLahey, RN1 | Al Fateh |
| 2026-04-05 | WIN | No | 0.423 | 0.494 | 92 | 53 | CemeterySun, RN1 | Grêmio |
| 2026-04-04 | **LOSS** | No | 0.506 | 0.560 | 100 | 36 | CoryLahey, S-Works, norrisfan | Barcelona |

CSV snapshots end in mid-April 2026 for a lot of soccer; the pipeline refresh has later rows for some wallets (last no-Cannae grade-70 print also has Aug 2026 MLS fades). Re-run after the next full ingest to refresh this tape.

## Live / upcoming (local `/api/signals` at run time)

Only **one** 2+ sports signal was live:

| Grade | Q | n | Side | Live px | Entry | Traders | Market | Rec |
|------:|--:|--:|------|--------:|------:|---------|--------|-----|
| 82 | 57 | 2 | NO | 0.47 | 0.44 | 0x20D643…, RN1 | Red Sox vs Yankees | **CAUTION** — slug is `mlb-bos-nyy-2026-06-06` but `endDate` is 2026-09-05. Looks like a stale/rescheduled book. Do not tail until the game date is real. |
| 42 | 99 | 1 | YES | 0.48 | 0.48 | RN1 | Eala vs Anisimova | PASS (single trader) |
| 37–38 | — | 1 | — | — | — | singles | tennis / CS2 | PASS |

**Recommendation right now:** no clean 2+ play to take. The Sox/Yankees NO is the only cluster that matches the rule, and the date metadata is not trustworthy.

## Caveats that still apply

- Roster is chosen with hindsight (these 50 wallets are the ones we track). Walk-forward Q is honest **given that roster**.
- CSVs have no true entry timestamp; join_max is a proxy for “later/worse fill.”
- We cannot see whether they still held at our hypothetical entry (live product requires a current position).
- Overlapping same-day slates can still leak a little even with the 1-day lag.
- $100 flat ≠ sizing to their stake.
