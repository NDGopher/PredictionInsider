#!/usr/bin/env python3
"""Auto-discovery of a new username without a manual roster edit."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from auto_discover import (
    discover_elites,
    enqueue_discovered_scouts,
    resolve_candidate,
)


PROXY = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
EOA = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
NEW_NAME = "BrandNewSharp99"


def _passing_sample(_wallet: str) -> dict:
    return {
        "sample_closed_rows": 40,
        "sample_resolved_n": 40,
        "sample_open_resolved": 4,
        "sample_pnl": 12000.0,
        "sample_cost": 80000.0,
        "sample_roi": 18.0,
        "sample_dash_roi": 16.0,
        "sample_hold_roi": 14.0,
        "sample_hold_wr": 58.0,
        "closed_only_bias": 2.0,
    }


def _fake_get(url: str, params=None):
    q = (params or {}).get("q") if isinstance(params, dict) else None
    if "leaderboard" in url:
        return [
            {
                "userName": NEW_NAME,
                "proxyWallet": PROXY,
                "userAddress": EOA,
                "pnl": 80_000,
                "vol": 220_000,
                "rank": 4,
            }
        ]
    if "public-search" in url:
        return {
            "profiles": [
                {
                    "name": NEW_NAME,
                    "proxyWallet": PROXY,
                    "userAddress": EOA,
                }
            ]
        }
    if "trades" in url or url.endswith("/activity"):
        return [
            {
                "name": NEW_NAME,
                "proxyWallet": PROXY,
                "userAddress": EOA,
                "usdcSize": 900,
                "size": 900,
            }
            for _ in range(6)
        ]
    if q == "NoWalletGhost":
        return {"profiles": []}
    return []


def test_new_username_auto_scout_without_manual_roster() -> None:
    """Desk fills itself: mocked LB/search/heat → scout. No add-username."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        extra_path = root / "extra_traders.json"
        discovered_path = root / "discovered_candidates.json"
        extra_path.write_text("[]\n", encoding="utf-8")

        payload = discover_elites(
            get_json=_fake_get,
            sample_fn=_passing_sample,
            extra_path=extra_path,
            extra_rows=[],
            discovered_path=discovered_path,
            persist_unresolved_wallets=False,
            apply_scouts=False,
        )
        recs = payload.get("recommended") or []
        assert recs, payload
        hit = recs[0]
        assert hit["username"] == NEW_NAME
        assert hit["wallet"] == PROXY
        assert hit["wallet"] != EOA
        assert hit["resolved"] is True

        extra: list[dict] = []
        added = enqueue_discovered_scouts(payload, extra, extra_path=extra_path)
        assert len(added) == 1
        assert extra[0]["username"] == NEW_NAME
        assert extra[0]["status"] == "scout"
        assert extra[0]["wallet"] == PROXY
        written = json.loads(extra_path.read_text(encoding="utf-8"))
        assert written[0]["username"] == NEW_NAME
        assert "add-username" not in json.dumps(written)
        # Second apply is a no-op — already on the auto roster, still no manual edit.
        again = enqueue_discovered_scouts(payload, written, extra_path=extra_path)
        assert again == []


def test_unresolved_never_fake_zero() -> None:
    def ghost_get(url: str, params=None):
        if "leaderboard" in url:
            return [{"userName": "NoWalletGhost", "pnl": 90_000, "vol": 200_000, "rank": 1}]
        if "public-search" in url:
            return {"profiles": []}
        if "trades" in url:
            return []
        return []

    rec = resolve_candidate(
        "NoWalletGhost",
        hinted_proxy=None,
        hinted_eoa=None,
        get_json=ghost_get,
        local_only=False,
    )
    assert rec["resolved"] is False
    assert rec["wallet"] is None
    assert rec["unresolved_reason"]

    with tempfile.TemporaryDirectory() as tmp:
        payload = discover_elites(
            get_json=ghost_get,
            sample_fn=_passing_sample,
            extra_path=Path(tmp) / "extra.json",
            extra_rows=[],
            discovered_path=Path(tmp) / "disc.json",
            persist_unresolved_wallets=False,
        )
        assert payload["recommended"] == []
        assert any(
            (u.get("username") == "NoWalletGhost") for u in (payload.get("unresolved") or [])
        )


def test_proxy_preferred_over_eoa() -> None:
    rec = resolve_candidate(
        NEW_NAME,
        hinted_proxy=PROXY,
        hinted_eoa=EOA,
        get_json=_fake_get,
        local_only=True,
    )
    assert rec["resolved"] is True
    assert rec["wallet"] == PROXY
    assert rec["eoa_wallet"] == EOA


def test_kicked_wallet_not_rescouted() -> None:
    extra = [{"wallet": PROXY, "username": NEW_NAME, "status": "kicked"}]
    with tempfile.TemporaryDirectory() as tmp:
        payload = discover_elites(
            get_json=_fake_get,
            sample_fn=_passing_sample,
            extra_path=Path(tmp) / "extra.json",
            extra_rows=extra,
            discovered_path=Path(tmp) / "disc.json",
            persist_unresolved_wallets=False,
        )
        assert payload["recommended"] == []


if __name__ == "__main__":
    for fn in [
        test_new_username_auto_scout_without_manual_roster,
        test_unresolved_never_fake_zero,
        test_proxy_preferred_over_eoa,
        test_kicked_wallet_not_rescouted,
    ]:
        fn()
        print(f"  ok {fn.__name__}")
    print("[OK] auto_discover")
