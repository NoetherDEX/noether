-- Dead-letter queue for events the poller could not process.
-- stage 'decode': raw event failed to decode — row is recorded and the
-- cursor advances past it so one poison event cannot wedge the loop.
-- stage 'apply': a handler failed to project the decoded event — row is
-- recorded and the error rethrown so the cursor does not advance.

CREATE TABLE IF NOT EXISTS dead_letter (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      TEXT    NOT NULL,
  contract_id   TEXT    NOT NULL,
  ledger        INTEGER NOT NULL,
  stage         TEXT    NOT NULL,
  error         TEXT    NOT NULL,
  payload_json  TEXT,
  created_at    INTEGER NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_dead_letter_event ON dead_letter (event_id);

--# split

CREATE INDEX IF NOT EXISTS idx_dead_letter_stage ON dead_letter (stage, created_at DESC);
