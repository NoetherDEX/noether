# Noeracle Integration — Status & Production Cutover Runbook

> The Noeracle pull-oracle integration that replaces the old push-based mock-oracle
> price path (the source of recurring `#30 PriceStale` errors). This doc is the
> living reference: **what's done**, the **ground-truth facts**, and the
> **production cutover runbook** that remains. Companion: `docs/noeracle-feature-requests.md`
> (Noeracle-side hardening spec).

---

## 1. Status (current)

**✅ DONE — staging is complete, live, and proven.**
- The full Noeracle integration is merged on the **`staging`** branch and deployed as a
  parallel "green" testnet stack, served at **`staging.noether.exchange`** (Vercel Preview).
- Real Freighter trades (open + close) verified end-to-end on staging: **no `#30`**, and a
  live ~500ms price ticker (SSE).
- The codebase is **Noeracle-only**: `mock_oracle` and `oracle_adapter` crates and all
  Band/DIA references were deleted; the frontend, api, and deploy scripts read the shim.

**⏳ NOT DONE — production cutover.** `noether.exchange` (the `main` branch / Production
Vercel env) still runs the **old** contracts on the mock oracle. Nothing has flipped.
The remaining work is §4 (the cutover runbook).

**Branches:** `staging` = main + Noeracle integration + cleanup. `main` = unchanged
production baseline. Production env vars (Vercel **Production** scope) still point at the
old live contracts; the Noeracle frontend paths are env-gated, so merging `staging → main`
changes nothing live until the env flip in §4.

---

## 2. Architecture (Noeracle-only)

```
Display (UI):   web ── SSE ~500ms ──▶ api.noeracle.org/v1/stream   (live ticker)

On-chain read:  market ── lastprice(Symbol) ──▶ noeracle_shim ── get_price_pers ──▶ Noeracle
                                                  (SEP-40 translator, 7-dec scaling)

User trade:     web ──▶ noether_router.open_with_price / close_with_price
                         └─ writes a freshly-signed Noeracle price, THEN calls market,
                            in ONE tx  ⇒ sub-second-fresh execution price, never #30

Keeper:         fetches signed attestations from Noeracle → publishes on-chain via
                Noeracle.update_ed25519_persistent (heartbeat, keeps the slot warm for
                read paths that don't prepend, e.g. liquidations/orders/UI reads)
```

The **shim is required and correct** — Noeracle has no SEP-40 `lastprice`, so the shim is
the translator. It is NOT old baggage (it has zero mock/Band/DIA code). The market binds its
oracle at `initialize` (no setter), so the market's `oracle_adapter` init **parameter** now
holds the **shim** address.

---

## 3. Ground-truth facts (verified; trust these)

### Shared / reused contracts (testnet)
| What | Address |
|------|---------|
| **Noeracle** (signed source, testnet) | `CAYIP67UDVX5UPXGN3XDAWVIEFBAVG6G7LUESEOU3NUQKTWN55W34YBG` |
| **noeracle_shim** (deployed, `…LOLN`-owned, reads Noeracle) | `CDHIGZLUPKSY747I3TLSKB4F6AQXQV4T54AKSQNFAEILUB6ROVAVUJHN` |
| **USDC** (shared, real testnet asset; issuer = `…LOLN`) | `CA63EPM4EEXUVUANF6FQUJEJ37RWRYIXCARWFXYUMPP7RLZWFNLTVNR4` |

### GREEN / staging stack (`contracts.staging.json`)
| Contract | Address |
|----------|---------|
| market (oracle slot = shim) | `CB72GHQR236GJZBUYBTQI7WEMJBHJ245XOIOHVDE5L774JC6KJGOZYIR` |
| vault | `CC24AIBX6JB6RY4ZWZMRE3KHNQOBVKQPBZX3NNLEM6MJZPHNG2P2AP3D` |
| NOE (SAC, issuer = staging admin; pre-minted to vault) | `CBQHTZEXFBVU3AC5X2FXXFBQZRTOZ47DIBLEVBNSJWRNP7OXSIRPEFFX` |
| router | `CCVPJ7O5AT4Z43RUOIFT4SYLTHKOHKFO6AND63XD7PKCLWTM6KDDJORP` |
| staging admin | `GCW7CENKM65B2MVMVJOQCFBZDGZ7FEK2WAKXCHLUUQKIAYKFYWC6KEVO` |
| staging keeper | `GDUQ3DXGSNRGPNNGHLKXLSVPRC3V2PAYMP6ITW3ICSRLF64KVOTPA6AT` |

Staging secrets live ONLY in the git-ignored `.env.staging` (never committed).

### LIVE / production stack (`contracts.json`) — still on the OLD mock-oracle path
| Contract | Address |
|----------|---------|
| market (reads old oracle_adapter → mock) | `CC2HH34Q7GOMNBNPSNSQIIUSYYXLYLOOLMUY3ZTFFBLJ2DENWHGS6GNB` |
| vault | `CD5WYLEHTFHOKPPH2GMNUFW2MK7XIQFKI365G6CBAATYWVNPE3RFYMY3` |
| **prod admin** (`…LOLN`; NOE + USDC issuer, market/vault admin) | `GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN` |

### Encoding / errors
- **Price precision:** 7 decimals (`PRECISION = 10_000_000`). Noeracle prices are i128 @ 1e7 — no scaling needed.
- **Asset tag:** ASCII of `<SYM>USD` zero-padded to 8 bytes. BTC → `b"BTCUSD\0\0"` = hex `4254435553440000`.
- **`#30` = `PriceStale`** (the bug this fixes). **`#32` = `OracleUnavailable`** (shim returns this when Noeracle has no fresh price for an asset → expected when the keeper isn't pushing it).
- `max_price_staleness` = 60s (market `MarketConfig`).
- Soroban: **one host-function op per tx** — why the router (verify-then-trade in one call) exists; "prepend an update op" is impossible.

---

## 4. Production cutover runbook (Strategy 2 — fresh stack)

**Decisions LOCKED by the user:** fresh production stack (NOT repoint), **router from day one**,
**no airdrop**. The old market/vault/positions are abandoned (testnet, valueless). Mirrors the
proven staging deploy, with the real `…LOLN` admin.

### Prerequisite (DONE) — `scripts/deploy_production.sh`
Written (adapted from the proven `scripts/deploy_staging.sh`):
- reads `.env` / `ADMIN_SECRET_KEY` (= `…LOLN`),
- **reuses** the live NOE (`CD7VRBXI…`, choice C below) + USDC (`CA63EPM4…`) + shim (`CDHIGZ…`) + Noeracle (`CAYIP67…`),
- deploys the **full fresh stack**: vault + market(→shim) + router + **vault_factory** + **referral** — the latter two pin the market at `initialize()` with **no setter**, so a fresh market requires fresh copies bound to it (verified: `vault_factory` leader-trade proxies and `referral.record_trade` both read `get_market()`),
- init order: **vault → market → router → vault_factory → referral**; market config via `--config-file-path` with i128 fields as **strings** (CLI v26 rejects inline i128),
- mints 1e16 NOE to the new vault; writes a **separate `contracts.production.json`** (does NOT clobber `contracts.json` until the deliberate flip); resumable via git-ignored `.env.production`.

> Note: the older `.env`-based scripts (`deploy_testnet.sh`, `setup_and_deploy.sh`) deploy
> shim+vault+market but **NOT** router / vault_factory / referral — incomplete for the prod cutover.

**NOE issuer — RESOLVED: (C) reuse the live NOE** (`CD7VRBXI…`, code `NOE:…LOLN`). The script mints
1e16 more to the new vault on top of the ~3M already outstanding — accepted "inflated" pool/supply
stats (testnet, valueless). (Considered: A = new issuer keep code "NOE" [staging did this];
B = `…LOLN` issuer, different code; C = reuse — chosen. `referral` is deployed **fresh** bound to the
new market; `vault_factory` likewise.)

### Steps (user runs deploys; Claude assists, pauses for deploy/fund)
1. **PR `staging → main`** (code only; production unaffected — env-gated). Merge.
2. **Deploy fresh prod stack** via `deploy_production.sh` (`…LOLN`): vault + market(→shim) + router + vault_factory + referral, reusing NOE (C) + shim + Noeracle + USDC. → `contracts.production.json`.
3. **Fund** the new prod vault with USDC (user mints; e.g. seed liquidity like staging's 80k).
4. **Prod keeper** (`noetherkeeperbotv2`, Railway): switch to Noeracle-push, target the new market; set Railway `NEXT_PUBLIC_NOERACLE_ID`. Verify shim `lastprice` returns fresh BTC/ETH/XLM.
5. **Flip Vercel Production env** to the new addresses (market, vault, router, **vaultFactory, referral**, NOE, shim, noeracle, `NEXT_PUBLIC_NOERACLE_API_URL`). Update **Railway** (keeper + api + indexer) too — the indexer needs vaultFactory + referral present to register their handlers. Promote `contracts.production.json` → `contracts.json`.
6. **Verify**: a real Freighter trade on `noether.exchange` → fast, no #30, router atomic.
7. **Rollback** if needed: flip Production env back to the old addresses (old contracts still live).

---

## 5. Risks & gotchas

- **🔴 Noeracle S-1 (mainnet blocker, testnet-OK):** Noeracle's `update_ed25519_persistent` (the
  persistent write path the keeper/router use) does NOT enforce registered-publisher / staleness /
  monotonic-round checks — only `update_batch_ed25519_args` (temp) is hardened. On testnet
  (valueless) this is acceptable; before mainnet, Noeracle must harden the persistent path. Full
  spec in `docs/noeracle-feature-requests.md`.
- **Keeper is a hard dependency:** if it stops and Noeracle's slot goes stale/empty, the shim
  returns `#32` and that pair's trades revert. (Same failure class as the old mock setup.)
- **Keeper-initiated liquidations/orders don't use the router** — they rely on the heartbeat
  staying inside the 60s window. A `liquidate_with_price`/`execute_with_price` on the router is a
  possible future hardening.
- **Market has no oracle setter** — switching its oracle requires a redeploy (hence Strategy 2).

---

## 6. Pending housekeeping (before a main PR)
- 2 pre-existing `vault_factory` test failures (`leader_open/close_position_*`) — they also fail on
  pristine `origin/main`, unrelated to Noeracle. Worth fixing for clean CI.
- Untracked `sdk-ts/noether-sdk-0.1.1.tgz` — decide gitignore vs commit.

---

## 7. Verify gates / conventions
- Contracts: `cd contracts && cargo test -p <crate>` · `cargo build --release --target wasm32-unknown-unknown`.
- Web: `cd web && npx tsc --noEmit`. Monorepo: `npm run typecheck` + `npm test` from root.
- Commit per logical change; conventional commits (husky `commit-msg` enforces); **no `Co-Authored-By`**.
- `contracts.json` is the authoritative live-address source; `.env`/Vercel/Railway are manual after deploy.
- Husky blocks direct commits to `main`/`develop` — work on branches, land via PR.
