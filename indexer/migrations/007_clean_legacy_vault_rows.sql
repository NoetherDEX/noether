-- One-shot cleanup after vault_factory was redeployed (PR #23,
-- contract address moved CCFICYG7… → CDOGJQUC…). The old contract
-- still exists on-chain but the new indexer config only watches the
-- new address, so every existing vaults / vault_* projection row is
-- now a zombie pointing at unreachable on-chain state.
--
-- Wipe the projection tables. The new contract starts at
-- next_vault_id = 0; the indexer will repopulate from live events.

DELETE FROM vault_trades;

--# split

DELETE FROM vault_fee_claims;

--# split

DELETE FROM vault_withdraws;

--# split

DELETE FROM vault_deposits;

--# split

DELETE FROM vault_snapshots;

--# split

DELETE FROM vaults;
