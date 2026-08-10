-- Leaderboard close-leg join index.
--
-- The leaderboard credits a closed position's volume by joining position_closed
-- back to its position_opened on positionId (close events carry no size). With
-- no index on that expression Postgres sorted BOTH sides of the join on every
-- run and spilled to disk — measured at 4.2 MB + 3.7 MB of external merge for
-- ~12.5k closes, roughly 122 ms per execution, and growing superlinearly.
--
-- Partial on the two topics the join touches, so it stays a fraction of the
-- table (position_opened/position_closed are a minority of events_raw), and
-- leads with contract_id because every leaderboard query is scoped to the live
-- market deployment.
CREATE INDEX IF NOT EXISTS idx_events_open_close_position
  ON events_raw (contract_id, (payload_json ->> 'positionId'))
  WHERE topic IN ('position_opened', 'position_closed');
