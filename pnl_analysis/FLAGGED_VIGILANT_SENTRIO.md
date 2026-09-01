# Vigilant-Environment + sentrio — why the funnel missed them (and whether we should copy)

You found these on **polymarketanalytics.com** sports leaderboard (page 3, active filter). Full digest + walk-forward below.

---

## TL;DR

| Wallet | UI / recent sample | Full unique book | Scout? | Elite? | Sniper trades | Copy? |
|--------|-------------------|------------------|--------|--------|---------------|-------|
| **Vigilant-Environment** `0xdbdd4515…` | API recent ~**+50%** ROI, R² 0.97 | **+0.8%** lifetime · dashboard **−0.6%** · ESPORTS grinder | Brief **2026-08-16** → kicked same day | Never | **0** | **No** — MM/hedge book |
| **sentrio** `0xdb83e85f…` | API recent ~**+9%** ROI, scout_candidate | **−0.7%** lifetime · **15.5k hedges** | Never | Never | **0** | **No** — grinder/MM |

**Neither is HVAB-class.** They look good on leaderboard/recent windows because high-volume hedgers can print smooth *dashboard* curves while unique hold-to-res ROI is flat or negative. Our system is working as designed by **not** Telegramming them.

---

## Why we didn't "find" them automatically

### Vigilant-Environment (`0xdbdd45150249e229eb4ca8aa48a30dca21faa5de`)

| Stage | What happened |
|-------|---------------|
| Polymarket Analytics | Visible page 3 sports active — **not wired as a discovery source** |
| Polydata boards | **Not present** (account created Sep 2025; may not hit Polydata PnL/vol floors on month window) |
| `extra_traders.json` | **Not ingested** until this manual pull |
| API curve screen | Recent 330 closes look elite (+50% ROI) but **sports_frac_est=35%** fails cheap screen; title tagging weak |
| Full digest | **40k rows** · C-Tier · **8,218 hedges** · ESPORTS −5.5% on 8.3k events |
| Walk-forward | **Skipped in production** (`DISCOVERY_MAX_CSV_ROWS=20k`); manual run: scout **2026-08-16**, kicked **33 min later** (`hard_unique_roi=-1.5%`) |

**Root miss:** coverage (never ingested) + Polymarket Analytics not in funnel. Even after ingest, **correct outcome is watch/reject**, not elite.

### sentrio (`0xdb83e85ffd22faa4009273034770f96ffc5b1e50`)

| Stage | What happened |
|-------|---------------|
| Polymarket Analytics | User find on page 3 |
| Polydata week_sports | **Rank 50** — present in `polydata_boards.json` |
| Polydata screen | **Rejected:** `thin_pnl` ($4.7k week) + **`pnl/vol=1.4%_grinder`** (need ≥5%) |
| API curve screen | **Scout candidate** on recent 265 closes (+9% ROI) |
| Full digest | **36k rows** · C-Tier · **15,518 hedges** · lifetime unique **−0.66%** |
| Walk-forward | Never scouted (lifetime unique negative; no real-sport specialty ≥5%) |

**Root miss:** Polydata grinder gate correctly dropped them from auto-watch; API screen would queue them but **full book kills elite path**.

---

## Style cards (full unique book)

### Vigilant-Environment

- **Lifetime unique ROI:** +0.76% (hold-to-res) · **Dashboard PnL:** −$128k
- **Median stake:** ~$596 · **WR:** 46% · **Sports mix:** 73%
- **Where PnL lives:** OTHER +5.9% (6.9k), MLB +7.6%, WNBA +11% — **ESPORTS −0.7%** (9.9k events), TENNIS −7%
- **Best specialty pocket:** SOCCER (UCL) +16% (n=204) — too thin for Path B
- **Activity:** ~2,900 markets / 30d — hyper-active grinder, not a tailable specialist

### sentrio

- **Lifetime unique ROI:** −0.66% · **Dashboard PnL:** −$147k
- **Median stake:** ~$874 · **WR:** 45% · **Sports mix:** 80%
- **Only green lane:** SOCCER (EPL) +8.5% (n=332) — everything else flat/negative
- **Hedge/MM:** 15,518 hedge legs — classic inventory book
- **Activity:** ~2,900 markets / 30d

---

## Walk-forward timeline (forward-honest)

### Vigilant-Environment

```
2026-08-16  SCOUT   curve=67  unique=+3.1%  emerging  ESPORTS/SOCCER mix  active30=252
2026-08-16  KICK    hard_unique_roi=-1.5%  (same day)
→ never ELITE → 0 Sniper trades
```

If we had been watching from Aug 16, we would **not** have tailed anything — kicked before any elite window.

### sentrio

```
Never SCOUT → never ELITE → 0 Sniper trades
```

Recent API heat (+9%) does not survive full-book specialty / unique gates.

---

## The leaderboard illusion (why you see them, we don't Telegram)

Polymarket Analytics / Polydata rank by **dashboard PnL** (realized + open cash) over a window. High-volume accounts that:

- hedge both sides,
- run inventory across esports/soccer totals,
- and catch a hot recent streak

…can sit **page 3 sports active** with a pretty equity chart while **unique directional ROI** is ~0% or negative.

Our copy product needs **Capman/HVAB shape**:

1. Smooth **dollar equity** on hold-to-res
2. **Real sport specialty** with joinable median
3. **Elite take-slice** or curve-book confirm
4. **Sniper-sized** relative bets we can fill at +2¢

These two fail (3) and mostly fail (1) on the full book.

---

## What to fix in the funnel (still valid)

1. **Add Polymarket Analytics / data-api leaderboard** as discovery source — so Vigilant-class names enter the API screen queue without manual links.
2. **Keep grinder gates** on Polydata PnL/vol — sentrio is exactly why they exist.
3. **API screen → digest scouts → full-book walk-forward** — recent +50% must not skip full digest (Mysaria lesson).
4. **Raise `DISCOVERY_MAX_CSV_ROWS` or use closed-only subsample** for mega tapes so brief scout/kick events aren't invisible in production.
5. **Bot/MM tag:** hedge_count / events ratio — auto-downrank before watch list (both wallets >35% hedge legs).

Artifacts: `output/user_flagged_two_analysis.json`, `output/Vigilant-Environment_0xdbdd45.json`, `output/sentrio_0xdb83e8.json`.
