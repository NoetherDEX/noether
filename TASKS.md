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

- [x] **P0-3** [critical/h] **Cross-margin SL/TP guard — web-side interim** (M-3) — DONE 2026-07-04 (commit `9100166`). PositionsList buttons disabled + OrderPanel trailing dropdown filtered + trade-page handlers refuse for `marginMode==='Cross'`. Contract-side fix ALSO landed same day (P1-2, commit `71363e3`).

### Web quick wins (`web/`)

- [x] **P0-4** [low/h] Rename `lookup_code` → `resolve_code` (R-7) — DONE 2026-07-04 (commit `b709cbd`). lookupCode returns taken/free/unknown; CreateCodeCard shows taken pre-signing, amber on check-failure.
- [x] **P0-5** [high/h] **Fix false referral copy** (R-2, R-3) — DONE 2026-07-04 (commit `b709cbd`). Rates scoped to v1.1, volume-threshold claim removed, Claim button permanently disabled with v1.1 note.
- [x] **P0-6** [high/h] Portfolio USDC + NOE balances (W-3/F-3/F-4) — DONE 2026-07-04 (commit `b709cbd`). Note: WalletProvider session-restore path still shows NOE 0 until refresh; portfolio page has no NOE display element yet (follow-up with P4-15).
- [x] **P0-7** [low/h] Debug-log gating + `decodeContractError()` + stale branch deletion (W-8) — DONE 2026-07-04 (commit `9100166`). NOTE: error map now needs new code #80 CrossMarginOrderNotSupported added (introduced by P1-2 the same day).
- [x] **P0-8** [medium/h] `assertContractsConfigured()` wired from providers.tsx + NOERACLE_SHIM required + router-missing banner (W-5) — DONE 2026-07-04 (commit `b709cbd`).
- [x] **P0-9** [medium/h] SSE staleness handling (W-4) — DONE 2026-07-04 (commit `9100166`). onerror + 10s watchdog + amber badge + 5s shim fallback + auto-recovery.

### API quick wins (`api/src`)

- [x] **P0-10** [high/h] Tiered rate limiting engaged (A-1) — DONE 2026-07-04 (commit `64fd821`). Test asserts `X-RateLimit-Tier: standard` + key-bucket row.
- [x] **P0-11** [high/h] trustProxy + request.ip + bucket sweep (A-2) — DONE 2026-07-04 (commit `64fd821`).
- [x] **P0-12** [high/h] SQL-side /me/positions + /me/orders (A-3) — DONE 2026-07-04 (commit `64fd821`). /me/positions also returns authoritative `positions` array; `events` kept for SDK compat. Test seeds 600 global events. NOTE: /me/orders only sees order_placed (cancel/exec events carry no trader — indexer decoder gap, fold into P4-10).
- [x] **P0-13** [medium/h] Pepper fail-fast + constant-time compare (A-4, SEC-8) — DONE 2026-07-04 (commit `64fd821`).
- [x] **P0-14** [high/h] Fail-closed defaults (SEC-5) — DONE 2026-07-04 (commit `64fd821`). ⚠️ OPERATOR: after deploy, Railway api MUST have non-default `API_HMAC_PEPPER`, non-empty `API_KEY_ALLOWLIST`, non-wildcard `API_CORS_ORIGIN` or it refuses to boot; Vercel needs `CRON_SECRET` or the leaderboard cron 401s.

### Indexer quick wins (`indexer/src`)

- [x] **P0-15** [high/h] Dead-letter table + poison-loop fix (I-1) — DONE 2026-07-04 (commit `44e3b8c`). Migration 012; decode-fail → dead-letter + advance; apply-fail → dead-letter + rethrow (fail-loud once, recorded for replay; cursor advances after the retry pass hits the idempotency guard).
- [x] **P0-16** [medium/h] Idempotency guard + counter-preserving code_created (I-2 minimal, R-4) — DONE 2026-07-04 (commit `44e3b8c`). Applied across market/vault/referral handlers.
- [x] **P0-17** [medium/h] decodeCrossLiq mapping + phantom-position cleanup (I-5) — DONE 2026-07-04 (commit `44e3b8c`). New positionSync.ts verifies each projected row via get_position simulation on cross_liq.

### CI (do early — everything after this gets a net)

- [x] **P0-18** [high/h] CI on staging + contracts/web/sdk-py jobs (D-1) — DONE 2026-07-04 (commits `5d15c4e`, `a79f097`). The two failing leader_* tests were interface drift in the test stub (fake market returned u64/() where the real market returns Position/i128 — invoke_contract decode panic), NOT V-1 corruption; stub now mirrors the deployed interface. V-1 (commingling) remains real and remains the v1.1 gate. 114+ contract tests green; clippy status: see P1 sprint notes.

---

## Phase 1 — Contract security sprint (one testnet redeploy at the end)

> Bundle all of these into a single WASM refit + blue-green `deploy_staging.sh` → verify → promote. Watch the 64KB budget throughout — drop view helpers if needed (the bulk-read replacement lives in Phase 5 as a separate view contract).
>
> **STATUS 2026-07-04: ALL ELEVEN CODE ITEMS LANDED** (140 tests, clippy clean, market 65,363/65,536 B). ⚠️ REDEPLOY COUPLING: `is_liquidatable` and `should_execute_order` were removed for WASM budget — the keeper MUST ship its P2-9 update (local health calc + simulate-first execution) in the same rollout, and web's getOrders/OrderBook must not call the removed views (they don't — they use get_all_order_ids + get_order). Vault interface changed (reserve_for_position signature, settle_pnl returns i128, sync_exposure replaces update_unrealized_pnl) — market+vault deploy TOGETHER. After redeploy: admin should call market.set_fee_split(treasury, 2000) and review vault.set_asset_cap defaults vs the parameter sheet (BTC 25 / ETH 20 / XLM 10 %).

- [x] **P1-1** [critical/d] **Pause + upgrade entry points** (M-1, SEC-2) — DONE 2026-07-04 (commit `f28f01c`). pause/unpause on market (liquidations exempt — verified by test while paused); upgrade(wasm_hash) on market + vault + router. Tests: pause blocks open/close/cross-deposit, unpause restores, upgrade WASM round-trip with storage preserved. On-chain verification happens at the Phase-1 redeploy.
- [x] **P1-2** [critical/h] **Cross-margin SL/TP fix** (M-3) — DONE 2026-07-04 (commit `71363e3`, ships with the Phase 1 redeploy). All three attach fns reject `margin_mode==1` with new error #80; `cancel_position_orders` helper cancels attached SL/TP/trailing in close_position, close_position_cross, liquidate, liquidate_cross_account AND execute_close_order (sibling orders); trailing stops gained a PositionTrailingStop link + one-per-position rule. 4 regression tests; WASM 63,164B.
- [x] **P1-3** [critical/w] **OI caps + real reservation** (M-4, V-3) — DONE 2026-07-04 (commit `0bdb504`). ReservedPayout accumulates/releases; reserve cap 70% AUM + per-asset-side caps (default 25%, admin-settable) enforced at every open incl. limit-order execution (#82); settle_pnl caps payout + records Shortfall (winner can never freeze — test proves it); LP withdraws can't undercut reservations.
- [x] **P1-4** [critical/d] **Unrealized PnL wired into NAV** (V-2, M-7, SEC-6) — DONE 2026-07-04 (commit `0bdb504`). Market keeps per-asset K/S exposure aggregates and pushes asset uPnL via vault.sync_exposure on every open/close/liquidation; public sync_asset_pnl(asset) for keeper NAV freshness (wire into keeper cycle — P2). NOE-price-moves-with-PnL test passes.
- [x] **P1-5** [critical/d] **Oracle deviation guard** (M-2) — DONE 2026-07-04 (commit `1354119` + strictness unification in `0bdb504`). Strict paths (opens, entry executions, trailing peaks) reject stale + >1% moves vs last-good (#81); closes/liquidations never blocked; band self-disables after 10x staleness window of quiet.
- [x] **P1-6** [high/h] **Vault TTL fix + shared constants** (V-6) — DONE 2026-07-04 (commit `fb832f0`). noether_common::ttl (17,280/518,400) used by all six contracts.
- [x] **P1-7** [medium/d] Reduce-only actually reduces (M-6) — DONE 2026-07-04 (commit `0bdb504`). Closes the largest fitting opposing isolated position via TraderPositions; refunds order collateral; cancels when nothing fits (no partial close in v1 — full-close-or-cancel documented).
- [x] **P1-8** [medium/d] Receipt-based loss accounting (V-3 tail) — DONE 2026-07-04 (commit `0bdb504`). settle_pnl loss branch credits nothing; receive_loss credits exactly the transferred USDC (losses, funding, liquidation proceeds — all credit points wired); isolated-close outflows capped at the position's own collateral.
- [x] **P1-9** [high/d] **Vault + market test suites** (D-3) — DONE 2026-07-04. Vault: 7 tests (round-trip w/ fees, reserve caps, sync_exposure, settle shortfall, receipt credits, withdraw guard, auth rejection — first real suite, was zero). Market: 51 tests incl. funding-settles-on-close, liquidation reward cap, winner-never-freezes, loss-cap, reduce-only offset, fee split. C-1 underflow now structurally prevented (single saturating adjust_oi helper on every path). 140 tests workspace-wide, clippy -D warnings clean.
- [x] **P1-10** [medium/d] **Protocol fee share** — DONE 2026-07-04 (commit `0bdb504`). set_fee_split(treasury, bps≤5000), default 20%, inactive until treasury set. Vault's fee share now CREDITED to accounting (fees finally count toward AUM/LP yield). ⚠️ OPERATOR: call set_fee_split after redeploy to activate.
- [x] **P1-11** [low/h] Shared symbol→tag map (O-8) — DONE 2026-07-04 (commit `fb832f0`). noether_common::assets::symbol_to_tag + unit tests; shim panics/router Results preserved.

---

## Phase 2 — Oracle + keeper hardening (parallel with Phase 1)

### Noeracle repo (Yahya — outside this repo, but gates everything)

- [ ] **P2-1** [critical/w] **S-1/P0-1: harden the persistent write path** (O-1): registered-publisher set, ed25519 signature over (feed, price, conf, timestamp), strictly-increasing round/timestamp per feed, staleness bound, per-update deviation bound; hardened `update_batch_ed25519_persistent` (1 tx per round); feature-gate benchmark stubs out of deployed WASM. Pyth model: 2-of-3 publisher quorum, keys on separate infra (even if all operated by Yahya initially). **Hard release gate for mainnet.**
- [ ] **P2-2** [high/w] Ring buffer `prices(asset,n)` + `twap(asset,n)` (O-4) so the market can use TWAP for liquidation/funding marks (consumed in Phase 5).
- [ ] **P2-3** [medium/d] `last_update`/freshness view (P3-8) for watchdog probes; optional `get_price_pers_fresh(max_age)` (O-6).

### This repo — router + shim

- [x] **P2-4** [critical/d] **Router publisher allowlist** (O-2) — DONE 2026-07-04 (commit `3825396`). initialize takes publisher key set + admin set_publishers; refresh_price rejects foreign/empty keys (#3). ⚠️ OPERATOR: redeploy + re-init router with the keeper's publisher pubkey. Does NOT replace P2-1 (Noeracle O-1 hardening).
- [x] **P2-5** [high/d] **Router liquidate_with_price + execute_with_price** (O-3, K-3) — DONE 2026-07-04 (commit `3825396`). Plus liquidate_cross_with_prices(Vec<PriceAttestation>) for multi-asset cross accounts. Keeper switch is part of the P2-7..P2-12 keeper update (in progress). Contract side proven by mock tests; live >60s-stale liquidation verified at redeploy.
- [x] **P2-6** [medium/h] Coarse price sanity bounds (O-7 tail) — DONE 2026-07-04 (commit `3825396`). Per-asset bands in router refresh_price (BTC 1k-1M / ETH 50-100k / XLM 0.01-100); reject #31 regardless of signature.

### Keeper (`scripts/keeper` + Railway `noetherkeeperbotv2`)

> **IN FLIGHT 2026-07-04:** P2-7..P2-12 being implemented in one keeper-hardening pass (workflow). CRITICAL coupling: the market removed `is_liquidatable` + `should_execute_order` for WASM budget this session, so the keeper switch to local-health-calc + simulate-first execution ships in the SAME rollout, plus it must call the new router `liquidate_with_price`/`execute_with_price` (P2-5) and `market.sync_asset_pnl` per cycle. Apply to BOTH keeper copies.

- [x] **P2-7** [critical/d] **Timeouts + watchdog + alerting** (K-1) — DONE 2026-07-04 (commit `64b6d8e`). 15s rpc timeouts, 10s fetch aborts (Noeracle raced), 3-min watchdog→exit(1), dependency-free Discord/Telegram alerts (rate-limited), compiled dist in prod. ⚠️ apply to noetherkeeperbotv2 Railway copy.
- [x] **P2-8** [critical/d] Publish-path defenses (K-2) — DONE 2026-07-04 (commit `64b6d8e`). Prices persisted (breaker survives restart), per-asset jump bounds + absolute bands, independent Binance divergence check (>5% skip+alert).
- [x] **P2-9** [high/d] Scan restructure (K-4) — DONE 2026-07-04 (commit `64b6d8e`). One shared snapshot/cycle; dummy Account for sims; local liquidation-health calc (replaces removed is_liquidatable) + simulate-before-submit; read-failure streak counted+alerted. 24/24 smoke assertions on the health math.
- [x] **P2-10** [medium/h] Trailing-stop simulate-first (K-5) — DONE 2026-07-04 (commit `64b6d8e`). Replaces removed should_execute_order/update_trailing_peak views with simulate-then-submit; peaks only in cycles with an actual push.
- [x] **P2-11** [medium/d] RPC failover + fee escalation (K-6) — DONE 2026-07-04 (commit `64b6d8e`). SOROBAN_RPC_URLS rotation, 2x liq fee escalation (cap 5 XLM), tx timeBounds aligned to 30s poll, NOT_FOUND→indeterminate re-check (no dup submits).
- [x] **P2-12** [low/h] Funding tri-state + key hygiene (K-7/K-8) — DONE 2026-07-04 (commit `64b6d8e`). applied|not-due|failed from persisted last-submit (no on-chain view exists); no secret fragments logged; hard-fail admin-key fallback on mainnet.

---

## Phase 3 — Ops, monitoring, docs (cheap, high leverage — interleave anytime)

- [~] **P3-1** [high/d] **Monitoring stack** (D-2) — CODE PART DONE 2026-07-04 (commit `bbfb9d1`): `/v1/health` now reports last-indexed-ledger age + resolved contracts. Keeper Discord webhook alerting lands with P2-7 (keeper workflow). ⚠️ OPERATOR: point UptimeRobot/BetterStack at `/v1/health` (alert when `indexer.ledgerAgeSeconds` climbs), add healthchecks.io deadman ping, Railway→Discord webhooks.
- [x] **P3-2** [high/h] **Retire legacy deploy scripts** (D-5) — DONE 2026-07-04 (commit `b2dd4f0`). Four scripts → scripts/legacy/ with exit-1 guards (verified) + README; all three CLAUDE.md deploy tables updated (CLAUDE.md is gitignored — edits are local).
- [x] **P3-3** [medium/d] sync_env.sh + verify_stack.sh (D-6) — DONE 2026-07-04 (commit `0df9816`). sync_env renders NEXT_PUBLIC_* + CONTRACT_* + railway CLI from contracts.json; verify_stack diffs contracts.json vs api /v1/health echo + flags stale cursor, exit 1 on drift. ⚠️ still to wire: call verify_stack at the tail of deploy_staging.sh/deploy_production.sh.
- [x] **P3-4** [high/h] **CONTRACT_* env overrides + boot log + /v1/health echo** (D-4) — DONE 2026-07-04 (commit `bbfb9d1`). getContract/hasContract honour CONTRACT_<KEY>; api+indexer log resolved addresses at boot; /v1/health echoes {address, source}. Documented in .env.example.
- [~] **P3-5** [medium/h] **Docs ground-truth pass** (D-7) — MOSTLY DONE 2026-07-04 (local edits, CLAUDE.md gitignored): root + contracts/ CLAUDE.md address table regenerated from contracts.json, oracle-chain section → Noeracle diagram, mock_oracle/adapter/Band/DIA marked RETIRED, deploy tables updated, SEC-3 + CONTRACT_* notes. STILL: KNOWN_ISSUES.md C-1/G-2/F-1 markers, GIT_WORKFLOW staging-as-production rewrite, handoff §3.
- [ ] **P3-6** [medium/h] **Turso backups + restore runbook** (D-8): PITR or nightly dump cron; document restore; plan to split api_keys into its own DB.
- [x] **P3-7** [medium/h] Incident runbook — DONE 2026-07-04 (commit `0df9816`). docs/INCIDENT_RUNBOOK.md: triage table, oracle-stale, keeper-down, exploit→pause (P1-1), key compromise (SEC-3), RPC failover, on-call + SEAL 911.
- [ ] **P3-8** [critical/d] **Admin key ceremony** (SEC-3): 2-of-3 classic multisig on `noether_admin` (SetOptions, med/high thresholds = 2; Yahya + Mert + offline backup); dedicated low-privilege faucet key (get ADMIN_SECRET_KEY out of Vercel); dedicated keeper key enforced. Rotate `G...LOLN` before mainnet value.
- [ ] **P3-9** [medium/d] Keeper TTL job: proactively extend market/vault/router/shim instance+code TTLs (archived instance = dead exchange).
- [ ] **P3-10** [low/d] Keeper XLM burn model + wallet-funding alarm (critic #7): estimate tx/day at mainnet cadence, alert below balance threshold.

---

## Phase 4 — Off-chain correctness (api / indexer / web / SDKs)

> **IN FLIGHT 2026-07-04 (workflow):** api P4-2/4/5/6, indexer P4-7/8/9/10/11, sdk P4-19/20/21/22 being implemented. Web items (P4-13..P4-17) and the api-dependent web bits are NOT in that batch — they remain for a focused web pass. P4-25 already done (pre-session).

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
