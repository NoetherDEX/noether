# L0-16 operator draft — multisig staging drill (Variant B)

> The mandatory rehearsal before the mainnet 2-of-3 ceremony (Variant A, docs/plans/P0-mainnet-gates.md · L0-16). Target: the **STAGING admin** `GCW7CENKM65B2MVMVJOQCFBZDGZ7FEK2WAKXCHLUUQKIAYKFYWC6KEVO` (contracts.staging.json) — verified DISTINCT from the prod/testnet admin `GCKIUO…LOLN`, so the Vercel faucet and prod deploy tooling are untouched by this drill.
>
> What the drill proves: (1) SetOptions retrofit order-of-operations, (2) a Soroban admin invoke fails single-signed and succeeds dual-signed, (3) the timed 2-signer pause flow (< 15 min target), (4) rotation/rollback by the remaining signers. Record timings inline; the mainnet ceremony copies this file with the fresh mainnet account.
>
> ⚠️ Two rules that prevent self-lockout: **add signers BEFORE raising thresholds** (one tx, ops in order), and **never set thresholds above 2** (a lost key must not brick rotation).

## 0. Preconditions

- [ ] `stellar` CLI ≥ 23 installed; `.env.staging` at repo root has `STAGING_ADMIN_SECRET_KEY` (drill signer #1 = the account master key)
- [ ] Nothing mid-deploy on staging (a threshold change mid-`deploy_staging.sh` would strand it); tell Mert the staging admin goes 2-of-3 for the drill window
- [ ] Two additional keypairs generated on SEPARATE devices (Yahya's machine ≠ Mert's machine; the drill can use throwaways, the mainnet ceremony must not):

```bash
# Yahya's machine (drill key 2 — stands in for K_mert)
stellar keys generate drill_k2 --no-fund && stellar keys address drill_k2
# Mert's machine (drill key 3 — stands in for K_backup; can be the same machine for the drill ONLY)
stellar keys generate drill_k3 --no-fund && stellar keys address drill_k3
```

Record: `K2_PUB=G…` `K3_PUB=G…`

## 1. Retrofit — ONE SetOptions transaction, operations in this exact order

```bash
set -a; source .env.staging; set +a
ADMIN_PUB=GCW7CENKM65B2MVMVJOQCFBZDGZ7FEK2WAKXCHLUUQKIAYKFYWC6KEVO

# one tx, three ops: add K2 → add K3 → weights+thresholds LAST
stellar tx new set-options --source-account "$STAGING_ADMIN_SECRET_KEY" \
  --signer "ed25519PublicKey:$K2_PUB" --signer-weight 1 --build-only \
| stellar tx op add set-options --signer "ed25519PublicKey:$K3_PUB" --signer-weight 1 \
| stellar tx op add set-options --master-weight 1 --low-threshold 2 --med-threshold 2 --high-threshold 2 \
| stellar tx sign --sign-with-key "$STAGING_ADMIN_SECRET_KEY" \
| stellar tx send
```

(If the CLI pipeline syntax fights you, the equivalent single-tx build via Stellar Lab / a 10-line JS script is fine — the invariant is ONE transaction with the threshold op LAST.)

- [ ] Verify on Horizon — expect three weight-1 signers and `{low:2, med:2, high:2}`:

```bash
curl -s https://horizon-testnet.stellar.org/accounts/$ADMIN_PUB | jq '{signers: .signers, thresholds: .thresholds}'
```

Drill timing — retrofit start → verified: ____ min

## 2. Negative test — single-signed admin op MUST fail

```bash
# classic op, single-signed → expect txBadAuth
stellar tx new set-options --source-account "$STAGING_ADMIN_SECRET_KEY" --home-domain "drill.invalid" --build-only \
| stellar tx sign --sign-with-key "$STAGING_ADMIN_SECRET_KEY" | stellar tx send   # EXPECT: txBadAuth

# Soroban admin invoke, single-signed → expect txBadAuth
# (vault pause is the drill op — reversed 60s later in step 3; staging only)
VAULT=$(jq -r .contracts.vault contracts.staging.json)
stellar contract invoke --id $VAULT --source-account "$STAGING_ADMIN_SECRET_KEY" \
  --network testnet -- pause   # EXPECT: txBadAuth
```

- [ ] Both failed with `txBadAuth`: ____

## 3. Timed 2-signer pause drill (the incident-response rehearsal)

Start a timer at "incident declared". Signer 1 builds + signs, sends XDR to signer 2 (Signal/AirDrop), signer 2 signs + submits:

```bash
# signer 1
stellar contract invoke --id $VAULT --source-account $ADMIN_PUB --network testnet --build-only -- pause \
| stellar tx sign --sign-with-key "$STAGING_ADMIN_SECRET_KEY" > /tmp/pause_1sig.xdr
# transfer /tmp/pause_1sig.xdr to signer 2's machine
# signer 2
cat /tmp/pause_1sig.xdr | stellar tx sign --sign-with-key drill_k2 | stellar tx send
```

- [ ] Pause landed; wall-clock from "declared" → confirmed on-chain: ____ min (target < 15)
- [ ] Immediately unpause the same dual-sign way; staging vault confirmed unpaused (a deposit simulates clean): ____
- [ ] Record the measured duration in docs/INCIDENT_RUNBOOK.md (pause section) — until L0-15 lands, pause blocks LP withdrawals too, so speed matters twice

## 4. Rotation rehearsal + rollback (leaves staging tooling single-sig again)

Rotation: pretend K3 is compromised — the remaining two replace it:

```bash
stellar tx new set-options --source-account $ADMIN_PUB --build-only \
  --signer "ed25519PublicKey:$K3_PUB" --signer-weight 0 \
| stellar tx sign --sign-with-key "$STAGING_ADMIN_SECRET_KEY" \
| stellar tx sign --sign-with-key drill_k2 \
| stellar tx send
```

Rollback to pre-drill state (so `deploy_staging.sh` and day-to-day staging ops stay single-sig until the real ceremony):

```bash
stellar tx new set-options --source-account $ADMIN_PUB --build-only \
  --signer "ed25519PublicKey:$K2_PUB" --signer-weight 0 \
| stellar tx op add set-options --low-threshold 0 --med-threshold 0 --high-threshold 0 --master-weight 1 \
| stellar tx sign --sign-with-key "$STAGING_ADMIN_SECRET_KEY" \
| stellar tx sign --sign-with-key drill_k2 \
| stellar tx send
curl -s https://horizon-testnet.stellar.org/accounts/$ADMIN_PUB | jq '{signers: .signers, thresholds: .thresholds}'
```

- [ ] Exactly one weight-1 master signer remains; thresholds 0/0/0; a single-signed staging admin op succeeds again: ____

## 5. Write-up (gates the mainnet ceremony)

- [ ] All timings + surprises recorded in this file; anything that fought the CLI gets its exact working command pasted back into the corresponding Variant A step
- [ ] scripts/multisig_ceremony.sh drafted from the exact commands that worked (idempotent: skip-if-already-signer, threshold op last, Horizon verify, negative test)
- [ ] Mainnet prerequisites confirmed understood: fresh admin account (rotate away from G…LOLN), faucet split BEFORE any prod-admin threshold change, ceremony BEFORE mainnet `initialize` (market/factory/referral cannot re-point admin — no set_admin)

Drill executed by: ____ + ____ · Date: ____
