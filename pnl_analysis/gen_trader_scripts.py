"""
Generate one Cannae-style .py script per trader. Each script fetches closed-positions + positions
from Polymarket, dedupes by id, and writes to pnl_analysis/output/{safe_username}_{wallet8}.csv
so the pipeline and ingest stay in sync. Run from repo root:
  python pnl_analysis/gen_trader_scripts.py
"""
from pathlib import Path

OUTPUT_SCRIPTS_DIR = Path(__file__).resolve().parent / "trader_scripts"
OUTPUT_CSV_DIR     = Path(__file__).resolve().parent / "output"

# Same list as run_full_pipeline.ALL_TRADERS
ALL_TRADERS = [
    ("0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee", "kch123"),
    ("0x6e82b93eb57b01a63027bd0c6d2f3f04934a752c", "DLEK"),
    ("0x44c58184f89a5c2f699dc8943009cb3d75a08d45", "JhonAlexanderHinestroza"),
    ("0x13414a77a4be48988851c73dfd824d0168e70853", "ShortFlutterStock"),
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

TEMPLATE = '''"""
Trader CSV fetcher: {username} — same logic as polyhistory/Cannae.py.
Writes to pnl_analysis/output so pipeline and ingest stay in sync.
Run from repo root: python pnl_analysis/trader_scripts/{script_name}
"""
import requests
import pandas as pd
import time
import csv
from pathlib import Path

ADDRESS = "{address}"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)
FINAL_CSV = OUTPUT_DIR / "{csv_name}"

print(f"Dashboard-matching scraper for {{ADDRESS}} -> {{FINAL_CSV.name}}")

def fetch_positions(endpoint):
    base_url = "https://data-api.polymarket.com/{{}}".format(endpoint)
    params = {{"user": ADDRESS, "limit": 50, "offset": 0}}
    all_data = []
    page = 0
    while True:
        resp = requests.get(base_url, params=params)
        if resp.status_code == 400:
            break
        if resp.status_code != 200:
            print(f"{{endpoint}} page {{page}} error {{resp.status_code}}")
            break
        data = resp.json()
        if not data:
            break
        all_data.extend(data)
        params["offset"] += 50
        page += 1
        time.sleep(0.5)
    return pd.DataFrame(all_data)

df_closed = fetch_positions("closed-positions")
df_open = fetch_positions("positions")
df_closed["status"] = "closed"
df_open["status"] = "open"
df = pd.concat([df_closed, df_open], ignore_index=True)

def classify(row):
    slug = str(row.get("eventSlug", "") or row.get("slug", "")).lower()
    title = str(row.get("title", "")).lower()
    if any(x in slug for x in ["nba-", "wnba-", "nfl-", "mlb-", "nhl-", "playoffs", "super-bowl"]) or any(x in title for x in ["spread", "o/u", "mvp"]):
        return "SPORTS", "NBA"
    if any(x in slug for x in ["election", "presidential", "nominee", "will-"]):
        return "POLITICS", "WILL"
    return "OTHER", "Other"

df[["main_category", "sub_category"]] = df.apply(lambda r: pd.Series(classify(r)), axis=1)
if "id" in df.columns:
    df = df.drop_duplicates(subset=["id"])
money_cols = ["realizedPnl", "cashPnl", "currentValue", "initialValue"]
for col in money_cols:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    else:
        df[col] = 0.0
df["value"] = df["currentValue"]
df["total_position_pnl"] = df["realizedPnl"] + df["cashPnl"]
df["grouping_id"] = df["eventSlug"].fillna(df["slug"])

df.to_csv(FINAL_CSV, index=False, quoting=csv.QUOTE_ALL)
print(f"Saved {{len(df):,}} rows -> {{FINAL_CSV}}")
'''


def main():
    OUTPUT_SCRIPTS_DIR.mkdir(exist_ok=True)
    OUTPUT_CSV_DIR.mkdir(exist_ok=True)
    for wallet, username in ALL_TRADERS:
        safe = username.replace("/", "_").replace("\\", "_")
        csv_name = f"{safe}_{wallet[:8]}.csv"
        script_name = f"{safe}_{wallet[:8]}.py"
        content = TEMPLATE.format(
            username=username,
            script_name=script_name,
            address=wallet,
            csv_name=csv_name,
        )
        path = OUTPUT_SCRIPTS_DIR / script_name
        path.write_text(content, encoding="utf-8")
        print(f"  {script_name}")
    print(f"Wrote {len(ALL_TRADERS)} scripts to {OUTPUT_SCRIPTS_DIR}")


if __name__ == "__main__":
    main()
