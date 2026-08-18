#!/usr/bin/env python3
"""Live-copy gates: unique ROI, extra_watch never-live, no-csv skip."""
from __future__ import annotations

from copy_roster import classify_trader


def _row(**overrides: object) -> dict:
    base: dict = {
        "username": "TestBook",
        "wallet": "0xabc",
        "lane": "take_book",
        "take_book": True,
        "recency_band": "HOT",
        "our": {
            "win_rate": 55.0,
            "median_stake": 4000.0,
            "roi": 12.0,
            "events": 200,
            "last_60d_roi": 8.0,
            "last_60d_n": 40,
            "last_30d_n": 20,
        },
        "book": {"closed": 400, "rows": 420},
        "polydata": {"trades": 5000},
        "accuracy": {"matched": True},
    }
    base.update(overrides)
    return base


def test_live_ok() -> None:
    out = classify_trader(_row(), {})
    assert out["bucket"] == "live", out


def test_extra_watch_never_live() -> None:
    out = classify_trader(_row(username="SDTrading", wallet="0x16bb"), {"0x16bb": "watch"})
    assert out["bucket"] == "watch", out
    assert "extra_watch_never_live" in out["reasons"]


def test_low_unique_roi_benches_take_book() -> None:
    row = _row()
    row["our"] = {**row["our"], "roi": 1.5}  # type: ignore[dict-item]
    out = classify_trader(row, {})
    assert out["bucket"] == "bench", out
    assert any("unique_roi" in r for r in out["reasons"])


def test_mentionmarket_hard_skip() -> None:
    out = classify_trader(_row(username="mentionmarket", wallet="0xc3ac"), {})
    assert out["bucket"] == "skip", out


def test_no_csv_roster_skipped() -> None:
    out = classify_trader(
        _row(
            username="007theone1",
            wallet="0x1f71",
            lane="",
            take_book=False,
            recency_band="UNKNOWN",
            our={"win_rate": 0.0, "median_stake": 0.0, "roi": None, "events": 0},
            book={"closed": 0, "rows": 0},
            accuracy={"matched": False},
        ),
        {},
    )
    assert out["bucket"] == "skip", out
    assert "no_csv_book" in out["reasons"]
    assert out["refresh"] is False


def test_extra_watch_no_csv_still_refresh() -> None:
    out = classify_trader(
        _row(
            username="NewWatch",
            wallet="0xfeed",
            lane="",
            take_book=False,
            recency_band="UNKNOWN",
            our={"win_rate": 0.0, "median_stake": 0.0, "roi": None, "events": 0},
            book={"closed": 0, "rows": 0},
            accuracy={"matched": False},
        ),
        {"0xfeed": "watch"},
    )
    assert out["bucket"] == "watch", out
    assert out["refresh"] is True


def test_polydata_bot_class_does_not_skip_joinable_book() -> None:
    """0x8a3a is Polydata BOT at 17 tpd — still $100 live if unique gates pass."""
    out = classify_trader(
        _row(
            market_maker=True,
            polydata={"trades": 3187, "trades_per_day": 17.6, "bot_class": "BOT"},
        ),
        {},
    )
    assert out["bucket"] == "live", out
    assert "market_maker" not in out["reasons"]


def test_quiet_30d_benches_take_book() -> None:
    row = _row()
    row["our"] = {**row["our"], "last_30d_n": 1}  # type: ignore[dict-item]
    out = classify_trader(row, {})
    assert out["bucket"] == "bench", out
    assert any("quiet_30d" in r for r in out["reasons"])


if __name__ == "__main__":
    tests = [
        test_live_ok,
        test_extra_watch_never_live,
        test_low_unique_roi_benches_take_book,
        test_mentionmarket_hard_skip,
        test_no_csv_roster_skipped,
        test_extra_watch_no_csv_still_refresh,
        test_polydata_bot_class_does_not_skip_joinable_book,
        test_quiet_30d_benches_take_book,
    ]
    for fn in tests:
        fn()
        print(f"  ok {fn.__name__}")
    print(f"[OK] {len(tests)} copy-roster gates")
