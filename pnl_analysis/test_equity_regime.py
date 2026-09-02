#!/usr/bin/env python3
from equity_regime import detect_regime, equity_points_from_monthly


def test_thin_without_analysis() -> None:
    out = detect_regime(None)
    assert out["regime"] == "thin"
    assert out["last_30d_n"] == 0


def test_hot_regime() -> None:
    out = detect_regime({
        "overall_roi": 4.0,
        "last_30d": {"roi": 12.0, "n": 40},
        "monthly_pnl": {"2026-06": 100.0, "2026-07": 200.0},
    })
    assert out["regime"] == "hot"
    assert out["last_30d_n"] == 40


def test_turnaround_after_red_months() -> None:
    out = detect_regime({
        "overall_roi": 1.0,
        "last_30d": {"roi": 14.0, "n": 40},
        "monthly_pnl": {"2026-04": -50.0, "2026-05": -20.0, "2026-06": 80.0},
    })
    assert out["regime"] == "turnaround"


def test_bleeding() -> None:
    out = detect_regime({
        "overall_roi": 6.0,
        "last_30d": {"roi": -12.0, "n": 20},
        "monthly_pnl": {"2026-07": -100.0},
    })
    assert out["regime"] == "bleeding"


def test_equity_points_are_cumulative() -> None:
    pts = equity_points_from_monthly({"2026-01": 10.0, "2026-02": -4.0, "2026-03": 6.0})
    assert [p["equity"] for p in pts] == [10.0, 6.0, 12.0]


if __name__ == "__main__":
    for fn in [
        test_thin_without_analysis,
        test_hot_regime,
        test_turnaround_after_red_months,
        test_bleeding,
        test_equity_points_are_cumulative,
    ]:
        fn()
        print(f"  ok {fn.__name__}")
    print("[OK] equity_regime")
