#!/usr/bin/env python3
"""Would-have helpers do not invent a 0-0 book when tape is missing."""
from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd

from asof_fullbook_backtest import asof_stat
from would_have_30d import equity_curve, trader_block


def test_empty_stat_is_zero_not_a_lie_flag() -> None:
    st = asof_stat(pd.DataFrame(), 0.02)
    assert st["n"] == 0
    assert st["roi"] == 0.0


def test_equity_curve_from_real_rows() -> None:
    df = pd.DataFrame([
        {
            "username": "DLEK",
            "end_dt": datetime(2026, 8, 10, tzinfo=timezone.utc),
            "title": "Will X win?",
            "won": True,
            "entry": 0.50,
            "pnl_2c": 88.46,
        },
        {
            "username": "DLEK",
            "end_dt": datetime(2026, 8, 12, tzinfo=timezone.utc),
            "title": "Will Y win?",
            "won": False,
            "entry": 0.40,
            "pnl_2c": -100.0,
        },
    ])
    curve = equity_curve(df)
    assert len(curve) == 2
    assert curve[0]["equity"] == 88.46
    assert curve[1]["equity"] == -11.54


def test_trader_block_display_name() -> None:
    df = pd.DataFrame([
        {
            "username": "0x8a3aB8120807bD64a3De48695110e390fa2ceB9a",
            "end_dt": datetime(2026, 8, 10, tzinfo=timezone.utc),
            "title": "ML",
            "won": True,
            "entry": 0.50,
            "q": 70,
            "rel": 3.0,
            "pnl_2c": 88.46,
        },
    ])
    block = trader_block(
        "0x8a3aB8120807bD64a3De48695110e390fa2ceB9a",
        "0x8a3ab8120807bd64a3de48695110e390fa2ceb9a",
        df,
    )
    assert block["display_name"] == "8a3a"
    assert block["n"] == 1


if __name__ == "__main__":
    test_empty_stat_is_zero_not_a_lie_flag()
    test_equity_curve_from_real_rows()
    test_trader_block_display_name()
    print("[OK] would_have_30d helpers")
