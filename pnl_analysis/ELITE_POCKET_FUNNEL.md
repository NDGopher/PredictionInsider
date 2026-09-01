# Why only one live elite — and how we fix the pocket

## Short answer

**It is not that only HVAB exists.** We only *digested* ~45 books and walk-forwarded ~35. Polydata’s sports boards already show **~50–260** specialist wallets with copy-shaped PnL/vol. Of the latest **month sports survivors, ~40 had no local CSV** — so the system could never score their equity curves, never scout them, never promote them.

Lowering scout ROI to ~3% and focusing on curve/consistency helps **a little** on books we already have (SineNooneEI → scout again; HongYunX → scout). It does **not** invent elites we never downloaded.

## Funnel (before expand)

```
Polydata sports boards     ~100–260 wallets
  → survivors (PnL/vol≥5%) ~45–96
  → auto-watch cap         12 / run
  → CSV fetch cap          8 / refresh
  → local digests          ~45 CSVs
  → walk-forward scan      ~35 books
  → live elite             1 (HVAB)
```

That is a **coverage failure**, not a market failure.

## What we changed

| Lever | Before | After |
|-------|--------|-------|
| Polydata pages | 100/board | ~175/board |
| Auto-watch | 12 | **50** (week+month sports) |
| Fetch/refresh | 8 | **25** |
| Scout unique ROI | 5% | **3%** (curve primary) |
| Scout specialty | volume leader only | **best ROI specialty** (fixes SineNooneEI tennis pocket) |
| Queue script | — | `expand_curve_scout_queue.py` |

## Immediate result of digesting 11 missing board names

| Book | Status | Note |
|------|--------|------|
| **HVAB** | **elite** | Still the live Telegram book |
| **HongYunX** | **scout** (first ~2026-08-26) | Soccer curve ~82, unique ~+9.6%, active30=40 — needs take-slice for elite |
| **SineNooneEI** | **scout** | Active; tennis specialty strong; ESPORTS volume weak — Path A take still soft |
| tes21sa | cooldown after scout | Was scouted ~Aug 21 |
| beachboy4 | blocked | Median ~$328k — not tailable |
| TennisLove / kilian / jjj1995 / BillyGating | thin CSV | Board PnL huge but first fetch under-pulled history — **re-fetch deeper** |
| Capman / Vetch / Jhon | proven_bench | Great *while elite*, dead now |

## Is “drop ROI to 5% and trust the curve” better?

**For scout: yes.** Consistency + specialty shape finds HVAB-class *earlier*; unique ROI ~3–5% is enough to watch.

**For elite / Telegram: no — keep a hard copyable bar.** Path A recent take ROI or Path B dollar curve-book on core sports. Otherwise we Telegram ShortFlutter thrash again.

## Sustainable pocket (what “done” looks like)

1. Keep `expand_curve_scout_queue.py` + boards refresh in the daily pipeline  
2. Fetch **25+** missing watches every cycle until `missing_csv → 0` on sports survivors  
3. Re-run discovery walk-forward weekly → expect **several scouts** and **2–5 elites** when board coverage is real  
4. Manual test priority undigested (from `curve_scout_queue.json`): BillyGating, HongYunX ✓, ethanaz ✓, TennisLove (re-fetch), murgionsek (re-fetch), saftey-first, vito3corleone, jjj1995, kilian7kilian  

## Source of truth for “who to analyze next”

- Leaderboard: **https://www.polydata.org/leaderboard** (week/month sports, PnL)  
- Our pull: `pnl_analysis/output/polydata_boards.json`  
- Digest queue: `pnl_analysis/output/curve_scout_queue.json`  
- Live pocket: `pnl_analysis/output/verified_elite_roster.json`
