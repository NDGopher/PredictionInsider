# Product and monetization ideas

- **Best-of-best signals**  
  Use the new filters so only the strongest signals surface:  
  `GET /api/signals?minConfidence=70&minQuality=50&tier=HIGH`.  
  Build a "Pro" or "Elite" feed in the UI that uses these params.

- **Premium tiers**  
  - Free: delayed or capped signals, leaderboard only.  
  - Paid: real-time signals, full trade history per trader, sport/submarket breakdowns, alerts (email/Telegram/Discord).

- **Alerts and notifications**  
  When a new high-confidence signal appears (e.g. confidence ≥ 80, 2+ elites, sport-specific ROI above threshold), send a push/email/Telegram. Charge for alert packs or include in a subscription.

- **API access**  
  Sell API keys for programmatic access to signals and trader metrics (rate-limited by tier). Useful for bettors, researchers, or other apps.

- **Content and social proof**  
  Publish weekly "sharp moves" recaps, ROI-by-sport leaderboards, and trader spotlights. Use for SEO, email list, and trust; gate deep dives or history behind paywall.

- **Affiliate / referral**  
  Partner with sportsbooks or Polymarket; earn on sign-ups or volume from users who follow your signals.

- **Data and CSV exports**  
  Offer paid CSV/Excel export of full trade history or signal history for backtesting and compliance.

Running the **daily pipeline** (see [DAILY-UPDATES.md](./DAILY-UPDATES.md)) keeps PNL and trader scores accurate so all of the above stay credible.
