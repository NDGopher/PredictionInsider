#!/usr/bin/env bash
# =============================================================================
# PredictionInsider — Local Trader Refresh Script
# =============================================================================
# HOW TO USE:
#   1. Copy this file + run_full_pipeline.py + analyze_trader.py to a folder
#      on your local machine (e.g. ~/pi_refresh/)
#   2. Set BACKEND_URL below to your deployed app URL
#   3. Run:  bash refresh_local.sh
#   4. To schedule (Mac/Linux), add this to crontab -e:
#      0 3 */3 * * cd ~/pi_refresh && bash refresh_local.sh >> refresh.log 2>&1
#      ↑ Runs at 3am every 3 days automatically
#
# FLAGS:
#   --stale-days 3   → only re-fetch traders whose data is >3 days old (faster)
#   --traders X,Y,Z  → only refresh specific usernames
#   --analyze-only   → re-run analysis on existing CSVs, no API fetch
#   --ingest         → push results to the backend (always include this)
# =============================================================================

# ── Config ────────────────────────────────────────────────────────────────────
BACKEND_URL="https://YOUR-APP-NAME.replit.app"   # ← change to your deployed URL
STALE_DAYS=3                                      # skip re-fetching if data < 3 days old
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$SCRIPT_DIR/refresh.log"

# ── Sanity check ──────────────────────────────────────────────────────────────
if [ "$BACKEND_URL" = "https://YOUR-APP-NAME.replit.app" ]; then
    echo "❌  Edit refresh_local.sh and set BACKEND_URL to your deployed app URL"
    exit 1
fi

if ! command -v python3 &>/dev/null; then
    echo "❌  python3 not found. Install Python 3.9+ and run: pip3 install requests pandas numpy"
    exit 1
fi

# ── Run ───────────────────────────────────────────────────────────────────────
echo "======================================================================"
echo "  PredictionInsider Refresh — $(date)"
echo "  Backend : $BACKEND_URL"
echo "  Stale   : >$STALE_DAYS days gets re-fetched"
echo "======================================================================"

BACKEND_URL="$BACKEND_URL" python3 "$SCRIPT_DIR/run_full_pipeline.py" \
    --stale-days "$STALE_DAYS" \
    --ingest

echo ""
echo "======================================================================"
echo "  Done — $(date)"
echo "======================================================================"
