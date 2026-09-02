#!/usr/bin/env python3
from auto_promote import should_auto_live, should_auto_watch, should_demote_live


def test_promote_on_unique_roi() -> None:
    t = {
        "username": "TestBook",
        "wallet": "0xabc",
        "joinable": True,
        "win_rate": 55.0,
        "median_stake": 2000.0,
        "recency": "HOT",
        "unique_roi": 12.0,
        "last_30d_n": 20,
        "last_30d_roi": 8.0,
    }
    ok, why = should_auto_live(t, {"regime": "stable", "last_30d_n": 20}, {"n": 4}, {})
    assert ok, why
    assert "unique_roi" in why


def test_block_take_bleed() -> None:
    t = {
        "username": "BleedBook",
        "wallet": "0xdef",
        "joinable": True,
        "win_rate": 55.0,
        "median_stake": 2000.0,
        "recency": "HOT",
        "unique_roi": 12.0,
        "last_30d_n": 20,
    }
    ok, why = should_auto_live(t, {"regime": "stable"}, {"n": 20, "roi": -3.0}, {})
    assert ok is False
    assert "take_bleed" in why


def test_path_b_excluded() -> None:
    t = {
        "username": "sentrio",
        "wallet": "0xdb83",
        "joinable": True,
        "win_rate": 80.0,
        "median_stake": 500.0,
        "recency": "HOT",
        "unique_roi": 15.0,
        "last_30d_n": 40,
    }
    ok, why = should_auto_live(t, {"regime": "hot"}, {}, {})
    assert ok is False
    assert "excluded" in why


def test_demote_on_deep_take_bleed() -> None:
    drop, why = should_demote_live({"n": 20, "roi": -12.0}, {})
    assert drop is True
    assert "bleed" in why


def test_hold_when_take_thin() -> None:
    drop, why = should_demote_live({"n": 3, "roi": -20.0}, {})
    assert drop is False
    assert why == "hold"


def test_scout_to_watch() -> None:
    ok, why = should_auto_watch({"closed": 80, "win_rate": 56.0, "unique_roi": 6.0})
    assert ok, why


def test_scout_grinder_blocked() -> None:
    ok, why = should_auto_watch({"closed": 80, "win_rate": 97.0, "unique_roi": 2.0})
    assert ok is False
    assert "grinder" in why


if __name__ == "__main__":
    for fn in [
        test_promote_on_unique_roi,
        test_block_take_bleed,
        test_path_b_excluded,
        test_demote_on_deep_take_bleed,
        test_hold_when_take_thin,
        test_scout_to_watch,
        test_scout_grinder_blocked,
    ]:
        fn()
        print(f"  ok {fn.__name__}")
    print("[OK] auto_promote gates")
