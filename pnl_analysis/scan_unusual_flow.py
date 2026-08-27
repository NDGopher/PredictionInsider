#!/usr/bin/env python3
"""Unusual Whales / Hashdive-style flow scanner — free Polymarket data only.

Unusual Predictions (UW + Hashdive) ranks markets by an Unusual Score built from
tags: Potential Insiders, Smart Money, Contrarian Whales, Momentum, Closing Soon.

Their Potential Insiders page is driven by a **per-market Z-score** on bet size vs
other holders, plus wallet concentration and wallet age at first trade in that market.

We replicate the free core with public APIs (no UW paid API required):

  GET https://gamma-api.polymarket.com/events?order=volume24hr
  GET https://data-api.polymarket.com/holders?market=<conditionId>
  GET https://data-api.polymarket.com/positions?user=<wallet>
  GET https://data-api.polymarket.com/trades?market=<conditionId>
  GET https://data-api.polymarket.com/activity?user=<wallet>&type=TRADE

Outputs:
  pnl_analysis/output/unusual_flow.json
  pnl_analysis/UNUSUAL_FLOW.md  (short human digest)

Usage:
  python3 pnl_analysis/scan_unusual_flow.py
  python3 pnl_analysis/scan_unusual_flow.py --events 25 --min-z 2.0
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "output"
OUT_JSON = OUT / "unusual_flow.json"
OUT_MD = ROOT / "UNUSUAL_FLOW.md"

DATA_API = "https://data-api.polymarket.com"
GAMMA_API = "https://gamma-api.polymarket.com"
UA = "PredictionInsider/1.0 (unusual-flow; research; +https://github.com/NDGopher/PredictionInsider)"

# Tag weights roughly mirroring UW's "sum of indicator tags" Unusual Score
TAG_WEIGHTS = {
    "potential_insider": 4.0,
    "smart_money": 3.0,
    "contrarian_whale": 2.5,
    "momentum": 1.5,
    "closing_soon": 1.0,
    "concentrated": 1.5,
    "fresh_wallet": 2.0,
}


def http_json(url: str, timeout: float = 30.0) -> Any:
    req = Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:200]
        raise RuntimeError(f"HTTP {e.code} {url}: {body}") from e
    except URLError as e:
        raise RuntimeError(f"URL error {url}: {e}") from e


def get(path: str, base: str = DATA_API, **params: Any) -> Any:
    q = urlencode({k: v for k, v in params.items() if v is not None})
    return http_json(f"{base}{path}?{q}" if q else f"{base}{path}")


def z_scores(amounts: list[float]) -> list[float]:
    if len(amounts) < 3:
        return [0.0] * len(amounts)
    mu = statistics.mean(amounts)
    sd = statistics.pstdev(amounts)
    if sd < 1e-9:
        return [0.0] * len(amounts)
    return [(a - mu) / sd for a in amounts]


def parse_outcomes(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(x) for x in raw]
    if isinstance(raw, str):
        try:
            v = json.loads(raw)
            if isinstance(v, list):
                return [str(x) for x in v]
        except json.JSONDecodeError:
            pass
    return ["Yes", "No"]


def parse_prices(raw: Any) -> list[float]:
    if isinstance(raw, list):
        return [float(x) for x in raw]
    if isinstance(raw, str):
        try:
            v = json.loads(raw)
            if isinstance(v, list):
                return [float(x) for x in v]
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
    return []


def days_until(end_iso: str | None) -> float | None:
    if not end_iso:
        return None
    try:
        end = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
        return (end - datetime.now(timezone.utc)).total_seconds() / 86400.0
    except ValueError:
        return None


def fetch_hot_markets(events: int, sports_bias: bool) -> list[dict[str, Any]]:
    """Pull high-volume active markets (event → markets)."""
    rows = get(
        "/events",
        base=GAMMA_API,
        limit=events,
        active="true",
        closed="false",
        order="volume24hr",
        ascending="false",
    )
    if not isinstance(rows, list):
        return []
    markets: list[dict[str, Any]] = []
    for ev in rows:
        title = str(ev.get("title") or "")
        tags = [str(t.get("label") or t.get("slug") or "").lower() for t in (ev.get("tags") or []) if isinstance(t, dict)]
        cat = " ".join(tags)
        is_sports = any(
            k in cat or k in title.lower()
            for k in ("sport", "nba", "nfl", "mlb", "nhl", "soccer", "tennis", "ufc", "esport", "lol", "cs2")
        )
        if sports_bias and not is_sports and "politic" not in cat:
            # still keep top volume non-sports — UW covers politics heavily
            pass
        for m in ev.get("markets") or []:
            cid = str(m.get("conditionId") or "").strip()
            if not cid:
                continue
            vol = float(m.get("volume24hr") or m.get("volumeNum") or m.get("volume") or 0) or 0.0
            liq = float(m.get("liquidityNum") or m.get("liquidity") or 0) or 0.0
            if vol < 500 and liq < 1000:
                continue
            outcomes = parse_outcomes(m.get("outcomes"))
            prices = parse_prices(m.get("outcomePrices"))
            markets.append(
                {
                    "conditionId": cid,
                    "question": str(m.get("question") or title),
                    "slug": str(m.get("slug") or ev.get("slug") or ""),
                    "event_title": title,
                    "endDate": str(m.get("endDate") or ev.get("endDate") or ""),
                    "volume24hr": vol,
                    "liquidity": liq,
                    "outcomes": outcomes,
                    "prices": prices,
                    "sports_ish": is_sports,
                    "url": f"https://polymarket.com/event/{ev.get('slug') or m.get('slug') or ''}",
                }
            )
    # Prefer liquid markets; cap to keep holder fetches bounded
    markets.sort(key=lambda x: (-float(x["volume24hr"]), -float(x["liquidity"])))
    return markets


def holders_for_market(cid: str, limit: int = 40) -> list[dict[str, Any]]:
    raw = get("/holders", market=cid, limit=limit)
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for tok in raw:
        for h in tok.get("holders") or []:
            try:
                amt = float(h.get("amount") or 0)
            except (TypeError, ValueError):
                amt = 0.0
            if amt <= 0:
                continue
            out.append(
                {
                    "wallet": str(h.get("proxyWallet") or "").lower(),
                    "name": str(h.get("name") or h.get("pseudonym") or "")[:48],
                    "amount": amt,
                    "outcomeIndex": int(h.get("outcomeIndex") if h.get("outcomeIndex") is not None else -1),
                    "asset": str(h.get("asset") or ""),
                }
            )
    return out


def position_count(wallet: str) -> int:
    try:
        rows = get("/positions", user=wallet, limit=100, sizeThreshold=0)
        if not isinstance(rows, list):
            return 0
        return len({str(r.get("conditionId") or "") for r in rows if r.get("conditionId")})
    except RuntimeError:
        return -1


def approx_trade_depth(wallet: str) -> dict[str, Any]:
    """UW 'wallet age' proxy without paid indexing.

    Polymarket /trades?user= is newest-first with a capped offset window, so we
    cannot always get the true first-ever trade. Instead:
      - probe offsets to estimate depth (how many trades exist)
      - take the oldest timestamp visible in that window
    A wallet with depth < ~40 and large concentrated bets is the UW-style
    'fresh account for one idea' pattern — not a whale who traded all day.
    """
    probes = [0, 25, 50, 100, 250, 500, 1000, 2000, 4000]
    last_hit: dict[str, Any] | None = None
    max_off = 0
    for off in probes:
        try:
            rows = get("/trades", user=wallet, limit=1, offset=off)
        except RuntimeError:
            break
        if not isinstance(rows, list) or not rows:
            break
        last_hit = rows[0]
        max_off = off
    if not last_hit:
        # Empty trades response is ambiguous (new wallet OR API gap) — caller must
        # cross-check open_markets before treating as fresh.
        return {"trade_depth": 0, "oldest_visible_days": None, "fresh": False}
    try:
        oldest_ts = int(last_hit.get("timestamp") or 0)
    except (TypeError, ValueError):
        oldest_ts = 0
    days = ((time.time() - oldest_ts) / 86400.0) if oldest_ts else None
    # Fresh = shallow history in the visible trade window
    fresh = max_off < 40
    return {
        "trade_depth": max_off + 1,
        "oldest_visible_days": round(days, 1) if days is not None else None,
        "fresh": fresh,
    }


def load_known_q() -> dict[str, int]:
    """Map wallet → quality Q from our offline analyses / insider ranks when present."""
    qmap: dict[str, int] = {}
    ranks = OUT / "insider_ranks.json"
    if ranks.exists():
        try:
            data = json.loads(ranks.read_text())
            for t in data.get("traders") or data.get("ranked") or []:
                w = str(t.get("wallet") or "").lower()
                q = t.get("quality_score") or t.get("q") or t.get("insider_score")
                if w and q is not None:
                    try:
                        qmap[w] = int(float(q))
                    except (TypeError, ValueError):
                        pass
        except (json.JSONDecodeError, OSError):
            pass
    # Per-trader analysis JSONs
    for p in OUT.glob("*_0x*.json"):
        try:
            data = json.loads(p.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        w = str(data.get("wallet") or "").lower()
        q = data.get("quality_score") or data.get("q")
        if w and q is not None:
            try:
                qmap[w] = int(float(q))
            except (TypeError, ValueError):
                pass
    return qmap


def score_market(
    mkt: dict[str, Any],
    holders: list[dict[str, Any]],
    known_q: dict[str, int],
    min_z: float,
    enrich: bool,
) -> dict[str, Any] | None:
    if len(holders) < 5:
        return None

    # Z-score within each outcome side (UW: vs other participants in the market)
    by_side: dict[int, list[dict[str, Any]]] = {}
    for h in holders:
        by_side.setdefault(h["outcomeIndex"], []).append(h)

    flagged: list[dict[str, Any]] = []
    for side, rows in by_side.items():
        amts = [r["amount"] for r in rows]
        zs = z_scores(amts)
        for r, z in zip(rows, zs):
            if z < min_z:
                continue
            flagged.append({**r, "z": round(z, 2), "side_index": side})

    if not flagged:
        return None

    flagged.sort(key=lambda x: -x["z"])
    top = flagged[:8]

    # Market mid / favorite for contrarian vs momentum
    prices = mkt.get("prices") or []
    outcomes = mkt.get("outcomes") or ["Yes", "No"]
    fav_idx = max(range(len(prices)), key=lambda i: prices[i]) if prices else 0
    fav_px = prices[fav_idx] if prices else None

    days = days_until(mkt.get("endDate"))
    tags: set[str] = set()
    if days is not None and 0 <= days <= 7:
        tags.add("closing_soon")

    # Enrich top wallets (rate-limited)
    if enrich:
        with ThreadPoolExecutor(max_workers=4) as pool:
            futs = {
                pool.submit(position_count, t["wallet"]): ("pos", t)
                for t in top[:5]
            }
            futs.update(
                {
                    pool.submit(approx_trade_depth, t["wallet"]): ("depth", t)
                    for t in top[:5]
                }
            )
            for fut in as_completed(futs):
                kind, t = futs[fut]
                try:
                    val = fut.result()
                except Exception:
                    val = None
                if kind == "pos":
                    t["open_markets"] = val
                elif isinstance(val, dict):
                    t["trade_depth"] = val.get("trade_depth")
                    t["wallet_age_days"] = val.get("oldest_visible_days")
                    t["fresh"] = bool(val.get("fresh"))

    unusual = 0.0
    for t in top:
        t_tags: list[str] = []
        z = float(t["z"])
        q = known_q.get(t["wallet"])
        t["q"] = q
        t["outcome"] = (
            outcomes[t["side_index"]]
            if 0 <= t["side_index"] < len(outcomes)
            else str(t["side_index"])
        )

        # Potential insider: large Z + concentrated book and/or shallow trade history.
        # depth=0 with many open markets usually means the trades probe failed / rate-limited —
        # do NOT treat that as a fresh wallet.
        open_n = t.get("open_markets")
        depth = t.get("trade_depth")
        concentrated = isinstance(open_n, int) and 0 <= open_n <= 3
        shallow = isinstance(depth, int) and 0 < depth < 40
        probe_failed = depth == 0 and isinstance(open_n, int) and open_n > 5
        fresh = bool(t.get("fresh")) and not probe_failed and (shallow or concentrated)
        t["fresh"] = fresh
        if z >= min_z + 0.5 and (concentrated or shallow):
            t_tags.append("potential_insider")
            tags.add("potential_insider")
        if concentrated:
            t_tags.append("concentrated")
            tags.add("concentrated")
        if fresh or shallow:
            if fresh or shallow:
                t_tags.append("fresh_wallet")
                tags.add("fresh_wallet")
        if q is not None and q >= 50 and z >= min_z:
            t_tags.append("smart_money")
            tags.add("smart_money")

        # Contrarian vs momentum vs favorite price
        if fav_px is not None and prices:
            side_px = prices[t["side_index"]] if t["side_index"] < len(prices) else None
            if side_px is not None:
                if side_px < 0.45 and z >= min_z:
                    t_tags.append("contrarian_whale")
                    tags.add("contrarian_whale")
                elif side_px >= 0.55 and z >= min_z:
                    t_tags.append("momentum")
                    tags.add("momentum")

        t["tags"] = t_tags
        for tg in t_tags:
            unusual += TAG_WEIGHTS.get(tg, 1.0) * min(z / 3.0, 2.0)

    if days is not None and 0 <= days <= 7:
        unusual += TAG_WEIGHTS["closing_soon"]

    # Capital-weighted smart gap (Hashdive/UW Smart Gap) using known Q only
    yes_w = no_w = 0.0
    yes_s = no_s = 0.0
    for h in holders:
        q = known_q.get(h["wallet"])
        if q is None:
            continue
        # map Q 0-100 → approx -100..100 smart-like
        smart = (q - 50) * 2
        amt = float(h["amount"])
        if h["outcomeIndex"] == 0:
            yes_w += amt
            yes_s += smart * amt
        elif h["outcomeIndex"] == 1:
            no_w += amt
            no_s += smart * amt
    smart_yes = (yes_s / yes_w) if yes_w > 0 else None
    smart_no = (no_s / no_w) if no_w > 0 else None
    smart_gap = None
    if smart_yes is not None and smart_no is not None:
        smart_gap = round(smart_yes - smart_no, 1)
        if abs(smart_gap) >= 20:
            tags.add("smart_money")
            unusual += TAG_WEIGHTS["smart_money"]

    return {
        "conditionId": mkt["conditionId"],
        "question": mkt["question"],
        "event_title": mkt["event_title"],
        "slug": mkt["slug"],
        "url": mkt["url"],
        "sports_ish": mkt["sports_ish"],
        "volume24hr": round(float(mkt["volume24hr"]), 2),
        "liquidity": round(float(mkt["liquidity"]), 2),
        "endDate": mkt.get("endDate"),
        "days_to_end": round(days, 1) if days is not None else None,
        "outcomes": outcomes,
        "prices": [round(p, 4) for p in prices],
        "unusual_score": round(unusual, 2),
        "tags": sorted(tags),
        "smart_gap": smart_gap,
        "holders_scanned": len(holders),
        "flagged": [
            {
                "wallet": t["wallet"],
                "name": t["name"],
                "outcome": t.get("outcome"),
                "amount": round(float(t["amount"]), 2),
                "z": t["z"],
                "q": t.get("q"),
                "open_markets": t.get("open_markets"),
                "trade_depth": t.get("trade_depth"),
                "wallet_age_days": t.get("wallet_age_days"),
                "fresh": bool(t.get("fresh")),
                "tags": t.get("tags") or [],
                "polymarket_profile": f"https://polymarket.com/profile/{t['wallet']}",
            }
            for t in top
        ],
    }


def write_md(payload: dict[str, Any]) -> None:
    lines = [
        "# Unusual flow board (UW/Hashdive-style, free data)",
        "",
        f"Generated **{payload['generated_at']}**.",
        "",
        f"Scanned **{payload['counts']['markets_fetched']}** hot markets → "
        f"**{payload['counts']['markets_scored']}** with Z≥{payload['params']['min_z']} flags.",
        "",
        "Method: per-outcome holder Z-score + concentration/fresh-wallet tags + known-Q smart gap. "
        "No Unusual Whales API key required — Polymarket public Data/Gamma APIs only.",
        "",
        "| Rank | Unusual | Tags | Market | Top Z wallet |",
        "|---:|---:|---|---|---|",
    ]
    for i, m in enumerate(payload.get("markets") or [], 1):
        top = (m.get("flagged") or [{}])[0]
        lines.append(
            f"| {i} | {m.get('unusual_score')} | {', '.join(m.get('tags') or []) or '—'} | "
            f"{(m.get('question') or '')[:52]} | "
            f"{top.get('name') or top.get('wallet','')[:10]} z={top.get('z')} |"
        )
    lines.append("")
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--events", type=int, default=20, help="Hot events to pull from Gamma")
    ap.add_argument("--max-markets", type=int, default=40, help="Max markets to holder-scan")
    ap.add_argument("--min-z", type=float, default=2.0, help="Minimum size Z-score to flag")
    ap.add_argument("--no-enrich", action="store_true", help="Skip position/age enrichment")
    ap.add_argument("--sports-only", action="store_true")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    known_q = load_known_q()
    print(f"Known Q wallets: {len(known_q)}")

    mkts = fetch_hot_markets(args.events, sports_bias=True)
    if args.sports_only:
        mkts = [m for m in mkts if m["sports_ish"]]
    mkts = mkts[: args.max_markets]
    print(f"Scanning holders for {len(mkts)} markets…")

    scored: list[dict[str, Any]] = []
    for i, m in enumerate(mkts, 1):
        try:
            holders = holders_for_market(m["conditionId"])
            row = score_market(
                m,
                holders,
                known_q,
                min_z=args.min_z,
                enrich=not args.no_enrich,
            )
            if row:
                scored.append(row)
                print(
                    f"  [{i}/{len(mkts)}] unusual={row['unusual_score']:5.1f} "
                    f"flags={len(row['flagged'])}  {row['question'][:55]}"
                )
            else:
                print(f"  [{i}/{len(mkts)}] — no Z≥{args.min_z}  {m['question'][:55]}")
        except Exception as e:
            print(f"  [{i}/{len(mkts)}] ERROR {m['conditionId'][:10]}… {e}")
        time.sleep(0.15)  # be polite to public API

    scored.sort(key=lambda x: -float(x["unusual_score"]))
    for i, m in enumerate(scored, 1):
        m["rank"] = i

    # Flatten wallet alerts (Potential Insiders page analog — UW requires
    # unusual size PLUS concentration/shallow book, not Z alone).
    wallets: list[dict[str, Any]] = []
    for m in scored:
        for f in m.get("flagged") or []:
            tags = f.get("tags") or []
            if "potential_insider" not in tags and "concentrated" not in tags and "fresh_wallet" not in tags:
                continue
            wallets.append(
                {
                    "rank": len(wallets) + 1,
                    "z": f.get("z"),
                    "name": f.get("name"),
                    "wallet": f.get("wallet"),
                    "outcome": f.get("outcome"),
                    "amount": f.get("amount"),
                    "open_markets": f.get("open_markets"),
                    "trade_depth": f.get("trade_depth"),
                    "wallet_age_days": f.get("wallet_age_days"),
                    "fresh": f.get("fresh"),
                    "q": f.get("q"),
                    "tags": tags,
                    "market": m.get("question"),
                    "unusual_score": m.get("unusual_score"),
                    "url": m.get("url"),
                    "polymarket_profile": f.get("polymarket_profile"),
                }
            )
    wallets.sort(key=lambda x: (-float(x.get("z") or 0), -float(x.get("unusual_score") or 0)))
    for i, w in enumerate(wallets, 1):
        w["rank"] = i

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": (
            "Free Polymarket holders Z-score + concentration/fresh-wallet tags + "
            "known-Q capital-weighted smart gap. Modeled on Unusual Whales Predictions "
            "/ Hashdive Potential Insiders (public methodology)."
        ),
        "params": {
            "events": args.events,
            "max_markets": args.max_markets,
            "min_z": args.min_z,
            "enrich": not args.no_enrich,
            "sports_only": args.sports_only,
        },
        "counts": {
            "markets_fetched": len(mkts),
            "markets_scored": len(scored),
            "wallet_alerts": len(wallets),
            "known_q": len(known_q),
        },
        "markets": scored,
        "potential_insiders": wallets[:50],
        "sources": {
            "holders": f"{DATA_API}/holders?market=",
            "gamma_events": f"{GAMMA_API}/events?order=volume24hr",
            "uw_docs": "https://unusualwhales.substack.com/p/unusual-predictions-is-now-live",
            "hashdive": "https://hashdive.com/",
        },
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    write_md(payload)
    print(f"\nWrote {OUT_JSON} ({len(scored)} markets, {len(wallets)} insider alerts)")
    print(f"Wrote {OUT_MD}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
