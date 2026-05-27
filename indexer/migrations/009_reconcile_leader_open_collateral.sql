-- One-shot reconciliation for vault total_usdc.
--
-- The original indexer never decremented total_usdc on `leader_open`
-- events (it only inserted into vault_trades). So every leader trade
-- since deploy left the vaults table reporting a balance higher than
-- what the on-chain contract actually holds, by the sum of all open
-- collaterals.
--
-- Subtract that sum so the marketplace + /trade leader balance match
-- reality. This is correct as long as no `leader_close` has run yet
-- (close PnL isn't carried in the event so we can't reconcile those
-- accurately from projection alone). For vaults with existing closes
-- this row will be slightly off until the next deposit / withdraw
-- re-syncs it via an on-chain view_vault call (TODO follow-up).

UPDATE vaults
SET total_usdc = total_usdc - COALESCE((
  SELECT SUM(CAST(vt.collateral AS INTEGER))
  FROM vault_trades vt
  WHERE vt.vault_id = vaults.id AND vt.action = 'open'
), 0);
