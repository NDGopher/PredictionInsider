-- PredictionInsider: create tables used by server (eliteAnalysis + routes).
-- Run automatically when Postgres starts via docker-entrypoint-initdb.d, or run manually once.

-- Elite traders roster (seeded from CURATED_TRADERS)
CREATE TABLE IF NOT EXISTS elite_traders (
  wallet           TEXT PRIMARY KEY,
  username         TEXT NOT NULL DEFAULT '',
  wallet_resolved  BOOLEAN NOT NULL DEFAULT FALSE,
  polymarket_url   TEXT,
  last_analyzed_at TIMESTAMPTZ,
  added_at         TIMESTAMPTZ DEFAULT NOW(),
  notes            TEXT
);

-- Trader profiles (metrics, quality score, tags) — filled by ingest and canonical PNL
CREATE TABLE IF NOT EXISTS elite_trader_profiles (
  wallet         TEXT PRIMARY KEY,
  username       TEXT NOT NULL DEFAULT '',
  computed_at    TIMESTAMPTZ,
  metrics        JSONB NOT NULL DEFAULT '{}',
  tags           TEXT[] NOT NULL DEFAULT '{}',
  quality_score   INTEGER NOT NULL DEFAULT 0
);

-- Per-trade records (from Data API /trades)
CREATE TABLE IF NOT EXISTS elite_trader_trades (
  id                SERIAL,
  wallet            TEXT NOT NULL,
  condition_id      TEXT NOT NULL,
  side              TEXT NOT NULL,
  is_buy            BOOLEAN NOT NULL,
  price             FLOAT NOT NULL,
  size              FLOAT NOT NULL,
  trade_timestamp   TIMESTAMPTZ NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  slug              TEXT NOT NULL DEFAULT '',
  outcome           TEXT NOT NULL DEFAULT '',
  outcome_index     INTEGER NOT NULL DEFAULT 0,
  sport             TEXT NOT NULL DEFAULT '',
  market_type       TEXT NOT NULL DEFAULT '',
  is_longshot       BOOLEAN NOT NULL DEFAULT FALSE,
  is_guarantee      BOOLEAN NOT NULL DEFAULT FALSE,
  transaction_hash  TEXT,
  settled_at        TIMESTAMPTZ,
  settled_outcome   TEXT,
  settled_pnl       FLOAT,
  PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_elite_trader_trades_wallet_tx
  ON elite_trader_trades (wallet, transaction_hash) WHERE transaction_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_elite_trader_trades_wallet ON elite_trader_trades(wallet);
CREATE INDEX IF NOT EXISTS idx_elite_trader_trades_condition ON elite_trader_trades(condition_id);

-- Activity events (TRADE + REDEEM from Data API /activity)
CREATE TABLE IF NOT EXISTS elite_trader_activity (
  id                SERIAL,
  wallet            TEXT NOT NULL,
  condition_id      TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  side              TEXT NOT NULL,
  size              FLOAT NOT NULL,
  usdc_size         FLOAT NOT NULL,
  price             FLOAT NOT NULL,
  outcome_index     INTEGER NOT NULL,
  event_timestamp   TIMESTAMPTZ NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  slug              TEXT NOT NULL DEFAULT '',
  outcome           TEXT NOT NULL DEFAULT '',
  sport             TEXT NOT NULL DEFAULT '',
  market_type       TEXT NOT NULL DEFAULT '',
  transaction_hash  TEXT,
  PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_elite_trader_activity_wallet_tx
  ON elite_trader_activity (wallet, transaction_hash);
CREATE INDEX IF NOT EXISTS idx_elite_trader_activity_wallet ON elite_trader_activity(wallet);
CREATE INDEX IF NOT EXISTS idx_elite_trader_activity_ts ON elite_trader_activity(event_timestamp);

-- Positions cache (eliteAnalysis.initPositionsTable also creates this; harmless IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS elite_trader_positions (
  wallet        TEXT    NOT NULL,
  asset         TEXT    NOT NULL,
  condition_id  TEXT    NOT NULL DEFAULT '',
  avg_price     FLOAT   NOT NULL DEFAULT 0,
  total_bought  FLOAT   NOT NULL DEFAULT 0,
  realized_pnl  FLOAT   NOT NULL DEFAULT 0,
  cash_pnl      FLOAT   NOT NULL DEFAULT 0,
  cur_price     FLOAT   NOT NULL DEFAULT 0,
  current_value FLOAT   NOT NULL DEFAULT 0,
  redeemable    BOOLEAN NOT NULL DEFAULT FALSE,
  title         TEXT    NOT NULL DEFAULT '',
  slug          TEXT    NOT NULL DEFAULT '',
  event_slug    TEXT    NOT NULL DEFAULT '',
  outcome       TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'closed',
  end_date      TEXT    NOT NULL DEFAULT '',
  position_ts   BIGINT  NOT NULL DEFAULT 0,
  total_pnl     FLOAT   NOT NULL DEFAULT 0,
  main_category TEXT    NOT NULL DEFAULT 'Other',
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wallet, asset)
);
CREATE INDEX IF NOT EXISTS idx_etp_wallet ON elite_trader_positions(wallet);

-- Tracked bets (routes.ts creates this too; harmless IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS tracked_bets (
  id TEXT PRIMARY KEY,
  market_question TEXT NOT NULL,
  outcome_label TEXT,
  side TEXT NOT NULL,
  condition_id TEXT,
  slug TEXT,
  entry_price NUMERIC,
  bet_amount NUMERIC DEFAULT 0,
  bet_date BIGINT,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_price NUMERIC,
  resolved_date BIGINT,
  pnl NUMERIC,
  notes TEXT,
  book TEXT,
  american_odds INTEGER,
  polymarket_price NUMERIC,
  sport TEXT,
  alert_price NUMERIC,
  actual_price NUMERIC,
  token_id TEXT,
  take_cap NUMERIC,
  close_price NUMERIC,
  event_start_ms BIGINT,
  kickoff_sent BOOLEAN NOT NULL DEFAULT FALSE,
  user_id TEXT,
  created_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::BIGINT
);

-- ── Copy-desk live tape (source of truth — not trader CSVs) ─────────────────
-- Fills from Polymarket /activity and /trades. Natural key is the fill itself.
CREATE TABLE IF NOT EXISTS desk_fills (
  wallet            TEXT NOT NULL,
  event_timestamp   TIMESTAMPTZ NOT NULL,
  condition_id      TEXT NOT NULL,
  side              TEXT NOT NULL,
  price             DOUBLE PRECISION NOT NULL,
  size              DOUBLE PRECISION NOT NULL,
  transaction_hash  TEXT NOT NULL DEFAULT '',
  username          TEXT NOT NULL DEFAULT '',
  market_id         TEXT NOT NULL DEFAULT '',
  asset             TEXT NOT NULL DEFAULT '',
  outcome           TEXT NOT NULL DEFAULT '',
  title             TEXT NOT NULL DEFAULT '',
  slug              TEXT NOT NULL DEFAULT '',
  event_slug        TEXT NOT NULL DEFAULT '',
  usdc_size         DOUBLE PRECISION NOT NULL DEFAULT 0,
  event_type        TEXT NOT NULL DEFAULT 'TRADE',
  sport             TEXT NOT NULL DEFAULT '',
  market_type       TEXT NOT NULL DEFAULT '',
  source            TEXT NOT NULL DEFAULT 'activity',
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wallet, event_timestamp, condition_id, side, price, size, transaction_hash)
);
CREATE INDEX IF NOT EXISTS idx_desk_fills_wallet ON desk_fills (wallet);
CREATE INDEX IF NOT EXISTS idx_desk_fills_wallet_ts ON desk_fills (wallet, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_desk_fills_ts ON desk_fills (event_timestamp);
CREATE INDEX IF NOT EXISTS idx_desk_fills_condition ON desk_fills (condition_id);
CREATE INDEX IF NOT EXISTS idx_desk_fills_username ON desk_fills (username);
CREATE INDEX IF NOT EXISTS idx_desk_fills_slug ON desk_fills (slug);
CREATE INDEX IF NOT EXISTS idx_desk_fills_market ON desk_fills (market_id);

-- Username → proxy wallet (and optional EOA). Unresolved names stay flagged.
CREATE TABLE IF NOT EXISTS desk_wallets (
  username          TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL DEFAULT '',
  wallet            TEXT,
  eoa_wallet        TEXT,
  source            TEXT NOT NULL DEFAULT '',
  resolved          BOOLEAN NOT NULL DEFAULT FALSE,
  unresolved_reason TEXT,
  last_resolved_at  TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_desk_wallets_wallet ON desk_wallets (wallet);
CREATE INDEX IF NOT EXISTS idx_desk_wallets_resolved ON desk_wallets (resolved);

-- Incremental cursor per trading wallet (last-seen activity/trades timestamp).
CREATE TABLE IF NOT EXISTS desk_ingest_cursors (
  wallet            TEXT PRIMARY KEY,
  username          TEXT NOT NULL DEFAULT '',
  last_seen_ts      TIMESTAMPTZ,
  last_seen_unix    BIGINT,
  last_fetch_at     TIMESTAMPTZ,
  last_ok           BOOLEAN,
  last_error        TEXT,
  fills_inserted    INTEGER NOT NULL DEFAULT 0,
  source            TEXT NOT NULL DEFAULT 'activity'
);

-- Market metadata for grading (resolution / end date). Not a trader tape.
CREATE TABLE IF NOT EXISTS desk_markets (
  condition_id      TEXT PRIMARY KEY,
  title             TEXT NOT NULL DEFAULT '',
  slug              TEXT NOT NULL DEFAULT '',
  event_slug        TEXT NOT NULL DEFAULT '',
  end_date          TIMESTAMPTZ,
  closed            BOOLEAN NOT NULL DEFAULT FALSE,
  winning_outcome   TEXT,
  outcome_prices    TEXT,
  sport             TEXT NOT NULL DEFAULT '',
  market_type       TEXT NOT NULL DEFAULT '',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_desk_markets_end ON desk_markets (end_date);
CREATE INDEX IF NOT EXISTS idx_desk_markets_closed ON desk_markets (closed);

-- Derived unique books from desk_fills + desk_markets. Fast would-have / promote.
CREATE TABLE IF NOT EXISTS desk_unique_books (
  wallet            TEXT NOT NULL,
  condition_id      TEXT NOT NULL,
  outcome           TEXT NOT NULL,
  username          TEXT NOT NULL DEFAULT '',
  title             TEXT NOT NULL DEFAULT '',
  slug              TEXT NOT NULL DEFAULT '',
  event_slug        TEXT NOT NULL DEFAULT '',
  sport             TEXT NOT NULL DEFAULT '',
  market_type       TEXT NOT NULL DEFAULT '',
  submarket         TEXT NOT NULL DEFAULT '',
  entry_price       DOUBLE PRECISION NOT NULL,
  cost              DOUBLE PRECISION NOT NULL,
  size              DOUBLE PRECISION NOT NULL DEFAULT 0,
  won               BOOLEAN,
  resolved          BOOLEAN NOT NULL DEFAULT FALSE,
  end_date          TIMESTAMPTZ,
  first_fill_at     TIMESTAMPTZ,
  last_fill_at      TIMESTAMPTZ,
  fill_count        INTEGER NOT NULL DEFAULT 0,
  hold_pnl          DOUBLE PRECISION,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wallet, condition_id, outcome)
);
CREATE INDEX IF NOT EXISTS idx_desk_books_wallet ON desk_unique_books (wallet);
CREATE INDEX IF NOT EXISTS idx_desk_books_wallet_end ON desk_unique_books (wallet, end_date);
CREATE INDEX IF NOT EXISTS idx_desk_books_username ON desk_unique_books (username);
CREATE INDEX IF NOT EXISTS idx_desk_books_end ON desk_unique_books (end_date);
CREATE INDEX IF NOT EXISTS idx_desk_books_resolved ON desk_unique_books (resolved);

CREATE TABLE IF NOT EXISTS desk_ingest_runs (
  id                SERIAL PRIMARY KEY,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ,
  ok                BOOLEAN,
  wallets_ok        INTEGER NOT NULL DEFAULT 0,
  wallets_unresolved INTEGER NOT NULL DEFAULT 0,
  fills_inserted    INTEGER NOT NULL DEFAULT 0,
  error             TEXT
);
