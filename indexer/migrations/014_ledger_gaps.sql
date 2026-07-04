-- P4-8 (I-3): ledger ranges the indexer could NOT fetch because the
-- RPC retention window moved past the cursor while the poller was
-- down. Recorded instead of wedging or silently resuming so operators
-- know exactly which range needs a backfill from an archival source.

CREATE TABLE IF NOT EXISTS ledger_gaps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_ledger  INTEGER NOT NULL,
  to_ledger    INTEGER NOT NULL,
  reason       TEXT    NOT NULL,
  recorded_at  INTEGER NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_ledger_gaps_from ON ledger_gaps (from_ledger);
