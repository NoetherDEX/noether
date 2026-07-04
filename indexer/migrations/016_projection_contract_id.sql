-- P4-11 (I-7): stamp every projection row with the contract that
-- produced it, so redeploys stop needing hand-written cleanup
-- migrations (006-009) and `npm run reindex` can rebuild scoped to
-- the currently-configured addresses. Legacy rows stay NULL.

ALTER TABLE positions ADD COLUMN contract_id TEXT;

--# split

ALTER TABLE vaults ADD COLUMN contract_id TEXT;

--# split

ALTER TABLE vault_deposits ADD COLUMN contract_id TEXT;

--# split

ALTER TABLE vault_withdraws ADD COLUMN contract_id TEXT;

--# split

ALTER TABLE vault_fee_claims ADD COLUMN contract_id TEXT;

--# split

ALTER TABLE vault_trades ADD COLUMN contract_id TEXT;

--# split

ALTER TABLE referrers ADD COLUMN contract_id TEXT;

--# split

ALTER TABLE referral_bindings ADD COLUMN contract_id TEXT;

--# split

ALTER TABLE referral_trades ADD COLUMN contract_id TEXT;

--# split

ALTER TABLE referral_claims ADD COLUMN contract_id TEXT;
