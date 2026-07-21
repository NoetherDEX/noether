# Self-2-of-3 admin + dark mainnet deploy — the ceremony

Founder decisions (2026-07-22): no organizational multisig — a **self-2-of-3**
where all three keys are Yahya's, on three separate media. Mainnet deploys
**dark** (paused + unfunded) while the audit runs; findings land via
`upgrade()`; unpause + fund + `LAUNCH_GATE=0` after the report.

## The three keys

| Key | Where it lives | Role |
|-----|----------------|------|
| **K1** | Laptop CLI keystore (`batch1_mainnet_admin`) | Daily driver: builds every admin tx, first signature. Also the account master key. |
| **K2** | Phone wallet (Freighter mobile or LOBSTR) — generated **on the phone**, secret never touches a computer | Second signature: Lab → Transaction Signer on the phone. |
| **K3** | Paper (or metal), in a safe. Generated once, written down, deleted from every device | Recovery only: stands in for a lost/broken K1 or K2. |

Thresholds low/med/high = **2/2/2**, all signers weight 1 → any two keys act,
no single device can, losing any one device loses nothing.

## Human prep (Yahya, ~15 minutes, before the ceremony)

1. **K1**: `stellar keys generate batch1_mainnet_admin` on the laptop. This
   account IS the mainnet admin — **fund it with ~100 XLM** (covers ~2 XLM
   locked reserves, WASM uploads + rent for 7 contracts, ~40 setter txs, the
   NOE issuer's 3 XLM, margin for retries; real costs get recorded per step).
2. **K2**: create a NEW account inside the phone wallet app. Send me only its
   **public key** (G…). Its secret stays on the phone forever.
3. **K3**: `stellar keys generate k3_backup` → run `stellar keys show
   k3_backup` ONCE, copy the S… secret to paper by hand, verify by re-reading,
   then `stellar keys rm k3_backup`. Paper goes in the safe. Send me the
   public key.
4. Fill `.env.batch1.mainnet` (template auto-writes on first script run):
   `B1_ADMIN_SECRET_KEY` = K1 secret, `B1_MULTISIG_K2_PK`, `B1_MULTISIG_K3_PK`,
   `B1_NOERACLE_ID` (mainnet Noeracle — deployed first from the Noeracle repo
   with `./scripts/deploy_oracle_v0.sh mainnet`), and `B1_USDC_TOKEN_ID` =
   **Circle's mainnet USDC SAC** — derive with
   `stellar contract asset id --asset USDC:<circle issuer> --network mainnet`
   and verify the issuer address against circle.com/usdc's official docs
   (the script refuses the testnet USDC id on mainnet).

## Why the ceremony is friction-free

K1 starts as a plain 1-of-1 account, so the **entire deploy runs single-sig
and fully scripted** — K1 is the admin from `initialize` onward, no
deployer→admin handover, no multi-party auth entries. The 2-of-3 flip is the
LAST step: two `set-options` transactions, with the threshold raise in the
same tx as the final signer, so there is never a lockout window. After that,
K1 alone is powerless.

## Ceremony order (`./scripts/deploy_batch1.sh mainnet`)

1. Noeracle mainnet deploy (Noeracle repo) → id into the env file.
2. The script: NOE SAC (fresh issuer, funded via create-account — no
   friendbot on mainnet) → 6 contract deploys → inits → referral wiring →
   risk ladder ×14 → guards stored **disabled** (mainnet launches fail-open;
   arming comes post-audit with the relay infra) → NOE pre-mint → **funding
   prompts: skip** (dark = unfunded, zero OI capacity) → `contracts.mainnet.json`.
3. **Lockdown (mainnet-only step 10)**:
   - `pause(1)` — dark. Opens/deposits blocked; the unpause after the audit
     will itself need two signatures.
   - **NOE issuer lock** (master weight 0) — supply fixed at the 1B pre-mint
     forever. An unlocked LP-share issuer is a vault-drain key; this is
     deliberate and IRREVERSIBLE.
   - **2-of-3 flip** — add K2, then K3 + thresholds 2/2/2 in one tx.
4. Immediately after: one **drill op** via `./scripts/sign2.sh` (e.g. a
   harmless `get_pause_state`-adjacent admin no-op like re-setting the
   existing buffer target) to prove the two-signature flow end-to-end while
   everything is calm.

## Day-to-day admin ops after the flip

`./scripts/sign2.sh <contract> <fn> -- <args…>` → signs K1 → shows the XDR →
you sign on the phone (Lab → Transaction Signer → Mainnet → paste → sign) →
paste back → submitted. Two commands and a phone tap.

## Recovery drills (do each once, on paper at least)

- **Phone lost**: K1 + K3 sign (type the paper secret into Lab ONCE on a
  trusted machine, sign, then treat K3 as semi-burned → rotate a fresh K2
  from the new phone and swap the signer set via a 2-sig set-options).
- **Laptop lost**: K2 + K3 sign a set-options adding a fresh K1' and removing
  the old master (weight 0) — the account survives the laptop.
- **Paper destroyed**: while K1+K2 healthy, 2-sig a set-options swapping in a
  fresh K3'. Do this the day you notice, not later.

## What stays hot (and powerless)

Keeper, Stork-relay, and indexer keys remain ordinary hot ops keys with zero
admin authority, exactly as on testnet. The dark stack runs **no keeper** —
oracle pushes and relays only start at launch (with mainnet-tuned cadence:
deviation-triggered + slow heartbeat, since every push costs real XLM).

## After the audit (launch day, all 2-sig)

Findings via `upgrade()` per contract → params to launch values (deposit caps
ON, OI caps sized to the real LP) → vault LP seed + insurance buffer (real
USDC) → `unpause` → keepers on with mainnet cadence → merge staging→main →
mainnet web build (`NEXT_PUBLIC_STELLAR_NETWORK=mainnet`, faucet-free) →
`LAUNCH_GATE=0` on noether.exchange.
