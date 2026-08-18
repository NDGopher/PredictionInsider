#!/usr/bin/env python3
"""Find Polydata Smart Score 80+ / 90+ sports traders and audit our books.

Polydata JSON API is 401. We scrape public HTML profiles. Polymarket has no
lifetime PnL endpoint — we sum closed-positions realizedPnl (winners+losers+
recent) plus open cashPnl, which is what Polymarket analytics shows.

Writes:
  pnl_analysis/output/polydata_elites.json
  pnl_analysis/POLYDATA_ELITES.md
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_trader import analyze_csv  # noqa: E402
from polydata_reference import scrape_polydata_profiles  # noqa: E402
from run_full_pipeline import (  # noqa: E402
    OUTPUT_DIR,
    PAGE_SLEEP_SEC,
    csv_path_for,
    fetch_closed_positions_complete,
    fetch_open_positions_complete,
    json_path_for,
    roster_traders,
    _merge_position_frames,
)

AS_OF = datetime.now(timezone.utc)
DATA_API = "https://data-api.polymarket.com"
OUT_JSON = OUTPUT_DIR / "polydata_elites.json"
OUT_MD = Path(__file__).resolve().parent / "POLYDATA_ELITES.md"

# Overall PnL board handles (from polydata.pro/traders). Sports 80+ hide here
# and on our roster — Polydata's sports tab is client-rendered.
POLYDATA_OVERALL_TOP50 = [
    "swisstony", "Theo4", "Fredi9999", "RN1", "kch123", "mintblade", "fishalive",
    "frostrizz", "0x2c335066FE58fe9237c3d3Dc7b275C2a034a0563", "Len9311238",
    "sparklingwater123", "DEEDDIT", "zxgngl", "GRIMDRIP", "RepTrump", "endlessFate",
    "PrincessCaro", "walletmobile", "KeyTransporter", "BetTom42", "mikatrade77",
    "gmanas", "alexmulti", "0x006cc834Cc092684F1B56626E23BEdB3835c16ea",
    "BreakTheBank", "beachboy4", "432614799197", "GamblingIsAllYouNeed", "Allezpapa",
    "0x2a2C53bD278c04DA9962Fcf96490E17F3DfB9Bc1", "DrPufferfish", "Jenzigo",
    "Inaccuratestake", "reachingthesky", "majorexploiter", "SeriouslySirius",
    "sainttroplay", "sovereign2013", "0x5966Db1fE50763C9e3C014d756369BAd07E1F804",
    "asparagus2012", "gmpm", "GCottrell93", "S-Works", "ImJustKen",
    "RandomGenius-190", "ndb1", "Michie", "fengdubiying", "gfjoigfsjoigsjoi",
    "Capman", "Vetch", "Supah9ga", "bloodmaster",
    "0x8a3aB8120807bD64a3De48695110e390fa2ceB9a", "HedgeMaster88", "JuniorB",
    "Cannae", "GoalLineGhost", "ferrariChampions2026", "WTSA", "xytest",
]


def _get(path: str, **params):
    r = requests.get(f"{DATA_API}{path}", params=params, timeout=45)
    r.raise_for_status()
    return r.json()


def polymarket_value(wallet: str) -> float | None:
    try:
        data = _get("/value", user=wallet)
        if isinstance(data, list) and data:
            return float(data[0].get("value") or 0)
        if isinstance(data, dict):
            return float(data.get("value") or 0)
    except Exception as e:
        print(f"  [warn] /value {wallet[:12]}: {e}")
    return None


def sample_closed_pnl_wr(wallet: str, pages_per_sort: int = 8) -> dict[str, Any]:
    """Cheap Polymarket analytics sample: first N pages of winners AND losers."""
    rows: list[dict] = []
    seen: set[str] = set()
    for sort_dir in ("DESC", "ASC"):
        for page in range(pages_per_sort):
            try:
                data = _get(
                    "/closed-positions",
                    user=wallet,
                    limit=50,
                    offset=page * 50,
                    sortBy="REALIZEDPNL",
                    sortDirection=sort_dir,
                )
            except Exception as e:
                print(f"  [warn] closed sample {wallet[:10]} {sort_dir}: {e}")
                break
            if not isinstance(data, list) or not data:
                break
            for row in data:
                asset = str(row.get("asset") or "")
                if not asset or asset in seen:
                    continue
                seen.add(asset)
                rows.append(row)
            if len(data) < 50:
                break
            time.sleep(0.12)
    if not rows:
        return {"n": 0, "realized_pnl": 0.0, "win_rate": None, "pos": 0, "neg": 0}
    pnls = [float(r.get("realizedPnl") or 0) for r in rows]
    cur = [float(r.get("curPrice") or 0) for r in rows]
    settled = [(c <= 0.01 or c >= 0.99) for c in cur]
    wins = sum(1 for c, s in zip(cur, settled) if s and c >= 0.99)
    n_set = sum(1 for s in settled if s)
    return {
        "n": len(rows),
        "realized_pnl": round(sum(pnls), 2),
        "win_rate": round(100.0 * wins / n_set, 2) if n_set else None,
        "pos": sum(1 for p in pnls if p > 0),
        "neg": sum(1 for p in pnls if p < 0),
        "truncated": len(rows) >= pages_per_sort * 50 * 2 - 5,
    }


def our_csv_metrics(wallet: str, username: str) -> dict[str, Any] | None:
    path = json_path_for(wallet, username)
    csv_p = csv_path_for(wallet, username)
    if not path.exists() and not csv_p.exists():
        return None
    analysis: dict[str, Any] = {}
    if path.exists():
        try:
            analysis = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            analysis = {}
    closed = 0
    if csv_p.exists():
        try:
            df = pd.read_csv(csv_p, usecols=["status"], low_memory=False)
            closed = int((df["status"].astype(str).str.lower() == "closed").sum())
        except Exception:
            closed = 0
    return {
        "dashboard_pnl": analysis.get("dashboard_pnl"),
        "raw_realized_pnl": analysis.get("raw_realized_pnl"),
        "win_rate": analysis.get("win_rate"),
        "markets": analysis.get("markets_traded"),
        "events": analysis.get("total_events"),
        "closed_rows": closed,
        "winner_capped": closed == 10_000,
        "has_csv": csv_p.exists(),
    }


def wr_aligned(ours: float | None, theirs: float | None, tol: float = 6.0) -> bool:
    if ours is None or theirs is None:
        return False
    return abs(float(ours) - float(theirs)) <= tol


def pnl_aligned(ours: float | None, theirs: float | None) -> tuple[bool, str]:
    if ours is None or theirs is None:
        return False, "missing"
    o, t = float(ours), float(theirs)
    if t == 0 and abs(o) < 5_000:
        return True, "near_zero"
    same = (o >= 0) == (t >= 0)
    if not same:
        return False, "sign_mismatch"
    denom = max(abs(t), 1.0)
    ratio = abs(o - t) / denom
    if ratio <= 0.35 or abs(o - t) < 75_000:
        return True, "aligned"
    if ratio <= 1.0:
        return False, "soft_gap"
    return False, "magnitude_gap"


def repair_if_needed(wallet: str, username: str, pages: int = 120) -> dict[str, Any]:
    csv_path = csv_path_for(wallet, username)
    print(f"  [fetch] full closed+open book for {username}…")
    closed = fetch_closed_positions_complete(wallet, max_pages=pages)
    time.sleep(PAGE_SLEEP_SEC)
    opened = fetch_open_positions_complete(wallet)
    if closed is None or closed.empty:
        return {"error": "no_closed"}
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
    analysis = analyze_csv(csv_path, username, wallet)
    json_path_for(wallet, username).write_text(
        json.dumps(analysis, indent=2, default=str), encoding="utf-8"
    )
    return {
        "closed_rows": int((combined["status"].astype(str).str.lower() == "closed").sum())
        if "status" in combined.columns else len(combined),
        "dashboard_pnl": analysis.get("dashboard_pnl"),
        "win_rate": analysis.get("win_rate"),
        "markets": analysis.get("markets_traded"),
    }


def write_md(payload: dict[str, Any]) -> None:
    elites = payload.get("score_80_plus") or []
    nineties = payload.get("score_90_plus") or []
    sports80 = [e for e in elites if e.get("sports_rank") or (e.get("sports_pnl") or 0) > 50_000]
    lines = [
        "# Polydata 80+ / 90+ vs our books",
        "",
        f"As of **{payload['as_of']}**. Polydata Smart Score 80–100 is their Elite band; "
        "90+ is the top of that band. Sports rank comes from each profile’s category strip.",
        "",
        "## 90+ Smart Score (any category)",
        "",
        "| Trader | SS | WR | PnL | Sports # | Sports PnL | Our WR | Our PnL | Book |",
        "|--------|---:|---:|----:|---------:|-----------:|-------:|--------:|------|",
    ]
    for e in nineties:
        o = e.get("ours") or {}
        lines.append(
            f"| [{e['username']}]({e.get('url')}) | {e.get('smart_score')} | {e.get('win_rate')}% | "
            f"{_m(e.get('pnl'))} | {e.get('sports_rank') or '—'} | {_m(e.get('sports_pnl'))} | "
            f"{_pct(o.get('win_rate'))} | {_m(o.get('dashboard_pnl'))} | {e.get('book_status')} |"
        )
    lines += [
        "",
        "## 80+ Smart Score with a sports book",
        "",
        "| Trader | SS | PD WR | PD sports PnL | Sports # | Our WR | Our PnL | WR match | PnL match | Copy candidate |",
        "|--------|---:|------:|--------------:|---------:|-------:|--------:|:---------|:----------|:---------------|",
    ]
    for e in sports80:
        o = e.get("ours") or {}
        lines.append(
            f"| [{e['username']}]({e.get('url')}) | {e.get('smart_score')} | {e.get('win_rate')}% | "
            f"{_m(e.get('sports_pnl') or e.get('pnl'))} | {e.get('sports_rank') or '—'} | "
            f"{_pct(o.get('win_rate'))} | {_m(o.get('dashboard_pnl'))} | "
            f"{'yes' if e.get('wr_match') else 'no'} | {e.get('pnl_note')} | "
            f"{'yes' if e.get('copy_candidate') else 'no'} |"
        )
    lines += [
        "",
        "## What “full book” means here",
        "",
        "- Polydata WR is event-level on their trade tape. Ours is PA-style market win rate on the CSV.",
        "- Polymarket analytics PnL ≈ sum(closed `realizedPnl`) + open `cashPnl`. That is our `dashboard_pnl`.",
        "- Mega-whales (RN1, swisstony) have tens of thousands of markets; `/closed-positions` caps at 10k per sort. "
          "Those books stay **untrusted for copy** until we can ingest the whole tape.",
        "- Trusted copy candidates: sports 80+ (or aligned 70+ sports specialists), WR within 6pp of Polydata, "
          "same-sign PnL within 35% or $75k, not winner-capped, not a 94%+ grinder.",
        "",
        f"**Trusted copy list ({len(payload.get('trusted') or [])}):** "
        + (", ".join(t['username'] for t in (payload.get('trusted') or [])) or "none yet"),
        "",
    ]
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _m(v: float | None) -> str:
    if v is None:
        return "—"
    sign = "+" if v >= 0 else "−"
    return f"{sign}${abs(v):,.0f}"


def _pct(v: float | None) -> str:
    if v is None:
        return "—"
    return f"{v:.1f}%"


def main() -> int:
    roster = {u.lower(): (w, u) for w, u in roster_traders()}
    names = list(POLYDATA_OVERALL_TOP50)
    for _, u in roster_traders():
        if u not in names:
            names.append(u)
    print(f"[elites] scraping {len(names)} Polydata profiles…")
    profiles = scrape_polydata_profiles(names)

    rows: list[dict[str, Any]] = []
    for key, pd in profiles.items():
        if not pd.get("ok"):
            continue
        username = pd.get("username") or key
        wallet = str(pd.get("wallet") or "").lower()
        if username.lower() in roster:
            wallet = roster[username.lower()][0]
            username = roster[username.lower()][1]
        ours = our_csv_metrics(wallet, username) if wallet.startswith("0x") else None
        wr_match = wr_aligned((ours or {}).get("win_rate"), pd.get("win_rate"))
        pnl_ok, pnl_note = pnl_aligned((ours or {}).get("dashboard_pnl"), pd.get("pnl"))
        sports = bool(pd.get("sports_rank") or (pd.get("sports_pnl") or 0) > 50_000)
        ss = int(pd.get("smart_score") or 0)
        copy = bool(
            sports
            and ss >= 80
            and wr_match
            and pnl_ok
            and ours
            and not ours.get("winner_capped")
            and (ours.get("win_rate") or 0) < 90
            and (ours.get("dashboard_pnl") or 0) > 0
        )
        rows.append({
            "username": username,
            "wallet": wallet,
            "url": pd.get("url"),
            "on_roster": username.lower() in roster,
            "smart_score": pd.get("smart_score"),
            "win_rate": pd.get("win_rate"),
            "pnl": pd.get("pnl"),
            "trades": pd.get("trades"),
            "profit_factor": pd.get("profit_factor"),
            "sharpe": pd.get("sharpe"),
            "sortino": pd.get("sortino"),
            "bot_score": pd.get("bot_score"),
            "bot_class": pd.get("bot_class"),
            "sports_rank": pd.get("sports_rank"),
            "sports_pnl": pd.get("sports_pnl"),
            "sports_volume": pd.get("sports_volume"),
            "ours": ours,
            "wr_match": wr_match,
            "pnl_match": pnl_ok,
            "pnl_note": pnl_note,
            "copy_candidate": copy,
            "book_status": (
                "missing" if not ours
                else ("winner_capped" if ours.get("winner_capped") else f"{ours.get('closed_rows')} closed")
            ),
        })

    rows.sort(key=lambda r: (-(r.get("smart_score") or 0), r["username"].lower()))
    score_80 = [r for r in rows if (r.get("smart_score") or 0) >= 80]
    score_90 = [r for r in rows if (r.get("smart_score") or 0) >= 90]
    sports80 = [
        r for r in score_80
        if r.get("sports_rank") or (r.get("sports_pnl") or 0) > 50_000
    ]

    # Fetch missing/unaligned 80+ sports books we can actually finish (not mega-whales).
    fetch_targets = []
    for r in sports80:
        trades = r.get("trades") or 0
        closed = ((r.get("ours") or {}).get("closed_rows") or 0)
        if trades and trades > 400_000 and closed > 15_000:
            r["book_status"] = f"mega_whale trades={trades} — cannot finish via 10k/sort"
            continue
        if r.get("copy_candidate"):
            continue
        if not r["wallet"].startswith("0x"):
            continue
        fetch_targets.append(r)

    print(f"[elites] 80+={len(score_80)} 90+={len(score_90)} sports80={len(sports80)} fetch={len(fetch_targets)}")
    for r in fetch_targets[:12]:
        try:
            repaired = repair_if_needed(r["wallet"], r["username"], pages=80)
            ours = our_csv_metrics(r["wallet"], r["username"])
            r["ours"] = ours
            r["wr_match"] = wr_aligned((ours or {}).get("win_rate"), r.get("win_rate"))
            ok, note = pnl_aligned((ours or {}).get("dashboard_pnl"), r.get("pnl"))
            r["pnl_match"] = ok
            r["pnl_note"] = note
            r["book_status"] = repaired.get("error") or f"{(ours or {}).get('closed_rows')} closed"
            r["copy_candidate"] = bool(
                r["wr_match"] and ok and ours and not ours.get("winner_capped")
                and (ours.get("win_rate") or 0) < 90
                and (ours.get("dashboard_pnl") or 0) > 0
            )
            if r["wallet"].startswith("0x"):
                r["portfolio_value"] = polymarket_value(r["wallet"])
        except Exception as e:
            r["book_status"] = f"fetch_error:{e}"
            print(f"  [err] {r['username']}: {e}")

    # Polymarket live sample for 80+ sports we already have.
    for r in sports80:
        if not r["wallet"].startswith("0x"):
            continue
        if r.get("pm_sample"):
            continue
        r["pm_sample"] = sample_closed_pnl_wr(r["wallet"])
        r["portfolio_value"] = r.get("portfolio_value") or polymarket_value(r["wallet"])

    trusted = [
        r for r in rows
        if r.get("copy_candidate") or (
            r.get("on_roster")
            and r.get("wr_match")
            and r.get("pnl_match")
            and ((r.get("ours") or {}).get("dashboard_pnl") or 0) > 0
            and (r.get("smart_score") or 0) >= 70
            and (r.get("sports_rank") or (r.get("sports_pnl") or 0) > 100_000)
            and ((r.get("ours") or {}).get("win_rate") or 0) < 88
        )
    ]
    # Dedup
    seen_w: set[str] = set()
    trusted_u: list[dict[str, Any]] = []
    for r in trusted:
        w = r["wallet"]
        if not w or w in seen_w:
            continue
        seen_w.add(w)
        trusted_u.append(r)

    payload = {
        "generated_at": AS_OF.isoformat(),
        "as_of": AS_OF.date().isoformat(),
        "method": (
            "Polydata HTML Smart Score/WR/PnL vs our CSV dashboard_pnl and PA-style WR. "
            "Polymarket analytics ≈ realizedPnl+cashPnl on the full closed+open book."
        ),
        "counts": {
            "profiles_ok": sum(1 for p in profiles.values() if p.get("ok")),
            "score_80_plus": len(score_80),
            "score_90_plus": len(score_90),
            "sports_80_plus": len(sports80),
            "trusted": len(trusted_u),
        },
        "score_90_plus": score_90,
        "score_80_plus": score_80,
        "trusted": [
            {
                "username": t["username"],
                "wallet": t["wallet"],
                "smart_score": t.get("smart_score"),
                "sports_rank": t.get("sports_rank"),
                "win_rate": t.get("win_rate"),
                "our_win_rate": (t.get("ours") or {}).get("win_rate"),
                "pnl": t.get("pnl"),
                "our_pnl": (t.get("ours") or {}).get("dashboard_pnl"),
            }
            for t in trusted_u
        ],
        "traders": rows,
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    write_md(payload)
    print(f"[elites] wrote {OUT_JSON}")
    print(f"  90+={len(score_90)} 80+={len(score_80)} sports80={len(sports80)} trusted={len(trusted_u)}")
    for t in score_90:
        print(f"  90+ {t['username']:<32} SS={t.get('smart_score')} sports#{t.get('sports_rank')} WR={t.get('win_rate')}")
    for t in sports80:
        print(
            f"  80s {t['username']:<32} SS={t.get('smart_score')} sports#{t.get('sports_rank')} "
            f"matchWR={t.get('wr_match')} pnl={t.get('pnl_note')} copy={t.get('copy_candidate')}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
