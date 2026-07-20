# L0-7 operator runbook — prod keeper cutover to the hardened Noeracle

**When:** at the Batch-1 / T3 prod cutover, together with the prod-keeper
unification (the `noether-keeper` Azure app stops running the legacy
`noetherkeeperbotv2` image and adopts `scripts/keeper`).

**Why this is a trap without the runbook:** the hardened keeper publishes
through `update_batch_ed25519_persistent`, which does not exist on the
legacy Noeracle (`CAYIP67…`). Since 2026-07-20 the hardened keeper
**refuses to boot** on a missing or legacy Noeracle id (the A3 guard) —
a mis-set env now fails loudly instead of publishing into a void.

## Steps

```bash
# 1. Build the hardened keeper image (from the repo root)
az acr build -r noetheracr2026 -t noether-keeper-t3:vN scripts/keeper

# 2. Roll the PROD app onto it with the full Batch-1 env set
az containerapp update -n noether-keeper -g noether-rg \
  --image noetheracr2026.azurecr.io/noether-keeper-t3:vN \
  --set-env-vars \
    NEXT_PUBLIC_NOERACLE_ID=<hardened Noeracle id> \
    NEXT_PUBLIC_MARKET_ID=<Batch-1 market> \
    NEXT_PUBLIC_VAULT_ID=<Batch-1 vault> \
    NEXT_PUBLIC_VAULT_FACTORY_ID=<Batch-1 factory> \
    NEXT_PUBLIC_NOERACLE_SHIM_ID=<shim> \
    NEXT_PUBLIC_NOETHER_ROUTER_ID=<Batch-1 router> \
    KEEPER_INSTANCE_ID=keeper-prod-1
# optional liveness extras (L0-19): HEALTHCHECK_URL=<healthchecks.io ping URL>
```

## Verify

- `az containerapp logs show -n noether-keeper -g noether-rg --tail 40 --format text`
  should show the boot config block with `Instance: keeper-prod-1`,
  `Router: <id>… (verify-then-trade preferred)`, and NO
  "ADL entry points not present" line once Batch-1 is live.
- A boot crash mentioning "LEGACY pre-S-1 deployment" means the env still
  points at `CAYIP67…` — that is the guard working, not a keeper bug.
- `NEXT_PUBLIC_VAULT_FACTORY_ID` must be set or the L0-20 reconcile duty
  stays disabled (vault full-NAV under-counts after keeper executions).

## Cautions

- **Never port the A3 legacy-refusal guard into `noetherkeeperbotv2`** —
  the legacy copy must keep publishing to the legacy Noeracle right up to
  this cutover (it is the rollback path).
- After a clean soak, retire the `noether-keeper-legacy` image + the
  `noetherkeeperbotv2` checkout per the keeper-workflow notes.
- Second instance (L0-19 active-active) comes after the soak: same image,
  own funded `KEEPER_SECRET_KEY`, `KEEPER_INSTANCE_ID=keeper-prod-2`,
  `KEEPER_POLL_OFFSET_MS=2500`, and a DIFFERENT primary in
  `SOROBAN_RPC_URLS` (provider diversity per docs/RPC.md); then the
  staging failover drill from the L0-19 spec.
