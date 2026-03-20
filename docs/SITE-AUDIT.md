# Site audit: functionality, accuracy, usability

**Date:** March 2025  
**Scope:** Full pass for functionality, accuracy, bet placement ease, and trader data.

---

## 1. Functionality by page

| Page | Status | Notes |
|------|--------|--------|
| **Dashboard** | OK | Loads; Actionable count, Top Signals, filters (All/Live/Pregame/No Futures), "View all" to Signals. Track opens modal; "View on Polymarket" uses slug or event URL. |
| **Live Signals** | OK | Filters (Elite/Live Feed, Sports/All, types), search, per-signal Track, Show Traders/Logic, "View on Polymarket", "Hide this signal". **Fixed:** "Best Bet s" typo → "Best Bets". |
| **Markets** | OK | Tabs (Live, Upcoming, Moneyline, Spread, Total, Futures, All), search, sort. Cards show SHARPS → YES/NO, trader count, confidence, "Trade on Polymarket" (slug). |
| **My Bets** | OK | List (All/Open/Resolved), Log Bet, Verify Grades (disabled when no bets). Syncs to `/api/bets` and `localStorage` (BET_KEY). Edit, resolve, delete work. |
| **Elite Traders** | OK | 41 traders; sort (Quality Score, PA ROI %, Name); Polymarket + CSV links per row; Add Trader, Run Now, Refresh PNL, Settle, Full Re-fetch. Copy updated: no hardcoded "42", CSV as source of truth. |

---

## 2. Trader data accuracy

- **PNL source:** API uses `COALESCE(rawRealizedPnl, csvDirectionalPNL, overallPNL)` for display. Pipeline writes `raw_realized_pnl` (Polymarket-matching) and ingest sends `rawRealizedPnl`; when set, this is shown. CSV/analysis is not overwritten when `csvQualityScore` exists.
- **Elite page:** Total PNL shows "Polymarket Verified" badge when `pnlSource === "closed_positions_api"`. Comment and admin copy updated to say CSV/analysis is source of truth; Polymarket API refresh is for verification.
- **Checklist:** Raw realized PNL preferred when available ✓; analyzed/pending counts from API ✓; quality/tier from CSV where present ✓.

---

## 3. Issues fixed

1. **Signals:** Button label could render "Best Bet s" (extra space) — now explicit `"Best Bet"` / `"Best Bets"` by count.
2. **Elite:** Static "42 traders" and "canonical" PNL copy — updated to "all traders" and to describe Polymarket API as refresh with CSV as source of truth.

---

## 4. Usability and bet placement suggestions

- **One-click to Polymarket:** "View on Polymarket" and "Trade on Polymarket" already open correct market URLs (`/market/{slug}` or `/event/{marketId}`). No change needed.
- **Track flow:** Track from Dashboard/Signals opens modal; user can then go to My Bets. Consider adding a secondary CTA on the modal: "Track & open Polymarket" that saves and opens the market in a new tab in one click.
- **My Bets:** "Verify Grades" disabled when `bets.length === 0` is correct. Consider tooltip: "Add and resolve bets to verify grades."
- **Markets/Signals:** Keep "Trade on Polymarket" as primary action label; it’s clear. Optional: add a small "Copy link" for the market URL for sharing.
- **Elite:** Polymarket/CSV links per row are clear. Optional: add a bulk "Open all Polymarket profiles" for power users (low priority).

---

## 5. Bet flow verification

- **Track:** Dashboard/Signals → Track → modal (outcome, amount, etc.) → save → POST `/api/bets` + `localStorage` write. My Bets reads from API and syncs to storage.
- **Resolve:** My Bets → resolve → PATCH with status and optional resolvedPrice → grades computed when "Verify Grades" runs.
- **URLs:** Bet cards link to `https://polymarket.com/market/${bet.slug}` when `slug` is set; otherwise no link (acceptable).

---

## 6. Summary

- **Functionality:** All main pages and flows work; one typo and Elite copy updated.
- **Trader data:** PNL and verification logic are correct; copy now reflects CSV as source of truth and Polymarket as verification.
- **Usability:** Current CTAs are clear; optional improvements are documented above (e.g. "Track & open Polymarket", tooltips, copy link).
