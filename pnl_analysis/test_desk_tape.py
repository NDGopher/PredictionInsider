#!/usr/bin/env python3
"""Unique books from fills — never invent a win or a fill."""
from desk_tape import activity_to_fill, books_to_markets_df, unique_books_from_fills


def _trade(**kwargs):
    base = {
        "type": "TRADE",
        "timestamp": 1_720_000_000,
        "conditionId": "0xcond1",
        "side": "BUY",
        "price": 0.40,
        "size": 100,
        "usdcSize": 40,
        "transactionHash": "0xtx1",
        "outcome": "Yes",
        "title": "Will X win?",
        "slug": "nba-x-y",
        "eventSlug": "nba-x-y",
    }
    base.update(kwargs)
    return base


def test_activity_maps_fill() -> None:
    row = activity_to_fill(
        _trade(),
        username="HVAB",
        wallet="0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8",
        source="activity",
    )
    assert row is not None
    assert row["condition_id"] == "0xcond1"
    assert row["side"] == "BUY"
    assert row["price"] == 0.4
    assert row["size"] == 100


def test_unresolved_not_won() -> None:
    fills = [
        activity_to_fill(
            _trade(),
            username="HVAB",
            wallet="0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8",
            source="activity",
        )
    ]
    books = unique_books_from_fills(
        fills,
        {},
        username="HVAB",
        wallet="0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8",
    )
    assert len(books) == 1
    assert books[0]["resolved"] is False
    assert books[0]["won"] is None
    df = books_to_markets_df(books)
    assert df.empty  # would-have does not invent a result


def test_winner_from_market_not_invented() -> None:
    fills = [
        activity_to_fill(
            _trade(usdcSize=50, price=0.50, size=100),
            username="20D6",
            wallet="0x20d6436849f930584892730c7f96ebb2ac763856",
            source="activity",
        )
    ]
    markets = {
        "0xcond1": {
            "title": "Will X win?",
            "slug": "nba-x-y",
            "event_slug": "nba-x-y",
            "end_date": "2026-08-20T00:00:00+00:00",
            "closed": True,
            "winning_outcome": "Yes",
            "sport": "NBA",
            "market_type": "Moneyline / Match",
        }
    }
    books = unique_books_from_fills(
        fills,
        markets,
        username="20D6",
        wallet="0x20d6436849f930584892730c7f96ebb2ac763856",
    )
    assert books[0]["resolved"] is True
    assert books[0]["won"] is True
    df = books_to_markets_df(books)
    assert len(df) == 1
    assert bool(df.iloc[0]["won"]) is True


def test_hedge_dropped() -> None:
    w = "0x8a3ab8120807bd64a3de48695110e390fa2ceb9a"
    fills = [
        activity_to_fill(_trade(outcome="Yes", transactionHash="0xa"), username="8a3a", wallet=w, source="activity"),
        activity_to_fill(_trade(outcome="No", transactionHash="0xb", price=0.60, usdcSize=60), username="8a3a", wallet=w, source="activity"),
    ]
    books = unique_books_from_fills(fills, {}, username="8a3a", wallet=w)
    assert books == []


def test_player_outcome_resolution() -> None:
    w = "0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8"
    fills = [
        activity_to_fill(
            _trade(outcome="Jie Cui", title="Cui vs X", slug="atp-cui-x"),
            username="HVAB",
            wallet=w,
            source="activity",
        )
    ]
    markets = {
        "0xcond1": {
            "title": "Cui vs X",
            "slug": "atp-cui-x",
            "end_date": "2026-08-20T00:00:00+00:00",
            "closed": True,
            "winning_outcome": "Jie Cui",
            "sport": "TENNIS",
        }
    }
    books = unique_books_from_fills(fills, markets, username="HVAB", wallet=w)
    assert books[0]["resolved"] is True
    assert books[0]["won"] is True


def test_redeem_alone_does_not_resolve() -> None:
    """REDEEM exists only on wins — must not become the would-have tape."""
    w = "0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8"
    fills = [
        activity_to_fill(_trade(), username="HVAB", wallet=w, source="activity"),
        activity_to_fill(
            _trade(type="REDEEM", transactionHash="0xred", usdcSize=100, price=0),
            username="HVAB",
            wallet=w,
            source="activity",
        ),
    ]
    books = unique_books_from_fills(fills, {}, username="HVAB", wallet=w)
    assert len(books) == 1
    assert books[0]["resolved"] is False
    assert books[0]["won"] is None


def test_skip_row_without_condition() -> None:
    row = activity_to_fill(
        {"type": "TRADE", "timestamp": 1, "price": 0.5, "size": 1},
        username="x",
        wallet="0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8",
        source="activity",
    )
    assert row is None


if __name__ == "__main__":
    test_activity_maps_fill()
    test_unresolved_not_won()
    test_winner_from_market_not_invented()
    test_hedge_dropped()
    test_player_outcome_resolution()
    test_redeem_alone_does_not_resolve()
    test_skip_row_without_condition()
    print("[OK] desk_tape")
