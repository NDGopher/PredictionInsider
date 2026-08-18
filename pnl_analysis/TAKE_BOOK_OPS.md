# Take-book ops (recommended plays)

Home page = the take book. Fill **the live ask**, never more than **VWAP + 2¢**. Hold to resolution.

The Node process **pings itself** every 30–60s so Telegram still fires with no browser open.

## Product

| Channel | Role |
|---------|------|
| `/` Take these | Live TAKEs + near-misses, 30s poll, rolling 30/60/90d ROI, pause banner, roster proposals |
| Telegram | 1–2 pings a day with Q / rel / sport ROI / fill cap / Polymarket link. Share the chat. |
| `/bets` | Paper + human fills. TAKEs also auto-paper-log at $100 when the signals cache refreshes. |
| `/strategies` | Lab only. Skip books, Ghost warning, not the live take list. |

**Do not wire an unsupervised Polymarket auto-bettor.** This tape was used to pick the rule (not a holdout). Same-night overlap can be 12 tickets. Fills move. A bot with your private key in this repo is the wrong failure mode. Take the Telegram ping, size $100, cap the day at ~50% of bank, log it in My Bets.

If you later want execution: paper first (already auto-logged), then a **separate signer** with a hard daily loss cap — not inside the signals process.

## What fires a TAKE

Single-name copy of the 12 Polydata-matched sports books when, at the time of the bet:

1. As-of Q ≥ 60
2. Prior ROI in that sport ≥ +5%
3. Stake ≥ 2× that trader’s own median
4. Price 10–88¢
5. Not NFL

Rebuild filters: `npm run backtest:asof`

## Telegram group (you + a friend)

One bot, one group, two humans.

1. @BotFather → new bot → `TELEGRAM_BOT_TOKEN`
2. Create a group, add the bot, send a message in the group
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id` (negative, like `-100…`) into `TELEGRAM_CHAT_ID`
4. Optional: BotFather → /setprivacy → Disable so the bot stays happy in the group

Make the bot a **group admin** with **Pin Messages** (group → Administrators → add the bot → Pin messages on).

The group gets:

| When | Message |
|------|---------|
| Always | One **pinned** tape: live count, open paper, last results, 30d/60d ROI |
| TAKE prints | 🟢 live card (ask + cap). Deleted when you can no longer fill it. |
| Ask moves ≥0.5¢ | same live card edited |
| Ask runs / leaves 10–88¢ before kickoff | live card deleted; ❌ DROPPED posted; pin updated; paper cancelled if no actual fill |
| Event starts | live card deleted; ⏰ KICKOFF + CLV; pin updated |
| Market settles | that lifecycle message becomes ✅ WON or ❌ LOST; pin updated |

Logins / per-user auto-trade come later (`user_id` is already on `tracked_bets`). For now everyone sees the same group tape; you log what you personally took in My Bets.

Keepalive (no cron required): `/api/signals?refresh=1` every 60s, `/api/take-plays` every 30s, kickoff/grade every 60s.

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

Open books after dropping already-resolved / dated-stale games: **0 live TAKEs**. Closest:

- DLEK Kane Ballon d'Or Yes — only miss is Q 52
- DLEK politics (House / Newsom) — Q 52 and not a sports lane
- Vetch 90¢ nos (China/Japan, Putin) — outside 10–88¢
- DLEK Poilievre / NY Liberty — Q 52 and tiny size
- Cincinnati Medvedev and July MLS tickets dropped off (stale or no longer open)
