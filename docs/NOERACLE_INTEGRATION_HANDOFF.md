# Noeracle Integration — Session Handoff

> **Purpose:** Everything a fresh Claude session needs to continue the Noeracle ↔ Noether
> integration. Read this top-to-bottom before doing anything. Written 2026-05-31 on branch
> `feature/noeracle-integration`. Companion docs: `docs/noeracle-feature-requests.md` (Noeracle-side
> feature specs) and the auto-memory at
> `/Users/yahya/.claude/projects/-Users-yahya-Desktop-Stellar-Noether/memory/project_scf44_fast_oracle.md`.

---

## 0. START HERE (first actions in the new session)

1. **Verify working-tree state before touching anything:**
   ```bash
   cd /Users/yahya/Desktop/Stellar/Noether
   git status -sb
   git log --oneline origin/main..HEAD
   # Confirm market/src/lib.rs matches its committed version:
   [ "$(git hash-object contracts/market/src/lib.rs)" = "$(git rev-parse HEAD:contracts/market/src/lib.rs)" ] && echo CLEAN || echo DIRTY
   ```
2. **The working tree already contains finished, UNCOMMITTED A1 work** (see §8): `market/src/lib.rs`
   + 21 regenerated test snapshots. This is the inline-mock conversion and it PASSED 34/34 before the
   session ended. **First action: re-verify `cargo test -p market` (expect 34 passed) and commit it**
   (`fix(test): inline market test oracle, drop mock_oracle wasm import`) — do NOT discard it.
3. Also resolve the untracked `sdk-ts/noether-sdk-0.1.1.tgz` (gitignore-or-commit, undecided).
4. **Re-establish build baseline:** `cd contracts && cargo test -p noeracle_shim -p noether_router`
   and `cargo build --release --target wasm32-unknown-unknown` should pass.
5. Then resume the plan at **Phase A, step A2** (§7) — A1 is done once committed.

**Hard workflow rules (user-stated, do not violate):**
- Commit **per phase**, conventional-commit messages, **NO `Co-Authored-By` trailer**.
- Husky blocks direct commits to `main`. Work on `feature/noeracle-integration`; land via **PR to main**.
- Network/on-chain commands need the sandbox disabled (testnet only; the user authorized this).
- Pace yourself: make an edit → run **one** verification → report. Do not fire many redundant
  diagnostic commands (this was flagged as "thrashing").

---

## 1. The Goal (why we're doing this)

Noether is a Soroban perpetual-futures DEX on Stellar testnet, live at **https://noether.exchange**
(NOT `testnet.noether.exchange` — fix any doc that says otherwise). Its market contract rejects
trades when the oracle price it reads is older than `max_price_staleness` (60s) with
**`NoetherError::PriceStale` = error #30**. The current oracle is push-based (keeper → mock oracle),
so the on-chain price routinely ages past the window and users **cannot open positions**. This is the
pain we are eliminating.

**Noeracle** (the user's own separate product — repo `github.com/noeracle/noeracle`, service
`api.noeracle.org`, npm `@noeracle/sdk`) is a **pull-based, Ed25519-signed price oracle** with ~500ms
rounds. The fix: route Noether's price reads through Noeracle, and for user trades, write a
freshly-signed price **in the same transaction** that opens the position, so the on-chain price is
sub-second fresh at execution → #30 can never trip.

**End state we are building toward:** Noeracle is Noether's *only* oracle. Band, DIA, the
`oracle_adapter`, and the `mock_oracle` are all deleted. noether.exchange shows a live 500ms ticker
and trades never #30.

---

## 2. Key constraint that shapes the whole design

**Soroban allows exactly ONE `InvokeHostFunction` operation per transaction.** You therefore
**cannot** "prepend" a Noeracle price-update op to an `open_position` op — the two-operation
"Pattern A" in Noeracle's own docs is *not submittable on Stellar*. Atomic "verify price + use price"
must happen **inside a single contract call** → this is why we built a **router contract**
(`noether_router`) that, in one call, writes the signed price to Noeracle then calls the market.

---

## 3. Architecture: current vs target

```
CURRENT (live on testnet — unchanged, still serving):
  keeper ── set_price ──▶ mock_oracle (CAUGTIO4…)
  market ── lastprice ──▶ oracle_adapter (CBDH7R4…, primary+secondary BOTH = mock) ──▶ mock_oracle
  web    ── lastprice ──▶ mock_oracle (or shim if NEXT_PUBLIC_NOERACLE_SHIM_ID set)

TARGET (after big-bang cutover):
  keeper ── update_ed25519_persistent ──▶ Noeracle (CAYIP67…) persistent storage   [heartbeat]
  router.open_with_price ─▶ writes Noeracle ─▶ market.open_position   (ATOMIC, sub-second fresh)
  market ── lastprice ──▶ noeracle_shim (CDHIGZ…) ── get_price_pers ──▶ Noeracle    [one hop, adapter GONE]
  web    ── SSE 500ms ──▶ api.noeracle.org (live display) + on-chain read where a tx needs it
  DELETED: oracle_adapter, mock_oracle, Band, DIA
```

The market has **no oracle setter** (oracle address is fixed at `initialize`). So pointing it at the
shim *requires a market redeploy* — there is no in-place repoint. This is why the chosen path is a
market redeploy.

---

## 4. Ground-truth facts (verified on-chain / from source — trust these)

### Deployed testnet addresses (authoritative = `contracts.json`)
| Contract | Address | Fate |
|----------|---------|------|
| **noeracle_shim** (deployed, fixed) | `CDHIGZLUPKSY747I3TLSKB4F6AQXQV4T54AKSQNFAEILUB6ROVAVUJHN` | KEEP — market reads this |
| **Noeracle** (the user's oracle, testnet) | `CAYIP67UDVX5UPXGN3XDAWVIEFBAVG6G7LUESEOU3NUQKTWN55W34YBG` | KEEP — source of truth |
| market (current) | `CC2HH34Q7GOMNBNPSNSQIIUSYYXLYLOOLMUY3ZTFFBLJ2DENWHGS6GNB` | REDEPLOY → new ID |
| oracle_adapter | `CBDH7R4PBFHMN4AER74O4RG7VHUWUMFI67UKDIY6ISNQP4H5KFKMSBS4` | RETIRE/delete |
| mock_oracle | `CAUGTIO44JFE3KV74OLJJHYLEGPFIZTZAXVF5BBY6WNUAUHHEO4JCGIH` | RETIRE/delete |
| vault | `CD5WYLEHTFHOKPPH2GMNUFW2MK7XIQFKI365G6CBAATYWVNPE3RFYMY3` | KEEP — re-link to new market |
| usdc token | `CA63EPM4EEXUVUANF6FQUJEJ37RWRYIXCARWFXYUMPP7RLZWFNLTVNR4` | KEEP |
| noe token | `CD7VRBXIDYP2C2F2AZZL242GY4PRDVDH2BG3LAN2ASXYUXCPHWQJTDP5` | KEEP |
| vault_factory | `CCEQJKB3WVADOSCLCMFXL3VBZ4RKYEGFCG4SJVPERLFEWSIFMIWROLZA` | KEEP |
| referral | `CAGZXABWTJN6FU7TMCIWL3RH7EC6K4CQLLZJWUFN3CD7YHVDYWJCIG3O` | KEEP |
| **noether_router** | NOT DEPLOYED yet (code built) | DEPLOY in Phase B |

### Keys / identities (CRITICAL — two different admins)
- `ADMIN_SECRET_KEY` → CLI identity **`noether_admin`** → `GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN`
  = **market admin + shim admin**. Use for market redeploy/init and shim calls.
- `KEEPER_SECRET_KEY` (`SAL2…Y7LD`) → account **`GBTHMMFWTAPFAHRGS33LKETZYJKBTNEENRN47EDZMZPT2BNCJO47GVQG`**
  = keeper account **AND** the `oracle_adapter` admin. (Only relevant if you ever needed to repoint
  the adapter — we're deleting it, so likely moot.)
- Key resolution order in keeper config: `KEEPER_SECRET_KEY` → `ORACLE_SECRET_KEY` → `ADMIN_SECRET_KEY`.

### Precision / encoding / errors
- **Price precision: 7 decimals** (`PRECISION = 10_000_000`). Noeracle prices are also i128 @ 1e7 — no scaling needed.
- **Asset tag:** ASCII of `<SYMBOL>USD` zero-padded to 8 bytes. BTC → `b"BTCUSD\0\0"` = hex `4254435553440000`.
  The shim + router hard-code BTC/ETH/XLM. (The signed message's first 8 bytes are this tag.)
- **Error #30** = `NoetherError::PriceStale` (the bug we're fixing). **#32** = `OracleUnavailable` (shim
  panics this when Noeracle has no price for an asset — expected when keeper isn't pushing that pair).
- `max_price_staleness` = **60s** (market `MarketConfig` default).

### Noeracle contract surface (from real source, `oracle_v0/src/lib.rs`)
- `update_ed25519_persistent(asset: BytesN<8>, price: i128, timestamp: u64, round_id: u64, pubkeys: Vec<BytesN<32>>, sigs: Vec<BytesN<64>>)` — verifies sig, writes **persistent**. ⚠️ Does **NOT** check publisher registration (see S-1 risk §7). Keeper + router use this.
- `update_batch_ed25519_args(...)` — hardened (publisher + staleness + monotonic round) but writes **temp** (not what the shim reads).
- `get_price_pers(asset: BytesN<8>) -> Option<PriceEntry>` — what the shim reads. No read-time staleness check.
- `PriceEntry { price: i128, timestamp: u64, round_id: u64 }` — **3 fields** (the shim struct was wrongly 5; fixed in commit `0924ce7`).
- Persistent TTL ≈ 3.5–7 days; write-time `STALENESS_SECS = 60`.

### Browser / service facts (verified)
- `api.noeracle.org` returns `access-control-allow-origin: *` → safe to call directly from noether.exchange.
- `/v1/stream` is a live SSE feed (~500ms, `event: prices`, all 7 assets) → use for the Pattern-C ticker.
- `/v1/latest` returns per-asset `{price, timestamp, round_id, publisher, message, signature, tag, …}`.
- `/health` shows `status: ok`, `last_signed_age_s: 0`, publisher `8f8650ca…`.

---

## 5. What's DONE (committed on `feature/noeracle-integration`, pushed to origin)

Commits (newest first), all my work; `da97ef5` and below predate this effort:
- `0b7e46d` test(oracle): refresh noeracle_shim cost snapshot for 3-field PriceEntry
- `579d09e` feat(keeper): add `noeracle:check` one-shot path validator
- `f96dbdc` chore(keeper): add `noeracle:check` npm script
- `d8f7b44` feat(web): route open through noether_router when enabled (gated)
- `758d2a1` feat(oracle): add **noether_router** for atomic verify-then-trade (Pattern B)
- `0924ce7` fix(oracle): correct **shim PriceEntry shape** (5→3 fields) **and keeper persistent arg order**
- `c36bef0` feat(oracle): integrate Noeracle pull oracle via SEP-40 shim (initial WIP)
- `bcb4acf` chore(contracts): record deployed noeracle_shim + noeracle addresses
- (also a custom 404 page + `docs/noeracle-feature-requests.md` from earlier)

**Built & unit-tested (NOT deployed except the shim):**
- `contracts/noeracle_shim/` — SEP-40 shim, `lastprice(Symbol)->(i128,u64)` → Noeracle `get_price_pers`.
  8 tests pass. **DEPLOYED** at `CDHIGZ…`, init admin=`noether_admin`, noeracle=`CAYIP67…`.
- `contracts/noether_router/` — `open_with_price` / `close_with_price` (atomic verify-then-trade),
  admin setters, symbol→tag. **7 tests pass, 21 KB wasm. NOT deployed.** Deploy script:
  `scripts/deploy_noether_router.sh`.
- Keeper: `updateNoeraclePersistent` arg order **fixed**; `@noeracle/sdk` integrated; 50% circuit breaker.
  Validator at `scripts/keeper/src/check-noeracle.ts` (`npm run noeracle:check`).
- Web (gated, default-off): `openPosition` routes through router iff `NEXT_PUBLIC_NOETHER_ROUTER_ID`
  set; `web/lib/stellar/noeracle.ts` fetches attestations via plain browser `fetch`.

**Validated END-TO-END on-chain (2026-05-30):**
- `npm run noeracle:check` pushed a BTC price to Noeracle and read it back via `get_price_pers`. ✓
- Full keeper loop pushed BTC+ETH+XLM in one round; `shim.lastprice` returns correct prices for all three. ✓
- This proves: the keeper arg-order fix, the 3-field decode, the tag encoding, and the
  `shim → Noeracle` read chain — all working live.

**NOT cut over yet:** the deployed `oracle_adapter` still points at `mock_oracle`, so the market still
reads the mock. **Live trading is unchanged.** Nothing is broken.

---

## 6. Decisions LOCKED by the user (do not re-litigate)

> ⚠️ **STRATEGY SUPERSEDED 2026-05-31 — read this first.** The original "big-bang in-place" cutover
> below was **replaced** because noether.exchange has LIVE users testing right now (plus the SCF demo).
> The new strategy is **BLUE-GREEN**: stand up a *parallel* Noeracle-only deployment (fresh
> market+router+vault+NOE, new keys), validate it via the real frontend, then promote by **flipping
> noether.exchange's env vars** to the new addresses. Live stack stays untouched until the flip; the
> flip is reversible. The mechanics live in **§7 Phases B→E** (revised for blue-green). Decision items
> 2–9 below still hold; item 1 (big-bang) is REPLACED.

From explicit answers this session:
1. ~~**Cutover style: BIG-BANG in-place**~~ → **REPLACED by BLUE-GREEN parallel** (2026-05-31): build a
   parallel green stack (fresh keys + fresh market/router/vault/NOE, separate `contracts.staging.json`,
   reuse shim/Noeracle/USDC), validate via the real frontend pointed at staging, promote by reversible
   env flip. Doubles as the Tranche-3 mainnet dry-run. Full mechanics in §7 Phases B→E.
2. **Who deploys: Claude runs the on-chain testnet deploys** via the user's keys (sandbox disabled),
   **pausing for explicit "go" before each meaningful deploy**. Dashboard env (Vercel/Railway) stays the user's/Mert's job.
3. **`mock_oracle`: RETIRE/delete entirely** (from the repo).
4. **`oracle_adapter` + Band + DIA: DELETE** — "I do not want them in main. Just Noeracle."
5. **Router is part of the green stack** (user trades atomically fresh from day one of the green cutover).
6. **Frontend: SSE 500ms live ticker (Pattern C).**
7. **Keeper: keep heartbeat push AND the router prepend** (both — heartbeat keeps non-router read paths warm).
8. **Land in main via a PR** (not a direct merge).
9. **Domain is `noether.exchange`** (not `testnet.noether.exchange`).
10. **New keys** for the green stack (fresh admin + keeper, friendbot-funded; avoid live-keeper seq conflicts);
    **reuse the existing frontend** via env — **no new/throwaway UI**.

The user also signaled they may later modify the market contract / keeper themselves ("I can modify
market contract or keeper, I don't know") — so keep changes clean and well-documented.

---

## 7. THE PLAN

### Phase A — Repo cleanup + frontend (code only, on branch, fully reversible)

Order matters (A1 unblocks A2):

- **A1 — Market tests → inline oracle mock.** `contracts/market/src/lib.rs` `#[cfg(test)]` block
  `contractimport!`s the compiled `mock_oracle.wasm` (around line 2449) and uses
  `mock_oracle::Client` in ~7 places. Deleting `mock_oracle` breaks `cargo test -p market`. Replace
  the imported mock with an **inline `#[contract] MockOracle`** exposing `initialize(admin)`,
  `set_price(asset, price)`, `lastprice(asset)->(i128,u64)`.
  - **VALIDATED APPROACH (already proven this session):** an inline mock made `cargo test -p market`
    pass **34/34**. The only fiddly bit was the client name: soroban generates `MockOracleClient`, but
    call sites use `mock_oracle::Client`. **Cleanest fix:** add `pub use MockOracleClient as Client;`
    inside the inline `mod mock_oracle` so the 7 call sites stay unchanged. (Earlier attempt did a
    sed-rename to `MockOracleClient::new` and got messy — prefer the alias.)
  - The deployable market WASM does NOT depend on mock_oracle (only `#[cfg(test)]` does), so this is
    test-only surgery — the contract bytecode is unaffected.
  - Gate: `cargo test -p market` (expect 34 passed).

- **A2 — Delete the crates.** Remove `contracts/oracle_adapter/` and `contracts/mock_oracle/`
  directories; remove both from `contracts/Cargo.toml` `members`; remove from
  `scripts/build_contracts.sh` build list. Gate: `cargo build --release --target wasm32-unknown-unknown`.

- **A3 — Purge Band/DIA + dead oracle types.** `noether_common/src/types.rs` has `OracleConfig`
  (Band/DIA fields) and `"band"`/`"dia"` source comments — remove `OracleConfig` if nothing else
  references it after the adapter is gone (grep first). Clean `.env.example` (lines ~37-40, the
  Band/DIA IDs, already marked "unmaintained"). Gate: `cargo build`.

- **A4 — Rewire deploy scripts.** `scripts/deploy_testnet.sh`, `scripts/setup_and_deploy.sh`,
  `scripts/market.sh`: drop the mock_oracle + oracle_adapter deploy/init steps; market `initialize`
  takes `oracle_adapter = <SHIM_ID>` (the param name stays; the value is the shim). Keep
  `max_price_staleness = 60`.

- **A5 — Frontend + api "impeccable".**
  - `web/lib/stellar/oracle.ts`: read the **shim only** (drop the `MOCK_ORACLE` fallback).
  - ⚠️ **`web/lib/stellar/vault.ts` (~lines 283-294) calls `mockOracleContract.set_price`** — a helper
    that writes prices to the mock. With mock retired this breaks; find its callers and remove/replace.
  - `web/lib/utils/constants.ts`: drop `MOCK_ORACLE`/`ORACLE_ADAPTER` (or keep harmless), keep
    `NOERACLE_SHIM`, `NOETHER_ROUTER`, `NOERACLE_API_URL`.
  - Add a **500ms SSE ticker** hook (`api.noeracle.org/v1/stream`, CORS-open, EventSource/fetch) for
    trade/portfolio price display. Keep on-chain read only where a tx needs it.
  - `api/src/services/oracle.ts` + `server.ts`: point `OracleService` at the shim (or Noeracle), not
    `mockOracle`. `packages/shared/src/contracts.ts` has a `mockOracle` union member — reconcile.
  - Gates: `cd web && npx tsc --noEmit`; `npm run typecheck` (monorepo root); keeper `npx tsc --noEmit`.

- **A6 — Docs.** Fix `testnet.noether.exchange` → `noether.exchange` everywhere; rewrite the README
  oracle section (no Band/DIA/adapter/mock); update `CLAUDE.md` oracle-chain + contract-addresses
  sections. `SUBMISSION.md` and `docs/GIT_WORKFLOW.md` also reference mock_oracle/oracle_adapter.

Commit A in focused commits as you go.

### Phase B — Stand up the GREEN (staging) stack in parallel (testnet; Claude runs with pauses)

> Blue-green per §6a. The LIVE stack stays serving throughout. All green addresses go in
> **`contracts.staging.json`** — do NOT touch the live `contracts.json` until promotion (Phase D).

- **B0 — Fresh keys.** Generate a new admin keypair + a new keeper keypair; fund both via friendbot.
  Store as `STAGING_ADMIN_SECRET_KEY` / `STAGING_KEEPER_SECRET_KEY` (e.g. in `.env.staging`). These
  must be DISTINCT from the live keys to avoid keeper sequence-number conflicts.
- **B1 — Keeper (staging) running**, pushing all three assets to Noeracle with the staging keeper key,
  so the shim has fresh BTC/ETH/XLM. Verify `lastprice` for each returns a price (not #32). (Shim is
  shared/reused — already deployed at `CDHIGZ…`.)
- **B2** — `./scripts/build_contracts.sh` (market, router, vault — incl. router).
- **B3 — [deploy, pause for "go"]** Deploy + init the **green vault** (fresh NOE token) and **green
  market** with `oracle = SHIM (CDHIGZ…)`, config `max_price_staleness = 60`. New keys = green admin.
  → new green MARKET_ID + VAULT_ID + NOE.
- **B4** — Link green vault ↔ green market (`vault.set_market_contract`); fund green market USDC
  (reuse the shared USDC token `CA63EPM4…`).
- **B5** — Deploy + init **green router** (`./scripts/deploy_noether_router.sh`): `market = green
  MARKET_ID`, `noeracle = CAYIP67…`. → green NOETHER_ROUTER_ID.
- **B6** — Write all green addresses to **`contracts.staging.json`** (NOT `contracts.json`).

### Phase C — Validate GREEN via the real frontend (no new UI)

- **C1** — Point the existing app at green: `.env.local` / Vercel **preview** env / `staging.noether.exchange`
  with the green `NEXT_PUBLIC_*` (market, router, vault, NOE) + shared shim/Noeracle/USDC + the SSE ticker.
- **C2 — CHECKPOINT (the real test):** open ONE position via Freighter against the GREEN stack through
  the router. Confirm the deep auth tree (trader → router → market.open_position → USDC transfer) signs
  cleanly and **no #30**. Then exercise close, a keeper liquidation, an order, and the 500ms ticker.
- **C3** — Let it soak; watch the green keeper heartbeat + shim freshness.

### Phase D — Promote GREEN → live (reversible flip; user/Mert do dashboard env)

- **D1** — Announce a wind-down for open positions on the OLD market (they keep working until the flip).
- **D2** — Flip noether.exchange **Vercel** env to the green addresses; switch the **prod keeper**
  (Railway) to Noeracle-push (or cut over to the green keeper); re-index from the green market start ledger.
- **D3** — Promote `contracts.staging.json` → `contracts.json`; remove mock/adapter/Band/DIA.
- **D4** — If anything misbehaves, **flip env back** to the old addresses (that's the whole point of blue-green).

### Phase E — Land in main
Open a PR `feature/noeracle-integration → main` with a full summary (commits, what changed, the
blue-green cutover, how #30 is fixed). User reviews + merges (respects husky main-branch protection).
Can open the PR once green is validated (Phase C); the promotion (Phase D) is config, not code.

---

## 8. Working-tree state at handoff (verified 2026-05-31)

`contracts.json` is **CLEAN** (committed in `bcb4acf`; the earlier "modified" worry was stale — diff is empty).

**Uncommitted changes present = finished A1 work (KEEP & COMMIT, do not discard):**
- `M contracts/market/src/lib.rs` — inline `mod mock_oracle { #[contract] MockOracle … pub use
  MockOracleClient as Client; }` replacing the `contractimport!` of `mock_oracle.wasm`. The 7
  `mock_oracle::Client::new` call sites are unchanged (the alias makes them resolve). This is the
  proven version that passed **34/34** (`cargo test -p market`).
- `M` ×20 `contracts/market/test_snapshots/tests/*.json` — auto-regenerated cost snapshots, the
  expected side effect of swapping the imported-wasm mock for an inline contract. Commit alongside the .rs.
- **Action:** `cargo test -p market` → expect 34 passed → commit all 21 files as A1. (Note: market
  still in `contracts/Cargo.toml`; `mock_oracle` crate still exists — A1 only removed the *test's*
  dependency on the wasm. Deleting the crate is A2.)

**Undecided:**
- **`?? sdk-ts/noether-sdk-0.1.1.tgz`** — untracked 45 KB build artifact. User hasn't decided
  gitignore-or-commit. Ask. (Recommendation: gitignore — packaged tarballs don't belong in git.)

---

## 9. Risks & gotchas (read before Phase B)

- **#30 is NOT killed by the market redeploy alone.** The market still staleness-checks the timestamp
  it reads. Only the **router** makes *user-trade* timestamps sub-second. The heartbeat keeps the
  persistent slot warm for non-router reads.
- **Keeper-initiated liquidations / order executions / funding do NOT use the router** (it only has
  `open_with_price`/`close_with_price`). They rely on the ≤30s heartbeat staying inside the 60s window.
  Bulletproofing them needs `liquidate_with_price` / `execute_with_price` on the router — a **fast-follow**, not this cutover.
- **Continuous keeper is now a hard dependency.** If it dies and a slot goes empty/stale, the shim
  panics **#32** and that pair's trades revert. (Same failure class as today, different error code.)
- **Market redeploy cost:** all current testnet positions/orders are lost; market must be re-funded;
  vault re-linked; indexer re-indexed; env re-synced in ~8 places.
- **🔴 S-1 (Noeracle security, MAINNET BLOCKER):** Noeracle's `update_ed25519_persistent` verifies a
  signature against a **caller-supplied** pubkey with **no registered-publisher check** — so anyone can
  write any price to the persistent slot the shim reads. **Testnet-OK** (valueless tokens). **Must be
  fixed on the Noeracle side before mainnet / real value.** Full spec in `docs/noeracle-feature-requests.md`
  (S-1, P0-1, etc.). Noeracle is a **separate repo** (`github.com/noeracle/noeracle`); the user chose to
  keep those as specs, not implement them here.
- **Router auth tree is unverified on-chain** until the B8 wallet test. Do not enable it globally before B8 passes.
- **Two keeper copies:** `scripts/keeper/` (dev) and `/Users/yahya/Desktop/Stellar/noetherkeeperbotv2/`
  (PROD, Railway auto-deploy). Update dev first, then mirror to prod **with user confirmation**.

---

## 10. Conventions / verify gates (quick reference)

- Contracts: `cd contracts && cargo test -p <crate>` and `cargo build --release --target wasm32-unknown-unknown`.
- Web: `cd web && npx tsc --noEmit`. Keeper: `cd scripts/keeper && npx tsc --noEmit`.
- Monorepo (api/indexer/sdk-ts/packages): `npm run typecheck` from root (`npm run build:packages` first if needed).
- Commit per phase; conventional commits; **no Co-Authored-By**. PR to main at the end.
- `contracts.json` is the authoritative address source; `.env`/Vercel/Railway are manual after deploy.

---

## 11. Open questions for the user (raise at session start)

1. The `sdk-ts/noether-sdk-0.1.1.tgz` — gitignore or commit?
2. Keep the redeployed market's `max_price_staleness` at 60s, or tighten it now?
3. Indexer re-index strategy after the market redeploy (cold-start ledger lookback)?
4. For B0, run the keeper locally during the cutover, or update prod `noetherkeeperbotv2` first?
