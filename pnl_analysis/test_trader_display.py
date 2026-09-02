#!/usr/bin/env python3
from trader_display import english_name, fix_mojibake, is_auto_pseudonym


def test_human_username_kept() -> None:
    assert english_name("Supah9ga", "0x57cd939930fd119067ca9dc42b22b3e15708a0fb") == "Supah9ga"


def test_wallet_username_becomes_book_label() -> None:
    name = english_name(
        "0x8a3aB8120807bD64a3De48695110e390fa2ceB9a",
        "0x8a3ab8120807bd64a3de48695110e390fa2ceb9a",
    )
    assert name == "8a3a"
    assert "0x8a3aB812" not in name


def test_hvab_alias() -> None:
    assert english_name("HVAB", "0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8") == "HVAB"


def test_mojibake_undone() -> None:
    raw = "40" + "\u00e2\u0080\u0093" + "12k"
    fixed = fix_mojibake(raw)
    assert "\ufffd" not in fixed
    assert "40" in fixed and "12k" in fixed
    assert fix_mojibake("ok\ufffd") == "ok"


def test_auto_pseudonym() -> None:
    assert is_auto_pseudonym("Happy-Tiger") is True
    assert is_auto_pseudonym("DLEK") is False


if __name__ == "__main__":
    for fn in [
        test_human_username_kept,
        test_wallet_username_becomes_book_label,
        test_hvab_alias,
        test_mojibake_undone,
        test_auto_pseudonym,
    ]:
        fn()
        print(f"  ok {fn.__name__}")
    print("[OK] trader_display")
