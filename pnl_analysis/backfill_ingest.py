"""
One-shot backfill: push existing _all_analysis.json to the backend so PNL/ROI
display matches pipeline (raw_realized_pnl). Use after run_full_pipeline.py
has been run without --ingest, or to refresh DB from current JSON.

  BACKEND_URL=http://localhost:5000 python pnl_analysis/backfill_ingest.py
"""
import os
import json
import requests
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent / "output"
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:5000")

def main():
    path = OUTPUT_DIR / "_all_analysis.json"
    if not path.exists():
        print(f"Not found: {path}")
        print("Run: python pnl_analysis/run_full_pipeline.py --analyze-only  (then re-run this with --ingest or use this script)")
        return 1
    with open(path) as f:
        traders = json.load(f)
    if not isinstance(traders, list):
        traders = [traders]
    url = f"{BACKEND_URL}/api/elite/traders/ingest-analysis"
    print(f"Pushing {len(traders)} traders to {url} ...")
    try:
        r = requests.post(url, json={"traders": traders}, timeout=60)
        if r.status_code == 200:
            d = r.json()
            print(f"Updated: {d.get('updated', 0)} traders")
            for s in d.get("summary", [])[:15]:
                print(f"  {s.get('tier', '')} Q={s.get('quality_score', 0)} {s.get('username', '')} ROI={s.get('roi', 0):.1f}%")
            return 0
        print(f"Error {r.status_code}: {r.text[:400]}")
        return 1
    except Exception as e:
        print(f"Request failed: {e}")
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
