import requests
import pandas as pd
import time
import csv
import os
from pathlib import Path

# ================================================================
# OUTPUT DIR
# ================================================================
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

# ================================================================
# ALL CURATED TRADERS  (wallet → username)
# ================================================================
TRADERS = [
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
    ("0x8c0b024c17831a0dde038547b7e791ae6a0d7aa5", "IBOV200K"),
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
    # DB-only traders (added outside code but tracked in DB)
    ("0x37c1874a60d348903594a96703e0507c518fc53a", "CemeterySun"),
    ("0x6ac5bb06a9eb05641fd5e82640268b92f3ab4b6e", "0p0jogggg"),
    ("0x7ea571c40408f340c1c8fc8eaacebab53c1bde7b", "Cannae"),
    ("0x2005d16a84ceefa912d4e380cd32e7ff827875ea", "RN1"),
    ("0x204f72f35326db932158cba6adff0b9a1da95e14", "swisstony"),
]

# ================================================================
# CATEGORY CLASSIFIER  (exact copy from your script)
# ================================================================
def classify(row):
    slug  = str(row.get("eventSlug", "") or row.get("slug", "")).lower()
    title = str(row.get("title", "")).lower()

    if (any(x in slug for x in ["nba-", "wnba-", "nfl-", "mlb-", "nhl-", "playoffs", "super-bowl"])
            or any(x in title for x in ["spread", "o/u", "mvp"])):
        return "SPORTS", "NBA"
    if any(x in slug for x in ["election", "presidential", "nominee", "will-"]):
        return "POLITICS", "WILL"

    return "OTHER", "Other"

# ================================================================
# FETCH FUNCTION  (exact copy from your script)
# ================================================================
def fetch_positions(address, endpoint):
    base_url = f"https://data-api.polymarket.com/{endpoint}"
    params   = {"user": address, "limit": 50, "offset": 0}
    all_data = []
    page     = 0

    while True:
        try:
            resp = requests.get(base_url, params=params, timeout=30)
        except requests.exceptions.RequestException as e:
            print(f"    ⚠️  {endpoint} page {page} network error: {e}")
            break

        if resp.status_code == 400:
            print(f"    🛑 {endpoint} hit 400 — end of data")
            break
        if resp.status_code != 200:
            print(f"    ❌ {endpoint} page {page} error {resp.status_code}")
            break

        data = resp.json()
        if not data:
            break

        all_data.extend(data)
        params["offset"] += 50
        page += 1
        time.sleep(0.5)

    return pd.DataFrame(all_data)

# ================================================================
# PROCESS ONE TRADER
# ================================================================
def process_trader(address, username):
    safe_username = username.replace("/", "_").replace("\\", "_")
    out_file = OUTPUT_DIR / f"{safe_username}_{address[:8]}.csv"

    print(f"\n{'='*70}")
    print(f"🚀  {username}  ({address})")
    print(f"{'='*70}")

    df_closed = fetch_positions(address, "closed-positions")
    df_open   = fetch_positions(address, "positions")

    df_closed["status"] = "closed"
    df_open["status"]   = "open"

    df = pd.concat([df_closed, df_open], ignore_index=True)

    if df.empty:
        print(f"    ⚠️  No data returned — skipping.")
        return None

    # De-duplicate (closed-positions and positions can overlap)
    if "id" in df.columns:
        df = df.drop_duplicates(subset=["id"])

    # Numeric coercion
    money_cols = ["realizedPnl", "cashPnl", "currentValue", "initialValue"]
    for col in money_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        else:
            df[col] = 0.0

    df["value"] = df["currentValue"] if "currentValue" in df.columns else 0.0

    # Category classification
    df[["main_category", "sub_category"]] = df.apply(
        lambda r: pd.Series(classify(r)), axis=1
    )

    # THE KEY FORMULA — total PnL per position
    df["total_position_pnl"] = df["realizedPnl"] + df["cashPnl"]

    # Save CSV (quoted, same as your script)
    df.to_csv(out_file, index=False, quoting=csv.QUOTE_ALL)

    # ── Event-level aggregation (exact logic from your debug block) ──────────
    df["grouping_id"] = df["eventSlug"].fillna(df["slug"]) if "eventSlug" in df.columns else df.get("slug", "")

    event_pnl  = df.groupby("grouping_id")["total_position_pnl"].sum()
    gains      = event_pnl[event_pnl > 0].sum()
    losses     = event_pnl[event_pnl < 0].sum()
    total_pnl  = event_pnl.sum()

    sports_df  = df[df["main_category"] == "SPORTS"]
    sports_pnl = sports_df.groupby("grouping_id")["total_position_pnl"].sum().sum() if not sports_df.empty else 0
    open_value = df[df["status"] == "open"]["value"].sum()

    print(f"    Rows       : {len(df):,}  ({len(df_closed):,} closed + {len(df_open):,} open)")
    print(f"    Net Gains  : +${gains:,.0f}")
    print(f"    Net Losses : -${abs(losses):,.0f}")
    print(f"    TOTAL PNL  : ${total_pnl:,.0f}")
    print(f"    Sports PNL : ${sports_pnl:,.0f}")
    print(f"    Open Value : ${open_value:,.0f}")
    print(f"    ✅  Saved  → {out_file.name}")

    return {
        "username":    username,
        "address":     address,
        "rows":        len(df),
        "total_pnl":   round(total_pnl, 2),
        "sports_pnl":  round(sports_pnl, 2),
        "gains":       round(gains, 2),
        "losses":      round(losses, 2),
        "open_value":  round(open_value, 2),
        "csv_file":    out_file.name,
    }

# ================================================================
# MAIN
# ================================================================
def main():
    print(f"Polymarket Full Position Scraper — ALL CURATED TRADERS")
    print(f"Output dir: {OUTPUT_DIR}")
    print(f"Traders to process: {len(TRADERS)}")

    summaries = []
    failed    = []

    for i, (address, username) in enumerate(TRADERS, 1):
        print(f"\n[{i}/{len(TRADERS)}]", end="")
        try:
            result = process_trader(address, username)
            if result:
                summaries.append(result)
            else:
                failed.append(username)
        except Exception as e:
            print(f"\n    ❌  Unhandled error for {username}: {e}")
            failed.append(username)

    # ── Master summary CSV ───────────────────────────────────────────────────
    if summaries:
        summary_file = OUTPUT_DIR / "_all_traders_summary.csv"
        summary_df   = pd.DataFrame(summaries).sort_values("total_pnl", ascending=False)
        summary_df.to_csv(summary_file, index=False, quoting=csv.QUOTE_ALL)

        print(f"\n\n{'='*70}")
        print(f"COMPLETE — {len(summaries)} traders processed, {len(failed)} failed")
        print(f"{'='*70}")
        print(f"\n{'Rank':<5} {'Username':<35} {'Total PnL':>14} {'Open Value':>12}")
        print("-" * 70)
        for rank, row in enumerate(summary_df.itertuples(), 1):
            print(f"{rank:<5} {row.username:<35} ${row.total_pnl:>12,.0f}  ${row.open_value:>10,.0f}")

        print(f"\nMaster summary → {summary_file.name}")

    if failed:
        print(f"\nFailed ({len(failed)}): {', '.join(failed)}")


if __name__ == "__main__":
    main()
