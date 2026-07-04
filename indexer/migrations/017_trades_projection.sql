-- P4-12 (I-8): realign the dead `trades` table into a realized-trade
-- projection. Migration 001 created it schema-only — no writer ever
-- existed (only vault_trades got rows), so every deployment's copy is
-- empty and dropping it loses nothing. `--# split` runs each statement
-- separately (see migrations.ts).
--
-- Now that position_closed / position_liquidated decoders carry
-- asset/direction/size/entry_price (P4-10), the market handler writes one
-- row here on every close + liquidation. This lets /v1/trades and the
-- close-side of /v1/markets/stats read a real projection instead of an
-- events_raw self-join, and lets the leaderboard aggregate realized PnL +
-- volume per trader without re-scanning Horizon (P4-26).
--
-- Idempotency key: the Soroban event_id (globally unique, survives
-- `npm run reindex`) — redelivery is a no-op INSERT OR IGNORE, matching
-- the vault/referral activity tables (migration 013). Bigint columns are
-- TEXT to match the positions projection and the api's BigInt(...) reads;
-- entry_price and pnl are nullable because the position_liquidated event
-- carries neither. Stamped with contract_id like every other projection
-- (migration 016) so redeploys reindex scoped to the current address.

DROP TABLE IF EXISTS trades;

--# split

CREATE TABLE trades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      TEXT    NOT NULL UNIQUE,
  position_id   INTEGER NOT NULL,
  trader        TEXT    NOT NULL,
  asset         TEXT    NOT NULL,
  direction     INTEGER NOT NULL,
  kind          TEXT    NOT NULL,
  size          TEXT    NOT NULL,
  entry_price   TEXT,
  close_price   TEXT    NOT NULL,
  pnl           TEXT,
  ledger        INTEGER NOT NULL,
  ts            INTEGER NOT NULL,
  tx_hash       TEXT    NOT NULL,
  contract_id   TEXT    NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_trades_asset_ts ON trades (asset, ts DESC);

--# split

CREATE INDEX IF NOT EXISTS idx_trades_trader_ts ON trades (trader, ts DESC);
