-- One-shot reconciliation for vault.leader_shares.
--
-- The original deposit / withdraw handlers updated total_usdc and
-- circulating_shares but never bumped leader_shares, so every row
-- shows the leader as holding 0 % of the vault even though the
-- on-chain 5 % invariant has been enforced since vault_factory was
-- deployed. Recompute from the per-event log tables that *do* have
-- the depositor address — leader_shares is `SUM(deposits where
-- depositor=leader) − SUM(withdraws where depositor=leader)`.

UPDATE vaults
SET leader_shares = COALESCE((
  SELECT SUM(CAST(vd.shares AS INTEGER))
  FROM vault_deposits vd
  WHERE vd.vault_id = vaults.id AND vd.depositor = vaults.leader
), 0) - COALESCE((
  SELECT SUM(CAST(vw.shares AS INTEGER))
  FROM vault_withdraws vw
  WHERE vw.vault_id = vaults.id AND vw.depositor = vaults.leader
), 0);
