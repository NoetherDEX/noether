-- Phase 1: core tables.
-- These tables are read by the API gateway and written by the indexer.
-- Vault and referral tables ship in their own migrations during Phases 10/11.

CREATE TABLE IF NOT EXISTS poll_cursor (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  last_ledger     INTEGER NOT NULL,
  last_pagination_token TEXT,
  updated_at      INTEGER NOT NULL
);

--# split

CREATE TABLE IF NOT EXISTS trades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger          INTEGER NOT NULL,
  tx_hash         TEXT NOT NULL,
  ts              INTEGER NOT NULL,
  asset           TEXT NOT NULL,
  trader          TEXT NOT NULL,
  direction       TEXT NOT NULL,
  kind            TEXT NOT NULL,
  size            INTEGER NOT NULL,
  price           INTEGER NOT NULL,
  entry_price     INTEGER,
  pnl             INTEGER,
  fee             INTEGER NOT NULL DEFAULT 0
);

--# split

CREATE INDEX IF NOT EXISTS idx_trades_asset_ts ON trades (asset, ts DESC);

--# split

CREATE INDEX IF NOT EXISTS idx_trades_trader_ts ON trades (trader, ts DESC);

--# split

CREATE TABLE IF NOT EXISTS candles (
  asset       TEXT NOT NULL,
  interval    TEXT NOT NULL,
  bucket_ts   INTEGER NOT NULL,
  open        INTEGER NOT NULL,
  high        INTEGER NOT NULL,
  low         INTEGER NOT NULL,
  close       INTEGER NOT NULL,
  volume      INTEGER NOT NULL,
  PRIMARY KEY (asset, interval, bucket_ts)
);

--# split

CREATE TABLE IF NOT EXISTS positions_cache (
  id                  INTEGER PRIMARY KEY,
  trader              TEXT NOT NULL,
  asset               TEXT NOT NULL,
  direction           TEXT NOT NULL,
  collateral          INTEGER NOT NULL,
  size                INTEGER NOT NULL,
  entry_price         INTEGER NOT NULL,
  liquidation_price   INTEGER NOT NULL,
  opened_at           INTEGER NOT NULL,
  closed_at           INTEGER,
  realized_pnl        INTEGER,
  margin_mode         TEXT NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_positions_trader ON positions_cache (trader);

--# split

CREATE INDEX IF NOT EXISTS idx_positions_open ON positions_cache (closed_at) WHERE closed_at IS NULL;

--# split

CREATE TABLE IF NOT EXISTS orders_cache (
  id                      INTEGER PRIMARY KEY,
  trader                  TEXT NOT NULL,
  asset                   TEXT NOT NULL,
  order_type              TEXT NOT NULL,
  direction               TEXT NOT NULL,
  collateral              INTEGER NOT NULL,
  leverage                INTEGER NOT NULL,
  trigger_price           INTEGER,
  trigger_condition       TEXT,
  slippage_tolerance_bps  INTEGER,
  position_id             INTEGER,
  has_position            INTEGER NOT NULL DEFAULT 0,
  limit_price             INTEGER,
  trailing_percent_bps    INTEGER,
  time_in_force           INTEGER,
  stop_limit_phase        INTEGER,
  status                  TEXT NOT NULL,
  created_at              INTEGER NOT NULL,
  executed_at             INTEGER
);

--# split

CREATE INDEX IF NOT EXISTS idx_orders_trader_status ON orders_cache (trader, status);

--# split

CREATE TABLE IF NOT EXISTS api_keys (
  key_id          TEXT PRIMARY KEY,
  secret_hash     TEXT NOT NULL,
  owner           TEXT NOT NULL,
  tier            TEXT NOT NULL DEFAULT 'standard',
  label           TEXT,
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER,
  revoked_at      INTEGER
);

--# split

CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys (owner);

--# split

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key_id          TEXT NOT NULL,
  window_start    INTEGER NOT NULL,
  count           INTEGER NOT NULL,
  PRIMARY KEY (key_id, window_start)
);
