#!/usr/bin/env python3
from rank_plays import edge_cents, fillability, rank_open_plays, rank_score


def _play(**kwargs):
    base = {
        "id": "p",
        "q": 70,
        "rel": 2.5,
        "sport_roi": 12.0,
        "live_ask": 0.54,
        "take_cap": 0.56,
        "sport": "NBA",
        "submarket": "Spread",
        "take": True,
        "valid": True,
        "misses": [],
    }
    base.update(kwargs)
    return base


def test_take_outranks_near_and_skip() -> None:
    take = _play(id="take", q=72, rel=3.1, sport_roi=18, live_ask=0.54, take_cap=0.56, take=True, valid=True)
    near = _play(
        id="near",
        q=52,
        rel=8.0,
        sport_roi=8,
        live_ask=0.87,
        take_cap=0.82,
        take=False,
        valid=False,
        close=True,
        misses=["Q 52 < 60"],
    )
    skip = _play(
        id="skip",
        q=40,
        rel=0.4,
        sport_roi=-5,
        live_ask=0.93,
        take_cap=0.70,
        take=False,
        valid=False,
        misses=["Q", "size", "band"],
        sport="NFL",
    )
    ranked = rank_open_plays([skip, near, take])
    assert [r["id"] for r in ranked] == ["take", "near", "skip"]
    assert ranked[0]["rank"] == 1
    assert ranked[0]["take_lane"] == "TAKE"
    assert ranked[0]["fillable"] is True
    assert "Q 72" in ranked[0]["why_rank"]
    assert ranked[2]["take_lane"] == "SKIP"
    assert ranked[2]["fillable"] is False


def test_edge_and_fillability() -> None:
    room = _play(id="room", live_ask=0.50, take_cap=0.60)
    tight = _play(id="tight", live_ask=0.59, take_cap=0.60)
    assert edge_cents(room) == 10.0
    assert rank_score(room)[0] > rank_score(tight)[0]
    frac, ok, why = fillability(_play(live_ask=0.54, take_cap=0.56, sport="NBA"))
    assert ok is True and frac == 1.0 and why == "fillable"
    frac_nfl, ok_nfl, why_nfl = fillability(_play(sport="NFL"))
    assert ok_nfl is False and frac_nfl == 0.0
    assert "NFL" in why_nfl


def test_dedupe_and_english_why() -> None:
    a = _play(id="dup", q=80, rel=2.0)
    b = _play(id="dup", q=10, rel=1.0)
    ranked = rank_open_plays([a, b])
    assert len(ranked) == 1
    assert "top factor" in ranked[0]["why_rank"]


def test_q_beats_equal_fill_when_size_small() -> None:
    high_q = _play(id="hq", q=90, rel=2.0, sport_roi=6, live_ask=0.50, take_cap=0.52)
    low_q = _play(id="lq", q=40, rel=2.0, sport_roi=6, live_ask=0.50, take_cap=0.52)
    ranked = rank_open_plays([low_q, high_q])
    assert ranked[0]["id"] == "hq"


if __name__ == "__main__":
    for fn in [
        test_take_outranks_near_and_skip,
        test_edge_and_fillability,
        test_dedupe_and_english_why,
        test_q_beats_equal_fill_when_size_small,
    ]:
        fn()
        print(f"  ok {fn.__name__}")
    print("[OK] rank_plays")
