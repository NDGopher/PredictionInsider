"""
Ingest locally-generated CSVs into the analysis system.

USAGE:
  # Analyze all CSVs currently in output/ and push to backend
  python3 pnl_analysis/ingest_csvs.py --ingest

  # Analyze only, no push (review results first)
  python3 pnl_analysis/ingest_csvs.py

  # Analyze a specific CSV file
  python3 pnl_analysis/ingest_csvs.py --file output/geniusMC_0x0b9cae.csv

HOW TO USE WITH LOCAL CSVs:
  1. Run your script locally for any trader(s)
  2. Copy the resulting CSV(s) into pnl_analysis/output/
     Name format: <username>_<wallet_first8>.csv
     e.g.  geniusMC_0x0b9cae.csv
  3. Run:  python3 pnl_analysis/ingest_csvs.py --ingest
"""

import sys, os, json, argparse, requests
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_trader import analyze_csv

# ── wallet→username lookup (needed to match CSV filename → wallet) ───────────
TRADER_MAP = {
    "kch123":                            "0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee",
    "DLEK":                              "0x6e82b93eb57b01a63027bd0c6d2f3f04934a752c",
    "JhonAlexanderHinestroza":           "0x44c58184f89a5c2f699dc8943009cb3d75a08d45",
    "ShortFlutterStock":                 "0x13414a77a4be48988851c73dfd824d0168e70853",
    "Avarice31":                         "0x781caf04d98a281712caf1677877c442789fdb68",
    "Capman":                            "0xc5b5bbd42624a8f0c8dfa90221913007d8c77e80",
    "ShucksIt69":                        "0x84dbb7103982e3617704a2ed7d5b39691952aeeb",
    "EIf":                               "0xd6966eb1ae7b52320ba7ab1016680198c9e08a49",
    "ckw":                               "0x92672c80d36dcd08172aa1e51dface0f20b70f9a",
    "bigmoneyloser00":                   "0xdbb9b3616f733e19278d1ca6f3207a8344b5ed8d",
    "fkgggg2":                           "0x52ecea7b3159f09db589e4f4ee64872fd0bba6f3",
    "0xD9E0AACa471f48F91A26E8669A805f2":  "0xd9e0aaca471f489be338fd0f91a26e8669a805f2",
    "RandomPunter":                      "0xf588b19afe63e1aba00f125f91e3e3b0fdc62b81",
    "JuniorB":                           "0x9ac5c8496bc84f642bac181499bf64405a5c6a3d",
    "0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563": "0x2c335066fe58fe9237c3d3dc7b275c2a034a0563",
    "0x20D6436849F930584892730C7F96eBB2Ac763856":  "0x20d6436849f930584892730c7f96ebb2ac763856",
    "S-Works":                           "0xee00ba338c59557141789b127927a55f5cc5cea1",
    "BoomLaLa":                          "0xe40172522c7c64afa2d052ddae6c92cd0f417b88",
    "Bienville":                         "0x9f138019d5481fdc5c59b93b0ae4b9b817cce0fd",
    "tcp2":                              "0x6b7c75862e64d6e976d2c08ad9f9b54add6c5f83",
    "0xheavy888":                        "0xec981ed70ae69c5cbcac08c1ba063e734f6bafcd",
    "LynxTitan":                         "0x68146921df11eab44296dc4e58025ca84741a9e7",
    "geniusMC":                          "0x0b9cae2b0dfe7a71c413e0604eaac1c352f87e44",
    "redskinrick":                       "0xe24838258b572f1771dffba3bcdde57a78def293",
    "middleoftheocean":                  "0x6c743aafd813475986dcd930f380a1f50901bd4e",
    "Andromeda1":                        "0x39932ca2b7a1b8ab6cbf0b8f7419261b950ccded",
    "CoryLahey":                         "0x5c3a1a602848565bb16165fcd460b00c3d43020b",
    "TheArena":                          "0xafd492974cd531aae7786210438ae46b42047e61",
    "xytest":                            "0x3471a897e56a8d3621ca79af87dae4325977f17e",
    "UAEVALORANTFAN":                    "0xc65ca4755436f82d8eb461e65781584b8cadea39",
    "TheMangler":                        "0x9703676286b93c2eca71ca96e8757104519a69c2",
    "iDropMyHotdog":                     "0xc49fe658479db29e1a2fefebf0735f657dca9e05",
    "bloodmaster":                       "0x58f8f1138be2192696378629fc9aa23c7910dc70",
    "9sh8f":                             "0xf9b5f7293b8258be8b0e1f03717c5d2ad94809ee",
    "0x53eCc53E7":                        "0x53ecc53e7a69aad0e6dda60264cc2e363092df91",
    "877s8d8g89I9f8d98fd99ww2":          "0x1b5e20a28d7115f10ce6190a5ae9a91169be83f8",
    "Vetch":                             "0x9c82c60829df081d593055ee5fa288870c051f13",
    "TTdes":                             "0x25867077c891354137bbaf7fde12eec6949cc893",
    "Supah9ga":                          "0x57cd939930fd119067ca9dc42b22b3e15708a0fb",
    "norrisfan":                         "0xe72bb501df5306c75c89383d48a1e81073fbb0a0",
    "HedgeMaster88":                     "0x036c159d5a348058a81066a76b89f35926d4178d",
    "CemeterySun":                       "0x37c1874a60d348903594a96703e0507c518fc53a",
    "0p0jogggg":                         "0x6ac5bb06a9eb05641fd5e82640268b92f3ab4b6e",
    "Cannae":                            "0x7ea571c40408f340c1c8fc8eaacebab53c1bde7b",
    "RN1":                               "0x2005d16a84ceefa912d4e380cd32e7ff827875ea",
    "swisstony":                         "0x204f72f35326db932158cba6adff0b9a1da95e14",
}

OUTPUT_DIR  = Path(__file__).resolve().parent / "output"
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:5000")

parser = argparse.ArgumentParser()
parser.add_argument("--ingest",  action="store_true", help="Push to backend after analysis")
parser.add_argument("--file",    type=str, default="", help="Specific CSV file to process")
args, _ = parser.parse_known_args()


def username_from_filename(filename: str) -> tuple[str, str] | None:
    """Infer username and wallet from filename like 'geniusMC_0x0b9cae.csv'"""
    stem = Path(filename).stem  # e.g. geniusMC_0x0b9cae
    parts = stem.rsplit("_", 1)
    if len(parts) != 2:
        return None
    username, wallet_prefix = parts
    wallet = TRADER_MAP.get(username)
    if not wallet:
        # Try to find by prefix
        for u, w in TRADER_MAP.items():
            if w.startswith(wallet_prefix.lower()):
                return u, w
        return None
    return username, wallet


def ingest_to_backend(all_results):
    url = f"{BACKEND_URL}/api/elite/traders/ingest-analysis"
    print(f"\n📤  Pushing {len(all_results)} traders to backend...")
    try:
        resp = requests.post(url, json={"traders": all_results}, timeout=60)
        if resp.status_code == 200:
            data = resp.json()
            print(f"    ✅ {data.get('updated', 0)} traders updated in DB")
            for r in data.get("summary", []):
                print(f"       {r['tier']:<8} Q={r['quality_score']:>3}  {r['username']:<30} ROI={r.get('roi',0):.1f}%  PnL=${r.get('pnl',0):,.0f}")
        else:
            print(f"    ❌ Backend error {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        print(f"    ❌ {e}")


def rebuild_master(new_results):
    """Merge new results into the master JSON."""
    master_path = OUTPUT_DIR / "_all_analysis.json"
    existing = {}
    if master_path.exists():
        try:
            with open(master_path) as f:
                for r in json.load(f):
                    existing[r.get("wallet", "")] = r
        except Exception:
            pass

    for r in new_results:
        existing[r["wallet"]] = r

    ranked = sorted(existing.values(), key=lambda x: x.get("quality_score", 0), reverse=True)
    with open(master_path, "w") as f:
        json.dump(ranked, f, indent=2, default=str)
    return ranked


def main():
    # ── Determine which CSV files to process ────────────────────
    if args.file:
        csv_files = [Path(args.file)]
    else:
        csv_files = [f for f in sorted(OUTPUT_DIR.glob("*.csv")) if not f.name.startswith("_")]

    if not csv_files:
        print("No CSVs found in output/. Drop your CSVs there and re-run.")
        sys.exit(1)

    results = []
    for csv_path in csv_files:
        info = username_from_filename(csv_path.name)
        if not info:
            print(f"⚠️  Skipping {csv_path.name} — can't match to a known trader")
            continue

        username, wallet = info
        print(f"\n{'='*60}")
        print(f"📊  Analyzing {username}")

        try:
            result = analyze_csv(csv_path, username, wallet)

            # Save per-trader JSON
            json_path = csv_path.with_suffix(".json")
            with open(json_path, "w") as f:
                json.dump(result, f, indent=2, default=str)

            print(f"  {result['tier']} (Q={result['quality_score']})  ROI={result['overall_roi']:.1f}%  Sharpe={result['pseudo_sharpe']:.1f}  PnL=${result['total_profit']:,.0f}")
            print(f"  Tags: {', '.join(result['tags'][:6])}")
            print(f"  Tail guide:\n    " + result["tail_guide"].replace("\n", "\n    "))
            results.append(result)

        except Exception as e:
            print(f"  ❌ Failed: {e}")
            import traceback; traceback.print_exc()

    # ── Update master JSON ───────────────────────────────────────
    all_results = rebuild_master(results)
    print(f"\n\n📁 Master JSON updated ({len(all_results)} total traders)")

    # ── Print leaderboard for this run ──────────────────────────
    print(f"\n{'Rank':<5} {'Tier':<8} {'Score':>5} {'Username':<32} {'PnL':>14} {'ROI':>8}")
    print("-" * 75)
    for rank, r in enumerate(sorted(results, key=lambda x: -x.get("quality_score", 0)), 1):
        print(f"{rank:<5} {r['tier']:<8} {r['quality_score']:>5} {r['username']:<32} ${r['total_profit']:>12,.0f} {r['overall_roi']:>7.1f}%")

    # ── Canonical overrides — applied AFTER CSV analysis ────────────────────
    # Use these when Gemini's stripped analysis differs from raw CSV totals.
    # The key is the full wallet address; fields override the result dict.
    CANONICAL_OVERRIDES: dict[str, dict] = {
        "0x9703676286b93c2eca71ca96e8757104519a69c2": {  # TheMangler
            # Raw CSV includes ~$24M wash-trades + bond-yield parking.
            # Gemini stripped directional ROI: 41.81% on $1.25M real risk.
            "overall_roi": 41.81,
        },
    }
    for r in all_results:
        overrides = CANONICAL_OVERRIDES.get(r.get("wallet", ""))
        if overrides:
            r.update(overrides)
            print(f"  📌 Canonical override applied for {r.get('username')}: {overrides}")

    if args.ingest:
        ingest_to_backend(all_results)
    else:
        print(f"\n💡 Run with --ingest to push to backend")


if __name__ == "__main__":
    main()
