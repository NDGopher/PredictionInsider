#!/usr/bin/env python3
"""Hot-wallet discovery loop — UW/OddsJam-style market-first enqueue.

Unusual Whales / Hashdive do NOT re-score a fixed cold roster every hour.
They:
  1. Watch top-volume markets
  2. Flag holders whose stake is Z≥2 vs peers
  3. Only then score / index that wallet

This script closes that gap for PredictionInsider:

  hot markets → holder Z-score (scan_unusual_flow) → light Q on alerts only
  → append high-Z wallets to extra_traders.json as watch
  → optional first CSV fetch for the newly enqueued names

Sports vs politics/macro are tagged via sports_ish so the UI lanes stay clean.

Usage:
  python3 pnl_analysis/discover_hot_wallets.py
  python3 pnl_analysis/discover_hot_wallets.py --from-json
  python3 pnl_analysis/discover_hot_wallets.py --quick
  python3 pnl_analysis/discover_hot_wallets.py --quick --fetch
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from copy_roster import HARD_SKIP_USERNAMES, HARD_SKIP_WALLETS, load_extra_status  # noqa: E402
from run_full_pipeline import EXTRA_TRADERS_PATH, OUTPUT_DIR, csv_path_for, roster_traders  # noqa: E402

ROOT = Path(__file__).resolve().parent
OUT = OUTPUT_DIR
UNUSUAL_JSON = OUT / "unusual_flow.json"
OUT_JSON = OUT / "hot_wallet_discoveries.json"
OUT_MD = ROOT / "HOT_WALLET_DISCOVERIES.md"

DATA_API = "https://data-api.polymarket.com"
UA = "PredictionInsider/1.0 (hot-wallet-discover; +https://github.com/NDGopher/PredictionInsider)"

# Enqueue gates — find the signal first, then validate lightly
MIN_Z = 2.0
MIN_Z_FRESH = 2.5
MIN_LIGHT_Q = 22
MIN_LIGHT_Q_SPORTS_HOT = 18  # slightly looser if sports + potential_insider
MAX_SPORTS_WATCH = 10
MAX_MACRO_WATCH = 3
MAX_LIGHT_Q_SAMPLE = 150  # closed positions for light Q (not full book)
MAX_CLOSED_BOT = 8_000  # too many closed rows → grinder/bot, skip enqueue
MIN_CLOSED_FOR_Q = 8


def http_json(url: str, timeout: float = 25.0) -> Any:
    req = Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:160]
        raise RuntimeError(f"HTTP {e.code} {url}: {body}") from e
    except URLError as e:
        raise RuntimeError(f"URL error {url}: {e}") from e


def get(path: str, **params: Any) -> Any:
    q = urlencode({k: v for k, v in params.items() if v is not None})
    return http_json(f"{DATA_API}{path}?{q}" if q else f"{DATA_API}{path}")


def fetch_closed_sample(wallet: str, limit: int = MAX_LIGHT_Q_SAMPLE) -> list[dict[str, Any]]:
    """Paginate a short closed-positions sample — enough for light Q, not a full book."""
    rows: list[dict[str, Any]] = []
    offset = 0
    page = 50
    while len(rows) < limit:
        try:
            batch = get("/closed-positions", user=wallet, limit=page, offset=offset)
        except RuntimeError:
            break
        if not isinstance(batch, list) or not batch:
            break
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
        if offset >= limit:
            break
        time.sleep(0.12)
    return rows[:limit]


def light_q_from_closed(closed: list[dict[str, Any]]) -> dict[str, Any]:
    """Heuristic 0–100 quality from a closed sample (look-ahead free: realized only)."""
    n = len(closed)
    if n == 0:
        return {
            "light_q": 0,
            "n": 0,
            "win_rate": None,
            "roi_pct": None,
            "realized": 0.0,
            "invested": 0.0,
            "reasons": ["no_closed_sample"],
        }

    wins = 0
    realized = 0.0
    invested = 0.0
    for r in closed:
        pnl = float(r.get("realizedPnl") or 0)
        realized += pnl
        if pnl > 0:
            wins += 1
        # Prefer initialValue / totalBought; fall back to avgPrice * size
        inv = r.get("initialValue") or r.get("totalBought")
        if inv is None:
            try:
                inv = float(r.get("avgPrice") or 0) * float(r.get("totalBought") or r.get("size") or 0)
            except (TypeError, ValueError):
                inv = 0
        try:
            invested += abs(float(inv or 0))
        except (TypeError, ValueError):
            pass

    wr = 100.0 * wins / n if n else 0.0
    roi = (100.0 * realized / invested) if invested > 1e-6 else 0.0

    # Sample size (cap at ~40 pts)
    sample_pts = min(40.0, n * 0.35)
    # ROI: +1% ≈ +1.2 pts, clamp
    roi_pts = max(-25.0, min(35.0, roi * 1.2))
    # Win rate sweet spot 50–68 (copyable sports books)
    if 50 <= wr <= 68:
        wr_pts = 20.0
    elif 48 <= wr < 50 or 68 < wr <= 72:
        wr_pts = 10.0
    elif wr > 78 or wr < 42:
        wr_pts = -15.0  # winner-capped or coin-flip disaster
    else:
        wr_pts = 0.0

    q = int(round(max(0.0, min(100.0, 25.0 + sample_pts + roi_pts + wr_pts))))
    reasons: list[str] = []
    if n < MIN_CLOSED_FOR_Q:
        reasons.append(f"thin_sample_n={n}")
    if wr > 78:
        reasons.append("sus_high_wr")
    if n >= MAX_CLOSED_BOT:
        reasons.append("bot_volume")
    return {
        "light_q": q,
        "n": n,
        "win_rate": round(wr, 1),
        "roi_pct": round(roi, 1),
        "realized": round(realized, 2),
        "invested": round(invested, 2),
        "reasons": reasons,
    }


def score_wallet_light(wallet: str) -> dict[str, Any]:
    closed = fetch_closed_sample(wallet)
    return light_q_from_closed(closed)


def run_unusual_scan(*, events: int, max_markets: int, quick: bool) -> dict[str, Any] | None:
    cmd = [
        sys.executable,
        str(ROOT / "scan_unusual_flow.py"),
        "--events",
        str(events),
        "--max-markets",
        str(max_markets),
    ]
    # Always enrich — potential_insider / fresh_wallet / concentrated tags need
    # position+trade probes. Quick mode only shrinks market count.
    print(f"[hot-discover] running unusual scan: {' '.join(cmd)}")
    proc = subprocess.run(cmd, cwd=str(ROOT.parent))
    if proc.returncode != 0:
        print(f"[hot-discover] unusual scan exited {proc.returncode}")
        return None
    if not UNUSUAL_JSON.exists():
        return None
    try:
        return json.loads(UNUSUAL_JSON.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        print(f"[hot-discover] bad unusual_flow.json: {e}")
        return None


def load_unusual_json() -> dict[str, Any] | None:
    if not UNUSUAL_JSON.exists():
        return None
    try:
        return json.loads(UNUSUAL_JSON.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def collect_candidates(unusual: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten flagged holders with lane + insider tags. Prefer potential_insiders list."""
    by_wallet: dict[str, dict[str, Any]] = {}

    def consider(row: dict[str, Any], *, sports_ish: bool | None, market: str | None, unusual_score: float | None) -> None:
        w = str(row.get("wallet") or "").lower()
        if not w.startswith("0x"):
            return
        tags = list(row.get("tags") or [])
        z = float(row.get("z") or 0)
        if z < MIN_Z:
            return
        has_signal = (
            "potential_insider" in tags
            or "concentrated" in tags
            or ("fresh_wallet" in tags and z >= MIN_Z_FRESH)
        )
        if not has_signal:
            return
        prev = by_wallet.get(w)
        if prev and float(prev.get("z") or 0) >= z:
            # keep strongest Z hit; merge sports flag if any sports hit
            if sports_ish:
                prev["sports_ish"] = True
                prev["lane"] = "sports"
            return
        name = str(row.get("name") or "").strip() or w[:12]
        lane = "sports" if sports_ish else "other"
        by_wallet[w] = {
            "wallet": w,
            "username": name,
            "z": round(z, 2),
            "amount": row.get("amount"),
            "outcome": row.get("outcome"),
            "tags": tags,
            "q_known": row.get("q"),
            "fresh": bool(row.get("fresh")),
            "open_markets": row.get("open_markets"),
            "trade_depth": row.get("trade_depth"),
            "sports_ish": bool(sports_ish),
            "lane": lane,
            "market": market or row.get("market"),
            "unusual_score": unusual_score if unusual_score is not None else row.get("unusual_score"),
            "url": row.get("url"),
            "polymarket_profile": row.get("polymarket_profile") or f"https://polymarket.com/profile/{w}",
        }

    for pi in unusual.get("potential_insiders") or []:
        if not isinstance(pi, dict):
            continue
        consider(
            pi,
            sports_ish=pi.get("sports_ish"),
            market=pi.get("market"),
            unusual_score=float(pi.get("unusual_score") or 0) if pi.get("unusual_score") is not None else None,
        )

    # Also walk markets so sports_ish is accurate when potential_insiders lacks it
    for m in unusual.get("markets") or []:
        if not isinstance(m, dict):
            continue
        sports = bool(m.get("sports_ish"))
        for f in m.get("flagged") or []:
            if not isinstance(f, dict):
                continue
            consider(
                f,
                sports_ish=sports,
                market=m.get("question"),
                unusual_score=float(m.get("unusual_score") or 0) if m.get("unusual_score") is not None else None,
            )
            # attach market url
            w = str(f.get("wallet") or "").lower()
            if w in by_wallet and m.get("url"):
                by_wallet[w]["url"] = m.get("url")

    rows = list(by_wallet.values())
    rows.sort(key=lambda r: (-float(r.get("z") or 0), -float(r.get("unusual_score") or 0)))
    return rows


def should_enqueue(
    cand: dict[str, Any],
    light: dict[str, Any],
    *,
    known: dict[str, str],
    extra: dict[str, str],
    by_w: dict[str, dict[str, Any]],
) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    w = cand["wallet"]
    u = cand["username"]
    if u in HARD_SKIP_USERNAMES or w in HARD_SKIP_WALLETS:
        return False, ["hard_skip"]
    st = extra.get(w) or (str(by_w[w].get("status") or "") if w in by_w else "")
    if st in {"kicked", "kick", "grinder"}:
        return False, ["already_kicked"]
    if st in {"take_book", "matched"}:
        return False, ["already_take_book"]
    if w in by_w and st == "watch":
        return False, ["already_watch"]
    if w in known:
        # Already on curated roster — still useful as "seen" but do not re-append
        return False, ["on_roster"]

    if light.get("n", 0) >= MAX_CLOSED_BOT:
        return False, ["bot_volume"]
    if "sus_high_wr" in (light.get("reasons") or []):
        return False, ["sus_high_wr"]

    lq = int(light.get("light_q") or 0)
    known_q = cand.get("q_known")
    effective_q = int(known_q) if known_q is not None else lq
    sports = bool(cand.get("sports_ish"))
    tags = cand.get("tags") or []
    floor = MIN_LIGHT_Q_SPORTS_HOT if (sports and "potential_insider" in tags) else MIN_LIGHT_Q

    # Brand-new shallow wallets with huge Z: allow enqueue with caution tag
    sample_n = int(light.get("n") or 0)
    known_q_path = "known_q" in (light.get("reasons") or []) or sample_n < 0
    if not known_q_path and sample_n < MIN_CLOSED_FOR_Q:
        amt = float(cand.get("amount") or 0)
        if (
            "fresh_wallet" in tags
            and float(cand.get("z") or 0) >= 4.0
            and amt >= 500
            and sports
        ):
            reasons.append("fresh_sports_hot_thin_book")
            return True, reasons
        return False, ["thin_sample"]

    if effective_q < floor:
        return False, [f"light_q={effective_q}<{floor}"]

    reasons.append(f"z={cand.get('z')}")
    reasons.append(f"light_q={effective_q}")
    if sports:
        reasons.append("sports_lane")
    else:
        reasons.append("macro_lane")
    return True, reasons


def upsert_hot_watch(
    accepted: list[dict[str, Any]],
    *,
    known: dict[str, str],
) -> tuple[int, list[dict[str, Any]]]:
    existing: list[dict[str, Any]] = []
    if EXTRA_TRADERS_PATH.exists():
        try:
            data = json.loads(EXTRA_TRADERS_PATH.read_text(encoding="utf-8"))
            if isinstance(data, list):
                existing = [r for r in data if isinstance(r, dict)]
        except Exception as exc:
            print(f"[hot-discover] extra_traders.json: {exc}")
            return 0, []

    by_w = {str(r.get("wallet") or "").lower(): r for r in existing if r.get("wallet")}
    sports_added = 0
    macro_added = 0
    new_rows: list[dict[str, Any]] = []

    for cand in accepted:
        w = cand["wallet"]
        if w in by_w or w in known:
            continue
        sports = bool(cand.get("sports_ish"))
        if sports and sports_added >= MAX_SPORTS_WATCH:
            continue
        if (not sports) and macro_added >= MAX_MACRO_WATCH:
            continue
        u = str(cand.get("username") or "").strip() or w[:12]
        # Avoid username collisions with hex-looking garbage when name missing
        if u.startswith("0x") and len(u) > 20:
            u = f"hot_{w[2:8]}"
        source = "unusual_flow_sports" if sports else "unusual_flow_macro"
        light = cand.get("light") or {}
        notes = (
            f"Hot discovery Z={cand.get('z')} on {(cand.get('market') or '')[:60]}. "
            f"light_q={light.get('light_q')} n={light.get('n')} "
            f"WR={light.get('win_rate')} ROI={light.get('roi_pct')}%. "
            f"Unique CSV + take-rule required before live. tags={','.join(cand.get('tags') or [])}"
        )
        rec = {
            "wallet": w,
            "username": u,
            "source": source,
            "status": "watch",
            "notes": notes,
            "discovered_at": datetime.now(timezone.utc).isoformat(),
            "discovery": {
                "z": cand.get("z"),
                "lane": cand.get("lane"),
                "market": cand.get("market"),
                "tags": cand.get("tags"),
                "light_q": light.get("light_q"),
                "light_n": light.get("n"),
                "light_roi": light.get("roi_pct"),
            },
        }
        by_w[w] = rec
        new_rows.append(rec)
        if sports:
            sports_added += 1
        else:
            macro_added += 1
        print(f"  [watch+] {u} ({w[:10]}…) z={cand.get('z')} lane={cand.get('lane')} q={light.get('light_q')}")

    if new_rows:
        EXTRA_TRADERS_PATH.write_text(
            json.dumps(existing + new_rows, indent=2) + "\n",
            encoding="utf-8",
        )
    return len(new_rows), new_rows


def fetch_new_csvs(usernames: list[str], limit: int) -> int:
    if not usernames:
        return 0
    batch = usernames[: max(1, limit)]
    print(f"[hot-discover] fetching first CSV for {len(batch)}: {batch}")
    cmd = [
        sys.executable,
        str(ROOT / "run_full_pipeline.py"),
        "--incremental",
        "--full-open",
        "--ingest",
        "--traders",
        ",".join(batch),
    ]
    proc = subprocess.run(cmd, cwd=str(ROOT.parent))
    return 0 if proc.returncode == 0 else proc.returncode


def write_md(payload: dict[str, Any]) -> None:
    lines = [
        "# Hot wallet discoveries (UW-style enqueue)",
        "",
        f"Generated **{payload['generated_at']}**.",
        "",
        f"Candidates scored: **{payload['counts']['candidates']}** → "
        f"enqueued **{payload['counts']['enqueued']}** "
        f"(sports {payload['counts']['enqueued_sports']} / macro {payload['counts']['enqueued_macro']}).",
        "",
        "Method: market-first Z-score → light Q on alerts only → watch list. "
        "No full pipeline on cold/stale books.",
        "",
        "| Wallet | Lane | Z | Light Q | Market | Action |",
        "|---|---|---:|---:|---|---|",
    ]
    for r in payload.get("results") or []:
        lines.append(
            f"| {r.get('username') or r.get('wallet','')[:10]} | {r.get('lane')} | "
            f"{r.get('z')} | {(r.get('light') or {}).get('light_q')} | "
            f"{(r.get('market') or '')[:40]} | {r.get('action')} |"
        )
    lines.append("")
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--from-json", action="store_true", help="Reuse existing unusual_flow.json (no re-scan)")
    ap.add_argument("--quick", action="store_true", help="Smaller scan for live 10-min loop")
    ap.add_argument("--fetch", action="store_true", help="Fetch first CSV for newly enqueued wallets")
    ap.add_argument("--fetch-limit", type=int, default=4)
    ap.add_argument("--events", type=int, default=0, help="Override Gamma events count")
    ap.add_argument("--max-markets", type=int, default=0)
    ap.add_argument("--max-score", type=int, default=20, help="Max candidate wallets to light-Q per run")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    known = {w.lower(): u for w, u in roster_traders()}
    extra = load_extra_status()

    unusual: dict[str, Any] | None
    if args.from_json:
        unusual = load_unusual_json()
        if not unusual:
            print("[hot-discover] no unusual_flow.json — run scan first")
            return 1
    else:
        events = args.events or (12 if args.quick else 20)
        max_m = args.max_markets or (18 if args.quick else 30)
        unusual = run_unusual_scan(events=events, max_markets=max_m, quick=args.quick)
        if not unusual:
            return 1

    candidates = collect_candidates(unusual)
    print(f"[hot-discover] {len(candidates)} Z-flagged candidates")

    # Light-Q only the top N by Z (not the whole roster)
    to_score = candidates[: max(1, args.max_score)]
    scored: list[dict[str, Any]] = []

    def _work(c: dict[str, Any]) -> dict[str, Any]:
        # Prefer known Q from ranks when present — skip API
        if c.get("q_known") is not None:
            light = {
                "light_q": int(c["q_known"]),
                "n": -1,
                "win_rate": None,
                "roi_pct": None,
                "realized": None,
                "invested": None,
                "reasons": ["known_q"],
            }
        else:
            try:
                light = score_wallet_light(c["wallet"])
            except Exception as e:
                light = {
                    "light_q": 0,
                    "n": 0,
                    "win_rate": None,
                    "roi_pct": None,
                    "realized": 0.0,
                    "invested": 0.0,
                    "reasons": [f"error:{e}"],
                }
        return {**c, "light": light}

    # Sequential is kinder to public API; parallel 3 is fine for quick loop
    workers = 3 if args.quick else 2
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(_work, c): c["wallet"] for c in to_score}
        for fut in as_completed(futs):
            try:
                scored.append(fut.result())
            except Exception as e:
                print(f"[hot-discover] score error {futs[fut][:10]}: {e}")

    scored.sort(key=lambda r: (-float(r.get("z") or 0), -int((r.get("light") or {}).get("light_q") or 0)))

    existing: list[dict[str, Any]] = []
    if EXTRA_TRADERS_PATH.exists():
        try:
            data = json.loads(EXTRA_TRADERS_PATH.read_text(encoding="utf-8"))
            if isinstance(data, list):
                existing = [r for r in data if isinstance(r, dict)]
        except Exception:
            existing = []
    by_w = {str(r.get("wallet") or "").lower(): r for r in existing if r.get("wallet")}

    results: list[dict[str, Any]] = []
    accepted: list[dict[str, Any]] = []
    for cand in scored:
        ok, reasons = should_enqueue(cand, cand.get("light") or {}, known=known, extra=extra, by_w=by_w)
        action = "enqueue" if ok else f"skip:{','.join(reasons)}"
        row = {**cand, "action": action, "gate_reasons": reasons}
        results.append(row)
        if ok:
            accepted.append(cand)
        print(
            f"  {action:<28} {cand.get('username','')[:20]:<20} "
            f"z={cand.get('z')} q={(cand.get('light') or {}).get('light_q')} "
            f"lane={cand.get('lane')}"
        )

    added, new_rows = upsert_hot_watch(accepted, known=known)
    enq_sports = sum(1 for r in new_rows if r.get("source") == "unusual_flow_sports")
    enq_macro = sum(1 for r in new_rows if r.get("source") == "unusual_flow_macro")

    # Cumulative unusual-flow watches still on the roster (for UI badge)
    watch_roster: list[dict[str, Any]] = []
    try:
        data = json.loads(EXTRA_TRADERS_PATH.read_text(encoding="utf-8")) if EXTRA_TRADERS_PATH.exists() else []
        if isinstance(data, list):
            for r in data:
                if not isinstance(r, dict):
                    continue
                src = str(r.get("source") or "")
                st = str(r.get("status") or "")
                if src.startswith("unusual_flow") and st in {"watch", "take_book"}:
                    watch_roster.append(
                        {
                            "username": r.get("username"),
                            "wallet": r.get("wallet"),
                            "source": src,
                            "status": st,
                            "discovered_at": r.get("discovered_at"),
                            "discovery": r.get("discovery"),
                            "notes": r.get("notes"),
                        }
                    )
    except Exception as exc:
        print(f"[hot-discover] watch_roster: {exc}")

    fetched = 0
    fetch_rc = 0
    if args.fetch and new_rows:
        names = [str(r.get("username")) for r in new_rows if r.get("username")]
        # Only fetch if CSV missing
        need = [u for u, r in zip(names, new_rows) if not csv_path_for(str(r.get("wallet")), u).exists()]
        if need:
            fetch_rc = fetch_new_csvs(need, args.fetch_limit)
            fetched = min(len(need), args.fetch_limit)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": (
            "Market-first hot wallet discovery (Unusual Whales / OddsJam pattern): "
            "scan top-volume Polymarket holders → Z≥2 alerts → light Q on alerts only "
            "→ enqueue to extra_traders watch. Sports vs macro lanes via sports_ish. "
            "Never runs full pipeline on cold/stale roster wallets."
        ),
        "params": {
            "from_json": args.from_json,
            "quick": args.quick,
            "fetch": args.fetch,
            "min_z": MIN_Z,
            "min_light_q": MIN_LIGHT_Q,
            "max_sports_watch": MAX_SPORTS_WATCH,
            "max_macro_watch": MAX_MACRO_WATCH,
            "max_score": args.max_score,
        },
        "counts": {
            "candidates": len(candidates),
            "scored": len(scored),
            "accepted": len(accepted),
            "enqueued": added,
            "enqueued_sports": enq_sports,
            "enqueued_macro": enq_macro,
            "csv_fetched": fetched,
            "watch_roster": len(watch_roster),
        },
        "enqueued": new_rows,
        "watch_roster": watch_roster,
        "results": results,
        "sources": {
            "unusual_flow": str(UNUSUAL_JSON),
            "extra_traders": str(EXTRA_TRADERS_PATH),
        },
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    write_md(payload)
    print(f"\n[hot-discover] enqueued={added} (sports={enq_sports} macro={enq_macro}) fetched={fetched}")
    print(f"Wrote {OUT_JSON}")
    print(f"Wrote {OUT_MD}")
    if fetch_rc != 0:
        return fetch_rc
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
