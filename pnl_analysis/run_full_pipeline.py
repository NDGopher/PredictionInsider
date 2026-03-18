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
import sys
import os
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_trader import analyze_csv

OUTPUT_DIR  = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:5000")

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
args, _ = parser.parse_known_args()

ANALYZE_ONLY  = args.analyze_only
INGEST        = args.ingest
STALE_DAYS    = args.stale_days
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
    ("0x204f72f35326db932158cba6adff0b9a1da95e14", "swisstony"),
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

def fetch_positions(address, endpoint):
    base_url = f"https://data-api.polymarket.com/{endpoint}"
    params   = {"user": address, "limit": 50, "offset": 0}
    all_data = []

    while True:
        try:
            resp = requests.get(base_url, params=params, timeout=30)
        except requests.exceptions.RequestException as e:
            print(f"    ⚠️  {endpoint} network error: {e}")
            break
        if resp.status_code == 400:
            break
        if resp.status_code != 200:
            print(f"    ❌ {endpoint} HTTP {resp.status_code}")
            break
        data = resp.json()
        if not data:
            break
        all_data.extend(data)
        params["offset"] += 50
        time.sleep(0.5)

    return pd.DataFrame(all_data)


def collect_and_save(address, username):
    csv_path = csv_path_for(address, username)

    df_closed = fetch_positions(address, "closed-positions")
    df_open   = fetch_positions(address, "positions")

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
    print(f"🚀  {username}  ({address})")
    print(f"{'='*70}")

    # ── Decide whether to fetch or use existing CSV ──────────────
    if not ANALYZE_ONLY:
        age = csv_age_days(address, username)
        if STALE_DAYS > 0 and age is not None and age < STALE_DAYS:
            print(f"    ✅ CSV is {age:.1f}d old (< {STALE_DAYS}d stale threshold) — using existing")
        else:
            if age is not None:
                print(f"    🔄 CSV is {age:.1f}d old — re-fetching")
            result = collect_and_save(address, username)
            if result is None:
                return None
    else:
        if not csv_path.exists():
            print(f"    ⚠️  CSV not found — skipping (run without --analyze-only to fetch)")
            return None
        age = csv_age_days(address, username)
        print(f"    📂 Using existing CSV ({age:.1f}d old): {csv_path.name}")

    # ── Gemini-style analysis ─────────────────────────────────────
    try:
        result = analyze_csv(csv_path, username, address)
    except Exception as e:
        print(f"    ❌ Analysis failed: {e}")
        import traceback; traceback.print_exc()
        return None

    with open(json_path, "w") as f:
        json.dump(result, f, indent=2, default=str)

    t  = result["tier"]
    qs = result["quality_score"]
    print(f"    📊 {t}  (score={qs})  ROI={result['overall_roi']:.1f}%  Sharpe={result['pseudo_sharpe']:.1f}")
    print(f"    💰 Net PnL: ${result['total_profit']:,.0f}  |  Win Rate: {result['win_rate']:.1f}%  |  {result['total_events']:,} events")
    print(f"    🏆 Top sport: {result['top_sport']}")
    print(f"    🏷️  Tags: {', '.join(result['tags'][:6])}")
    print(f"    ✅ JSON saved → {json_path.name}")
    return result


# ================================================================
# BACKEND INGEST
# ================================================================

def ingest_to_backend(all_results):
    url = f"{BACKEND_URL}/api/elite/traders/ingest-analysis"
    print(f"\n\n{'='*70}")
    print(f"📤  Pushing {len(all_results)} trader analyses to backend...")
    try:
        resp = requests.post(url, json={"traders": all_results}, timeout=60)
        if resp.status_code == 200:
            data = resp.json()
            updated = data.get("updated", 0)
            print(f"    ✅ {updated} traders updated in DB")
            for r in data.get("summary", [])[:10]:
                print(f"       {r['tier']:<8} Q={r['quality_score']:>3}  {r['username']:<30} ROI={r['roi']:.1f}%")
        else:
            print(f"    ❌ Backend error {resp.status_code}: {resp.text[:300]}")
    except Exception as e:
        print(f"    ❌ Error: {e}")


# ================================================================
# REBUILD MASTER _all_analysis.json FROM EXISTING JSON FILES
# ================================================================

def rebuild_master_json():
    """Merge all per-trader JSON files into the master summary."""
    all_results = []
    for json_file in sorted(OUTPUT_DIR.glob("*.json")):
        if json_file.name.startswith("_"):
            continue
        try:
            with open(json_file) as f:
                data = json.load(f)
            if "wallet" in data and "username" in data:
                all_results.append(data)
        except Exception:
            pass

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
    mode = "analyze-only" if ANALYZE_ONLY else f"fetch (stale>{STALE_DAYS:.0f}d)" if STALE_DAYS else "fetch all"
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
                print(f"\n⏭️  {username} — CSV is {age:.1f}d old, skipping (stale threshold {STALE_DAYS}d)")
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
            print(f"\n    ❌ Unhandled error for {username}: {e}")
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

    print(f"\n📁 Master JSON has {len(all_results)} traders total → output/_all_analysis.json")

    if INGEST:
        # Ingest ALL results from master (not just this run's batch)
        ingest_to_backend(all_results)
    else:
        print(f"\n💡 Add --ingest to push results to the backend database.")

    if failed:
        print(f"\n⚠️  Failed: {', '.join(failed)}")


if __name__ == "__main__":
    main()
