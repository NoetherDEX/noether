/* Phantom vault cleanup. GET /v1/vaults was listing vaults that do not
   exist on the live Batch 1 factory (ids 0, 12 and 13 in production, one
   of them a staging test row frozen at a stale total): they are
   projection rows written for earlier factory deployments that were
   never scoped to a factory address. Vault ids restart from zero on
   every factory redeploy, so such rows collide with the live factory's
   ids and can never be corrected by the boot time reconcile, which
   leaves a row untouched when view_vault fails for an id the live
   factory never issued.

   Every current handler write path stamps contract_id on creation, and
   that stamping predates the live factory deployment, so a NULL
   contract_id proves the row was written for a retired factory (or was
   imported by the Turso copy tool) and is safe to delete. Rows stamped
   with a concrete retired factory address are removed at every boot by
   pruneRetiredFactoryRows in src/vaultSync.ts, which compares against
   the factory address the indexer is configured with. This migration
   cannot name that address itself because staging and production run
   different factories against different databases.

   The ADD COLUMN below is defensive: the column exists since the 001
   baseline, but a database restored from an older dump may lack it and
   the DELETE must never fail on a missing column. */
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS contract_id TEXT;

--# split

DELETE FROM vaults WHERE contract_id IS NULL;
