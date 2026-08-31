# Discovery timeline — manual test guide

Forward-honest: at each date below the system only knew data ≤ that alert time. No peeking at final ROI.

**Portfolio if we traded only while auto-elite:** n=393 · WR 61.6% · ROI+2¢ **+8.68%**

---

## How the forward loop works

1. **Watch** every non-mega digest wallet
2. At each of their fills, score **dollar equity curve**, specialty sport/submarket, median size, WR, activity
3. **Scout** when curve looks Capman/HVAB-like and they’re printing
4. **Elite** when Path A (recent copyable take ROI) or Path B (core-sport dollar curve-book) clears
5. **Bet** only if elite **and** Sniper: Q≥60, sport ROI≥+5%, rel≥2× median, 10–88¢, no NFL, fill +2¢
6. **Kick** when stale / recent-cold / curve collapse; **21d cooldown** before re-adding

Telegram today = **live elite only** (HVAB). Proven_bench = historically good, currently dark.

---

## Who we would have added (wallets + dates)

### Core names you care about

| Trader | Wallet | First scout | First elite | Why added (at the time) | Sniper backtest while elite | Status now |
|--------|--------|-------------|----------------|-------------------------|----------------------------|------------|
| **HVAB** | `0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8` | **2026-07-25** | **2026-08-13** | Emerging tennis curve ~92, unique ~+11%, med ~$1.2k, active30=169 | n=30 · +2.7% ROI · mostly tennis ML | **LIVE ELITE** |
| **Capman** | `0xc5b5bbd42624a8f0c8dfa90221913007d8c77e80` | **2025-12-22** | **2025-12-25** | Curve 85, unique +13%, NBA/NHL specialty, huge activity | n=52 · **+18.1%** · Dec 27→Jan 24 | Proven bench (stale since ~Mar) |
| **Vetch** | `0x9c82c60829df081d593055ee5fa288870c051f13` | (jumped) | **2025-11-26** | Direct elite: take 15/+19%, NBA@15% | n=69 · **+19.3%** · Nov 26→Mar 22 | Proven bench (stale) |
| **JhonAlexanderHinestroza** | `0x44c58184f89a5c2f699dc8943009cb3d75a08d45` | **2026-01-30** | **2026-02-04** | Emerging curve 100, unique +9.6%, soccer/esports mix | n=91 · **+28.5%** · Feb 5→Apr 13 | Proven bench (stale; equity flattened) |
| **Supah9ga** | `0x57cd939930fd119067ca9dc42b22b3e15708a0fb` | **2025-11-28** | **2026-03-22** | Early scout on esports/UCL; elite late on soccer specialty | n=8 · −68.9% (tiny elite window) | Proven bench (inactive ~3mo) |
| ShortFlutterStock | `0x13414a77a4be48988851c73dfd824d0168e70853` | 2025-11-12 | 2026-02-15 | Early-hot ESPORTS (would scout) | n=80 · **−1.0%** (cooldown cuts thrash) | Out — not the HVAB shape |
| SineNooneEI | `0x38337de21ff0bb0a11a40761507d51e318d633d1` | 2026-02-06 | — | Scouted once on 100% sports / hot curve | 0 elite trades | Active but **not** elite (see near-miss) |
| bigspending | `0x86dab59a8a6e7f9947282d2117aab3429b706428` | — | — | Never clears gates under hardened rules | 0 | Rejected (curve collapsed) |

### HVAB lifecycle (the template we want)

```
2026-07-25  SCOUT   curve=92  unique=+10.8%  TENNIS n=148 @+11%  median~$1232  emerging
2026-08-13  ELITE   Path A take=12/+11.7%  TENNIS@19.8%  curve=100
2026-08-14… Sniper alerts fire (tennis ML, rel 2–30×, Q~80)
2026-08-25  soft dip to scout (unit take soft; dollar curve still green)
2026-08-29  ELITE   Path B curve-book unique=+16.7% TENNIS@17.4%  ← still elite today
```

**Style card now:** median ~$1.9k · WR ~73% · TENNIS ML primary · unique dollar ROI ~+15% · curve score ~100

### Capman lifecycle (found before he went dark)

```
2025-12-22  SCOUT   curve=85  unique=+13.4%  NBA/NHL  active30=804
2025-12-25  ELITE   (3 days later)
2025-12-27→2026-01-24  52 sniper trades @ +18%
~Mar 2026  goes quiet → kicked stale → proven_bench (not Telegram)
```

---

## Plays we would have bet (HVAB sample — last elite window)

| Date | W/L | Unit PnL | Q | Rel | Sport | Market |
|------|-----|----------|---|-----|-------|--------|
| 2026-08-14 | W | +$46.63 | 81 | 3.5× | TENNIS | Cincinnati: Boulter vs Volynets |
| 2026-08-14 | L | −$100 | 81 | 8.9× | TENNIS | same card (other side/fill) |
| 2026-08-14 | W | +$36.80 | 81 | 3.0× | TENNIS | Astana: Cui vs Dougaz |
| 2026-08-21 | W | +$160.28 | 81 | 30× | TENNIS | Sion: Giustino vs Hassan |
| 2026-08-24 | W | +$49.59 | 83 | 2.8× | TENNIS | USO Qual: Den Ouden vs Alberto |
| 2026-08-25 | W | +$40.83 | 80 | 6.1× | TENNIS | USO Qual: Tomic vs Harris |
| 2026-08-25 | W | +$19.27 | 80 | 12.7× | TENNIS | Kingston: Chopra vs Bigun |

Full tape: `pnl_analysis/output/walkforward_elite_discovery.json` → `last_trades` / by_trader.

---

## Live roster after recent changes

| Bucket | Who | Action |
|--------|-----|--------|
| **Telegram / Sniper elite** | **HVAB only** | Added by discovery; keep while active + curve holds |
| **Proven bench** | Capman, Vetch, Jhon, Supah9ga | Do **not** auto-trade; re-scout if they print again |
| **Not added** | bigspending, predictionlegend | Curve/unique red |
| **Scouted historically, not elite now** | SineNooneEI, HedgeMaster88, ShortFlutter, … | Watch list only |

---

## Who is close — and what it takes

| Trader | Wallet | Active30 | Blocker | To get on Telegram |
|--------|--------|----------|---------|-------------------|
| **SineNooneEI** | `0x38337…633d1` | 274 | Volume leader = ESPORTS @ **+4%** (need specialty ≥+8% @ n≥20). Tennis pocket is strong (+21%) but not top-by-count. Recent take ROI **−17%** | Either ESPORTS unique/specialty ROI rises to ≥8%, or Path A recent-40 take ROI ≥+5% with n≥12. Path B blocked for ESPORTS-primary |
| 0xE30E74… | `0xe30e74595517…` | 35 | Median **~$38k** (unjoinable) | Size down into joinable band (&lt;~$15k median) + take sample |
| HedgeMaster88 | `0x036c159d5a34…` | 0 | Stale; recent take soft | Resume printing (active30≥12) + recent take ≥+5% |
| bigspending | `0x86dab59a8a6e…` | 59 | Curve **13**, unique **−12.7%** | Needs full equity repair — not close |
| predictionlegend | `0x3eb095…` | 53 | Curve **11**, unique **−6%** | Same — not close |

**Scout gates:** n≥25 closed · active30≥12 · sports≥55% · curve≥55 · unique≥5% · real-sport specialty · joinable median/WR  
**Elite Path A:** specialty OK + recent-40 take n≥12 ROI≥+5%  
**Elite Path B (HVAB):** core sport (tennis/NBA/soccer/…) + unique≥10% + curve≥70 + specialty ROI≥12%

---

## Manual test checklist

1. Open HVAB wallet `0x8546a6…35b8` on Polymarket from **2026-07-25** — confirm tennis-heavy upward dollar curve  
2. From **2026-08-13**, only copy prints that would pass Sniper (Q/rel/price/sport)  
3. Capman `0xc5b5bb…7e80` from **2025-12-22** scout → elite **Dec 25** → stop when activity dies (~Mar)  
4. Vetch / Jhon: elite windows in table above; confirm flat/stale recently  
5. Confirm bigspending is **not** on any live list after hardening  

Machine-readable detail: `pnl_analysis/output/discovery_manual_timeline.json`
