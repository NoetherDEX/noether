# P2 — Differentiators & Later (Build Plan)

> Source analysis: docs/LIGHTER-GAP-2026-07.md (2026-07-17) · Companion files: docs/plans/P0-mainnet-gates.md, P1-launch-parity.md, P2-differentiators.md · Cross-refs cite TASKS.md / docs/AUDIT-2026-06.md / KNOWN_ISSUES.md — those ledgers are not modified.

## How to track

- Status values: `todo | in-progress | done | dropped`. Edit status inline in BOTH the tracking table and the item header — keep them in agreement.
- IDs are stable — never renumber.
- Baseline tags PROD / STAGING / CODE-COMPLETE are used as defined in the gap doc preamble (PROD = the 2026-07-06 production stack; STAGING = the 2026-07-10 staging stack; CODE-COMPLETE = built and tested, deployed nowhere).
- P2-specific: every item carries a **Promotion trigger** — the condition that moves it from parked to built. Do not start an item whose trigger has not fired, except the explicitly "active now" slivers named inside a trigger.

## Tracking table

| ID | Title | Effort | Lane | Ships in | Needs | Status |
|----|-------|--------|------|----------|-------|--------|
| L2-1 | Agent/session keys + one-click trading (G-5) | L | mixed | batch-1-redeploy | L0-21 | todo |
| L2-2 | Sub-account emulation at the gateway | M | offchain | offchain-now | L1-15 | todo |
| L2-3 | Multi-asset collateral (blocked on a collateral-liquidation rail decision) | L | contracts | post-launch | — | todo |
| L2-4 | Order housekeeping: GTT expiry, cancel_all, clientRef, deadman | M | mixed | batch-1-redeploy | L2-1, L1-8 | todo |
| L2-5 | TWAP / scale execution | M | offchain | offchain-now | L2-1 | todo |
| L2-6 | TIF semantics honesty (IOC / PostOnly) | S | contracts | batch-1-redeploy | L0-21, L1-8 | todo |
| L2-7 | Capital-efficient resting orders (cross-funded, margin at execution) | L | contracts | post-launch | L1-1 | todo |
| L2-8 | Per-asset-class buffer sharding (LLP Strategies analog) | M | contracts | post-launch | L0-1, L0-2 | todo |
| L2-9 | Segregated experimental pool (XLP analog) | L | mixed | post-launch | L0-12, L0-8 | todo |
| L2-10 | Configurable vault economics (V-7) + per-depositor performance fees (V-5) | M | mixed | post-launch | L0-20 | todo |
| L2-11 | NOE pre-mint ceiling monitoring + distinct exhaustion error | S | mixed | batch-1-redeploy | L0-16 | todo |
| L2-12 | Builder codes / partner attribution | M | mixed | offchain-now | L1-18, L2-18 | todo |
| L2-13 | Oracle config transparency endpoint | S | offchain | offchain-now | — | todo |
| L2-14 | Verifiability package: litepaper + Verify-Noether walkthrough + THREAT_MODEL publication | M | offchain | offchain-now | L0-18 | todo |
| L2-15 | Disclosure surface: PGP intake + security.txt + docs security page | S | offchain | offchain-now | — | todo |
| L2-16 | Market-data freshness path (sub-second prices, direct event push) | M | offchain | offchain-now | — | todo |
| L2-17 | Margin-mode/leverage persistence + mode switching | S | offchain | offchain-now | — | todo |
| L2-18 | Token/staking stack — deliberate deferral with two banked decisions | S | operator | operator-track | L0-16 | todo |
| L2-19 | RWA markets — conditional far-future path | L | mixed | post-launch | L0-9, L0-12, L0-14, L1-24 | todo |

## Out-of-scope ledger

Decisions, not omissions — each entry is a deliberate call with its one-line rationale. Reopen only via a new decision record.

- **Spot venue** — SDEX exists; revisit only with the L2-3 seizure-rail decision.
- **Prelaunch markets** — no price source without an orderbook; XLP-style segregation is the prerequisite.
- **Pre-IPO markets** — internal price discovery requires an orderbook — never in this architecture.
- **Self-trade prevention modes** — no book, no self-crossing.
- **Orderbook depth APIs** — headroom capacity IS the pool-model depth (see L1-13).
- **Funding-rate rebates** — Lighter sunset its own program 2026-05-15.
- **LLP-style stake-gated LP access** — engineering scarcity on an empty vault is backwards.
- **Latency monetization** — everyone settles at ledger cadence on Soroban.
- **Zero-fee retail** — fees are LP compensation; the pool IS the counterparty.
- **Notional-tiered IM brackets within a market** — the $100k position cap + AUM-relative OI caps already bound it.
- **A third CMR margin tier** — oracle-fill liquidation is instant; two tiers + bankruptcy override is the correct pool translation.
- **Contract-level sub-accounts** — gateway emulation first (L2-2).
- **Dead-man switch before agent keys** — impossible without L2-1; the gateway cannot sign.

## Items (L2-1..L2-19)

### L2-1 · Agent/session keys + one-click trading (G-5)

**Status:** todo · **Effort:** L · **Lane:** mixed · **Ships in:** batch-1-redeploy · **Needs:** L0-21 · **Blocks:** L0-18, L2-4, L2-5
**Cross-refs:** TASKS G-5 · TASKS G-6 · AUDIT research 2.1 #3 · LIGHTER-GAP §Platform (Session/agent keys row) · **Gap rows:** Platform, API & trust — Session/agent keys, sub-accounts, one-click trading (agent-keys + one-click halves)

**Promotion trigger:** Scope decision must be confirmed before the batch-1 surface freeze (it ships inside the audited redeploy); the web 1-click mode itself activates once staging shows grant→trade→revoke working end-to-end. No external demand gate — L2-4's deadman and L2-5's server-side TWAP both wait on this.

**Current state (verified):** PROD and STAGING identical: no agent/session-key concept exists anywhere — `git grep authorize_agent|agent_key|session_key` over contracts/, api/, web/, packages/ returns zero hits. Every trading entrypoint hard-requires the trader's own signature: `trader.require_auth()` at contracts/market/src/lib.rs:304 (do_open), :429 (close_position), :1190 (place_limit_order), :1570 (cancel_order), etc. Opens additionally pull USDC from the trader's wallet inside the same invocation (`token_client.transfer(&trader, ...)` at lib.rs:326-327 for the cross shortfall, lib.rs:1241 for order prefund) — those token sub-invocations can only be authorized by the trader's key, so an agent signature can never fund an open from the wallet. Web signing always goes through the wallet kit popup (web/lib/hooks/useWallet.ts:9 → signWithWallet). TASKS G-5 (TASKS.md:221) is the untouched backlog spec.

**Design:** Contract (market): new persistent key `DataKey::AgentGrant(Address trader, Address agent) -> AgentGrant { expiry_ledger: u32, scope: u32, max_notional: i128 }` (scope bitmask: 1=OPEN, 2=CLOSE, 4=CANCEL; max_notional in 7-decimal USD, per-position cap). Entrypoints: `authorize_agent(trader, agent, expiry_ledger, scope, max_notional)` — trader.require_auth; expiry_ledger > current; 0 < scope <= 7; max_notional > 0; event `agent_authorized(trader, agent, expiry_ledger, scope, max_notional)`. `revoke_agent(trader, agent)` — event `agent_revoked(trader, agent)`. `agent_open_cross(agent, trader, asset, collateral, leverage, direction)` — agent.require_auth, grant check, POOL-FUNDED ONLY: reject if CrossMarginBalance(trader) < collateral with #76 CrossMarginInsufficientBalance (no wallet pull — Soroban token auth makes wallet pulls impossible under an agent sig, which is also the custody guarantee: an agent key can never move wallet funds); `size = collateral × leverage` must be <= max_notional; then the existing open_position_cross body (margin gate, OI caps, and L0-10 acceptablePrice when it lands). `agent_close(agent, trader, position_id)` — scope CLOSE, position.trader == trader, routes the existing isolated/cross close paths (risk-reducing). `agent_cancel_orders(agent, trader, order_ids: Vec<u64>)` — scope CANCEL, reuses L2-4 cancel_orders internals. New error `AgentUnauthorized = 84` (missing/expired grant, scope miss, over-cap). Router: add `agent_open_with_price(...)` passthrough mirroring open_with_price so agent opens ride a fresh attestation (avoids #30/#81 on quiet pairs). Explicitly NO agent path for deposit/withdraw_cross_margin, LP withdraw, or margin removal. Web 1-click mode: enable = two prompts — (1) classic createAccount funding an in-memory ephemeral Keypair with ~5 XLM for fees, (2) an authorize_agent tx (defaults: expiry ~17,280 ledgers ≈ 24h, scope OPEN|CLOSE|CANCEL, max_notional user-set, default `5_000 × PRECISION` = $5k). The session key lives ONLY in memory (dies on refresh); persistent header badge "1-click ON · cap $X" with a kill switch that wipes the key locally immediately and fires revoke_agent (+ account-merge of leftover XLM back to the trader). Gateway: /v1/orders/prepare gains optional `asAgent: { trader }` — the key owner becomes the agent/source, the trader param is the declared principal; the contract enforces the grant (the gateway pre-checks by reading the grant for a friendly 403).

**Implementation**

**contracts/market**
- [ ] Add AgentGrant storage key + struct and error #84 AgentUnauthorized to noether_common/errors.rs (coordinate the batch-1 error-code registry — enum comment claims ~48-variant capacity, 42 used)
- [ ] Implement authorize_agent / revoke_agent + agent_authorized/agent_revoked events
- [ ] Implement agent_open_cross (pool-funded only), agent_close, agent_cancel_orders reusing existing open/close/cancel internals
- [ ] Tests: grant lifecycle; expired-grant rejection; scope rejection per op; max_notional rejection; agent_open with empty pool fails #76 and never touches the wallet; revoke mid-session blocks the next op; agent cannot reach withdraw_cross_margin (no entrypoint — negative compile-surface note in the test module)
- [ ] Measure WASM delta — this rides the already-tight batch-1 refit

**contracts/noether_router**
- [ ] Add agent_open_with_price passthrough (relay attestation → market.agent_open_cross) + test

**packages/tx-builders**
- [ ] Add buildAuthorizeAgentTx / buildRevokeAgentTx / buildAgentOpenCrossTx / buildAgentCloseTx / buildAgentCancelOrdersTx; regenerate XDR snapshots via the L0-21 simulation CI

**api**
- [ ] prepare schema: optional asAgent.trader on open/close/cancel ops; bind source = key owner (agent), pre-check the grant via contractReader; document in OpenAPI

**sdk-ts**
- [ ] Mirror agent ops in the orders sub-client + typed AgentGrant params

**sdk-py**
- [ ] Mirror agent ops in noether_sdk/sub/orders.py

**web**
- [ ] 1-click enable flow (fund session account + authorize_agent), in-memory Keypair signer path in web/lib/stellar/client.ts bypassing the wallet kit when session mode is active
- [ ] Header badge with notional cap + kill switch (local wipe + revoke_agent + XLM merge-back)
- [ ] Session-mode trade ops route through router agent_open_with_price / agent_close

**docs**
- [ ] Document the custody model: agent keys can trade pool funds only, never wallet funds; publish scope/expiry/cap semantics + revocation

**indexer**
- [ ] Decode agent_authorized/agent_revoked into events_raw (generic decoder path) so account WS surfaces grant changes

**Acceptance:**
- cargo test -p market: test_agent_grant_lifecycle, test_agent_open_pool_funded_only (asserts wallet balance unchanged and #76 on empty pool), test_agent_scope_and_expiry_rejected, test_agent_notional_cap, test_revoke_blocks_agent all pass
- On staging: a session key opens+closes a cross position with zero wallet popups after the one-time enable; wallet USDC balance provably untouched by agent ops
- revoke_agent on-chain + kill switch leaves the next agent op failing with #84 within one ledger
- POST /v1/orders/prepare with asAgent returns a simulatable tx for an agent-keyed API key and 403 with a grant-missing message otherwise
- WASM size of market.wasm printed in CI and under the 128KB limit with all batch-1 items included

**Risks:** WASM: 3 entrypoints + grant checks land on a market already carrying the whole batch-1 set (partial close L0-6, ADL L0-1, per-market config L0-12) — measure per-commit; if over budget the fallback is agent_close/agent_cancel only (drop agent_open to a later refit) since risk-reducing ops are the deadman/safety core. Security: this is a NEW auth path entering the frozen audited surface — must be in the L0-18 audit scope; scope semantics must be trivially explainable to the auditor. Event drift: two new event types — update the CLAUDE.md event table + indexer together. Session-key UX risk: the in-memory key dies on refresh mid-TWAP; document loudly. Error-code registry contention with other batch-1 items (only ~6 enum slots free per the errors.rs capacity comment — verify that limit and consolidate).

### L2-2 · Sub-account emulation at the gateway

**Status:** todo · **Effort:** M · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** L1-15 · **Blocks:** —
**Cross-refs:** TASKS G-5 (covers agent keys, explicitly NOT sub-account margin) · LIGHTER-GAP §Margin (Account structure row) · LIGHTER-GAP §Platform (Session/agent keys row) · **Gap rows:** Margin & collateral — Account structure: sub-accounts and the unified-trading-account translation · Platform, API & trust — Session/agent keys, sub-accounts, one-click trading (sub-accounts half)

**Promotion trigger:** MM demand: >=2 integrators or market makers explicitly request isolated sub-identities or wallet-level aggregation. Contract-level sub-accounts (on-chain tier merge) only if those same integrators need merged fee tiers, and never before a post-batch-1 refit window.

**Current state (verified):** PROD and STAGING: one G-address = one account at every layer. The api_keys schema is key_id/secret_hash/owner/tier/label/created_at/last_used_at/revoked_at with no linkage concept (indexer/migrations/001_baseline.sql:130-139); keys are issued with tier permanently 'standard' because routes/keys.ts:178 calls `apiKeys.issue(address, label)` without the tier param (api/src/services/apiKeys.ts:33 default). Fee-tier volume is keyed on-chain per address — `DataKey::TraderVolume(Address)` at contracts/market/src/storage.rs:60 — so cross-wallet tier aggregation is impossible without a market change. Wallet-challenge auth (challenge/verify, api/src/services/walletAuth.ts:10-49) already provides the signature primitive a link flow needs. Spot-perp UTA unification is not-applicable (no spot venue; the wallet is the cash balance; cross opens auto-pull the shortfall at market lib.rs:321-331).

**Design:** Gateway-level named sub-identities: real Stellar wallets the user controls, linked under one master wallet for display/aggregation — no custody, no new signing machinery. New table `wallet_links(master TEXT, sub TEXT UNIQUE, label TEXT, created_at BIGINT, PRIMARY KEY(master, sub))`. Link flow: POST /v1/account/links `{sub, label, subChallengeXdr}` — caller authed as master (bearer key), plus the sub wallet completes the standard walletAuth challenge; both proofs required so neither side can claim a foreign wallet. DELETE /v1/account/links/:sub; GET /v1/account/links. Aggregation: `?aggregate=1` on GET /v1/account/volume (sums 14-day notional across links), /v1/account/me/positions, /v1/trades?trader= — the response carries a `perWallet[]` breakdown plus the merged total, labeled `displayAggregate: true` because the ON-CHAIN fee tier remains per-wallet (state this in docs and UI; do not fake a merged tier). Web: account switcher in the header listing linked identities with labels; the 'new sub-identity' path recommends the user's wallet-app account feature (we do NOT generate/store trading keypairs in the browser — that is L2-1's session-key territory with different lifetime semantics). Contract-level version (only if MM demand proves out): a `VolumeDelegate(Address sub) -> Address master` map consulted by record_trade_volume so TraderVolume accrues to the master — Lighter's L1-address stake-aggregation analog; a later market refit, never batch-1. This is a P2 sketch: exact response shapes finalize at build time.

**Implementation**

**api**
- [ ] Migration: wallet_links table
- [ ] POST/GET/DELETE /v1/account/links with dual-proof (master bearer + sub walletAuth challenge)
- [ ] aggregate=1 support on volume/positions/trades reads with perWallet breakdown
- [ ] Rate-limit link creation (5/day/master)

**web**
- [ ] Header account switcher + link-wallet flow + 'aggregate view' toggle on portfolio
- [ ] Copy: on-chain fee tier stays per-wallet

**sdk-ts**
- [ ] account.links() CRUD + aggregate params on account/volume methods (mirror in sdk-py)

**docs**
- [ ] Sub-identities page: what aggregates (display) vs what does not (on-chain tier, margin)

**Acceptance:**
- api vitest: link requires BOTH proofs (master-only and sub-only each 401/403); GET /v1/account/volume?aggregate=1 returns the sum of two seeded wallets' 14d volume with perWallet rows
- A linked wallet cannot be re-linked under a second master (UNIQUE violation surfaced as 409)
- Web switcher swaps the active identity without page reload; portfolio aggregate view renders merged totals with per-wallet chips
- Docs page states explicitly that contract fee tiers do not merge

**Risks:** Expectation drift: users will assume linked volume merges their on-chain fee tier — it does not until the contract-level delegate ships; every aggregate surface must carry the disclaimer or this becomes a 'fees lied to me' ticket. Privacy: links are server-side state revealing wallet clustering — document retention and make unlink immediate. If the contract-level VolumeDelegate is ever built it must ride a market refit with keeper/indexer parity (volume events then carry master attribution).

### L2-3 · Multi-asset collateral (blocked on a collateral-liquidation rail decision)

**Status:** todo · **Effort:** L · **Lane:** contracts · **Ships in:** post-launch · **Needs:** — · **Blocks:** —
**Cross-refs:** LIGHTER-GAP §Margin (Multi-asset collateral row) · LIGHTER-GAP §Amendments (Spot-scope row) · **Gap rows:** Margin & collateral — Multi-asset collateral with haircut ladder and supply caps · Amendments & corrections — Spot trading: absent and never scoped — declare it out, and record the collateral-liquidation-rail dependency

**Promotion trigger:** Post-mainnet stability + recorded rail decision + multi-source XLM feed (L0-8 live) + demonstrated user demand (recurring integrator/support requests for XLM collateral). Any one missing = stays deferred.

**Current state (verified):** PROD and STAGING: USDC-only by construction. The market stores exactly one collateral token — `DataKey::UsdcToken` at contracts/market/src/storage.rs:21-22 — and the vault is initialized with a single `usdc_token: Address` (contracts/vault/src/lib.rs:83, set at :102). No haircut, collateral-valuation, or collateral-liquidation machinery exists in any contract, the gateway, or web. The structural blocker the amendment round surfaced: Lighter liquidates seized collateral through its own spot book at an LF price floor; Noether has no spot venue and Soroban contracts cannot execute classic SDEX path payments, so there is no seizure rail at all today. Mainnet v1 collateral is Circle USDC (L0-17) — same 7-decimal PRECISION assumptions.

**Design:** DEFERRED past mainnet v1, deliberately and publicly. Two deliverables now, feature later. (1) Decision record `docs/plans/DECISION-collateral-rail.md`: choose the seizure rail BEFORE any non-USDC asset is accepted. Option A — oracle-priced seizure into the vault: on liquidation the vault credits the trader `LF_j × IndexPrice_j` per unit (7-decimal), takes the XLM onto its own balance sheet, and a keeper/admin disposal job sells it (SDEX classic op from an ops account, or Soroswap cross-contract); pro: atomic on-chain, no external fill risk at liquidation time; con: the vault carries XLM inventory risk until disposal. Option B — AMM routing at liquidation (Soroswap cross-contract swap enforcing minOut = LF floor): pro: no inventory; con: adds a live AMM-liquidity dependency to the liquidation hot path and fails exactly in stress. Recommendation to record: Option A (matches the pool model; disposal is an ops loop like funding). (2) Docs scope note: spot trading is out of scope for v1 — Stellar-native venues (SDEX/AMMs) exist; NOE itself is SDEX-tradeable. If pursued later: XLM first, valued via the Noeracle feed under strict staleness; Lighter's three-parameter ladder `LTV <= LT <= LF` ≈ 0.60/0.70/0.80 (opening power / liquidation trigger / seizure floor, unitless fractions); dual TAV/TALT account valuation; global XLM cap <= 10% of vault AUM (FX risk lands on USDC-denominated LPs) plus a per-user cap; per-asset supply-cap admin setters mirroring set_asset_cap. P2 sketch only — full storage/entrypoint design happens after the rail decision.

**Implementation**

**docs**
- [ ] Write DECISION-collateral-rail.md (Option A vs B analysis incl. the Soroban no-classic-path-payment constraint) and get founder sign-off
- [ ] Add 'USDC-only by design / spot out of scope' note to docs trading-mechanics + litepaper (L2-14)

**contracts/market**
- [ ] (Only if promoted) collateral ledger keyed by token, `TAV = PortfolioBalance + Σ LTV_j × Balance_j × Index_j` and TALT with LT_j, seizure at the LF floor per the recorded rail; supply caps; full test suite — L-class work, own spec at promotion time

**Acceptance:**
- DECISION-collateral-rail.md merged with a named chosen option and a founder sign-off line
- docs.noether.exchange states the USDC-only scope and the XLM-collateral precondition list (rail decision + caps + feed)
- No code path accepts a non-USDC token address as collateral (grep-verifiable: the single UsdcToken key remains)

**Risks:** The trap is partial adoption: accepting XLM deposits before the seizure rail exists converts every XLM-margined bankruptcy into unhedgeable vault FX loss. If Option A is chosen, disposal-lag risk must be bounded (inventory cap + alert). Any future implementation touches liquidation math, vault NAV, and keeper parity simultaneously — the highest-coupling change in the system; schedule against a dedicated audit pass, never a routine refit.

### L2-4 · Order housekeeping: GTT expiry, cancel_all, clientRef, deadman

**Status:** todo · **Effort:** M · **Lane:** mixed · **Ships in:** batch-1-redeploy · **Needs:** L2-1, L1-8 · **Blocks:** L0-18
**Cross-refs:** TASKS G-5 (deadman prerequisite) · LIGHTER-GAP §Orders (Order lifecycle row) · LIGHTER-GAP §Orders (Bulk order management row) · LIGHTER-GAP §Platform (Order housekeeping row) · **Gap rows:** Order types & execution — Order lifecycle completeness: expiry (GTT), modification, and defined behavior when execution hits the OI cap · Order types & execution — Bulk order management: cancel-all, batch placement, client order IDs, dead-man's switch · Platform, API & trust — Order housekeeping: expiry (GTT), batch cancel, deadman translation

**Promotion trigger:** Expiry + cancel_orders + clientRef: active now, rides batch-1. Deadman: activates after L2-1 ships and the keeper's agent address is published; gate the UI behind the grant existing.

**Current state (verified):** PROD and STAGING: `OrderStatus::Expired = 4` is defined at contracts/noether_common/src/types.rs:323 and never set anywhere (single grep hit) — no expiry exists, so GTC trigger orders rest forever while LimitEntry/StopLimit lock 100% of their USDC collateral at placement (`token_client.transfer(&trader, &market, &collateral)` at contracts/market/src/lib.rs:1241). cancel_order is one-order-per-tx, owner-signed (lib.rs:1563-1619); no batch cancel exists in contract, tx-builders, api, or SDKs (grep cancel_all: zero hits). No clientRef concept anywhere in prepare/submit. The keeper's pending-order loop (scripts/keeper/src/index.ts:1017-1029, 5,000ms poll per config.ts:173) is where an expiry sweep would slot. Deadman is impossible today because cancels require the trader's wallet signature — blocked on L2-1.

**Design:** Contract (batch-1, fresh deploy so struct changes are free): Order gains `expires_at: u64` (unix seconds; 0 = GTC). place_limit_order arity 10→11 and place_stop_limit_order 11→12 (expires_at appended after time_in_force) — a deliberate arity change coordinated through tx-builders/SDKs/web under the L0-21 simulation-CI net. Validation: `expires_at == 0 || expires_at >= now + 60s`, else #5 InvalidParameter. execute_order: if `expires_at > 0 && now > expires_at` → refund collateral, status = Expired, emit `order_cancelled(order_id, "expired")` (+ trader field per L1-8), return Ok(0) using the same commit-not-revert pattern as the slippage cancel (lib.rs:1683-1695). New permissionless `cancel_expired(order_id)`: same refund path, error `OrderNotExpired = 85` when called early. New `cancel_orders(trader, order_ids: Vec<u64>)`: trader.require_auth; hard cap 25 ids per call (instruction budget); NotOrderOwner on any foreign id; silently skips non-Pending (idempotent flatten); emits order_cancelled per id with reason "user". Keeper: expiry sweep inside the existing pending-order loop — submit cancel_expired for any order past expires_at before evaluating triggers; counter metric + alert on sweep failures. Gateway clientRef (no contract change): /v1/orders/prepare accepts optional `clientRef` (string, <=64 chars); store `order_refs(owner, client_ref, tx_hash, order_id NULL, created_at, UNIQUE(owner, client_ref))` keyed by the prepared tx hash (Stellar tx hashes cover the signature payload, not signatures — stable across signing); an indexer join events_raw.tx_hash → order_placed backfills order_id; GET /v1/orders/by-ref/:ref (authed). Deadman (post-launch, after L2-1): the trader grants the published keeper-agent address a CANCEL-only AgentGrant; gateway POST /v1/deadman `{timeoutS}` + heartbeats (REST or WS presence); on T missed heartbeats the keeper submits agent_cancel_orders for all the trader's pending ids. Worst case of a rogue/early keeper cancel is refunded collateral (risk-reducing) — documented, not trusted. Also define #82-at-execution behavior per the gap row: a triggered entry hitting OpenInterestCapExceeded stays Pending and retries each tick; after 20 consecutive #82 failures the keeper cancels it via a cancel_expired-style flow and the gateway pushes a notification (L1-10).

**Implementation**

**contracts/market**
- [ ] Add expires_at to Order + placement validation + arity bumps on the two placement entrypoints
- [ ] Expiry branch in execute_order + permissionless cancel_expired + error #85 OrderNotExpired
- [ ] cancel_orders(`Vec<u64>`) with the 25-id cap reusing cancel internals
- [ ] Tests: expired-order refund via both paths; early cancel_expired rejected; batch cancel refunds all + skips executed; foreign id rejected; expiry event carries reason=expired

**packages/tx-builders**
- [ ] Update placeLimitOrder/stopLimit builders to the new arity (expiresAt param), add buildCancelOrdersTx; regenerate simulation-based snapshots (L0-21)

**api**
- [ ] prepare schemas: expiresAt on limit/stop-limit ops, cancelOrders op, clientRef param + order_refs table + GET /v1/orders/by-ref/:ref
- [ ] Document the #82-at-execution retry/cancel policy in OpenAPI descriptions

**sdk-ts**
- [ ] expiresAt + cancelOrders + byRef in the orders sub-client (mirror sdk-py)

**keeper**
- [ ] Expiry sweep in the pending loop before trigger evaluation; #82-retry counter with cancel-after-20 + alert
- [ ] (post-L2-1) deadman service: heartbeat registry poll → agent_cancel_orders

**web**
- [ ] Expiry (GTT) picker on limit/stop-limit forms + expiry column and countdown in the open-orders tab
- [ ] 'Cancel all' button (one signature via cancel_orders)
- [ ] (post-L2-1) deadman arm/disarm UI on the api-keys/session page

**docs**
- [ ] Order-lifecycle page: GTT semantics, #82-at-execution behavior, abandoned-order risk note until deadman ships

**Acceptance:**
- cargo test -p market: test_order_expires_refunds_collateral, test_cancel_expired_permissionless_and_rejects_early (#85), test_cancel_orders_batch_refunds_and_skips, test_expiry_event_reason pass
- On staging: an order with expires_at=now+120s is auto-cancelled by the keeper sweep within 2 poll cycles of expiry and the trader's USDC balance is restored on-chain
- One wallet signature flattens 10 resting orders (cancel_orders) — verified tx on staging
- POST /v1/orders/prepare with clientRef then submit → GET /v1/orders/by-ref/:ref returns the resolved order_id after indexing
- tx-builders simulation CI green against the new arities (no repeat of the P4-23 stale-snapshot pattern)

**Risks:** Arity drift is THE named regression class here (the tx-builders 8-vs-9-arg break shipped silently for weeks) — expires_at must land in builders+gateway+SDKs+web in the same change set with the L0-21 simulation CI as the net. Event-format: order_cancelled gains reasons and (via L1-8) a trader field — the CLAUDE.md event table, indexer decoder, and frontend parsers move together. WASM: two entrypoints + a struct field on the crowded batch-1 refit — measure. cancel_orders instruction budget: the 25-id cap is chosen against Soroban per-tx limits; verify by simulation with 25 locked orders. Deadman trust: the keeper cancel-scope grant means a compromised keeper can flatten orders (refund-only harm) — publish this bound.

### L2-5 · TWAP / scale execution

**Status:** todo · **Effort:** M · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** L2-1 · **Blocks:** —
**Cross-refs:** TASKS G-9 · TASKS G-5 · AUDIT research 2.1 #2 · LIGHTER-GAP §Orders (TWAP/scale row) · **Gap rows:** Order types & execution — TWAP / scale execution algos

**Promotion trigger:** Phase 1/2: first power-user or MM request for laddered entries (cheap, any sprint). Phase 3 (G-9 engine): after L2-1 is live AND >=1 integrator asks for unattended execution.

**Current state (verified):** PROD and STAGING: no TWAP, scale/ladder, chase, or child-order machinery at any layer — TASKS G-9 (TASKS.md:225) is untouched backlog. The primitives for a client-side version all exist: the web placeLimitOrder wrapper at web/lib/stellar/market.ts:837, router-relayed market opens (open_with_price), and prefunded limit entries (contracts/market/src/lib.rs:1175-1321). The real blocker for server-side slicing is custody: the gateway is strictly non-custodial (/v1/orders/prepare returns unsigned txs bound to the key owner), so it cannot sign child orders — that requires L2-1 agent grants. In a pool model TWAP is about averaging oracle prints and chunking under OI caps (error #82), not book impact — fills are zero-impact at oracle price.

**Design:** Three phases, honest about signatures at each. Phase 1 — client-side scale (ladder) builder in OrderPanel: new 'Scale' mode with params priceLow, priceHigh (7-decimal), rungs N (2-10), total collateral (USDC), distribution equal | front-weighted | back-weighted; a preview table shows per-rung price, collateral, notional, and the ALL-IN fee incl. the keeper fee line (L1-21 disclosure: maker fee + 0.50 USDC + 0.05% per rung); builds N place_limit_order txs and signs sequentially with a '3/5 signed' progress UI — honest copy: 'N wallet signatures; each rung prefunds its collateral'. Abort keeps placed rungs and offers the L2-4 cancel-all. Phase 2 — client-driven TWAP: total size, duration 5-60 min, slice interval >=30s, <=20 slices; fires market opens via router open_with_price on each tick; hard caveat banner 'runs only while this tab is open'; plan state in tradeStore (lost on refresh — the banner says so); with L2-1 session mode active the slices sign locally with zero popups, which is the actually-good UX. Phase 3 (G-9, after L2-1) — gateway child-order engine: POST /v1/algos `{type: twap|scale, params}`, algos table (id, owner, params, state, created_at), a worker loop signing slices with the gateway's agent address under a user-granted OPEN|CLOSE-scoped, notional-capped, revocable AgentGrant; WS channel `algo.status.<owner>`; kill switch = revoke_agent. P2 sketch: Phase 3 gets its own detailed spec at promotion.

**Implementation**

**web**
- [ ] OrderPanel 'Scale' mode: rung computation, per-rung fee preview (reusing the L1-21 all-in fee line), sequential sign/submit with progress + abort
- [ ] Client TWAP mode with tab-open caveat + session-mode (L2-1) zero-popup path
- [ ] Open-orders tab groups rungs placed in one plan (client-side grouping via L2-4 clientRef: `scale:<uuid>:<i>`)

**api**
- [ ] (Phase 3, after L2-1) /v1/algos CRUD + algos table + slice worker signing via the gateway agent key + algo.status WS channel — coarse; own spec at promotion

**Acceptance:**
- Web e2e (staging): a 5-rung scale plan places 5 prefunded limit orders whose trigger prices match the preview table exactly; abort after rung 3 leaves 3 resting orders and cancel-all clears them in one signature
- Fee preview per rung equals the on-chain charge within 1 deci-bps unit (verified against a real fill)
- Client TWAP fires N slices at the configured interval while the tab is open and stops cleanly on tab close (no orphaned timers); with 1-click mode enabled, zero wallet prompts
- clientRef grouping renders rungs as one collapsible plan in the orders tab

**Risks:** Capital honesty: a 5-rung ladder locks 5× rung collateral (prefund model) — the preview must show total locked USDC or users will file 'missing funds' tickets; capital-efficient rungs are L2-7, not this. Client TWAP mid-plan tab death leaves a partial position — banner + resume-hint required. Phase 3 makes the gateway's agent key a high-value target: scope-limited, notional-capped grants only, and the algos worker must be rate-limited per owner. #82 OI-cap hits mid-plan need the L2-4 retry/cancel policy surfaced in algo status.

### L2-6 · TIF semantics honesty (IOC / PostOnly)

**Status:** todo · **Effort:** S · **Lane:** contracts · **Ships in:** batch-1-redeploy · **Needs:** L0-21, L1-8 · **Blocks:** L0-18
**Cross-refs:** LIGHTER-GAP §Orders (TIF semantics row) · LIGHTER-GAP §Fees (Trigger-order keeper fee row — the limit-path-earns-maker documentation half) · **Gap rows:** Order types & execution — TIF semantics coherence: IOC is not immediate, PostOnly is economically vestigial

**Promotion trigger:** Decision confirmed at the batch-1 surface freeze: same-tx IOC in the refit, or IOC dropped from UI/API. Not deferrable past the freeze — the audit must see the final TIF surface.

**Current state (verified):** PROD and STAGING: IOC is inverted — place_limit_order with tif_mode==1 and trigger NOT met cancels+refunds immediately (contracts/market/src/lib.rs:1250-1281), but trigger MET falls through to status Pending 'keeper executes immediately' (lib.rs:1282-1283), i.e. an 'immediate' order fills 5-11s later (5s keeper poll + ~5s ledger) at a different oracle print. PostOnly (tif_mode==2) rejects with #70 PostOnlyViolation when the trigger is already met (lib.rs:1226-1236) but buys nothing economically: every keeper-executed entry already pays the maker fee (`calculate_fee_and_record_volume(..., true, ...)` at lib.rs:2469) PLUS the KeeperFeeConfig 0.50 USDC + 0.05% cut deducted from order collateral (lib.rs:2471-2477; defaults at noether_common/types.rs:378-384). Placement already performs a strict oracle read for both modes (lib.rs:1228, :1245), so the price needed for an inline fill is already on hand.

**Design:** Decision (to confirm at the batch-1 config freeze): implement TRUE same-tx IOC rather than dropping IOC. In place_limit_order, when tif_mode==1 && triggered: execute the fill inline in the placement tx — reuse the execute_limit_entry body with keeper_fee=0 (no keeper involved), charge the TAKER fee (is_maker=false) since an immediate fill is taker semantics; order status = Executed; events emitted in one tx: order_placed, `order_executed(order_id, 0[, enriched fields per L1-8])`, position_opened. Result: IOC becomes the cheapest immediate-limit path (taker fee only, no 0.50 USDC keeper cut) and means what CEX users expect. Reject tif_mode==1 on place_stop_limit_order with #5 InvalidParameter (IOC on a two-phase stop is incoherent) — document. Fallback if the WASM refit can't absorb the inline path: drop IOC from UI + prepare schema (the gateway rejects timeInForce=IOC with a clear error) while the contract keeps accepting it for compat — never ship the current inverted semantics into mainnet docs silently. PostOnly: keep contract semantics (#70) untouched; rename in UI to 'Reject if triggerable' with a tooltip ('cancels at placement if the trigger is already met — all resting entries here earn the maker rate anyway'); docs state plainly that the limit path always pays maker + keeper fee today and cross-link the L1-21 fee restructure. No storage or arity changes — an S-effort contract branch + copy.

**Implementation**

**contracts/market**
- [ ] Inline IOC fill branch in place_limit_order (reuse execute_limit_entry internals, keeper_fee=0, taker fee)
- [ ] Reject IOC on place_stop_limit_order
- [ ] Tests: ioc_trigger_met_fills_same_tx (position exists in the placement tx, no keeper), ioc_charges_taker_not_keeper_fee, ioc_not_met_still_cancels, stop_limit_rejects_ioc

**indexer**
- [ ] Handle order_executed appearing in the same tx as order_placed (decoders process events individually — add a regression test seeding all three events in one tx)

**web**
- [ ] OrderPanel: PostOnly → 'Reject if triggerable' label + tooltip; IOC copy 'fills in this transaction or cancels'

**api**
- [ ] prepare schema descriptions updated (IOC same-tx semantics; stop-limit IOC rejected)

**docs**
- [ ] TIF page: exact semantics table + 'limit path earns maker but pays keeper fee' disclosure (link L1-21)

**Acceptance:**
- cargo test -p market: the four named IOC/stop-limit tests pass; the fee assertion shows taker deci-bps and zero keeper fee on the inline fill
- On staging: an IOC order with the trigger already met produces order_placed + order_executed + position_opened in ONE transaction hash (stellar.expert-verifiable)
- Indexer test proves the trades projection books the IOC fill exactly once
- UI no longer shows the bare 'Post Only' label; docs TIF table live

**Risks:** WASM: the inline path mostly reuses existing internals but the branch + event adds bytes to the crowded batch-1 refit — if it doesn't fit, execute the documented fallback (drop IOC at gateway/UI) rather than shipping inverted semantics. Event drift: three events in one placement tx is a new shape — LiveTailer and the trades projection must be regression-tested (double-count risk). The fee-semantics change (maker→taker on IOC) must hit the docs fee sheet (L1-20) in the same release or the preview drifts from charges.

### L2-7 · Capital-efficient resting orders (cross-funded, margin at execution)

**Status:** todo · **Effort:** L · **Lane:** contracts · **Ships in:** post-launch · **Needs:** L1-1 · **Blocks:** —
**Cross-refs:** LIGHTER-GAP §Margin (Capital efficiency row) · LIGHTER-GAP §Orders (Capital-efficient resting orders row) · **Gap rows:** Margin & collateral — Capital efficiency of resting orders: full prefund vs order margin · Order types & execution — Capital-efficient resting orders (margin checked at execution instead of 100% prefund)

**Promotion trigger:** Post-launch, after L1-1 cross settlement is live AND order-flow data shows ladders are capital-constrained (e.g. a meaningful cohort holds >=3 concurrent prefunded entries, or MM feedback names locked capital as the blocker).

**Current state (verified):** PROD and STAGING: LimitEntry/StopLimit orders transfer 100% of their USDC collateral into the market contract at placement (contracts/market/src/lib.rs:1238-1241); SL/TP/trailing lock nothing. Keeper-executed entries ALWAYS open isolated — `margin_mode: 0 // Isolated` hardcoded in the execute-path Position construction (lib.rs:2496) — so the cross pool cannot back a resting order at all. The upside is real and documented in the gap doc's parity list: a prefunded triggered order can never fail an account margin check at execution (Lighter needs match-time auto-cancel to get the same guarantee). A 5-rung ladder therefore locks ~5× the capital Lighter requires — an efficiency loss, not a safety hole.

**Design:** Keep 100% prefund as the documented default guarantee for mainnet v1 ('your triggered order cannot fail margin at execution' — publish this as a feature on the docs order page + OrderPanel tooltip; that documentation step is offchain-now and free). Post-launch contract change: cross-pool-funded trigger orders. The Order struct gains `funding_mode: u32` (0=prefund default, 1=cross) — rides whatever post-batch-1 refit window opens, never alone. place_limit_order_cross variant (or a funding_mode param on the existing entrypoint — decide by WASM budget): placement reserves NOTHING and transfers nothing; validation requires the trader to have a cross account (CrossMarginBalance exists). At execution, execute_limit_entry with funding_mode==1 runs the exact open_position_cross gate (equity including uPnL and pending funding >= aggregate MM + new collateral — the lib.rs:333+ free-margin check), draws `collateral` from CrossMarginBalance(trader), and opens the position with margin_mode=1; on shortfall it auto-cancels with a distinct reason `order_cancelled(order_id, "cross_shortfall")` + notification via L1-10 — the same failure family Lighter handles with match-time auto-cancel, so no new user-facing surprise class. The keeper fee for cross-funded executions is drawn from the pool with the same 0.50 USDC + 0.05% schedule (or its L1-21 successor). Sequenced explicitly after L1-1 because it reuses the cross-aware execute-settlement plumbing (proceeds and refunds must land in the pool, not the wallet). P2 sketch — full margin-math test matrix at promotion.

**Implementation**

**docs**
- [ ] NOW (free): document prefund as the execution-certainty guarantee on the order-types page + OrderPanel tooltip

**contracts/market**
- [ ] (At promotion) funding_mode on Order + cross-funded placement path (no transfer) + execution-time open_position_cross gate + cross_shortfall auto-cancel + tests: shortfall cancels not reverts; success draws pool exactly collateral; prefund path byte-identical behavior

**packages/tx-builders**
- [ ] (At promotion) fundingMode param through builders/prepare/SDKs under the L0-21 net

**web**
- [ ] (At promotion) funding-source selector (Wallet-prefund | Cross pool) on limit/stop-limit forms with locked-capital preview

**Acceptance:**
- Docs page live NOW stating the prefund guarantee (pre-promotion deliverable)
- At promotion: cargo tests cross_funded_order_reserves_nothing_at_placement, cross_funded_execution_runs_open_gate_and_draws_pool, cross_shortfall_cancels_with_reason pass
- On staging: 5 cross-funded rungs rest with zero USDC locked; killing pool equity below the gate cancels the next triggered rung with reason cross_shortfall and pushes an account WS notification
- Prefunded path regression suite unchanged (execution-certainty guarantee preserved for mode 0)

**Risks:** This deliberately trades away the execution-certainty guarantee for mode-1 orders — the UI must distinguish the modes or users will blame the venue when a cross-funded stop-entry cancels in a crash. Order struct + arity changes = another coordinated tx-builders/SDK/web move (L0-21 net). WASM: a second funding path through execute_limit_entry is non-trivial; a candidate for the refit AFTER batch-1, never squeezed into it. Keeper parity: the keeper's simulate-first pipeline already tolerates cancels, but its pending-order accounting must not retry cross_shortfall cancels forever.

### L2-8 · Per-asset-class buffer sharding (LLP Strategies analog)

**Status:** todo · **Effort:** M · **Lane:** contracts · **Ships in:** post-launch · **Needs:** L0-1, L0-2 · **Blocks:** —
**Cross-refs:** TASKS P5-6 · AUDIT research 2.2 #9 · LIGHTER-GAP §Risk (per-asset-class sharding row) · LIGHTER-GAP §LP (Exposure segmentation row) · **Gap rows:** Risk engine — No per-asset-class risk sharding — one vault and one buffer back all markets (LLP Strategies analog) · LP & vault products — Exposure segmentation: per-asset-class loss budgets / segregated experimental pool (loss-budget half)

**Promotion trigger:** First listing beyond the current majors/alts profile, or any listing the risk review labels 'experimental' — the shard must exist before that pair goes live.

**Current state (verified):** STAGING (P5-6, prod redeploy pending): a single insurance buffer exists — one `DataKey::BufferBalance` slot (contracts/vault/src/storage.rs:48, accessors :183-188) fed by 10% of all liquidation proceeds (insurance_buffer_share_bps=1000, noether_common/types.rs:217) plus admin seed, paying winners before LP capital (vault lib.rs:335+). One vault + this one buffer back all 14 pairs; per-asset exposure is bounded only by the 25%-per-side OI caps + full-notional reservation (vault lib.rs:479-496, error #82), but any asset's bad debt socializes across all LP capital identically. No per-class accounting exists anywhere in contracts/vault (grep BufferBalance: one key). PROD predates the buffer entirely.

**Design:** Shard the BUFFER, not the vault — the 'blast radius' guarantee without splitting LP liquidity. Class registry in the market (it owns asset semantics): `DataKey::AssetClass(Symbol) -> u32` instance storage + admin `set_asset_class(asset, class)` (0=majors, 1=alts, 2=experimental; default 1 for unregistered). Vault: `DataKey::BufferBalanceClass(u32)` persistent sub-accounts; `fund_buffer(amount, class)` (the market passes the asset's class alongside proceeds — a signature change on the existing market-only entrypoint) and the L0-2 `draw_buffer(amount, class)` draws ONLY that class's balance — a class's bad debt can exhaust its own shard and nothing else. Class-scoped ADL: L0-1's `check_adl_trigger(asset)` computes payable coverage using BufferBalanceClass(class(asset)) + the vault's unsharded total_usdc, so a drained experimental shard flips AdlActive only for that class's assets while majors trade on. The winner-payout waterfall (settle_pnl) keeps drawing the asset's class shard first, then LP — preserves the P5-6 semantics per class. Migration at the sharding redeploy: seed class-0 with the entire legacy BufferBalance, then rebalance by admin transfer op `move_buffer(class_from, class_to, amount)`. Events: `buffer_funded` and the L0-2 `bad_debt_recorded` gain a `class: u32` field (event-format table + indexer decoders move together). Surface: /v1/markets/stats and the /vault page show per-class buffer balances + coverage; docs explain 'a majors LP is never the backstop for an experimental listing's bad debt — beyond the shared AUM reservation floor'. Deferred until listing expansion; genuinely experimental listings that need ZERO main-pool exposure are L2-9's separate stack, not a shard. P2 sketch — the exact coverage formula finalizes with L0-1's spec.

**Implementation**

**contracts/vault**
- [ ] BufferBalanceClass storage + class param on fund_buffer/draw_buffer/settle_pnl draw path + move_buffer admin op + migration seed of class 0
- [ ] Tests: class isolation (draining class 2 leaves class 0 intact), waterfall-per-class, event class fields

**contracts/market**
- [ ] AssetClass registry + set_asset_class + class plumbed into liquidation-proceeds routing and the L0-1/L0-2 call sites

**indexer**
- [ ] Decode the class field on buffer/bad-debt events; per-class buffer columns in the vault stats projection

**api**
- [ ] Per-class buffer + coverage in /v1/markets/stats

**web**
- [ ] Vault page: per-class Insurance Fund breakdown card

**Acceptance:**
- cargo test -p vault: test_class_shard_isolation (class-2 exhaustion leaves class-0 balance byte-identical), test_waterfall_draws_own_class_first, migration test seeding the legacy balance into class 0
- cargo test -p market: liquidation proceeds route to the liquidated asset's class shard (event asserts the class field)
- GET /v1/markets/stats returns bufferByClass with three balances summing to the on-chain total
- Class-scoped ADL trigger test (with L0-1): draining the alts shard flips AdlActive for an alt but not for BTC

**Risks:** Ordering: this REDEFINES the fund_buffer/draw_buffer signatures L0-1/L0-2 introduce — if those ship in batch-1 unsharded (they do), this is a vault+market coupled re-redeploy post-launch; design L0-2's entrypoints with the class param optional-from-day-one if cheap, else accept the second coupled deploy. Event drift on buffer events (indexer + CLAUDE.md table). Mis-classification is a policy risk: an 'alt' that should be 'experimental' silently shares the alts shard — tie set_asset_class into the L1-24 listing runbook as a mandatory step. WASM/vault budget is roomier than market's but measure anyway.

### L2-9 · Segregated experimental pool (XLP analog)

**Status:** todo · **Effort:** L · **Lane:** mixed · **Ships in:** post-launch · **Needs:** L0-12, L0-8 · **Blocks:** —
**Cross-refs:** AUDIT V-1 · TASKS V1.1-1 · LIGHTER-GAP §Listings (Prelaunch markets row) · LIGHTER-GAP §LP (Exposure segmentation row) · **Gap rows:** Market specs & listings — Prelaunch markets (unlaunched-token perps) · LP & vault products — Exposure segmentation: segregated experimental pool (XLP half)

**Promotion trigger:** First listing the team is unwilling to expose main-pool LPs to (prelaunch-style or exotic), AND L0-12 + L0-8 live. The batch-1 isolated_only config sliver promotes NOW into the freeze decision list.

**Current state (verified):** PROD and STAGING: the single LP vault is counterparty to every pair; there is no pool-segregation primitive. The blue-green tooling already produces a complete parallel stack — scripts/deploy_staging.sh deploys a fresh NOE SAC + vault + market + router while reusing shim/Noeracle/USDC (script header :8-9; deploy steps :118-180) — so 'second stack' is an ops pattern, not new infra. vault_factory cannot host this role until V-1 commingling is fixed (contracts/vault_factory/src/lib.rs:584-589 sync_total_usdc whole-balance rewrite; TASKS V1.1-1), and the founder brief chooses the separate-stack route regardless. MarketConfig has no isolated-only switch (noether_common/types.rs:200-219), so cross-margin cannot currently be disabled per deployment.

**Design:** A second, fully separate market+vault(+router) stack for experimental listings with ZERO main-LP exposure: own LP token (SAC code `NOEX`, same issuer policy), own vault, own market reading the same shim (or a dedicated shim instance if the feed set diverges), own router init with the same publisher set. Isolated-only margin enforced on-chain via a new `MarketConfig.isolated_only: bool` — when true, open_position_cross and deposit_cross_margin reject with #5 InvalidParameter; this one bool + two checks should be BANKED IN BATCH-1 (trivial WASM, default false) so the experimental stack later deploys from the audited WASM with a config flip instead of a fork — flag this config addition at the batch-1 freeze. Risk posture per deployment config: 3-5x max leverage via L0-12 per-asset config, small absolute OI caps (L0-14), its own insurance buffer, deposit caps. Pricing: only assets with a real external reference relayed through Noeracle (no internal price discovery — pre-IPO stays impossible by design). Off-chain: contracts.json gains an `experimental` address block; the indexer already scopes projections by contract_id (trades table contract_id column, 001_baseline.sql:84) — run a second indexer instance or extend the registered-contract set; the gateway serves /v1/markets with a `pool: main|experimental` field; web multiplexes by an asset → stack map (NEXT_PUBLIC_MARKET_ID_EXPERIMENTAL etc.) and the vault page gains a clearly-labeled second product ('Experimental pool — separate capital, separate risk'). P2 sketch — the full listing flow rides L1-24's runbook with an experimental-stack branch.

**Implementation**

**contracts/market**
- [ ] (Batch-1 sliver, decide at freeze) add isolated_only: bool to MarketConfig + rejects in open_position_cross/deposit_cross_margin + test

**ops**
- [ ] (At promotion) derive scripts/deploy_experimental.sh from deploy_staging.sh: NOEX SAC, fresh vault/market/router, isolated_only=true, per-asset config + caps + buffer seed; contracts.json experimental block

**indexer**
- [ ] Register the experimental contract ids (second instance or extended registry); verify contract_id scoping end-to-end

**api**
- [ ] pool field on markets/stats/trades responses; health echoes both stacks

**web**
- [ ] Asset→stack multiplexing in constants + trade page; separate vault card with blunt risk copy

**docs**
- [ ] Experimental-pool page: capital separation guarantee, listing criteria, graduation path to the main pool

**Acceptance:**
- On-chain: opening cross on the experimental market fails with the isolated_only reject; main-stack behavior unchanged (regression suite)
- Solvency separation demonstrable: experimental vault get_aum moves on an experimental liquidation while main vault get_aum is untouched (scripted check)
- Indexer projections for the two stacks never cross-contaminate (query by contract_id returns disjoint sets)
- Web trades the experimental pair against the second stack with the correct NOEX vault card and risk banner
- deploy_experimental.sh is idempotent/resumable like deploy_staging.sh and updates contracts.json automatically

**Risks:** Coupled-redeploy ordering: the isolated_only flag is a batch-1 decision even though the stack itself is post-launch — miss the freeze and the experimental stack needs an unaudited market fork (bad). The ops surface doubles: the keeper must publish/liquidate on both stacks (config list), monitoring (L1-25) must watch both, and env propagation now spans two address sets — the D-1/D-3 env-drift pitfall class doubles with it. LP confusion risk: NOEX must be visually and textually impossible to mistake for NOE. Liquidity fragmentation is the accepted cost — cap experimental AUM intake so it never cannibalizes main-pool deposits.

### L2-10 · Configurable vault economics (V-7) + per-depositor performance fees (V-5)

**Status:** todo · **Effort:** M · **Lane:** mixed · **Ships in:** post-launch · **Needs:** L0-20 · **Blocks:** —
> **Demotion note:** the per-depositor performance-fee half (V-5) is rated [P1/M] in the gap doc — housed here because it rides the vault_factory v1.1 redeploy with L0-20, never alone. If L0-20 Path A ships the factory at mainnet launch, RE-PROMOTE this into that same WASM: launch depositors on the global HWM hit the mischarge the gap row calls "support-ticket-grade unfairness the moment vaults have real deposit flow".
**Cross-refs:** AUDIT V-7 · AUDIT V-5 · TASKS V1.1-5 · TASKS V1.1-3 · LIGHTER-GAP §LP (Configurable operator economics row) · LIGHTER-GAP §LP (Per-depositor performance-fee row) · **Gap rows:** LP & vault products — Configurable operator economics (profit share, min holding) on user vaults · LP & vault products — Per-depositor performance-fee accounting (replace single global HWM)

**Promotion trigger:** vault_factory v1.1 window: when L0-20 (V-1+V-4, or the launch-gate alternative) is scheduled for its redeploy — these params + per-depositor fees ship in that same WASM.

**Current state (verified):** PROD and STAGING (vault_factory unchanged since T2): create_vault takes only (leader, name) — contracts/vault_factory/src/lib.rs:82-86 — and hardcodes `profit_share_bps: DEFAULT_PROFIT_SHARE_BPS` (=1_000 = 10%, types.rs:10) at lib.rs:103; `MAX_PROFIT_SHARE_BPS = 5_000` (types.rs:17) is dead code with no setter or clamp (AUDIT V-7). Leader min holding is the fixed constant LEADER_MIN_HOLDING_BPS = 500 (5%, types.rs:14) enforced by leader_min_holding_ok (math.rs:71-86). Performance fees use ONE global hwm_nav per vault (math.rs:89-115 leader_profit_owed) — late joiners pay 10% on gains earned before they joined; entrants below the HWM ride recovery fee-free (AUDIT V-5). The read side is already shaped for this: the vaults projection carries profit_share_bps (indexer/migrations/001_baseline.sql:168) and the api serves profitShareBps (api/src/services/vaults.ts:108).

**Design:** Rides the vault_factory v1.1 redeploy WITH the L0-20 fixes (V-1 isolation + V-4 NAV) — never alone. (1) Params: `create_vault(leader, name, profit_share_bps: u32, min_holding_bps: u32)` — clamp profit_share_bps ∈ [0, MAX_PROFIT_SHARE_BPS=5_000] and min_holding_bps ∈ [LEADER_MIN_HOLDING_BPS=500, 5_000], else FactoryError::InvalidParameter; VaultInfo gains `min_holding_bps: u32`; every leader_min_holding_ok call site passes info.min_holding_bps instead of the constant (the 5% protocol floor stays the hard minimum). The vault_created event gains (profit_share_bps, min_holding_bps). No post-creation setter in v1.1 (fee terms immutable per vault — depositors can trust the listing; a raise-with-timelock setter is a later decision). (2) Per-depositor entry-NAV fees replacing the global HWM: storage `DepositorBasis(vault_id: u32, Address) -> entry_nav: i128` (PRECISION-scaled NAV/share); on deposit, weighted-average: `new_entry = (old_entry × old_shares + current_nav × new_shares) / (old_shares + new_shares)`; on withdraw, `fee_usdc = max(0, current_nav − entry_nav) × shares_withdrawn / PRECISION × profit_share_bps / 10_000`, deducted from the payout and credited to `LeaderFeesAccrued(vault_id)`; claim_leader_fees pays the accrued counter (drop the HWM computation and the hwm_nav field at this fresh deploy — Lighter's exact fee-on-withdrawal model). current_nav here is the L0-20/V-4 valuation (liquid USDC + open-position value), which is why this sequences after it. The withdraw event gains a fee field. (3) Surface: an indexer migration adds min_holding_bps to the vaults projection; /v1/vaults sortable/filterable by profitShareBps and minHoldingBps; marketplace UI shows fee terms on cards + a sort control. P2 sketch — edge-case matrix (dust shares, full-exit re-entry) at build time.

**Implementation**

**contracts/vault_factory**
- [ ] create_vault params + clamps + VaultInfo.min_holding_bps + event fields
- [ ] DepositorBasis weighted-average on deposit; withdrawal-time fee accrual to LeaderFeesAccrued; claim pays accrued; delete global-HWM math
- [ ] Tests: clamp rejections; late-joiner pays 0 on pre-join gains; below-entry exit pays 0; weighted-average across two deposits; accrued-claim round-trip; min-holding floor respected with a custom bps

**indexer**
- [ ] vaults projection + decoder: min_holding_bps + withdraw fee field; migration

**api**
- [ ] vaults service exposes minHoldingBps + sort/filter params on GET /v1/vaults

**web**
- [ ] create-vault form (share + min-holding inputs with floor/caps), marketplace fee-term chips + sort, detail page 'your entry NAV / your fee preview' row

**docs**
- [ ] Vault economics page: fee-on-withdrawal model, worked example, immutability of terms

**Acceptance:**
- cargo test -p vault_factory: test_profit_share_clamped_0_to_5000, test_min_holding_floor_500, test_late_joiner_pays_only_own_gain, test_below_entry_withdraw_zero_fee, test_weighted_entry_nav, test_claim_pays_accrued pass (extends the 37-test suite)
- GET /v1/vaults?sort=profitShareBps returns vaults ordered by fee terms incl. the new minHoldingBps field
- Web marketplace filters by max fee; the create flow rejects out-of-clamp values client-side AND surfaces the contract error on bypass
- A scripted staging scenario: depositor A (pre-gain) and B (post-gain) withdraw — A pays profit share on the gain, B pays zero (on-chain balances assert)

**Risks:** Sequencing hazard: withdrawal-time fees computed on a NAV that ignores deployed capital (V-4 unfixed) would systematically mis-charge — hence the hard L0-20 need; do not cherry-pick this item forward. The create_vault arity change ripples through web/scripts/deploy-tranche2-style tooling and the sdk vaults surface — same coordinated-change discipline as market arity (L0-21 pattern). Event drift on vault_created/withdraw (indexer decoder + CLAUDE.md). Migration: v1.1 is a fresh factory deploy; existing testnet vaults don't migrate — comms note.

### L2-11 · NOE pre-mint ceiling monitoring + distinct exhaustion error

**Status:** todo · **Effort:** S · **Lane:** mixed · **Ships in:** batch-1-redeploy · **Needs:** L0-16 (top-up runbook half only — the #86 error rides batch-1 unconditionally) · **Blocks:** L0-18
**Cross-refs:** TASKS P3-8 · LIGHTER-GAP §LP (NOE pre-mint ceiling row) · **Gap rows:** LP & vault products — NOE pre-mint deposit ceiling (capacity footgun on the main vault)

**Promotion trigger:** The error rides batch-1 unconditionally (S-size). Monitoring activates at mainnet launch with real deposits; thresholds re-reviewed at every 2× TVL doubling.

**Current state (verified):** PROD and STAGING: NOE is a pre-minted SAC using the transfer model — no runtime minting (contracts/vault/src/noe.rs:6-31). The vault deposit checks `noe_amount > vault_noe` and fails with `NoetherError::InsufficientLiquidity` (#40) at contracts/vault/src/lib.rs:179-181 — the SAME error code the withdraw path uses for genuine USDC-liquidity floors (lib.rs:261-268), so an exhausted pre-mint is indistinguishable from a solvency guard to users and support. (Note: the gap doc cites noe.rs:21-59 for this check; the actual gate is vault lib.rs:179-181 — code wins.) No monitoring of remaining vault NOE exists anywhere (the keeper watches XLM balance only, TASKS P3-10), and the top-up flow is undocumented.

**Design:** Three cheap pieces. (1) Contract (rides batch-1's coupled vault redeploy): new error `NoeSupplyExhausted = 86` returned from the deposit-side check at vault lib.rs:181 (withdraw paths keep #40); map it in web contractErrors.ts to 'LP deposits are temporarily at capacity — the team has been alerted' and in the gateway error taxonomy. Coordinate the code number in the batch-1 error-registry pass (errors.rs capacity note: ~48 variants claimed, 42 used). (2) Monitoring (offchain-now, no redeploy needed): the keeper's existing 6h TTL/ops phase (P3-9 pattern) additionally reads the vault's NOE balance (token balance query — same client as noe::vault_balance) and alerts: WARN when remaining_noe < 25% of circulating NOE, CRITICAL when < 10% or < the trailing-7-day NOE issuance rate × 14 days; expose `noeHeadroom` in the /v1/health vault block so the L1-25 status page graphs it. (3) Runbook (operator): documented top-up = the issuer account (the 2-of-3 multisig after L0-16/P3-8) submits a classic payment of NOE to the vault contract address — exact CLI in docs/INCIDENT_RUNBOOK.md ('NOE headroom low' section) with an amount sizing rule (pre-mint generous headroom: >= 2× current circulating on each top-up) and a post-payment verification read. Decision recorded: stay on pre-mint+transfer (option a of the gap row) — an issuer-mint flow stays possible later since the issuer key lives behind the multisig either way.

**Implementation**

**contracts/vault**
- [ ] Swap the deposit-side #40 for NoeSupplyExhausted=86 + test test_deposit_noe_exhaustion_distinct_error (withdraw-path #40 untouched by a paired regression test)

**keeper**
- [ ] NOE-headroom check in the 6h ops phase + WARN/CRITICAL thresholds + Discord/Telegram alert (reuse the P2-7 alerter)

**api**
- [ ] /v1/health vault block gains noeHeadroom {vaultNoe, circulatingNoe, ratio}

**web**
- [ ] contractErrors.ts entry for #86 with the capacity-friendly message

**docs**
- [ ] INCIDENT_RUNBOOK 'NOE headroom low' section: multisig top-up CLI, sizing rule, verification step

**ops**
- [ ] At mainnet init: pre-mint sized >= 2× the launch deposit-cap ceiling; record the minted total in the launch checklist

**Acceptance:**
- cargo test -p vault: deposit into a NOE-drained vault returns #86 while an over-withdraw still returns #40
- Keeper staging run with an artificially low threshold fires the CRITICAL alert within one ops cycle and /v1/health shows the same ratio
- web renders the #86 message (unit test on the decodeContractError map)
- Runbook section exists with copy-pasteable CLI verified once against staging (NOE payment lands, deposit succeeds after)

**Risks:** Error-code registry contention in batch-1 — the SINGLE cross-file registry lives in the P0 manifest's "Coordinate ONCE" note (P0-mainnet-gates.md, item b): 14 new variants claimed batch-wide vs ~6 free slots; consolidate there and verify the ~48-variant enum limit before anyone burns slots. The monitoring half must not wait for the redeploy — ship it now against the CURRENT #40 behavior so the footgun is covered on staging/prod immediately. Top-up depends on the multisig ceremony (L0-16): until then the issuer is the SEC-3 EOA — the runbook must say so honestly.

### L2-12 · Builder codes / partner attribution

**Status:** todo · **Effort:** M · **Lane:** mixed · **Ships in:** offchain-now · **Needs:** L1-18, L2-18 (banked fee-split decision) · **Blocks:** —
**Cross-refs:** TASKS G-3 · TASKS V1.1-4 · KNOWN_ISSUES G-2 · KNOWN_ISSUES C-T2-1 · AUDIT research 2.1 #8 · LIGHTER-GAP §Fees (Builder attribution row) · LIGHTER-GAP §Platform (Builder/partner attribution row) · **Gap rows:** Fees & incentives — Builder/integrator fee attribution (Partner Attribution analog for the T2 SDK surface) · Platform, API & trust — Builder/partner fee attribution layer

**Promotion trigger:** >=1 concrete distribution partner (LOBSTR/xBull/StellarTerm-class or a trading terminal) agrees to integrate against a rev-share term sheet — build the gateway version then. On-chain enforcement: the first post-batch-1 market refit window.

**Current state (verified):** PROD and STAGING: nothing attributes flow to an integrator — TASKS G-3 (TASKS.md:219) is untouched backlog; api_keys has no builder column (indexer/migrations/001_baseline.sql:130-139); no consent or revshare machinery exists in api/ or contracts. The rails are all present: /v1/tx/submit is authenticated (preHandler requireAuth, api/src/routes/tx.ts:40) so the gateway knows which key submitted every tx; the trades projection carries tx_hash + trader + size + contract_id (001_baseline.sql:69-85) for attribution joins; the referral contract's registry/claim machinery is live on-chain (create_code :74, set_referrer :119, record_trade :152, claim :203 in contracts/referral/src/lib.rs) but its economics are dormant (the market never calls record_trade — KNOWN_ISSUES G-2 corrected entry, C-T2-1); the treasury funding lever set_fee_split exists inactive (market lib.rs:193, default 2000 bps at storage.rs:208-209).

**Design:** Gateway-first, zero contract changes, consumer protections copied from Lighter wholesale. Registry: `builders(code TEXT PK, owner_wallet TEXT, fee_bps INTEGER, payout_wallet TEXT, created_at, revoked_at)` — fee_bps in plain bps with a hard platform cap of 10 bps (=0.10%; internally store deci-bps ×100 so it composes with FEE_PRECISION math); ops-approved creation for v1 (POST /v1/builders admin-gated). Binding: a user consents ONCE per builder via the walletAuth challenge flow signing a canonical statement `noether-builder-consent:<code>:<fee_bps>:<expiry?>` — stored in `builder_consents(wallet, code, fee_bps, signed_at, expires_at NULL, revoked_at NULL)`; revocable any time via DELETE (Lighter's consent/expiry/revoke model); fee changes require fresh consent (consent binds the exact fee_bps). Stamping: API keys gain `builder_code` (nullable column) set at issuance or via PATCH /v1/keys/:id; every /v1/tx/submit from that key records (tx_hash, builder_code) into `builder_attributions`; the indexer-side join tx_hash → trades yields attributed filled notional (7-decimal USD). Accrual: a monthly job computes Σ notional × fee_bps / 10_000 per builder, CAPPED by consent coverage (only consented users' flow accrues), paid manually from the treasury cut (L2-18 decision 1 / L1-18's funded pot) — payouts published on a docs partners page. GET /v1/builders/:code/stats (attributed notional, consented users, accrued/paid). On-chain enforcement later: extend the referral contract with builder entries + fee routing at the market's finalize_open choke point (lib.rs:2100-2118) in the post-batch-1 refit that also carries the referral hook — same fee-path surgery, done together. P2 sketch: payout automation and on-chain consent are promotion-time specs.

**Implementation**

**api**
- [ ] Migrations: builders, builder_consents, builder_attributions + api_keys.builder_code
- [ ] Admin builder CRUD + consent challenge/verify/revoke endpoints + submit-path stamping + stats endpoint
- [ ] Cap enforcement: reject fee_bps > 10 at registration and consent

**indexer**
- [ ] Attribution join view/materialization (tx_hash → trades notional per code) for the stats/payout queries

**web**
- [ ] Consent screen (shows code + exact fee) + revoke in account settings; builder badge on the fee preview when active

**sdk-ts**
- [ ] builderCode on key issuance/config + consent helper (mirror sdk-py)

**docs**
- [ ] Partners page: cap (<=10 bps), consent model, payout cadence, integration quickstart; pitch list LOBSTR/xBull/StellarTerm per G-3

**ops**
- [ ] Monthly payout runbook from the treasury account with a published ledger

**Acceptance:**
- api vitest: consent required before any accrual (unconsented flow attributes 0); fee_bps=11 rejected; revoked consent stops accrual the same day; stamping writes builder_attributions on every authed submit
- End-to-end on staging: a builder-keyed SDK trade appears in GET /v1/builders/:code/stats with the correct 7-decimal notional within one indexer poll
- The consent signature verifies against the exact fee_bps (a tampered fee fails verification)
- Docs partners page live with the cap and revocation stated; first payout ledger entry published (can be $0 demo)

**Risks:** Trust gap vs on-chain: gateway attribution only sees flow through the gateway — direct-to-chain SDK users bypass it (document: builder economics require gateway-routed flow until the on-chain hook). Payouts depend on the treasury cut being activated (L2-18/L1-18) — never promise revshare before the pot exists (the referral 4%/10% fiction is the cautionary tale, KNOWN_ISSUES G-2). When the on-chain half lands it must ride the SAME market refit as the referral hook (finalize_open surgery once, audited once). Consent UX must show the fee in plain % or it becomes a dark-pattern accusation.

### L2-13 · Oracle config transparency endpoint

**Status:** todo · **Effort:** S · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** — · **Blocks:** —
**Cross-refs:** AUDIT O-6 · TASKS P2-3 · LIGHTER-GAP §Pricing (methodology transparency row) · **Gap rows:** Mark price, index & funding — Pricing methodology transparency (machine-readable config + published derivation)

**Promotion trigger:** Ship with mainnet launch comms (transparency IS the launch messaging for an oracle-priced venue); build any sprint — no dependency gate.

**Current state (verified):** PROD and STAGING: /v1/oracle/prices and /v1/markets/:asset/price exist (api/src/routes/oracle.ts:24-93) and /v1/oracle/health exists (api/src/routes/oracleHealth.ts:73), but no endpoint exposes the effective safety config. The parameters live scattered and partly unreadable: 60s staleness + 100 bps deviation are MarketConfig defaults (noether_common/types.rs:210-211) with NO on-chain getter (get_config was removed for WASM — zero grep hits in market lib.rs); router sanity bands are a HARDCODED per-asset const table (noether_router/src/lib.rs:659-686 — so band changes require a router upgrade, resolving the gap row's open question); the router publisher set sits in instance storage `DataKey::Publishers` (:63, :158, :459) with no public getter, while get_stork_config IS public (:511). The generic read primitive exists: ContractReader.read wraps simulateTransaction (api/src/services/contractReader.ts:55-78).

**Design:** GET /v1/oracle/config (public, 60s TtlCache) returning, per asset in PAIR_TAGS: `{ maxStalenessS: 60, deviationBps: 100, deviationSelfDisableS: 600, routerBand: {min, max} (7-decimal strings), fundingIntervalS: 3600, liquidationPath: "lenient (never staleness/deviation blocked)" }` plus top-level `{ publishers: [hex ed25519...], stork: {configured, maxAgeS, toleranceBps, mode}, contracts: {market, router, shim, noeracle}, sources: {...provenance} }`. Provenance honesty is the design center: every field carries `source: "chain" | "code-constant"` — stork config and publishers read from chain (stork via contractReader.read('get_stork_config'); publishers via rpc getLedgerEntries on the router's instance-storage entry decoding DataKey::Publishers — no contract change needed; if decoding proves brittle, add a `get_publishers()` router view in batch-1 as the fallback), while staleness/deviation/bands mirror the compiled constants and are labeled so, with a CI guard test that fails when the mirrored table drifts from noether_common/types.rs defaults or the router BANDS table (parse the Rust const in a unit-test fixture). SDKs gain oracle.config(). Docs: the /protocol/oracle page documents the Noeracle aggregation pipeline (which upstream sources feed the attestation service — content from the Noeracle repo) and links the endpoint as the machine-readable source. Noeracle-upstream (optional, separate lane): per-round source metadata stamped into the SSE stream — file as a Noeracle feature request; the endpoint ships without it. When L0-8 (quorum) and L0-13 (per-asset funding) land, their params slot into the same response shape — design the schema with those fields optional-null now.

**Implementation**

**api**
- [ ] oracleConfig service: chain reads (stork, publishers via getLedgerEntries) + mirrored-constant table with provenance labels + 60s cache
- [ ] GET /v1/oracle/config route + OpenAPI schema (fields optional-null for post-L0-8/L0-13 params)
- [ ] CI drift test: mirrored constants vs contracts source fixtures

**sdk-ts**
- [ ] oracle.config() typed method (mirror sdk-py)

**docs**
- [ ] protocol/oracle page: aggregation pipeline, per-param meaning, link to the endpoint; note the lenient liquidation path explicitly

**Noeracle repo**
- [ ] (Optional) feature request: per-round source metadata in SSE frames; wire into the endpoint's sources block when available

**Acceptance:**
- GET /v1/oracle/config returns all 14 assets with routerBand min/max exactly matching the router BANDS table (integration test against staging chain state)
- The publishers array matches the keys the router was initialized with (cross-checked against the keeper's configured publisher key)
- Every response field carries a source label; the CI drift test fails when a contract constant changes without the mirror update (prove by mutation test)
- sdk-ts and sdk-py config() methods round-trip the schema; docs page links resolve

**Risks:** The mirrored-constant fields are documentation-grade truth, not chain truth — the provenance labels + CI drift guard are the honesty mechanism; without them this endpoint becomes confidently wrong after the next redeploy (worse than absent). getLedgerEntries instance-storage decoding depends on stellar-sdk XDR stability — keep the batch-1 get_publishers() view as the fallback plan. After L0-8/L0-12/L0-13 the response gains chain-readable params — schema designed forward-compatible so integrators don't break.

### L2-14 · Verifiability package: litepaper + Verify-Noether walkthrough + THREAT_MODEL publication

**Status:** todo · **Effort:** M · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** L0-18 · **Blocks:** —
**Cross-refs:** TASKS P6-2 · TASKS P6-1 · LIGHTER-GAP §Platform (Verifiability story row) · **Gap rows:** Platform, API & trust — Verifiability story, published ('execution IS the rules' vs zk-proved matching)

**Promotion trigger:** Drafting starts anytime; the RELEASE gate = L0-18 audit report ready for publication (same-week compound release: audit PDF + litepaper + verify page + threat model).

**Current state (verified):** PROD and STAGING: the substance exists, the narrative doesn't. Every order/fill/funding/liquidation is a public Stellar tx with ~5s L1 finality; the solvency views are permissionless on-chain reads — get_aum (contracts/vault/src/lib.rs:563), get_buffer_balance, get_shortfall, get_reserved_payout all public; docs.noether.exchange is live (28 pages) with protocol pages. But there is no whitepaper/litepaper, no verify-it-yourself walkthrough, no published trust-assumptions table, and docs/THREAT_MODEL.md (written 2026-07-04 for the Audit Bank submission, TASKS P6-2) is repo-internal only. The honest caveats that must anchor the story are all tracked: single publisher until L0-8, single keeper until L0-19, admin EOA until L0-16 (SEC-3), unauthenticated prod writes until L0-7.

**Design:** Four artifacts, one release moment. (1) Litepaper (docs repo, HTML page + PDF, ~10-15 pages): pool-model mechanics, oracle chain (Noeracle → router verify-then-trade → market), risk waterfall (margin → buffer → ADL → LP, post-batch-1), fee flows, and THE thesis stated as the gap doc frames it — 'we don't prove execution followed the rules; execution IS the rules, on a public L1' — with the honest comparison: Lighter proves matching in SNARKs but its feed pre-commitment window is admitted future work; Noether's fill price is relayed and settled in the user's own signed tx with hard finality at ledger close. (2) 'Verify Noether' docs page: a real tx hash walked end-to-end — (a) the Noeracle signed attestation (feed, price, conf, timestamp + ed25519 publisher sig), (b) the router refresh_price relay + publisher-allowlist check in the SAME tx (stellar.expert deep links), (c) the market position_opened event and fill recomputation from the relayed price, (d) copy-pasteable CLI (`stellar contract invoke … get_price_pers`, curl /v1/oracle/prices, curl /v1/oracle/config from L2-13). (3) Live solvency panel: a small gateway endpoint GET /v1/vault/solvency `{aum, reservedPayout, bufferBalance, shortfall, coverageRatio}` (contractReader over the four vault views, 30s cache) embedded on a docs Transparency page and optionally a web /transparency widget. (4) Trust-assumptions table (docs): publisher set + quorum status (from /v1/oracle/config), keeper role + every permissionless fallback (execute_order, liquidate, apply_funding, router close_with_price self-relay), admin key powers + multisig status (L0-16), pause semantics (L0-15) — each row: assumption, current state, mitigation, roadmap ID. Publish THREAT_MODEL.md as a docs page with a dated revision header. Release timed WITH the L0-18 audit publication for the compound trust moment; drafts start anytime.

**Implementation**

**docs**
- [ ] Write the litepaper (pool model, oracle chain, waterfall, thesis + honest-caveats section)
- [ ] Verify-Noether walkthrough with a real mainnet-or-staging tx hash + CLI blocks
- [ ] Trust-assumptions table sourced from the threat model + /v1/oracle/config
- [ ] Publish THREAT_MODEL.md as a versioned docs page

**api**
- [ ] GET /v1/vault/solvency (four contractReader views + coverage ratio, 30s cache) + OpenAPI schema

**web**
- [ ] (Optional) /transparency widget rendering the solvency endpoint with an em-dash on failed reads

**ops**
- [ ] Coordinate the release with the L0-18 audit PDF publication; litepaper PDF checksum pinned in the repo

**Acceptance:**
- Litepaper page + PDF live on docs.noether.exchange; thesis section reviewed/signed off by both founders
- The verify walkthrough executes cleanly: a third party following only the page reproduces the fill price of the referenced tx (dry-run by someone who didn't write it)
- GET /v1/vault/solvency returns the four views matching direct `stellar contract invoke` reads within one cache window
- THREAT_MODEL docs page live with a revision date; trust-table rows each cite a roadmap ID and current status truthfully (incl. single-publisher/single-keeper while true)

**Risks:** Honesty risk cuts both ways: publishing the trust table BEFORE L0-16/L0-7 land means documenting the single-EOA and write-path caveats in public — that is the point, but sequence the release so the worst rows already say 'fixed' (post-batch-1, post-ceremony). Staleness risk: the trust table and walkthrough reference concrete addresses/params that change on redeploy — add a docs-CI check against /v1/health resolved addresses (same pattern as L1-16). The litepaper is a marketing-load-bearing artifact; factual drift there is worse than absence.

### L2-15 · Disclosure surface: PGP intake + security.txt + docs security page

**Status:** todo · **Effort:** S · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** — · **Blocks:** —
**Cross-refs:** TASKS P6-5 · LIGHTER-GAP §Amendments (Security-disclosure row) · **Gap rows:** Amendments & corrections — Security-disclosure intake and discoverability: PGP channel, security.txt, docs-site surface

**Promotion trigger:** Immediate — no gate; complete before any mainnet comms (a researcher with a vault-drain PoC must never face a plaintext-DM intake).

**Current state (verified):** PROD and STAGING: SECURITY.md exists at the repo root (P6-5, shipped 2026-07-04) and its substance already beats Lighter's posture — 72h ack + 5-business-day triage, component scope incl. the Noeracle write path, safe harbor, SEAL 911 escalation, published discretionary bands (critical up to 10% of funds at risk, capped $10-25k). But it is repo-only with plaintext intake: web/public/ contains no .well-known directory and no pgp-key.asc (verified by ls — only asset logos/icons), no /.well-known/security.txt is served on noether.exchange, the docs site has no security page, and grep for pgp across web/ + SECURITY.md returns nothing.

**Design:** Half-day, four files. (1) Generate a dedicated security PGP keypair (ed25519, `security@noether.exchange` uid, 2-year expiry, private key held offline by Yahya + Mert per the L0-16 key-hygiene pattern — NOT on any server); publish the armored public key at web/public/pgp-key.asc → https://noether.exchange/pgp-key.asc; print the full fingerprint in SECURITY.md (Lighter's exact pattern). (2) RFC-9116 file at web/public/.well-known/security.txt: `Contact: mailto:security@noether.exchange`, `Encryption: https://noether.exchange/pgp-key.asc`, `Policy: https://github.com/NoetherDEX/noether/blob/main/SECURITY.md` (+ docs mirror URL), `Preferred-Languages: en`, `Expires:` +1 year, `Canonical:` self — optionally clearsigned with the new key. (3) Mirror SECURITY.md as a docs-site Security page (single-source: the docs page generated from or linking the repo file to avoid drift; add the PGP block + fingerprint). (4) Footer link 'Security' on noether.exchange + docs site pointing at the docs page. Ops addendum: the security@ mailbox must be a real monitored alias (both founders), and the 72h-ack SLA owner named in the internal runbook. Marketing note per the gap row: the published reward bands BEAT Lighter's no-standing-bounty stance — say so on the page.

**Implementation**

**web**
- [ ] Add web/public/pgp-key.asc + web/public/.well-known/security.txt (verify Next.js serves .well-known from public/ on the prod domain)
- [ ] Footer 'Security' link

**docs**
- [ ] Security page mirroring SECURITY.md + PGP fingerprint block; add to nav

**ops**
- [ ] Generate + offline-store the PGP key; create/monitor the security@ alias; calendar the security.txt Expires refresh; add the fingerprint to SECURITY.md

**Acceptance:**
- curl https://noether.exchange/.well-known/security.txt returns RFC-9116-valid content (all required fields, unexpired) on prod
- curl https://noether.exchange/pgp-key.asc imports cleanly (`gpg --import` succeeds) and the fingerprint matches SECURITY.md and the docs page
- A test message encrypted to the published key decrypts with the offline private key (one-time drill logged)
- docs security page live and linked from both site footers

**Risks:** Key custody: a security PGP key on a server or in Vercel env would recreate the SEC-3 pattern — offline only, documented holders. Drift: SECURITY.md vs the docs mirror must single-source or they diverge (the doc-drift class L1-16 exists to kill). security.txt Expires is a silent annual landmine — calendar it. Zero WASM/contract risk.

### L2-16 · Market-data freshness path (sub-second prices, direct event push)

**Status:** todo · **Effort:** M · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** — · **Blocks:** —
**Cross-refs:** TASKS P3-1 · TASKS P4-1 · LIGHTER-GAP §Amendments (Market-data freshness row) · **Gap rows:** Amendments & corrections — Market-data freshness envelope (low-latency API-servers analog)

**Promotion trigger:** First integrator complaint about event lag OR the first MM-tier onboarding (L1-15) — whichever comes first; the SSE ticker upstream is cheap enough to ship alongside L1-27's latency instrumentation any sprint.

**Current state (verified):** PROD and STAGING: the read side is poll-chained seconds-class. Ledger closes ~5-6s → indexer getEvents poll (2s) → gateway LiveTailer re-polls events_raw every 1,000ms (api/src/services/liveTailer.ts:43, SELECT at :65-74) → WS fan-out; so account/trade events lag 1-3s on top of chain finality. Prices: only the web enjoys the ~500ms Noeracle SSE (web/lib/stellar/noeracle.ts); the gateway's ticker channel is a 3,000ms chain-read poll (OracleTicker intervalMs ?? 3_000, api/src/services/oracleTicker.ts:29). The indexer's in-process bus exists (indexer/src/bus.ts:29-44) but indexer and api are SEPARATE processes (separate Azure Container Apps since 2026-07-15), so 'push the bus into WS' needs an inter-process transport the gap row didn't specify. /v1/health already exposes indexer.ledgerAgeSeconds (api/src/routes/health.ts:45-66); no event→WS latency is measured anywhere.

**Design:** Two lanes, both cheap, plus published truth. Lane A — prices sub-second: OracleTicker gains an SSE mode via a `NOERACLE_SSE_URL` env — stream Noeracle frames (the same endpoint the web uses), emit `ticker.<asset>` per frame throttled to >=200ms per asset, with a 10s watchdog falling back to the existing 3s shim poll (mirrors the web's A-grade stale handling); the ticker payload gains `sourceLane: "sse" | "chain-poll"` and the attestation timestamp so consumers can compute age. Lane B — events push: use Postgres as the transport since both processes already share Supabase — the indexer, after committing each events_raw row, fires `pg_notify('noether_events', json{event_id, topic, ledger, tx_hash, inserted_at})` (payload well under the 8KB NOTIFY bound); the gateway adds a ListenTailer holding a DEDICATED session-mode connection (the Supabase session pooler supports LISTEN/NOTIFY; transaction mode does not — verify at rollout, else point the listener at the direct DB host) that on NOTIFY fetches the row and runs the existing LiveTailer decode/emit path immediately; the 1s poll is KEPT as the fallback lane (the inserted_at cursor already dedupes, so double delivery is naturally idempotent). Expected event lag drops from ~1-3s to ~50-200ms post-commit. Publish the envelope: /v1/health gains `marketData: { priceLaneP50Ms, eventLaneP50Ms, transport }` measured from rolling stamps (insert→emit deltas); the docs WebSocket page documents the two-lane reality — prices sub-second via SSE, events seconds-class bounded by ledger close + indexer poll — and states chain finality as the floor (ties into L1-27's narrative).

**Implementation**

**api**
- [ ] OracleTicker SSE mode + watchdog fallback + sourceLane field
- [ ] ListenTailer (dedicated LISTEN connection, NOTIFY → immediate decode/emit, poll fallback retained)
- [ ] Rolling latency stamps + marketData block in /v1/health

**indexer**
- [ ] pg_notify after each events_raw commit (behind an INDEXER_NOTIFY=1 flag for safe rollout)

**docs**
- [ ] WebSocket page: two-lane envelope, measured numbers, finality floor

**ops**
- [ ] Verify LISTEN works through the session pooler on Azure; else provision the direct connection string for the listener only

**Acceptance:**
- Ticker frames on staging arrive <=1s apart per asset with sourceLane=sse while the SSE is healthy, and degrade to chain-poll within 10s of killing the SSE (watchdog test)
- Event lane: a scripted trade's position_opened reaches a subscribed WS client < 500ms after the indexer commit (measured via the new stamps), vs the ~1-3s baseline — number visible in /v1/health.marketData
- Killing the NOTIFY path (flag off) silently degrades to the 1s poll with zero event loss (dedupe test: no double frames observed by a recording client)
- Docs WS page shows the measured envelope and matches the /v1/health fields

**Risks:** Supabase pooler mode: LISTEN/NOTIFY requires session mode — if the current pooler string is transaction-mode for the gateway, the listener needs its own connection string; get this wrong and the feature silently never fires (hence the poll fallback is mandatory, not optional). Double delivery must stay idempotent (cursor dedupe covers it — keep the regression test). The SSE upstream adds a Noeracle-service dependency to the GATEWAY's availability story — the watchdog fallback keeps ticker liveness at worst-case status quo. No contract/WASM exposure.

### L2-17 · Margin-mode/leverage persistence + mode switching

**Status:** todo · **Effort:** S · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** — · **Blocks:** —
**Cross-refs:** LIGHTER-GAP §Margin (mode/leverage persistence row) · docs/UIUX-RESEARCH-2026-07.md (Margin UX matrix row, ~:819 — 'no persisted per-pair leverage') · **Gap rows:** Margin & collateral — Margin-mode switching and per-market mode/leverage persistence

**Promotion trigger:** Frontend persistence: any sprint. switch_margin_mode: only on recurring user demand (support/Discord requests to migrate open positions without close-reopen), re-evaluated AFTER L0-6 partial close + add/remove margin ships — L0-6 removes most of the pain this would solve.

**Current state (verified):** PROD and STAGING: margin mode is per-order component state — `useState<'Isolated' | 'Cross'>('Isolated')` at web/components/trading/OrderPanel.tsx:66 — reset on every mount; the global tradeStore (web/lib/store/tradeStore.ts, 28 lines) holds one asset/direction/collateral/leverage set with leverage defaulting to 1 and NO persist middleware and NO per-pair keying. No on-chain entrypoint moves an open position between modes (Position.margin_mode u32 is fixed at open; full close+reopen is the only migration, paying fees twice). UIUX research already flags the missing persisted per-pair leverage/mode in the competitor matrix.

**Design:** Frontend (ships in a day): tradeStore gains `perPair: Record<string, { marginMode: 'Isolated' | 'Cross'; leverage: number }>` wrapped in zustand `persist` middleware (localStorage key `noether-trade-prefs`, version 1 with a migrate stub); selectors `getPrefs(asset)` defaulting {Isolated, 1}; OrderPanel lifts its marginMode state into the store keyed by the active asset and writes back on user change; the leverage slider reads/writes perPair[asset].leverage clamped to the pair's max (per-pair max arrives with L0-12 — until then the global 10x). Asset switching restores the pair's last mode+leverage. QA note: persisted leverage must re-clamp when a pair's max drops after L0-12 config lands (clamp on read, not just write). On-chain switch_margin_mode(trader, position_id) — DEMAND-GATED, post-launch refit only: isolated→cross requires no attached SL/TP/trailing (reject #80-family until L1-1 lifts the ban), moves position.collateral into CrossMarginBalance accounting, re-runs the cross open gate over the whole account (equity incl. uPnL + pending funding >= aggregate MM + this position's IM) at the CURRENT oracle price, sets margin_mode=1; cross→isolated requires carving collateral >= `IM = size/leverage` from pool equity while the residual account stays >= its MM, assigns a fresh liquidation_price via the existing liquidation_price_from_ratio helper, sets margin_mode=0. Both directions atomic in one invocation, emit `margin_mode_switched(position_id, trader, from_mode, to_mode, collateral)`. L0-6's add/remove margin removes most of the demand for this — re-evaluate after it ships.

**Implementation**

**web**
- [ ] tradeStore: perPair map + persist middleware + versioned migrate + clamp-on-read
- [ ] OrderPanel: mode/leverage from the store keyed by asset; write-through on change; restore on asset switch
- [ ] tsc + a store unit test (persistence round-trip, clamp behavior)

**contracts/market**
- [ ] (Only if promoted) switch_margin_mode both directions + event + tests: gate re-runs at oracle price; attached-orders reject; cross→isolated carve respects account MM

**Acceptance:**
- Switching BTC→ETH→BTC restores BTC's saved mode+leverage after a full page reload (manual + store unit test)
- Persisted leverage above a pair's max clamps on read (unit test simulating a lowered max)
- No regression in the order flow: prepared txs carry the store values (existing e2e signs an order with persisted 5x)
- (If promoted) cargo tests for both switch directions incl. the attached-order rejection

**Risks:** The frontend-only piece is near-zero risk (localStorage schema versioned to avoid stale-pref bugs across releases). The contract op, if ever built, is the risky half: mode switching touches margin math, liquidation-price assignment, and the #80 order-attachment rules simultaneously — supervise-closely class per CLAUDE.md, needs its own audit-grade review, and must not be smuggled into batch-1 (it is explicitly demand-gated).

### L2-18 · Token/staking stack — deliberate deferral with two banked decisions

**Status:** todo · **Effort:** S · **Lane:** operator · **Ships in:** operator-track · **Needs:** L0-16 · **Blocks:** L1-18, L1-21, L1-22, L2-12 (decision/budget slice only — the DECISION-token-stack.md slice lands before the batch-1 freeze; set_fee_split activation is the mainnet runbook step)
**Cross-refs:** TASKS P1-10 · TASKS P6-4 · AUDIT Part 3 critic #1 (protocol economic sustainability) · LIGHTER-GAP §Fees (Token utility row) · **Gap rows:** Fees & incentives — Token utility & value-accrual stack (staking fee discounts, fee credits, buybacks) — explicitly defer

**Promotion trigger:** Decision doc: now. set_fee_split activation: mainnet cutover runbook step (post-L0-16). Token-stack re-evaluation: only post-launch with sustained real volume AND the P6-4 legal review closed — and then fee-credit design over emissions.

**Current state (verified):** PROD and STAGING: no utility/governance token exists — NOE is the LP share (SAC pre-mint+transfer, contracts/vault/src/noe.rs), not a LIT analog. The protocol currently earns zero: 100% of trading fees route to the vault because set_fee_split (contracts/market/src/lib.rs:193, cap 5000 bps) has never been called — get_protocol_fee_bps defaults 2000 bps (20%) at storage.rs:208-209 and finalize_open only diverts the cut when a Treasury address is set (lib.rs:2107-2113). All fee math is already deci-bps (FEE_PRECISION=100_000; tier table in trading.rs), so multiplicative discounts compose without precision surgery. P6-4's legal consult on NOE treatment/domicile remains open (TASKS.md:197), and the volume ladder already discounts up to 75% vs Lighter Premium's 30% max — the two facts anchoring the deferral.

**Design:** A decision record plus two banked, cheap commitments — no token is built. Decision doc `docs/plans/DECISION-token-stack.md`: no second token before mainnet + real volume; rationale: (a) regulatory surface while P6-4 is open, (b) latency monetization — the load-bearing half of Lighter's model — is structurally N/A on Soroban (everyone settles at ledger cadence; no speed to sell), (c) the volume ladder already out-discounts Lighter's staking ladder. Banked decision 1 — activate the treasury cut at mainnet as the standing incentive budget: the mainnet cutover runbook gains the operator step `stellar contract invoke --id $MARKET_ID --source noether_admin --network <net> -- set_fee_split --treasury $TREASURY_MULTISIG --bps 2000` where $TREASURY_MULTISIG is a multisig-controlled account (L0-16 output, never the SEC-3 EOA); verification: open a test position with 100 USDC notional-fee flow and assert the treasury receives fee × 20% (taker 50 deci-bps on $1,000 = 0.50 USDC → 0.10 USDC cut), or read the Treasury/ProtocolFeeBps instance keys via getLedgerEntries. This budget explicitly funds L1-18 (referral pot), L1-21 (keeper-fee restructure), L2-12 (builder payouts), L1-22 (buffer top-ups) — never the LP share (founder decision 2026-07-17). Banked decision 2 — deci-bps invariant: record in contracts/CLAUDE.md conventions + the decision doc that ALL future fee modifiers (staking multiplier, promos) must compose as `effective = tier_deci_bps × (10_000 − discount_bps) / 10_000` in deci-bps — no schedule rewrites. If a token stack is EVER built: copy Lighter's fee-credit rent-a-tier (self-funding, proceeds to stakers) over raw emissions; that sentence goes in the doc so future-us doesn't relitigate.

**Implementation**

**docs**
- [ ] Write DECISION-token-stack.md (deferral rationale + the two banked decisions + the rent-a-tier-if-ever clause); founder sign-off
- [ ] Add the deci-bps composition invariant to contracts/CLAUDE.md conventions

**ops**
- [ ] Add set_fee_split activation (exact CLI + treasury multisig address + verification read) to the mainnet cutover runbook as a numbered step after the L0-16 ceremony
- [ ] Record the fee-budget allocation policy (which programs draw from the 20% cut) in the runbook

**Acceptance:**
- DECISION-token-stack.md merged with founder sign-off lines
- The mainnet runbook contains the set_fee_split step with the multisig treasury and a verification command; rehearsed once on staging (treasury balance increments by exactly fee×2000/10000 on a test trade)
- contracts/CLAUDE.md carries the deci-bps composition invariant
- No token-contract code exists in the repo (guard: the decision doc is the answer to future PRs proposing one)

**Risks:** The treasury cut reduces LP yield by construction (the vault share drops from 100% to 80% of fees) — the L1-20 fee sheet and vault-page copy must disclose the split the day it activates, or the '100% of fees to LPs' parity claim becomes stale marketing. Pointing set_fee_split at the SEC-3 EOA instead of the multisig would concentrate the incentive budget on the hot key — sequence strictly after L0-16. bps is admin-changeable later (cap 5000); publish changes via the L1-16 changelog channel.

### L2-19 · RWA markets — conditional far-future path

**Status:** todo · **Effort:** L · **Lane:** mixed · **Ships in:** post-launch · **Needs:** L0-9, L0-12, L0-14, L1-24 · **Blocks:** —
**Cross-refs:** TASKS G-2 · AUDIT research 2.1 #10 · LIGHTER-GAP §Listings (RWA row) · LIGHTER-GAP Appendix A (rwa cluster: ±1/L clamp, trading-hours, OI caps) · **Gap rows:** Market specs & listings — RWA / pre-IPO / equity-index markets

**Promotion trigger:** L0-9 + L0-12 + L0-14 live on mainnet AND Noeracle (or a SEP-40 source) ships a production XAU or major-FX feed; the first candidate then goes through the L1-24 runbook with the RWA addendum. Single-name equities: separate future trigger (an off-hours pricing answer); pre-IPO: never.

**Current state (verified):** PROD and STAGING: 14 crypto pairs only, table-driven via PAIR_TAGS (contracts/noether_common/src/assets.rs:17). The reusable ingredients exist: the shim's set_backend mode 1 accepts any standard SEP-40 lastprice feed with decimal rescaling (contracts/noeracle_shim/src/lib.rs:203-220 — Reflector/Chainlink/Stork-class plug in without market changes), and the router carries Stork secp256k1 verification. Nothing has trading-hours awareness: no per-asset halt exists in the market (grep halt: only the M-2 halt-open/allow-close oracle semantics at lib.rs:2038), router sanity bands are a hardcoded crypto-only table (noether_router lib.rs:659-686), and liquidation marks are a single spot print until L0-9. In the pool model ALL weekend/overnight gap risk lands on the LP vault — single-name equities (6.5h/day sessions) are the worst possible early listing class.

**Design:** Defer until L0-9 (smoothed mark) + L0-12 (per-market ladder) + L0-14 (absolute caps) are live; then near-24/7 underlyings ONLY — XAU and major FX first (G-2's exact list), never single-name equities until an off-hours pricing answer exists, pre-IPO never (needs internal orderbook price discovery Noether structurally lacks). Feed: prefer Noeracle-published XAU/EURUSD (Yahya's Noeracle roadmap — then listing = a PAIR_TAGS row + shim upgrade(), no backend switch); the shim's SEP-40 mode-1 (Stork/Pyth-class) is the alternative if Noeracle doesn't carry the asset. Trading-hours gate: reuse L1-24's per-asset halt (halt-open/allow-close — exactly the M-2 asymmetry, per asset): the keeper gains a session-calendar config (per-asset tz + weekly session windows + holiday list) and flips set_asset_halted(asset, bool) at boundaries; set_asset_halted(true) also snapshots `LastSessionClose(Symbol) -> i128` (7-decimal) on-chain. Off-hours clamp (the one Lighter RWA piece needing no orderbook): while halted, get_oracle_price clamps any print into `[close × (1 − 1/L), close × (1 + 1/L)]` where L = the asset's max leverage from L0-12 config (e.g. 5x → ±20% band) — applied to liquidation/trigger evaluation so an off-hours feed glitch cannot liquidate through more than one leverage-width; user closes still settle at the clamped mark (disclosed in UI with the L1-26 mark-age badge). Risk config per G-2: 3-5x leverage, small ABSOLUTE OI caps ($1-5M per market via L0-14), first-weeks isolated-only, listed through the L1-24 runbook with an RWA addendum (session calendar + clamp verification + weekend-gap drill). Router band rows for each RWA asset (a band-table change = router upgrade — batch with the listing). P2 sketch — full clamp math + calendar format spec at promotion.

**Implementation**

**contracts/market**
- [ ] (At promotion) LastSessionClose snapshot in set_asset_halted + off-hours ±1/L clamp branch in get_oracle_price + tests (clamp binds only while halted; closes never blocked; clamp width follows per-asset L)

**Noeracle repo**
- [ ] XAU/major-FX feeds with publisher-authenticated writes (or a SEP-40 adapter via shim set_backend mode 1 as fallback)

**keeper**
- [ ] Session-calendar config + halt-flip cron + weekend-gap alert drill

**docs**
- [ ] RWA listing addendum to the L1-24 runbook: sessions, clamp, caps, isolated-only phase; user-facing trading-hours page

**web**
- [ ] Market-closed badge + off-hours clamp disclosure on RWA pairs; hide leverage above the pair max

**Acceptance:**
- Scenario test (at promotion): with XAU halted, a relayed print 30% above LastSessionClose evaluates liquidations at the clamped +20% bound (5x pair) and opens are rejected; a user close succeeds at the clamped mark
- The keeper flips the halt within 60s of the configured session boundary across a DST transition (calendar test)
- A listing dry-run of XAU through the L1-24 runbook completes every RWA-addendum step incl. the router band row + $1-5M absolute cap set
- Docs trading-hours page live; UI shows the closed badge outside sessions

**Risks:** This multiplies exactly the risks still open pre-L0-9/12/14 — promoting early gaps the vault on a weekend candle (the gap doc's honest judgment: botching one RWA could gap the vault; skipping loses ~no current users). Clamp + halt + calendar must agree across contract, keeper, and docs (keeper/contract parity class). Router band updates require a router upgrade per listing until bands become admin-settable (L1-24 decision). Monday-open gap risk is structural in a pool model — absolute caps are the only real bound; size them assuming the full ±1/L moves against the pool.
