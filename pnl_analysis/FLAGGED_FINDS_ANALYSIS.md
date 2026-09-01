# User-flagged finds + API-first path

## Better way than hoarding every CSV

**Yes — there is a better way.** Full local digests are for books that already passed a cheap screen, not for every Polydata name.

| Stage | What | Local disk? |
|-------|------|-------------|
| 1. Leaderboard | Polydata week/month sports API | JSON only |
| 2. API curve screen | Bounded `data-api` closed-positions sample (~400 recent) in memory | **No mega CSV** |
| 3. Bot/MM reject | Tiny median + politics/OTHER + low WR → drop (Mysaria-class) | Never digest |
| 4. Scout digest | Full CSV only for `scout_candidate` | Keep + refresh |
| 5. Elite / Telegram | Walk-forward + Sniper | Refresh while active; drop when stale |

Script: `pnl_analysis/api_curve_screen.py` → `output/api_curve_screen.json`.

Always-on loop: boards → API screen → digest scouts → walk-forward → kick cold.

---

## The four you named

### RegardedMoney = **CoryLahey** (same wallet `0x5c3a1a60…020b`)

| | |
|--|--|
| Unique book | +5.5% ROI · med ~$9.4k · WR 59% · soccer/NBA |
| **First scout** | **2026-01-25** |
| **First elite** | **2026-02-07** |
| Sniper while elite | **51 trades · +$406 unit** (Feb 8 → Mar 8) |
| **Now** | **SCOUT** (curve 91, active30=53) — not Telegram yet (recent take soft) |

We **would have caught** them in late Jan and traded them as elite in Feb.

### ic4cream `0x27f738fe…44b0` — your screenshot type

| | |
|--|--|
| Profile PnL | +$386k past year (UI) |
| Unique book lifetime | **−2.1%** (early drawdowns dominate) |
| Last 90d unique | **+3.0%** · active as hell (1600+ markets) |
| API recent sample | **~+64% ROI · R² 0.99** ← matches “few months of excellence” |
| How they make money | **MLB** ML/totals (+5–6%), soccer ML (+8%), mixed NBA (−20% lifetime) · med ~$1.6k · joinable |
| **First scout** | **2026-04-03** (emerging, curve 100, unique then +26%) |
| **First elite** | **2026-04-05** |
| Sniper | 18 trades · +$158 (short elite window early April) |
| Kick | Apr 12 — lifetime unique dipped under 0 |

We **would have found them in early April** as they came out of the hole. We then over-kicked on lifetime unique. **Turnaround scout path** added so recent heat can keep them on watch even if early year was red.

### Shori888 `0xa36fcb69…180b`

| | |
|--|--|
| Unique | **+15.2%** · med ~$5k · soccer-heavy |
| Edge | Soccer **totals** +16%, EPL sample hot · last90 **+9.6%** |
| **First scout** | **2026-06-20** (curve 100, unique +40% emerging) |
| Elite | Never cleared take Path A yet (take n=11, soft) |
| **Now** | Cooldown after Aug 26 scout drop — will re-scout when cooldown ends |

We **would have caught** them mid-June as a scout. Needs a clean take-slice for elite/Telegram.

### Mysaria `0xe40aaa5c…e4a2` — do **not** copy

| | |
|--|--|
| Local digest | **~30k rows** · unique **−49%** · WR **21%** · med **$310** |
| Sports | Almost all **OTHER + POLITICS** — not HVAB sports specialist |
| What the pretty curve is | Temperature / inventory / MM-style mark — **not** directional copy edge |
| Replicate? | **You can’t** by tailing fills. That curve is the bot’s inventory PnL shape, not a sport-specialty EV we can Sniper. |

API sample can look “okay”; full unique book exposes the bot. **Screen rejects → never full-digest again.**

---

## Pocket after this pull

| Tier | Who |
|------|-----|
| Elite | HVAB |
| Scout | RegardedMoney/CoryLahey, HongYunX, SineNooneEI · (ic4cream should re-enter via turnaround path) |
| Watch/cooldown | Shori888 |
| Reject | Mysaria (bot) |

---

## Going forward

1. Run `api_curve_screen.py` on board survivors daily (minutes, not hours)  
2. Full digest **only** scout_candidates  
3. Refresh active scouts/elites; delete CSVs for kicked/bot/stale  
4. Never treat Polymarket profile PnL as unique-book ROI (ic4cream +$386k UI vs −2% unique)
