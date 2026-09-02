#!/usr/bin/env python3
"""Continuous elite discovery — the desk fills itself.

Pulls Polymarket sports/all leaderboards, Gamma public-search, and recent
activity / trades heat. Resolves username → **proxy trading wallet**
(never a CSV filename, never a random EOA when a proxy exists).

Writes `pnl_analysis/output/discovered_candidates.json`.
`auto_promote.ingest_scouts` then scout → watch → take_book / bench
using the existing gates. Unresolved names are flagged — never a fake 0-0.

`add-username` remains an escape hatch. Operators do not add/remove by hand.

Usage:
  python pnl_analysis/auto_discover.py
  python pnl_analysis/auto_discover.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from trader_display import english_name  # noqa: E402
from wallet_resolve import (  # noqa: E402
    GAMMA,
    DATA,
    normalize_wallet,
    resolve_username,
)

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output"
DISCOVERED_PATH = OUTPUT_DIR / "discovered_candidates.json"
EXTRA_PATH = ROOT / "extra_traders.json"
GetJson = Callable[[str, dict[str, Any] | None], Any]
SampleFn = Callable[[str], dict[str, Any]]

SLEEP = 0.25
MAX_HEAT_TRADES = 400
MAX_NEW = 12
MIN_PNL = 20_000.0
MIN_VOL = 50_000.0
MIN_HEAT_TRADES = 4
MIN_HEAT_USD = 2_000.0


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_get(url: str, params: dict[str, Any] | None = None) -> Any:
    for attempt in range(4):
        try:
            r = requests.get(url, params=params, timeout=25)
        except requests.RequestException:
            if attempt == 3:
                return None
            time.sleep(min(8.0, (2**attempt) + random.uniform(0.2, 0.8)))
            continue
        if r.status_code in (429, 502, 503) and attempt < 3:
            time.sleep(min(8.0, (2**attempt) + random.uniform(0.2, 0.8)))
            continue
        if r.status_code != 200:
            return None
        try:
            return r.json()
        except Exception:
            return None
    return None


def _rows(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if isinstance(data, dict):
        for key in ("data", "leaderboard", "results", "trades", "activity"):
            inner = data.get(key)
            if isinstance(inner, list):
                return [r for r in inner if isinstance(r, dict)]
    return []


def load_known(
    extra_path: Path | None = None,
    extra_rows: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, str], set[str]]:
    """wallet → username, plus blocked wallets (kicked/removed)."""
    known: dict[str, str] = {}
    blocked: set[str] = set()
    try:
        from run_full_pipeline import ALL_TRADERS

        for wallet, username in ALL_TRADERS:
            w = normalize_wallet(wallet)
            if w:
                known[w] = str(username)
    except Exception:
        pass
    rows = extra_rows
    path = extra_path or EXTRA_PATH
    if rows is None and path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            rows = loaded if isinstance(loaded, list) else []
        except Exception:
            rows = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        w = normalize_wallet(str(row.get("wallet") or ""))
        u = str(row.get("username") or "").strip()
        if w:
            known[w] = u or known.get(w, w[:10])
            st = str(row.get("status") or "").lower()
            if st in {"kicked", "removed"}:
                blocked.add(w)
    return known, blocked


def fetch_leaderboards(get_json: GetJson) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for category, window in (
        ("sports", "all"),
        ("sports", "month"),
        ("sports", "week"),
        ("", "week"),
    ):
        for page in range(4):
            params: dict[str, Any] = {
                "window": window,
                "limit": 50,
                "offset": page * 50,
            }
            if category:
                params["category"] = category
            data = get_json(f"{DATA}/v1/leaderboard", params)
            batch = _rows(data)
            if not batch:
                break
            added = 0
            for row in batch:
                wallet = normalize_wallet(
                    str(row.get("proxyWallet") or row.get("proxy_wallet") or "")
                )
                eoa = normalize_wallet(
                    str(row.get("userAddress") or row.get("address") or "")
                )
                username = str(row.get("userName") or row.get("username") or row.get("name") or "").strip()
                if not username and not wallet:
                    continue
                token = wallet or eoa or username.lower()
                if token in seen:
                    continue
                seen.add(token)
                out.append(
                    {
                        "username": username or (wallet or eoa or "")[:12],
                        "wallet": wallet,
                        "eoa_wallet": eoa,
                        "pnl": float(row.get("pnl") or 0),
                        "vol": float(row.get("vol") or row.get("volume") or 0),
                        "rank": int(str(row.get("rank") or 0) or 0),
                        "window": window,
                        "category": category or "all",
                        "source": f"leaderboard_{category or 'all'}_{window}",
                    }
                )
                added += 1
            if added == 0 or len(batch) < 50:
                break
            time.sleep(SLEEP)
    return out


def fetch_activity_heat(get_json: GetJson) -> list[dict[str, Any]]:
    """Recent public trades — wallets printing now, not a stale CSV."""
    data = get_json(f"{DATA}/trades", {"limit": min(MAX_HEAT_TRADES, 500), "takerOnly": "false"})
    if data is None:
        data = get_json(f"{DATA}/activity", {"limit": 200})
    batch = _rows(data)
    by_key: dict[str, dict[str, Any]] = {}
    for row in batch:
        proxy = normalize_wallet(str(row.get("proxyWallet") or row.get("proxy_wallet") or ""))
        eoa = normalize_wallet(str(row.get("userAddress") or row.get("address") or ""))
        username = str(
            row.get("name") or row.get("userName") or row.get("username") or row.get("pseudonym") or ""
        ).strip()
        wallet = proxy  # heat must not promote a random EOA
        if not wallet and not username:
            continue
        key = wallet or username.lower()
        cur = by_key.get(key)
        try:
            usd = float(row.get("usdcSize") or row.get("size") or 0)
        except (TypeError, ValueError):
            usd = 0.0
        if cur is None:
            by_key[key] = {
                "username": username or (wallet or "")[:12],
                "wallet": wallet,
                "eoa_wallet": eoa,
                "heat_n": 1,
                "heat_usd": usd,
                "source": "activity_heat",
                "pnl": 0.0,
                "vol": usd,
                "window": "heat",
                "category": "activity",
            }
        else:
            cur["heat_n"] += 1
            cur["heat_usd"] += usd
            cur["vol"] = float(cur.get("vol") or 0) + usd
            if username and not cur.get("username"):
                cur["username"] = username
            if wallet and not cur.get("wallet"):
                cur["wallet"] = wallet
            if eoa and not cur.get("eoa_wallet"):
                cur["eoa_wallet"] = eoa
    hot = [
        r
        for r in by_key.values()
        if int(r.get("heat_n") or 0) >= MIN_HEAT_TRADES or float(r.get("heat_usd") or 0) >= MIN_HEAT_USD
    ]
    hot.sort(key=lambda r: (-int(r.get("heat_n") or 0), -float(r.get("heat_usd") or 0)))
    return hot[:40]


def public_search_profile(query: str, get_json: GetJson) -> dict[str, Any] | None:
    data = get_json(
        f"{GAMMA}/public-search",
        {"q": query, "search_profiles": "true", "limit_per_type": 20},
    )
    if not isinstance(data, dict):
        return None
    profiles = data.get("profiles") or []
    q = query.strip().lower()
    exact: list[dict[str, Any]] = []
    for p in profiles:
        if not isinstance(p, dict):
            continue
        name = str(p.get("name") or "").strip()
        pseudo = str(p.get("pseudonym") or "").strip()
        proxy = normalize_wallet(str(p.get("proxyWallet") or p.get("proxy_wallet") or ""))
        eoa = normalize_wallet(str(p.get("userAddress") or p.get("address") or ""))
        if not proxy and not eoa:
            continue
        rec = {
            "username": name or pseudo or query,
            "wallet": proxy,  # prefer proxy; None if only EOA
            "eoa_wallet": eoa,
            "source": "gamma_public_search",
        }
        if name.lower() == q or pseudo.lower() == q:
            exact.append(rec)
        elif q and (q in name.lower() or q in pseudo.lower()) and proxy:
            exact.append(rec)
    if exact:
        # Prefer a row that actually has a proxy
        for r in exact:
            if r.get("wallet"):
                return r
        return exact[0]
    return None


def resolve_candidate(
    username: str,
    *,
    hinted_proxy: str | None,
    hinted_eoa: str | None,
    get_json: GetJson,
    local_only: bool = False,
) -> dict[str, Any]:
    """Username → proxy trading wallet. Unresolved stays blocked."""
    proxy = normalize_wallet(hinted_proxy)
    if proxy:
        return {
            "username": username,
            "display_name": english_name(username, proxy),
            "wallet": proxy,
            "eoa_wallet": normalize_wallet(hinted_eoa),
            "source": "hinted_proxy",
            "resolved": True,
            "unresolved_reason": None,
        }
    rec = resolve_username(username, get_json=get_json, local_only=local_only)
    if rec.get("resolved") and rec.get("wallet"):
        return rec
    # Last chance: public-search if resolve_username missed (tests inject this).
    if not local_only:
        hit = public_search_profile(username, get_json)
        if hit and hit.get("wallet"):
            w = str(hit["wallet"])
            return {
                "username": username,
                "display_name": english_name(hit.get("username") or username, w),
                "wallet": w,
                "eoa_wallet": hit.get("eoa_wallet") or hinted_eoa,
                "source": "gamma_public_search",
                "resolved": True,
                "unresolved_reason": None,
            }
    return {
        "username": username,
        "display_name": english_name(username, None),
        "wallet": None,
        "eoa_wallet": normalize_wallet(hinted_eoa),
        "source": "unresolved",
        "resolved": False,
        "unresolved_reason": rec.get("unresolved_reason") or "unresolved_after_search",
    }


def default_sample(wallet: str) -> dict[str, Any]:
    try:
        from discover_traders import sample_honest_book

        return sample_honest_book(wallet, closed_pages=3, open_pages=2)
    except Exception as exc:
        return {"sample_error": str(exc), "sample_resolved_n": 0, "sample_hold_roi": 0.0}


def screen_candidate(row: dict[str, Any], sample: dict[str, Any]) -> dict[str, Any]:
    entry = {**row, **sample}
    recency = 1 if str(row.get("window") or "") in {"week", "heat"} else 0
    if str(row.get("window") or "") == "month":
        recency = max(recency, 1)
    recency_pts = 20 * recency
    if int(row.get("heat_n") or 0) >= MIN_HEAT_TRADES:
        recency_pts = max(recency_pts, 20)
    pnl_pts = min(40.0, max(0.0, float(entry.get("pnl") or 0) / 25_000))
    if float(entry.get("heat_usd") or 0) >= MIN_HEAT_USD and pnl_pts == 0:
        pnl_pts = 8.0
    hold_roi = float(entry.get("sample_hold_roi") or entry.get("sample_roi") or 0)
    roi_pts = min(30.0, max(0.0, hold_roi))
    if int(entry.get("sample_resolved_n") or entry.get("sample_closed_rows") or 0) < 15:
        roi_pts *= 0.4
    bias = float(entry.get("closed_only_bias") or 0)
    if bias >= 15:
        roi_pts *= 0.3
    wr = float(entry.get("sample_hold_wr") or 0)
    if wr >= 94 and hold_roi < 8:
        roi_pts = 0
    entry["screen_score"] = round(recency_pts + pnl_pts + roi_pts, 1)
    entry["recency"] = recency
    return entry


def recommend_row(r: dict[str, Any]) -> bool:
    if not r.get("wallet"):
        return False
    n = int(r.get("sample_resolved_n") or r.get("sample_closed_rows") or 0)
    hold = float(r.get("sample_hold_roi") or r.get("sample_roi") or 0)
    wr = float(r.get("sample_hold_wr") or 0)
    bias = float(r.get("closed_only_bias") or 0)
    return (
        n >= 12
        and hold >= 3.0
        and wr < 94
        and float(r.get("screen_score") or 0) >= 25
        and bias < 25
    )


def persist_unresolved(unresolved: list[dict[str, Any]]) -> None:
    if not unresolved:
        return
    try:
        from desk_db import connect, ensure_schema, upsert_wallet

        with connect() as conn:
            ensure_schema(conn)
            for rec in unresolved:
                upsert_wallet(conn, rec)
    except Exception as exc:
        print(f"[discover] desk_wallets persist skipped: {exc}")


def enqueue_discovered_scouts(
    payload: dict[str, Any],
    extra: list[dict[str, Any]],
    *,
    dry_run: bool = False,
    extra_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Add recommended (resolved proxy) names as scout. Not add-username."""
    by_wallet = {str(r.get("wallet") or "").lower(): r for r in extra if isinstance(r, dict)}
    added: list[dict[str, Any]] = []
    for r in (payload.get("recommended") or [])[:MAX_NEW]:
        wallet = normalize_wallet(str(r.get("wallet") or ""))
        username = str(r.get("username") or "")
        if not wallet or not r.get("resolved", True):
            continue
        if wallet in by_wallet:
            continue
        why = (
            f"Auto-scout {now_iso()[:10]}: {r.get('source')} "
            f"screen={r.get('screen_score')} hold_roi={r.get('sample_hold_roi') or r.get('sample_roi')} "
            f"n={r.get('sample_resolved_n') or r.get('sample_closed_rows')}"
        )
        added.append({
            "username": username,
            "wallet": wallet,
            "action": "scout_add",
            "why": why,
            "display_name": english_name(username, wallet),
            "source": r.get("source") or "auto_discover",
        })
        if dry_run:
            continue
        extra.append({
            "wallet": wallet,
            "username": username,
            "source": str(r.get("source") or "auto_discover_scout"),
            "status": "scout",
            "why_tail": why,
            "add_date": now_iso()[:10],
            "updated_at": now_iso(),
            "history": [{"action": "scout_add", "timestamp": now_iso(), "reason": why}],
        })
        by_wallet[wallet] = extra[-1]
    if not dry_run and added:
        path = extra_path or EXTRA_PATH
        path.write_text(json.dumps(extra, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return added


def discover_elites(
    *,
    get_json: GetJson | None = None,
    sample_fn: SampleFn | None = None,
    extra_path: Path | None = None,
    extra_rows: list[dict[str, Any]] | None = None,
    discovered_path: Path | None = None,
    max_new: int = MAX_NEW,
    min_pnl: float = MIN_PNL,
    min_vol: float = MIN_VOL,
    apply_scouts: bool = False,
    persist_unresolved_wallets: bool = True,
    local_only: bool = False,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Scan LB + public-search + activity heat. Never invents a wallet."""
    getter = get_json or _default_get
    sampler = sample_fn or default_sample
    known, blocked = load_known(extra_path=extra_path, extra_rows=extra_rows)
    known_names = {u.lower() for u in known.values() if u}

    raw = fetch_leaderboards(getter)
    heat = fetch_activity_heat(getter)
    merged: dict[str, dict[str, Any]] = {}

    def _merge(row: dict[str, Any]) -> None:
        username = str(row.get("username") or "").strip()
        key = (normalize_wallet(str(row.get("wallet") or "")) or username.lower())
        if not key:
            return
        cur = merged.get(key)
        if cur is None:
            merged[key] = {**row}
            return
        if row.get("wallet") and not cur.get("wallet"):
            cur["wallet"] = row["wallet"]
        if float(row.get("pnl") or 0) > float(cur.get("pnl") or 0):
            cur["pnl"] = row["pnl"]
            cur["vol"] = row.get("vol", cur.get("vol"))
        if int(row.get("heat_n") or 0) > int(cur.get("heat_n") or 0):
            cur["heat_n"] = row["heat_n"]
            cur["heat_usd"] = row.get("heat_usd", cur.get("heat_usd"))
        srcs = cur.get("sources") or [cur.get("source")]
        srcs.append(row.get("source"))
        cur["sources"] = [s for s in srcs if s]

    for row in raw + heat:
        _merge(row)

    unresolved: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    for row in merged.values():
        username = str(row.get("username") or "").strip()
        hinted = normalize_wallet(str(row.get("wallet") or ""))
        if hinted and hinted in known:
            continue
        if hinted and hinted in blocked:
            continue
        if username.lower() in known_names and not hinted:
            continue
        rec = resolve_candidate(
            username,
            hinted_proxy=hinted,
            hinted_eoa=str(row.get("eoa_wallet") or "") or None,
            get_json=getter,
            local_only=local_only,
        )
        if not rec.get("resolved") or not rec.get("wallet"):
            unresolved.append({**rec, "source_row": row.get("source")})
            continue
        wallet = str(rec["wallet"])
        if wallet in known or wallet in blocked:
            continue
        # Elite screen: LB PnL/vol OR activity heat
        heat_ok = int(row.get("heat_n") or 0) >= MIN_HEAT_TRADES
        lb_ok = float(row.get("pnl") or 0) >= min_pnl and float(row.get("vol") or 0) >= min_vol
        if not heat_ok and not lb_ok:
            continue
        rec = {
            **row,
            **rec,
            "wallet": wallet,
            "username": rec.get("username") or username,
            "display_name": rec.get("display_name") or english_name(username, wallet),
        }
        candidates.append(rec)

    scored: list[dict[str, Any]] = []
    for rec in candidates[: max(max_new * 3, 1)]:
        sample = sampler(str(rec["wallet"]))
        scored.append(screen_candidate(rec, sample))
    scored.sort(key=lambda r: (-float(r.get("screen_score") or 0), -float(r.get("pnl") or 0)))
    recommended = [r for r in scored if recommend_row(r)][:max_new]

    if persist_unresolved_wallets and unresolved and not dry_run:
        persist_unresolved(unresolved)

    payload = {
        "generated_at": now_iso(),
        "method": (
            "Polymarket sports/all leaderboards + Gamma public-search + activity/trades heat. "
            "Resolve username → proxy trading wallet. Unresolved stay blocked (never 0-0). "
            "Recommended scouts feed auto_promote gates (scout → watch → take_book / bench). "
            "Tape is Postgres, not CSV."
        ),
        "known_wallets": len(known),
        "leaderboard_unique": len(raw),
        "heat_unique": len(heat),
        "new_candidates": scored,
        "recommended": recommended,
        "unresolved": [
            {
                "username": u.get("username"),
                "display_name": u.get("display_name"),
                "why": u.get("unresolved_reason"),
                "eoa_wallet": u.get("eoa_wallet"),
            }
            for u in unresolved
        ],
        "counts": {
            "recommended": len(recommended),
            "unresolved": len(unresolved),
            "scored": len(scored),
        },
    }
    out_path = discovered_path or DISCOVERED_PATH
    if not dry_run:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, indent=2, default=str, ensure_ascii=False), encoding="utf-8")
        print(f"[discover] wrote {out_path} recommended={len(recommended)} unresolved={len(unresolved)}")

    if apply_scouts:
        extra = extra_rows
        if extra is None:
            path = extra_path or EXTRA_PATH
            if path.exists():
                try:
                    loaded = json.loads(path.read_text(encoding="utf-8"))
                    extra = loaded if isinstance(loaded, list) else []
                except Exception:
                    extra = []
            else:
                extra = []
        added = enqueue_discovered_scouts(
            payload, extra, dry_run=dry_run, extra_path=extra_path or EXTRA_PATH
        )
        payload["scouts_enqueued"] = added
        payload["counts"]["scouts_enqueued"] = len(added)

    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Auto-discover elite Polymarket books")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply-scouts", action="store_true", help="Write scouts into extra_traders.json")
    parser.add_argument("--max-new", type=int, default=MAX_NEW)
    args = parser.parse_args()
    payload = discover_elites(
        dry_run=args.dry_run,
        apply_scouts=args.apply_scouts,
        max_new=args.max_new,
    )
    print(
        f"[discover] recommended={payload['counts']['recommended']} "
        f"unresolved={payload['counts']['unresolved']} scored={payload['counts']['scored']}"
    )
    for r in payload.get("recommended") or []:
        print(
            f"  SCOUT {r.get('display_name') or r.get('username')} "
            f"{str(r.get('wallet') or '')[:10]} score={r.get('screen_score')} via {r.get('source')}"
        )
    for u in (payload.get("unresolved") or [])[:8]:
        print(f"  BLOCKED {u.get('display_name')}: {u.get('why')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
