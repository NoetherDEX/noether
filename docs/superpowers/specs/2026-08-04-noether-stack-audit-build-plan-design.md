# Noether + Noeracle stack audit — prioritized build plan

**Date:** 2026-08-04
**Author:** Claude (13-agent audit + 6 adversarial verifiers + 3 judge panels, 2026-07-29 → 2026-08-04)
**Status:** awaiting founder approval

Every claim below is labelled **[M]** measured (command + output, or `file:line`) or **[I]** inferred.
Nothing in this audit modified any file, branch, contract, or Azure resource.

---

## 1. Founder decisions already taken

These four answers are settled and bind the plan:

| # | Decision | Chosen |
|---|---|---|
| D1 | In-progress `origin/main → staging` merge | **Abort it**; re-sequence as `testnet → main` and `testnet → staging` |
| D2 | Stork fail-closed posture | **Fail-open everywhere until mainnet** (fix the signer, arm the relay, set no strict assets) |
| D3 | Prod web | **Plug the gate hole now**, rebuild prod from `testnet` (not `main`) |
| D4 | Prod/testnet data separation | **Separate prod database now** (~$25/mo) + scope-pinned credentials |

A prior recorded founder decision also stands: **Noeracle quorum stays 1** (Noeracle `REVIEW-L08-L09.md:127-135`, 2026-07-21). This plan respects it and instead buys integrity from the already-deployed independent vendor (Stork). Re-review gate: **2026-10-01**.

---

## 2. Corrections to previously held beliefs

Load-bearing premises that measurement overturned. These are recorded because acting on the old versions would cause harm.

1. **There is no per-publisher round monotonicity in Noeracle.** Monotonicity is per-**asset** on the stored entry; a lagging or duplicate round is a **silent no-op with transaction success** (`oracle_v0/src/lib.rs:393-404`, `:319-325`). **[M]** Consequence: two keepers do **not** fight over rounds. The real two-instance trap is **shared Stellar account sequence numbers** — distinct signing keys make duplicate relays harmless. Keeper redundancy therefore needs distinct keys, not leader election.
2. **O-1 is closed on both live Noeracle instances.** The unauthenticated write path is compiled out behind a `bench` cargo feature and absent from the deployed blob; both instances run identical wasm `bbb54f29…e300`. **[M]** It remains open only on the **retired** `CAYIP67…` instance, which has no `upgrade()` and can never be fixed.
3. **Arming quorum ≥ 2 is not "infrastructure only".** `update_batch_ed25519_persistent` — the only entrypoint any deployed relayer calls — hard-returns `QuorumNotMet` when quorum > 1 (`lib.rs:259-261`), and no quorum-path relayer exists in any repo. **[M]** `set_quorum 2` today would stop on-chain price updates entirely.
4. **The hardened monorepo `scripts/keeper` is what feeds prod**, not `noetherkeeperbotv2`. Proven from the running image's own layer contents, its ACR build log (`npm run build` vs `npx tsc`), and Horizon showing the keeper signer calling two functions absent from v2. **[M]** Both prod and staging run the byte-identical image `noether-keeper-t3:v4`. The repo docs (`docs/plans/operator/L0-7-prod-keeper-noeracle-repoint.md`) were correct; the stale claim lives in Claude's auto-memory, which this plan fixes.
5. **The launch gate does not hold.** The middleware matcher `/((?!_next/static|_next/image|.*\..*).*)` skips any path containing a dot, and `web/app/vaults/[id]/page.tsx` coerces with `Number(params.id)`, so `https://noether.exchange/vaults/1.0` returns HTTP 200 with no rewrite — a fully server-rendered page with live testnet data, to an anonymous visitor. Measured on 4 ids. **[M]**
6. **A prod rebuild must come from `testnet`, not `main`.** `main`'s web code targets the **retired** ABI (`open_position` 6 args; router taking flat price fields) while Batch-1 takes 7 args (`acceptable_price`) and a `PriceAttestation` struct. **[M]** `NEXT_PUBLIC_*` are inlined at image build time — prod's container env holds none of them, so runtime env cannot fix addresses.
7. **`liveUntilLedgerSeq === 0` means archived, not "unknown".** Ground-truthed three ways: archived entries return full value XDR with `liveUntil=0`; never-written keys are omitted entirely; live entries return a future value. **[M]** But **Protocol 23 auto-restore** means archived entries are restored inside an ordinary transaction — no `RestoreFootprint` prerequisite, just added rent.
8. **Contract *code* entries archive independently of instances, and the keeper never bumps them.** `scripts/keeper/src/stellar.ts:368` builds the footprint as `setReadOnly([instanceKey])` while its own doc comment at `:355` claims "instance+code". **[M]**

---

## 3. Live state, measured 2026-08-04 10:19Z (ledger 3,963,747)

### 3.1 TTL / archival

| Entry | Instance | Code | Note |
|---|---|---|---|
| market | 21.7 d | 21.7 d | decayed 5.5 d since 07-30 — no bump landed **[M]** |
| vault | 21.9 d | 21.9 d | same |
| noeracle_shim | 27 d | **6.68 d** | code on the 7-day treadmill |
| noeracle | 5.2 d → restored | **6.68 d** | auto-restored ~7.7 h ago |
| noether_router | 30 d | **6.98 d** | |
| referral | 5.4 d → restored | **6.98 d** | auto-restored |
| **vault_factory** | **ARCHIVED** | **ARCHIVED** | since ~2026-07-28 **[M]** |
| noeToken (LP token) | **ARCHIVED** | — | **[M]** |
| usdcToken | ~6.6 d | — | |

`liveUntil − latest = 115,419` for shim code, against `min_persistent_ttl = 120,960`, is the signature of an entry restored ~5,541 ledgers ago. **[M]** The oracle read path is on a weekly archive→auto-restore treadmill; each cycle bills restoration rent to whichever unlucky transaction touches it first.

Network config, measured live: `max_entry_ttl 3,110,400` (180 d), `min_persistent_ttl 120,960` (7 d), `persistent_rent_rate_denominator 1215`, derived rent ≈ `0.005187` stroops/byte/ledger. **[M]** Restore does **not** resume the old clock — it sets `liveUntil = currentLedger + 120,960` (7 days), so restore-then-extend must be one maintenance window.

### 3.2 The retired 2026-07-06 stack — live, exploitable, and growing

- Balances: retired vault **2,035,505.40 USDC** (was 2,025,566.54 on 07-30, **+9,939 in 5 days**), retired market 107,123.87. **[M]** Both unpaused; 46 open positions across multiple distinct accounts. **[M]**
- **A forgotten loop under our own CLI identity `new_admin` (`GBTHMMFW…GVQG`) is still running right now** — Horizon shows successful transactions at 10:20:04Z, alternating `update_ed25519_persistent` → retired Noeracle and `sync_asset_pnl` → retired market, ~15 s cadence. It is **not** on Azure, Fly, Railway, or any local `ps`. **[M]**
- **Third-party exploitable.** The retired Noeracle's `update_ed25519_persistent` verifies signatures against **caller-supplied** pubkeys with no registered-publisher check. The retired market reads through the retired shim. Its `#81` deviation band, last-good price, and 60 s staleness gate apply **only on the strict open path**; the close/liquidate path is lenient and the retired `Config` has **no `lenient_clamp_bps`** (11 fields). So: open at a real price, spoof a favourable price with a self-issued key and a fresh self-timestamp, close on the unclamped path. `settle_pnl` caps payout only at the vault balance — no per-trade cap. **Worst case: the entire ~2.03M.** **[M]**
- Stopping the loop does **not** close the exploit — an attacker supplies their own timestamp and the lenient path performs no staleness check. **[M]** Pausing is required.
- **Recovery is two admin calls, not one.** `emergency_withdraw` reverts with `Contract #5` while unpaused (measured for both `amount=1` and full balance); the retired build gates it behind `if !get_paused { return Err(NotPaused) }`. So `pause()` **then** `emergency_withdraw(amount, recipient)`, signer `GCKIUOTK…`. **[M]**
- It recovers the **vault only**. The market's 107,124 USDC has no `emergency_withdraw` among its 29 exports — it is position collateral, releasable only by closing/liquidating the 46 positions (`liquidate` works while paused). **[M]**
- Same USDC SAC as the current stack (`CA63EPM4…`), and the current vault exposes `deposit(depositor, usdc_amount)` — recovered funds are redepositable. **[M]**
- **Severity framing: this is testnet USDC with zero real-world value.** The risk is demo/reputational integrity plus stranding the 46 position owners — not financial loss. Urgency is hours-to-days, not a money emergency.

### 3.3 relay_stork — a guard that has never once fired

- `get_stork_config` on the prod router: `enabled:true, require_fresh:false, signer:0a803f9b…5d44, taxonomy:1, max_age_secs:60, max_dev_bps:100`. **[M]**
- Two real payloads lifted from prod diagnostic events, replayed through the contract's exact algorithm (`keccak256(payload[65..])` → `secp256k1_recover` → `keccak(pubkey[1..65])[12..32]`), both recover to **`f61520450796abbe0015c203cc5b16ae4503939f`**. Ten derivation variants tested — none produce the pinned value. Failure reproduced live via a simulation-only `relay_stork` against the prod router: `Error(Contract, #3)`. **[M]**
- `#3` = `NoetherError::Unauthorized` (`noether_common/src/errors.rs:25`), returned in `relay_stork` only at `!cfg.enabled` (ruled out) or the signer compare (`noether_router/src/lib.rs:458`). **[M]**
- **12,029 consecutive failures on prod, 12,078 on staging**, first at 2026-07-23T14:09:34Z, streak never reset (it resets to 0 on success). The keeper side is byte-perfect: payload length 309 = 75 + 13×18, taxonomy match, 13 asset ids matching `STORK_DEFAULT_ID_SYMBOLS`, frames signed 5-6 s before submission, both Azure secrets present, Fast WS healthy. **One wrong on-chain value.** **[M]**
- Silence explained: `scripts/keeper/src/index.ts:792` alerts when the streak equals **exactly** 5. One warning fired six days in. **[M]**
- Prod **fails open** (`strict_assets:null`, `require_fresh:false`) so trading is unaffected; `get_reflector_config` is **null on both environments**, so the router has **zero** live second-source cross-checks — both legs of the divergence veto are inert. **[M]**
- Staging has `strict_assets:["BTC","ETH"]` and therefore **fail-closed blocks BTC/ETH router opens** today. **[I]** (code+config reasoning; no live staging open simulated)
- Arming is safe: measured divergence 17-35 bps against a 100 bps band. **[M]**
- Prod's Stork was armed **manually, off-script** — `scripts/deploy_batch1.sh:307` deliberately leaves prod Stork disabled, and `B1_STORK_SIGNER_EVM=` ships empty. **[M]** The correct signer must be re-derived via `npm run stork:check`, never hardcoded from this document.
- **Trap:** `set_stork_assets` has no getter, and `relay_stork` silently skips unmapped ids returning `Ok(0)`, which the keeper counts as success. Verification must assert the simulated return is **13, not 0**. **[M]**

### 3.4 Read-path data corruption

*Counts in this subsection and in §3.5 were measured 2026-07-29/30 and drift upward with live activity (e.g. traders 661 → 662, trades 14,551 → 23,252 by 2026-08-04). The join defect and its ratios are structural and do not decay; the 14-day window component does.*

- `events_raw` holds three market generations (current `CBHHWFAY…` 30,865 events; Jun `CC2HH34Q…` 1,017; retired `CAE3U7JK…` 838). **[M]**
- Three `positionId` joins in `api/src/services/stats.ts` have **no contract predicate** — `traderVolume14d` closes (`:160-170`), `computeMarketStats` realized (`:256-268`), `recentTrades` realized (`:329-334`). The `c`-side of every branch is also unscoped. **[M]**
- Live consequences: `/v1/account/volume` for one trader returns 82,945,553,500,809 where scoped truth is 27,525,200,000,000 (**+201.3%**); **167 of 528 active traders inflated**; **7 flip their displayed fee tier**, three showing tier 3 on $0 true volume. `/v1/trades?trader=…` returns 34 rows for 13 real closes, with position id 136 appearing 3× under one txHash with three different asset/size/entryPrice triples. `/v1/markets/stats` serves a literal 15th bucket `{asset:"null", volume24h:"796000000000"}` ($79,600 phantom). **[M]**
- **On-chain fees are unaffected** — the market computes tiers from its own `VolumeRecord`. Nobody was mischarged; the damage is the fee-tier preview, the public API, and SDK consumers. **[M]**
- The fix is safe: zero current-market closes lack their own-market open, so scoping creates no null rows. Scoped join returns exactly 14,551 for 14,551 real closes. **[M]**

### 3.5 Other measured defects

| Area | Defect | Basis |
|---|---|---|
| `packages/tx-builders` | Zero resource headroom (`client.ts:82` `fee: BASE_FEE`, `:93` bare `assembleTransaction`) — gateway + both SDKs exposed to `ExceededLimit`; `/v1/tx/submit` reports it as `contractError:null` because `contractErrors.ts:97` only decodes `sceContract` | M |
| `web/lib/stellar/client.ts` | The deployed `withResourceHeadroom` **double-counts the resource fee** — passes `basePortion + inflatedResourceFee` as the builder fee while `stellar-base` adds `sorobanData.resourceFee()` again. Measured on `create_vault`: 26,462,168 → 66,155,270 stroops (2.65 → 6.62 XLM) | M |
| Gateway `/v1/vaults` | Returns **phantom vaults** (ids 0, 12, 13 — incl. "staging-test", 18,267 USDC) that do not exist on the Batch-1 factory (`get_vault_ids` = `[]`). Stale pre-ceremony projections, never scoped to the factory address. Web hides them by accident; SDK/REST consumers see them | M |
| Gateway `/v1/vaults/leaderboard` | HTTP 400 `params/id must be integer` — path collides with `/v1/vaults/:id` | M |
| Indexer | **LP vault entirely unindexed** — `index.ts:48` builds `contractIds=[market, vaultFactory, referral]`; `CONTRACT_VAULT` is set on the Azure app but no code reads it. ~20 vault topics dropped. Bad-debt history is **not** affected (it's a market event, 22 rows) | M |
| Indexer | Unrecognised topics dropped **without archiving** (`poll.ts:160`) — unrecoverable even by reindex | M |
| Indexer | Cursor CAS-miss halt **already fired** 2026-07-29T18:20:51Z during the v6 rollout; wedged until a manual restart 4 min later. `probes:null`, min=max=1, Single revision mode. Nothing automatic recovers it | M |
| Indexer | No `SOROBAN_RPC_URLS` in prod — failover code inert on the public endpoint; a retention gap already lost ~17.6k ledgers (2026-07-14). Nothing consumes `ledger_gaps` | M |
| All 8 Azure apps | `probes: NONE` | M |
| `api/src/config.ts:41` | Calls `loadContracts()`, not `resolvedContracts()` — so `CONTRACT_*` env overrides are ignored everywhere except `/v1/health`. "Re-point a gateway by env var" silently does not work | M |
| `/v1/oracle/health` | `ONCHAIN_STALE_SEC` is 90 while the contract's `max_price_staleness` is 60 → a 30 s window where opens revert with `#30` while the page reads green. `keeperConfigured === false` fail-opens to `ok` (`:132`). Route always sends 200, so no status-code monitor can fire | M |
| Keeper env | 13 vars only: no `DISCORD_WEBHOOK_URL`, no `KEEPER_HEARTBEAT_*`, no `SOROBAN_RPC_URLS`. Every `sendAlert()` writes to a console nobody reads. `noether-api` has no `KEEPER_HEARTBEAT_SECRET`, so `keeper.configured` is false live | M |
| Keeper | HYPE's independent-reference check permanently off since 07-21 (Binance has no `HYPEUSDT`; 16,802 log lines vs 1 each for other assets). XLM is the mirror case: Binance reference but no Stork feed | M |
| PyPI `noether-sdk` 0.1.1 | **Key issuance always 401s** — sends a raw hex signature where the gateway verifies a manageData signed-XDR envelope. Also `__version__='0.0.0'`, hangs forever on unreachable server, unbounded `websockets>=12` breaks on v14. Local 0.1.2 fixes all of it, never published | M |
| npm `noether-sdk` 0.1.1 | ~10 weeks behind local 0.1.2; published `WsClient` handles only `hello` frames, no connect timeout | M |
| Both SDKs | 10 gateway routes uncovered; `account.positions()` silently drops the `positions` projection and returns only events | M |
| `rg-noether-autopost` | **Telegram bot token in plaintext** in console logs, persisted in Log Analytics (grammy `BotError` dump). `DRY_RUN=true` so nothing posts | M |
| ACR | `noether-keeper-legacy:v1` still present — one `az containerapp update` from prod, and its hardcoded fallback oracle is the retired `CAYIP67…` | M |
| Deploy scripts | The retired `CAYIP67…` is still the baked-in default in `deploy_production.sh:48`, `deploy_noeracle_shim.sh:41`, `deploy_noether_router.sh:37`, `.env.example:41`, `.env.staging.example` | M |
| `noether_common` | Error enum: 50 variants declared, **49 referenced** — `CrossMarginOrderNotSupported = 80` is unreferenced, so exactly **one** slot is free | M |
| Contracts | Router + shim extend instance TTL only in `initialize()`; router `PriceBand` persistent entries are written/read with **no** TTL extension | M |
| `vault_factory` | `VaultList` is the one unbounded O(n)-rewrite Vec; `create_vault` is permissionless with `max_vaults` defaulting to 0 (unlimited) and an empty allowlist | M |
| `noeracle_shim` | `twap()` uses panicking `env.invoke_contract` despite a doc promising callers "never trap on None" — reachable from the market's TWAP-confirmed liquidation path | M |
| Noeracle | Both the publisher secret and the oracle admin secret sit in plaintext in the repo-root `.env`. At quorum 1 that one file is full price control over both stacks | M |
| Noeracle | Round poisoning has **no recovery**: any registered key can sign a far-future `round_id` (future timestamps pass via `saturating_sub`) and permanently wedge an asset. Only escape is `upgrade()` | M |
| Noeracle | No events emitted on any write path — oracle writes invisible to event indexers | M |

### 3.6 What is healthy

- **Build provenance is clean.** All 7 fetched prod contracts are byte-identical to all 7 staging contracts, and each matches a local artifact exactly. **[M]**
- **Zero ABI drift.** All 25 cross-contract call groups (~40 sites) match, including both promote-together hazards (`vault.settle_pnl`, `open_position` `acceptable_price`). **[M]**
- **The market Phase-1 diff is sound.** Len-guards are unconditionally safe (pure filter ⇒ subsequence, so length equality implies identity); enum-variant removal is upgrade-safe (soroban-sdk 21.7.7 encodes contracttype enum keys **name-based**, verified in `derive_enum.rs:210-213` and in snapshot ledger keys); 177 tests pass; the deployed market's 47-function ABI is unchanged, so `upgrade()` preserves state and address. **[M]**
- **Azure is healthy and cheap.** Everything Succeeded, 0 restarts, real July cost **$43.92** across noether-rg (≈$93-98/mo steady-state). **[M]**
- The old vault TTL suspicion (2,592,000 for both threshold and extend) is **fixed** — vault imports the shared `noether_common/ttl.rs` constants. **[M]**
- Noeracle SSE is healthy: 1.86 events/s across 15 feeds, `last_signed_age 0s`, publisher matching on-chain. **[M]**
- Indexer is advancing right now (20 s lag). Prod prices fresh, ~35 s cadence. **[M]**
- Current LP vault state is chain-truth, not fabricated — web reads `get_pool_info`/`get_buffer_balance` live. What's missing is history and APY. **[M]**
- Leaderboard perf is a non-issue at this scale: worst query 82.6 ms warm; the new SQL ranking measured **107 ms / 2,876 buffers** vs today's 213 ms / 75,474. **[M]**

---

## 4. Classification

**Genuine mainnet blockers**
1. SEC-3 single-EOA admin across USDC+NOE issuer, every contract admin, deploy key, faucet hot key — plus the Noeracle publisher and admin secrets in one plaintext `.env`.
2. No second price source enforced on-chain (both divergence legs inert).
3. Round poisoning with no admin reset (needs `admin_reset_round(asset)` **before** any third key holder exists).
4. Published SDKs broken/stale (PyPI key issuance always 401s).
5. TTL treadmill: on mainnet, `create_vault` at 2.65 XLM would fail for a normal wallet.
6. Prod/mainnet data separation (D4).

**Broken now**
Prod gate leak; prod web on retired ABI+addresses; retired stack exploitable and growing; `relay_stork` 12k failures; read-path collisions; phantom vaults; `/v1/vaults/leaderboard` 400; LP vault unindexed; tx-builders no headroom; web headroom double-count; indexer silent-halt; alert threshold `=== 5`; Telegram token leaked; `config.ts` ignoring `CONTRACT_*`.

**Untidy**
`contracts.production.json` stale; retired oracle as default in 5 files; `noether-keeper-legacy:v1` in ACR; orphan/untracked snapshots; two wrong code comments in the market diff; `noether-growth-web` with zero env; `DRY_RUN=true` autopost; stale auto-memory.

---

## 5. The plan

Ordering is load-bearing. Every phase ends in a verification gate. Phases 0-1 touch no application code.

### Phase 0 — Stop the bleeding (same day, no code, no redeploy)

**0a. Retired stack wind-down.** Kill the `new_admin`/`GBTHMMFW…` loop (not on Azure/Fly/Railway — check other machines, tmux, detached shells). Then, signer `noether_admin` (`GCKIUOTK…`), each preceded by a `--send=no` simulation:
```
stellar contract invoke --id CAE3U7JK…YMEC --source-account noether_admin --network testnet -- pause
stellar contract invoke --id CBLVZZ55…2UL6 --source-account noether_admin --network testnet -- pause
stellar contract invoke --id CBLVZZ55…2UL6 --source-account noether_admin --network testnet -- \
  emergency_withdraw --amount <full balance> --recipient GCKIUOTK…QLOLN
stellar contract invoke --id CBSWA5P7…BSYE --source-account noether_admin --network testnet -- \
  deposit --depositor GCKIUOTK…QLOLN --usdc_amount <n>
```
Killing the loop alone is insufficient — pause is what closes the exploit. Do **not** unpause afterwards. The market's 107k stays stranded unless the 46 positions are closed; recommend writing it off and documenting it (open question O1).
**Gate:** both `is_paused = true`; retired vault balance ≈ 0; current vault balance up by the recovered amount; no new `GBTHMMFW` transactions on Horizon for 10 min.

**0b. TTL: restore then extend, one window.** Restore the archived factory instance + code and the noeToken instance (`RestoreFootprintOp` needs no contract auth — any funded account, admin not required). Then extend **instance and code** for all nine `contracts.json` addresses. Target: 518,400 ledgers (30 d) as the default; the 180-day pin is open question O2 (≈404 XLM one-shot vs ≈31 XLM, against a 9,653 XLM balance).
**Gate:** every instance **and** code entry reads a future `liveUntil`; the two-layer probe (getLedgerEntries for `liveUntil=0`, plus a simulate probe reading `ext.v1.archived_soroban_entries`) returns clean for all nine.

**0c. relay_stork.** Re-derive the signer with `cd scripts/keeper && npm run stork:check` — do not hardcode. Then `set_stork_config` on both routers (full replace; every field resupplied), prod signer `GCKIUOTK…`, **staging signer `GCW7CENK…` — different key**. Per D2, set **no** strict assets, and **clear staging's** `["BTC","ETH"]` so its BTC/ETH opens unblock. Never set global `require_fresh`.
**Gate:** simulated `relay_stork` returns **13**, not 0; `get_stork_price --asset BTC` non-null and advancing on both; keeper streak resets to 0.

**0d. Close the prod gate leak.** On `testnet`: fix the middleware matcher so dot-paths no longer bypass, and reject non-integer ids in `web/app/vaults/[id]`. Build `noether-web:prod-v3` from that ref with Batch-1 build args from `contracts.json`; deploy with `LAUNCH_GATE=1` intact. This closes the leak **and** retires the wrong-ABI/wrong-address image in one build (D3).
**Gate:** `/vaults/1.0`, `/vaults/1.0/manage`, `/vaults/0.0` all return the teaser rewrite; a bundle grep of the new image finds only Batch-1 addresses; `/audit` still serves.

**0e. Zero-code hygiene.** Rotate the Telegram bot token via BotFather and sanitize the grammy error dump. Add `www.noether.exchange` to `API_CORS_ORIGIN`. Set the keeper's alerting env (`DISCORD_WEBHOOK_URL`, `KEEPER_HEARTBEAT_*` on both keeper and api, `SOROBAN_RPC_URLS`). Delete or quarantine-tag `noether-keeper-legacy:v1`. Add liveness probes to all 8 apps against existing health endpoints (`/healthz` on 8080 for the indexer — container-local, no ingress change).

### Phase 1 — Commit reality

The `/v1/leaderboard/totals` endpoint is live in production and exists in no commit; an API rebuild from git silently reintroduces the undercount.

1. Extract read-only: `git diff -- api/ packages/ .env.example > $SCRATCH/deployed.patch`. Snapshot `curl /v1/leaderboard/totals > $SCRATCH/totals.before.json`.
2. Abort the merge (D1): `git merge --abort`. Then `testnet → main` and `testnet → staging` as reviewed merges carrying `ebe5176` + `1fa409b`.
3. Commit the api/indexer/packages hardening changeset **byte-identical to api:v8** (verified coherent: staged `hmac.ts` deletion has zero remaining references; 21 test files / 126 api tests pass).
4. Add `api/test/routes.snapshot.test.ts` snapshotting `fastify.printRoutes()` — the durable guard against deployed-but-uncommitted routes.
5. Fix the market diff's two factually wrong comments (`storage.rs` `delete_position` cross-positions claim; `storage.rs:749-751` `cancel_position_orders` claim — `lib.rs:3555-3561` iterates `linked.iter().flatten()`, so absent links never reach the function). Note in-code that the 32-cap on `CrossMarginPositions` exists **only** via `TraderPositions` membership. Clean up 6 untracked + 4 orphan snapshots.
6. **`/security-review`** on the auth, DB-layer, and contract-storage diffs (I can launch this). **`/code-review`** on every diff — **you must trigger it; it is not in my invocable set.**

**Gate:** `npm run build:packages && npm run typecheck && npm test` green; routes snapshot includes `/v1/leaderboard/totals`; `totals.after.json` equals `totals.before.json` modulo live counters.

### Phase 2 — Correctness fixes that need no contract change

1. **Scope the three unscoped joins** + add `o.contract_id = c.contract_id` to the `recentTrades` LEFT JOIN. Kills the +201% volume inflation, the 7 wrong fee tiers, the duplicate rows, and the `asset:"null"` bucket.
2. **`packages/tx-builders` resource headroom** — port `withResourceHeadroom` at ×1.25 between `assembleTransaction` and `.build()`; add `findHostError()` so `/v1/tx/submit` stops returning `contractError:null`. **Fix the web double-count** (pass only the inclusion-fee portion; let `build()` add the resource fee) and correct the false "Soroban refunds the resource fee" comment.
3. **Route `resolvedContracts()`** through config so `CONTRACT_*` overrides actually work.
4. **Oracle health honesty:** `ONCHAIN_STALE_SEC` 90 → 60; `keeperConfigured === false` ⇒ `degraded`; add `?strict=1` returning 503.
5. **Alert escalation:** replace `=== 5` with 5/25/100 then hourly; alert on TTL **runway**, not bump success.
6. **Keeper TTL fix:** put the code entry in the footprint alongside the instance; drive targets off `contracts.json` rather than hand-maintained fields; fix the `:355` comment; **await `getTransaction`** instead of `return res.status === 'PENDING'`; raise `MIN_KEEPER_XLM` from 20 (cannot cover a 31 XLM bump); chunk ≤12 keys/tx.
7. **Phantom vaults:** scope the vault projections to the factory address (or truncate and re-index from the ceremony ledger). Fix the `/v1/vaults/leaderboard` route collision.
8. **Index the LP vault:** add it to `contractIds`; write decoders/handlers for its ~20 topics. Archive unrecognised topics to a dead-letter instead of dropping them.

**Gate:** `/v1/account/volume` matches contract-scoped SQL for all 7 previously-wrong traders; `/v1/markets/stats` has exactly 14 asset buckets; a declared `writeBytes` equals `ceil(sim × 1.25)`; an induced trap names `ResourceLimitExceeded`; `/v1/vaults` returns only on-chain vaults.

### Phase 3 — Leaderboard pagination + environment separation (requirements A and B)

Per D4, provision the **separate prod database now**, and still ship scope-pinned credentials so the guarantee is enforced at the credential layer rather than by a WHERE clause.

**API contract** (additive — no deployed image breaks):
```
GET /v1/leaderboard?scope=testnet|mainnet&sort=pnl|volume&limit=20&offset=0&snapshot=<id>
→ { sort, updatedAt, scope, network, state, total, limit, offset, snapshot, snapshotChanged,
    leaders: [{ rank, trader, pnl, volume, trades, liqCount }] }
GET /v1/leaderboard/rank?trader=<G…>
```
- **Pagination:** OFFSET over an **immutable pinned snapshot** (`id = ${scope}.${sort}.${cursorLedger}.${total}`, 2-deep history, 20 s TTL, single-flight in `TtlCache.getOrLoad`). Pages are slices of one snapshot ⇒ no duplicates, no skips despite the measured 33 volume-ties and 51 PnL-ties.
- **Ranking moves into SQL:** `row_number() OVER (ORDER BY <metric> DESC, <secondary> DESC, trader ASC)` + `count(*) OVER ()`. `ROW_NUMBER`, not `RANK` — the 3-column key is a total order (0 ambiguity measured), so no trader appears twice.
- Keep the `COALESCE(close.size, joined_open.size)` fallback — `CC2HH34Q…` has 200 closes with no size; it is `never executed` for the current market, so it costs nothing.
- Pass market ids as a Postgres array **literal string** (`'{A,B}'::text[]`) — `InValue` rejects JS arrays.
- **Scope registry** in `packages/shared/src/scopes.ts`; `LEADERBOARD_SCOPE` required at boot; a scope whose `network` mismatches returns `state:'not_indexed_here', total:0`.
- **Credential enforcement:** `leaderboard_legacy` gains `scope_key`; RLS on `events_raw`/`positions`/`trades`/`leaderboard_legacy`; `bad_debt` gets RLS (closes an advisor hole). Two login roles inherit a reader role with scope pinned at role level; mainnet's scope is empty ⇒ `string_to_array('',',')` ⇒ zero rows. No `BYPASSRLS`. Verified fail-closed both directions.
- **Web:** proxy stops hardcoding `sort=volume&limit=200`, forwards `sort/limit/offset/snapshot`, renders `row.rank` (not `idx+1`), deletes the client re-sort, adds prev/next + "Showing 41-60 of 662", and a scope-aware empty state.

**Explicitly rejected:** a `trader_stats` projection (premature at 107 ms/662 rows; its backfill double-counts if interleaved with the live writer — revisit above 500k scoped rows or 1.5 s warm), and a staging indexer/DB (staging is testnet).

**Gate:** 34 pages of 20 concatenated = 662 distinct traders, ranks strictly increasing, zero duplicates or gaps; a tie fixture whose boundary falls inside the 52 `pnl=0` rows; `totals == Σ snapshot rows`; deleting one scope predicate locally makes the leak suite fail; `psql <mainnet_reader> -c 'SELECT count(*) FROM events_raw'` returns **0**.

### Phase 4 — Market contract: counters via upgrade()

Decision: **O(1) counters** (`OpenPositionCount`, `OpenOrderCount`, `OrderCountOf`), deleting `AllPositions`, `AllOrders`, `TraderOrders` (zero readers). Keep `TraderPositions` — genuinely read at `lib.rs:404` and `:3780`. Every cap site reuses `#82 OpenInterestCapExceeded`; **zero new error variants**. Net WASM ≈ **−141 B** including a mandatory `seed_open_counts(positions, orders)` (+328 B) — without seeding, `saturating_sub` floors at 0 and the counter permanently under-counts, destroying its use as a checksum. **One `upgrade()`** — address, state, and the 46 open positions preserved; `contracts.json`, `.env`, build args, and all four Azure apps untouched.

Keeper discovery becomes a **stateless chain walk** with the counter as a completeness checksum: read counters in the same batch as the first chunk; advance the floor only past a contiguous prefix of absent (positions) or terminal-status (orders) ids; on any checksum mismatch, do not advance, alert, and reuse the prior snapshot for one cycle. Unit `DataKey`s encode as `scvVec([scvSymbol(name)])`, so counters need **no view function**. Behind `KEEPER_DISCOVERY=legacy|chain`, soaked on staging against the still-deployed `get_all_position_ids` before promotion. **No indexer dependency on the liquidation path.**

**Gate:** chain-walk id set equals `get_all_position_ids` every cycle for 1 h on staging; then prod; then upgrade; then `market.openPositionCount` vs `indexer.openPositions` drift alarm on `/v1/health`.

### Phase 5 — SDKs, docs, memory

Publish sdk-py **0.1.2** (fixes the always-401 key issuance) and sdk-ts **0.1.2**. Add the 10 missing routes and fix `account.positions()` dropping the projection. Map 409/451/503 correctly. Then: purge the retired `CAYIP67…` default from the 5 files; delete `contracts.production.json` or regenerate it; update `CLAUDE.md` and the auto-memory (keeper truth, O-1 status, quorum semantics).

---

## 6. Deploy choreography rules

- **No market redeploy anywhere in this plan.** Phase 4 uses `upgrade()`: address preserved, state preserved, 46 positions preserved, no cascade. A fresh deploy would change the address and cascade to `contracts.json`, `.env`, Vercel-equivalent build args, and four Azure apps — the exact mistake that stranded 2.03M.
- **Indexer deploys need a follow-up restart.** A rolling update races the single-writer CAS guard and both replicas self-terminate. After `az containerapp update`, run `az containerapp revision restart`, then verify `indexer.lastLedger` **increases** across two samples ≥60 s apart. A falling lag is not proof.
- **TTL extension is monotonic and permissionless** — it cannot harm state, needs no admin, and has no rollback requirement.
- **Every diff through `/code-review` before deploy** (you trigger), and `/security-review` for auth, DB-layer, and contract-storage changes (I trigger).
- **Never commit or reference `scripts/volume-bot/`.** Conventional Commits, no `Co-Authored-By` trailers.

---

## 7. Open questions

**O1.** The retired market's ~107k USDC has no emergency exit — write it off in place (46 positions become permanently unliquidatable rows), or close/liquidate the 46 positions first to release collateral? Closing strands any winning position once the vault is emptied. These are multiple distinct accounts, not one throwaway.

**O2.** TTL target: pin all instance+code entries to the 180-day maximum (≈404 XLM once, six months of tolerance for a broken job, written off at the next testnet reset), or 30-day rolling (≈31 XLM, depends on the job working weekly)?

**O3.** Keeper redundancy timing: add keeper-B now (second funded account + USDC trustline, ~+$7/mo, near-zero failover, `pollOffsetMs`/`instanceId` already plumbed), or stay single-instance with paging until mainnet and accept a few minutes of halted opens on an overnight failure? Note the failure is fail-safe: `max_price_staleness=60` with `lenient_clamp_bps=300` halts **opens** while closes and liquidations continue on the clamped path.
