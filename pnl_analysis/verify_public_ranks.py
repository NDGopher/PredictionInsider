#!/usr/bin/env python3
"""Tie our trader CSVs to Polymarket's public APIs and fix winner-sorted closed books.

Polymarket GET /closed-positions defaults to sortBy=REALIZEDPNL DESC. A 200-page
cap stores ~10,000 biggest winners and drops the matching losers. That is how
GoalLineGhost showed +$52M / 73% WR in our JSON while PolyPnL / Polydata show
about −$1M / ~53% WR on the same wallet (0x0346afae…).

Writes:
  pnl_analysis/output/external_verify.json
  pnl_analysis/EXTERNAL_VERIFY.md
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_trader import analyze_csv  # noqa: E402
from run_full_pipeline import (  # noqa: E402
    OUTPUT_DIR,
    PAGE_SLEEP_SEC,
    csv_path_for,
    fetch_closed_positions_complete,
    fetch_open_positions_complete,
    fetch_positions,
    json_path_for,
    roster_traders,
    _merge_position_frames,
)

DATA_API = "https://data-api.polymarket.com"
AS_OF = datetime.now(timezone.utc)

# Independent public snapshots (same wallet as our CSV). Not from our tape.
PUBLIC_PROFILES = {
    "0x0346afae2603313d2bbee96b628536c8cbe352a5": {
        "username": "GoalLineGhost",
        "polypnl_url": "https://polypnl.kaeose.me/profile/0x0346afae2603313d2bbee96b628536c8cbe352a5",
        "polymarket_url": "https://polymarket.com/@GoalLineGhost",
        "polydata_url": "https://polydata.pro/traders/GoalLineGhost",
        "polypnl_pnl": -1_140_000,
        "polypnl_wr": 52.8,
        "polypnl_wr_n": "1925/3648 sports (30d)",
        "polypnl_volume_30d": 86_820_000,
        "polydata_lifetime_pnl": None,
        "note": "Not in Polydata all-time top 50. Lifetime trackers ~−$1.1M to −$2.1M, ~52% WR, ~$247M volume.",
    },
    "0x2005d16a84ceefa912d4e380cd32e7ff827875ea": {
        "username": "RN1",
        "polypnl_url": "https://polymarket.com/@RN1",
        "polymarket_url": "https://polymarket.com/@RN1",
        "polydata_url": "https://polydata.pro/traders/RN1",
        "polypnl_pnl": None,
        "polypnl_wr": None,
        "polydata_lifetime_pnl": 12_770_000,
        "polydata_rank": 4,
        "polydata_sports_rank": 2,
        "polydata_sports_pnl": 11_990_000,
        "polydata_volume": 1_075_670_000,
        "polydata_smart_score": 75,
        "note": "Polydata all-time #4 (~+$12.8M). Our CSV is deeper than Ghost's but still PnL-inflated vs Polydata.",
    },
    "0xfe787d2da716d60e8acff57fb87eb13cd4d10319": {
        "username": "ferrariChampions2026",
        "polymarket_url": "https://polymarket.com/@ferrariChampions2026",
        "polydata_url": "https://polydata.pro/traders/ferrariChampions2026",
        "note": "Live Polymarket sports leaderboard ~+$68k (rank 8). Our closed book was also 10k-capped on winners.",
    },
    "0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee": {
        "username": "kch123",
        "polydata_lifetime_pnl": 11_390_000,
        "polydata_rank": 5,
        "polydata_sports_rank": 3,
        "polydata_sports_pnl": 11_490_000,
        "polydata_smart_score": 59,
        "note": "Polydata all-time #5. Our closed book WR ~52% matches public. Dormant for live tailing since ~2026-07-01.",
    },
}


def _get(path: str, **params):
    r = requests.get(f"{DATA_API}{path}", params=params, timeout=45)
    r.raise_for_status()
    return r.json()


def fetch_value(wallet: str) -> float | None:
    try:
        data = _get("/value", user=wallet)
        if isinstance(data, list) and data:
            return float(data[0].get("value") or 0)
        if isinstance(data, dict):
            return float(data.get("value") or 0)
    except Exception as e:
        print(f"  [warn] /value {wallet[:10]}: {e}")
    return None


def fetch_leaderboard(window: str, category: str | None, pages: int = 4) -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()
    for page in range(pages):
        params = {"window": window, "limit": 50, "offset": page * 50}
        if category:
            params["category"] = category
        try:
            data = _get("/v1/leaderboard", **params)
        except Exception as e:
            print(f"  [warn] leaderboard {window}/{category}: {e}")
            break
        if isinstance(data, dict):
            data = data.get("data") or data.get("leaderboard") or data.get("results") or []
        if not data:
            break
        for row in data:
            w = str(row.get("proxyWallet") or "").lower()
            if not w or w in seen:
                continue
            seen.add(w)
            rows.append({
                "rank": int(row.get("rank") or len(rows) + 1),
                "wallet": w,
                "username": str(row.get("userName") or w[:10]),
                "pnl": float(row.get("pnl") or 0),
                "vol": float(row.get("vol") or 0),
                "window": window,
                "category": category or "overall",
            })
        if len(data) < 50:
            break
        time.sleep(0.2)
    return rows


def csv_skew(path: Path) -> dict:
    df = pd.read_csv(path, usecols=lambda c: c in ("status", "realizedPnl", "cashPnl", "curPrice"), low_memory=False)
    r = pd.to_numeric(df.get("realizedPnl", 0), errors="coerce").fillna(0)
    cash = pd.to_numeric(df.get("cashPnl", 0), errors="coerce").fillna(0)
    cp = pd.to_numeric(df.get("curPrice", 0), errors="coerce").fillna(0)
    st = df["status"].astype(str).str.lower() if "status" in df.columns else pd.Series([], dtype=str)
    settled = (cp <= 0.01) | (cp >= 0.99)
    wins = int((cp >= 0.99).sum())
    n_set = int(settled.sum())
    closed = int((st == "closed").sum()) if len(st) else 0
    return {
        "rows": int(len(df)),
        "closed": closed,
        "realized_pos": int((r > 0).sum()),
        "realized_neg": int((r < 0).sum()),
        "sum_realized": round(float(r.sum()), 2),
        "sum_dash": round(float((r + cash).sum()), 2),
        "hold_wr": round(100.0 * wins / n_set, 2) if n_set else 0.0,
        "winner_capped": closed == 10_000 or (closed >= 9_500 and int((r > 0).sum()) >= 0.9 * max(closed, 1)),
    }


def repair_wallet(wallet: str, username: str, pages: int = 160) -> dict:
    csv_path = csv_path_for(wallet, username)
    before = csv_skew(csv_path) if csv_path.exists() else {}
    print(f"\n[repair] {username} closed={before.get('closed')} wr={before.get('hold_wr')} dash=${before.get('sum_dash')}")
    print(f"  fetching loser+recent closed (≤{pages} pages/sort)…")
    closed = fetch_closed_positions_complete(wallet, max_pages=pages)
    time.sleep(PAGE_SLEEP_SEC)
    opened = fetch_open_positions_complete(wallet)
    if closed is None or closed.empty:
        return {"username": username, "wallet": wallet, "error": "no closed rows", "before": before}
    closed = closed.copy()
    closed["status"] = "closed"
    if opened is not None and not opened.empty:
        opened = opened.copy()
        opened["status"] = "open"
        new_df = pd.concat([closed, opened], ignore_index=True)
    else:
        new_df = closed
    existing = pd.read_csv(csv_path, low_memory=False) if csv_path.exists() else pd.DataFrame()
    combined = _merge_position_frames(existing, new_df)
    combined.to_csv(csv_path, index=False)
    after = csv_skew(csv_path)
    print(f"  after rows={after['rows']} closed={after['closed']} wr={after['hold_wr']}% dash=${after['sum_dash']:,.0f}")
    analysis = analyze_csv(csv_path, username, wallet)
    json_path = json_path_for(wallet, username)
    json_path.write_text(json.dumps(analysis, indent=2, default=str), encoding="utf-8")
    return {
        "username": username,
        "wallet": wallet,
        "before": before,
        "after": after,
        "dashboard_pnl": analysis.get("dashboard_pnl"),
        "win_rate": analysis.get("win_rate"),
        "overall_roi": analysis.get("overall_roi"),
        "markets_traded": analysis.get("markets_traded"),
        "last_event_date": analysis.get("last_event_date"),
        "sport_stats": analysis.get("sport_stats"),
        "market_stats": analysis.get("market_stats"),
        "value": fetch_value(wallet),
    }


def recency_band(days: int | None) -> tuple[str, float]:
    if days is None:
        return "UNKNOWN", 0.5
    if days <= 7:
        return "HOT", 1.0
    if days <= 14:
        return "WARM", 0.7
    if days <= 21:
        return "COLD", 0.35
    if days <= 45:
        return "DARK", 0.0
    return "DROP", 0.0


def expert_lanes(analysis: dict, min_n: int = 25, min_roi: int = 8) -> list[dict]:
    sports = analysis.get("sport_stats") or {}
    markets = analysis.get("market_stats") or {}
    experts: list[dict] = []
    bleeds: list[dict] = []
    for name, st in sports.items():
        n = int(st.get("events") or 0)
        roi = float(st.get("roi") or 0)
        wr = float(st.get("win_rate") or 0)
        row = {"lane": name, "n": n, "roi": roi, "wr": wr}
        if n >= min_n and roi >= min_roi:
            experts.append(row)
        elif n >= min_n and roi <= -8:
            bleeds.append(row)
    for name, st in markets.items():
        n = int(st.get("events") or 0)
        roi = float(st.get("roi") or 0)
        wr = float(st.get("win_rate") or 0)
        row = {"lane": f"type:{name}", "n": n, "roi": roi, "wr": wr}
        if n >= min_n and roi >= min_roi:
            experts.append(row)
        elif n >= min_n and roi <= -8:
            bleeds.append(row)
    experts.sort(key=lambda r: -r["roi"])
    bleeds.sort(key=lambda r: r["roi"])
    return experts, bleeds


def write_markdown(payload: dict) -> str:
    lines = [
        "# Public vs our numbers — trader rank audit",
        "",
        f"As of **{payload.get('as_of')}**.",
        "",
        "## You were right to distrust the 98% / +$52M Ghost book",
        "",
        "Same wallet: `0x0346afae2603313d2bbee96b628536c8cbe352a5` "
        "([Polymarket](https://polymarket.com/@GoalLineGhost), "
        "[PolyPnL](https://polypnl.kaeose.me/profile/0x0346afae2603313d2bbee96b628536c8cbe352a5)).",
        "",
        "Polymarket `GET /closed-positions` **defaults to biggest realized winners first**. "
        "We capped at 200 pages × 50 = **10,000 closed rows**. Ghost’s CSV was 10,000 closed "
        "and 10,005 `realizedPnl > 0`. The first five closed rows are the same $927k / $667k "
        "World Cup tickets the API returns for `REALIZEDPNL DESC`. `REALIZEDPNL ASC` starts at "
        "**−$1.31M / −$1.12M** on other USA/Germany tickets we never stored.",
        "",
        "That win-sorted tape is also why a Ghost 2+ moneyline book printed **98% WR**: "
        "Ghost only appeared on sides we had ingested — mostly the winners.",
        "",
        "## Public tape (not our CSV)",
        "",
        "| Source | Ghost | RN1 | ferrari | kch123 |",
        "|--------|-------|-----|---------|--------|",
        "| PolyPnL / Polydata lifetime | **−$1.14M**, 52.8% WR (1925/3648 sports 30d), ~$87M 30d vol | **+$12.8M** all-time #4, Smart Score 75 | sports LB ~+$68k | **+$11.4M** all-time #5, Smart Score 59 |",
        "| Polymarket `/value` (this run) | see table below | see table | see table | see table |",
        "| Polymarket sports leaderboard (API window param is sticky — day/week/month/all returned the same 200) | rank 15, **+$33,896** | not in top 15 sports | rank 8, **+$68,507** | not on this sports page |",
        "",
        "Polydata all-time PnL board (overall, not sports-only): "
        "swisstony +$23.5M, Theo4 +$22.1M, Fredi9999 +$16.6M, **RN1 +$12.8M**, **kch123 +$11.4M**. "
        "Ghost is **not** on that top 50 — consistent with a small or negative lifetime.",
        "",
        "## Our CSV before / after loser-side fetch",
        "",
        "| Trader | Before closed | Before WR | Before dash PnL | After closed | After WR | After dash PnL | Portfolio `/value` |",
        "|--------|--------------:|----------:|----------------:|-------------:|---------:|---------------:|-------------------:|",
    ]
    for r in payload.get("repairs") or []:
        b = r.get("before") or {}
        a = r.get("after") or {}
        lines.append(
            f"| {r.get('username')} | {b.get('closed')} | {b.get('hold_wr')}% | ${b.get('sum_dash'):,.0f} | "
            f"{a.get('closed')} | {a.get('hold_wr')}% | ${a.get('sum_dash'):,.0f} | ${r.get('value') or 0:,.0f} |"
        )
    lines += [
        "",
        "## Live sports leaderboard (join these names, then weight by recency)",
        "",
        "Official Polymarket sports PnL. Use this as the **who is printing now** list. "
        "Do not copy $200M volume books at $100/play.",
        "",
        "| Rank | Trader | Sports PnL | Volume | Tracked? |",
        "|-----:|--------|-----------:|-------:|----------|",
    ]
    known = {w.lower(): u for w, u in payload.get("known") or []}
    for row in (payload.get("sports_lb") or [])[:25]:
        tracked = known.get(row["wallet"])
        flag = f"yes ({tracked})" if tracked else "**new**"
        lines.append(
            f"| {row['rank']} | {row['username']} | ${row['pnl']:,.0f} | ${row['vol']:,.0f} | {flag} |"
        )
    lines += [
        "",
        "## Fluid roster rule",
        "",
        "| Band | Days since last dated event | Live weight |",
        "|------|----------------------------:|------------:|",
        "| HOT | 0–7 | 1.00 |",
        "| WARM | 8–14 | 0.70 |",
        "| COLD | 15–21 | 0.35 (keep on roster, down-weight) |",
        "| DARK | 22–45 | 0.00 (mute from 2+) |",
        "| DROP | 45+ | remove / SIGNAL_KICK |",
        "",
        "Discovery: `npm run discover:traders` scans sports ALL/MONTH/WEEK, screens closed+open, "
        "and writes `extra_traders.json` for names that pass hold-ROI and joinability.",
        "",
        "## How to read win rate",
        "",
        "- **Polydata / PolyPnL WR** = markets or trades they touched, including scalps and both sides.",
        "- **Our hold-to-res WR** = each token we stored, won iff `curPrice ≥ 0.99`. Useless if the store is winner-sorted.",
        "- **Copy WR at $100** is a third number: only joinable, live-priced, 2+ directional tickets. "
        "It will never match a whale’s 796k-trade 52% WR.",
        "",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    known_pairs = [(w.lower(), u) for w, u in roster_traders()]
    known = {w: u for w, u in known_pairs}

    print("Fetching Polymarket sports leaderboard…")
    sports_lb = fetch_leaderboard("all", "sports", pages=4)
    overall_lb = fetch_leaderboard("all", None, pages=2)

    # Repair winner-capped books that drive the fake 98% Ghost cluster.
    repair_targets = [
        ("0x0346afae2603313d2bbee96b628536c8cbe352a5", "GoalLineGhost"),
        ("0xfe787d2da716d60e8acff57fb87eb13cd4d10319", "ferrariChampions2026"),
    ]
    repairs = []
    for wallet, username in repair_targets:
        try:
            repairs.append(repair_wallet(wallet, username, pages=120))
        except Exception as e:
            print(f"[repair] {username} failed: {e}")
            repairs.append({"username": username, "wallet": wallet, "error": str(e)})

    comparisons = []
    for wallet, u in known_pairs:
        path = csv_path_for(wallet, u)
        if not path.exists():
            continue
        skew = csv_skew(path)
        pub = PUBLIC_PROFILES.get(wallet, {})
        lb_hit = next((r for r in sports_lb if r["wallet"] == wallet), None)
        comparisons.append({
            "username": u,
            "wallet": wallet,
            "our_dash_pnl": skew["sum_dash"],
            "our_hold_wr": skew["hold_wr"],
            "closed": skew["closed"],
            "winner_capped": skew["winner_capped"],
            "lb_sports_pnl": None if not lb_hit else lb_hit["pnl"],
            "lb_sports_rank": None if not lb_hit else lb_hit["rank"],
            "public": pub,
        })

    new_lb = [r for r in sports_lb if r["wallet"] not in known and r["pnl"] >= 20_000]
    payload = {
        "generated_at": AS_OF.isoformat(),
        "as_of": AS_OF.date().isoformat(),
        "bug": (
            "closed-positions default sort is REALIZEDPNL DESC; 10k page cap stored winners only"
        ),
        "known": known_pairs,
        "sports_lb": sports_lb,
        "overall_lb": overall_lb,
        "repairs": repairs,
        "comparisons": comparisons,
        "new_on_sports_lb": new_lb[:20],
        "recency_policy": {
            "HOT": [0, 7, 1.0],
            "WARM": [8, 14, 0.7],
            "COLD": [15, 21, 0.35],
            "DARK": [22, 45, 0.0],
            "DROP": [46, 9999, 0.0],
        },
    }
    out = OUTPUT_DIR / "external_verify.json"
    out.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    md = Path(__file__).resolve().parent / "EXTERNAL_VERIFY.md"
    md.write_text(write_markdown(payload), encoding="utf-8")
    print(f"Wrote {out}")
    print(f"Wrote {md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
