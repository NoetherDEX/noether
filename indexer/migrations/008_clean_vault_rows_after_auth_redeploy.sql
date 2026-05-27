-- Second one-shot cleanup after vault_factory was redeployed to fix
-- the leader-trade auth tree (CDOGJQUC… → CCEQJKB3W…). Same shape as
-- migration 007: any vault row in the projection still points at the
-- old contract, which the indexer no longer polls.
--
-- The new contract starts at next_vault_id = 0 and the indexer will
-- repopulate from live events.

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
