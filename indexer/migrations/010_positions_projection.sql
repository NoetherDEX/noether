-- Open-position projection.
--
-- The market contract dropped its `get_positions(trader)` view fn for
-- WASM size reasons, leaving the web client with `get_all_position_ids`
-- → per-id `get_position` (one simulateTransaction per id). On testnet
-- with a few hundred historical positions that's slow and bumps into
-- RPC rate limits, so the /trade leader-mode positions tab was often
-- empty even after the trade landed.
--
-- This projection keeps a compact `id → trader` map for currently
-- open positions, sourced from position_opened / position_closed /
-- position_liquidated events. The API serves the list and the web
-- client only `get_position`s the few ids that actually belong to it.

CREATE TABLE IF NOT EXISTS positions (
  position_id     INTEGER PRIMARY KEY,
  trader          TEXT    NOT NULL,
  asset           TEXT    NOT NULL,
  direction       INTEGER NOT NULL,
  size            TEXT    NOT NULL,
  entry_price     TEXT    NOT NULL,
  opened_at       INTEGER NOT NULL,
  opened_tx_hash  TEXT    NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_positions_trader ON positions (trader);

--# split

-- Backfill from events_raw: every position_opened minus every
-- position_closed / position_liquidated that came after it.
INSERT OR IGNORE INTO positions (
  position_id, trader, asset, direction, size, entry_price, opened_at, opened_tx_hash
)
SELECT
  CAST(json_extract(payload_json, '$.positionId') AS INTEGER),
  json_extract(payload_json, '$.trader'),
  json_extract(payload_json, '$.asset'),
  CAST(json_extract(payload_json, '$.direction') AS INTEGER),
  json_extract(payload_json, '$.size'),
  json_extract(payload_json, '$.entryPrice'),
  ledger_close_ts,
  tx_hash
FROM events_raw
WHERE topic = 'position_opened'
  AND CAST(json_extract(payload_json, '$.positionId') AS INTEGER) NOT IN (
    SELECT CAST(json_extract(payload_json, '$.positionId') AS INTEGER)
    FROM events_raw
    WHERE topic IN ('position_closed', 'position_liquidated')
  );
