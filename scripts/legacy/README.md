# Retired deploy scripts

These four scripts were retired on 2026-07-04 (audit finding D-5). They
predate the 2026-06 Noeracle cutover and are actively dangerous:

- `deploy_testnet.sh` — requires deleted mock-oracle WASM, omits the vault's
  `noe_token` init arg, and overwrites the authoritative `contracts.json`
  with a manifest missing `noetherRouter` / `vaultFactory` / `referral`.
- `setup_and_deploy.sh` — masks every init call with `>/dev/null` under
  `set -e`, so failures pass silently.
- `market.sh` / `vault.sh` — require retired admin keys and the old oracle
  adapter wiring.

Because `api/` and `indexer/` bake `contracts.json` into their Docker images
at build time, **one accidental run corrupts the address file the whole
production stack depends on**. Each script now exits 1 with a pointer before
doing anything; the original body is preserved below the guard for reference.

## Use instead

| Goal | Script |
|------|--------|
| Blue-green testnet deploy → verify → promote | `scripts/deploy_staging.sh` |
| Production stack | `scripts/deploy_production.sh` |
| Oracle shim / router only | `scripts/deploy_noeracle_shim.sh`, `scripts/deploy_noether_router.sh` |
| Build + optimize all WASM (no deploy) | `scripts/build_contracts.sh` |
