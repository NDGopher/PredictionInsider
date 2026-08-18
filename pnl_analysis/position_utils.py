"""Shared position helpers: resolve-by-price, event dates, submarket labels.

Polymarket leaves many losing tokens in `/positions` with status=open and
curPrice 0 or 1 until the wallet redeems. Closed-only books are therefore
win-biased. Treat price-resolved rows as settled regardless of status.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

SLUG_DATE_RE = re.compile(r"(20\d{2})[-_/](\d{1,2})[-_/](\d{1,2})")
TITLE_ISO_RE = re.compile(r"(20\d{2})[-_/](\d{1,2})[-_/](\d{1,2})")
TITLE_MDY_RE = re.compile(
    r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|"
    r"Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b",
    re.I,
)
MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}
MIN_YEAR = 2020
MAX_YEAR = 2032


def _aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _valid_year(y: int) -> bool:
    return MIN_YEAR <= y <= MAX_YEAR


def parse_ymd(y: int, m: int, d: int) -> datetime | None:
    try:
        if not _valid_year(int(y)):
            return None
        return datetime(int(y), int(m), int(d), tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_event_date(row: Any, *, allow_timestamp: bool = False) -> datetime | None:
    """Event date from endDate or slug/title. Timestamp is opt-in only.

    Redeemed winners get a fresh `timestamp` (fill/redeem time) while unredeemed
    losers often have none. Using timestamp for last-Nd windows therefore looks
    like 100% winners. Never use it for recency / grading windows.
    """
    end_raw = row.get("endDate") if hasattr(row, "get") else None
    if end_raw is not None and str(end_raw).strip() not in ("", "nan", "None", "NaT"):
        dt = pd.to_datetime(end_raw, errors="coerce", utc=True)
        if pd.notna(dt) and _valid_year(int(dt.year)):
            return _aware(dt.to_pydatetime())

    for key in ("eventSlug", "slug", "title"):
        text = str(row.get(key) if hasattr(row, "get") else "") or ""
        m = SLUG_DATE_RE.search(text) if key != "title" else TITLE_ISO_RE.search(text)
        if m:
            parsed = parse_ymd(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            if parsed:
                return parsed
        if key == "title":
            m2 = TITLE_MDY_RE.search(text)
            if m2:
                mon = MONTHS.get(m2.group(1).lower()[:3], 0) or MONTHS.get(m2.group(1).lower())
                if mon:
                    parsed = parse_ymd(int(m2.group(3)), int(mon), int(m2.group(2)))
                    if parsed:
                        return parsed

    if not allow_timestamp:
        return None
    ts = row.get("timestamp") if hasattr(row, "get") else None
    if ts is None or str(ts).strip() in ("", "nan", "None"):
        return None
    try:
        val = float(ts)
    except (TypeError, ValueError):
        return None
    if val > 1e12:
        val /= 1000.0
    if val < 1e9:
        return None
    dt = datetime.fromtimestamp(val, tz=timezone.utc)
    if _valid_year(dt.year) and dt.year > 1971:
        return dt
    return None


def is_price_resolved(cur_price: float, lo: float = 0.01, hi: float = 0.99) -> bool:
    try:
        p = float(cur_price)
    except (TypeError, ValueError):
        return False
    return p <= lo or p >= hi


def is_redeemable_flag(val: Any) -> bool:
    if isinstance(val, bool):
        return val
    if val is None:
        return False
    return str(val).strip().lower() in ("true", "1", "yes")


def classify_submarket(row: Any) -> str:
    """Granular book type: Moneyline, Spread, Total, Draw, Futures, Map/Game, Other."""
    title = str(row.get("title") if hasattr(row, "get") else "") or ""
    slug = str(row.get("slug") if hasattr(row, "get") else "") or ""
    event = str(row.get("eventSlug") if hasattr(row, "get") else "") or ""
    comb = f"{title} {slug} {event}".lower()
    t = title.lower()

    if "draw" in comb or t.startswith("will ") and " end in a draw" in t:
        return "Draw"
    if "spread" in comb or "(+" in title or "(-" in title or "-spread-" in slug.lower():
        return "Spread"
    if (
        "o/u" in t
        or " over " in t
        or " under " in t
        or "total" in t
        or "-total-" in slug.lower()
        or "o-u-" in slug.lower()
    ):
        return "Total"
    if any(x in t for x in ("win the", "champion", "mvp", "award", "draft", " to make ", "qualify")):
        return "Futures"
    if any(x in t for x in ("map ", "game 1", "game 2", "game 3", "game 4", "game 5")) or "-map-" in slug.lower():
        return "Map / Game"
    if any(x in t for x in ("player", "points", "rebounds", "assists", "goalscorer", "anytime")):
        return "Player Prop"
    return "Moneyline"


def sport_family(sport: str) -> str:
    s = str(sport or "")
    if s.startswith("SOCCER") or "UCL" in s:
        return "Soccer"
    if s in ("ESPORTS",):
        return "Esports"
    if s == "POLITICS":
        return "Politics"
    if s == "OTHER":
        return "Other"
    if s == "TENNIS":
        return "Tennis"
    return s or "Other"


def play_label(title: str, side: str, sport: str, submarket: str) -> str:
    t = (title or "").strip() or "(untitled)"
    return f"{t} · {side} · {sport_family(sport)} · {submarket}"


def attach_event_dates(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    dates = [parse_event_date(row) for row in out.to_dict("records")]
    out["event_dt"] = pd.to_datetime(dates, utc=True, errors="coerce")
    return out


def mark_resolved(df: pd.DataFrame) -> pd.DataFrame:
    """curPrice 0/1 OR redeemable=true counts as settled, regardless of status."""
    out = df.copy()
    if "curPrice" not in out.columns:
        out["curPrice"] = np.nan
    out["curPrice"] = pd.to_numeric(out["curPrice"], errors="coerce")
    price_res = out["curPrice"].apply(lambda p: is_price_resolved(float(p) if pd.notna(p) else 0.5))
    if "redeemable" in out.columns:
        red = out["redeemable"].map(is_redeemable_flag)
        out["is_resolved"] = price_res | red.fillna(False)
    else:
        out["is_resolved"] = price_res
    return out


def dashboard_pnl(df: pd.DataFrame) -> pd.Series:
    """Polymarket profile PnL: realizedPnl + cashPnl (includes unredeemed losers)."""
    realized = pd.to_numeric(df.get("realizedPnl", 0), errors="coerce").fillna(0.0)
    cash = pd.to_numeric(df.get("cashPnl", 0), errors="coerce").fillna(0.0)
    return realized + cash


def cost_basis(df: pd.DataFrame) -> pd.Series:
    bought = pd.to_numeric(df.get("totalBought", 0), errors="coerce").fillna(0.0)
    px = pd.to_numeric(df.get("avgPrice", 0), errors="coerce").fillna(0.0)
    initial = pd.to_numeric(df.get("initialValue", 0), errors="coerce").fillna(0.0)
    cost = bought * px
    return cost.where(cost > 0, initial)
