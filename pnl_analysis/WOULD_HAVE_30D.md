# 30-day would-have take book

This is **not** a live fill tape and **not** invented PnL. It is the as-of Q60 + sport + 2× size + 10–88¢ + no NFL rule, applied to resolved unique books in Postgres (`desk_unique_books`, fed by Polymarket activity/trades). Fill = their VWAP + 2¢. Stake = $100.

Window: last **30** days of resolved tape ending **2026-09-02** (wall clock 2026-09-02). Source: `postgres desk_unique_books (15 wallets, 687 as-of plays)`.

## How to read the table

- **n** = tickets the rule would have taken (resolved in-window).
- **WR / ROI +2¢ / PnL** = hold-to-resolution at VWAP+2¢, flat $100.
- **Equity** = cumulative unit PnL in date order. Empty curve = no would-have prints.
- A trader with **blocked** status is unresolved or has no honest tape — we do not zero-fill them.
- This is *would have*, not *did fill*. Live CLOB ask can still reject a ticket.

## Book

n=50 · WR 80.0% · ROI +2¢ 26.15% · PnL $1307.42 · max DD $-211.75

| Trader | n | WR | ROI +2¢ | PnL $ | Max DD | Last |
|--------|--:|---:|--------:|------:|-------:|------|
| HVAB | 42 | 76.19% | 11.29% | 474.26 | -211.75 | 2026-09-02 |
| 8a3a | 4 | 100.0% | 86.03% | 344.13 | 0.0 | 2026-08-22 |
| UAEVALORANTFAN | 4 | 100.0% | 122.26% | 489.03 | 0.0 | 2026-08-16 |

## Blocked (no honest tape)

- 20D6: no take-rule prints in window

## Plays the rule would have taken

| Date | Trader | Play | Won | Fill | PnL |
|------|--------|------|:---:|-----:|----:|
| 2026-08-07 | UAEVALORANTFAN | Valorant: Fnatic vs Enterprise Esports (BO3) - VCT EMEA Play-Ins | Y | 0.398 | 151.37 |
| 2026-08-07 | UAEVALORANTFAN | Valorant: Natus Vincere vs Joblife (BO3) - VCT EMEA Play-Ins | Y | 0.372 | 169.07 |
| 2026-08-07 | HVAB | Targu Mures: Sara Sorribes Tormo vs Lucia Bronzetti | Y | 0.88 | 13.64 |
| 2026-08-08 | HVAB | Canadian Open, Qualification: Alexei Popyrin vs Thanasi Kokkinakis | Y | 0.809 | 23.62 |
| 2026-08-08 | HVAB | Targu Mures: Kaitlin Quevedo vs Francesca Jones | Y | 0.725 | 37.87 |
| 2026-08-10 | HVAB | Hagen: Alex Molcan vs Chun-Hsin Tseng | Y | 0.783 | 27.67 |
| 2026-08-10 | HVAB | ITF W100 Landisville, PA Women: Ava Catanzarite vs Martina Okalova | Y | 0.776 | 28.81 |
| 2026-08-10 | 8a3a | National Bank Open: Alexei Popyrin vs Roman Andres Burruchaga | Y | 0.63 | 58.73 |
| 2026-08-10 | UAEVALORANTFAN | Valorant: Gentle Mates vs Enterprise Esports (BO3) - VCT EMEA Play-Ins | Y | 0.425 | 135.25 |
| 2026-08-11 | HVAB | ITF Londrina: Jose Pereira vs Mateus Alves | Y | 0.691 | 44.62 |
| 2026-08-13 | HVAB | National Bank Open: Anna Kalinskaya vs Diana Shnaider | Y | 0.72 | 38.89 |
| 2026-08-13 | 8a3a | National Bank Open: Raphael Collignon vs Alexei Popyrin | Y | 0.41 | 143.9 |
| 2026-08-14 | HVAB | ITF Ourense: Sonja Zhiyenbayeva vs Alicia Dudeney | Y | 0.76 | 31.61 |
| 2026-08-14 | 8a3a | Plovdiv 2: Adrian Andreev vs Petr Nesterov | Y | 0.581 | 72.01 |
| 2026-08-15 | HVAB | National Bank Open: Iva Jovic vs Alina Korneeva | Y | 0.69 | 44.93 |
| 2026-08-16 | UAEVALORANTFAN | LoL: Vivo Keyd Stars vs LOS (BO3) - CBLOL Regular Season | Y | 0.75 | 33.33 |
| 2026-08-17 | HVAB | Todi: Murkel Dellien vs Daniel Galan | N | 0.439 | -100.0 |
| 2026-08-18 | HVAB | National Bank Open: Jakub Mensik vs Ben Shelton | Y | 0.889 | 12.48 |
| 2026-08-18 | HVAB | ITF W35 Vigo Women: Celia Cervino Ruiz vs Francisca Jorge | Y | 0.621 | 61.02 |
| 2026-08-20 | HVAB | Cincinnati Open: Katie Boulter vs Katie Volynets | Y | 0.67 | 49.25 |
| 2026-08-20 | HVAB | Cincinnati Open: Katie Boulter vs Katie Volynets | N | 0.72 | -100.0 |
| 2026-08-21 | HVAB | Astana: Jie Cui vs Aziz Dougaz | Y | 0.72 | 38.89 |
| 2026-08-21 | HVAB | Cincinnati Open: Elisabetta Cocciaretto vs Lucrezia Stefanini | Y | 0.806 | 24.1 |
| 2026-08-22 | 8a3a | Cincinnati Open: Alexander Blockx vs Mariano Navone | Y | 0.59 | 69.49 |
| 2026-08-22 | HVAB | Cincinnati Open: Lois Boisson vs Belinda Bencic | Y | 0.664 | 50.62 |
| 2026-08-23 | HVAB | Cincinnati Open: Shuai Zhang vs Ann Li | Y | 0.773 | 29.37 |
| 2026-08-23 | HVAB | Cincinnati Open: Christopher O'Connell vs Casper Ruud | N | 0.686 | -100.0 |
| 2026-08-24 | HVAB | Cincinnati Open: Sorana Cirstea vs Anna Kalinskaya | Y | 0.81 | 23.53 |
| 2026-08-24 | HVAB | Roehampton: Yuta Shimizu vs Anton Matusevich | N | 0.339 | -100.0 |
| 2026-08-25 | HVAB | ITF W35 Bistrita Women: Jessica Pieri vs Federica Sacco | Y | 0.418 | 138.95 |
| 2026-08-25 | HVAB | Prague 2: Maxim Mrva vs Nerman Fatic | Y | 0.74 | 35.12 |
| 2026-08-25 | HVAB | Prague 2: Maxim Mrva vs Nerman Fatic | N | 0.66 | -100.0 |
| 2026-08-25 | HVAB | Cincinnati Open: Learner Tien vs Frances Tiafoe | N | 0.62 | -100.0 |
| 2026-08-25 | HVAB | Cincinnati Open: Learner Tien vs Frances Tiafoe | Y | 0.38 | 163.16 |
| 2026-08-28 | HVAB | Sion: Lorenzo Giustino vs Benjamin Hassan | Y | 0.375 | 166.34 |
| 2026-08-29 | HVAB | Quebec City: Hugo Gaston vs Luca Van Assche | Y | 0.659 | 51.85 |
| 2026-08-30 | HVAB | Cancun: Sebastian Baez vs Lloyd Harris | Y | 0.866 | 15.43 |
| 2026-08-31 | HVAB | US Open, Qualification ATP: Guy Den Ouden vs Genaro Alberto Olivieri | Y | 0.659 | 51.72 |
| 2026-08-31 | HVAB | US Open, Qualification WTA: Rebeka Masarova vs Iryna Shymanovich | Y | 0.664 | 50.67 |
| 2026-08-31 | HVAB | US Open, Qualification ATP: Titouan Droguet vs Daniel Rincon | Y | 0.758 | 31.85 |
| 2026-08-31 | HVAB | US Open, Qualification WTA: Rebeka Masarova vs Iryna Shymanovich | N | 0.713 | -100.0 |
| 2026-08-31 | HVAB | Roehampton 2: Inaki Montes-De La Torre vs Oskari Paldanius | N | 0.62 | -100.0 |
| 2026-08-31 | HVAB | Roehampton 2: Inaki Montes-De La Torre vs Oskari Paldanius | Y | 0.776 | 28.93 |
| 2026-09-01 | HVAB | US Open, Qualification WTA: Dalma Galfi vs Aliaksandra Sasnovich | Y | 0.736 | 35.96 |
| 2026-09-01 | HVAB | Kingston 2: Keshav Chopra vs Kaylan Bigun | Y | 0.795 | 25.77 |
| 2026-09-01 | HVAB | US Open, Qualification ATP: Bernard Tomic vs Lloyd Harris | Y | 0.752 | 32.91 |
| 2026-09-02 | HVAB | US Open, Qualification WTA: Vendula Valdmannova vs Aliaksandra Sasnovi | Y | 0.68 | 47.14 |
| 2026-09-02 | HVAB | US Open, Qualification ATP: Otto Virtanen vs Jack Pinnington Jones | N | 0.555 | -100.0 |
| 2026-09-02 | HVAB | US Open, Qualification WTA: Despina Papamichail vs Ekaterine Gorgodze | Y | 0.851 | 17.55 |
| 2026-09-02 | HVAB | Philadelphia: Oksana Selekhmeteva vs Capucine Jauffret | N | 0.543 | -100.0 |
