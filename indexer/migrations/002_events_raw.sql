-- Phase 2 v0: a universal append-only log of decoded contract events.
-- Trades, positions, and orders are projected from this table in Phase 3
-- once the API gateway needs to serve them. Keeping the projections
-- separate from capture lets us replay history if a projection bug is
-- discovered later.

CREATE TABLE IF NOT EXISTS events_raw (
  event_id          TEXT PRIMARY KEY,
  contract_id       TEXT NOT NULL,
  topic             TEXT NOT NULL,
  ledger            INTEGER NOT NULL,
  ledger_close_ts   INTEGER NOT NULL,
  tx_hash           TEXT NOT NULL,
  payload_json      TEXT NOT NULL,
  inserted_at       INTEGER NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_events_topic_ledger ON events_raw (topic, ledger DESC);

--# split

CREATE INDEX IF NOT EXISTS idx_events_contract_ledger ON events_raw (contract_id, ledger DESC);

--# split

CREATE INDEX IF NOT EXISTS idx_events_ledger ON events_raw (ledger DESC);
