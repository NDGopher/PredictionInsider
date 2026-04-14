"""
Full Pipeline: Fetch + Analyze + Ingest for ALL 50 Curated Traders
=================================================================
USAGE:

  # Run everything for all 50 traders (fetch + analyze + push to DB)
  python3 pnl_analysis/run_full_pipeline.py --ingest

  # Only re-fetch traders whose CSV is older than 3 days (DEFAULT stale logic)
  python3 pnl_analysis/run_full_pipeline.py --stale-days 3 --ingest

  # Run a specific subset by username (comma-separated, no spaces)
  python3 pnl_analysis/run_full_pipeline.py --traders geniusMC,CemeterySun,TTdes --ingest

  # Skip fetching — just re-analyze existing CSVs (e.g. after you dropped CSVs in output/)
  python3 pnl_analysis/run_full_pipeline.py --analyze-only --ingest

  # DAILY RUN: only merge NEW trades into existing CSVs, then re-analyze all and ingest (no full re-fetch).
  python3 pnl_analysis/run_full_pipeline.py --incremental --ingest

  # Skip re-fetch for whales (use existing CSV, still analyze). Use per-trader script for full refresh.
  python3 pnl_analysis/run_full_pipeline.py --skip-if-rows-over 250000 --ingest

  # One specific trader, re-analyze from existing CSV
  python3 pnl_analysis/run_full_pipeline.py --traders geniusMC --analyze-only --ingest

OUTPUT:
  pnl_analysis/output/<username>_<wallet8>.csv   — raw positions (USDC-accurate)
  pnl_analysis/output/<username>_<wallet8>.json  — Gemini-style analysis
  pnl_analysis/output/_all_analysis.json         — master summary (ranked)
"""

import requests
import pandas as pd
import numpy as np
import json
import csv as csv_module
import time
import random
import sys
import os
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Windows: avoid UnicodeEncodeError when printing emoji from analyze_trader
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from analyze_trader import analyze_csv

OUTPUT_DIR  = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:5000")
# Same file server/scheduledPipeline.ts uses — enables 24h "smart" skip for refresh-all.bat
LAST_PIPELINE_RUN_FILE = OUTPUT_DIR / ".last_pipeline_run"

# Data API: retries + guards so 429/partial fetches do not replace good CSVs or poison ingest.
RATE_LIMIT_HTTP = (429, 502, 503)
MAX_RETRIES_PER_PAGE = 8
PAGE_SLEEP_SEC = 0.35
MIN_PREV_CLOSED_TO_GUARD = 80
ANALYSIS_COLLAPSE_MIN_PREV_EVENTS = 120
ANALYSIS_COLLAPSE_MAX_NEW_EVENTS_RATIO = 0.2
ANALYSIS_COLLAPSE_MAX_NEW_QS = 20
ANALYSIS_COLLAPSE_MIN_PREV_QS = 30


def write_last_pipeline_run_timestamp():
    """Stamp successful ingest so smart refresh + ScheduledPipeline share one 24h clock."""
    try:
        LAST_PIPELINE_RUN_FILE.write_text(str(int(time.time() * 1000)), encoding="utf-8")
    except OSError:
        pass

# ================================================================
# CLI
# ================================================================
parser = argparse.ArgumentParser(description="Polymarket trader pipeline")
parser.add_argument("--analyze-only", action="store_true",
                    help="Skip fetching — use existing CSVs in output/")
parser.add_argument("--ingest", action="store_true",
                    help="Push analysis results to the backend DB")
parser.add_argument("--traders", type=str, default="",
                    help="Comma-separated usernames to process (default: all)")
parser.add_argument("--stale-days", type=float, default=0,
                    help="Only re-fetch traders whose CSV is older than N days (0 = always re-fetch)")
parser.add_argument("--incremental", action="store_true",
                    help="Fetch only recent activity (2 pages closed + 1 open), merge into existing CSV, then re-analyze all. Use for daily runs.")
parser.add_argument("--skip-if-rows-over", type=int, default=0,
                    help="Skip re-fetch for traders whose CSV already has more than N rows (use existing CSV, still analyze). 0 = disabled. Use 250000 to avoid re-fetching whales in batch.")
args, _ = parser.parse_known_args()

ANALYZE_ONLY  = args.analyze_only
INGEST        = args.ingest
STALE_DAYS    = args.stale_days
INCREMENTAL   = getattr(args, "incremental", False)
SKIP_IF_ROWS_OVER = getattr(args, "skip_if_rows_over", 0)
FILTER_NAMES  = set(n.strip() for n in args.traders.split(",") if n.strip())

# ================================================================
# ALL CURATED TRADERS  (wallet, username)
# ================================================================
ALL_TRADERS = [
    ("0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee", "kch123"),
    ("0x6e82b93eb57b01a63027bd0c6d2f3f04934a752c", "DLEK"),
    ("0x44c58184f89a5c2f699dc8943009cb3d75a08d45", "JhonAlexanderHinestroza"),
    ("0x13414a77a4be48988851c73dfd824d0168e70853", "ShortFlutterStock"),  # ALIAS: CharlieKirkEvans = same wallet/entity — do NOT add separately
    ("0x781caf04d98a281712caf1677877c442789fdb68", "Avarice31"),
    ("0xc5b5bbd42624a8f0c8dfa90221913007d8c77e80", "Capman"),
    ("0x84dbb7103982e3617704a2ed7d5b39691952aeeb", "ShucksIt69"),
    ("0xc660ae71765d0d9eaf5fa8328c1c959841d2bd28", "TutiFromFactsOfLife"),
    ("0xd6966eb1ae7b52320ba7ab1016680198c9e08a49", "EIf"),
    ("0x92672c80d36dcd08172aa1e51dface0f20b70f9a", "ckw"),
    ("0xdbb9b3616f733e19278d1ca6f3207a8344b5ed8d", "bigmoneyloser00"),
    ("0x52ecea7b3159f09db589e4f4ee64872fd0bba6f3", "fkgggg2"),
    ("0xd9e0aaca471f489be338fd0f91a26e8669a805f2", "0xD9E0AACa471f48F91A26E8669A805f2"),
    ("0xf588b19afe63e1aba00f125f91e3e3b0fdc62b81", "RandomPunter"),
    ("0x9ac5c8496bc84f642bac181499bf64405a5c6a3d", "JuniorB"),
    ("0x2c335066fe58fe9237c3d3dc7b275c2a034a0563", "0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563"),
    ("0x20d6436849f930584892730c7f96ebb2ac763856", "0x20D6436849F930584892730C7F96eBB2Ac763856"),
    ("0xee00ba338c59557141789b127927a55f5cc5cea1", "S-Works"),
    ("0xe40172522c7c64afa2d052ddae6c92cd0f417b88", "BoomLaLa"),
    ("0x9f138019d5481fdc5c59b93b0ae4b9b817cce0fd", "Bienville"),
    ("0x6b7c75862e64d6e976d2c08ad9f9b54add6c5f83", "tcp2"),
    ("0xec981ed70ae69c5cbcac08c1ba063e734f6bafcd", "0xheavy888"),
    ("0x68146921df11eab44296dc4e58025ca84741a9e7", "LynxTitan"),
    ("0x0b9cae2b0dfe7a71c413e0604eaac1c352f87e44", "geniusMC"),
    ("0xe24838258b572f1771dffba3bcdde57a78def293", "redskinrick"),
    ("0x6c743aafd813475986dcd930f380a1f50901bd4e", "middleoftheocean"),
    ("0x39932ca2b7a1b8ab6cbf0b8f7419261b950ccded", "Andromeda1"),
    ("0x5c3a1a602848565bb16165fcd460b00c3d43020b", "CoryLahey"),
    ("0xafd492974cd531aae7786210438ae46b42047e61", "TheArena"),
    ("0x3471a897e56a8d3621ca79af87dae4325977f17e", "xytest"),
    ("0xc65ca4755436f82d8eb461e65781584b8cadea39", "UAEVALORANTFAN"),
    ("0x9703676286b93c2eca71ca96e8757104519a69c2", "TheMangler"),
    ("0xc49fe658479db29e1a2fefebf0735f657dca9e05", "iDropMyHotdog"),
    ("0x58f8f1138be2192696378629fc9aa23c7910dc70", "bloodmaster"),
    ("0xf9b5f7293b8258be8b0e1f03717c5d2ad94809ee", "9sh8f"),
    ("0x53ecc53e7a69aad0e6dda60264cc2e363092df91", "0x53eCc53E7"),
    ("0x1b5e20a28d7115f10ce6190a5ae9a91169be83f8", "877s8d8g89I9f8d98fd99ww2"),
    ("0x9c82c60829df081d593055ee5fa288870c051f13", "Vetch"),
    ("0x25867077c891354137bbaf7fde12eec6949cc893", "TTdes"),
    ("0x57cd939930fd119067ca9dc42b22b3e15708a0fb", "Supah9ga"),
    ("0xe72bb501df5306c75c89383d48a1e81073fbb0a0", "norrisfan"),
    ("0x036c159d5a348058a81066a76b89f35926d4178d", "HedgeMaster88"),
    ("0x37c1874a60d348903594a96703e0507c518fc53a", "CemeterySun"),
    ("0x6ac5bb06a9eb05641fd5e82640268b92f3ab4b6e", "0p0jogggg"),
    ("0x7ea571c40408f340c1c8fc8eaacebab53c1bde7b", "Cannae"),
    ("0x2005d16a84ceefa912d4e380cd32e7ff827875ea", "RN1"),
]

def csv_path_for(wallet, username):
    safe = username.replace("/", "_").replace("\\", "_")
    return OUTPUT_DIR / f"{safe}_{wallet[:8]}.csv"

def json_path_for(wallet, username):
    safe = username.replace("/", "_").replace("\\", "_")
    return OUTPUT_DIR / f"{safe}_{wallet[:8]}.json"

def csv_age_days(wallet, username):
    """Returns age of the existing CSV in days, or None if it doesn't exist."""
    p = csv_path_for(wallet, username)
    if not p.exists():
        return None
    age_secs = time.time() - p.stat().st_mtime
    return age_secs / 86400

def csv_row_count(wallet, username):
    """Returns number of rows in existing CSV, or 0 if missing/unreadable."""
    p = csv_path_for(wallet, username)
    if not p.exists():
        return 0
    try:
        df = pd.read_csv(p, usecols=[0], low_memory=False)
        return len(df)
    except Exception:
        return 0

def should_skip(wallet, username):
    """Return True if this trader should be skipped based on stale-days logic."""
    if ANALYZE_ONLY:
        # In analyze-only mode: skip only if CSV is missing
        return not csv_path_for(wallet, username).exists()
    if STALE_DAYS > 0:
        age = csv_age_days(wallet, username)
        if age is not None and age < STALE_DAYS:
            return True  # fresh enough, skip re-fetch
    return False

# ================================================================
# DATA FETCH  (exact /closed-positions + /positions approach)
# ================================================================

def _get_json_list_with_retry(url: str, params: dict, label: str):
    """
    One Data API page. Returns a list on success or empty end; None = give up (caller stops pagination).
    Retries 429/5xx and transient network errors with exponential backoff + jitter.
    """
    for attempt in range(MAX_RETRIES_PER_PAGE):
        try:
            resp = requests.get(url, params=params, timeout=45)
        except requests.exceptions.RequestException as e:
            if attempt < MAX_RETRIES_PER_PAGE - 1:
                wait = min(90.0, (2**attempt) * 1.2 + random.uniform(0, 1))
                print(f"    ⏳ {label} network error, retry in {wait:.1f}s ({attempt + 1}/{MAX_RETRIES_PER_PAGE}): {e}")
                time.sleep(wait)
                continue
            print(f"    ⚠️  {label} network error after retries: {e}")
            return None
        if resp.status_code == 200:
            try:
                return resp.json()
            except Exception as e:
                print(f"    [X] {label} invalid JSON: {e}")
                return None
        if resp.status_code == 400:
            return []
        if resp.status_code in RATE_LIMIT_HTTP or (500 <= resp.status_code < 600):
            if attempt < MAX_RETRIES_PER_PAGE - 1:
                wait = min(90.0, (2**attempt) * 1.5 + random.uniform(0.5, 2))
                print(f"    ⏳ {label} HTTP {resp.status_code}, backoff {wait:.1f}s ({attempt + 1}/{MAX_RETRIES_PER_PAGE})")
                time.sleep(wait)
                continue
            print(f"    [X] {label} HTTP {resp.status_code} after {MAX_RETRIES_PER_PAGE} retries")
            return None
        print(f"    [X] {label} HTTP {resp.status_code}")
        return None
    return None


def fetch_positions(address, endpoint, max_pages=None):
    """Fetch positions. If max_pages is set (e.g. 2), stop after that many pages (for incremental)."""
    base_url = f"https://data-api.polymarket.com/{endpoint}"
    params   = {"user": address, "limit": 50, "offset": 0}
    all_data = []
    page     = 0

    while True:
        if max_pages is not None and page >= max_pages:
            break
        label = f"{endpoint} offset={params['offset']}"
        data = _get_json_list_with_retry(base_url, params, label)
        if data is None:
            break
        if not data:
            break
        all_data.extend(data)
        if len(data) < 50:
            break
        params["offset"] += 50
        page += 1
        time.sleep(PAGE_SLEEP_SEC)

    return pd.DataFrame(all_data)


def _csv_closed_open_counts(csv_path: Path) -> tuple[int, int]:
    if not csv_path.exists():
        return (0, 0)
    try:
        df = pd.read_csv(csv_path, usecols=["status"], low_memory=False)
        s = df["status"].astype(str).str.lower()
        return int((s == "closed").sum()), int((s == "open").sum())
    except Exception:
        try:
            df = pd.read_csv(csv_path, low_memory=False)
            if "status" not in df.columns:
                return (0, 0)
            s = df["status"].astype(str).str.lower()
            return int((s == "closed").sum()), int((s == "open").sum())
        except Exception:
            return (0, 0)


def fetch_recent_and_merge(address, username):
    """
    Incremental: fetch only recent closed (2 pages) + recent open (1 page), merge into existing CSV.
    Returns path to updated CSV or None if no existing CSV.
    """
    csv_path = csv_path_for(address, username)
    if not csv_path.exists():
        return None
    try:
        existing = pd.read_csv(csv_path, low_memory=False)
    except Exception as e:
        print(f"    ⚠️  Could not read existing CSV: {e}")
        return None
    id_col = "id" if "id" in existing.columns else None
    if id_col is None:
        return csv_path  # no id column, skip merge

    existing_ids = set(existing[id_col].astype(str).dropna())
    prev_closed, _prev_open = _csv_closed_open_counts(csv_path)
    # Up to ~2000 closed + ~1000 open (40 + 20 pages) — fast, avoids 50k+ full fetch
    df_closed = fetch_positions(address, "closed-positions", max_pages=40)
    time.sleep(PAGE_SLEEP_SEC)
    df_open  = fetch_positions(address, "positions", max_pages=20)
    if df_closed.empty and df_open.empty:
        return csv_path
    if df_closed.empty and prev_closed >= MIN_PREV_CLOSED_TO_GUARD:
        print(
            f"    ⚠️  Incremental: closed API returned 0 rows but CSV has {prev_closed:,} closed — "
            "merge may miss new closed rows this run (rate limit?)."
        )

    df_closed["status"] = "closed"
    df_open["status"]   = "open"
    new_df = pd.concat([df_closed, df_open], ignore_index=True)
    if new_df.empty:
        return csv_path
    # Keep only rows we don't already have
    if id_col in new_df.columns:
        new_rows = new_df[~new_df[id_col].astype(str).isin(existing_ids)]
    else:
        new_rows = new_df
    if new_rows.empty:
        return csv_path
    combined = pd.concat([existing, new_rows], ignore_index=True)
    if "id" in combined.columns:
        combined = combined.drop_duplicates(subset=["id"], keep="first")
    for col in ["realizedPnl", "cashPnl", "currentValue", "initialValue"]:
        if col in combined.columns:
            combined[col] = pd.to_numeric(combined[col], errors="coerce").fillna(0)
    if "total_position_pnl" not in combined.columns:
        combined["total_position_pnl"] = combined.get("realizedPnl", 0) + combined.get("cashPnl", 0)
    combined.to_csv(csv_path, index=False, quoting=csv_module.QUOTE_ALL)
    print(f"    📄 Merged {len(new_rows):,} new rows -> {csv_path.name} ({len(combined):,} total)")
    return csv_path


def collect_and_save(address, username):
    csv_path = csv_path_for(address, username)
    prev_closed, prev_open = _csv_closed_open_counts(csv_path)

    df_closed = fetch_positions(address, "closed-positions")
    time.sleep(PAGE_SLEEP_SEC)
    df_open   = fetch_positions(address, "positions")

    # Do not replace a deep closed history with open-only data (typical after 429 on page 0).
    if df_closed.empty and not df_open.empty and prev_closed >= MIN_PREV_CLOSED_TO_GUARD:
        print(
            f"    [GUARD] Keeping existing CSV: API returned 0 closed rows but file had {prev_closed:,} closed "
            f"({len(df_open):,} open only — likely rate limit / partial fetch)."
        )
        return csv_path
    if df_closed.empty and df_open.empty and (prev_closed + prev_open) >= 50:
        print(
            f"    [GUARD] Keeping existing CSV: API returned no rows; file had {prev_closed + prev_open:,} rows."
        )
        return csv_path

    df_closed["status"] = "closed"
    df_open["status"]   = "open"
    df = pd.concat([df_closed, df_open], ignore_index=True)

    if df.empty:
        print(f"    ⚠️  No data returned.")
        return None

    if "id" in df.columns:
        df = df.drop_duplicates(subset=["id"])

    for col in ["realizedPnl", "cashPnl", "currentValue", "initialValue"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        else:
            df[col] = 0.0

    df["total_position_pnl"] = df["realizedPnl"] + df["cashPnl"]
    df.to_csv(csv_path, index=False, quoting=csv_module.QUOTE_ALL)
    print(f"    📄 CSV saved ({len(df):,} rows, {len(df_closed):,} closed + {len(df_open):,} open)")
    return csv_path


# ================================================================
# PROCESS ONE TRADER
# ================================================================

def process_trader(address, username):
    csv_path  = csv_path_for(address, username)
    json_path = json_path_for(address, username)

    print(f"\n{'='*70}")
    print(f"[>>] {username}  ({address})")
    print(f"{'='*70}")

    # ── Decide whether to fetch or use existing CSV ──────────────
    if not ANALYZE_ONLY:
        if INCREMENTAL:
            # Fetch only recent activity and merge into existing CSV; skip if no CSV
            merged = fetch_recent_and_merge(address, username)
            if merged is None:
                print(f"    ⚠️  No existing CSV — skipping fetch (run full pipeline once)")
                return None
            # Fall through to analyze (csv_path is already updated)
        else:
            age = csv_age_days(address, username)
            rows = csv_row_count(address, username) if SKIP_IF_ROWS_OVER else 0
            if SKIP_IF_ROWS_OVER and rows > SKIP_IF_ROWS_OVER:
                print(f"    [skip] CSV has {rows:,} rows (>{SKIP_IF_ROWS_OVER:,}) — using existing (run trader script for full refresh)")
            elif STALE_DAYS > 0 and age is not None and age < STALE_DAYS:
                print(f"    [OK] CSV is {age:.1f}d old (< {STALE_DAYS}d stale threshold) — using existing")
            else:
                if age is not None:
                    print(f"    🔄 CSV is {age:.1f}d old — re-fetching")
                result = collect_and_save(address, username)
                if result is None:
                    return None
    if ANALYZE_ONLY or INCREMENTAL:
        if not csv_path.exists():
            print(f"    ⚠️  CSV not found — skipping (run without --analyze-only to fetch)")
            return None
        age = csv_age_days(address, username)
        print(f"    [csv] Using existing CSV ({age:.1f}d old): {csv_path.name}" if age is not None else f"    [csv] Using {csv_path.name}")

    prev_result = None
    if json_path.exists():
        try:
            with open(json_path, encoding="utf-8") as f:
                prev_result = json.load(f)
        except Exception:
            pass

    # ── Gemini-style analysis ─────────────────────────────────────
    try:
        result = analyze_csv(csv_path, username, address)
    except Exception as e:
        print(f"    [X] Analysis failed: {e}")
        import traceback; traceback.print_exc()
        return None

    if prev_result:
        pe = int(prev_result.get("total_events") or 0)
        ne = int(result.get("total_events") or 0)
        pq = float(prev_result.get("quality_score") or 0)
        nq = float(result.get("quality_score") or 0)
        threshold = max(
            ANALYSIS_COLLAPSE_MIN_PREV_EVENTS // 4,
            int(pe * ANALYSIS_COLLAPSE_MAX_NEW_EVENTS_RATIO),
        )
        if (
            pe >= ANALYSIS_COLLAPSE_MIN_PREV_EVENTS
            and ne < threshold
            and pq >= ANALYSIS_COLLAPSE_MIN_PREV_QS
            and nq <= ANALYSIS_COLLAPSE_MAX_NEW_QS
        ):
            print(
                f"    [GUARD] Analysis collapsed vs prior JSON (events {ne:,} vs {pe:,}, "
                f"Q {nq:.0f} vs {pq:.0f}) — keeping prior profile for this run."
            )
            result = prev_result

    with open(json_path, "w") as f:
        json.dump(result, f, indent=2, default=str)

    t  = result["tier"]
    qs = result["quality_score"]
    print(f"    📊 {t}  (score={qs})  ROI={result['overall_roi']:.1f}%  Sharpe={result['pseudo_sharpe']:.1f}")
    print(f"    💰 Net PnL: ${result['total_profit']:,.0f}  |  Win Rate: {result['win_rate']:.1f}%  |  {result['total_events']:,} events")
    print(f"    🏆 Top sport: {result['top_sport']}")
    print(f"    🏷️  Tags: {', '.join(result['tags'][:6])}")
    print(f"    [OK] JSON saved -> {json_path.name}")
    return result


# ================================================================
# GRADE CHANGE DETECTION (previous vs current run)
# ================================================================

PREVIOUS_INGEST_PATH = OUTPUT_DIR / "_previous_ingest.json"

def load_previous_ingest():
    """Load last run's analysis snapshot for diffing. Returns dict wallet -> analysis dict, or None."""
    if not PREVIOUS_INGEST_PATH.exists():
        return None
    try:
        with open(PREVIOUS_INGEST_PATH) as f:
            data = json.load(f)
        if not isinstance(data, list):
            return None
        return {(r.get("wallet") or "").strip().lower(): r for r in data if (r.get("wallet") or "").strip()}
    except Exception:
        return None

def compute_grade_changes(previous_by_wallet, current_list):
    """Compare previous ingest snapshot to current. Returns list of { username, wallet, changes, previous, new }."""
    current_by_wallet = {(r.get("wallet") or "").strip().lower(): r for r in current_list if (r.get("wallet") or "").strip()}
    out = []
    for wallet, new_r in current_by_wallet.items():
        prev = previous_by_wallet.get(wallet) if previous_by_wallet else None
        username = new_r.get("username") or wallet[:10]
        changes = []
        prev_tier = prev.get("tier") if prev else None
        new_tier = new_r.get("tier")
        if prev_tier != new_tier:
            changes.append(f"tier: {prev_tier} -> {new_tier}")
        prev_q = prev.get("quality_score") if prev else None
        new_q = new_r.get("quality_score")
        if prev_q is not None and new_q is not None and prev_q != new_q:
            changes.append(f"quality_score: {prev_q} -> {new_q}")
        prev_roi = prev.get("overall_roi") if prev else None
        new_roi = new_r.get("overall_roi")
        if prev_roi is not None and new_roi is not None and abs((prev_roi or 0) - (new_roi or 0)) > 0.05:
            changes.append(f"ROI: {prev_roi:.1f}% -> {new_roi:.1f}%")
        prev_pnl = prev.get("total_profit") if prev else None
        new_pnl = new_r.get("total_profit")
        if prev_pnl is not None and new_pnl is not None and abs((prev_pnl or 0) - (new_pnl or 0)) > 1:
            changes.append(f"total_profit: ${prev_pnl:,.0f} -> ${new_pnl:,.0f}")
        tail_prev = (prev.get("tail_guide") or "")[:200] if prev else ""
        tail_new = (new_r.get("tail_guide") or "")[:200]
        if tail_prev != tail_new and (tail_prev or tail_new):
            changes.append("tail_guide (do-not-tail / tail logic) updated")
        if not changes:
            continue
        out.append({
            "username": username,
            "wallet": wallet,
            "changes": changes,
            "previous": {"tier": prev_tier, "quality_score": prev_q, "overall_roi": prev_roi, "total_profit": prev_pnl} if prev else None,
            "new": {"tier": new_tier, "quality_score": new_q, "overall_roi": new_roi, "total_profit": new_pnl},
        })
    return out

def write_grade_changes_report(changes):
    """Write grade_changes_<timestamp>.json and print summary."""
    if not changes:
        return
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    path = OUTPUT_DIR / f"grade_changes_{ts}.json"
    with open(path, "w") as f:
        json.dump(changes, f, indent=2, default=str)
    print(f"\n{'='*70}")
    print("GRADE CHANGES (why / what / cause)")
    print(f"{'='*70}")
    print(f"Report written to {path.name}")
    for c in changes:
        print(f"  {c['username']}:")
        for line in c["changes"]:
            print(f"    - {line}")
    print(f"{'='*70}\n")

# ================================================================
# BACKEND INGEST
# ================================================================

def ingest_to_backend(all_results):
    url = f"{BACKEND_URL}/api/elite/traders/ingest-analysis"
    print(f"\n\n{'='*70}")
    print(f"[PUSH] Pushing {len(all_results)} trader analyses to backend...")
    try:
        resp = requests.post(url, json={"traders": all_results}, timeout=60)
        if resp.status_code == 200:
            data = resp.json()
            updated = data.get("updated", 0)
            print(f"    [OK] {updated} traders updated in DB")
            for r in data.get("summary", [])[:10]:
                print(f"       {r['tier']:<8} Q={r['quality_score']:>3}  {r['username']:<30} ROI={r['roi']:.1f}%")
            return True
        else:
            print(f"    [X] Backend error {resp.status_code}: {resp.text[:300]}")
            return False
    except Exception as e:
        print(f"    [X] Error: {e}")
        return False


# ================================================================
# REBUILD MASTER _all_analysis.json FROM EXISTING JSON FILES
# ================================================================

def rebuild_master_json():
    """Merge all per-trader JSON files into the master summary. One entry per wallet (dedupe)."""
    by_wallet: dict[str, dict] = {}
    for json_file in sorted(OUTPUT_DIR.glob("*.json")):
        if json_file.name.startswith("_"):
            continue
        if "_trades.json" in json_file.name or json_file.name.endswith("_trades.json"):
            continue  # skip alternate exports (e.g. RN1_trades.json) so RN1 appears once
        try:
            with open(json_file) as f:
                data = json.load(f)
            wallet = (data.get("wallet") or "").strip().lower()
            if not wallet or "username" not in data:
                continue
            # Keep first per wallet (sorted filename order); prefer main file over any other
            if wallet not in by_wallet:
                by_wallet[wallet] = data
        except Exception:
            pass

    all_results = list(by_wallet.values())
    # Sort by quality score descending
    all_results.sort(key=lambda x: x.get("quality_score", 0), reverse=True)
    summary_path = OUTPUT_DIR / "_all_analysis.json"
    with open(summary_path, "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    return all_results


# ================================================================
# MAIN
# ================================================================

def main():
    # Apply username filter
    if FILTER_NAMES:
        traders = [(w, u) for w, u in ALL_TRADERS if u in FILTER_NAMES]
        missing = FILTER_NAMES - {u for _, u in traders}
        if missing:
            print(f"⚠️  Unknown trader names: {', '.join(missing)}")
        if not traders:
            print("No matching traders found. Check spelling (case-sensitive).")
            sys.exit(1)
    else:
        traders = ALL_TRADERS

    print(f"{'='*70}")
    print(f"Polymarket Pipeline — {len(traders)} trader(s)")
    mode = "analyze-only" if ANALYZE_ONLY else "incremental (merge recent + re-analyze)" if INCREMENTAL else (f"fetch (stale>{STALE_DAYS:.0f}d)" if STALE_DAYS else "fetch all")
    if SKIP_IF_ROWS_OVER:
        mode += f", skip re-fetch if rows>{SKIP_IF_ROWS_OVER:,}"
    print(f"Mode: {mode}{' + ingest' if INGEST else ''}")
    print(f"Output: {OUTPUT_DIR}")
    print(f"{'='*70}")

    processed = []
    skipped   = []
    failed    = []

    for i, (address, username) in enumerate(traders, 1):
        print(f"\n[{i}/{len(traders)}]", end="")

        # Stale-days skip (for non-analyze-only runs)
        if not ANALYZE_ONLY and STALE_DAYS > 0:
            age = csv_age_days(address, username)
            if age is not None and age < STALE_DAYS:
                print(f"\n[skip] {username} — CSV is {age:.1f}d old, skipping (stale threshold {STALE_DAYS}d)")
                # Still analyze from existing CSV so we can ingest
                json_path = json_path_for(address, username)
                if json_path.exists():
                    try:
                        with open(json_path) as f:
                            data = json.load(f)
                        processed.append(data)
                        skipped.append(username)
                        continue
                    except Exception:
                        pass
                # JSON missing — fall through to run analysis on existing CSV
                try:
                    csv_p = csv_path_for(address, username)
                    if csv_p.exists():
                        result = analyze_csv(csv_p, username, address)
                        with open(json_path, "w") as f:
                            json.dump(result, f, indent=2, default=str)
                        processed.append(result)
                        skipped.append(username)
                        continue
                except Exception:
                    pass

        try:
            result = process_trader(address, username)
            if result:
                processed.append(result)
            else:
                failed.append(username)
        except Exception as e:
            print(f"\n    [X] Unhandled error for {username}: {e}")
            failed.append(username)

    # ── Rebuild master JSON (merges new results with any pre-existing JSONs) ─
    all_results = rebuild_master_json()

    # ── Print leaderboard ─────────────────────────────────────────
    print(f"\n\n{'='*70}")
    print(f"DONE — {len(processed)} processed ({len(skipped)} from cache), {len(failed)} failed")
    print(f"{'='*70}")

    ranked = sorted(processed, key=lambda x: x.get("quality_score", 0), reverse=True)
    print(f"\n{'Rank':<5} {'Tier':<8} {'Score':>5} {'Username':<32} {'Net PnL':>14} {'ROI':>8} {'Sharpe':>7}")
    print("-" * 80)
    for rank, r in enumerate(ranked, 1):
        print(
            f"{rank:<5} {r['tier']:<8} {r['quality_score']:>5} "
            f"{r['username']:<32} ${r['total_profit']:>12,.0f} "
            f"{r['overall_roi']:>7.1f}%  {r['pseudo_sharpe']:>6.1f}"
        )

    print(f"\n[OK] Master JSON has {len(all_results)} traders total -> output/_all_analysis.json")

    if INGEST:
        previous = load_previous_ingest()
        ok = ingest_to_backend(all_results)
        if ok:
            changes = compute_grade_changes(previous, all_results)
            write_grade_changes_report(changes)
            with open(PREVIOUS_INGEST_PATH, "w") as f:
                json.dump(all_results, f, indent=2, default=str)
            print(f"[OK] Snapshot saved -> output/_previous_ingest.json (for next run's grade-change diff)")
            write_last_pipeline_run_timestamp()
        else:
            print("\n[FAIL] Ingest did not update the database. Fix DATABASE_URL / Postgres, then re-run with --ingest.")
            sys.exit(1)
    else:
        print(f"\nTip: Add --ingest to push results to the backend database.")

    if failed:
        print(f"\n⚠️  Failed: {', '.join(failed)}")


if __name__ == "__main__":
    main()
