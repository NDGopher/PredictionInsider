# UI & product improvements (from browser review)

Notes from reviewing the app on localhost. Use as a backlog.

---

### Copy and consistency

- **Live Signals subtitle**  
  Currently: "Aggregate open positions from official top-50 leaderboard — direct from on-chain subgraph."  
  When "Elite Signals" is the source, consider: "Signals from hand-curated elite traders — sport-specific ROI and full trade history" or similar so it’s clear we’re not just top-50.

- **Elite Traders: "Run Now"**  
  Clarify that daily runs use **incremental** (merge recent + re-analyze), not full re-fetch. e.g. Tooltip or short line: "Runs incremental update (recent activity + re-analyze all). Full re-fetch: use pipeline:full or script."

- **ROI / PNL labels**  
  Elite cards use "CSV ROI" vs "PA ROI" and "PNL". Keep one convention: e.g. "Analysis ROI" (from pipeline) vs "API PNL" (from Polymarket) and use the same terms in Signals "Insider Stats" (e.g. "Sports ROI" is clear).

---

### Data and behavior

- **Dashboard "Actionable (0)"**  
  When zero, consider a one-line note: "No actionable signals right now" or "Check back after games open" so it’s clear the product is working.

- **Markets page**  
  "SHARPS → YES/NO" with trader count and confidence is clear. Optional: on hover or detail, show which elites are on the market (like Signals cards).

- **Elite Traders: analyzed vs pending**  
  After the LOWER(wallet) join fix, most should show "Analyzed". Any still "Analysis pending" are either no CSV or unresolved wallet — consider a short in-UI note or help link.

---

### Pipeline and daily runs

- **Incremental is default for daily**  
  Daily job and `npm run daily-pipeline` use `--incremental --ingest`: fetch only recent activity, merge into CSVs, re-analyze all, push to DB. ROIs, PNLs, and specialties (sport/market/price) stay in sync without a full re-fetch.

- **When to run full pipeline**  
  Run full fetch (e.g. `npm run pipeline:full`) when adding new traders, after long gaps, or if you suspect missing history. Then use incremental for regular updates.
