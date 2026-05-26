-- Per-vault trade log written by the vault handler when it sees
-- `leader_open` / `leader_close` events on the vault_factory contract.
-- Powers the marketplace UI's "open positions count", the vault
-- detail page's "trade history" table, and the time-series snapshot
-- the PnL chart consumes.

CREATE TABLE IF NOT EXISTS vault_trades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vault_id        INTEGER NOT NULL,
  position_id     INTEGER NOT NULL,
  action          TEXT    NOT NULL CHECK (action IN ('open','close')),
  leader          TEXT    NOT NULL,
  collateral      INTEGER NOT NULL DEFAULT 0,
  ledger          INTEGER NOT NULL,
  ts              INTEGER NOT NULL,
  tx_hash         TEXT    NOT NULL,
  UNIQUE (vault_id, position_id, action, tx_hash)
);

CREATE INDEX IF NOT EXISTS idx_vault_trades_vault_ts
  ON vault_trades (vault_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_vault_trades_action
  ON vault_trades (vault_id, action);
