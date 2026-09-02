# 30-day would-have take book

This is **not** a live fill tape and **not** invented PnL. It is the as-of Q60 + sport + 2× size + 10–88¢ + no NFL rule, applied to resolved unique books already in `pnl_analysis/output`. Fill = their VWAP + 2¢. Stake = $100.

Window: last **30** days of resolved tape ending **2026-04-13** (wall clock 2026-09-02). Source: `collect_plays from 13 live/trusted CSVs`.

## How to read the table

- **n** = tickets the rule would have taken (resolved in-window).
- **WR / ROI +2¢ / PnL** = hold-to-resolution at VWAP+2¢, flat $100.
- **Equity** = cumulative unit PnL in date order. Empty curve = no would-have prints.
- A trader with **blocked** status has no usable CSV/warmup — we do not zero-fill them.
- This is *would have*, not *did fill*. Live CLOB ask can still reject a ticket.

## Book

n=105 · WR 64.76% · ROI +2¢ 1.27% · PnL $133.16 · max DD $-694.01

| Trader | n | WR | ROI +2¢ | PnL $ | Max DD | Last |
|--------|--:|---:|--------:|------:|-------:|------|
| Capman | 67 | 76.12% | 13.78% | 922.95 | -365.85 | 2026-04-08 |
| HedgeMaster88 | 20 | 50.0% | -16.66% | -333.2 | -558.49 | 2026-03-23 |
| Supah9ga | 11 | 36.36% | -19.92% | -219.07 | -663.01 | 2026-04-13 |
| Vetch | 7 | 42.86% | -33.93% | -237.52 | -250.29 | 2026-03-18 |

## Blocked (no honest tape)

- 8a3a: no trader CSV on disk — not zero-filled
- HVAB: no trader CSV on disk — not zero-filled

## Plays the rule would have taken

| Date | Trader | Play | Won | Fill | PnL |
|------|--------|------|:---:|-----:|----:|
| 2026-03-14 | Capman | Nets vs. 76ers | Y | 0.7 | 42.86 |
| 2026-03-14 | HedgeMaster88 | Atlanta United FC vs. Philadelphia Union: O/U 2.5 | Y | 0.52 | 92.13 |
| 2026-03-14 | HedgeMaster88 | Will Chelsea FC win on 2026-03-14? | N | 0.57 | -100.0 |
| 2026-03-14 | HedgeMaster88 | Charlotte FC vs. Inter Miami CF: O/U 2.5 | N | 0.6 | -100.0 |
| 2026-03-14 | HedgeMaster88 | Will Real Madrid CF win on 2026-03-14? | Y | 0.78 | 28.21 |
| 2026-03-14 | Vetch | Valorant: Paper Rex vs G2 Esports (BO3) - VCT Masters Santiago Playoff | N | 0.509 | -100.0 |
| 2026-03-15 | HedgeMaster88 | Liverpool FC vs. Tottenham Hotspur FC: O/U 2.5 | N | 0.73 | -100.0 |
| 2026-03-15 | Capman | UFC Fight Night: Brad Tavares vs. Eryk Anders (Middleweight, Prelims) | Y | 0.607 | 64.77 |
| 2026-03-15 | Capman | Penn Quakers vs. Yale Bulldogs | N | 0.692 | -100.0 |
| 2026-03-15 | Vetch | Counter-Strike: FUT Esports vs Astralis (BO3) - ESL Pro League Playoff | Y | 0.47 | 112.77 |
| 2026-03-15 | Capman | UFC Fight Night: Andre Fili vs. Jose Miguel Delgado (Featherweight, Pr | Y | 0.784 | 27.53 |
| 2026-03-15 | Capman | Penn Quakers vs. Yale Bulldogs | Y | 0.467 | 114.24 |
| 2026-03-15 | HedgeMaster88 | Will Stade Rennais FC 1901 win on 2026-03-15? | Y | 0.58 | 72.41 |
| 2026-03-15 | HedgeMaster88 | Will Cruzeiro EC win on 2026-03-15? | N | 0.526 | -100.0 |
| 2026-03-15 | HedgeMaster88 | Liverpool FC vs. Tottenham Hotspur FC: O/U 3.5 | N | 0.506 | -100.0 |
| 2026-03-15 | HedgeMaster88 | Will FC Cincinnati win on 2026-03-15? | Y | 0.71 | 40.89 |
| 2026-03-15 | Capman | Kings vs. Clippers | Y | 0.456 | 119.46 |
| 2026-03-16 | Vetch | Valorant: Nongshim RedForce vs Paper Rex (BO5) - VCT Masters Santiago  | N | 0.551 | -100.0 |
| 2026-03-16 | Capman | Warriors vs. Knicks | Y | 0.88 | 13.69 |
| 2026-03-16 | Vetch | LoL: G2 Esports vs Team Secret Whales (BO5) - First Stand Group A | Y | 0.826 | 21.12 |
| 2026-03-16 | Capman | Suns vs. Celtics | Y | 0.362 | 176.58 |
| 2026-03-17 | Vetch | BNP Paribas Open: Novak Djokovic vs Jack Draper | N | 0.595 | -100.0 |
| 2026-03-17 | Capman | UNCW Seahawks vs. Yale Bulldogs | Y | 0.722 | 38.53 |
| 2026-03-17 | Capman | Spurs vs. Clippers: O/U 232.5 | Y | 0.797 | 25.46 |
| 2026-03-17 | Vetch | LoL: LYON vs LOUD (BO5) - First Stand Group B | Y | 0.778 | 28.59 |
| 2026-03-17 | Capman | Liberty Flames vs. George Mason Patriots | Y | 0.78 | 28.12 |
| 2026-03-17 | Capman | Lakers vs. Rockets | Y | 0.82 | 21.95 |
| 2026-03-17 | HedgeMaster88 | Will Real Madrid CF win on 2026-03-17? | N | 0.85 | -100.0 |
| 2026-03-17 | HedgeMaster88 | Manchester City FC vs. Real Madrid CF: Both Teams to Score | N | 0.444 | -100.0 |
| 2026-03-17 | Capman | Thunder vs. Magic: O/U 220.5 | Y | 0.897 | 11.54 |
| 2026-03-18 | Capman | Cavaliers vs. Bucks | Y | 0.801 | 24.92 |
| 2026-03-18 | Vetch | LoL: Bilibili Gaming vs G2 Esports (BO5) - First Stand Group A | N | 0.2 | -100.0 |
| 2026-03-18 | Capman | Stephen F. Austin Lumberjacks vs. Tulsa Golden Hurricane | N | 0.426 | -100.0 |
| 2026-03-19 | Capman | Texas A&M Aggies vs. Saint Mary's Gaels | Y | 0.87 | 14.91 |
| 2026-03-19 | Capman | Clippers vs. Pelicans | Y | 0.87 | 14.94 |
| 2026-03-19 | HedgeMaster88 | Will FC Midtjylland vs. Nottingham Forest FC end in a draw? | Y | 0.74 | 35.14 |
| 2026-03-19 | HedgeMaster88 | FC Porto vs. VfB Stuttgart: O/U 2.5 | Y | 0.504 | 98.33 |
| 2026-03-19 | Capman | TCU Horned Frogs vs. Ohio State Buckeyes | Y | 0.658 | 51.9 |
| 2026-03-19 | Capman | Magic vs. Hornets | N | 0.36 | -100.0 |
| 2026-03-19 | Capman | McNeese State Cowboys vs. Vanderbilt Commodores: O/U 147.5 | Y | 0.63 | 58.7 |
| 2026-03-19 | Capman | VCU Rams vs. North Carolina Tar Heels | Y | 0.473 | 111.36 |
| 2026-03-20 | Capman | Spread: Virginia Cavaliers (-5.5) | N | 0.593 | -100.0 |
| 2026-03-20 | Capman | Santa Clara Broncos vs. Kentucky Wildcats | Y | 0.495 | 101.86 |
| 2026-03-20 | Capman | Iowa Hawkeyes vs. Clemson Tigers: O/U 128.5 | Y | 0.825 | 21.23 |
| 2026-03-21 | Capman | Lakers vs. Magic | Y | 0.683 | 46.38 |
| 2026-03-21 | Capman | Lakers vs. Magic: O/U 234.5 | N | 0.53 | -100.0 |
| 2026-03-21 | Capman | High Point Panthers vs. Arkansas Razorbacks | Y | 0.703 | 42.16 |
| 2026-03-21 | Capman | Spread: Florida Gators (-35.5) | Y | 0.512 | 95.38 |
| 2026-03-21 | HedgeMaster88 | Nashville SC vs. Orlando City SC: O/U 2.5 | Y | 0.625 | 60.09 |
| 2026-03-21 | Capman | Vanderbilt Commodores vs. Nebraska Cornhuskers | N | 0.732 | -100.0 |
| 2026-03-21 | HedgeMaster88 | Will Columbus Crew win on 2026-03-21? | Y | 0.593 | 68.76 |
| 2026-03-21 | Capman | Texas Longhorns vs. Gonzaga Bulldogs: O/U 141.5 | Y | 0.584 | 71.17 |
| 2026-03-21 | HedgeMaster88 | Philadelphia Union vs. Chicago Fire FC: O/U 2.5 | Y | 0.54 | 85.19 |
| 2026-03-22 | Capman | Kentucky Wildcats vs. Iowa State Cyclones: O/U 146.5 | Y | 0.81 | 23.4 |
| 2026-03-22 | Supah9ga | Will Newcastle United FC win on 2026-03-22? | Y | 0.39 | 156.41 |
| 2026-03-22 | Supah9ga | Will Stade Rennais FC 1901 win on 2026-03-22? | Y | 0.266 | 275.35 |
| 2026-03-22 | HedgeMaster88 | Will Real Madrid CF win on 2026-03-22? | N | 0.517 | -100.0 |
| 2026-03-22 | Supah9ga | Will AS Roma win on 2026-03-22? | N | 0.36 | -100.0 |
| 2026-03-22 | Supah9ga | Will Real Madrid CF win on 2026-03-22? | N | 0.527 | -100.0 |
| 2026-03-22 | Capman | Miami Hurricanes vs. Purdue Boilermakers: O/U 147.5 | Y | 0.714 | 40.06 |
| 2026-03-22 | HedgeMaster88 | Will San Diego FC win on 2026-03-22? | N | 0.519 | -100.0 |
| 2026-03-22 | HedgeMaster88 | FC Nantes vs. RC Strasbourg Alsace: O/U 2.5 | N | 0.529 | -100.0 |
| 2026-03-22 | Supah9ga | Will Club Atlético de Madrid win on 2026-03-22? | Y | 0.73 | 36.99 |
| 2026-03-23 | Capman | Raptors vs. Suns | N | 0.3 | -100.0 |
| 2026-03-23 | Capman | Timberwolves vs. Celtics | N | 0.52 | -100.0 |
| 2026-03-23 | HedgeMaster88 | Will AA Argentinos Juniors win on 2026-03-22? | Y | 0.539 | 85.67 |
| 2026-03-23 | Capman | Lakers vs. Pistons | Y | 0.783 | 27.73 |
| 2026-03-24 | Capman | Blue Jackets vs. Flyers | Y | 0.61 | 63.91 |
| 2026-03-25 | Capman | Miami Open: Aleksandar Kovacevic vs Rei Sakamoto | Y | 0.559 | 79.04 |
| 2026-03-26 | Capman | Miami Open: Valentin Royer vs Thiago Agustin Tirante | Y | 0.789 | 26.7 |
| 2026-03-26 | Capman | Nebraska Cornhuskers vs. Iowa Hawkeyes | N | 0.63 | -100.0 |
| 2026-03-26 | Capman | Nets vs. Warriors | N | 0.239 | -100.0 |
| 2026-03-26 | Capman | Miami Open: Valentin Royer vs Thiago Agustin Tirante | N | 0.304 | -100.0 |
| 2026-03-26 | Capman | Wild vs. Panthers | Y | 0.841 | 18.84 |
| 2026-03-26 | Capman | Nets vs. Warriors | Y | 0.694 | 44.01 |
| 2026-03-27 | Capman | Tennessee Volunteers vs. Iowa State Cyclones | Y | 0.492 | 103.25 |
| 2026-03-27 | Capman | Clippers vs. Pacers | Y | 0.799 | 25.19 |
| 2026-03-27 | Capman | Miami Open: Tommy Paul vs Adrian Mannarino | Y | 0.723 | 38.34 |
| 2026-03-28 | Capman | Jets vs. Avalanche | Y | 0.898 | 11.32 |
| 2026-03-28 | Capman | 76ers vs. Hornets | N | 0.265 | -100.0 |
| 2026-03-28 | Capman | Illinois Fighting Illini vs. Iowa Hawkeyes | Y | 0.736 | 35.91 |
| 2026-03-28 | Capman | Illinois Fighting Illini vs. Iowa Hawkeyes | N | 0.311 | -100.0 |
| 2026-03-28 | Capman | Tennessee Volunteers vs. Iowa State Cyclones: O/U 138.5 | Y | 0.85 | 17.69 |
| 2026-03-28 | Capman | Michigan State Spartans vs. Connecticut Huskies | Y | 0.796 | 25.58 |
| 2026-03-28 | Capman | 76ers vs. Hornets | Y | 0.427 | 134.02 |
| 2026-03-29 | Capman | Spread: Clippers (-13.5) | Y | 0.814 | 22.91 |
| 2026-03-29 | Capman | Spread: Trail Blazers (-19.5) | Y | 0.499 | 100.52 |
| 2026-03-29 | Capman | UFC Fight Night: Ignacio Bahamondes vs. Tofiq Musayev (Lightweight, Pr | N | 0.547 | -100.0 |
| 2026-03-29 | Capman | Miami Open: Carlos Alcaraz vs Sebastian Korda | Y | 0.592 | 68.83 |
| 2026-03-29 | Capman | Miami Open: Tommy Paul vs Raphael Collignon | Y | 0.866 | 15.46 |
| 2026-03-29 | Capman | Spread: Michigan Wolverines (-7.5) | Y | 0.87 | 14.94 |
| 2026-03-30 | Capman | 76ers vs. Heat | N | 0.72 | -100.0 |
| 2026-03-31 | Capman | Bulls vs. Spurs: O/U 242.5 | Y | 0.854 | 17.15 |
| 2026-03-31 | Capman | Pistons vs. Thunder | Y | 0.808 | 23.8 |
| 2026-03-31 | Capman | Suns vs. Magic | N | 0.52 | -100.0 |
| 2026-04-03 | Supah9ga | Will Paris Saint-Germain FC win on 2026-04-03? | N | 0.26 | -100.0 |
| 2026-04-04 | Capman | Credit One Charleston Open, Qualification: Aliona Bolsova vs Ekaterine | Y | 0.547 | 82.68 |
| 2026-04-04 | Supah9ga | Will FC Bayern München win on 2026-04-04? | N | 0.375 | -100.0 |
| 2026-04-05 | Capman | Colorado Rockies vs. Miami Marlins | Y | 0.538 | 85.76 |
| 2026-04-05 | Supah9ga | Will FC Internazionale Milano win on 2026-04-05? | N | 0.41 | -100.0 |
| 2026-04-07 | Capman | San Francisco Giants vs. San Diego Padres | Y | 0.843 | 18.64 |
| 2026-04-08 | Capman | Texas Rangers vs. Baltimore Orioles | Y | 0.85 | 17.64 |
| 2026-04-12 | Supah9ga | Will VfB Stuttgart win on 2026-04-12? | N | 0.26 | -100.0 |
| 2026-04-13 | Supah9ga | Will Rory McIlroy win the 2026 Masters tournament? | N | 0.32 | -100.0 |
| 2026-04-13 | Supah9ga | Will Scottie Scheffler win the 2026 Masters tournament? | Y | 0.891 | 12.18 |
