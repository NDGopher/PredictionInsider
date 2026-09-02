#!/usr/bin/env python3
from wallet_resolve import normalize_wallet, resolve_username


def test_address_passthrough() -> None:
    rec = resolve_username("0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8", local_only=True)
    assert rec["resolved"] is True
    assert rec["wallet"] == "0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8"
    assert rec["source"] == "address"


def test_profile_slug() -> None:
    rec = resolve_username(
        "0x20D6436849F930584892730C7F96eBB2Ac763856-1768642056357",
        local_only=True,
    )
    assert rec["resolved"] is True
    assert rec["wallet"] == "0x20d6436849f930584892730c7f96ebb2ac763856"


def test_known_label_hvab() -> None:
    rec = resolve_username("HVAB", local_only=True)
    assert rec["resolved"] is True
    assert rec["wallet"] == "0x8546a601f7c7cc3dae7141f20b0e09e42bbf35b8"
    assert rec["display_name"] == "HVAB"


def test_unresolved_flagged() -> None:
    rec = resolve_username("DefinitelyNotARealDeskBook999", local_only=True)
    assert rec["resolved"] is False
    assert rec["wallet"] is None
    assert rec["unresolved_reason"]


def test_gamma_proxy(monkey_get=None) -> None:
    def fake_get(url: str, params=None):
        return {
            "profiles": [
                {
                    "name": "Capman",
                    "proxyWallet": "0xc5b5bbd42624a8f0c8dfa90221913007d8c77e80",
                    "userAddress": "0x1111111111111111111111111111111111111111",
                }
            ]
        }

    rec = resolve_username("Capman", get_json=fake_get, local_only=False)
    # Local roster may already know Capman; either local or gamma is fine.
    assert rec["resolved"] is True
    assert rec["wallet"] == "0xc5b5bbd42624a8f0c8dfa90221913007d8c77e80"


def test_normalize() -> None:
    assert normalize_wallet("not-an-address") is None
    assert normalize_wallet("0x20D6436849F930584892730C7F96eBB2Ac763856") == (
        "0x20d6436849f930584892730c7f96ebb2ac763856"
    )


if __name__ == "__main__":
    test_address_passthrough()
    test_profile_slug()
    test_known_label_hvab()
    test_unresolved_flagged()
    test_gamma_proxy()
    test_normalize()
    print("[OK] wallet_resolve")
