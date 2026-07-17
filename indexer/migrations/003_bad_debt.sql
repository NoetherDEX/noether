-- L0-2: bad-debt projection. One row per bad_debt_recorded event —
-- the on-chain booking of a bankrupt settle's uncollectable loss
-- (buffer_covered + lp_absorbed == amount). asset 'CROSS' marks
-- account-level cross-liquidation debt. Money columns are 7-decimal
-- strings, consistent with the other projections.
CREATE TABLE IF NOT EXISTS bad_debt (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  trader TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  buffer_covered TEXT NOT NULL,
  lp_absorbed TEXT NOT NULL,
  ledger BIGINT NOT NULL,
  ts BIGINT NOT NULL,
  tx_hash TEXT NOT NULL,
  contract_id TEXT NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_bad_debt_contract_ts ON bad_debt (contract_id, ts DESC);
