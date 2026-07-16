# T3 Cutover Runbook — hardened oracle + partial liquidation (Phases 1 & 2)

One coordinated ceremony that ships **both** T3 phases:

1. **Phase 1 (oracle):** move off the unhardened Noeracle instance
   (`CAYIP67…`, where anyone can write prices) onto the hardened batch
   entrypoint, with the Stork second source and health surface ready to arm.
2. **Phase 2 (risk):** ship partial liquidation + insurance-fund accumulation
   (market + vault).

Do them together — both touch the market, and one redeploy is cheaper and
safer than two.

---

## ⚠️ Read this first: the config-shape trap

`MarketConfig` gained four fields in Phase 2. Soroban stores a struct as an
**exact field map**, so after an in-place `upgrade()` the old 11-field config
no longer decodes: `get_config` traps with `UnexpectedSize` and **every
config-reading entry point is bricked** until it's rewritten. `unwrap_or_default()`
does not rescue this — the trap happens inside the storage read. (Pinned by
`test_pre_upgrade_config_cannot_be_read_by_new_wasm`.)

Two ways through:

| Path | Addresses | When |
|---|---|---|
| **Fresh deploy** (blue-green) | change | **Staging** — this is what `deploy_staging.sh` is for |
| **upgrade → `migrate_config`** | unchanged | **Production** — no Vercel/Railway env churn |

`migrate_config(config)` is admin-only and never reads the old value, so it is
callable from the bricked state. That is the one-way door out.

---

## Part A — Staging (fresh deploy, do this first)

### A0. Preconditions
- Noeracle repo at/after `2770e44` (hardened batch entrypoint, CI green).
- Noether `staging` at/after the Phase-1 + Phase-2 commits; `cargo test --workspace` green.
- `stellar` CLI ≥ 26, `.env.staging` filled with the two funded staging keypairs.

### A1. Deploy the hardened Noeracle (new address)
```bash
cd /Users/yahya/Desktop/Stellar/Noeracle
./scripts/deploy_oracle_v0.sh          # testnet
```
The script refuses any wasm that still exports a bench entrypoint, deploys,
runs `init(admin, [publisher])`, and prints the new id. Record it as
`NEW_NOERACLE`.

### A2. Point staging at it, and force fresh contracts
`deploy_staging.sh` is resumable: any `GREEN_*` already set in `.env.staging`
is treated as done and **skipped**. To get fresh market/vault/router you must
clear them.

```bash
cd /Users/yahya/Desktop/Stellar/Noether
cp .env.staging .env.staging.bak                  # keep the old ids to roll back
# 1) point at the new oracle
#    NEXT_PUBLIC_NOERACLE_ID=<NEW_NOERACLE>
# 2) delete (or comment out) these four lines so they redeploy fresh:
#    GREEN_VAULT_ID=…   GREEN_MARKET_ID=…   GREEN_ROUTER_ID=…
#    (keep GREEN_NOE_TOKEN_ID — the SAC and its pre-mint can be reused)
```

### A3. Upgrade the staging shim in place, then repoint it
The shim keeps its address (`CASUDHE4…`), so the fresh market can be
initialized against it. Its new storage keys default to the current
behavior, so the upgrade is transparent.

```bash
./scripts/build_contracts.sh

SHIM=CASUDHE4HYT676A4LXQVVTHDXMU7R5HXNUYTJA7XYD6RAPILQPJWDGDT
HASH=$(stellar contract install --wasm contracts/target/wasm/noeracle_shim.wasm \
  --source staging_admin --network testnet)
stellar contract invoke --id $SHIM --source staging_admin --network testnet \
  -- upgrade --new_wasm_hash $HASH
stellar contract invoke --id $SHIM --source staging_admin --network testnet \
  -- set_noeracle_oracle --new_oracle <NEW_NOERACLE>
```

### A4. Deploy the stack
```bash
./scripts/deploy_staging.sh
```
Deploys fresh vault → market (oracle = shim) → router, initializes each with
the new `MarketConfig` (partial-liq + insurance fields included) and the
router's required publisher allowlist, and writes `contracts.staging.json`.

### A5. Seed and start
```bash
# The vault gates trades on its INTERNAL counter — a raw USDC transfer does
# NOT count. It must be vault.deposit() (this bit us on 2026-07-06, error #40).
npx tsx web/scripts/seed-production-vault.ts     # point it at the staging vault

cd scripts/keeper                                 # staging keeper env:
#   NEXT_PUBLIC_NOERACLE_ID=<NEW_NOERACLE>
#   NEXT_PUBLIC_MARKET_ID / VAULT / ROUTER = the new green ids
npm start
```

### A6. Validate
```bash
cd scripts/keeper
npm run noeracle:check     # happy path AND both negative checks must pass:
                           #   unregistered publisher rejected
                           #   stale round rejected
```
Then on `staging.noether.exchange` (after updating the Vercel **Preview** env
vars to the new ids): open a position, close it, and confirm the vault page's
**Insurance Fund** card renders (it reads `$0.00` until a liquidation happens —
that's correct, not a bug).

To see partial liquidation actually fire, open a position ≥ $1,000 notional at
high leverage and let the keeper liquidate it: the first sweep should shrink it
~20% and emit `position_partial_liq`, not delete it.

---

## Part B — Production (in-place upgrade, addresses unchanged)

Only after staging is green. Every address stays the same, so **no Vercel,
Railway, or `contracts.json` changes are needed** — that's the whole point of
going the `migrate_config` route here.

```bash
MARKET=CAE3U7JKESRWZHPEQ72DVNGOQ6WPA7HSPQZL5YV46NPCE4TMUPAGYMEC
VAULT=CBLVZZ557ALB342GBQIMC2E3IYXJ5AEL7XSVMPX36CVLKRDQGDH22UL6
ROUTER=CDH4CY3XMUZ7H73LC3WJYR3AG56U4MTIBMR2WHNORXDTWLLBOQII44S4
SHIM=CBY4YLPYEN5GMV4JMVZGCSU433SO5JTEGCS66GIT3EZOUG2CN2TWT6UK

# 1. HALT first — the market is briefly unreadable between upgrade and migrate.
stellar contract invoke --id $MARKET --source noether_admin --network testnet -- pause

# 2. Upgrade all four (install → upgrade, same shape for each)
for C in noeracle_shim noether_router vault market; do
  stellar contract install --wasm contracts/target/wasm/$C.wasm \
    --source noether_admin --network testnet
done
# …then `upgrade --new_wasm_hash <hash>` on each of $SHIM $ROUTER $VAULT $MARKET

# 3. UNBRICK the market: rewrite the config with the new fields.
stellar contract invoke --id $MARKET --source noether_admin --network testnet \
  -- migrate_config --config-file-path market_config.json

# 4. Repoint the oracle chain at the hardened Noeracle
stellar contract invoke --id $SHIM   --source noether_admin --network testnet \
  -- set_noeracle_oracle --new_oracle <NEW_NOERACLE>
stellar contract invoke --id $ROUTER --source noether_admin --network testnet \
  -- set_noeracle --new_noeracle <NEW_NOERACLE>

# 5. Resume
stellar contract invoke --id $MARKET --source noether_admin --network testnet -- unpause
```

`market_config.json` (the same JSON both deploy scripts write):
```json
{"min_collateral":"100000000","max_leverage":10,"maintenance_margin_bps":100,
 "liquidation_fee_bps":500,"trading_fee_bps":10,"base_funding_rate_bps":1,
 "max_position_size":"1000000000000","max_price_staleness":60,
 "max_oracle_deviation_bps":100,"base_maker_fee_bps":2,"base_taker_fee_bps":5,
 "partial_liq_min_notional":"10000000000","partial_liq_tranche_bps":2000,
 "partial_liq_cooldown_secs":30,"insurance_buffer_share_bps":1000}
```

### B1. Production keeper (do NOT skip)
The live bot `noetherkeeperbotv2` still calls the **old** Noeracle entrypoint;
after step 4 its pushes fail. Sync `src/` from `scripts/keeper/src/`, set
`NEXT_PUBLIC_NOERACLE_ID=<NEW_NOERACLE>` in Railway, push (Railway
auto-deploys). Ask before pushing — that repo is live.

Web trading is unaffected during the window: every web trade relays a fresh
price through the router in-transaction. Only the background heartbeat gaps.

---

## Rollback

- **Staging:** `.env.staging.bak` has the old green ids; the old Noeracle
  instance and old wasm hashes are untouched. Restore and redeploy.
- **Production:** `pause` → `upgrade` each contract back to its previous wasm
  hash → `migrate_config` with the 11-field JSON is **not possible** (the old
  wasm can't take the new arg), so instead: upgrade back to old wasm, whose
  `get_config` reads the 15-field map… which also traps. **Therefore: verify on
  staging first.** The clean production rollback is `set_noeracle_oracle` /
  `set_noeracle` back to `CAYIP67…` (oracle only) — the Phase-2 contract
  changes are one-way once migrated.

---

## Post-cutover: arming the extras

**Stork** (needs the key + two answers from sales@stork.network):
```bash
cd scripts/keeper && STORK_API_KEY=<token> npm run stork:check   # validates key + entitlement
```
Then set `STORK_API_KEY` in the keeper env (both copies) for off-chain
cross-validation. For the on-chain layer you need Stork's Fast **taxonomy ids**
for our 14 pairs and the **signer address** for our instance:
```bash
stellar contract invoke --id $ROUTER ... -- set_stork_assets --ids '[0,1,…]' --tags '["4254435553440000",…]'
stellar contract invoke --id $ROUTER ... -- set_stork_config \
  --config '{"enabled":true,"require_fresh":false,"signer":"<20-byte hex>","taxonomy":<id>,"max_age_secs":60,"max_dev_bps":100}'
```

**Health monitoring:**
1. api env: `KEEPER_HEARTBEAT_SECRET=$(openssl rand -hex 32)`
2. keeper env (both copies): `KEEPER_HEARTBEAT_URL=https://<api>/v1/oracle/heartbeat` + the same secret
3. Point UptimeRobot/BetterStack at `GET /v1/oracle/health`, alert on `status != "ok"`.

**Chainlink-readiness (nothing to do now):** when a standard SEP-40 feed is
preferred, one call swaps the vendor with automatic decimal rescaling —
`shim.set_backend(mode=1, oracle=<sep40 addr>, decimals=<theirs>)`. The
market's oracle slot never changes.
