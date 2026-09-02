/**
 * Drizzle table defs for the copy-desk live tape.
 *
 * Source of truth is Postgres (npm run db:init → scripts/init-db.sql).
 * These pgTable defs match that SQL so the desk never treats trader CSVs
 * as the live book. Do not run drizzle-kit push against elite_* tables.
 */
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const deskFills = pgTable(
  "desk_fills",
  {
    wallet: text("wallet").notNull(),
    eventTimestamp: timestamp("event_timestamp", { withTimezone: true }).notNull(),
    conditionId: text("condition_id").notNull(),
    side: text("side").notNull(),
    price: doublePrecision("price").notNull(),
    size: doublePrecision("size").notNull(),
    transactionHash: text("transaction_hash").notNull().default(""),
    username: text("username").notNull().default(""),
    marketId: text("market_id").notNull().default(""),
    asset: text("asset").notNull().default(""),
    outcome: text("outcome").notNull().default(""),
    title: text("title").notNull().default(""),
    slug: text("slug").notNull().default(""),
    eventSlug: text("event_slug").notNull().default(""),
    usdcSize: doublePrecision("usdc_size").notNull().default(0),
    eventType: text("event_type").notNull().default("TRADE"),
    sport: text("sport").notNull().default(""),
    marketType: text("market_type").notNull().default(""),
    source: text("source").notNull().default("activity"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.wallet, t.eventTimestamp, t.conditionId, t.side, t.price, t.size, t.transactionHash],
    }),
    index("idx_desk_fills_wallet").on(t.wallet),
    index("idx_desk_fills_wallet_ts").on(t.wallet, t.eventTimestamp),
    index("idx_desk_fills_ts").on(t.eventTimestamp),
    index("idx_desk_fills_condition").on(t.conditionId),
    index("idx_desk_fills_username").on(t.username),
    index("idx_desk_fills_slug").on(t.slug),
    index("idx_desk_fills_market").on(t.marketId),
  ],
);

export const deskWallets = pgTable(
  "desk_wallets",
  {
    username: text("username").primaryKey(),
    displayName: text("display_name").notNull().default(""),
    wallet: text("wallet"),
    eoaWallet: text("eoa_wallet"),
    source: text("source").notNull().default(""),
    resolved: boolean("resolved").notNull().default(false),
    unresolvedReason: text("unresolved_reason"),
    lastResolvedAt: timestamp("last_resolved_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_desk_wallets_wallet").on(t.wallet),
    index("idx_desk_wallets_resolved").on(t.resolved),
  ],
);

export const deskIngestCursors = pgTable("desk_ingest_cursors", {
  wallet: text("wallet").primaryKey(),
  username: text("username").notNull().default(""),
  lastSeenTs: timestamp("last_seen_ts", { withTimezone: true }),
  lastSeenUnix: bigint("last_seen_unix", { mode: "number" }),
  lastFetchAt: timestamp("last_fetch_at", { withTimezone: true }),
  lastOk: boolean("last_ok"),
  lastError: text("last_error"),
  fillsInserted: integer("fills_inserted").notNull().default(0),
  source: text("source").notNull().default("activity"),
});

export const deskMarkets = pgTable(
  "desk_markets",
  {
    conditionId: text("condition_id").primaryKey(),
    title: text("title").notNull().default(""),
    slug: text("slug").notNull().default(""),
    eventSlug: text("event_slug").notNull().default(""),
    endDate: timestamp("end_date", { withTimezone: true }),
    closed: boolean("closed").notNull().default(false),
    winningOutcome: text("winning_outcome"),
    outcomePrices: text("outcome_prices"),
    sport: text("sport").notNull().default(""),
    marketType: text("market_type").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_desk_markets_end").on(t.endDate),
    index("idx_desk_markets_closed").on(t.closed),
  ],
);

export const deskUniqueBooks = pgTable(
  "desk_unique_books",
  {
    wallet: text("wallet").notNull(),
    conditionId: text("condition_id").notNull(),
    outcome: text("outcome").notNull(),
    username: text("username").notNull().default(""),
    title: text("title").notNull().default(""),
    slug: text("slug").notNull().default(""),
    eventSlug: text("event_slug").notNull().default(""),
    sport: text("sport").notNull().default(""),
    marketType: text("market_type").notNull().default(""),
    submarket: text("submarket").notNull().default(""),
    entryPrice: doublePrecision("entry_price").notNull(),
    cost: doublePrecision("cost").notNull(),
    size: doublePrecision("size").notNull().default(0),
    won: boolean("won"),
    resolved: boolean("resolved").notNull().default(false),
    endDate: timestamp("end_date", { withTimezone: true }),
    firstFillAt: timestamp("first_fill_at", { withTimezone: true }),
    lastFillAt: timestamp("last_fill_at", { withTimezone: true }),
    fillCount: integer("fill_count").notNull().default(0),
    holdPnl: doublePrecision("hold_pnl"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.wallet, t.conditionId, t.outcome] }),
    index("idx_desk_books_wallet").on(t.wallet),
    index("idx_desk_books_wallet_end").on(t.wallet, t.endDate),
    index("idx_desk_books_username").on(t.username),
    index("idx_desk_books_end").on(t.endDate),
    index("idx_desk_books_resolved").on(t.resolved),
  ],
);

export const deskIngestRuns = pgTable("desk_ingest_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ok: boolean("ok"),
  walletsOk: integer("wallets_ok").notNull().default(0),
  walletsUnresolved: integer("wallets_unresolved").notNull().default(0),
  fillsInserted: integer("fills_inserted").notNull().default(0),
  error: text("error"),
});
