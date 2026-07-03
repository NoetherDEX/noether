-- Dead-letter queue for events the poller could not decode or handle (I-1 / P0-15).
--
-- Each row captures a single event that threw during decode or dispatch. The
-- poller records it here and advances past it instead of wedging the cursor on
-- a malformed payload or a failing handler. Rows preserve the raw XDR so the
-- event can be inspected and replayed later (see the reindex tooling, P4-11).
CREATE TABLE IF NOT EXISTS dead_letter (
  event_id     TEXT PRIMARY KEY,
  contract_id  TEXT,
  ledger       INTEGER,
  error        TEXT NOT NULL,
  raw_xdr      TEXT,
  inserted_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_inserted_at ON dead_letter (inserted_at);
