# Oracle Cutover Runbook — hardened Noeracle + dual-source (T3 Phase 1)

One coordinated pass that takes the whole stack from the unhardened Noeracle
instance (`CAYIP67…`, anyone can write prices) to the hardened batch
entrypoint, with the Stork second source and the health surface ready to arm.

**What changes on-chain:** a fresh Noeracle deployment (new address) and
in-place WASM upgrades of the shim + router (addresses UNCHANGED — the
market, tx-builders, web, and SDKs never notice). What changes off-chain:
keeper code + one env var, both keeper copies.

**Expected impact during the window:** none for web trading (all web trades
go through the router, which relays a fresh price in-tx). Only the keeper's
background heartbeat pushes fail between the env flip and its code deploy —
direct `shim.lastprice` reads can go stale then, which halts nothing that
matters on testnet. Closes and liquidations keep working throughout.

---

## Preconditions

- Noeracle repo at/after `2770e44` (hardened batch entrypoint, CI green).
- Noether `staging` at/after the Phase-1 oracle commits (router batch +
  Stork verify + shim backend + health surface); `cargo test` green.
- `stellar` CLI authenticated with `noether_admin`; Noeracle `.env` has
  `NOERACLE_ADMIN_SECRET` + `NOERACLE_PUBLISHER_PUBLIC_HEX`.

## Step 1 — Deploy the hardened Noeracle (operator)

```bash
cd /Users/yahya/Desktop/Stellar/Noeracle
./scripts/deploy_oracle_v0.sh          # testnet
```

The script refuses any wasm still exporting a bench entrypoint, deploys,
runs `init(admin, [publisher])`, and prints `NEW_NOERACLE`. Record it.

## Step 2 — Upgrade shim + router in place (addresses unchanged)

```bash
cd /Users/yahya/Desktop/Stellar/Noether
./scripts/build_contracts.sh           # builds + optimizes all wasm

# Install the new wasms and upgrade (repeat per contract):
SHIM_HASH=$(stellar contract install --wasm contracts/target/wasm/noeracle_shim.wasm \
  --source noether_admin --network testnet)
stellar contract invoke --id <SHIM_ID> --source noether_admin --network testnet \
  -- upgrade --new_wasm_hash $SHIM_HASH

ROUTER_HASH=$(stellar contract install --wasm contracts/target/wasm/noether_router.wasm \
  --source noether_admin --network testnet)
stellar contract invoke --id <ROUTER_ID> --source noether_admin --network testnet \
  -- upgrade --new_wasm_hash $ROUTER_HASH
```

Storage is preserved; the new DataKeys (backend mode, Stork config) are
absent-by-default = features off = behavior identical until armed.

## Step 3 — Repoint both at the new Noeracle

```bash
stellar contract invoke --id <SHIM_ID> --source noether_admin --network testnet \
  -- set_noeracle_oracle --new_oracle <NEW_NOERACLE>
stellar contract invoke --id <ROUTER_ID> --source noether_admin --network testnet \
  -- set_noeracle --new_noeracle <NEW_NOERACLE>
```

From this moment router-relayed trades use the hardened entrypoint. The
keeper heartbeat (old code, old address) still writes the OLD instance —
harmless; nothing reads it after Step 3.

## Step 4 — Keeper cutover (both copies)

**Monorepo (dev):** set `NEXT_PUBLIC_NOERACLE_ID=<NEW_NOERACLE>` in `.env`,
update `contracts.json` → `"noeracle"`, restart the keeper.

**Production (`noetherkeeperbotv2`, Railway auto-deploys on push):**
1. Sync code: replace `src/` with the monorepo `scripts/keeper/src/`
   (drops the retired `deploy-test-token.ts` / `seed-oracle.ts`), align
   `package.json` deps, commit locally. Get an explicit go before pushing.
2. Set Railway env `NEXT_PUBLIC_NOERACLE_ID=<NEW_NOERACLE>` (+ optional new
   vars below).
3. Push → Railway builds + deploys. The failed-push window ends when the
   new build is live (≤ ~5 min; web trading unaffected, see header).

## Step 5 — Validate

```bash
cd scripts/keeper
npm run noeracle:check     # happy path + BOTH negative checks must pass:
                           #   unregistered publisher rejected
                           #   stale round rejected
npx ts-node src/test-trade.ts   # open + close through the router
curl -s https://<api>/v1/health | jq .contracts.noeracle   # echoes NEW address after env update
curl -s https://<api>/v1/oracle/health | jq .status        # "ok" once pushes resume
```

Also confirm the frontend trades normally (staging.noether.exchange).

## Rollback

Old instance and old keeper code remain intact:
`set_noeracle_oracle`/`set_noeracle` back to `CAYIP67…`, revert the keeper
env + v2 push. (The shim/router wasm upgrades are backward-compatible with
the old instance's interface only via the OLD keeper code path — so a full
rollback reverts the v2 push too.)

> Note: the router's new `refresh_price` calls the batch entrypoint, which
> the OLD instance does not export — after rolling addresses back, also
> `upgrade` the router to the previous wasm hash if trades must flow
> through the old instance again. Full rollback = all four levers.

---

## Post-cutover: arming the extras (any time later)

**Stork (needs the API key + answers from sales@stork.network):**
1. `STORK_API_KEY=<token> npm run stork:check` — validates key + entitlement.
2. Keeper env: `STORK_API_KEY` (+ optional `STORK_MAX_DIVERGENCE_PCT`,
   `STORK_MAX_AGE_MS`) → off-chain cross-validation live (both copies).
3. On-chain layer (needs Fast taxonomy ids + signer address from Stork):
   ```bash
   stellar contract invoke --id <ROUTER_ID> ... -- set_stork_assets \
     --ids '[0,1,…]' --tags '["4254435553440000",…]'
   stellar contract invoke --id <ROUTER_ID> ... -- set_stork_config \
     --config '{ "enabled": true, "require_fresh": false, "signer": "<20-byte hex>", \
                 "taxonomy": <id>, "max_age_secs": 60, "max_dev_bps": 100 }'
   ```
   Then wire the keeper to relay Fast `signed_ecdsa` payloads via
   `relay_stork` (small task, needs the Fast WS entitlement).

**Health surface:**
1. api env (Railway): `KEEPER_HEARTBEAT_SECRET=<openssl rand -hex 32>`.
2. Keeper env (both copies): `KEEPER_HEARTBEAT_URL=https://<api>/v1/oracle/heartbeat`,
   `KEEPER_HEARTBEAT_SECRET=<same>`.
3. Point UptimeRobot/BetterStack at `GET /v1/oracle/health` (alert on
   `status != "ok"` via keyword monitoring).

**Chainlink-readiness (nothing to do now):** when a standard SEP-40 feed is
preferred, one admin call swaps the vendor with automatic decimal rescaling:
`shim.set_backend(mode=1, oracle=<sep40 addr>, decimals=<theirs>)` — the
market's oracle slot never changes.
