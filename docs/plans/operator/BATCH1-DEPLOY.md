# Batch-1 deploy runbook — staging first, then prod

The ceremony that activates every P0/P1 contract gate at once. Two runs of
the same script (`scripts/deploy_batch1.sh staging|prod`); staging must be
verified before prod is touched. Everything on Azure Container Apps —
nothing auto-deploys from GitHub.

## Prerequisites (once)

1. **Founder review of the Noeracle quorum branch** — `REVIEW-L08-L09.md`
   at the Noeracle repo root. No deploy before approval.
2. `origin/staging` green on the commit being deployed (the script builds
   from the working tree — check out the reviewed commit).
3. Fill `.env.batch1.staging` (the script writes a template on first run):
   - `B1_ADMIN_SECRET_KEY` — staging admin (GCW7CE…), prod: `noether_admin`.
   - `B1_NOERACLE_ID` — from step 1 below.
   - Arming values: Stork Fast signer EVM addr + taxonomy + asset-id map
     (see `scripts/keeper/.env` / the T3-D1 notes), Reflector testnet
     SEP-40 id (the keeper's `REFLECTOR_CONTRACT_ID` default is the same
     contract).

## Ceremony order (per environment)

### 1. Fresh Noeracle (Noeracle repo)

```bash
cd ~/Desktop/Stellar/Noeracle          # branch feat/l08-l09-quorum-ring
./scripts/deploy_oracle_v0.sh testnet  # init registers the publisher key
```

The script prints the new id → put it in `.env.batch1.<env>` as
`B1_NOERACLE_ID`. Quorum defaults to 1 (single publisher, staged rollout);
the batch publish path stays open at quorum 1, so the keeper keeps
publishing unchanged. **Do NOT `set_quorum` above 1** until the multi-key
publish loop exists — the guard added in `fcec0ee` closes the keeper's
publish path the moment quorum exceeds 1.

### 2. The Noether stack

```bash
./scripts/deploy_batch1.sh staging     # or: prod
```

What it does, in order: NOE SAC → deploy shim/vault/market/router/factory/
referral → init (vault+market ABI-coupled; full 28-field MarketConfig at
code defaults) → `set_referral` → `set_fee_split(treasury, 2000)` →
risk ladder ×14 → guard arming (staging: Stork+Reflector enabled, BTC/ETH
strict; prod: configs stored **disabled**) → NOE pre-mint → vault LP seed +
insurance buffer (prompted; `deposit`, never transfer — #40) → manifest
(`contracts.staging.json` / `contracts.json`) → prints the propagation
checklist. Resumable: every id persists into `.env.batch1.<env>`; re-run
after a mid-ceremony failure and it continues.

> **Ladder note (flag for Yahya):** the L0-12 validation floors im at 400
> bps with mm = im/2, so maintenance margin moves **1% → 2%** at Batch-1.
> Exact parity with the old global 100 bps is impossible by design.

### 3. Propagation (printed by the script)

Keeper / api / indexer via `az containerapp update --set-env-vars`, then
`npm -w @noether/indexer run migrate`; web via
`./scripts/deploy_web_azure.sh <env>` after updating
`web/.env.azure.<env>.local` (NEXT_PUBLIC ids are build-time); local `.env`
by hand. Keeper wallet needs USDC + the fresh NOE issuer trustline.

### 4. Verify (staging gate before prod)

Chain-side (script already checks router→market + `referral_v1`):

- Keeper logs: hardened-Noeracle boot guard passes, `Router ABI: v2
  (Batch-1 quorum struct)` on first execution, 14-asset batch push lands.
- Test-key smoke: router-path open + close (struct tail), partial close,
  an open with a deliberately-tight acceptable price → #87 revert,
  referral bind → trade → claim, `shim.twap` returns after ~4 pushes,
  factory create_vault, `pause(1)` blocks opens / allows closes →
  `unpause`.
- Web (wallet clicks): capability probes flip TRUE — close-modal pills,
  margin modal, Max Slippage on the Market tab, referral claim card live.
- Gateway: `/v1/health` shows the new addresses + `market.pauseState
  supported:true`; `/v1/adl/queue` serves; vault detail carries `navFull`.

### 5. Prod differences

- Guards stored **disabled** — arm Stork/Reflector `enabled:true` and the
  strict list only after a clean soak (router setters, no redeploy).
- **Prod keeper replacement** (Yahya-confirmed 2026-07-21): roll the
  `noether-keeper` app to the `noether-keeper-t3` image with the Batch-1
  envs per `docs/plans/operator/L0-7-prod-keeper-noeracle-repoint.md`. The
  legacy `noetherkeeperbotv2` folder stays untouched as archive.
- Re-faucet testers (Yahya distributes; USDC token unchanged).

## Rollback

The old stack stays deployed — rollback = flip the env vars/manifest back
to the previous addresses and re-roll web images. Nothing is destroyed by
the ceremony; the fresh stack simply stops receiving traffic.

## After both ceremonies

- Update `CLAUDE.md` address table + memory ledgers.
- Post-soak arming (prod): `set_stork_config enabled:true`,
  `set_reflector_config enabled:true`, `set_stork_strict_assets`.
- Later, gated on more publisher keys: multi-key publish loop, then
  `set_quorum(2)` — at which point the keeper MUST publish via
  `update_quorum_ed25519_persistent` (the batch path closes itself).
