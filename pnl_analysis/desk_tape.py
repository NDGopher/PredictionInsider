#!/usr/bin/env python3
"""Build unique books from activity/trades fills. Never invent a fill or a win.

A unique book is wallet + condition_id + outcome (Yes/No). Cost and VWAP come
from BUY fills. Resolution comes from market metadata or a REDEEM — if we
cannot tell, the book stays unresolved and is excluded from would-have.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from analyze_trader import get_market_type, get_sport
from position_utils import classify_submarket, sport_family

MIN_COST = 25.0
NO_BOND = 0.95


def _f(v: Any) -> float:
    try:
        return float(v or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _unix(v: Any) -> float:
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.timestamp()
    return _f(v)


def _side_norm(value: Any) -> str:
    s = str(value or "").strip().upper()
    if s in {"BUY", "SELL"}:
        return s
    return s


def _outcome_norm(value: Any) -> str:
    s = str(value or "").strip()
    if s.lower() == "yes":
        return "Yes"
    if s.lower() == "no":
        return "No"
    return s


def activity_to_fill(ev: dict[str, Any], *, username: str, wallet: str, source: str) -> dict[str, Any] | None:
    """Map one Data-API activity or trades row to a desk_fills record."""
    kind = str(ev.get("type") or ev.get("eventType") or "TRADE").upper()
    if kind not in {"TRADE", "REDEEM", "SELL"}:
        # trades endpoint has no type — treat as TRADE
        if ev.get("price") is None and ev.get("usdcSize") is None:
            return None
        kind = "TRADE"
    condition = str(ev.get("conditionId") or ev.get("condition_id") or ev.get("market") or "").strip()
    if not condition:
        return None
    ts = ev.get("timestamp") or ev.get("createdAt") or ev.get("matchTime")
    try:
        ts_n = int(float(ts))
    except (TypeError, ValueError):
        return None
    if ts_n > 10_000_000_000:  # ms
        ts_n = ts_n // 1000
    price = _f(ev.get("price"))
    size = _f(ev.get("size"))
    usdc = _f(ev.get("usdcSize") or ev.get("usdc_size"))
    if usdc <= 0 and price > 0 and size > 0:
        usdc = price * size
    side = _side_norm(ev.get("side"))
    if not side and kind == "REDEEM":
        side = "REDEEM"
    if not side:
        side = "BUY"
    title = str(ev.get("title") or ev.get("question") or "")
    slug = str(ev.get("slug") or "")
    event_slug = str(ev.get("eventSlug") or ev.get("event_slug") or "")
    sport = get_sport({"eventSlug": event_slug, "slug": slug, "title": title})
    market_type = get_market_type({"title": title, "slug": slug})
    return {
        "wallet": wallet.lower(),
        "username": username,
        "event_timestamp": ts_n,
        "timestamp": ts_n,
        "condition_id": condition,
        "side": side,
        "price": round(price, 8),
        "size": round(size, 8),
        "transaction_hash": str(ev.get("transactionHash") or ev.get("transaction_hash") or ev.get("id") or ""),
        "market_id": str(ev.get("asset") or ev.get("tokenId") or ev.get("asset_id") or ""),
        "asset": str(ev.get("asset") or ev.get("asset_id") or ""),
        "outcome": _outcome_norm(ev.get("outcome")),
        "title": title[:500],
        "slug": slug,
        "event_slug": event_slug,
        "usdc_size": usdc,
        "event_type": kind if kind != "SELL" else "TRADE",
        "sport": sport,
        "market_type": market_type,
        "source": source,
    }


def _winning_from_prices(prices: Any, outcomes: list[str] | None = None) -> str | None:
    """Parse Gamma outcomePrices. Do not guess — only return a winner at ~$1."""
    vals: list[float] = []
    if isinstance(prices, str):
        raw = prices.strip()
        if raw.startswith("["):
            try:
                import json
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    vals = [_f(x) for x in parsed]
            except Exception:
                return None
        else:
            try:
                vals = [_f(x) for x in raw.split(",")]
            except Exception:
                return None
    elif isinstance(prices, (list, tuple)):
        vals = [_f(x) for x in prices]
    if len(vals) < 2:
        return None
    if vals[0] >= 0.99 and vals[1] <= 0.01:
        return "Yes"
    if vals[1] >= 0.99 and vals[0] <= 0.01:
        return "No"
    return None


def parse_gamma_market(raw: dict[str, Any]) -> dict[str, Any] | None:
    cid = str(raw.get("conditionId") or raw.get("condition_id") or "").strip()
    if not cid:
        return None
    title = str(raw.get("question") or raw.get("title") or "")
    slug = str(raw.get("slug") or "")
    event_slug = ""
    ev = raw.get("events")
    if isinstance(ev, list) and ev and isinstance(ev[0], dict):
        event_slug = str(ev[0].get("slug") or "")
    end = raw.get("endDate") or raw.get("end_date_iso") or raw.get("closedTime")
    closed = bool(raw.get("closed") or raw.get("umaResolutionStatus") == "resolved")
    prices = raw.get("outcomePrices") or raw.get("outcome_prices")
    winning = _winning_from_prices(prices)
    if winning is None:
        tokens = raw.get("tokens") or []
        if isinstance(tokens, list):
            for tok in tokens:
                if not isinstance(tok, dict):
                    continue
                winner = tok.get("winner")
                if winner is True:
                    winning = _outcome_norm(tok.get("outcome"))
                    closed = True
                    break
    sport = get_sport({"eventSlug": event_slug, "slug": slug, "title": title})
    return {
        "condition_id": cid,
        "title": title,
        "slug": slug,
        "event_slug": event_slug,
        "end_date": end,
        "closed": closed and winning is not None,
        "winning_outcome": winning,
        "outcome_prices": str(prices) if prices is not None else None,
        "sport": sport,
        "market_type": get_market_type({"title": title, "slug": slug}),
    }


def unique_books_from_fills(
    fills: list[dict[str, Any]],
    markets: dict[str, dict[str, Any]],
    *,
    username: str,
    wallet: str,
) -> list[dict[str, Any]]:
    """Aggregate BUY fills into unique books. Unresolved markets are kept but won=None."""
    buys: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    redeems: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in fills:
        kind = str(f.get("event_type") or "TRADE").upper()
        cid = str(f.get("condition_id") or "")
        if not cid:
            continue
        if kind == "REDEEM":
            redeems[cid].append(f)
            continue
        if _side_norm(f.get("side")) != "BUY":
            continue
        outcome = _outcome_norm(f.get("outcome"))
        if not outcome:
            continue
        buys[(cid, outcome)].append(f)

    # Both-sides hedge: drop the whole condition
    by_cid: dict[str, set[str]] = defaultdict(set)
    for cid, outcome in buys:
        by_cid[cid].add(outcome)
    hedged = {cid for cid, sides in by_cid.items() if "Yes" in sides and "No" in sides}

    books: list[dict[str, Any]] = []
    for (cid, outcome), rows in buys.items():
        if cid in hedged:
            continue
        size = sum(_f(r.get("size")) for r in rows)
        usdc = sum(_f(r.get("usdc_size")) for r in rows)
        px_num = sum(_f(r.get("price")) * _f(r.get("size")) for r in rows)
        entry = (px_num / size) if size > 0 else 0.0
        cost = usdc if usdc > 0 else entry * size
        if cost < MIN_COST:
            continue
        if outcome == "No" and entry >= NO_BOND:
            continue
        first = min(_unix(r.get("timestamp") or r.get("event_timestamp")) for r in rows)
        last = max(_unix(r.get("timestamp") or r.get("event_timestamp")) for r in rows)
        sample = rows[0]
        title = str(sample.get("title") or "")
        slug = str(sample.get("slug") or "")
        event_slug = str(sample.get("event_slug") or "")
        meta = markets.get(cid) or {}
        title = str(meta.get("title") or title)
        slug = str(meta.get("slug") or slug)
        event_slug = str(meta.get("event_slug") or event_slug)
        sport = str(meta.get("sport") or sample.get("sport") or get_sport(
            {"eventSlug": event_slug, "slug": slug, "title": title}
        ))
        market_type = str(meta.get("market_type") or sample.get("market_type") or get_market_type(
            {"title": title, "slug": slug}
        ))
        sub = classify_submarket({"title": title, "slug": slug, "eventSlug": event_slug})
        winning = _outcome_norm(meta.get("winning_outcome")) if meta.get("winning_outcome") else None
        won: bool | None = None
        resolved = False
        # Resolution must come from market metadata (both winners and losers).
        # A REDEEM event only exists on wins — using it alone would invent a
        # winner-skewed tape. Sports books use player/team names, not only Yes/No.
        if winning:
            won = outcome.casefold() == winning.casefold()
            resolved = True
        end = meta.get("end_date") or meta.get("end_dt")
        if end is None and resolved:
            end = last
        entry_c = min(max(entry, 0.02), 0.98)
        hold = None
        if resolved and won is not None:
            hold = cost * (1.0 / entry_c - 1.0) if won else -cost
        books.append({
            "wallet": wallet.lower(),
            "username": username,
            "condition_id": cid,
            "outcome": outcome,
            "title": title,
            "slug": slug,
            "event_slug": event_slug,
            "sport": sport,
            "sport_family": sport_family(sport),
            "market_type": market_type,
            "submarket": sub,
            "entry_price": entry_c,
            "cost": cost,
            "size": size,
            "won": won,
            "resolved": resolved,
            "end_date": end,
            "end_dt": end,
            "first_fill_at": first,
            "last_fill_at": last,
            "fill_count": len(rows),
            "hold_pnl": hold,
        })
    return books


def books_to_markets_df(books: list[dict[str, Any]]):
    """Same shape as walkforward load_trader_markets — resolved unique books only."""
    import pandas as pd

    rows = []
    horizon = datetime.now(timezone.utc)
    for b in books:
        if not b.get("resolved") or b.get("won") is None:
            continue
        end = b.get("end_dt") or b.get("end_date") or b.get("last_fill_at")
        if end is None:
            continue
        if isinstance(end, (int, float)):
            end_dt = datetime.fromtimestamp(float(end), tz=timezone.utc)
        elif isinstance(end, datetime):
            end_dt = end if end.tzinfo else end.replace(tzinfo=timezone.utc)
        else:
            try:
                end_dt = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
                if end_dt.tzinfo is None:
                    end_dt = end_dt.replace(tzinfo=timezone.utc)
            except ValueError:
                continue
        if end_dt > horizon:
            continue
        entry = min(max(_f(b.get("entry_price")), 0.02), 0.98)
        cost = _f(b.get("cost"))
        won = bool(b.get("won"))
        hold = _f(b.get("hold_pnl")) if b.get("hold_pnl") is not None else (
            cost * (1.0 / entry - 1.0) if won else -cost
        )
        rows.append({
            "conditionId": b.get("condition_id"),
            "side": b.get("outcome") or "Yes",
            "cost": cost,
            "hold_pnl": hold,
            "won": won,
            "cur_price": 1.0 if won else 0.0,
            "sport_type": b.get("sport") or "OTHER",
            "market_type": b.get("market_type") or "",
            "submarket": b.get("submarket") or b.get("market_type") or "",
            "title": b.get("title") or "",
            "event_slug": b.get("event_slug") or "",
            "slug": b.get("slug") or "",
            "end_dt": end_dt,
            "entry_price": entry,
            "username": b.get("username") or "",
            "wallet": str(b.get("wallet") or "").lower(),
        })
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows)
