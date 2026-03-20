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
  created_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::BIGINT
);
