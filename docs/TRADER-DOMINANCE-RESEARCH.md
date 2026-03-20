# Deep research: same traders (0p0jogggg, LynxTitan) and position coverage

## Why you kept seeing the same few traders

### 1. **Position count imbalance**

- **0p0jogggg** and **LynxTitan** (and a few others) hold **very large** numbers of open positions — often hundreds or thousands.
- We build the signal universe by:
  - Adding every market that appears in the **last 1,000 trades** per trader (trades path), and
  - **Merging in every current open position** from the position cache (positions path).
- So if Trader A has **50** open positions and Trader B has **2,000**:
  - Trader B adds up to 2,000 markets into the pool; Trader A adds 50.
  - After quality gates and confidence, Trader B can end up with dozens or hundreds of signals; Trader A with a handful.
- **0p0jogggg** is explicitly called out in code as a “heavy trader” with >500 open positions (and in practice can have far more). **LynxTitan** similarly has a large book. So they naturally dominated the **number of markets** we considered, and therefore the number of signals that passed the gates.

### 2. **We were only fetching 5,000 positions per wallet**

- For the **live position cache** we use `fetchAllPositionsFull(wallet)`, which was capped at **10 pages × 500 = 5,000 positions**.
- So for any trader with **more than 5,000** open positions we were **truncating** and never grading the rest. We also weren’t “missing” 0p0jogggg or LynxTitan — we had plenty of their positions — but we were potentially missing positions for other whales, and we were giving the first 5,000 positions (effectively arbitrary order from the API) full weight while ignoring the rest.
- The **Elite / PNL pipeline** (`eliteAnalysis.syncTraderPositions`) already uses a **50,000**-position cap (100 pages × 500). The signals path now matches that.

### 3. **No per-trader cap when merging positions**

- When we merged positions into `marketWallets`, we added **every** position from **every** trader that passed the market/sports filter. So a single trader with 2,000 positions could add 2,000 markets; a trader with 30 positions added 30.
- There was no “max markets per trader” when building the candidate set, so high-position traders flooded the pool and then dominated the final signal list after quality/confidence.

### 4. **No diversity cap on the output**

- After sorting by confidence we returned **all** signals. So if 0p0jogggg had 80 signals that passed the gates, all 80 could appear; we didn’t limit how many signals a single trader could have in the feed.

---

## What we changed

### 1. **Fetch all positions for whale traders (up to 50k)**

- **Before:** `fetchAllPositionsFull` stopped after **10 pages (5,000 positions)**.
- **After:** We paginate up to **100 pages (50,000 positions)** and stop when the API returns fewer than 500 or we hit 50k. We add a short delay (40 ms) between pages to avoid rate limits.
- So we now **get and grade** all positions for every curated trader, including heavy books like 0p0jogggg and LynxTitan, consistent with the Elite PNL pipeline.

### 2. **Per-trader cap when merging positions (200 per trader)**

- When we merge positions into `marketWallets`, we no longer add every position from every trader.
- For each wallet we:
  - Collect all their positions that pass the market/sports/active/endDate filters.
  - Sort by **costBasis** (position size in $) descending.
  - Take only the **top 200** and add those to `marketWallets`.
- So each trader can contribute **at most 200 markets** from their positions. We still use their **largest** positions (by $), so we keep their best conviction and don’t drop small noise. This prevents one or two whales from flooding the candidate set and dominating the feed.

### 3. **Diversity cap on the final feed (20 per trader)**

- After applying filters (minConfidence, minQuality, tier), we apply a **per–primary-trader** cap.
- For each signal we take the **primary trader** (first in the signal’s `traders` list, i.e. largest by risk). We group signals by that wallet and keep at most **20** per trader (top 20 by confidence). Then we merge and re-sort by confidence.
- So even if 0p0jogggg or LynxTitan have 80 qualifying signals, at most **20** from each appear in the feed; the rest of the slots go to other traders.

---

## Who 0p0jogggg and LynxTitan are (from the codebase)

### 0p0jogggg

- **Wallet:** `0x6ac5bb06a9eb05641fd5e82640268b92f3ab4b6e`
- **Role in list:** One of the curated elite traders in `CURATED_TRADERS` / `CURATED_ELITES`.
- **Why they show up a lot:** Very high open position count (“heavy trader” with >500 positions; in practice often much higher). A large share of their edge is on the **No** side (fading public hype). They have **TRADER_CATEGORY_FILTERS**: we only tail them in Soccer, College Sports, Other; we **do not** tail NBA, NHL, eSports, Tennis, UCL, Politics, Finance/Crypto; we **do not** tail **totals** or **Yes** side. So the feed was already filtered, but their sheer number of positions (and our previous lack of per-trader caps) still made them over-represented.
- **Tier:** Documented as C-Tier (Q=10, ROI=6.8%, Sharpe -4.1) with edge in Soccer/NCAAB/Other on the No side.

### LynxTitan

- **Wallet:** `0x68146921df11eab44296dc4e58025ca84741a9e7`
- **Role in list:** Also a curated elite in `CURATED_TRADERS` / `CURATED_ELITES`.
- **Why they show up a lot:** Same structural reason as 0p0jogggg — **large number of open positions**. There is no special filter or boost for LynxTitan in the code; they’re not over-represented by logic, only by volume of positions that passed the gates before we added the caps.

---

## Summary table

| Issue | Before | After |
|-------|--------|--------|
| Position fetch cap (signals path) | 5,000 per wallet | 50,000 per wallet (match Elite PNL) |
| Positions merged per trader | Unlimited | Top 200 by $ (costBasis) per trader |
| Signals in feed per trader | Unlimited | Max 20 per primary trader (by confidence) |
| 0p0jogggg / LynxTitan dominance | High (many positions → many signals) | Reduced by merge cap + feed cap |

We are now:

1. **Fetching** all positions (up to 50k) for every curated trader, including whales, and **grading** them in the same way as everyone else.
2. **Limiting** how much any one trader can dominate the **candidate set** (200 markets from positions) and the **final feed** (20 signals per trader).

You should see a more balanced mix of traders while still getting every trader’s largest positions considered and graded.
