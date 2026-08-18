# Take-book ops (recommended plays)

Home page = the take book. Fill **VWAP + 2¢**, **$100 flat** (or 1% of a $10k bank). Hold to resolution. Do not auto-bet.

## What fires a TAKE

Single-name copy of the 12 Polydata-matched sports books when, at the time of the bet:

1. As-of Q ≥ 60
2. Prior ROI in that sport ≥ +5%
3. Stake ≥ 2× that trader’s own median
4. Price 10–88¢
5. Not NFL

Rebuild filters: `npm run backtest:asof`

## Frontend

- `/` — **Take these** (`TakeBookFeed`). Polls `/api/take-plays` every 30s.
- `/strategies` — research / skip books.
- `/bets` — track fills you actually take.
- `/ranks` — roster vs Polydata.

## Telegram (yes) vs auto-bettor (no)

**Telegram: use it.** ~1 play per calendar day. Set:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

Create a bot with @BotFather, `/start` it, get chat id from `@userinfobot` or the API. The server posts a new TAKE when `/api/signals` refreshes (deduped by signal id). Share that chat with whoever should see the book.

**Do not wire an unsupervised Polymarket auto-bettor.** This tape was used to pick the rule (not a holdout). Same-night overlap can be 12 tickets. Fills move. A bot with your private key in this repo is the wrong failure mode. Take the Telegram ping, size $100 (or 1% of bank), cap the day at ~50% of bank, log it in My Bets.

If you later want execution, do **paper first** (auto-log to `tracked_bets` at $100, no CLOB), then a separate signer with a hard daily loss cap — not inside the signals process.

## Stay fluid without overfitting

Daily (already chained):

```
npm run daily-pipeline   # ingest + take_book_daily.py
```

`take_book_daily.py` writes `pnl_analysis/output/take_health.json`:

| Window | Pause live copy if |
|--------|-------------------|
| Last 30d | n ≥ 25 and +2¢ ROI < 0 |
| Last 60d | n ≥ 40 and +2¢ ROI < −5% |

Roster **proposals only** (shown on the home page, never auto-applied):

- **Drop** if that name’s take-slice is negative on **both** last 90d and last 60d (n ≥ 15 each).
- **Add** never from a 7-day heat. Candidate must match Polydata WR/PnL, n ≥ 40, sports specialist, and hold-to-res copy must not be a juice-bleed. Then re-run `npm run backtest:asof` on the new allow-list **before** going live.

Weekly (not daily): `npm run backtest:elites` then inspect `POLYDATA_ELITES.md`. Weekly: `npm run backtest:asof` so Q/rel/sport gates stay honest as books grow.

Do **not** retune Q, rel, or sport thresholds because last week was cold. The pause switch exists so you stop copying without rewriting the rule.

## Right now

Rolling take book is **GO**: last 30d n=32, **+14.7%** after 2¢; last 60d n=66, **+17.6%**. No drop proposals.

Open CSVs after dropping already-resolved games: **0 live TAKEs**. Near-misses are DLEK politics (Q 52), Vetch 90¢ nos (outside 10–88¢), and soccer under 2×. The website live feed (positions + recent trades) is fresher than CSVs — that is what `/api/take-plays` shows once `npm run dev` is up.
