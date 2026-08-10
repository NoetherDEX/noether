/* LP vault event projections (the USDC liquidity pool the market settles
   against, contracts/vault). The poller now subscribes to that contract:
   every decoded event is archived in events_raw, and the high value money
   flows below also get typed rows. Money columns are 7 decimal integer
   strings, matching the other projections. Every insert is keyed on the
   Soroban event id with ON CONFLICT DO NOTHING so live redelivery and a
   reindex replay each write exactly once. */
CREATE TABLE IF NOT EXISTS lp_vault_deposits (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id    TEXT NOT NULL UNIQUE,
  depositor   TEXT NOT NULL,
  usdc_amount TEXT NOT NULL,
  noe_minted  TEXT NOT NULL,
  fee         TEXT NOT NULL,
  ledger      BIGINT NOT NULL,
  ts          BIGINT NOT NULL,
  tx_hash     TEXT NOT NULL,
  contract_id TEXT NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_lp_vault_deposits_depositor ON lp_vault_deposits (depositor, ts DESC);

--# split

CREATE INDEX IF NOT EXISTS idx_lp_vault_deposits_contract_ts ON lp_vault_deposits (contract_id, ts DESC);

--# split

/* withdraw carries the NOE the LP returned and the net USDC paid out
   after the withdraw fee. */
CREATE TABLE IF NOT EXISTS lp_vault_withdraws (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id    TEXT NOT NULL UNIQUE,
  withdrawer  TEXT NOT NULL,
  noe_burned  TEXT NOT NULL,
  usdc_out    TEXT NOT NULL,
  fee         TEXT NOT NULL,
  ledger      BIGINT NOT NULL,
  ts          BIGINT NOT NULL,
  tx_hash     TEXT NOT NULL,
  contract_id TEXT NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_lp_vault_withdraws_withdrawer ON lp_vault_withdraws (withdrawer, ts DESC);

--# split

CREATE INDEX IF NOT EXISTS idx_lp_vault_withdraws_contract_ts ON lp_vault_withdraws (contract_id, ts DESC);

--# split

/* pnl is the trader pnl the market asked the vault to settle. Positive
   means the trader won and the vault paid out (insurance buffer first,
   then LP value); a negative pnl is only an accounting signal here, the
   USDC is credited later by the loss_received event, which stays in the
   events_raw archive. */
CREATE TABLE IF NOT EXISTS lp_vault_pnl_settlements (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id    TEXT NOT NULL UNIQUE,
  pnl         TEXT NOT NULL,
  ledger      BIGINT NOT NULL,
  ts          BIGINT NOT NULL,
  tx_hash     TEXT NOT NULL,
  contract_id TEXT NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_lp_vault_pnl_settlements_contract_ts ON lp_vault_pnl_settlements (contract_id, ts DESC);

--# split

/* One row per insurance buffer move. secondary_amount depends on kind:
   the slice routed to the shortfall repayment reserve for buffer_seeded
   and buffer_funded, the amount actually covered for buffer_drawn, and
   the amount actually paid for buffer_paid. counterparty is the payment
   recipient on buffer_paid and NULL otherwise. */
CREATE TABLE IF NOT EXISTS lp_vault_buffer_flows (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id         TEXT NOT NULL UNIQUE,
  kind             TEXT NOT NULL CHECK (kind IN ('buffer_seeded', 'buffer_funded', 'buffer_drawn', 'buffer_paid')),
  amount           TEXT NOT NULL,
  secondary_amount TEXT NOT NULL,
  counterparty     TEXT,
  ledger           BIGINT NOT NULL,
  ts               BIGINT NOT NULL,
  tx_hash          TEXT NOT NULL,
  contract_id      TEXT NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_lp_vault_buffer_flows_kind_ts ON lp_vault_buffer_flows (kind, ts DESC);

--# split

CREATE INDEX IF NOT EXISTS idx_lp_vault_buffer_flows_contract_ts ON lp_vault_buffer_flows (contract_id, ts DESC);
