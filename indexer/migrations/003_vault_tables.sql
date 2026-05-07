-- Phase 10.10: vault factory projections.
-- The factory writes the same firehose into events_raw as every other
-- contract; these tables are derived views for the marketplace and
-- per-vault detail page.

CREATE TABLE IF NOT EXISTS vaults (
  id                 INTEGER PRIMARY KEY,
  leader             TEXT NOT NULL,
  name               TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  total_usdc         INTEGER NOT NULL DEFAULT 0,
  circulating_shares INTEGER NOT NULL DEFAULT 0,
  hwm_nav            INTEGER NOT NULL DEFAULT 10000000,
  realized_pnl       INTEGER NOT NULL DEFAULT 0,
  leader_shares      INTEGER NOT NULL DEFAULT 0,
  profit_share_bps   INTEGER NOT NULL DEFAULT 1000,
  paused             INTEGER NOT NULL DEFAULT 0,
  updated_at         INTEGER NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_vaults_leader ON vaults (leader);

--# split

CREATE INDEX IF NOT EXISTS idx_vaults_created ON vaults (created_at DESC);

--# split

CREATE TABLE IF NOT EXISTS vault_snapshots (
  vault_id        INTEGER NOT NULL,
  ts              INTEGER NOT NULL,
  tvl             INTEGER NOT NULL,
  nav             INTEGER NOT NULL,
  open_positions  INTEGER NOT NULL DEFAULT 0,
  hwm             INTEGER NOT NULL,
  PRIMARY KEY (vault_id, ts)
);

--# split

CREATE INDEX IF NOT EXISTS idx_vault_snapshots_vault ON vault_snapshots (vault_id, ts DESC);

--# split

CREATE TABLE IF NOT EXISTS vault_deposits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vault_id        INTEGER NOT NULL,
  depositor       TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  shares          INTEGER NOT NULL,
  ledger          INTEGER NOT NULL,
  ts              INTEGER NOT NULL,
  tx_hash         TEXT NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_vault_deposits_vault ON vault_deposits (vault_id, ts DESC);

--# split

CREATE INDEX IF NOT EXISTS idx_vault_deposits_depositor ON vault_deposits (depositor, ts DESC);

--# split

CREATE TABLE IF NOT EXISTS vault_withdraws (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vault_id        INTEGER NOT NULL,
  depositor       TEXT NOT NULL,
  shares          INTEGER NOT NULL,
  usdc_out        INTEGER NOT NULL,
  ledger          INTEGER NOT NULL,
  ts              INTEGER NOT NULL,
  tx_hash         TEXT NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_vault_withdraws_vault ON vault_withdraws (vault_id, ts DESC);

--# split

CREATE INDEX IF NOT EXISTS idx_vault_withdraws_depositor ON vault_withdraws (depositor, ts DESC);

--# split

CREATE TABLE IF NOT EXISTS vault_fee_claims (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vault_id        INTEGER NOT NULL,
  leader          TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  new_nav         INTEGER NOT NULL,
  ledger          INTEGER NOT NULL,
  ts              INTEGER NOT NULL,
  tx_hash         TEXT NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_vault_fee_claims_vault ON vault_fee_claims (vault_id, ts DESC);
