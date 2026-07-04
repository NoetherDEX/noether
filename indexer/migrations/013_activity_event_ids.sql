-- P4-7 (I-2): idempotency keys for the append-only activity tables.
-- Every activity row derives from exactly one contract event, so a
-- UNIQUE index on event_id turns any redelivery into a no-op
-- INSERT OR IGNORE. Rows written before this migration stay NULL
-- (SQLite unique indexes permit multiple NULLs); they are already
-- deduplicated by the events_raw guard.

ALTER TABLE vault_deposits ADD COLUMN event_id TEXT;

--# split

CREATE UNIQUE INDEX IF NOT EXISTS uq_vault_deposits_event_id ON vault_deposits (event_id);

--# split

ALTER TABLE vault_withdraws ADD COLUMN event_id TEXT;

--# split

CREATE UNIQUE INDEX IF NOT EXISTS uq_vault_withdraws_event_id ON vault_withdraws (event_id);

--# split

ALTER TABLE vault_fee_claims ADD COLUMN event_id TEXT;

--# split

CREATE UNIQUE INDEX IF NOT EXISTS uq_vault_fee_claims_event_id ON vault_fee_claims (event_id);

--# split

ALTER TABLE referral_trades ADD COLUMN event_id TEXT;

--# split

CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_trades_event_id ON referral_trades (event_id);

--# split

ALTER TABLE referral_claims ADD COLUMN event_id TEXT;

--# split

CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_claims_event_id ON referral_claims (event_id);
