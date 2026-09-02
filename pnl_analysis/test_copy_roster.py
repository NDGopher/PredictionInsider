#!/usr/bin/env python3
"""Live-copy gates: Path-B HVAB, scout/stale, unique ROI, no invented books."""
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
            "last_30d_roi": 9.0,
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


def test_extra_watch_pending_until_auto_promote() -> None:
    out = classify_trader(_row(username="SDTrading", wallet="0x16bb"), {"0x16bb": "watch"})
    assert out["bucket"] == "watch", out
    assert "extra_watch_pending_auto_promote" in out["reasons"]


def test_auto_promoted_take_book_can_live() -> None:
    out = classify_trader(_row(username="SDTrading", wallet="0x16bb"), {"0x16bb": "take_book"})
    assert out["bucket"] == "live", out


def test_path_b_hvab_live() -> None:
    elite = {
        "0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8": {
            "username": "HVAB",
            "unique_roi": 15.01,
            "median": 1874.02,
            "active_30d": 175,
        }
    }
    row = _row(
        username="HVAB",
        wallet="0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8",
        take_book=False,
        lane="",
        recency_band="HOT",
        our={
            "win_rate": 81.84,
            "median_stake": 896.4,
            "roi": 10.31,
            "events": 394,
            "last_30d_n": 175,
            "last_30d_roi": 14.44,
            "last_60d_n": 338,
            "last_60d_roi": 11.79,
        },
        book={"closed": 0, "rows": 0},
        accuracy={"matched": False},
    )
    out = classify_trader(row, {"0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8": "watch"}, elite_roster=elite)
    assert out["bucket"] == "live", out
    assert any("path_b_specialist" in r for r in out["reasons"])


def test_vigilant_environment_never_path_b() -> None:
    elite = {
        "0xdbdd": {
            "username": "Vigilant-Environment",
            "unique_roi": 20.0,
            "median": 500.0,
        }
    }
    row = _row(
        username="Vigilant-Environment",
        wallet="0xdbdd",
        our={"win_rate": 80.0, "median_stake": 500.0, "roi": 20.0, "events": 200, "last_30d_n": 40},
    )
    out = classify_trader(row, {}, elite_roster=elite)
    assert "path_b_specialist" not in " ".join(out["reasons"])
    assert out["bucket"] != "live" or out["win_rate"] <= 75


def test_turnaround_last30_overrides_lifetime_roi() -> None:
    row = _row(username="SDTrading", wallet="0x16bb")
    row["our"] = {
        **row["our"],  # type: ignore[dict-item]
        "roi": -1.0,
        "events": 80,
        "last_30d_n": 200,
        "last_30d_roi": 14.0,
    }
    out = classify_trader(row, {"0x16bb": "take_book"})
    assert out["bucket"] == "live", out
    assert any("turnaround_last30" in r for r in out["reasons"])


def test_low_unique_roi_benches_take_book() -> None:
    row = _row()
    row["our"] = {**row["our"], "roi": 1.5}  # type: ignore[dict-item]
    out = classify_trader(row, {})
    assert out["bucket"] == "bench", out
    assert any("unique_roi" in r for r in out["reasons"])


def test_mentionmarket_hard_skip() -> None:
    out = classify_trader(_row(username="mentionmarket", wallet="0xc3ac"), {})
    assert out["bucket"] == "skip", out


def test_scout_stays_scout() -> None:
    out = classify_trader(
        _row(username="NewScout", wallet="0xfeed", take_book=False, lane="", accuracy={"matched": False}),
        {"0xfeed": "scout"},
    )
    assert out["bucket"] == "scout", out
    assert out["refresh"] is True


def test_stale_auto_bench() -> None:
    row = _row()
    row["days_since_last"] = 120
    out = classify_trader(row, {})
    assert out["bucket"] == "bench", out
    assert any("stale_" in r for r in out["reasons"])


def test_polydata_bot_class_does_not_skip_joinable_book() -> None:
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
        test_extra_watch_pending_until_auto_promote,
        test_auto_promoted_take_book_can_live,
        test_path_b_hvab_live,
        test_vigilant_environment_never_path_b,
        test_turnaround_last30_overrides_lifetime_roi,
        test_low_unique_roi_benches_take_book,
        test_mentionmarket_hard_skip,
        test_scout_stays_scout,
        test_stale_auto_bench,
        test_polydata_bot_class_does_not_skip_joinable_book,
        test_quiet_30d_benches_take_book,
    ]
    for fn in tests:
        fn()
        print(f"  ok {fn.__name__}")
    print(f"[OK] {len(tests)} copy-roster gates")
