-- Per-close PnL on vault_trades.
--
-- The leader_close event from vault_factory carries only
-- (leader, position_id) — no PnL. But the market contract
-- publishes a position_closed event in the same transaction
-- with the settled pnl (8th field). We can join the two on
-- (tx_hash, position_id) and persist the pnl on the close row.
--
-- Forward path (handlers/vault.ts leader_close branch): writes
-- pnl at event time by looking up the matching position_closed
-- already-persisted in events_raw.
--
-- This migration does the backfill: walks every existing close
-- row and joins to events_raw to populate pnl in one pass.
-- payload_json stores bigint as string (see serialisePayload),
-- so we json_extract → CAST AS INTEGER.

ALTER TABLE vault_trades ADD COLUMN pnl INTEGER;

--# split

UPDATE vault_trades
SET pnl = (
  SELECT CAST(json_extract(e.payload_json, '$.pnl') AS INTEGER)
  FROM events_raw e
  WHERE e.topic = 'position_closed'
    AND e.tx_hash = vault_trades.tx_hash
    AND CAST(json_extract(e.payload_json, '$.positionId') AS INTEGER) = vault_trades.position_id
  LIMIT 1
)
WHERE action = 'close';
