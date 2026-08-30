# Mainnet v1 Launch Runbook

The operational script for taking Noether v1 to mainnet: go/no-go gate,
multisig setup, ceremony (rehearsal + real), post-deploy wiring, restore and
rollback procedures, wave operations. Design authority:
`docs/superpowers/specs/2026-08-18-mainnet-v1-launch-design.md`; findings
ledger: `audit/remediation/REGISTER.md`; incident play: `docs/INCIDENT_RUNBOOK.md`.

Sequencing rule (Ashley/SCF-agreed): **freeze → third-party audit → remediate
→ submit tranche with the report attached → ceremony → waves.** The firm's
confirmed start date is the freeze deadline.

---

## 1 · Go/No-Go checklist (all boxes or no launch)

- [ ] `contracts-v1.0.0` tag: firm-audited, criticals remediated, re-tagged rcN → final
- [ ] `audit/release/v1/` pinned: commit, per-contract WASM hashes, config snapshot, trust-model + key-management docs, known limitations
- [ ] Public contracts mirror live with the audited tag (gitleaks history sweep BEFORE it goes public) + StellarExpert verification wired
- [ ] **Mainnet Noeracle live**: deployed on mainnet with O-1 publisher-auth
      ENFORCED, keeper key allowlisted and publishing, shim pointed at it,
      fresh feeds verified for every launch pair — the ceremony deploys our
      shim/router but assumes this dependency underneath
- [ ] Oracle: mainnet publisher set decided **incl. the XLM source** (Stork entitlement or Reflector/CEX path), deviation bands + last-good configured
- [ ] **Paid Soroban RPC** endpoint chosen + `SOROBAN_RPC_URLS` set for the
      mainnet keeper/indexer/gateway (public RPC is not keeper-grade — `docs/RPC.md`)
- [ ] **ADMIN_WALLETS rotated** off the temp wallet and set on the mainnet
      gateway (the waitlist admin surface follows the wallet, not the env)
- [ ] Multisig ready (§2) and **rehearsal completed on testnet (§3) with the same keys**
- [ ] Seed capital in hand (~$1.5–2k: LP seed + insurance buffer + 2 jury prefunds)
- [ ] Monitoring live: keeper heartbeat/dead-man, oracle staleness, TTL-bump failure paging (P3-9 already alerts), gateway 5xx, wallet-XLM alarm (P3-10)
- [ ] **Custody invariant** (2026-08 funding-drain class): `GET /v1/markets/stats` → `custody.deficit == "0"` and `custody.stale == false` on the mainnet gateway; the keeper's "Market custody below tracked collateral" alert wired to the pager; `funding_clamp_bps ≤ 10` and `max_funding_velocity_bps ≤ 240` on every pair (`scripts/funding_params.sh <market> <admin>` prints the ladder); market conservation tests green (`cargo test -p market -- receiver reseed_funding`)
- [ ] `/terms` reviewed for public launch; waitlist + admin panel operating (live since 2026-08-20)
- [ ] API-surface pentest pass (gateway REST/WS, key issuance, admin waitlist
      routes) — the Audit Bank engagement scopes contracts + Noeracle only;
      the web gateway needs its own adversarial pass before mainnet
- [ ] Mainnet infra stood up (§5): `-mainnet` app instances + `noether_mainnet` DB

## 2 · Multisig setup (SEC-3 / P3-8)

Three fresh seed phrases exist on paper (2026-08). Only **wallet #1** ever
needs funding (~100 XLM covers every upload/deploy/init with headroom);
wallets #2/#3 are signers only — signatures cost nothing, no accounts needed.

1. Fund wallet #1 on mainnet. It becomes the admin account.
2. Add signers + thresholds (any Stellar tooling; via CLI, two `set_options`):
   signer #2 weight 1, signer #3 weight 1, master weight 1,
   thresholds low/med/high = 2. Result: **2-of-3** on every admin op.
3. Verify: fetch the account, confirm 3 signers and thresholds 2/2/2 BEFORE
   any contract references this address.
4. Record the setup (pubkeys only) in `audit/release/v1/key-management.md`.
5. When Mert returns: he generates his OWN key on his own device; swap it in
   for signer #3 with one `set_options` (needs 2 signatures). Dossier records
   the two-person-control date.

Never let any of the three seeds touch a server. Keeper/operational keys stay
separate low-privilege hot wallets.

## 3 · Ceremony rehearsal (testnet, mandatory)

Full dry-run **with the actual multisig keys** on testnet before mainnet day.
The 2026-08-19/20 staging+prod in-place upgrades established the verify
pattern; the rehearsal adds the multisig signing path:

1. Deploy the audited WASM to fresh testnet ids with wallet #1 as admin.
2. Run the §4 ceremony end-to-end, including a 2-signature admin op
   (e.g. `set_aum_cap`) to prove the multisig signing workflow.
3. Team smoke trades: open/close/liquidate at tiny size; LP deposit/withdraw
   with min-out bounds; a referral-discounted fee event.
4. Abort criteria: ANY hash mismatch or admin-verify failure = stop, fix,
   restart the rehearsal from scratch.

## 4 · Mainnet ceremony

Per contract, in this order — market, vault, shim, router, factory,
referral (vault before market wiring; shim/router before market init points
at them). **v1 ships SIX contracts (decision 2026-08-22):** `contracts/risk`
stays in the tree but is NOT deployed or audited — it was designed for the
old 64KB WASM ceiling; the 128KB limit let partial-liq/ADL live in-market,
and per-pair risk config is the market's own `set_asset_risk` ladder. It can
be deployed and wired post-v1 through the normal upgrade path if ever needed.

1. **Upload** each audited WASM: `stellar contract upload --wasm <file>` —
   record every hash; each MUST equal the dossier hash before proceeding.
2. **Deploy + initialize back-to-back** (R-3: the arbitrary-admin init race)
   and **immediately verify `get_admin` == the multisig address** on every
   contract. The market has no `get_admin` view (WASM-trimmed): verify its
   admin on StellarExpert's contract-storage tab and via the multisig-signed
   init tx itself. Mismatch = abort that contract, redeploy. No funding, no
   config, no announcements before all six admin checks pass.
3. **Hash-verify deployed code**: `stellar contract fetch --id <addr>` →
   sha256 == dossier hash, all six. (Same check pattern used 2026-08-20 on
   the testnet release — 6/6.)
4. **Configure** (2-of-3 signed):
   - Market `migrate_config`/init config: launch caps table from the spec —
     leverage 5x (raise to 10x post-soak by invoke), max position $25k,
     min collateral 10 USDC, fee tiers at mainnet thresholds; then
     `set_asset_risk` per launch pair (the in-market risk ladder — see
     `deploy_batch1.sh` step 5 for the shape).
   - Vault: `set_deposit_cap` ($10k/account), `set_aum_cap` ($250k),
     `set_shortfall_inflow_bps`, withdraw cooldown; wire USDC = **Circle's
     mainnet USDC SAC**, market address, fees.
   - Factory: `set_max_vaults 50` and/or `set_leader_allowlist` (R-2).
   - Router: publishers, price bands, stork/reflector guard configs.
   - Every setter now emits an event (R-13) — the ceremony is chain-auditable.
5. **NOE token** (R-5 decision): create asset from the fresh mainnet issuer,
   SAC-wrap, pre-mint the full fixed supply to the vault, then
   **(recommended) lock the issuer** (master weight 0) — supply provably
   immutable, closes ALX-08 outright. If mint flexibility is kept instead:
   issuer goes under the 2-of-3 and the dossier documents the invariant.
6. **Seed** (multisig-signed): LP seed $1,000–1,500 via `deposit` (never bare
   transfer — #40), insurance buffer $200–300 via `seed_buffer`; verify
   `get_aum` and `get_buffer_balance` read back exactly.
7. **Initial TTL pin**: run one keeper `maybeBumpTtls` cycle (or manual
   `ExtendFootprintTtlOp`) over every new address; from then on the P3-9 duty
   (6h cadence, instance+code, auto-covers contracts.json) owns it.
8. **Snapshot**: `./scripts/snapshot_config.sh mainnet audit/release/v1/config-snapshot.json`
   — 49-entry JSON across all six contracts (first proven against the prod
   testnet stack 2026-08-22, zero errors).
9. **Smoke trades** with team wallets (tiny sizes): open → close → a forced
   liquidation → LP round-trip → referral fee event. All green before any
   external wallet is approved.

## 5 · Post-deploy wiring

- `contracts.mainnet.json` (new manifest) + repo commit.
- **New Azure apps** (testnet stack keeps running untouched):
  `noether-api-mainnet`, `noether-indexer-mainnet`, `noether-keeper-mainnet`
  — images from the release tag, `NETWORK=mainnet`, mainnet RPC URLs
  (PAID endpoint per `docs/RPC.md` — public RPC is not keeper-grade).
- **New DB** `noether_mainnet` on noether-pg-northeurope; run indexer
  migrations; **copy `access_grants` + `access_audit_log`** from the testnet
  DB (the waitlist/approvals carry over); point the mainnet gateway at it.
- Web: prod build values switch to mainnet addresses + mainnet gateway URL;
  `testnet.noether.exchange` stays on the testnet stack as the free
  playground (waitlist CTA already on its teaser page).
- Keeper: `noether-keeper-mainnet` from the monorepo keeper image (both
  testnet keepers already run it), with a FRESH dedicated mainnet key
  (never a testnet key — assume those are burned), funded XLM + USDC
  trustline + the P3-10 refill alarm.
- Mainnet web build values (beyond addresses + gateway URL):
  `NEXT_PUBLIC_ADMIN_ENABLED=1` (without it `/admin` 404s and §8 wave ops
  break), `NEXT_PUBLIC_NETWORK_LABEL=mainnet` (flips leaderboard scope,
  hides the testnet ribbon, arms the faucet 404 guard), Umami vars (same
  site id or a separate mainnet website). Keep `web/.env.azure.mainnet.local`
  backed up OUTSIDE the repo — these values exist nowhere else.
- The mainnet web app gets **NO admin/faucet secrets** (`ADMIN_SECRET_KEY`
  stays testnet-only); the faucet page and its API routes 404 on mainnet
  builds by the `IS_MAINNET_BUILD` guard.

## 6 · Restore procedure (R-1.3 — archived-entry recovery)

Should any persistent/instance entry ever archive (P3-9 + in-contract R-1
re-arming make this a double-failure scenario): **nothing is lost.** Archived
entries are recoverable by anyone willing to pay rent:

1. Symptom: transactions touching the contract fail with an entry-archived /
   restore-needed error; modern RPC simulation returns `restorePreamble` and
   SDK-built transactions auto-prepend the restore — user flows largely
   self-heal.
2. Manual restore: build a transaction with `RestoreFootprintOp` whose
   Soroban data lists the archived keys in `readWrite`, then re-extend via
   the keeper's bump (`bumpContractTtl` covers instance+code).
3. Afterwards: page-review WHY the P3-9 duty missed it (its failure alert
   should have fired long before archival).

## 7 · Rollback & incident

- **Pause**: market pause buckets gate risk-increasing ops; withdrawals stay
  open (exit-only philosophy, L0-15). `claim_shortfall` is never pause-gated.
- **Code rollback**: `upgrade()` back to the previous audited WASM hash (kept
  in the dossier) — same one-tx path as forward upgrades. Check the
  storage-compat note in `market::upgrade` docs (config-shape changes need
  `migrate_config`).
- **Never ship an upgrade whose WASM lacks `upgrade()`** — verify the
  interface of the new build BEFORE invoking (one-way door).
- **Every in-place upgrade (testnet included) ends with a smoke trade** —
  tiny open + close on the upgraded stack before declaring done. Hash
  verification proves the code, not the state: on 2026-08-20 the R-4 belt
  correctly bricked all opens for ~24h on pre-existing vault drift that
  hash checks could never see (see REGISTER.md R-4 incident note).
- **…and with a footprint check** — `npx tsx packages/tx-builders/scripts/footprint-check.ts <env> <positionId> <trader> <ASSET> --raw --expect post`
  on a live position proves the upgraded vault/market declare their
  balance-gated keys read-write (the 2026-08-30 stale-footprint trap,
  KNOWN_ISSUES C-4). A pre-fix shape (`TotalFees` absent, `ShortfallReserve`
  read-only) means the wrong WASM is live.
- Full incident flow: `docs/INCIDENT_RUNBOOK.md`.

## 8 · Wave operations

**PII hygiene:** email deletion requests are honored via `/admin` → select the
wallet → "Forget email" (audit-logged `forget_email`; access status keeps
working). CSV exports contain raw emails — treat each export as a temporary
working copy and delete the file after use; every export is itself
audit-logged.

1. Wave-1: approve the jury + team wallets in `/admin` (wave tag `wave-1`),
   prefund jury wallets (~100 USDC + a few XLM each), jury script: trade
   20 USDC @ 5x, optional $20–50 LP try (NOE trustline step included).
2. Soak ≥ 1 week. Watch: liquidation events settle, funding applies, no
   receipt-check (#42) or min-out (#66) alarms in anger, shortfall ledger
   stays empty.
3. Raise caps by admin invoke (leverage 5x→10x, deposit caps up) — cheap
   `set_*` calls, no upgrades. Approve wave-2 from the waitlist.
4. Public: `LAUNCH_GATE=0` on the web app when it has been boring for weeks;
   caps walk toward the public targets (25x is the SCF deliverable number).
5. **Stellar Liquidity Award** (once live + audited — the two hard gates):
   invitation-based for SCF alumni, so Ashley should have us flagged as a
   prospect BEFORE launch. Base $50K in XLM (convert on-chain to USDC before
   seeding the vault — the pool is USDC-denominated), Supplemental $50K at
   7-day consecutive TVL > $250K (the natural 6-month milestone). Winners
   file monthly activity reports for 6 months — indexer/leaderboard/Umami
   already produce the numbers. Rules:
   https://stellar.gitbook.io/scf-handbook/supporting-programs/stellar-liquidity-award/official-rules
