#!/usr/bin/env python3
"""30-day would-have take-book tape.

Which plays WOULD the live rule have taken, and what did those tickets
do at VWAP+2¢ hold-to-resolution?

Source of truth is Postgres desk_unique_books (API → desk_fills → books).
Trader CSVs are not the live book. If a wallet is unresolved or has no
resolved tape, they are blocked — not zero-filled.

PnL is unit $100 at their VWAP + 2¢.

Writes:
  pnl_analysis/output/would_have_30d.json
  pnl_analysis/WOULD_HAVE_30D.md
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from asof_fullbook_backtest import (  # noqa: E402
    TRUSTED,
    asof_stat,
    collect_plays,
    strategy_masks,
)
from copy_roster import load_universe  # noqa: E402
from desk_db import connect, db_available, fetch_unique_books, list_unresolved  # noqa: E402
from desk_tape import books_to_markets_df  # noqa: E402
from run_full_pipeline import OUTPUT_DIR  # noqa: E402
from take_book_bankroll import FLAT_STAKE, take_mask  # noqa: E402
from trader_display import english_name  # noqa: E402

PLAYS_CSV = OUTPUT_DIR / "asof_fullbook_plays.csv"
OUT = OUTPUT_DIR / "would_have_30d.json"
MD = Path(__file__).resolve().parent / "WOULD_HAVE_30D.md"
WINDOW_DAYS = 30


def _load_trusted() -> list[dict[str, Any]]:
    """Books to score: copy-focus first, then the historical trusted take list.

    Would-have is the *rule* on resolved tape, not only whoever is live tonight.
    """
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    uni = load_universe()
    # Product would-have = current live + the historical trusted take list.
    # Watch/scout stay off this tape (discovery, not what we would have copied).
    for t in uni.get("live") or []:
        w = str(t.get("wallet") or "").lower()
        if not w or w in seen:
            continue
        seen.add(w)
        out.append(t)
    if TRUSTED.exists():
        try:
            for t in json.loads(TRUSTED.read_text(encoding="utf-8")).get("trusted") or []:
                w = str(t.get("wallet") or "").lower()
                if not w or w in seen:
                    continue
                seen.add(w)
                out.append(t)
        except Exception:
            pass
    return out


def _db_loader(wanted: set[str]):
    """Load resolved unique books for one wallet from Postgres. No CSV fallback."""

    def loader(wallet: str, username: str) -> pd.DataFrame:
        w = (wallet or "").lower()
        if w not in wanted:
            return pd.DataFrame()
        try:
            with connect() as conn:
                books = fetch_unique_books(conn, [w])
        except Exception as exc:
            print(f"[would-have] db loader {username}: {exc}")
            return pd.DataFrame()
        return books_to_markets_df(books)

    return loader


def load_plays(rebuild: bool) -> tuple[pd.DataFrame, str]:
    trusted = _load_trusted()
    if not trusted:
        return pd.DataFrame(), "no trusted/live books"
    if db_available():
        wanted = {str(t.get("wallet") or "").lower() for t in trusted if t.get("wallet")}
        df = collect_plays(trusted, loader=_db_loader(wanted))
        if df is None or df.empty:
            return pd.DataFrame(), "postgres unique books empty or below as-of warmup"
        return df, f"postgres desk_unique_books ({len(trusted)} wallets, {len(df)} as-of plays)"
    return pd.DataFrame(), "DATABASE_URL missing or Postgres unreachable — no CSV fallback"


def equity_curve(sub: pd.DataFrame) -> list[dict[str, Any]]:
    if sub.empty:
        return []
    ordered = sub.sort_values("end_dt")
    running = 0.0
    out: list[dict[str, Any]] = []
    for r in ordered.itertuples(index=False):
        pnl = float(getattr(r, "pnl_2c", 0.0) or 0.0)
        running += pnl
        out.append({
            "end": pd.Timestamp(r.end_dt).date().isoformat(),
            "play": str(getattr(r, "title", "") or "")[:120],
            "username": str(r.username),
            "won": bool(r.won),
            "pnl_2c": round(pnl, 2),
            "equity": round(running, 2),
            "fill": round(min(max(float(r.entry) + 0.02, 0.02), 0.98), 3),
        })
    return out


def trader_block(name: str, wallet: str, grp: pd.DataFrame) -> dict[str, Any]:
    st = asof_stat(grp, 0.02)
    curve = equity_curve(grp)
    return {
        "username": name,
        "wallet": wallet,
        "display_name": english_name(name, wallet),
        "n": st["n"],
        "wins": st["wins"],
        "losses": st["losses"],
        "win_rate": st["win_rate"],
        "roi_2c": st["roi"],
        "pnl_2c": st["unit_pnl"],
        "max_dd": st["max_dd"],
        "sharpe_daily_roi": st["sharpe_daily_roi"],
        "first": st["first"],
        "last": st["last"],
        "equity_curve": curve,
        "equity_end": curve[-1]["equity"] if curve else 0.0,
        "source": "as-of take rule, VWAP+2¢, hold-to-resolution",
    }


def write_markdown(payload: dict[str, Any]) -> str:
    book = payload.get("book") or {}
    blocked = payload.get("blocked") or []
    lines = [
        "# 30-day would-have take book",
        "",
        "This is **not** a live fill tape and **not** invented PnL. It is the as-of "
        "Q60 + sport + 2× size + 10–88¢ + no NFL rule, applied to resolved unique "
        "books in Postgres (`desk_unique_books`, fed by Polymarket activity/trades). "
        "Fill = their VWAP + 2¢. Stake = $100.",
        "",
        f"Window: last **{payload.get('window_days')}** days of resolved tape ending "
        f"**{payload.get('as_of')}**"
        + (f" (wall clock {payload.get('wall_clock')})" if payload.get("wall_clock") else "")
        + f". Source: `{payload.get('source')}`.",
        "",
        "## How to read the table",
        "",
        "- **n** = tickets the rule would have taken (resolved in-window).",
        "- **WR / ROI +2¢ / PnL** = hold-to-resolution at VWAP+2¢, flat $100.",
        "- **Equity** = cumulative unit PnL in date order. Empty curve = no would-have prints.",
        "- A trader with **blocked** status is unresolved or has no honest tape — we do not zero-fill them.",
        "- This is *would have*, not *did fill*. Live CLOB ask can still reject a ticket.",
        "",
        "## Book",
        "",
        f"n={book.get('n')} · WR {book.get('win_rate')}% · ROI +2¢ {book.get('roi')}% · "
        f"PnL ${book.get('unit_pnl')} · max DD ${book.get('max_dd')}",
        "",
        "| Trader | n | WR | ROI +2¢ | PnL $ | Max DD | Last |",
        "|--------|--:|---:|--------:|------:|-------:|------|",
    ]
    for t in payload.get("by_trader") or []:
        lines.append(
            f"| {t.get('display_name') or t['username']} | {t['n']} | {t['win_rate']}% | "
            f"{t['roi_2c']}% | {t['pnl_2c']} | {t['max_dd']} | {t.get('last') or '—'} |"
        )
    if blocked:
        lines += ["", "## Blocked (no honest tape)", ""]
        for b in blocked:
            lines.append(f"- {b.get('display_name') or b.get('username')}: {b.get('why')}")
    lines += [
        "",
        "## Plays the rule would have taken",
        "",
        "| Date | Trader | Play | Won | Fill | PnL |",
        "|------|--------|------|:---:|-----:|----:|",
    ]
    for p in payload.get("plays") or []:
        lines.append(
            f"| {str(p.get('end'))[:10]} | {p.get('display_name') or p.get('username')} | "
            f"{(p.get('play') or '')[:70]} | {'Y' if p.get('won') else 'N'} | "
            f"{p.get('fill')} | {p.get('pnl_2c')} |"
        )
    if not (payload.get("plays") or []):
        lines.append("| — | — | *No resolved take-rule prints in this window* | — | — | — |")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rebuild", action="store_true", help="Ignored; tape always comes from Postgres")
    parser.add_argument("--days", type=int, default=WINDOW_DAYS)
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    df, source = load_plays(args.rebuild)
    blocked: list[dict[str, Any]] = []
    uni = load_universe()
    live_names = {str(t.get("username") or ""): str(t.get("wallet") or "") for t in (uni.get("live") or [])}

    if df.empty:
        payload = {
            "generated_at": now.isoformat(),
            "as_of": now.date().isoformat(),
            "window_days": args.days,
            "source": source,
            "blocked_reason": (
                "No as-of play tape in Postgres. Run `npm run ingest:live` "
                "(activity/trades → desk_fills → desk_unique_books). Unresolved "
                "names are flagged, not zero-filled. CSVs are not the live book."
            ),
            "book": asof_stat(pd.DataFrame(), 0.02),
            "by_trader": [],
            "plays": [],
            "equity_curve": [],
            "blocked": [
                {"username": n, "wallet": w, "display_name": english_name(n, w), "why": source}
                for n, w in live_names.items()
            ],
            "invented": False,
        }
        OUT.write_text(json.dumps(payload, indent=2, default=str, ensure_ascii=False), encoding="utf-8")
        MD.write_text(write_markdown(payload), encoding="utf-8")
        print(f"[would-have] BLOCKED {source}")
        return 0

    if "lane_ok" in df.columns and "q" in df.columns:
        mask = take_mask(df)
    else:
        masks = strategy_masks(df)
        mask = masks.get("asof_live_q60_sport_rel2", pd.Series(False, index=df.index))
    take_all = df.loc[mask].copy()
    # Wall-clock last N days of the live stream (not last N days of a stale tape).
    tape_end = pd.Timestamp(now)
    cut = tape_end - pd.Timedelta(days=args.days)
    take = take_all[take_all["end_dt"] >= cut].sort_values("end_dt") if not take_all.empty else take_all

    wallets = {}
    if "wallet" in take.columns:
        for r in take.itertuples(index=False):
            wallets[str(r.username)] = str(getattr(r, "wallet", "") or "")
    wallets.update(live_names)

    by_trader: list[dict[str, Any]] = []
    seen: set[str] = set()
    if not take.empty:
        for name, grp in take.groupby("username"):
            seen.add(str(name))
            by_trader.append(trader_block(str(name), wallets.get(str(name), ""), grp))
    by_trader.sort(key=lambda r: (-r["n"], str(r["username"])))

    unresolved_names: set[str] = set()
    try:
        with connect(require=False) as conn:
            if conn is not None:
                for u in list_unresolved(conn):
                    unresolved_names.add(str(u.get("username") or ""))
                    blocked.append({
                        "username": u.get("username"),
                        "wallet": "",
                        "display_name": u.get("display_name") or english_name(u.get("username"), None),
                        "why": f"unresolved wallet: {u.get('unresolved_reason') or 'no proxy'}",
                    })
    except Exception as exc:
        print(f"[would-have] unresolved lookup: {exc}")

    for name, wallet in live_names.items():
        if name in seen or name in unresolved_names:
            continue
        why = "no take-rule prints in window" if wallet else "unresolved wallet — not zero-filled"
        if not wallet:
            why = "unresolved wallet — not zero-filled"
        blocked.append({
            "username": name,
            "wallet": wallet,
            "display_name": english_name(name, wallet),
            "why": why,
        })

    book = asof_stat(take, 0.02)
    curve = equity_curve(take)
    plays: list[dict[str, Any]] = []
    for row in curve:
        row["display_name"] = english_name(row.get("username"), wallets.get(str(row.get("username") or ""), ""))
        plays.append(row)

    payload = {
        "generated_at": now.isoformat(),
        "as_of": pd.Timestamp(tape_end).date().isoformat(),
        "wall_clock": now.date().isoformat(),
        "window_days": args.days,
        "window_start": pd.Timestamp(cut).date().isoformat(),
        "source": source,
        "rule": "asof_live_q60_sport_rel2 · VWAP+2¢ · $100 · hold-to-resolution",
        "invented": False,
        "book": book,
        "by_trader": by_trader,
        "plays": plays,
        "equity_curve": [{"t": p["end"], "equity": p["equity"], "pnl": p["pnl_2c"]} for p in plays],
        "blocked": blocked,
        "stake": FLAT_STAKE,
        "how_to_read": (
            "n is tickets the live take rule would have taken in the last 30 "
            "wall-clock days of resolved unique-book tape in Postgres. "
            "ROI/PnL are unit $100 at VWAP+2¢. Blocked = unresolved or no tape, not 0-0."
        ),
        "tape": "postgres",
    }
    OUT.write_text(json.dumps(payload, indent=2, default=str, ensure_ascii=False), encoding="utf-8")
    MD.write_text(write_markdown(payload), encoding="utf-8")
    print(
        f"[would-have] n={book.get('n')} WR={book.get('win_rate')} "
        f"ROI+2c={book.get('roi')} traders={len(by_trader)} blocked={len(blocked)} src={source}"
    )
    print(f"[would-have] wrote {OUT} + {MD}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
