# TASKS.md — Noether Master Task List

Derived from the 2026-06-09 full-project audit (**`docs/AUDIT-2026-06.md`** — 87 findings with file:line evidence, 40 research insights, critic prioritization). Finding IDs below (M-1, V-2, O-1, …) reference that report.

## Decisions locked 2026-06-09

- **Mainnet date:** no date pressure. Apply to the SCF Audit Bank (`sorobanaudits@stellar.org`) once Phase 1–2 blockers are cleared; the audit then sets the launch date.
- **Oracle:** **Noeracle-only**, hardened (S-1/P0-1 in the Noeracle repo). Chainlink and Pyth (via Wormhole) get added as cross-checks **when they ship on Stellar** — keep `noeracle_shim`'s SEP-40 interface as the abstraction boundary so they plug in without custom adapters.
- **Mainnet v1 scope: LEAN.** 3 pairs (BTC/ETH/XLM) at 10x, allowlist + deposit caps + OI caps, insurance buffer. `vault_factory` (user vaults) and on-chain referral payouts are **deferred to v1.1** — their critical fixes (V-1, R-1) gate v1.1, not v1.
- Work is multi-session: check items off as they land; keep this file updated as the single source of truth for "what's next".

**Conventions:** `[sev/effort]` severity from the audit (critic-corrected) and rough effort (`h`=hours, `d`=days, `w`=week+). Every task lists its audit ID — read the full finding before starting.

---

## Phase 0 — Immediate (ops sanity + hours-level quick wins)

### Ops checks (do first, ~minutes each)

- [ ] **P0-1** [critical/h] **Verify Railway build branch for api + indexer** (D-4). Addresses are baked into Docker images from `contracts.json` at build time — env vars canNOT re-point them. `origin/main` is pre-cutover: if Railway builds from `main`, the gateway/indexer serve the OLD stack while the site runs the new one. Done when: both services confirmed building from `staging` (or images rebuilt), and resolved addresses logged at boot.
- [ ] **P0-2** [high/h] **Confirm production env vars**: `API_HMAC_PEPPER`, `API_KEY_ALLOWLIST`, `API_CORS_ORIGIN`, `CRON_SECRET` set on Railway/Vercel (SEC-5, A-4). Done when: all four verified present and non-default.

### Contract-adjacent one-liners (no redeploy needed)

- [ ] **P0-3** [critical/h] **Cross-margin SL/TP guard — web-side interim** (M-3): until the contract fix deploys, hide/disable SL/TP and trailing-stop UI for cross-margin positions so users can't corrupt their own cross accounts. Done when: order-attach UI unavailable when `margin_mode==1`.

### Web quick wins (`web/`)

- [ ] **P0-4** [low/h] Rename `lookup_code` → `resolve_code` in `web/lib/stellar/referral.ts:83`; distinguish simulation-failure from "code free" (R-7). Done when: taken codes show "taken" before signing.
- [ ] **P0-5** [high/h] **Fix false referral copy** (R-2, R-3): `/referrals` page + `CreateCodeCard` claim the contract enforces a 14-day volume threshold (it doesn't) and `ClaimFeesCard` promises direct wallet payouts (claim transfers nothing). Soften/correct copy; disable the Claim button with an "accrual goes live in v1.1" note. Done when: nothing on the page promises a money flow that can't happen.
- [ ] **P0-6** [high/h] Portfolio USDC balance: read `useWallet().usdcBalance` in `web/app/portfolio/page.tsx:19` (W-3/F-3). NOE balance: call `getNoeBalance` in `useWallet` onConnect/refresh (`useWallet.ts:61,125`, F-4). Done when: real balances render.
- [ ] **P0-7** [low/h] Gate the 21 `[DEBUG]` logs behind `NODE_ENV!=='production'` (`client.ts`, `market.ts`, `vault/page.tsx`); add `decodeContractError()` mapping `noether_common/src/errors.rs` codes (#30 → "Price feed stale — retry", etc.); delete the stale `AllOraclesFailed` branch in `OrderPanel.tsx:353` (W-8).
- [ ] **P0-8** [medium/h] Call `assertContractsConfigured()` from `app/providers.tsx`; add `NOERACLE_SHIM` to `REQUIRED_CONTRACTS`; loud banner when `NOETHER_ROUTER` unset in prod (W-5).
- [ ] **P0-9** [medium/h] SSE staleness handling in `web/lib/stellar/noeracle.ts`: `onerror` + last-frame watchdog → amber "live prices stale" badge + 5s shim-poll fallback (W-4).

### API quick wins (`api/src`)

- [ ] **P0-10** [high/h] Fix tiered rate limiting: resolve the bearer key inside the `onRequest` hook so `request.user` exists when the tier is computed; `requireAuth` short-circuits if already set (A-1). Done when: a test asserts `X-RateLimit-Tier: standard` for a real key.
- [ ] **P0-11** [high/h] `trustProxy: 1` in the Fastify factory; use `request.ip` (delete `pickClientIp`); periodic DELETE sweep of stale `rate_limit_buckets` rows (A-2).
- [ ] **P0-12** [high/h] Rewrite `/v1/account/me/positions` + `/me/orders` as SQL-side queries against the positions projection / trader-filtered events (A-3). Done when: an active trader with >200 global events still sees their open positions.
- [ ] **P0-13** [medium/h] `API_HMAC_PEPPER`: fail-fast at startup in production when unset/default; constant-time compare via the existing `timingSafeEqualHex` (A-4, SEC-8).
- [ ] **P0-14** [high/h] Fail-closed defaults: refuse prod boot when allowlist/CORS unset; reject cron when `CRON_SECRET` undefined; document all three in `.env.example` (SEC-5).

### Indexer quick wins (`indexer/src`)

- [ ] **P0-15** [high/h] Per-event try/catch in `pollOnce` → `dead_letter` table (event_id, error, raw XDR), keep advancing; rethrow/dead-letter handler failures so the cursor halts instead of silently dropping (I-1). Done when: a malformed-payload vitest passes without wedging the poller.
- [ ] **P0-16** [medium/h] Idempotency guard: skip `applyEvent` + bus emit when `persistRaw` rowsAffected==0; change `code_created` to `ON CONFLICT DO UPDATE` preserving counters (I-2 minimal, R-4).
- [ ] **P0-17** [medium/h] Fix `decodeCrossLiq` field mapping (`totalPnl=v[1]`, `keeperReward=v[2]`); clean up phantom open positions on `cross_liq` via on-chain verification (I-5).

### CI (do early — everything after this gets a net)

- [ ] **P0-18** [high/h] Add `staging` to `ci.yml` triggers + `.husky/pre-commit` branch case. Add jobs: contracts (`cargo test --workspace` + `cargo clippy -- -D warnings`, rust-cache), web (`npx tsc --noEmit`), sdk-py (`pytest`) (D-1). Fix the two failing `vault_factory` `leader_*` tests so the job starts green (likely V-1-related — investigate, don't paper over).

---

## Phase 1 — Contract security sprint (one testnet redeploy at the end)

> Bundle all of these into a single WASM refit + blue-green `deploy_staging.sh` → verify → promote. Watch the 64KB budget throughout — drop view helpers if needed (the bulk-read replacement lives in Phase 5 as a separate view contract).

- [ ] **P1-1** [critical/d] **Pause + upgrade entry points on market** (M-1, SEC-2): admin-gated `pause()`/`unpause()` (liquidations exempt from the pause check) + `upgrade(wasm_hash)` via `env.deployer().update_current_contract_wasm`. Add the same upgrade hook to vault + router. Done when: pause blocks open/close/deposit on testnet; upgrade round-trips a no-op WASM.
- [ ] **P1-2** [critical/h] **Cross-margin SL/TP fix** (M-3): reject `margin_mode==1` in `set_stop_loss`/`set_take_profit`/`place_trailing_stop` (or route execution through the cross close path). Cancel linked SL/TP in `close_position` + `close_position_cross` (zombie orders). Regression tests for both.
- [ ] **P1-3** [critical/w] **OI caps + real reservation** (M-4, V-3): per-asset per-side OI caps (% of vault TVL — see parameter sheet) + aggregate reserve ≤60-75% TVL enforced in `open_position`/`open_position_cross`; `reserve_for_position` actually accumulates committed payouts and releases on close/liquidate; `settle_pnl` must not hard-revert a winning close (cap payout at available + record shortfall against the Phase 5 buffer). Done when: a winner's close cannot freeze, and opens beyond caps reject.
- [ ] **P1-4** [critical/d] **Wire unrealized PnL into vault NAV** (V-2, M-7, SEC-6): market calls `vault.update_unrealized_pnl` on open/close/liquidate (or `get_noe_price` queries a market aggregate view). Interim (pre-redeploy): keeper periodically pushes aggregate open PnL. Done when: NOE price moves with open trader PnL in a test.
- [ ] **P1-5** [critical/d] **Market-side oracle deviation guard** (M-2): enforce the existing-but-dead `max_oracle_deviation_bps` against a stored last-good price in `get_oracle_price`; staleness >60s → halt-open/allow-close semantics (never block closes).
- [ ] **P1-6** [high/h] **Vault TTL fix** (V-6): threshold ~17,280 / extend ~518,400 ledgers; shared TTL constants in `noether_common` used by market+vault+factory+router+shim.
- [ ] **P1-7** [medium/d] Reduce-only actually reduces (M-6): offset the trader's opposing position via `TraderPositions(addr)` instead of opening a new one through a global scan.
- [ ] **P1-8** [medium/d] Loss accounting: credit `settle_pnl` losses only up to funds actually received (V-3 tail).
- [ ] **P1-9** [high/d] **Vault + market test suites** (D-3): vault deposit/withdraw round-trip with fees, settle_pnl ±, NOE price after wins/losses, market-only auth rejection; market funding accrual + settlement-on-close, isolated liquidation threshold/reward-cap, C-1 underflow regression. Done when: `cargo test --workspace` covers every money path touched in this phase.
- [ ] **P1-10** [medium/d] **Protocol fee share** (critic missing-area #1): split trading fees market→vault vs →treasury/insurance (e.g. 80/20) so the protocol earns something to fund insurance, RPC, ops. Small change in the fee-transfer path; decide the split before the redeploy.
- [ ] **P1-11** [low/h] Move the duplicated symbol→tag map into `noether_common` (O-8) + cross-contract equality test.

---

## Phase 2 — Oracle + keeper hardening (parallel with Phase 1)

### Noeracle repo (Yahya — outside this repo, but gates everything)

- [ ] **P2-1** [critical/w] **S-1/P0-1: harden the persistent write path** (O-1): registered-publisher set, ed25519 signature over (feed, price, conf, timestamp), strictly-increasing round/timestamp per feed, staleness bound, per-update deviation bound; hardened `update_batch_ed25519_persistent` (1 tx per round); feature-gate benchmark stubs out of deployed WASM. Pyth model: 2-of-3 publisher quorum, keys on separate infra (even if all operated by Yahya initially). **Hard release gate for mainnet.**
- [ ] **P2-2** [high/w] Ring buffer `prices(asset,n)` + `twap(asset,n)` (O-4) so the market can use TWAP for liquidation/funding marks (consumed in Phase 5).
- [ ] **P2-3** [medium/d] `last_update`/freshness view (P3-8) for watchdog probes; optional `get_price_pers_fresh(max_age)` (O-6).

### This repo — router + shim

- [ ] **P2-4** [critical/d] **Router publisher allowlist** (O-2): store allowed publisher pubkeys at `initialize` (+ admin setter); `refresh_price` rejects foreign keys. Redeploy + re-init router. (Defense-in-depth — does not replace P2-1.)
- [ ] **P2-5** [high/d] **Router `liquidate_with_price` + `execute_with_price`** (O-3, K-3): mirror `close_with_price` (refresh then invoke market liquidate/execute_order); switch the keeper to them. Done when: a liquidation succeeds with a >60s-stale heartbeat slot.
- [ ] **P2-6** [medium/h] Coarse min/max price sanity bounds in router/shim as a backstop (O-7 tail).

### Keeper (`scripts/keeper` + Railway `noetherkeeperbotv2`)

- [ ] **P2-7** [critical/d] **Timeouts + watchdog + alerting** (K-1): `{timeout:15000}` on rpc.Server; `AbortSignal.timeout(10s)` on all fetches; watchdog `process.exit(1)` if no cycle completes in 3 min; Discord/Telegram webhook on startup/error-streak/shutdown; run compiled dist in prod. Apply to BOTH keeper copies.
- [ ] **P2-8** [critical/d] Publish-path defenses (K-2): persist last-pushed prices across restarts (file/libsql) so the circuit breaker survives boot; tighten per-asset jump bounds; sanity-check each attestation against one independent ticker before pushing, skip+alert on divergence.
- [ ] **P2-9** [high/d] Scan restructure (K-4): one per-cycle snapshot shared across phases; constant dummy Account for simulations; compute cross health locally; count consecutive read failures into stats + alert.
- [ ] **P2-10** [medium/h] Trailing-stop: simulate first, submit only when `true`; gate peak updates to post-oracle-push (K-5).
- [ ] **P2-11** [medium/d] `SOROBAN_RPC_URLS` failover (port indexer rotation) + fee escalation on liquidations + align tx timeout with polling window (K-6).
- [ ] **P2-12** [low/h] Funding scheduling: tri-state result; schedule from on-chain `last_funding_time + 3600` (K-7). Stop logging secret-key fragments; hard-fail admin-key fallback when NETWORK=mainnet (K-8).

---

## Phase 3 — Ops, monitoring, docs (cheap, high leverage — interleave anytime)

- [ ] **P3-1** [high/d] **Monitoring stack** (D-2): healthchecks.io deadman ping per keeper cycle; UptimeRobot/BetterStack on api `/v1/health`; extend `/v1/health` with last-indexed-ledger age; Railway webhooks → Discord. Done when: killing the keeper produces a notification within minutes.
- [ ] **P3-2** [high/h] **Retire the four legacy deploy scripts** (D-5): move `deploy_testnet.sh`, `setup_and_deploy.sh`, `market.sh`, `vault.sh` to `scripts/legacy/` with an exit-1 guard; update all CLAUDE.md deploy tables.
- [ ] **P3-3** [medium/d] `scripts/sync_env.sh` (render env blocks from contracts.json) + `scripts/verify_stack.sh` (compare contracts.json vs api-reported addresses vs site env vs shim freshness); call verify at the end of both deploy scripts (D-6).
- [ ] **P3-4** [high/h] **Env-var address overrides** in `packages/shared/src/contracts.ts` (`CONTRACT_<KEY>`), log resolved addresses at boot, echo from `/v1/health` (D-4 fix).
- [ ] **P3-5** [medium/h] **Docs ground-truth pass** (D-7): regenerate CLAUDE.md address table from contracts.json; replace the oracle-chain section with the Noeracle diagram; mark C-1 fixed, G-2 corrected (no gateway discount exists), F-1 partially fixed; rewrite GIT_WORKFLOW around staging-as-production; fix handoff §3; update scripts/ + contracts/ CLAUDE.md.
- [ ] **P3-6** [medium/h] **Turso backups + restore runbook** (D-8): PITR or nightly dump cron; document restore; plan to split api_keys into its own DB.
- [ ] **P3-7** [medium/h] 1-page incident runbook in docs/: pause procedure, key compromise, oracle-stale response, RPC failover, on-call rotation (who answers at 3am — critic #2), SEAL 911 contact.
- [ ] **P3-8** [critical/d] **Admin key ceremony** (SEC-3): 2-of-3 classic multisig on `noether_admin` (SetOptions, med/high thresholds = 2; Yahya + Mert + offline backup); dedicated low-privilege faucet key (get ADMIN_SECRET_KEY out of Vercel); dedicated keeper key enforced. Rotate `G...LOLN` before mainnet value.
- [ ] **P3-9** [medium/d] Keeper TTL job: proactively extend market/vault/router/shim instance+code TTLs (archived instance = dead exchange).
- [ ] **P3-10** [low/d] Keeper XLM burn model + wallet-funding alarm (critic #7): estimate tx/day at mainnet cadence, alert below balance threshold.

---

## Phase 4 — Off-chain correctness (api / indexer / web / SDKs)

### API

- [ ] **P4-1** [medium/d] WS hardening: global + per-IP connection caps, 30s ping/idle-close, per-conn token bucket, stringify-once broadcast, bufferedAmount backpressure (A-5).
- [ ] **P4-2** [medium/d] `/v1/tx/submit` taxonomy: DUPLICATE=idempotent poll-by-hash; TRY_AGAIN_LATER=503+Retry-After; decode resultXdr contract error number+name (A-6).
- [ ] **P4-3** [low/d] Cursor pagination (`before_ts`) on the six history endpoints; LIMIT on `/v1/positions/open?trader=`; cache or precompute `/v1/vaults` aggregates (A-7).
- [ ] **P4-4** [low/d] Response schemas for the remaining 9 route files; version from package.json; real servers URL; x-request-id echo; minimal metrics (A-8).
- [ ] **P4-5** [medium/h] Public `GET /v1/account/volume?address=` (14-day notional from indexer) → OrderPanel fee-tier preview uses it (R-6).
- [ ] **P4-6** [medium/h] Public `/v1/markets/stats` (OI + 24h volume from projections) + `/v1/trades?trader=` + orders endpoint — kills the remaining fake data (W-3, W-6 partial, I-8).

### Indexer

- [ ] **P4-7** [high/d] Full idempotency migration: UNIQUE keys on the five activity tables; transactions per event (I-2 complete).
- [ ] **P4-8** [high/d] Gap detection + retention clamp + RPC failover rotation + `ledger_gaps` table (I-3).
- [ ] **P4-9** [medium/d] `/healthz` with cursor lag (Railway healthcheck); CAS cursor writes to enforce single-writer (I-4).
- [ ] **P4-10** [medium/d] Store raw XDR columns in events_raw; extend close/liq decoders to carry asset/direction/size (fixes `trades.UNKNOWN`, enables close-side volume) (I-6).
- [ ] **P4-11** [medium/d] `npm run reindex` (replay events_raw through handlers) + contract_id stamping on projections (I-7).
- [ ] **P4-12** [low/d] Implement the trades projection (or drop dead tables); add LP vault events if T3 wants TVL/APY history (I-8).

### Web

- [ ] **P4-13** [high/d] **Single price source on the trade page** (W-1): OrderPanel/ChartHeader/AssetSelector fed from `subscribeLivePrices` (shared hook/store slice); Binance only for candles + 24h high/low, labeled "reference".
- [~] **P4-14** [medium/d] Personal-mode positions/orders via the indexer API with chain-scan fallback; shared getAccount per batch; OrderBook off the global scan (W-2).
  - [x] **Positions DONE** 2026-06-10 (commit `4c5788d`, staging). Personal mode now loads from `/v1/positions/open?trader=` + `getPositionsByIds` (was a whole-market `get_all_position_ids` + per-id scan on the public RPC); chain scan kept as fallback only on API error; staggered post-trade refetch (now+2.5s+6s) for read-your-writes. Prod API verified live + on current stack. **Still needs to reach `main` to help production.**
  - [ ] Orders list (`getOrders`) + OrderBook still do the whole-market RPC scan → move to a `/v1/orders?trader=` endpoint (table exists, needs an api route).
- [ ] **P4-15** [medium/d] Vault APY computed from real fee revenue vs TVL (or hidden until real); real NOE price on /vaults (W-3 tail).
- [ ] **P4-16** [medium/d] Mobile trade flow: bottom Long/Short bar + bottom-sheet OrderPanel (or order-* reflow); audit /vault + /vaults at 390px (W-7 — contractual T3 deliverable).
- [ ] **P4-17** [medium/d] TP/SL inputs at open (pipelined post-open txs now; router `open_with_price_and_tpsl` later); trade history from `/v1/trades` (W-6).

### SDKs + tx-builders

- [ ] **P4-18** [high/d] Router builders in tx-builders (`openWithPrice`/`closeWithPrice`); gateway fetches fresh attestation and routes via router when configured (S-1).
- [ ] **P4-19** [high/h] Fix sdk-py key issuance (manageData tx) + optional gateway fallback accepting raw ed25519 hex; **republish 0.1.2** (S-2).
- [ ] **P4-20** [high/h] WS: serialize per-connection message handling server-side; clients surface rejected/failed-login + re-send account.* subs after login ack (S-3). Fix connect() hang + timeout (S-4).
- [ ] **P4-21** [medium/h] Add missing endpoints to both SDKs (positions.open, vaults.trades, referral.info, keys.betaStatus); re-sync vendored types + CI drift test (S-5).
- [ ] **P4-22** [medium/h] Fix READMEs (install name!), examples (faucet step), changelog, version single-sourcing, websockets `<14` cap (S-6, S-8).
- [ ] **P4-23** [medium/d] tx-builders XDR snapshot tests (pure buildArgs + fixtures) wired into root npm test (S-7).
- [ ] **P4-24** [medium/w] E2E harness (critic #8): one scripted trade through web-path tx assembly → router → market → vault → indexer → API read-back against an ephemeral stack; doubles as the audit-readiness integration test.
- [x] **P4-25** [high/d] **Leaderboard cron data-loss fix (Tier A)** — DONE 2026-06-09 (commit `ef054cd`). The `web/app/api/cron/sync-leaderboard` cron marked txs processed before fetching their events, so RPC failures silently dropped traders' closed PnL forever (tester report). Fixed: mark-processed-only-on-definitive-fetch + retry/backoff + age-out, single-account open-position scan, composite trades key for cross closes, board defaults to PnL. **Follow-ups:** (a) one-time `processed_txs` reset (DELETE the `sync_state` row where key='processed_txs') to recover any wrongly-dropped trades still within Soroban RPC retention; (b) the public-RPC rate-limiting that causes the drops is the real lever — see paid-RPC note below.
- [ ] **P4-26** [medium/w] **Leaderboard durable fix (Tier B)** — drive the leaderboard from the indexer projections (a `/v1/leaderboard` gateway route or SQL aggregate over the indexer `trades`/positions tables) instead of the web cron re-scanning Horizon + fetching events from the rate-limited public RPC. Deletes the entire fragile BFS+getTransaction path and the unbounded `processed_txs` blob. Depends on indexer hardening (P4-7/P4-8) and a public market-stats/leaderboard read endpoint (P4-6).

---

## Phase 5 — Tranche 3 risk engine (pre-audit; parameters in `docs/AUDIT-2026-06.md` Part 2.2 #10)

- [ ] **P5-1** [high/w] Per-market `RiskConfig` struct in `noether_common` (MM bps, IM bps, OI caps, skew cap, funding params, leverage tiers) + admin setter — the rollout vehicle for new pairs.
- [ ] **P5-2** [high/d] **Maintenance margin raise**: MM = IM/2 (2% at 25x BTC/ETH, 5% at 10x XLM). Today's 1% MM is lethal at 25x.
- [ ] **P5-3** [high/w] **Funding upgrade** (research 2.2 #1): SIP-279 velocity form (`dr/dt = 36%/day × skew/skewScale`, clamp ±0.5%/hr majors, ±1%/hr alts), keep the lazy cumulative index. Only math.rs + config change.
- [ ] **P5-4** [high/w] **Borrow fee** (research 2.2 #2): second lazy cumulative index on utilization (dual-slope 0.001%/0.008%@80%/0.06%/hr) — the LP yield lever; makes APY real.
- [ ] **P5-5** [critical/w] **Partial liquidation** (T3 deliverable): 20-25% tranches, 30s cooldown, restore to ≥1.5× MM, full-close below 2/3 MM; penalty ~1% of closed notional split 50/50 keeper/insurance, 5 USDC keeper floor. May need to live in router/risk contract for WASM budget.
- [ ] **P5-6** [critical/w] **Insurance buffer** (T3 deliverable, Ostium-style): buffer sub-balance inside the vault — receives net trader losses + protocol fee share + liquidation penalties; pays trader wins FIRST; LP value debited only at zero. Seed $5-15k from tranche. Waterfall: margin → buffer → ADL → LPs. Compute health standalone (JELLY lesson).
- [ ] **P5-7** [high/w] **ADL** (last resort): force-close profitable positions ranked by PnL%×leverage when buffer exhausted / reserve utilization >95%; keeper supplies candidates, contract re-verifies on-chain; `adl_executed` event + indexer support. Required before 25x.
- [ ] **P5-8** [medium/w] TWAP marks: liquidation/funding read Noeracle TWAP (P2-2), spot for display/entry.
- [ ] **P5-9** [medium/w] Partial close (`close_position(size)` + pro-rata collateral/funding) + close-size slider; pairs with P5-5 plumbing. Most-requested UX feature.
- [ ] **P5-10** [medium/w] View/read contract restoring bulk queries (get_positions_by_trader etc.) — fixes N+1 at the root within the 64KB reality; storage sharding per pair for parallel execution (M-5, research 2.3 #1-2) — schedule at traction.

---

## Phase 6 — Audit + guarded mainnet launch

- [ ] **P6-1** [—/h] **Apply to SCF Audit Bank** (`sorobanaudits@stellar.org`) — trigger: Phases 1-2 complete. ~5% refundable co-pay; 2-4 month total lead; scope: market, vault, vault_factory, referral, router, shim, noether_common + Noeracle itself.
- [ ] **P6-2** [—/d] Pre-audit artifacts: `cargo scout-audit` across contracts/ + remediation plan; threat model + data-flow diagram (STRIDE per the Audit Bank checklist); integration tests in repo (P4-24).
- [ ] **P6-3** [—/d] Testnet→mainnet config-parity inventory (critic #5): every demo constant (fee tiers $20K/50K/100K → $1M/5M/25M, leverage, faucet, fake stats) catalogued with its mainnet value + a verify script gate.
- [ ] **P6-4** [—/d] Geo-block + ToS (research 2.4 #8): Vercel edge middleware (US, Ontario, OFAC) on trade/vault routes; ToS with restricted-persons + no-VPN warranties; same restrictions at the API gateway; one legal consult on entity domicile + NOE token treatment (critic #6).
- [ ] **P6-5** [—/h] SECURITY.md bug-bounty policy (critical = 10% of affected funds, cap $10-25k); upgrade to Immunefi at TVL.
- [ ] **P6-6** [—/d] Guarded-launch config: mainnet allowlist (reuse closed-beta plumbing), per-account deposit caps ($5-25k), per-market OI caps, 3 pairs at 10x; published cap-raise criteria; ramp to 25x/more pairs only after weeks of clean liquidation/funding/keeper metrics.
- [ ] **P6-7** [—/h] DefiLlama listing at mainnet (own the "Stellar perps" category); stake the "first perp DEX on Stellar" claim publicly (two funded competitors exist, neither live — Stellars Finance SCF #40, Hermes SCF #32).

---

## v1.1 — Deferred features (gate: their critical fixes land + audit coverage)

- [ ] **V1.1-1** [critical/w] vault_factory per-vault delta accounting (kill `sync_total_usdc` whole-balance read); vault→position ownership map; fix + re-enable the two failing `leader_*` tests (V-1).
- [ ] **V1.1-2** [high/d] Open-position value in factory vault NAV; block deposits while positions open as interim (V-4).
- [ ] **V1.1-3** [medium/w] Per-depositor cost basis for profit share (or forced fee-claim before every deposit/withdraw) (V-5).
- [ ] **V1.1-4** [critical/d] Referral economics end-to-end **in one redeploy**: market `record_trade` hook + on-chain discount + funded `claim()` (USDC transfer) + `volume` param (fixes the 2000x stat) + admin revoke/unbind/pause + on-chain `min_code_volume` (R-1, R-2, R-3, R-5, R-8).
- [ ] **V1.1-5** [low/h] `profit_share_bps` param + MAX cap enforcement (V-7).
- [ ] **V1.1-6** [—/d] Vault UX growth loop: withdrawal cooldown, indexer-backed track records (PnL curve/drawdown/age), one-click deposit (research 2.1 #9).

## Growth backlog (post-blockers; research-backed, roughly priority-ordered)

- [ ] **G-1** TP/SL at open as ONE signature: router `open_with_price_and_tpsl` (research 2.1 #2).
- [ ] **G-2** RWA pair strategy for "10+ pairs": XAU, EURUSD, indices via Noeracle feeds (Yahya's roadmap) — each new pair launches 3-5x leverage, 5%-TVL OI cap (research 2.1 #10). Avoid thin long-tail crypto (JELLY/AVAX attack surface).
- [ ] **G-3** Builder codes: `builder_bps` per API key + indexer attribution + payout via referral rails; pitch LOBSTR/xBull/StellarTerm (research 2.1 #8).
- [ ] **G-4** Points season computed off the indexer (weight fees paid + vault deposits + referrals, never raw volume); closed-beta cohort = season 0 (research 2.1 #7).
- [ ] **G-5** Agent keys (1-click trading): `authorize_agent(trader, agent)` trade-only session signers (research 2.1 #3).
- [ ] **G-6** Passkey smart wallets (PasskeyKit) + OpenZeppelin Relayer fee sponsorship (Launchtube is ARCHIVED) → mobile = PWA + passkeys; Relayer channel accounts also fix keeper sequence conflicts (research 2.1 #3, 2.3 #8).
- [ ] **G-7** Hosted developer docs site + tutorials + SDK quickstarts (critic #4 — prerequisite for G-3).
- [ ] **G-8** Blend integration: idle vault USDC earns yield → real APY story (research 2.3 #6).
- [ ] **G-9** Scale + TWAP orders as gateway-side child orders (no contract work) (research 2.1 #2).
- [ ] **G-10** Skew-reducing fee discount in trading.rs (cheap second lever besides funding) (research 2.1 #6).

---

## Reference — mainnet risk parameter sheet (from research; full version in audit doc Part 2.2)

| Domain | Parameter |
|---|---|
| Leverage/margin | BTC/ETH 25x (IM 4%, MM 2%) · XLM 10x (IM 10%, MM 5%) · new pairs 3-5x · MM = IM/2 |
| Funding | velocity dr/dt = 36%/day × skew/skewScale · skewScale = 2× OI cap · clamp ±0.5%/hr majors, ±1%/hr alts |
| Borrow fee | dual-slope: 0.001%/hr @0% · 0.008%/hr @80% target · 0.06%/hr @100% utilization |
| OI/skew | reserve ≤60-75% TVL · per-side caps BTC 25% / ETH 20% / XLM 10% / new 5% of TVL · net skew ≤10-15% TVL |
| Partial liq | 20-25% tranches · 30s cooldown · restore ≥1.5× MM · full-close <2/3 MM · penalty 1% notional (50/50 keeper/insurance, 5 USDC floor) |
| Insurance | seed ≥10% of aggregate OI cap · feed 100% liq penalties + 10-20% fees · waterfall margin→buffer→ADL→LP |
| Oracle | 2-of-3 publisher quorum · median across publishers · liq on fresh median · funding/NAV on 1h TWAP · >60s stale → halt-open/allow-close · deviation breaker 2%/min majors, 5%/min alts |
| Launch | deposit caps $5-25k/account · allowlist phase · 3 pairs @10x · publish cap-raise criteria |
