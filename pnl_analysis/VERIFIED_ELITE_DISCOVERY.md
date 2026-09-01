# Verified Elite Discovery — walk-forward (find HVAB/Capman-class early)

Generated **2026-08-31T17:40:56 UTC**.

## What this proves

This is **not** picking Capman/Vetch then backtesting them. At each time T the system:
1. Scores every book’s **equity curve + style** with data ≤ T only
2. Auto-promotes **Scout** (early curve) → **Elite** (confirmed)
3. Trades Sniper gates only while Elite
4. Kicks stale / bleed / curve collapse

## Portfolio (auto-found elites only)

- **n=393** · WR **61.58%** · ROI+2¢ **8.68%** · PnL **$3411.05** · PF 1.226 · maxDD $-1759.99
- Span 2025-01-31 → 2026-09-01 · ~3.22/day
- Passes 5% bar: **True**

### Leave-one-out

- Drop **Andromeda1**: n=370 WR=62.43% ROI=10.18%
- Drop **Capman**: n=341 WR=60.12% ROI=7.24%
- Drop **DLEK**: n=378 WR=62.17% ROI=9.9%
- Drop **EIf**: n=370 WR=62.43% ROI=9.78%
- Drop **HVAB**: n=363 WR=61.43% ROI=9.18%
- Drop **JhonAlexanderHinestroza**: n=302 WR=60.93% ROI=2.72%
- Drop **ShortFlutterStock**: n=313 WR=64.22% ROI=11.15%
- Drop **Supah9ga**: n=385 WR=62.34% ROI=10.29%
- Drop **Vetch**: n=324 WR=57.72% ROI=6.42%
- Drop **kch123**: n=391 WR=61.64% ROI=8.74%

### By auto-found trader

- **JhonAlexanderHinestroza**: n=91 WR=63.74% ROI=28.45% (first elite trade 2026-02-05 → 2026-04-13)
- **ShortFlutterStock**: n=80 WR=51.25% ROI=-0.99% (first elite trade 2026-02-16 → 2026-04-04)
- **Vetch**: n=69 WR=79.71% ROI=19.3% (first elite trade 2025-11-26 → 2026-03-22)
- **Capman**: n=52 WR=71.15% ROI=18.12% (first elite trade 2025-12-27 → 2026-01-24)
- **HVAB**: n=30 WR=63.33% ROI=2.68% (first elite trade 2026-08-20 → 2026-09-01)
- **Andromeda1**: n=23 WR=47.83% ROI=-15.5% (first elite trade 2025-11-30 → 2025-12-07)
- **EIf**: n=23 WR=47.83% ROI=-8.99% (first elite trade 2025-12-05 → 2025-12-14)
- **DLEK**: n=15 WR=46.67% ROI=-22.1% (first elite trade 2025-01-31 → 2025-02-20)
- **Supah9ga**: n=8 WR=25.0% ROI=-68.85% (first elite trade 2026-03-22 → 2026-04-13)
- **kch123**: n=2 WR=50.0% ROI=-3.51% (first elite trade 2025-11-26 → 2025-11-27)

## Live roster now

### Elite (Telegram / Sniper)

- **HVAB** curve=99.525 unique=15.01% take=39/-4.09% active30=230 median=$1874.02 · TENNIS n=331 (14.9%), OTHER n=204 (15.2%), SOCCER (Other) n=21 (14.1%)
  - elite curve-book unique=15.0% spec=TENNIS@14.9% take=39/-4.1% curve=100 wr_band active30=230

### Scout (watching — not Telegram yet)

_None._

### Proven but stale (kicked — will re-scout when active)

- **Supah9ga** take=21/30.9% curve=83.75999999999999 · stale_30d_n=0
- **Vetch** take=83/11.96% curve=83.58500000000001 · stale_30d_n=0
- **JhonAlexanderHinestroza** take=85/22.2% curve=81.16 · stale_30d_n=0
- **Capman** take=52/18.12% curve=None · proven_stale_inactive

## First discoveries (when the system found them)

- 2024-12-28 **DLEK** → scout: scout curve=90 roi=9.3% spec=NBA sports=95% active30=31
- 2025-08-13 **ShucksIt69** → scout: scout curve=96 roi=37.5% spec=MLB sports=89% active30=28
- 2025-10-02 **Andromeda1** → scout: scout curve=97 roi=23.0% spec=ESPORTS,SOCCER (EPL) sports=60% emerging active30=173
- 2025-10-17 **0x53eCc53E7** → scout: scout curve=82 roi=9.6% spec=NBA sports=55% active30=16
- 2025-10-19 **kch123** → scout: scout curve=87 roi=5.6% spec=NHL,SOCCER (Other) sports=55% emerging active30=294
- 2025-10-23 **bloodmaster** → scout: scout curve=95 roi=6.1% spec=ESPORTS sports=59% emerging active30=23
- 2025-11-12 **ShortFlutterStock** → scout: scout curve=98 roi=25.9% spec=ESPORTS,NHL sports=93% emerging active30=42
- 2025-11-21 **EIf** → scout: scout curve=100 roi=10.4% spec=NBA,NHL sports=59% emerging active30=234
- 2025-11-26 **Vetch** → elite: elite take=15/19.0% spec=NBA@15.3% curve=91 wr_band active30=116
- 2025-11-28 **Supah9ga** → scout: scout curve=77 roi=7.2% spec=ESPORTS,SOCCER (UCL) sports=71% emerging active30=56
- 2025-12-10 **0xheavy888** → scout: scout curve=77 roi=6.3% spec=ESPORTS sports=78% active30=687
- 2025-12-22 **Capman** → scout: scout curve=85 roi=13.4% spec=NBA,NHL sports=63% active30=804
- 2026-01-01 **UAEVALORANTFAN** → scout: scout curve=100 roi=30.2% spec=NBA,ESPORTS sports=82% emerging active30=66
- 2026-01-30 **JhonAlexanderHinestroza** → scout: scout curve=100 roi=9.6% spec=SOCCER (Other),ESPORTS sports=66% emerging active30=273
- 2026-01-31 **9sh8f** → scout: scout curve=100 roi=6.0% spec=ESPORTS,NBA sports=92% emerging active30=189
- 2026-02-01 **TheArena** → scout: scout curve=76 roi=7.2% spec=ESPORTS sports=76% emerging active30=207
- 2026-02-06 **SineNooneEI** → scout: scout curve=95 roi=37.8% spec=ESPORTS sports=100% emerging active30=33
- 2026-02-26 **HedgeMaster88** → scout: scout curve=84 roi=34.2% spec=SOCCER (Other),SOCCER (UCL) sports=97% emerging active30=29
- 2026-03-29 **TTdes** → scout: scout curve=100 roi=8.9% spec=NHL,SOCCER (Other) sports=95% active30=220
- 2026-07-25 **HVAB** → scout: scout curve=92 roi=10.8% spec=TENNIS,SOCCER (Other) sports=61% emerging active30=169

## Last 15 trades (would have alerted)

- 2026-08-25 L $-100.0 **HVAB** Q=80 · US Open, Qualification ATP: Bernard Tomic vs Lloyd
- 2026-08-25 W $19.27 **HVAB** Q=80 · Kingston 2: Keshav Chopra vs Kaylan Bigun
- 2026-08-25 W $40.83 **HVAB** Q=80 · US Open, Qualification ATP: Bernard Tomic vs Lloyd
- 2026-08-24 W $49.59 **HVAB** Q=83 · US Open, Qualification ATP: Guy Den Ouden vs Genar
- 2026-08-24 L $-100.0 **HVAB** Q=83 · Roehampton 2: Inaki Montes-De La Torre vs Oskari P
- 2026-08-24 W $33.28 **HVAB** Q=83 · US Open, Qualification WTA: Rebeka Masarova vs Iry
- 2026-08-24 L $-100.0 **HVAB** Q=83 · US Open, Qualification WTA: Rebeka Masarova vs Iry
- 2026-08-24 W $28.75 **HVAB** Q=83 · US Open, Qualification ATP: Titouan Droguet vs Dan
- 2026-08-22 W $49.1 **HVAB** Q=81 · Quebec City: Hugo Gaston vs Luca Van Assche
- 2026-08-21 W $29.17 **HVAB** Q=81 · ITF W35 Verbier Women: Angella Okutoyi vs Valentin
- 2026-08-21 W $160.28 **HVAB** Q=81 · Sion: Lorenzo Giustino vs Benjamin Hassan
- 2026-08-19 W $29.33 **HVAB** Q=82 · ITF W75 Kursumlijska Banja 3 Women: Beatrice Ricci
- 2026-08-19 W $55.45 **HVAB** Q=82 · ITF W35 Krakow Women: Oriana Gniewkowska vs Georgi
- 2026-08-19 L $-100.0 **HVAB** Q=82 · Cincinnati Open: Learner Tien vs Frances Tiafoe
- 2026-08-19 L $-100.0 **HVAB** Q=82 · Cancun: Lloyd Harris vs Laslo Djere

## Rules

- **Scout**: n≥25, active30≥12, sports≥55%, curve_score≥55.0, unique ROI≥5.0%, real-sport specialty, joinable.
- **Elite**: specialty + (Path A: recent-40 take ROI≥5.0% @ n≥12) or (Path B curve-book: unique≥10.0% curve≥70.0 on core sports).
- **Kick (hard)**: stale, dollar collapse, recent-cold take, or re-entry cooldown 21d.
- **Trade**: Elite + Sniper gates (Q≥60, sport+5%, rel≥2×, 10–88¢, no NFL).
- **Product roster**: Telegram = live elite only. Scouts watch. Proven_bench = stale but historically green.

