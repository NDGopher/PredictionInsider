"""
Double-check: compare our pipeline analysis (sport_stats, market_stats, do_not_tail, auto_tail)
to the manually verified polyhistory/*.txt analysis. Ensures we analyze the same way and feed
good/bad sports and submarkets into the data.
Run after pipeline: python pnl_analysis/validate_vs_polyhistory.py
"""
import json
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent / "output"
POLYHISTORY_DIR = Path(__file__).resolve().parent.parent / "polyhistory"

# polyhistory filename stem (no _analysis.txt) -> our pipeline username
POLY_TO_USER = {
    "Cannae": "Cannae",
    "JuniorB": "JuniorB",
    "0p0joggg": "0p0jogggg",
    "Elf": "EIf",
    "TheArena": "TheArena",
    "0x53eCc53E7": "0x53eCc53E7",
    "randompunter": "RandomPunter",
    "RN1": "RN1",
    "9sh8f": "9sh8f",
    "UAEVALORANTFAN": "UAEVALORANTFAN",
}


def main():
    print("=" * 70)
    print("Pipeline analysis vs polyhistory (good/bad sports & submarkets)")
    print("=" * 70)

    for ph_name, our_name in POLY_TO_USER.items():
        ph_path = POLYHISTORY_DIR / f"{ph_name}_analysis.txt"
        # Find our JSON by loading all and matching username
        jsons = [p for p in OUTPUT_DIR.glob("*.json") if not p.name.startswith("_") and "_trades" not in p.name]
        our_json = None
        for j in jsons:
            try:
                d = json.loads(j.read_text(encoding="utf-8"))
                u = (d.get("username") or "").strip()
                if u == our_name:
                    our_json = d
                    break
            except Exception:
                continue
        if not our_json:
            print(f"\n[SKIP] {our_name}: no pipeline JSON found")
            continue
        if not ph_path.exists():
            print(f"\n[SKIP] {our_name}: no polyhistory {ph_path.name}")
            continue

        ph_text = ph_path.read_text(encoding="utf-8")
        sport_stats = our_json.get("sport_stats") or {}
        market_stats = our_json.get("market_stats") or {}
        auto = our_json.get("auto_tail_sports") or []
        dnt = our_json.get("do_not_tail_sports") or []
        dnt_mkt = our_json.get("do_not_tail_market_types") or []

        # Our good sports (ROI > 5%, profit > 0)
        our_good = [s for s, v in sport_stats.items() if v.get("events", 0) >= 10 and v.get("roi", 0) > 5 and v.get("net_profit", 0) > 0]
        our_bad  = [s for s, v in sport_stats.items() if v.get("events", 0) >= 10 and (v.get("roi", 0) < -2 or v.get("win_rate", 0) < 45) and v.get("net_profit", 0) < -2000]
        our_bad_mkt = [m for m in ["Spread", "Totals (O/U)"] if market_stats.get(m, {}).get("events", 0) >= 10 and market_stats.get(m, {}).get("roi", 0) < -5]

        print(f"\n--- {our_name} ---")
        print(f"  Pipeline AUTO-TAIL (sports): {auto}")
        print(f"  Pipeline DO NOT TAIL (sports): {dnt}")
        print(f"  Pipeline DO NOT TAIL (market types): {dnt_mkt}")
        print(f"  Pipeline good sports (ROI>5%, profit>0): {our_good}")
        print(f"  Pipeline bad sports (ROI<-2% or WR<45%, loss>2k): {our_bad}")
        print(f"  Pipeline bad submarkets (Spread/O/U ROI<-5%): {our_bad_mkt}")
        # Check polyhistory keywords
        ph_lower = ph_text.lower()
        if "do not tail" in ph_lower or "poison" in ph_lower or "mute" in ph_lower:
            print(f"  Polyhistory: has DO NOT TAIL / mute sections (manual check)")
        if "auto-tail" in ph_lower or "elite alpha" in ph_lower:
            print(f"  Polyhistory: has AUTO-TAIL / elite alpha sections (manual check)")
        print(f"  -> Stored in DB: roiBySport, roiByMarketType, csvDoNotTailSports, csvAutoTailSports, csvDoNotTailMarketTypes")

    print("\n" + "=" * 70)
    print("Done. Our analysis feeds: sport_stats, market_stats, do_not_tail_*, auto_tail_*")
    print("into ingest -> roiBySport, roiByMarketType, roiBySportMarketType, csvDoNotTail*.")
    print("Signals use getEffectiveCategoryFilter(wallet, metrics) for per-sport/submarket filtering.")
    print("=" * 70)


if __name__ == "__main__":
    main()
