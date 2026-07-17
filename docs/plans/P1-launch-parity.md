# P1 — Launch Parity (Build Plan)

> Source analysis: docs/LIGHTER-GAP-2026-07.md (2026-07-17) · Companion files: docs/plans/P0-mainnet-gates.md, P1-launch-parity.md, P2-differentiators.md · Cross-refs cite TASKS.md / docs/AUDIT-2026-06.md / KNOWN_ISSUES.md — those ledgers are not modified.

**How to track:** Status values are `todo | in-progress | done | dropped`, edited inline in BOTH the tracking table and the item header. IDs are stable — never renumber. Baseline tags PROD / STAGING / CODE-COMPLETE are as defined in the gap doc preamble.

## Tracking table

| ID | Title | Effort | Lane | Ships in | Needs | Status |
|----|-------|--------|------|----------|-------|--------|
| L1-1 | Protective orders on cross-margin positions (lift #80 via cross-aware settlement) | M | mixed | batch-1-redeploy | — | todo |
| L1-2 | Atomic bracket placement (router open_with_price_and_tpsl — G-1) | M | mixed | batch-1-redeploy | L0-21, L1-1, L0-10 | todo |
| L1-3 | Auto-net at open (minimum-viable position netting) | M | mixed | batch-1-redeploy | L0-6, L1-1 | todo |
| L1-4 | Cross-collateral operations via API/SDK | S | offchain | offchain-now | L0-21 | todo |
| L1-5 | Account initial-margin band (withdraw/open gate above MM) | S | contracts | batch-1-redeploy | — | todo |
| L1-6 | Canonical margin formula + GET /v1/account/margin | M | offchain | offchain-now | — | todo |
| L1-7 | Margin-call state + banner (pre-liquidation warning) | M | offchain | offchain-now | L1-6 | todo |
| L1-8 | Event enrichment at the contract layer (trader-keyed order events, per-leg cross liquidation) | M | mixed | batch-1-redeploy | L0-5 | todo |
| L1-9 | Account-scoped WS completeness (fills, cancels, liquidations on the private channel) | M | offchain | offchain-now | — | todo |
| L1-10 | Web notification surface (toasts + inbox) + #83 error mapping | M | offchain | offchain-now | L1-9 | todo |
| L1-11 | Funding data API (REST + WS + SDKs + per-position accrued) | M | offchain | offchain-now | — | todo |
| L1-12 | Machine-readable per-market specs endpoint + docs table | M | offchain | offchain-now | — | todo |
| L1-13 | Pool-capacity headroom API + OrderPanel clamp | M | offchain | offchain-now | L1-12 | todo |
| L1-14 | SDK endpoint coverage + publish the 0.1.2 pair | S | mixed | offchain-now | L0-21, L1-4, L1-6 | todo |
| L1-15 | Open-access mode + MM tier path + key management surface | M | offchain | offchain-now | L1-27 | todo |
| L1-16 | Docs corrections + stable API domain + changelog channel | S | mixed | operator-track | L1-14 | todo |
| L1-17 | Points program v1 (indexer-driven, wash-resistant) | M | offchain | offchain-now | L1-19 | todo |
| L1-18 | Referral economics activation — IN Redeploy Batch 1 (founder decision 2026-07-17) | M | mixed | batch-1-redeploy | L2-18 | todo |
| L1-19 | Protocol-vault indexing → real LP APY + NOE history | M | offchain | offchain-now | — | todo |
| L1-20 | Mainnet fee sheet + all-in cost story + GET /v1/fees | S | mixed | offchain-now | — | todo |
| L1-21 | Keeper-fee disclosure now + maker≤taker restructure in Batch 1 | M | mixed | batch-1-redeploy | L2-18 | todo |
| L1-22 | Insurance-fund seeding + fee stream + published coverage ratio | M | mixed | batch-1-redeploy | L1-18, L1-21, L2-18 | todo |
| L1-23 | Bankruptcy keeper bounty | S | contracts | batch-1-redeploy | L0-2, L0-4, L1-22 | todo |
| L1-24 | Listing pipeline runbook-as-code + per-asset halt | M | mixed | batch-1-redeploy | L0-12, L0-14 | todo |
| L1-25 | Public status page + monitoring (closes P3-1) | S | mixed | operator-track | — | todo |
| L1-26 | Exit guarantees published + stale-close disclosure/clamp | M | mixed | batch-1-redeploy | L0-7, L0-15 | todo |
| L1-27 | Execution-latency instrumentation + optimistic pending UX + finality narrative | M | offchain | offchain-now | — | todo |
| L1-28 | LP withdrawal cooldown (JIT/NAV-sniping protection) | S | contracts | batch-1-redeploy | L0-15 | todo |
| L1-29 | Utilization borrow fee (dual-slope, second cumulative index) — verification-round addition | M | contracts | batch-1-redeploy | L0-13 | todo |
| L1-30 | Leader protective-order proxies on factory vaults — verification-round addition | S | contracts | batch-1-redeploy | L0-20 | todo |

## Batch-1 riders

These P1 items (or the halves marked below) MUST ship inside the P0 Redeploy Batch 1 because they touch contract surface (market / vault / router / referral / noether_common). The coupled-redeploy manifest and sequencing live in docs/plans/P0-mainnet-gates.md — Batch-1 contract work freezes there for the L0-18 audit. Everything not listed here is offchain-now (or operator-track) and independently shippable.

Full Batch-1 items (contract surface):

- **L1-1** — market: `settle_cross_close` + removal of the three #80 gates. Offchain-now slice ships early: interim "no stops in cross" guard copy.
- **L1-2** — router: `open_with_price_and_tpsl` (isolated brackets work against the CURRENT market; cross brackets additionally need L1-1's lift, same batch).
- **L1-3** — market: netting phase in `do_open` + error #85 NetsToZero, built on the L0-6 partial-close port. Offchain-now slice: OrderPanel opposite-position warning.
- **L1-5** — market: IM-based withdraw/open gates (`calculate_cross_used_margin`).
- **L1-8** — market: enriched order events + per-leg cross-liquidation events. Rollout order is load-bearing: arity-tolerant indexer/gateway/web deploy BEFORE contract promotion.
- **L1-18** — market referral hook (`set_referral`, `apply_referral`, `get_trader_volume` view) + referral contract redeploy (funded claim, volume param, admin controls).
- **L1-21** — restructure half only: keeper fee moves into MarketConfig as `keeper_fee_base`/`keeper_fee_deci_bps` (bps-only, maker ≤ taker at every tier). The disclosure half ships offchain-now.
- **L1-22** — vault `route_protocol_fee` + `BufferTargetBps` + cap getters; market `finalize_open` rewire.
- **L1-23** — MarketConfig `min_liq_bounty` + vault `pay_bounty`.
- **L1-24** — market per-asset halt (`AssetHalted`, error #85) + router storage-backed price bands.
- **L1-26** — MarketConfig `lenient_clamp_bps` + clamp in `get_oracle_price`'s lenient branch.
- **L1-28** — vault `LastDepositTs`/`WithdrawCooldownSecs` + cooldown gate (error #84).
- **L1-29** — market: utilization borrow fee — second per-asset lazy cumulative index riding L0-13's machinery (verification-round addition; see item below).
- **L1-30** — vault_factory: leader protective-order proxies + TIF pass-through (verification-round addition; rides the factory redeploy with L0-20; see item below).

Partial riders (item ships offchain-now; only the listed slice rides Batch 1):

- **L1-20** — trading.rs mainnet tier thresholds swap ($1M/$5M/$25M; rates unchanged) — must sit inside the audit-frozen surface (blocks L0-18).
- **L1-12** — optional router view `get_price_bounds(asset)` (would kill the shared band mirror).
- **L1-13** — optional vault views `get_reserve_cap_bps()` / `get_asset_cap_bps(asset)`.
- **L1-11 / L1-6** — fallback market view `get_funding_state()` ONLY if the CumulativeFundingRate ledger-key fixture fails (owned by L1-11).

Batch-1 integration checkpoints (asserted across the item specs; resolve once, before the L0-18 freeze):

- ONE MarketConfig shape + ONE migrate_config call — the SINGLE cross-file field census lives in the P0 manifest's "Coordinate ONCE" note (P0-mainnet-gates.md, item a): L0-1/L0-4/L0-5/L0-9 + L1-21/L1-23/L1-26/L1-29 + L2-9's isolated_only (+ L0-12/L0-13 if folded in). A second shape change post-freeze reopens audit scope.
- Error-code reconciliation: RESOLVED — the ceiling was fiction (prose comment only; u32 codes, no decode-path assumptions). Final locked numbers live in the P0 manifest's "Coordinate ONCE" note (item b); P1's are **#91 NetsToZero (L1-3), #92 AssetHalted (L1-24), #93 WithdrawCooldownActive (L1-28)**. Item bodies referencing the old #84/#85 placeholders defer to that registry. Never renumber after deploy.
- Indexer migration numbers: ids are the numeric filename prefix, PK-tracked (indexer/src/migrations.ts:51-69) — duplicate prefixes are silently skipped. Registry (in the same P0 note, item c): 003_bad_debt (L0-2), 004_lp_vault (L1-19), 005_orders_projection (L1-9), 006_funding_rates (L1-11), 007_points (L1-17); assign final numbers by landing order, always unique.
- Fee-path ordering in `finalize_open` is shared by L1-18 (referral accrual) → L1-22 (buffer routing), with L1-21's keeper restructure adjacent — one engineer owns the combined change; the LP share (fee − cut) is never reduced.
- Combined WASM size check after every merged item (market optimized baseline 70,044 B vs the 128 KB / 131,072 B protocol limit).

## Suggested order

Dependency-respecting sequence for the off-chain items (Batch-1 items sequence inside the P0 manifest):

1. **L1-16 (URL half)** — stable `api.noether.exchange` CNAME + docs base-URL sweep immediately; only the SDK re-pin half waits on L1-14.
2. **L1-4 + L1-6** — cross-collateral prepare ops and the canonical margin endpoint; both surfaces ride the 0.1.2 SDK publish, and L1-6 unblocks L1-7.
3. **L1-9 → L1-10** — orders projection + wallet WS login first; the notification surface consumes L1-9's frames.
4. **L1-7** — margin monitor + banner on top of L1-6's canonical scalar.
5. **L1-11; L1-12 → L1-13** — funding API independently; specs endpoint before the capacity clamp (L1-13 folds into L1-12's specs/docs surfaces).
6. **L1-14** — land the parity CI early; publish 0.1.2 only after L0-21's tx-builders fixes merge, carrying the L1-4/L1-6 surfaces → then L1-16's SDK re-pin half.
7. **L1-19 → L1-17** — protocol-vault indexing before points (the lp_deposits category is live-but-zero until lp_vault_flows populates).
8. **L1-20 + L1-21 (disclosure half) + L1-27** — fee/latency truth surfaces → **L1-15** (open-access; the MM-tier pitch cites L1-27's measured envelope).
9. **L1-25** — status page any time; create the coverage monitor disabled until L1-22's solvency block ships.

## Trading UX (L1-1..L1-6)

### L1-1 · Protective orders on cross-margin positions (lift #80 via cross-aware settlement)

**Status:** todo · **Effort:** M · **Lane:** mixed · **Ships in:** batch-1-redeploy · **Needs:** — · **Blocks:** L1-2, L1-3, L2-7, L0-18
**Cross-refs:** AUDIT M-3 · TASKS P1-2 · TASKS P0-3 · LIGHTER-GAP §Margin & collateral (protective orders banned on cross-margin) · LIGHTER-GAP §Order types & execution (order support for cross-margin positions) · **Gap rows:** Margin & collateral: Protective orders (SL/TP/trailing) banned on cross-margin positions · Order types & execution: Order support for cross-margin positions (no SL/TP/trailing/entry triggers in cross)

**Current state (verified):** PROD+STAGING: `set_stop_loss` / `set_take_profit` / `place_trailing_stop` reject `margin_mode==1` with error #80 CrossMarginOrderNotSupported (contracts/market/src/lib.rs:1359-1361, 1467-1468, 1930-1931; contracts/noether_common/src/errors.rs:131) — the deliberate M-3 fix (TASKS P1-2, commit 71363e3), because `execute_close_order` settles every trigger through `settle_isolated_close` (lib.rs:2514-2530), which pays collateral+PnL to the trader's WALLET (lib.rs:2187-2190) instead of the shared pool that `close_position_cross` credits (lib.rs:946-954). Keeper-executed reduce-only entries only target isolated positions (`margin_mode==0` filter at lib.rs:2420) and `execute_limit_entry` always opens isolated (`margin_mode: 0` at lib.rs:2495). The web carries defense-in-depth guards with "contract fix pending" copy: the trade page refuses cross SL/TP (web/app/trade/page.tsx:609-616, 642-647), OrderPanel filters trailing-eligible positions (web/components/trading/OrderPanel.tsx:152-156, submit guard :422-427) and gates TP/SL-at-open to Isolated (OrderPanel.tsx:126-132). The keeper is simulate-first (scripts/keeper/src/index.ts:1010-1022) and buckets #80 rejections as quiet non-retryable (index.ts:1057), so it needs zero changes when the ban lifts. Net effect: cross users — the ones facing all-or-nothing account liquidation with residual confiscation (lib.rs:1097-1112, L0-4 scope) — have no stop-loss, take-profit, or trailing stop at all.

**Design:** Route, don't prohibit.

1. New internal helper in contracts/market/src/lib.rs: `fn settle_cross_close(env, position: &Position, current_price: i128, keeper_fee: i128, keeper: Option<&Address>, skip_order: Option<u64>) -> Result<i128, NoetherError>` — the shared cross settlement, extracted from `close_position_cross`'s body (lib.rs:912-973) plus a keeper-fee leg: funding = calculate_cumulative_funding(size, direction, entry_cum, current_cum); pnl = calculate_pnl(pos, current_price); paid = settle_with_vault(pnl) (profit capped by pool); to_vault = max(0, −pnl) + max(0, funding) transferred with credit_vault_receipt; fee_paid = min(keeper_fee, max(0, collateral + effective_pnl − max(0, funding))) paid to the keeper from the market's USDC (the market custodies cross deposits, lib.rs:1016-1018); earned_funding = max(0, −funding); to_pool = collateral + effective_pnl − max(0, funding) + earned_funding − fee_paid credited to CrossMarginBalance(trader), where effective_pnl = paid if pnl > 0 else pnl. Then adjust_oi (release), record_volume_only, cancel_position_orders(position_id, skip_order), remove_cross_margin_position, delete_position; emit position_closed with the UNCHANGED 8-tuple (position_id, trader, asset, direction, size, entry_price, current_price, pnl) — zero event-format drift. Refactor `close_position_cross` to call `settle_cross_close(keeper_fee=0, keeper=None)` so there is ONE compiled settlement body (WASM discipline).
2. `execute_close_order` (lib.rs:2514) branches: `margin_mode==1` → `settle_cross_close(..., Some(keeper), Some(order.id))`; else `settle_isolated_close` as today. Keeper fee formula unchanged (calculate_keeper_order_fee: 0.50 USDC base + 5 bps of size, KeeperFeeConfig types.rs:378-385).
3. Delete the three #80 gates; KEEP error code 80 in the enum (never renumber — deployed clients decode by code).
4. Trigger-price validation stays as-is (vs entry_price, lib.rs:1371-1382); cross positions' `liquidation_price==0` (lib.rs:373-374) is not referenced by any trigger path.
5. Reduce-only for cross: extend `execute_limit_entry`'s reduce-only target scan (lib.rs:2416-2427) to also accept `margin_mode==1` and settle those via `settle_cross_close` (order-collateral refund path unchanged).
6. Explicit v1 non-goal: entry triggers (LimitEntry/StopLimit) stay isolated-only — `execute_limit_entry` keeps `margin_mode: 0`; cross-funded resting orders are L2-7.
7. OCO on account liquidation already holds: `liquidate_cross_account` cancels attached orders per position (lib.rs:1056) — no zombie orders.
8. Web, ships now (offchain): keep the guards but change copy to an explicit product statement: "Stop/take-profit orders are not yet available on cross-margin positions". Web, ships with the redeploy: remove the trade-page guards (609-616, 642-647), the trailingEligiblePositions filter (OrderPanel 152-156, 422-427), and the marginMode term in canAttachTpSl (:132, jointly with L1-2).

No new errors, events, storage keys, or config; no migrate_config.

**Implementation**

**contracts/market**
- [ ] Extract `settle_cross_close` from `close_position_cross` (lib.rs:912-973) with the keeper-fee leg per design; refactor `close_position_cross` onto it (keeper_fee=0)
- [ ] Branch `execute_close_order` on position.margin_mode (cross → `settle_cross_close` with Some(keeper), Some(order.id))
- [ ] Remove the three #80 gates at lib.rs:1359-1361, 1467-1468, 1930-1931 (keep NoetherError::CrossMarginOrderNotSupported=80 defined)
- [ ] Extend `execute_limit_entry` reduce-only scan (lib.rs:2416-2427) to accept `margin_mode==1` targets and settle them via `settle_cross_close`
- [ ] Tests: cross_sl_executes_settles_to_pool (get_cross_margin_balance delta == collateral+pnl−funding−keeper_fee, wallet balance unchanged, position_closed emitted, sibling TP cancelled); cross_tp_and_take_limit_execute; cross_trailing_executes; cross_keeper_fee_capped_when_proceeds_small; reduce_only_closes_cross_via_pool; cross_close_conservation_property (pool+vault+keeper deltas sum to collateral+settled pnl); regression: the three P1-2 #80 tests (lib.rs:3185-3193) flip to asserting success
- [ ] `cargo test -p market`; rebuild optimized WASM and record size delta (baseline 70,044 B / 128 KB limit)

**web**
- [ ] NOW (offchain-now slice): change guard copy in trade/page.tsx:614/645 and OrderPanel.tsx:424 from "contract fix pending" to the explicit no-stops-in-cross product warning
- [ ] WITH the redeploy: delete the cross guards in trade/page.tsx handleSetStopLoss/handleSetTakeProfit, drop the trailingEligiblePositions filter + submit guard in OrderPanel, remove marginMode from canAttachTpSl (coordinate with L1-2), enable SL/TP buttons on cross rows in PositionsList
- [ ] `npx tsc --noEmit`

**keeper**
- [ ] No functional change (simulate-first adopts cross triggers automatically); update the #80 quiet-bucket comment in index.ts:1057 to note the code now only fires on pre-redeploy stacks

**indexer**
- [ ] No change (position_closed tuple unchanged); add one fixture test asserting a cross trigger execution projects a position delete via the existing position_closed handler

**docs**
- [ ] docs-site trading-mechanics: stops/take-profits/trailing supported in both margin modes; note the keeper-fee source difference (isolated: from position collateral; cross: from pool proceeds)
- [ ] Update CLAUDE.md pitfalls and KNOWN_ISSUES to retire the no-stops-in-cross entry after the prod redeploy

**Acceptance:**
- `cargo test -p market` passes with the seven named new/flipped tests listed in the implementation
- On staging post-deploy: `set_stop_loss` on a live cross position returns an Order (no #80); keeper executes it and get_cross_margin_balance(trader) increases by exactly collateral+pnl−funding−keeper_fee (7-dec)
- Trader wallet USDC balance is unchanged by a cross trigger execution (proceeds land in the pool only)
- Sibling attached orders cancel on cross trigger execution (order_cancelled reason=pos_closed observed in /v1/events)
- Web shows enabled SL/TP/trailing controls on cross rows; the interim warning copy is live on staging before the redeploy
- Keeper cycle log shows an executed cross trigger with no #80 skip entries

**Risks:** Pool-conservation bugs are the M-3 failure mode reborn — the conservation property test is mandatory, and this is "supervise closely" territory per CLAUDE.md. WASM: +1-2 KB against 70,044 B / 128 KB — safe, but the close_position_cross refactor must not duplicate the settlement body. Event format: reusing position_closed keeps the CLAUDE.md table/indexer/web parsers untouched — do NOT add a cross-specific event variant. Keeper fee is now paid from pool proceeds (uncapped by per-position collateral silo semantics) — capped in the design, but document the trader-visible difference. Coupled-redeploy ordering: the web ungate must deploy AFTER the contract (stage the web change behind the market-address check or merge order); shipping the ungate against the old market yields raw #80 toasts.

### L1-2 · Atomic bracket placement (router open_with_price_and_tpsl — G-1)

**Status:** todo · **Effort:** M · **Lane:** mixed · **Ships in:** batch-1-redeploy · **Needs:** L0-21, L1-1, L0-10 · **Blocks:** L0-18
**Cross-refs:** TASKS G-1 · TASKS P4-17 · TASKS P4-18 · AUDIT W-6 · LIGHTER-GAP §Order types & execution (atomic bracket placement) · **Gap rows:** Order types & execution: Atomic bracket placement (TP/SL attached at open under one signature)

**Current state (verified):** STAGING (web): P4-17 pipelines TP/SL as SEPARATE best-effort follow-up signatures after the open confirms — attachTpSlAfterOpen at web/components/trading/OrderPanel.tsx:366-411 (call site :567-569), explicitly documented as "never unwinds the open"; a rejected/failed follow-up leaves the position live and unprotected, and a full bracket costs up to 3 wallet prompts. It is gated to Market+Isolated (canAttachTpSl :132) with B8 pre-validation of trigger sides against the live mark (:342-360). The router (PROD+STAGING) has open_with_price (contracts/noether_router/src/lib.rs:172-198) with publisher allowlist + Stork guard + coarse price bands, and an upgrade(wasm_hash) path (:478); no tpsl variant exists — G-1 is backlog (TASKS.md:217). packages/tx-builders has the router builder family (openWithPrice/closeWithPrice/liquidateWithPrice/executeWithPrice + PriceAttestation, src/router/*), but the gateway prepare builds only DIRECT market ops (api/src/routes/orders.ts:345-429) and the api has no Noeracle attestation fetch (grep-verified) — the P4-18 "gateway half" is pending. Compounding defect on the fallback path: buildSetTakeProfitTx sends 4 args vs the deployed set_take_profit's 5 (limit_price i128; packages/tx-builders/src/market/stopTakeProfit.ts:33-45 vs contracts/market/src/lib.rs:1439-1446) — the L0-21 arity break.

**Design:** New router entrypoint (contracts/noether_router/src/lib.rs; `#![allow(clippy::too_many_arguments)]` already set at :47-48):

`pub fn open_with_price_and_tpsl(env, trader: Address, asset: Symbol, collateral: i128, leverage: u32, direction: Direction, price: i128, timestamp: u64, round_id: u64, pubkeys: Vec<BytesN<32>>, sigs: Vec<BytesN<64>>, sl_trigger_price: i128, sl_slippage_bps: u32, tp_trigger_price: i128, tp_slippage_bps: u32, tp_limit_price: i128) -> Result<Position, NoetherError>`

Arg order = open_with_price's 11 args verbatim + a 5-arg tpsl tail. Optionality via zero-sentinels matching the market's own convention (limit_price==0 = market TP, order_ref_price lib.rs:1784): sl_trigger_price==0 → no SL; tp_trigger_price==0 → no TP; tp_limit_price>0 → Take Limit. Prices 7-dec i128; slippage 1-10000 bps (validated by the market, #66). Flow: require_initialized → trader.require_auth() → refresh_price(...) → stork_guard(...) → pos = invoke market.open_position(trader, asset, collateral, leverage, direction) → if sl_trigger_price>0: invoke market.set_stop_loss(trader, pos.id, sl_trigger_price, sl_slippage_bps) → if tp_trigger_price>0: invoke market.set_take_profit(trader, pos.id, tp_trigger_price, tp_slippage_bps, tp_limit_price) → Ok(pos). Any sub-call Err traps and reverts the WHOLE tx — all-or-nothing under one signature (decided semantics: if the mark moved through the SL between quote and inclusion, the user gets no position rather than an unprotected one; #65 InvalidTriggerPrice surfaces via decodeContractError, and the window is bounded once L0-10 acceptablePrice rides the same batch). Auth is the existing pattern: the trader signs the full auth tree (router → market.open_position → USDC transfer, now + set_stop_loss + set_take_profit), the same mechanism the router docstring (:15-22) relies on today. No new router storage, events, or errors; market contract untouched (isolated brackets work against the CURRENT market; cross brackets additionally require L1-1's #80 lift, same batch).

tx-builders: new src/router/openWithPriceAndTpsl.ts exporting buildOpenWithPriceAndTpslArgs/Op/Tx with params `{trader, asset, collateral: bigint, leverage: number, direction, attestation: PriceAttestation, sl?: {triggerPrice: bigint, slippageToleranceBps: number}, tp?: {triggerPrice: bigint, slippageToleranceBps: number, limitPrice?: bigint}}` encoding absent groups as zeros, reusing attestationTailArgs (src/router/attestation.ts:24).

api: new prepare op `open_position_tpsl` — body {op, asset, collateral, leverage, direction, sl?, tp?}; requires the router address resolved (contracts.json noetherRouter / CONTRACT_NOETHER_ROUTER override) else 400 {error:'router_unavailable'}; the gateway fetches one fresh signed attestation server-side from the Noeracle HTTP endpoint (new NOERACLE_HTTP_URL config; same source as web fetchAttestation, web/lib/stellar/noeracle.ts:39) and builds via the new builder; the OpenAPI description states the ~60s attestation-staleness budget between prepare and submit (Noeracle S-1 bound). This lands the P4-18 gateway-half pattern for one op.

web: when routerContract is set AND canAttachTpSl AND (SL or TP entered), OrderPanel submits ONE router bracket tx (new bracket variant beside openPosition in web/lib/stellar/market.ts:67-120, appending the tpsl tail to priceTailArgs); the P4-17 pipelined path is KEPT verbatim as the non-router fallback (router unset, leader mode). Cross brackets: OrderPanel's marginMode gate drops together with L1-1's ungate.

**Implementation**

**contracts/noether_router**
- [ ] Add open_with_price_and_tpsl per the design signature (zero-sentinel tpsl tail, chained market invocations, all-or-nothing)
- [ ] Tests (mock market records calls): bracket_opens_and_attaches_both (relayed price + open + SL + TP order links); bracket_sl_only; bracket_tp_limit_variant (tp_limit_price>0 forwarded as 5th set_take_profit arg); bracket_all_zero_tail_degenerates_to_open; bracket_subcall_failure_reverts_everything (mock set_stop_loss panics → no position persisted); publisher-allowlist + price-band rejects still apply to the new op
- [ ] `cargo test -p noether_router`; rebuild WASM (baseline 33,702 B)

**packages/tx-builders**
- [ ] Add src/router/openWithPriceAndTpsl.ts (Args/Op/Tx) with optional sl/tp groups → zero-sentinel ScVals; export from router/index.ts
- [ ] XDR snapshot test pinning the 16-arg encoding, plus a simulation-shape assertion per the L0-21 CI pattern so arity drift fails loud
- [ ] `npm run build:packages && npm -w @noether/tx-builders test`

**api**
- [ ] Add NOERACLE_HTTP_URL to config.ts and an attestation fetch helper (mirror web/lib/stellar/noeracle.ts:39 fetchAttestation shape)
- [ ] Add `open_position_tpsl` to the prepare oneOf (orders.ts:93-178) + dispatch case calling buildOpenWithPriceAndTpslTx with the server-fetched attestation; 400 router_unavailable when no router address resolves
- [ ] Document the 60s attestation-staleness budget in the op's OpenAPI description
- [ ] Vitest: prepare returns {op,trader,xdr} with trader==key owner; router-unset returns 400; attestation-fetch failure returns 502 rpc_error

**sdk-ts**
- [ ] Add OpenPositionTpslRequest to the PrepareRequest union + serialiseRequest case (sdk-ts/src/sub/orders.ts:59-66, :123-178)
- [ ] Unit test the serialised body shape

**sdk-py**
- [ ] Extend serialise_request rename map for nested sl/tp keys (orders.py:24-32) and add a typed example + test; ships with the L1-14 0.1.2 publish

**web**
- [ ] Add the bracket open path in web/lib/stellar/market.ts (router op with tpsl tail appended to priceTailArgs); wire OrderPanel handleSubmit to use it when the router is configured, keeping attachTpSlAfterOpen as fallback
- [ ] Success toast "Position opened with SL/TP — one signature"; revert toast maps #65/#66 via decodeContractError
- [ ] `npx tsc --noEmit`; manual Freighter + LOBSTR signing check of the enlarged auth tree on staging

**docs**
- [ ] docs-site API reference: open_position_tpsl op + staleness budget; trading-mechanics: bracket semantics are all-or-nothing (position never opens unprotected)

**ops**
- [ ] Router upgrade via upgrade(wasm_hash) rides the Batch-1 rollout (surface frozen for the audit together with market+vault); set NOERACLE_HTTP_URL on the Azure gateway env

**Acceptance:**
- Router tests named in the implementation pass; bracket_subcall_failure_reverts_everything proves no position row and no orders exist after a failed attach
- On staging: one wallet prompt produces a position plus its SL and TP visible in GET /v1/orders/open?trader= within one indexer poll
- POST /v1/orders/prepare {op:'open_position_tpsl',...} returns simulable XDR (simulateTransaction SUCCESS) against the deployed router
- tx-builders XDR snapshot for the 16-arg encoding is pinned and green
- Fallback intact: with NEXT_PUBLIC_NOETHER_ROUTER_ID unset, OrderPanel still runs the P4-17 pipelined flow
- sdk-ts and sdk-py can express the op (tests pass); OpenAPI /docs lists it

**Risks:** Wallet auth-tree growth: the trader now signs router→open_position→token.transfer→set_stop_loss→set_take_profit sub-invocations — verify Freighter and LOBSTR render/sign it (LON already unsupported); a wallet that truncates auth entries makes the bracket fail-closed (txBadAuth), never half-applied. All-or-nothing means a fast market can revert the OPEN itself — deliberate, documented, and bounded once L0-10 ships in the same batch. Attestation staleness between prepare and user signature (~60s) causes clean reverts — retry UX needed, not a safety issue. The router surface change must land before the audit freeze (Batch-1 scope). The fallback pipelined path stays load-bearing — do not delete P4-17. Needs L1-1 only for the cross-bracket surface; isolated brackets are independent.

### L1-3 · Auto-net at open (minimum-viable position netting)

**Status:** todo · **Effort:** M · **Lane:** mixed · **Ships in:** batch-1-redeploy · **Needs:** L0-6, L1-1 · **Blocks:** L0-18
**Cross-refs:** AUDIT M-6 · TASKS P1-7 · TASKS P5-9 · LIGHTER-GAP §Margin & collateral (position netting and average-entry accounting) · **Gap rows:** Margin & collateral: Position netting and average-entry accounting per market

**Current state (verified):** PROD+STAGING: every open creates a fresh Position row (do_open, contracts/market/src/lib.rs:384-397) and nothing nets — opposite-direction positions in one asset coexist. Cross maintenance margin and used margin are charged on gross Σ|size| per position regardless of direction (contracts/market/src/position.rs:79-84), funding accrues per position (signs offset but both legs move equity via position.rs:73-78), and every open reserves its full notional against the vault OI caps (reserve_with_vault lib.rs:2304-2318, error #82) — so a hedged pair consumes 2x OI capacity and a net-flat cross account can still be liquidated as fees+funding erode equity against the gross MM (position.rs:123-141). The only offset mechanism is keeper-path reduce-only, which FULL-closes the largest fitting opposing isolated position (M-6 fix, lib.rs:2408-2451) — full-close-or-cancel, isolated-only. CODE-COMPLETE: close_position_partial(trader, position_id, close_size) + settle_and_close_partial + the position_reduced event exist only on origin/feat/audit-phase0-1-security commit 23b2a02 (P5-9), isolated-only, and were written against pre-refactor helpers (close_isolated_position, get_oracle_close_price) that no longer exist on staging — L0-6 is a port, not a cherry-pick. No UI warning fires when opening against an existing opposite position (OrderPanel validation block :330-361 has no such check).

**Design:** Netting phase inside do_open (lib.rs:292), after validation, BEFORE reserve_with_vault (ordering matters: reductions release reservations via adjust_oi first, so the remainder's reservation cannot false-trip #82). Algorithm:

1. Requested size S = collateral × leverage (7-dec).
2. Candidates = the trader's open positions with asset == open.asset AND direction != open.direction AND margin_mode == the open's mode, from TraderPositions / CrossMarginPositions — netting NEVER crosses margin modes (an isolated hedge of a cross position is a deliberate strategy and stays untouched).
3. If gross opposite G >= S: reject up-front with NEW error #85 NetsToZero — no state mutated; every successful open still yields exactly one new row, and pure reductions/flips go through close paths (an Err after reductions would roll them back anyway on Soroban). Flip-through-zero in one tx is an explicit v1 non-goal.
4. Else reduce candidates largest-first: legs with size <= remaining are FULL-closed via the shared settlement (settle_isolated_close / L1-1's settle_cross_close, keeper_fee=0, emitting the standard position_closed 8-tuple); the final leg needing a partial reduction goes through the L0-6 core settle_and_close_partial, emitting position_reduced (position_id, trader, asset, close_size, remaining_size, current_price, pnl); if that leg's residual would fall under min_collateral (10 USDC = 100_000_000), extend it to a full close instead (P5-9 dust rule inverted to keep netting total-preserving). ALL legs settle at the SAME strict entry price the open uses — hoist the strict get_oracle_price(asset, true) read (currently lib.rs:355) above the loop; one price per tx.
5. Leg cap: `const MAX_NET_LEGS: u32 = 4`; more opposing rows → reject #85 (each leg costs vault cross-calls settle_pnl + receive_loss + sync_exposure — CPU budget).
6. Open the remainder R = S − G_consumed with collateral_new = collateral × R / S (round down), leverage unchanged; isolated pulls only collateral_new from the wallet, cross deducts collateral_new from the pool; taker fee via calculate_fee_and_record_volume on R only — fee parity with manual close-then-open, since closes charge no trading fee (settle_isolated_close only records volume, lib.rs:2193); vault reservation on R only. position_opened event unchanged.
7. Cross bucket: the partial leg needs a margin_mode==1 branch in the ported settle_and_close_partial, built on L1-1's settle_cross_close pro-rata (closed collateral share + closed-pnl share → pool) — hence needs L1-1.
8. Behavior is always-on (no config field, no migrate_config); MAX_NET_LEGS is a compile-time constant.
9. Interim, ships offchain-now: OrderPanel warning when the submitted direction opposes an existing same-asset same-mode position ("You already hold an opposite position — this creates a hedged pair paying margin and funding on both legs"), plus a docs-site gross-margining section stating today's semantics loudly.
10. Recorded non-goal: full single-position-per-market netting with blended average entry (avgEntry_new = (avgEntry_old × pos_old + fill × tradeSize)/pos_new) is deferred — it refactors Position storage, events, indexer projections and the leaderboard; revisit post-launch as an L2 candidate.

**Implementation**

**contracts/market**
- [ ] Port the L0-6 partial core onto staging first (needs: settle_and_close_partial adapted to settle_isolated_close-era helpers) — coordinate, do not duplicate, with the L0-6 item
- [ ] Add the cross partial branch to settle_and_close_partial using L1-1's settle_cross_close pro-rata
- [ ] Implement the netting phase in do_open per design (candidate scan, largest-first, #85 up-front rejects, MAX_NET_LEGS=4, remainder collateral scaling, fee on remainder, hoisted strict price read, release-before-reserve ordering)
- [ ] Add NoetherError::NetsToZero = 85 to noether_common/src/errors.rs (enum currently ends at #83; L0-6 takes PositionTooSmall=27)
- [ ] Tests: net_open_reduces_largest_first_then_opens_remainder; net_open_rejects_full_net_85 (no state change proven); net_open_partial_leg_emits_position_reduced; net_open_dust_residual_becomes_full_close; net_open_cross_proceeds_to_pool; net_open_rejects_above_max_legs; net_open_releases_reservation_before_reserving_remainder (no #82 false trip at the cap boundary); net_open_fee_charged_on_remainder_only; cross_mm_drops_after_net (used_margin/MM aggregates shrink)
- [ ] `cargo test -p market`; WASM size check vs 128 KB after the netting loop + partial-core port

**web**
- [ ] NOW (offchain-now slice): opposite-position warning in OrderPanel validation (compare direction vs positions[] same asset+mode) + confirm-toast copy
- [ ] WITH the redeploy: replace the warning with a netting preview ("reduces #12 by $X, opens $Y remainder") derived from the same client-side scan; handle #85 with a friendly "this order only reduces — use Close or reduce-only" message in decodeContractError
- [ ] `npx tsc --noEmit`

**indexer**
- [ ] No decoder/handler changes (consumes existing position_closed / position_reduced / position_opened; the position_reduced row-shrink handler pattern exists at indexer/src/handlers/market.ts:175-180 for position_partial_liq and ships with L0-6)
- [ ] Add a multi-event-per-tx fixture test: one net-open tx emitting close + reduce + open leaves the positions projection exactly right (exercises I-2 idempotency ordering)

**docs**
- [ ] docs-site trading-mechanics: gross-margining today (interim), auto-net semantics after the redeploy (largest-first, #85 rule, MAX_NET_LEGS, fee-on-remainder), and the explicit non-goals (no blended average entry, no one-tx flip)

**sdk-ts**
- [ ] No API change (open ops unchanged); add a docs note that open_position(_cross) may reduce opposing positions and error #85 exists

**Acceptance:**
- All nine named market tests pass; `cargo test -p market` green; optimized market.wasm under 128 KB with the delta recorded
- On staging: open 100 USDC 5x LONG BTC (size 500) then submit 150 USDC 5x SHORT BTC (size 750) → position_closed on the long + exactly one new SHORT position of size 250×PRECISION remains, verified via get_all_position_ids + get_position
- Submitting an open with S <= G returns error #85 and mutates nothing (positions and balances unchanged)
- GET /v1/positions/open reflects the netted state after one indexer poll; the multi-event fixture test passes
- OrderPanel shows the opposite-position warning on staging BEFORE the redeploy (interim slice verifiable now)
- Vault reservation accounting: reserved payout after a net-open equals the remainder's notional only (vault view / #82 boundary test)

**Risks:** CPU budget is the real constraint: 4 netting legs × 3 vault cross-calls each + the open — measure on testnet before freezing MAX_NET_LEGS; if tight, drop to 2. WASM +2-3 KB on top of the L0-6 port — check after every step (70,044 B baseline). Event formats unchanged but multi-event transactions stress indexer idempotency and event ordering — the fixture test is mandatory. UX surprise cuts both ways: users who WANT hedges must now split margin modes (document loudly); users expecting one-click flips hit #85 (map the error to guidance). Settlement pricing: legs settle at the strict open price — if the strict read rejects (#30/#81), the whole net-open fails; that is correct (risk-increasing path) but differs from plain closes' lenient path — document. Coupled-redeploy: depends on the L0-6 port and the L1-1 helper landing in the same market WASM; sequence contract merges L0-6 → L1-1 → L1-3.

### L1-4 · Cross-collateral operations via API/SDK

**Status:** todo · **Effort:** S · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** L0-21 · **Blocks:** L1-14
**Cross-refs:** TASKS P4-23 · TASKS P4-18 · KNOWN_ISSUES G-1 · LIGHTER-GAP §Margin & collateral (cross-collateral operations unreachable via API/SDK) · **Gap rows:** Margin & collateral: Cross-collateral operations unreachable via API/SDK

**Current state (verified):** PROD (contract): deposit_cross_margin(trader, amount) and withdraw_cross_margin(trader, amount) are deployed trader-authed entrypoints (contracts/market/src/lib.rs:787-815 and :819-876; withdraw gated on equity_after > MM at :854-857) and the web wires both (web/lib/stellar/market.ts:1285, :1303; OrderPanel deposit/withdraw UI state OrderPanel.tsx:106-109). But packages/tx-builders/src/market/cross.ts contains ONLY buildOpenPositionCrossTx (:13) and buildClosePositionCrossTx (:33); the /v1/orders/prepare oneOf covers 10 ops with no collateral op (api/src/routes/orders.ts:28-78, :93-178; trader hard-bound to the key owner at :318); sdk-ts's PrepareRequest union mirrors the same 10 (sdk-ts/src/sub/orders.ts:59-66) and sdk-py's prepare is an untyped dict passthrough (sdk-py/noether_sdk/sub/orders.py:62-76). Net: a bot can open cross positions via the API but cannot top up or withdraw the pool backing them — it cannot defend its own account from liquidation without a human in a browser.

**Design:** Pure off-chain plumbing over deployed entrypoints — zero contract work.

tx-builders (packages/tx-builders/src/market/cross.ts, the repo's single source of truth for tx assembly): add `export interface DepositCrossMarginParams { trader: StellarAddress; amount: bigint; }` (USDC, 7-dec i128) with `buildDepositCrossMarginTx(ctx, marketContractId, params)` → buildContractTx(ctx, params.trader, marketContractId, 'deposit_cross_margin', [toScVal(trader,'address'), toScVal(amount,'i128')]); and `WithdrawCrossMarginParams { trader: StellarAddress; amount: bigint; }` with `buildWithdrawCrossMarginTx(...)` → 'withdraw_cross_margin', same 2-arg encoding.

api (/v1/orders/prepare): two new oneOf branches `{ op: 'deposit_cross_margin' | 'withdraw_cross_margin', amount: string|number }` with amount validated positive; dispatch cases call the new builders with BigInt(amount); trader stays the authenticated owner. Classification per the KNOWN_ISSUES G-1 lesson: these are owner-bound value-moving SIGNING ops, so the authed prepare endpoint is correct (the wallet still signs; nothing custodial) — they are NOT public analytics. Simulation failures (e.g. withdraw beyond the free-margin gate, #77) surface through the existing mapPrepareError 400 simulation_failed path (orders.ts:437-444).

sdk-ts: DepositCrossMarginRequest / WithdrawCrossMarginRequest added to the PrepareRequest union + serialiseRequest cases (amount via stringifyBig). sdk-py: the dict passthrough already transmits `{'op': 'deposit_cross_margin', 'amount': ...}` unmodified — add typed docstrings, a model-level example, and tests; ships in the 0.1.2 publish (L1-14).

Testing follows the L0-21 lesson: besides XDR snapshots, assert both builders SIMULATE successfully against the deployed contract interface (P4-23-style snapshots alone pinned the stale arity bugs and kept CI green). Product pairing (documented, not a hard dependency): the bot defend-loop reads GET /v1/account/margin (L1-6) → below threshold → prepare deposit_cross_margin → sign → POST /v1/tx/submit.

**Implementation**

**packages/tx-builders**
- [ ] Add buildDepositCrossMarginTx + buildWithdrawCrossMarginTx to src/market/cross.ts; export from market/index.ts
- [ ] XDR snapshot tests for both (2-arg address+i128 encoding) plus an arity/simulation assertion per the L0-21 CI pattern
- [ ] `npm run build:packages && npm -w @noether/tx-builders test`

**api**
- [ ] Add the two ops to PREPARE_BODY_SCHEMA oneOf and the PrepareBody union (orders.ts:28-178); dispatch cases calling the new builders
- [ ] Vitest: prepare {op:'deposit_cross_margin', amount:'100000000'} returns {op, trader==owner, xdr}; negative/zero amount → 400; withdraw simulation failure maps to 400 simulation_failed
- [ ] Confirm OpenAPI /docs renders both ops

**sdk-ts**
- [ ] Add both request interfaces to the PrepareRequest union + serialiseRequest cases (sub/orders.ts); unit tests for the serialised bodies

**sdk-py**
- [ ] Docstring + README example for both ops through prepare; test that serialise_request passes 'amount' through as a decimal string; include in the 0.1.2 publish (L1-14)

**docs**
- [ ] docs-site API reference: document both ops with the defend-loop example (margin read → deposit → submit), noting the withdraw gate (#77) and that L1-5 will tighten it from MM to IM in Redeploy Batch 1

**Acceptance:**
- tx-builders tests pass including the simulation-shape assertion (both ops simulate SUCCESS against the deployed market interface)
- POST /v1/orders/prepare with op deposit_cross_margin and op withdraw_cross_margin each return signable XDR bound to the authenticated owner (api vitest)
- e2e (P4-24 harness) against staging: prepare→sign→submit a 10 USDC (100_000_000) deposit then withdrawal; get_cross_margin_balance reflects + then − exactly
- sdk-ts and sdk-py tests for the new ops pass; OpenAPI /docs lists both
- A withdraw that would breach the free-margin gate returns HTTP 400 simulation_failed with the #77 detail, not a 502

**Risks:** No contract or migration risk (deployed entrypoints, zero redeploy). Coordinate the same-file-set L0-21 arity fixes and this addition into one tx-builders release so the L1-14 0.1.2 publish carries both — publishing cross ops while limit/stop-limit/take-profit builders stay broken is an integrator trap. Keep the ops on the AUTHED prepare path (owner-bound signing ops), not the public surface. Behavior-change heads-up: L1-5 (batch-1) tightens the withdraw gate MM→IM — bots written against "withdraw to just above MM" will start receiving #77 earlier; release-note it in the SDK changelogs.

### L1-5 · Account initial-margin band (withdraw/open gate above MM)

**Status:** todo · **Effort:** S · **Lane:** contracts · **Ships in:** batch-1-redeploy · **Needs:** — · **Blocks:** L0-18
**Cross-refs:** TASKS P5-1 · TASKS P5-2 · LIGHTER-GAP §Margin & collateral (single maintenance threshold does triple duty) · **Gap rows:** Margin & collateral: Single maintenance threshold does triple duty — no initial-margin regime or pre-liquidation de-risk band

**Current state (verified):** PROD+STAGING: the flat 1% maintenance margin (MarketConfig.maintenance_margin_bps=100, contracts/noether_common/src/types.rs:205) does triple duty — (a) cross open gate: do_open's cross branch requires equity >= MM_agg + new collateral (contracts/market/src/lib.rs:333-348, error #77), (b) withdrawal gate: withdraw_cross_margin requires equity_after > MM_agg (lib.rs:841-858, #77), (c) liquidation trigger: is_cross_account_liquidatable fires at equity < MM_agg (contracts/market/src/position.rs:123-141; isolated analog should_liquidate_with_funding lib.rs:2018-2030). A user can therefore withdraw to 1.0001x MM and one funding accrual or 0.1% wick liquidates them — into a cross liquidation that today confiscates residual equity to the vault (lib.rs:1097-1112; fixed by L0-4/L0-5). The single-pass aggregate already computes used_margin = Σ size_i/leverage_i price-free in the same loop (position.rs:82-84), and the removed CrossMarginInfo view documents free_margin = equity − used_margin (types.rs:97-100) — the IM quantity exists, it is just never enforced.

**Design:** Definition: account IM_agg = Σ size_i / leverage_i over the trader's cross positions (i128, 7-dec) — identically Σ collateral-at-open, and with leverage clamped to 1-10 (types.rs:76, lib.rs:311) per-position IM is 10-100% of size, so IM_agg > MM_agg (1% of size) structurally; when L0-12's per-asset ladder lands, RiskConfig's MM=IM/2 invariant (TASKS P5-2) preserves IM>MM at every tier — add a test tying the two. Changes, all in contracts/market:

1. New helper `position::calculate_cross_used_margin(env, trader) -> i128` wrapping aggregate_cross_positions with the no-price closure (exact pattern of calculate_cross_maintenance_margin, position.rs:112-120) returning agg.used_margin — price-free, so oracle failures cannot fake headroom.
2. withdraw_cross_margin gate (lib.rs:855): replace `equity_after <= maintenance_margin` with `equity_after < used_margin_agg` (strictly-less: withdrawing exactly TO the IM boundary is allowed); keep the conservative unknown-price=0 equity pricing (lib.rs:845-847); drop the now-dominated MM comparison.
3. do_open cross branch (lib.rs:345): replace `equity < mm + collateral` with `equity < used_margin_agg + collateral` — the new position's own IM equals its collateral (size/leverage == collateral), so the gate reads "post-open equity covers post-open IM_agg". With L1-3 auto-net in the same batch, opposite-direction opens reduce first and only the risk-increasing remainder faces this gate.
4. Error code: reuse #77 CrossMarginInsufficientFreeMargin (errors.rs:123) — same semantic, no new code, no client decode changes.
5. MM stays STRICTLY the liquidation trigger (position.rs:123-141, lib.rs:2018-2030 untouched) — the IM→MM span (10% vs 1% of size at 10x) is the protocol-defined de-risk band that L1-7's margin-call state will key off.
6. Deliberate non-goal, recorded: no third CMR/close-out tier — Lighter needs one because on-book liquidation takes time; Noether's oracle-fill liquidation is instant and partial-vs-full already keys off bankruptcy (lib.rs:516) plus L0-5's close-out tier for cross.
7. Isolated: no change here — isolated has no withdraw entrypoint; L0-6's remove_collateral must enforce the same per-position rule (post-removal collateral >= size/leverage, i.e. residual >= IM share) — cross-noted to L0-6.
8. No config fields, no storage keys, no events, no migrate_config.

Web: CrossMarginBanner free-margin tooltip/copy updated (with L1-6's aligned usedMargin, freeMargin becomes exactly the enforced headroom): "Free margin = equity − initial margin (Σ size/leverage). Withdrawals and new positions must keep it ≥ 0; liquidation triggers at the 1% maintenance level."

**Implementation**

**contracts/market**
- [ ] Add position::calculate_cross_used_margin (no-price aggregate wrapper)
- [ ] Swap the withdraw gate at lib.rs:855 to equity_after < used_margin_agg; delete the dominated MM check
- [ ] Swap the cross open gate at lib.rs:345 to equity < used_margin_agg + collateral
- [ ] Tests: withdraw_to_im_boundary_allowed; withdraw_below_im_rejected_77; open_rejected_when_free_margin_below_new_collateral; open_allowed_at_exact_im; liquidation_still_at_mm_not_im (account seeded between MM and IM: withdraw blocked with #77 AND liquidate_cross_account returns #78 CrossMarginNotLiquidatable); oracle_failure_still_blocks_withdraw (prices → 0 equity); im_exceeds_mm_for_all_leverages (1..=10, and against each RiskConfig preset for L0-12 forward-compat)
- [ ] `cargo test -p market`; WASM delta check (expected ~+0.2 KB)

**web**
- [ ] CrossMarginBanner copy/tooltip per design (rides the same release as the contract to avoid describing unenforced rules)
- [ ] decodeContractError message for #77 updated to mention the initial-margin requirement
- [ ] `npx tsc --noEmit`

**docs**
- [ ] docs-site margin page: IM vs MM band definition, the withdraw/open rule, and the recorded no-CMR-tier decision (publish jointly with L1-6's formula table)

**sdk-ts**
- [ ] CHANGELOG/release-note entry: withdraw_cross_margin and open_position_cross gates tightened MM→IM in Redeploy Batch 1 (affects bots asserting old boundaries)

**Acceptance:**
- All seven named market tests pass; `cargo test -p market` green
- On staging post-redeploy, a scripted scenario proves the band: with equity between MM_agg and IM_agg, withdraw_cross_margin returns #77 while liquidate_cross_account returns #78 (not liquidatable)
- Withdrawing exactly to equity_after == IM_agg succeeds on-chain (7-dec boundary check)
- A cross open whose collateral exceeds equity − IM_agg is rejected with #77 at simulation time via /v1/orders/prepare (400 simulation_failed)
- CrossMarginBanner renders the new free-margin definition copy; GET /v1/account/margin freeMargin (L1-6) matches the enforced headroom on a fixture account

**Risks:** Behavior change for existing bots/tests that assume the MM-gate boundary — release-note in both SDK changelogs (coordinated with L1-4's docs). The IM>MM invariant must survive L0-12's per-asset ladder — the RiskConfig MM=IM/2 rule guarantees it, and the forward-compat test pins it; if a future config ever allowed leverage where 1/leverage < mm_bps/10000, the gates would invert (the test catches this). Keeper parity: none needed — the keeper keys liquidation off MM-based simulation, untouched. Coupled-redeploy ordering: banner copy and error text must ship with (not before) the contract. WASM impact negligible.

### L1-6 · Canonical margin formula + GET /v1/account/margin

**Status:** todo · **Effort:** M · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** — · **Blocks:** L1-7, L1-14
**Cross-refs:** TASKS P4-5 · TASKS P0-12 · KNOWN_ISSUES G-1 · LIGHTER-GAP §Margin & collateral (canonical account-value/free-margin definition + server-side margin endpoint) · **Gap rows:** Margin & collateral: Canonical account-value/free-margin definition + server-side margin endpoint

**Current state (verified):** Three divergent free-margin definitions verified on STAGING (and PROD): the contract open gate uses equity >= MM_agg + new collateral (contracts/market/src/lib.rs:333-348); the contract aggregate defines used_margin = Σ size/leverage (contracts/market/src/position.rs:82-84) and the REMOVED CrossMarginInfo view documents free = equity − used with margin_ratio_bps = equity/used_margin × 10000 (contracts/noether_common/src/types.rs:89-105); the shipped web computes usedMargin = totalCollateral (web/components/trading/CrossMarginBanner.tsx:65) — which differs from Σ size/leverage by at least the open fee (collateral is stored net of fee, lib.rs:359,388) — and renders marginRatio = equity/maintenanceMargin (:67-68), a DIFFERENT denominator than the dead view's. Portfolio AccountHealth additionally omits pending funding from equity (web/components/portfolio/AccountHealth.tsx:65-70) while the banner subtracts it (CrossMarginBanner.tsx:56-63). No gateway endpoint returns any of this (api/src/routes/account.ts serves only me/events/positions/orders), the indexer positions projection stores no collateral/leverage/margin_mode/entry_cumulative_funding (indexer/migrations/001_baseline.sql:112-122), and the market exposes NO public funding-index view (public surface is exactly get_position / get_all_position_ids / get_cross_margin_balance / get_cross_margin_positions / get_order / get_all_order_ids; CumulativeFundingRate is persistent storage only, contracts/market/src/storage.rs:239-246).

**Design:** Pick contract truth and publish ONE formula set (all i128, 7-dec PRECISION=10_000_000): equity = pool_balance + Σ collateral_i + Σ uPnL_i − Σ pendingFunding_i (position.rs:97-109); uPnL_i = size × (P−E)/E for Long, size × (E−P)/E for Short (noether_common math calculate_pnl); pendingFunding_i = size × (cumIndex − entryCumIndex)/PRECISION, positive for Long / negated for Short (math.rs:212-227); usedMargin = Σ size_i/leverage_i; maintenanceMargin = Σ size_i × mm_bps/10000 with mm_bps=100 (position.rs:80-81, types.rs:205); freeMargin = equity − usedMargin; marginRatioBps = equity × 10000 / maintenanceMargin, liquidation when < 10000. DECISION recorded: the ratio denominator is maintenanceMargin (matches position.rs:140 and both shipped surfaces), superseding the dead CrossMarginInfo comment's equity/used_margin ratio — docs note the supersession.

Endpoint: GET /v1/account/margin?address=G... — PUBLIC (derivable from public chain state; precedent GET /v1/account/volume?address= from P4-5; classification per the KNOWN_ISSUES G-1 lesson). Response 200: `{ address, asOf: unixSeconds, poolBalance: string, equity: string|null, usedMargin: string, maintenanceMargin: string, freeMargin: string|null, pendingFunding: string|null, marginRatioBps: number|null, positionCount: number, priceAgeSeconds: number|null }` — every money field a 7-dec decimal string. Null semantics (money-truth rule): if ANY position's mark is missing or older than 60s, equity/freeMargin/pendingFunding/marginRatioBps are null — never fabricated; usedMargin and maintenanceMargin are price-free and ALWAYS present.

Computation (new api/src/services/margin.ts, TtlCache 3-5s per address): (1) ids = ContractReader.read('get_cross_margin_positions',[addr]) and poolBalance = read('get_cross_margin_balance') — chain truth, no indexer lag (ContractReader api/src/services/contractReader.ts:39-93); (2) hydrate get_position per id in parallel (bounded concurrency 10) — required because the projection lacks collateral/leverage/entry_cumulative_funding; (3) cumIndex via getLedgerEntries on the market's persistent entry with key ScVal = ScVec([ScSymbol('CumulativeFundingRate')]) (unit variant of the data-bearing DataKey contracttype enum, storage.rs DataKey), absent → 0 — the key encoding MUST be pinned by a live-testnet fixture test before merge; if the encoding assumption fails, fall back to shipping a get_funding_state() view in batch-1 (owned by L1-11) and gate pendingFunding on it; (4) marks + ages from the gateway oracle price cache (oracleTicker service); (5) all arithmetic in BigInt, formulas ported from noether_common — never re-derived. mm_bps=100 lives once in packages/shared with a loud comment that L0-12 makes it per-asset (the endpoint then reads risk.get_config).

SDKs: sdk-ts account.margin(address?) (defaults to the authed owner when credentials exist, else address required) and sdk-py account.margin(address) returning a MarginInfo model — ride the L1-14 0.1.2 publish. Web alignment: CrossMarginBanner usedMargin → Σ p.size/p.leverage (DisplayPosition carries leverage); AccountHealth subtracts pendingFunding so both surfaces render identical equity; optionally consume /v1/account/margin behind gatewayServesThisMarket() (web/lib/api/gateway.ts:35) with client-side compute as fallback — same trust pattern as the P-1 mitigation. Docs: docs-site "Margin & liquidation" page with the formula table, a worked example (100 USDC collateral, 5x long, +2% move: uPnL = 500 × 0.02 = 10 USDC etc.), null semantics, and forward notes that L1-5 (batch-1) makes freeMargin >= 0 the enforced withdraw/open gate.

**Implementation**

**api**
- [ ] New service api/src/services/margin.ts implementing the 5-step computation with per-address TtlCache and bounded-concurrency get_position hydration
- [ ] Ledger-entry reader for CumulativeFundingRate (xdr.LedgerKey.contractData, durability persistent) + a recorded live-testnet fixture pinning the ScVec[Symbol] key encoding
- [ ] Route GET /v1/account/margin?address= in api/src/routes/account.ts (public, address-validated, 400 on malformed G-address) with full response schema for OpenAPI
- [ ] Vitest: margin_endpoint_matches_contract_recompute (fixture account: every field equals an independent chain recompute); margin_endpoint_nulls_on_stale_price (price age > 60s → nulls, price-free fields still present); margin_endpoint_empty_account (no positions: usedMargin/MM zero, equity == poolBalance); funding key fixture test

**packages/shared**
- [ ] Single-source MAINTENANCE_MARGIN_BPS = 100 with the L0-12 supersession comment; export the pnl/funding formula helpers used by the service so web and api share one implementation

**sdk-ts**
- [ ] account.margin(address?) sub-client method + MarginInfo type + test (mirrors the response schema)

**sdk-py**
- [ ] account.margin(address) + MarginInfo pydantic model + test; include in the 0.1.2 publish (L1-14)

**web**
- [ ] CrossMarginBanner: usedMargin = Σ size/leverage (drop the totalCollateral definition at :65); keep the funding-aware equity
- [ ] AccountHealth: subtract pendingFunding from tradingEquity so both surfaces agree; update web/CLAUDE.md's CrossMarginBanner formula block
- [ ] Optional (flagged): hydrate the banner from /v1/account/margin when gatewayServesThisMarket(), client-calc fallback otherwise
- [ ] `npx tsc --noEmit`

**docs**
- [ ] docs-site Margin & liquidation page: canonical formula table with units/precision, worked example, null semantics, ratio-denominator decision note (supersedes types.rs:101-102), and the L1-5/L0-12 forward notes

**Acceptance:**
- api vitest suite passes including margin_endpoint_matches_contract_recompute — endpoint output equals an independent recompute from get_position/get_cross_margin_balance/CumulativeFundingRate/oracle reads on a seeded fixture account
- GET /v1/account/margin for a live staging account returns 7-dec strings whose freeMargin equals the maximum withdraw_cross_margin amount that still simulates SUCCESS (boundary probe: freeMargin passes, freeMargin + 1 unit fails once L1-5 lands; against the current MM-gate the probe uses equity−MM)
- With the oracle cache forced stale, the endpoint returns nulls for equity/freeMargin/pendingFunding/marginRatioBps and real values for usedMargin/maintenanceMargin
- CrossMarginBanner "Used Margin" equals the endpoint's usedMargin for the same account (visual + unit test on the shared helper)
- sdk-ts and sdk-py margin() tests pass; OpenAPI /docs documents the endpoint
- docs.noether.exchange margin page is live with the formula table

**Risks:** Gateway/contract formula drift is the exact disease this item cures — the recompute acceptance test and porting formulas from noether_common (never re-deriving) are the guards; any future contract margin change (L1-5, L0-12, L0-13) must update packages/shared in the same PR. The DataKey ScVec[Symbol] encoding for CumulativeFundingRate is an assumption until the fixture pins it — the fallback path (batch-1 get_funding_state view via L1-11) is specified. RPC load: 2+N simulations per uncached request — TtlCache plus the public rate-limit tier must hold; watch the Azure gateway egress. Web double-source divergence during rollout (client calc vs endpoint) — acceptance requires equality before flipping the banner to the endpoint. mm_bps hardcoded until L0-12: single-sourced with a supersession comment so the per-asset ladder can't silently orphan it.

## Risk visibility (L1-7..L1-10)

### L1-7 · Margin-call state + banner (pre-liquidation warning)

**Status:** todo · **Effort:** M · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** L1-6 · **Blocks:** —
**Cross-refs:** LIGHTER-GAP §Risk engine — "[P1/M] No margin-call state, no active liquidation notifications, and cross liquidations are one opaque aggregate event" · UIUX C5 (unified health + pre-liquidation alerting ladder, docs/UIUX-RESEARCH-2026-07.md:1368) · UIUX B13 (one canonical health scalar, docs/UIUX-RESEARCH-2026-07.md:1337) · UIUX B4 (pending funding folded into client equity, docs/UIUX-RESEARCH-2026-07.md:1328) · KNOWN_ISSUES Q-7 (addCollateral dead stub — constrains the isolated-position remedy CTA until L0-6) · TASKS P2-9 (keeper local health calc — the parity reference implementation) · **Gap rows:** Risk engine: No margin-call state, no active liquidation notifications, and cross liquidations are one opaque aggregate event — margin-call state + banner leg (build items (2) gateway margin-call push and (3) formal banner at a configurable health threshold)

**Current state (verified):** STAGING web: passive proximity UI exists and is funding-aware — CrossMarginBanner.tsx:61-100 computes marginRatio = (poolBalance + Σcollateral + ΣuPnL − Σpending_funding) / (Σsize × 100bps/10000) × 100 with bands Healthy >300% / Caution 100-300% / At Risk <100%, and AccountHealth.tsx:61-70 reuses the same margin-ratio formula and bands per the "B13" comment but WITHOUT the pending-funding term in equity (the divergence L1-6 fixes); PositionsList.tsx:188-193 flags isolated rows within 10% of liquidation price. But no formal margin-call STATE exists anywhere: no threshold constant, no server-side detection, no WS frame, no persistent cross-page banner, no opt-in preference — the only liquidation-adjacent notice is the post-hoc B1 vanish toast (web/app/trade/page.tsx:153-194, poll-diff, /trade only). The gateway has zero health computation (no margin service in api/src/services/), and the positions projection cannot support one without chain hydration — indexer/migrations/001_baseline.sql `positions` carries only position_id/trader/asset/direction/size/entry_price/opened_at/tx/contract (no collateral, no margin_mode). The only off-chain health implementation is the keeper's liquidation prefilter (scripts/keeper/src/health.ts:1-60 — bigint mirror of math.rs, DEFAULT_MAINTENANCE_MARGIN_BPS=100n, CANDIDATE_BUFFER=2n; pipeline scripts/keeper/src/index.ts:803-838 isolated, :884+ cross), which warns nobody. Contract truth (all deployments): liquidatable when equity < Σ(size × maintenance_margin_bps/10000), contracts/market/src/position.rs:80,123-140; MM is flat 100 bps until L0-12. Remedy constraint: isolated add_collateral does not exist on-chain (removed for WASM; KNOWN_ISSUES Q-7) — until L0-6 lands in Batch 1, the only isolated remedy is full close.

**Design:** DEFINITIONS (consumes L1-6's canonical scalar; restated for self-containment, all integer math, BigInt in TS): healthRatioBps(cross account) = equity × 10_000 / MM, where equity = cross_pool_balance + Σcollateral_i + Σpnl_i − Σpending_funding_i (7-decimal i128, PRECISION=10_000_000) and MM = Σ(size_i × mm_bps / 10_000); healthRatioBps(isolated position) = (collateral + pnl − pending_funding) × 10_000 / (size × mm_bps / 10_000). Liquidation fires at healthRatioBps < 10_000.

STATE MACHINE (per (owner, scope, positionId?)): enter margin-call when healthRatioBps < MARGIN_CALL_RATIO_BPS (default 15_000 = 150% of MM); clear at ≥ MARGIN_CALL_CLEAR_BPS (default 16_500) — hysteresis kills flapping; SUPPRESSION (Binance anti-spam rule per UIUX C5): if the first observation is already < LIQ_IMMINENT_BPS (default 11_000), or a liquidation event for the same scope lands in the same monitor tick, emit only the liquidation — never a margin call the user cannot act on. mm_bps MUST be read from market config (get_config) not hard-coded, so L0-12's per-asset ladder flows through unchanged.

SERVER DETECTION — new api/src/services/marginMonitor.ts: every MARGIN_MONITOR_INTERVAL_MS (default 20_000 ms) (1) list open position ids + traders from the positions projection scoped to the current market contract_id; (2) hydrate Position structs via get_position simulation (reuse the indexer positionSync.ts:32+ pattern inside the gateway's contractReader; batch, bounded, skip cycle on RPC failure); (3) read get_cross_margin_balance per cross trader; (4) take prices from OracleTicker's last snapshot — zero additional oracle reads; (5) run the state machine; on enter emit on the EXISTING bus channel `account.events.<owner>` an AccountEventPayload-shaped frame: `{topic:'margin_call', trader, owner, ledger:<last indexed ledger>, ledgerCloseTs:<now/1000>, txHash:null, raw:{scope:'cross'|'isolated', positionId?, asset?, healthRatioBps, equity:'<i128 7-dec string>', maintenanceMargin:'<i128 7-dec string>', thresholdBps, liquidationPrice?:'<7-dec string>'}}`; emit topic:'margin_call_cleared' on exit. FAIL-SAFE: any asset with an unknown/stale price snapshot is skipped for that tick — never compute health from fabricated inputs (mirrors the CrossMarginBanner unknown-guards and the contract's i128::MAX/2 sentinel philosophy).

REST: fold marginCall:{active:boolean, sinceTs, thresholdBps, healthRatioBps} into L1-6's GET /v1/account/margin response (public read of public chain state, ?address= param, mirrors /v1/orders/open auth posture).

WEB BANNER (client-side, real-time — independent of gateway cadence): new pure module web/lib/risk/marginCall.ts exporting marginCallState(healthRatioBps, prevState) with the same three thresholds; new MarginCallBanner component rendered above PositionsList on /trade and globally on /portfolio (UIUX C5 stage-3 placement), fed by the same inputs CrossMarginBanner already computes at Noeracle-SSE speed; copy pattern: "Margin call — account health 132% of maintenance. At 100% your positions are liquidated (5% liquidation fee)." CTAs deep-link the remedy: cross → existing deposit_cross_margin modal; isolated → Close position (Add margin + partial-close CTAs enabled when L0-6 ships — until then say so in the banner). Opt-in: localStorage key notifications.marginCall — banner default ON, toast rendering opt-in and delivered via L1-10's surface; for bots the WS subscription itself is the opt-in (no server-side prefs store in v1; email/telegram rails are explicitly post-v1 per UIUX research "off-app channels cannot carry the safety load").

PARITY GUARD: a shared golden-vector fixture file (JSON: position/account inputs → expected healthRatioBps + classification) consumed by api marginMonitor tests AND wired into the keeper's `npm run smoke` — the monitor's 150% warn threshold sits strictly inside the keeper's 200% simulation prefilter (CANDIDATE_BUFFER=2), so a warning always precedes any keeper liquidation submission.

CONFIG: MARGIN_CALL_RATIO_BPS, MARGIN_CALL_CLEAR_BPS, LIQ_IMMINENT_BPS, MARGIN_MONITOR_INTERVAL_MS env vars on the api service, defaults as above, documented in .env.example. DOCS: thresholds + formula + the best-effort disclaimer published on the same docs liquidation page L1-10 owns (150% warn / 165% clear / keeper prefilter 200% / liquidation 100%).

**Implementation**

**api**
- [ ] Add marginMonitor.ts service: projection-driven id listing, get_position + get_cross_margin_balance hydration via contractReader, OracleTicker snapshot prices, per-(owner,scope,positionId) state machine with 15000/16500/11000 bps thresholds and same-tick liquidation suppression
- [ ] Emit margin_call / margin_call_cleared AccountEventPayload frames on bus channel `account.events.<owner>`; wire monitor start/stop into server.ts next to LiveTailer/OracleTicker
- [ ] Read maintenance_margin_bps from get_config (cached) — no hard-coded 100 bps
- [ ] Extend GET /v1/account/margin (L1-6) with the marginCall block + OpenAPI schema; regenerate committed openapi.json
- [ ] Add MARGIN_CALL_RATIO_BPS / MARGIN_CALL_CLEAR_BPS / LIQ_IMMINENT_BPS / MARGIN_MONITOR_INTERVAL_MS to config.ts + .env.example
- [ ] Tests (vitest): threshold entry emits exactly one frame; hysteresis holds between 15000-16500; first-observation-below-11000 suppresses; unknown price skips asset (no frame); isolated frame carries positionId+asset; golden-vector fixture pass

**web**
- [ ] Add web/lib/risk/marginCall.ts pure predicate (same thresholds, BigInt bps math) shared by banner + future toast mapping
- [ ] Add MarginCallBanner component above PositionsList on /trade and on /portfolio, driven by the existing CrossMarginBanner inputs (SSE-speed) with the unknown-input guards preserved
- [ ] CTAs: cross → deposit_cross_margin modal; isolated → close flow; leave commented hooks for L0-6 add-margin/partial-close CTAs
- [ ] localStorage opt-in key notifications.marginCall; banner suppressed while a liquidation toast for the same scope is active
- [ ] Verify with `npx tsc --noEmit` + `npm run build`

**keeper**
- [ ] Wire the shared golden-vector fixture into `npm run smoke`: assert keeper isLiquidationCandidate/isCrossLiquidationCandidate classifications agree with the monitor's on every vector (warn threshold strictly inside the 2x prefilter)

**docs**
- [ ] Publish the margin-call threshold table (150% warn / 165% clear / 100% liquidation, flat 1% MM until per-asset ladder) + formula + best-effort disclaimer on the docs liquidation page (co-owned with L1-10)

**Acceptance:**
- api vitest marginMonitor.test.ts passes: "enters margin call below 15000 bps and emits one frame", "hysteresis: no clear until 16500 bps", "suppresses margin_call when first observation < 11000 bps or liquidation lands same tick", "skips assets with unknown price and emits nothing"
- Golden-vector parity: the same fixtures pass in api tests and in keeper `npm run smoke` with identical classifications
- GET /v1/account/margin?address=G... returns marginCall.active=true with healthRatioBps for a seeded sub-150% account (route test)
- WS integration test: an authed subscriber on `account.events.<owner>` receives the {topic:'margin_call'} frame; a different owner does not
- On staging: pushing an account under 150% of MM renders MarginCallBanner on /trade AND /portfolio within one SSE tick, and the banner clears above 165% without flapping across ticks
- web `npx tsc --noEmit` and `npm run build` green; banner renders nothing when the mark price is unknown (verified by forcing SSE-stale state)
- Docs liquidation page shows the threshold table with the four numbers (150/165/200-prefilter/100)

**Risks:** Parity across four health implementations (contract position.rs, keeper health.ts, gateway marginMonitor, web marginCall.ts) — the golden-vector fixture is the mitigation, and mm_bps must be config-read everywhere so L0-12's per-asset ladder doesn't silently split them. RPC load of get_position hydration is bounded by open-position count but grows with traction — batch reads and a 20s cadence keep it under the keeper's own load; degrade by skipping ticks, never by guessing prices. Warning fatigue/flapping is a product risk — hysteresis + suppression are load-bearing, don't drop them. The banner must never render "At Risk" from fabricated inputs (missing oracle read) — reuse the existing unknown-guards; this is the same class as the CLAUDE.md "never render unknown money" pitfall. No contract change, no WASM impact, no redeploy coupling.

### L1-8 · Event enrichment at the contract layer (trader-keyed order events, per-leg cross liquidation)

**Status:** todo · **Effort:** M · **Lane:** mixed · **Ships in:** batch-1-redeploy · **Needs:** L0-5 · **Blocks:** L0-18, L2-4, L2-6
**Cross-refs:** LIGHTER-GAP §Risk engine — margin-call row; §Order types & execution — fill/cancel visibility row; §Platform, API & trust — own-order/fill visibility row · AUDIT I-5 (cross_liq leaves phantom positions; single aggregate event, docs/AUDIT-2026-06.md:324) · AUDIT I-6 (lossy archive; closes originally lost asset — the same drift class, docs/AUDIT-2026-06.md:329) · TASKS P0-12 (note: "cancel/exec events carry no trader — indexer decoder gap", TASKS.md:53) · TASKS P4-10 (raw XDR archive + decoder fields — the forward-compat groundwork this builds on, TASKS.md:149) · CLAUDE.md "Contract Event Formats" table + contracts/CLAUDE.md:75-82 + web/CLAUDE.md "Contract Event Parsing" (the three tables that MUST move in the same change) · **Gap rows:** Risk engine: No margin-call state, no active liquidation notifications, and cross liquidations are one opaque aggregate event — contract leg (build item (1): per-leg position_liquidated during cross liquidation + trader on order exec/cancel) · Order types & execution: Fill/cancel visibility: user-scoped order events and notifications — contract leg (enrich order_executed/order_cancelled with trader/asset/price/size) · Platform, API & trust: Own-order/fill visibility on the private WS + complete order rows — the "at the next market redeploy add trader to order_executed/order_cancelled topics so the join becomes native" leg

**Current state (verified):** PROD+STAGING (identical event code on both): order_executed = (order_id, keeper_reward) only — contracts/market/src/lib.rs:1763-1766; order_cancelled = (order_id, reason:Symbol) at five sites with no trader/asset — :1613-1616 (user), :1714-1717 (slippage), :1276-1279 (ioc_not_filled), :2292-2295 (pos_closed, inside cancel_position_orders), :2444-2447 (reduce_only_no_position); order_placed = (order_id, trader, trigger_price) at :1315-1318 (limit entry), :1423-1426 (set_stop_loss), :1549-1552 (set_take_profit) — it does NOT carry asset/direction/size (the L1-9 brief's parenthetical claiming it does is wrong; code wins). NEW FINDING (untracked in TASKS/KNOWN_ISSUES/gap doc): place_stop_limit_order (lib.rs:1823-1901) and place_trailing_stop (lib.rs:1905-1980) emit NO event at all — save_order + Ok(order) with zero publishes — so stop-limit and trailing-stop orders are invisible to the indexer end-to-end, and today's /v1/orders/open fold silently omits them. cross_liq = (trader, total_pnl, keeper_reward) at lib.rs:1126-1129; the per-position loop (lib.rs:1024-1060) deletes each leg with no event, so per-leg asset/size/price is unrecoverable on-chain (AUDIT I-5's positionSync.ts get_position cleanup is the workaround). Isolated events are already enriched: position_liquidated 7-tuple (:666-668), position_partial_liq 7-tuple STAGING-only (:608-615), position_closed 8-tuple (:968-971 cross, :2197-2200 shared isolated). Pinned consumers: indexer/src/decoders/market.ts:145-184, root CLAUDE.md event table, contracts/CLAUDE.md:75-82, web/CLAUDE.md parsing table, web/lib/stellar/market.ts parseEventsToTrades (:1140+) and getRecentLiquidations (:666+), web/components/trading/RecentTrades.tsx:117-146. WASM: market.wasm 79,017 B unoptimized (2026-07-10 staging build) against the 128 KB (131,072 B) protocol limit.

**Design:** EVENT SHAPES AFTER BATCH 1 — all payload fields stay in the data tuple under a single-symbol topic, consistent with every existing market event (decision: do NOT move trader into topics — it would change the envelope for all consumers and our indexer does not use getEvents topic filtering; revisit only on third-party demand).

1. order_placed(order_id:u64, trader:Address, asset:Symbol, order_type:u32, direction:u32, size:i128, trigger_price:i128) — size in 7-decimal notional: calculate_position_size(collateral, leverage) for LimitEntry/StopLimit, position.size for attached SL/TP/trailing; order_type/direction as u32 enum encodings (matches how the indexer already decodes direction as number). EMIT FROM ALL FIVE placement paths — this closes the newly-found stop-limit/trailing silence (place_stop_limit_order emits before Ok at ~:1898; place_trailing_stop at ~:1976).
2. order_executed(order_id:u64, trader:Address, asset:Symbol, direction:u32, size:i128, exec_price:i128, keeper_reward:i128) — exec_price = the 7-decimal oracle price the executing branch settled at; emitted at the single publish site :1763 (order is in scope).
3. order_cancelled(order_id:u64, trader:Address, asset:Symbol, reason:Symbol) — reasons unchanged (user|slippage|pos_closed|reduce_only_no_position|ioc_not_filled; "expired" reserved for L2-4); for the :2292 site, extend the internal helper signature to cancel_position_orders(env, position_id, skip, trader:&Address, asset:&Symbol) so attached-order cancels reuse the position's trader/asset with ZERO extra storage reads (attached orders always belong to the position's owner).
4. Per-leg cross liquidation: inside the liquidate_cross_account position loop (or inside L0-5's tranche loop if it lands first — same function, co-author the change), emit position_liquidated(pid, trader, asset, direction, size, keeper_cut_leg, current_price) for every closed leg — the 6th field is the leg's keeper cut per L0-5's per-leg penalty split (L0-4 makes the reward per-leg; the field's value semantics are owned by L0-5's spec), keeping the EXACT 7-tuple shape of isolated liquidations so every parser handles both; cross_liq stays an UNCHANGED 3-tuple summary (decision: leg count and per-leg PnL are derivable off-chain — pnl = size×(price−entry)/entry with entry from the positions projection — so no field additions, minimizing parser churn and WASM growth).

ERROR CODES: none added. MIGRATION: none — events only, no storage or entrypoint changes; rides the Batch-1 coupled market(+vault+router) redeploy and is part of the audited frozen surface (L0-18).

INDEXER (deploy BEFORE the contract promotes): decoders become arity-tolerant — decodeOrderPlaced branches on v.length (3 legacy | 7 new), decodeOrderExecuted (2 | 7), decodeOrderCancelled (2 | 4); position_liquidated decoder unchanged. Handler rules to prevent double-counting: (a) recordRealizedTrade — when per-leg position_liquidated rows share a tx_hash with a cross_liq event (post-Batch-1 contracts), write the legs as the trade rows and SKIP the aggregate cross_liquidation row (pre-Batch-1 events keep today's aggregate behavior); (b) leaderboard liqCount keeps counting account-level events only (cross_liq + isolated position_liquidated without a same-tx cross_liq). On new-shape order events, upsert L1-9's orders projection natively and mark hydrated=TRUE (kills the get_order hydration for new orders).

WEB (same PR): parseEventsToTrades + RecentTrades.tsx add length-guarded parsing for both arities; getRecentLiquidations/B1 vanish toast dedupes per-leg toasts when a cross_liq shares the tx (one account-level toast, not N+1). DOCS-OF-RECORD (same commit): update root CLAUDE.md "Contract Event Formats", contracts/CLAUDE.md:75-82, web/CLAUDE.md parsing table — the index-mismatch pitfall is the whole reason this item is one atomic change.

**Implementation**

**contracts/market**
- [ ] Enrich the order_executed publish (:1763) to the 7-field tuple with the branch settlement price
- [ ] Enrich all five order_cancelled sites to (order_id, trader, asset, reason); thread trader/asset through cancel_position_orders params instead of reloading orders
- [ ] Enrich the three order_placed sites to the 7-field tuple; ADD order_placed emission to place_stop_limit_order and place_trailing_stop (closing the silent-placement gap)
- [ ] Emit position_liquidated per closed leg inside the cross-liquidation loop (coordinate line-level with L0-5's tranche rewrite; keeper_reward=0 per leg); keep cross_liq 3-tuple unchanged
- [ ] Tests: test_order_placed_event_all_five_paths, test_order_executed_event_carries_trader_price_size, test_order_cancelled_event_reasons_carry_trader_asset (all 5 reasons), test_cross_liquidation_emits_per_leg (2 positions → exactly 2 position_liquidated + 1 cross_liq, tuple-exact)
- [ ] Run ./scripts/build_contracts.sh and record the market.wasm size delta in the PR (budget flag: must stay well under 131,072 B optimized)

**indexer**
- [ ] Make decodeOrderPlaced/decodeOrderExecuted/decodeOrderCancelled arity-tolerant (branch on payload length; legacy fields default null)
- [ ] Handler: same-tx cross_liq + per-leg dedup rule in recordRealizedTrade; leaderboard liqCount stays account-level; native orders-projection upsert on new-shape events (hydrated=TRUE)
- [ ] Decoder/handler vitest fixtures for BOTH arities + a mixed-era replay test producing zero dead-letters (reindex must survive history)

**api**
- [ ] No route changes required; verify liveTailer forwards the enriched payloads' trader field automatically (it keys on payload.trader) and /v1/trades rows for cross legs carry asset/size post-change (test)

**web**
- [ ] Add length-guarded event parsing in web/lib/stellar/market.ts parseEventsToTrades and RecentTrades.tsx for both arities
- [ ] Dedupe B1 vanish toasts: suppress per-leg liquidation toasts when a cross_liq shares the tx hash
- [ ] Update web/CLAUDE.md parsing table; `npx tsc --noEmit`

**docs**
- [ ] Update root CLAUDE.md "Contract Event Formats" + contracts/CLAUDE.md:75-82 in the SAME commit as the contract change; update the docs-site events reference page listing both pre/post-Batch-1 shapes with the ledger cutover point

**ops**
- [ ] Rollout order: deploy indexer + gateway with arity-tolerant decoders FIRST, then promote the Batch-1 contracts; verify on staging with a scripted place→execute→cancel→cross-liquidate sequence reading getEvents

**Acceptance:**
- `cargo test -p market` passes the four named event tests; tuple contents asserted field-by-field, not just event count
- Optimized market.wasm size recorded pre/post; delta under ~2 KB and total under the 128 KB limit
- indexer vitest: fixtures of both arities decode; a replay containing pre- and post-change events produces zero dead-letter rows and no duplicate trade rows for a cross liquidation (legs written, aggregate skipped)
- On-chain staging verification after redeploy: a keeper-executed limit order shows a 7-field order_executed in getEvents; a 2-position cross liquidation emits exactly 2 position_liquidated + 1 cross_liq in one tx; a trailing-stop placement now emits order_placed
- All three CLAUDE.md event tables updated in the same commit (PR checklist item; grep for the old 2-field order_executed shape returns nothing outside historical docs)
- web `npx tsc --noEmit` green; RecentTrades renders fixture events of both arities; a simulated cross liq produces one toast, not N+1
- /v1/orders/open shows stop-limit and trailing orders for new placements without the L1-9 reconciliation sweep (native path)

**Risks:** Event-format drift is THE risk class here (CLAUDE.md pitfall: "index mismatches cause display bugs") — the three CLAUDE.md tables, indexer decoders, and web parsers move in one atomic change, and the deploy ORDER is load-bearing: arity-tolerant off-chain code ships before contract promotion, or every fill/cancel frame after cutover is dropped or misparsed. events_raw contains old shapes forever, so decoders must branch on payload length, never on date — `npm run reindex` replays mixed eras. Same-function coupling with L0-5 (staged cross liquidation rewrites liquidate_cross_account) and L0-4 (liquidation settlement may add penalty/refund fields to position_liquidated) — co-author in Batch 1 and freeze the final tuple table before the L0-18 audit; any post-freeze field addition re-opens audit scope. WASM growth ~0.5-2 KB across 10 publish sites is small against the ~52 KB headroom but must be measured because Batch 1 also lands L0-6/L1-18 growth. Double-counting hazards (trades rows, leaderboard liqCount, web toasts) are addressed by the same-tx dedup rules — test them explicitly.

### L1-9 · Account-scoped WS completeness (fills, cancels, liquidations on the private channel) — no redeploy needed for v1

**Status:** todo · **Effort:** M · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** — · **Blocks:** L1-10
**Cross-refs:** LIGHTER-GAP §Platform, API & trust — own-order/fill visibility row; §Order types & execution — fill/cancel visibility row · TASKS P0-12 (SQL-side /me/orders only sees order_placed, TASKS.md:53) · TASKS P4-14 (orders + OrderBook via the gateway hint feed, 2026-07-16, TASKS.md:156-158) · TASKS P4-20 (WS server half — per-connection serialization still pending, TASKS.md:167) · AUDIT A-3 (/me/orders wrong-data class, docs/AUDIT-2026-06.md:270) · AUDIT S-3 (WS subscribe races login; server-side fix folds in here, docs/AUDIT-2026-06.md:358) · AUDIT I-6 (fill detail from position events, docs/AUDIT-2026-06.md:329) · KNOWN_ISSUES P-1 (N+1 hydration — this kills the per-id order hydration) · KNOWN_ISSUES G-1 (wallet-only ops must not sit behind the beta gate — the classification rule for login_wallet) · **Gap rows:** Platform, API & trust: Own-order/fill visibility on the private WS + complete order rows (primary — orders projection, enriched frames, full /v1/orders/open rows, liquidation push) · Order types & execution: Fill/cancel visibility: user-scoped order events and notifications — gateway/WS leg (route trader-keyed frames to `account.events.<owner>`, orders channel typings in both SDKs)

**Current state (verified):** STAGING branch, deployed to the Azure gateway/indexer 2026-07-16: order_executed/order_cancelled payloads carry no trader, so LiveTailer (api/src/services/liveTailer.ts:95, 120-124 — routes any event whose decoded payload has a trader key) never delivers a user's own fills or cancels on `account.events.<owner>`; only order_placed frames arrive. CORRECTION to the gap doc: liquidation frames ALREADY reach the owner channel — position_liquidated, position_partial_liq, and cross_liq payloads all carry trader and the tailer forwards them (:120-124); what is missing is fills/cancels, typed/enriched frames, partial_liq on the `trades.<asset>` fan-out (POSITION_TOPICS at liveTailer.ts:19-25 lists only opened/closed/liquidated), and any web consumer. GET /v1/orders/open (api/src/routes/orders.ts:226-262) returns only orderId/trader/triggerPrice/status from the events_raw fold (api/src/services/stats.ts:313-373), so clients hydrate per id on-chain (web/lib/api/orders.ts + getOrdersByIds — KNOWN_ISSUES P-1's mitigated N+1). NEW FINDING: place_stop_limit_order and place_trailing_stop emit no event at all (contracts/market/src/lib.rs:1823-1901, 1905-1980), so the fold — and therefore the web Orders tab whenever it trusts the gateway (trade/page.tsx fallback logic) — silently omits stop-limit and trailing orders today. The private channel is also unreachable for retail: WS login requires an API key (api/src/plugins/ws.ts:131-141 loginWithBearer) and key issuance is allowlist-gated (api/src/routes/keys.ts:163-172, 403 not_in_beta), while the challenge endpoint itself is public (keys.ts:101-127); message handling is still unserialized (`void handleMessage(...)`) so the AUDIT S-3 login/subscribe race persists server-side (TASKS P4-20). No orders projection exists (indexer/migrations: 001_baseline.sql + 002_rls_hardening.sql; orders_cache was dropped in the Postgres baseline). Both SDKs expose orders.open() today: sdk-ts (sdk-ts/src/sub/orders.ts:104, P4-14) and sdk-py (noether_sdk/sub/orders.py:41, commit 83f44f7 2026-07-16). Neither returns the full row model this item adds.

**Design:** ALL v1 WORK IS OFFCHAIN (no redeploy); L1-8 later makes the joins native.

1. ORDERS PROJECTION — indexer migration 005_orders_projection.sql: `CREATE TABLE orders (order_id BIGINT PRIMARY KEY, trader TEXT NOT NULL, asset TEXT, order_type SMALLINT, direction SMALLINT, collateral TEXT, leverage INTEGER, trigger_price TEXT NOT NULL, trigger_condition SMALLINT, slippage_bps INTEGER, limit_price TEXT, position_id BIGINT, time_in_force SMALLINT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','executed','cancelled','cancelled_slippage','expired')), cancel_reason TEXT, placed_ledger BIGINT NOT NULL, placed_ts BIGINT NOT NULL, placed_tx_hash TEXT NOT NULL, resolved_ledger BIGINT, resolved_ts BIGINT, resolved_tx_hash TEXT, fill_price TEXT, fill_size TEXT, keeper_reward TEXT, hydrated BOOLEAN NOT NULL DEFAULT FALSE, contract_id TEXT NOT NULL)`; indexes (trader, status) and (contract_id, status). i128 money/price columns are 7-decimal strings, consistent with existing projections.
2. WRITERS in indexer/src/handlers/market.ts inside the existing per-event transaction: order_placed → INSERT ON CONFLICT (order_id) DO NOTHING with status='open'; order_executed → UPDATE status='executed', keeper_reward, resolved_*; order_cancelled → UPDATE status = (reason=='slippage' ? 'cancelled_slippage' : 'cancelled'), cancel_reason=reason, resolved_*. FILL JOIN: the contract emits position_opened (entry fills) / position_closed (SL/TP/trailing fills) BEFORE order_executed in the same tx, and the indexer processes events in order — so on order_executed, SELECT the same-tx position event from events_raw (tx_hash equality, topic IN (...)) and copy fill_price/fill_size; deterministic, no race.
3. HYDRATION (pre-L1-8 detail): after commit of order_placed, fetch the Order struct via a get_order(order_id) simulation (new indexer/src/orderSync.ts mirroring positionSync.ts:32+ conventions incl. INDEXER_VIEW_SOURCE), then UPDATE asset/order_type/direction/collateral/leverage/trigger_condition/slippage_bps/limit_price/position_id/time_in_force, hydrated=TRUE; a retry sweep hydrates up to ORDER_HYDRATE_BATCH (default 5) unhydrated rows per poll cycle. get_order returning None (TTL-archived) leaves the row unhydrated with placement fields only.
4. RECONCILIATION SWEEP (covers the event-less stop-limit/trailing types until L1-8, and heals downtime drift): every ORDERS_RECONCILE_INTERVAL_MS (default 60_000 ms) simulate get_all_order_ids, diff against projection ids for the current contract_id, INSERT+hydrate missing orders (placed_tx_hash='', placed_ts=created_at from the struct) and fix status drift; hard-skip with a warning if on-chain ids exceed 500 (safety valve).
5. GATEWAY: StatsService.listOrders switches to the orders table (keep the events_raw fold as an isMissingTable fallback during rollout); extend ORDER_EVENT_SCHEMA (orders.ts:204-216) with asset, orderType, direction, collateral, leverage, triggerCondition, slippageBps, limitPrice, positionId, timeInForce, cancelReason, fillPrice, fillSize, keeperReward, resolvedTs, hydrated; status enum becomes open|executed|cancelled|cancelled_slippage|expired (breaking: SDK types updated in the same change; cancelReason carries the fine-grained symbol). This kills the per-id chain hydration N+1 — web/lib/api/orders.ts consumes full rows and getOrdersByIds becomes the fallback only.
6. ENRICHED FRAMES: LiveTailer, on order_executed/order_cancelled rows lacking payload trader (legacy shape), does one SELECT from orders by order_id and emits to `account.events.<owner>` with raw merged {orderId, trader, asset, direction, fillPrice?, fillSize?, keeperReward?, cancelReason?}; add position_partial_liq to POSITION_TOPICS with TradePayload kind 'partial_liquidation' (`trades.<asset>` parity with /v1/trades kinds); cross_liq keeps owner-channel routing and gains kind 'cross_liquidation' in the typed payload (no `trades.<asset>` frame until L1-8's per-leg events carry asset).
7. WALLET WS LOGIN (makes the private channel reachable without the beta gate, per the KNOWN_ISSUES G-1 classification — own-account event access is wallet-only, not gated analytics): new WS op {op:'login_wallet', address, challenge, signature} using the exact POST /v1/keys exchange triple, verified via the SHARED WalletAuth instance (api/src/services/walletAuth.ts:59-103 manageData-tx verification), NO allowlist check, then setUser({owner: address, tier:'standard'}); failed attempts count against the per-conn token bucket, close after 5 failures. In the same change, close the AUDIT S-3 / TASKS P4-20 server half: serialize handleMessage per connection with a promise chain so login always precedes queued subscribes.
8. SDKs: both SDKs' orders.open() row types updated to the full schema; both SDKs gain typed frame interfaces (OrderUpdateFrame, LiquidationFrame, PartialLiquidationFrame, CrossLiquidationFrame, MarginCallFrame) and a ws.loginWallet(address, signCallback) helper that builds the manageData challenge tx (reuse the S-2 construction from the keys flow).
9. CONFIG: ORDER_HYDRATE_BATCH, ORDERS_RECONCILE_INTERVAL_MS env on the indexer.

NATIVE MODE AFTER L1-8: new-shape order_placed rows insert fully-populated (hydrated=TRUE) and all five placement paths emit — hydration + reconciliation become drift-healers only; enrichment SELECTs remain as verification. No error codes, no contract or tx-builders changes.

**Implementation**

**indexer**
- [ ] Migration 005_orders_projection.sql with the DDL + indexes above
- [ ] Order lifecycle writers in handlers/market.ts inside the existing per-event transaction (idempotent via the events_raw insert guard); same-tx fill join for order_executed
- [ ] orderSync.ts get_order hydration (positionSync pattern) + per-cycle retry sweep (ORDER_HYDRATE_BATCH)
- [ ] get_all_order_ids reconciliation sweep every ORDERS_RECONCILE_INTERVAL_MS covering event-less stop-limit/trailing placements and downtime drift
- [ ] Tests: order_placed inserts open row; order_executed resolves with same-tx fill price/size; slippage cancel maps to cancelled_slippage; duplicate delivery leaves one row; reconcile inserts an on-chain order missing from the projection; hydration retries on transient RPC failure; reindex replay populates the table

**api**
- [ ] Switch StatsService.listOrders to the orders projection with events_raw-fold fallback; extend ORDER_EVENT_SCHEMA + OpenAPI (status enum grows to 5 values, cancelReason added); regenerate openapi.json
- [ ] LiveTailer: enrichment SELECT for legacy exec/cancel frames; add position_partial_liq to POSITION_TOPICS (kind 'partial_liquidation'); typed kind for cross_liq owner frames
- [ ] WS: implement {op:'login_wallet', address, challenge, signature} via the shared WalletAuth, no allowlist; per-connection promise chain serializing handleMessage (closes AUDIT S-3 server half / TASKS P4-20); failed-login lockout
- [ ] Tests: login_wallet binds owner with a valid signed challenge; rejects reused/expired challenges; subscribe-after-login race passes deterministically; enriched order_executed frame reaches `account.events.<owner>` with trader+fillPrice; partial_liq appears on `trades.<asset>`

**sdk-ts**
- [ ] Update orders.open() row type to the full schema (5-value status + cancelReason); add typed WS frame interfaces + ws.loginWallet(address, signCallback) helper; vitest coverage for both

**sdk-py**
- [ ] Update the existing orders.open() row model to the full schema (5-value status + cancelReason), matching the sdk-ts task; typed frame models + login_wallet helper reusing the S-2 manageData construction; pytest coverage

**web**
- [ ] Consume full /v1/orders/open rows in web/lib/api/orders.ts (drop the per-id hydration on the trusted path; keep getOrdersByIds as fallback only); verify the Orders tab now shows stop-limit/trailing orders via the reconcile sweep; `npx tsc --noEmit`

**docs**
- [ ] Rewrite the developers/websocket page: channel table (events, ticker.*, trades.* incl. partial_liquidation kind, account.events.*), login_wallet flow, full frame schemas, and the two-lane freshness caveat (prices sub-second via SSE, events seconds-class)

**ops**
- [ ] Run migration 003 + rolling deploy indexer then api on Azure (acr-build/update per runbook); run `npm run reindex` once with the indexer stopped to backfill the orders table from events_raw; extend the e2e harness with the place→cancel→frame round-trip and run it against staging

**Acceptance:**
- indexer vitest suite passes the seven named orders-projection tests, including "reconcile sweep inserts an on-chain trailing-stop order the events never showed"
- GET /v1/orders/open?trader=G... returns rows with non-null asset/direction/collateral/leverage for hydrated orders and status ∈ {open, executed, cancelled, cancelled_slippage, expired}; missing-table fallback still serves the legacy fold
- api WS tests: valid login_wallet binds owner and `account.events.<owner>` subscription succeeds; login/subscribe ordering test passes 100x (S-3 race closed); enriched order_executed and order_cancelled frames carry trader, asset, and fill/cancel detail; position_partial_liq frame observed on `trades.<asset>`
- e2e harness: authed flow places a limit order, sees the full row on /v1/orders/open (asset non-null), cancels it, and receives the order_cancelled frame on the private channel — asserted end-to-end against a live stack
- sdk-ts and sdk-py both expose orders.open() and loginWallet; npm test + pytest green; a CI parity check confirms both SDK row types match the OpenAPI schema
- On staging web with the gateway trusted, a freshly placed trailing stop appears in the Orders tab within one reconcile interval (60 s) — the silent-omission bug is observably closed
- Per-order chain hydration on the trusted path is gone: opening the Orders tab with 5 open orders issues zero get_order simulations from the browser (network-tab verification)

**Risks:** Projection-write bugs corrupt the read side until re-indexed (CLAUDE.md "supervise closely" class) — writers stay inside the existing per-event transaction with the events_raw idempotency guard, and reindex must rebuild the table from scratch (test it). Hydration/reconciliation add RPC simulations from the indexer — bounded (5/cycle + 60 s sweeps) but keep them off the public endpoint (SOROBAN_RPC_URLS paid endpoints per docs/RPC.md). The status-enum expansion is a breaking API change for anyone pinning 3 values — SDKs move in the same change and the docs changelog (L1-16) announces it. login_wallet deliberately bypasses the beta allowlist: scope it to WS channel auth ONLY (never REST), rate-limit failures, and document that account frames are public on-chain data scoped by owner — re-review against the G-1 lesson before merge. Keeper/contract parity not implicated (read-only). After L1-8 promotes, keep legacy-arity paths forever: events_raw history never changes shape.

### L1-10 · Web notification surface (toasts + inbox) + #83 error mapping

**Status:** todo · **Effort:** M · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** L1-9 · **Blocks:** —
**Cross-refs:** LIGHTER-GAP §Risk engine — margin-call row (items 3-4); §Order types & execution — stop-loss guaranteed execution row (notification fragment) · UIUX C5 (three-stage ladder + WS/browser push, docs/UIUX-RESEARCH-2026-07.md:1368) · UIUX B1 (liquidation visibility end-to-end — the shipped poll-diff half this upgrades, docs/UIUX-RESEARCH-2026-07.md:1325) · TASKS P5-5 (partial liquidation — origin of error #83 / 30s cooldown, TASKS.md:183) · TASKS P5-6 (insurance buffer waterfall — docs-page content source, TASKS.md:184) · TASKS parameter sheet (partial-liq 20-25% tranches / 30s cooldown / penalty 1% notional 50/50, TASKS.md:238-239 — the Batch-1 numbers the docs page publishes) · **Gap rows:** Risk engine: No margin-call state, no active liquidation notifications, and cross liquidations are one opaque aggregate event — web + docs legs (build items (3) toasts/inbox + #83 mapping and (4) publish the exact liquidation waterfall) · Order types & execution: Stop-loss guaranteed execution (cancel-on-slippage-breach abandons users in fast markets) — notification fragment only ("no notification fires" on slippage cancel; the execution-semantics fix is L0-11)

**Current state (verified):** STAGING web — the gap doc's "all silent today" is PARTIALLY STALE: poll-diff toasts exist but are trade-page-only and best-effort. Order status-change toasts (filled / cancelled — slippage exceeded / cancelled) live at web/app/trade/page.tsx:390-406, driven by diffing prevOrdersRef across the ~5 s orders poll; liquidation vanish toasts (isolated + cross, B1) at trade/page.tsx:153-194 via the getRecentLiquidations chain scan (web/lib/stellar/market.ts:666+). Nothing fires on /portfolio or /vaults, nothing while the tab is closed, and there is no persistent record — react-hot-toast only (global Toaster in web/app/layout.tsx:99), no inbox/bell component anywhere in web/components, and no gateway WS client exists in web at all (grep: WebSocket/EventSource only in noeracle.ts SSE + usePriceData.ts Binance). Partial liquidations have NO surface despite the event existing on staging (position_partial_liq decoder at indexer/src/decoders/market.ts:131-143 and owner-channel routing already live). #83: MarketError::LiquidationCooldown = 83 (contracts/noether_common/src/errors.rs:141, STAGING-only — PROD predates partial liq) is absent from MARKET_ERROR_MESSAGES, which ends at code 82 (web/lib/utils/contractErrors.ts:63-66), so it renders as a raw "Error #83". Docs: docs.noether.exchange is live, but no page publishes the liquidation waterfall (penalty bps, buffer role, ADL trigger/queue) — UNVERIFIED at page level (external repo NoetherDEX/noether-docs not in this checkout; asserted from the gap doc and the docs-site status memory). web/ has no test runner (package.json scripts: dev/build/start/lint only).

**Design:**

1. #83 MAPPING (ship immediately, one line + guard): add `83: 'Partial liquidation cooldown active — this position was recently reduced; retry in ~30 seconds'` to MARKET_ERROR_MESSAGES in web/lib/utils/contractErrors.ts (audience note: #83 returns to keeper liquidate calls, so users meet it rarely — the string is written for generic surfacing); add a coverage guard so the map can never silently lag errors.rs again — a small vitest asserting every documented market error code ≤ MAX_MARKET_ERROR (constant updated per redeploy, PR-checklist item for Batch 1).
2. WEB TEST HARNESS (prerequisite, minimal): add vitest as a web devDependency scoped to pure modules under web/lib (no DOM, no Next) — first test infra in web/, justified because notification dedup/catch-up logic is exactly the kind of silent-failure code that needs pinning.
3. GATEWAY-WS CLIENT: web/lib/api/ws.ts connects to NEXT_PUBLIC_NOETHER_API_URL/v1/ws, performs login_wallet (L1-9): POST /v1/keys/challenge → build the manageData challenge tx (same construction as the SDK keys flow) → one wallet signature per session via stellar-wallets-kit → subscribe `account.events.<address>`; auto-reconnect with resubscribe + relogin mirroring sdk-ts ws.ts semantics; feature flag NEXT_PUBLIC_NOTIFICATIONS_WS=1 — when off, or when login is declined/fails, the existing poll-diff toasts remain the fallback (never regress the shipped B1 behavior). The extra signature prompt is non-blocking: a dismissible "Enable live notifications?" affordance, never a login wall.
4. NOTIFICATION STORE + INBOX: web/lib/store/notificationStore.ts (Zustand, persisted to localStorage key 'noether-notifications', FIFO cap 100): entry = {id, dedupeKey, type: 'fill'|'cancel'|'slippage_cancel'|'liquidation'|'partial_liquidation'|'cross_liquidation'|'margin_call'|'adl' (reserved for L0-1), title, body, asset?, positionId?, orderId?, txHash?, ts, read}. UI: bell icon + unread badge in the shared header on ALL pages; panel lists entries newest-first with stellar.expert tx links and mark-all-read.
5. FRAME → NOTIFICATION MAPPING (pure module web/lib/notifications/mapFrame.ts, unit-tested): order_executed → fill ("BTC Long limit order filled at $118,240.50"); order_cancelled reason='slippage' → slippage_cancel with explicit-danger copy ("Stop-loss CANCELLED — price gapped past your 0.5% tolerance; the position is now unprotected") — this is the interim user-facing mitigation for the L0-11 silent-cancel hazard, and the copy softens to informational once L0-11 makes plain stops fill-guaranteed; reason='user' → inbox-only (self-initiated, no toast); position_liquidated → liquidation ("Position #N liquidated at $X — keeper fee $Y"); position_partial_liq → partial_liquidation ("Position #N reduced ~20% by partial liquidation at $X — cooldown 30s"); cross_liq → cross_liquidation ("Cross account liquidated — total PnL $Z"); margin_call (produced by L1-7 when it lands) → toast only when the notifications.marginCall opt-in is set.
6. DEDUPE + SUPPRESSION: dedupeKey = txHash + topic + (orderId|positionId|''); the store rejects duplicates so WS frames and the poll-diff fallback can coexist without double-toasting; post-L1-8, per-leg position_liquidated frames sharing a tx with cross_liq collapse into the single cross notification; a margin_call arriving in the same tick as a liquidation for the same scope is dropped (client-side mirror of L1-7's suppression).
7. CATCH-UP ON CONNECT: on wallet connect, backfill from GET /v1/trades?trader=&include kinds liquidation/cross_liquidation (+ /v1/orders/open?status=all for resolved orders) since the store's lastSeenTs; insert silently with ONE summary toast ("3 account events while you were away") — no toast storms.
8. DOCS — "Liquidations & the safety waterfall" page on docs.noether.exchange (co-owned with L1-7's threshold table): publish trigger math (liquidatable at health < 100% of MM; MM flat 100 bps today, per-asset after L0-12), partial-liquidation mechanics as deployed on STAGING (20% tranches, 30 s cooldown = error #83, bankruptcy override — verify exact eligibility wording against lib.rs at write time), keeper reward today (5% of remaining equity, cap 10% of collateral) and the Batch-1 restructure (1% of notional split 50/50 keeper/insurance per the TASKS sheet — labeled "activates at the Batch-1 redeploy"), insurance-buffer role (winners paid from buffer before LP capital; fed 10% of liquidation proceeds), shortfall ledger + planned claims (L0-2/L0-3), ADL trigger + queue (L0-1, labeled Batch-1), and pause semantics (L0-15). TWO-STAGE PUBLICATION with a contract-version stamp tied to the contracts.json market id: stage 1 documents the live STAGING rules now, stage 2 flips the Batch-1 sections at promotion — never publish future numbers as current. Trust framing per the gap doc thesis: fills are deterministic oracle prints, so PUBLISHING the rules (verifiable per-tx) captures most of the trust value Lighter gets from ZK proofs, at documentation cost. Banner/toasts link the page ("How liquidation works").
9. EMAIL/TELEGRAM RAILS: explicitly out of v1 (UIUX research: off-app channels cannot carry the safety load; a keeper/gateway webhook notifier needs a prefs store) — reserve the notification type registry for it, ship nothing.

**Implementation**

**web**
- [ ] Add the #83 entry to MARKET_ERROR_MESSAGES in web/lib/utils/contractErrors.ts
- [ ] Add vitest (devDependency) scoped to web/lib pure modules; wire `npm run test` in web/package.json
- [ ] Build web/lib/api/ws.ts gateway-WS client with login_wallet, auto-reconnect/resubscribe, and the NEXT_PUBLIC_NOTIFICATIONS_WS flag; non-blocking enable prompt
- [ ] Build notificationStore.ts (Zustand persisted, cap 100, dedupeKey rejection) + mapFrame.ts pure mapping + suppression rules
- [ ] Add bell + unread badge to the shared header and the inbox panel component (all pages); toasts via the existing global Toaster
- [ ] Wire catch-up backfill on wallet connect from /v1/trades + /v1/orders/open?status=all with the single summary toast
- [ ] Keep trade-page poll-diff toasts as the flag-off/fallback path; route them through the same store so dedupe applies
- [ ] Tests: mapFrame fixtures for all seven types; dedupe (same tx twice → one entry); cap eviction; catch-up merge sets read=false only for new entries; contractErrors coverage guard test
- [ ] `npx tsc --noEmit` + `npm run build` green

**api**
- [ ] No new endpoints required (consumes L1-9 frames + existing /v1/trades and /v1/orders/open); verify CORS for the WS origin and document the notification frame kinds in openapi/ws docs

**docs**
- [ ] Write "Liquidations & the safety waterfall" on docs.noether.exchange with the version-stamped two-stage structure (STAGING-truth now, Batch-1 sections labeled); include the L1-7 threshold table and the #83 cooldown explanation
- [ ] Link the page from the app banner, liquidation toasts, and the docs trading-mechanics index

**ops**
- [ ] Staging verification run: keeper-liquidate a test account with the tab closed, reconnect wallet, confirm inbox backfill + single summary toast; flip NEXT_PUBLIC_NOTIFICATIONS_WS=1 on staging Vercel before prod

**Acceptance:**
- decodeContractError for code 83 renders the cooldown message (web vitest), and the coverage-guard test fails if errors.rs gains a market code without a map entry (checklist-pinned MAX constant)
- web vitest suite green: mapFrame fixtures for fill/cancel/slippage_cancel/liquidation/partial_liquidation/cross_liquidation/margin_call, dedupe, cap-100 eviction, catch-up merge
- With NEXT_PUBLIC_NOTIFICATIONS_WS=1 on staging: an SL slippage-cancel produces the "position is now unprotected" toast AND an inbox entry with tx link, on /portfolio (not just /trade)
- Liquidating a staging account while the tab is closed → on reconnect the inbox shows the liquidation with tx link and exactly one summary toast fires (no storm)
- A fill observed by both the WS frame and the poll-diff fallback produces exactly one toast and one inbox entry (dedupeKey verified in the store)
- Inbox persists across reload (localStorage) and mark-all-read clears the badge
- docs.noether.exchange serves the waterfall page with the contract-version stamp matching contracts.json, current-vs-Batch-1 sections clearly labeled, and the numbers (100% trigger, 20%/30s/#83 partial-liq, 5%-cap-10% keeper reward today, 1%-notional 50/50 at Batch 1, 10% buffer share) — reviewed against code before publish
- `npx tsc --noEmit` and `npm run build` green with the flag on and off

**Risks:** Double-toast between the WS path and the retained poll-diff fallback — the shared store dedupeKey is the only guard, so route BOTH paths through it and test it. login_wallet costs one extra wallet signature per session — keep it strictly opt-in and non-blocking or it becomes a conversion tax; never persist the session credential. Docs risk: publishing future (Batch-1) liquidation numbers as current facts would be a trust own-goal — the version stamp + two-stage structure is load-bearing, and the page must be re-verified at the coupled redeploy (event shapes AND penalty math change with L1-8/L0-4). Event-format drift: mapFrame consumes L1-9's typed frames, which change arity at Batch 1 — arity-tolerant frame handling mirrors the indexer decoders. Introducing vitest to web/ is new infra — keep it scoped to lib/ pure modules so it never touches the Next build. The 'adl' type stays reserved until L0-1's adl_executed event exists; wiring it early against a guessed shape would break at Batch 1.

## Data & API (L1-11..L1-16)

### L1-11 · Funding data API (REST + WS + SDKs + per-position accrued)

**Status:** todo · **Effort:** M · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** — · **Blocks:** —
**Cross-refs:** LIGHTER-GAP §Platform, API & trust — [P1/M] Funding data API · LIGHTER-GAP §Mark price, index & funding — [P1/M] Funding & pricing data API · AUDIT M-7 (funding only accrues when poked — shapes the nextEligibleAt semantics) · TASKS P2-12 (keeper funding tri-state, 1h+30s cadence) · UIUX-RESEARCH B4 (per-position accrued-funding cell — the exact math to mirror server-side) · **Gap rows:** Platform, API & trust: Funding data API (current rate, history, predicted/accrued) · Mark price, index & funding: Funding & pricing data API (current, predicted, history, per-position accrued)

**Current state (verified):** PROD+STAGING contract: apply_funding computes ONE global rate from TotalLongSize/TotalShortSize (storage keys take no asset — contracts/market/src/storage.rs:27-36) and emits funding_applied with data (funding_rate: i128 PRECISION-scaled hourly fraction, hours_elapsed: u64) at contracts/market/src/lib.rs:726-729, behind a 3600s min-interval gate (lib.rs:697). The indexer decodes it (indexer/src/decoders/market.ts:186-192), archives it to events_raw (handlers/market.ts:274-285) and emits an in-process bus 'funding' event (handlers/market.ts:116-122) that dies inside the indexer container — the api is a separate process whose LiveTailer polls events_raw but fans out only position topics + account events (api/src/services/liveTailer.ts:19-25,100-124). The gateway exposes ZERO funding endpoints (no funding route in api/src/routes/; the "Phase 3.1" TODO sits at api/src/services/markets.ts:10-15) and the WS surface is only ticker.*/trades.*/events/account.events.* (api/src/services/wsBus.ts:52-59, wsManager.ts canSubscribe :226-240). Web reads CurrentFundingRate/CumulativeFundingRate chain-direct via getLedgerEntries (web/lib/stellar/market.ts:1571-1614) and computes pendingFunding = size × (cum − entry_cumulative_funding)/PRECISION signed by direction (market.ts:345-354, UIUX B4) — unusable for integrators. Neither SDK has any funding surface (grep of sdk-ts/src/sub + sdk-py/noether_sdk/sub /v1 paths: none), and /v1/positions/open rows carry only positionId/trader/asset/direction/size/entryPrice/openedAt/openedTxHash (api/src/routes/positions.ts:23-34); the positions projection has no funding-snapshot column (indexer/migrations/001_baseline.sql:112-122).

**Design:** All units: amounts i128 7-decimal USDC strings; rates i128 PRECISION-scaled (1e7) hourly fractions, ratePct = rate/1e7×100 (%/h).

1. INDEXER PROJECTION — migration 006_funding_rates.sql: `CREATE TABLE funding_rates (event_id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, asset TEXT NOT NULL DEFAULT '*', rate TEXT NOT NULL, hours BIGINT NOT NULL, cumulative TEXT NOT NULL, ledger BIGINT NOT NULL, ts BIGINT NOT NULL, tx_hash TEXT NOT NULL)`; INDEX (asset, ts DESC). asset='*' is the global-rate sentinel — when L0-13 re-keys funding per asset the same table takes real symbols with zero schema change (this is the "asset column ready" requirement). The handler (handlers/market.ts case 'funding_applied') inserts inside the same tx as insertEvent, computing running cumulative per (contract_id, asset): cumulative = prev_cumulative + rate×hours (prev=0 when no earlier row — matches the contract's unwrap_or(0) at storage.rs:239-241). Add a boot-time reconciliation task: compare the latest projected cumulative vs the on-chain CumulativeFundingRate ledger entry; log+alert on mismatch (drift means missed events; accrued math is only exact over windows with complete history).
2. API — new api/src/services/funding.ts (FundingService): reads CurrentFundingRate/CumulativeFundingRate/LastFundingTime PERSISTENT keys via one batched getLedgerEntries (same technique as web market.ts:1571-1614), TtlCache 10s. Routes (new api/src/routes/funding.ts): GET /v1/funding/current → {rates:[{asset:'*', scope:'global', ratePerHour, ratePerHourPct, cumulativeIndex, lastAppliedAt, nextEligibleAt, intervalS:3600}]} — nextEligibleAt = lastAppliedAt+3600 (contract gate lib.rs:697); document that application is keeper-driven (cadence 3600s+30s, scripts/keeper/src/index.ts:88) so nextEligibleAt is eligibility, not a promise. GET /v1/funding/history?asset=&limit=(default 100, max 1000)&before_ts= → funding_rates rows DESC (cursor pattern per audit A-7). Fold funding:{ratePerHour, ratePerHourPct, cumulativeIndex, lastAppliedAt, nextEligibleAt, scope} into /v1/markets and /v1/markets/:asset responses (additive schema fields, same cache).
3. ACCRUED — /v1/positions/open rows gain accruedFunding (7-dec USDC string, positive = position pays at close) + fundingAsOf: entrySnapshot = cumulative of the last funding_rates row with asset IN ('*', :asset) AND ts <= openedAt (0 when none — exactly the contract snapshot at open, lib.rs:395); accrued = size×(cumNow − entrySnapshot)/PRECISION, Long pays positive delta / Short the negation (mirrors web market.ts:349-353 and contract settlement at lib.rs:2145). One SQL lateral join, never N queries; return accruedFunding:null when the history window has a detected gap (money-truth rule: never fabricate).
4. WS — LiveTailer adds topic==='funding_applied' → bus.emit('funding', {asset:'*', rate, ratePct, hours, cumulativeIndex, ledger, ts}); WsBusMap gains funding: FundingPayload; wsManager.canSubscribe accepts 'funding' (public) and reserve `funding.<ASSET>` naming for L0-13.
5. SDKs — sdk-ts src/sub/funding.ts {current(), history(opts)} + typed FundingPayload on WsClient; sdk-py noether_sdk/sub/funding.py mirror; ride the L1-14 0.1.2 publish or the next patch.
6. HONESTY — every endpoint description + the docs funding page state plainly: one global exchange-wide rate spans all 14 pairs until L0-13, magnitude capped by base_funding_rate_bps=1 (≈0.01%/h max at 100% skew, types.rs:208).

No contract changes anywhere; error codes unchanged.

**Implementation**

**indexer**
- [ ] Add migrations/006_funding_rates.sql with the funding_rates table (asset TEXT DEFAULT '*', rate/hours/cumulative/ledger/ts/tx_hash) + (asset, ts DESC) index
- [ ] Extend handlers/market.ts funding_applied case: insert the funding_rates row in the same write transaction, computing running cumulative from the previous row per (contract_id, asset)
- [ ] Add boot-time reconciliation: latest projected cumulative vs the on-chain CumulativeFundingRate ledger entry; warn+alert on mismatch
- [ ] Tests: funding projection writes correct cumulative across 3 sequential events; replay/duplicate event is idempotent (no double-count); cold-start with empty table seeds cumulative from rate×hours

**api**
- [ ] New services/funding.ts: batched getLedgerEntries read of CurrentFundingRate/CumulativeFundingRate/LastFundingTime persistent keys, 10s TtlCache, null-safe (RPC failure → nulls, never 0)
- [ ] New routes/funding.ts: GET /v1/funding/current + GET /v1/funding/history?asset=&limit=&before_ts= with response schemas + OpenAPI tags
- [ ] Extend routes/markets.ts + services/markets.ts: additive funding object on /v1/markets and /v1/markets/:asset
- [ ] Extend routes/positions.ts: accruedFunding + fundingAsOf via SQL as-of join against funding_rates; null on gap
- [ ] LiveTailer: emit 'funding' bus frames for funding_applied rows; wsBus.ts FundingPayload type; wsManager canSubscribe('funding')
- [ ] Tests: funding.test.ts (current shape, nextEligibleAt = lastApplied+3600, history pagination), positions accruedFunding fixture math + null-on-gap, ws funding-frame delivery

**sdk-ts**
- [ ] Add src/sub/funding.ts (current/history) + register on client; add 'funding' channel typing to WsClient
- [ ] Tests: test/funding.test.ts parsing fixtures for both endpoints + ws frame

**sdk-py**
- [ ] Add noether_sdk/sub/funding.py mirror + models; register on client; ws channel constant
- [ ] Tests: tests/test_funding.py

**docs**
- [ ] New developers/funding page: endpoints, units (PRECISION-scaled hourly fraction; deci-bps NOT used here), accrued sign convention, and the explicit "global rate until per-asset funding ships" caveat with the 0.01%/h cap
- [ ] Add the funding channel to the WebSocket docs page

**Acceptance:**
- indexer test "projects funding_applied into funding_rates with running cumulative" passes: 3 events (rate r1..r3, hours h1..h3) yield cumulative r1h1, r1h1+r2h2, ...
- indexer test "funding projection is replay-idempotent" passes: re-applying the same event_id leaves one row and unchanged cumulative
- api test: GET /v1/funding/current returns ratePerHour equal to the seeded CurrentFundingRate ledger value and nextEligibleAt = lastAppliedAt + 3600
- api test: GET /v1/positions/open row accruedFunding equals size×(cumNow−entrySnapshot)/1e7 for a fixture with a funding event between open and now, and is null when a history gap is flagged
- WS integration test: a client subscribed to 'funding' receives exactly one frame per funding_applied row inserted into events_raw
- sdk-ts test/funding.test.ts and sdk-py tests/test_funding.py pass; both expose current() and history()
- Live staging check: curl /v1/funding/current matches the rate the web MarketStatsBar renders (same chain read); /v1/funding/history returns ≥1 row after the next keeper apply_funding
- OpenAPI at /docs shows the two funding routes with the global-rate caveat in their descriptions

**Risks:** Event-format drift is the main hazard: L0-13 (batch-1) re-keys funding per asset and will change funding_applied (asset added to topic or data) — the decoder must then accept BOTH the deployed 2-tuple and the new form, and the '*' sentinel keeps pre-migration history queryable; land that decoder tolerance inside L0-13 but design the table for it now. Cumulative reconstruction drifts silently if the indexer misses events (retention clamp / cold-start lookback) — the boot reconciliation vs on-chain CumulativeFundingRate plus null-on-gap accrued keeps us honest. nextEligibleAt is contract eligibility, not keeper behavior — a keeper/contract parity note is required in docs or users will report "late" funding as a bug. Zero WASM impact (no contract changes).

### L1-12 · Machine-readable per-market specs endpoint + docs table

**Status:** todo · **Effort:** M · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** — · **Blocks:** L1-13
**Cross-refs:** LIGHTER-GAP §Market specs & listings — [P1/S] Machine-readable per-market contract specifications · TASKS P5-1 (per-market RiskConfig + admin setter — the future per-asset source this endpoint auto-adopts) · TASKS P5-2 (MM = IM/2 invariant encoded in RiskConfig) · TASKS G-2 (new-pair 3-5x policy — becomes visible/verifiable through this endpoint) · UIUX-RESEARCH B27 (per-pair "Contract details" popover, docs/UIUX-RESEARCH-2026-07.md:1351) · **Gap rows:** Market specs & listings: Machine-readable per-market contract specifications (API + docs table)

**Current state (verified):** PROD+STAGING: no endpoint or docs table exposes trading rules — /v1/markets returns asset metadata + oracle price only (api/src/routes/markets.ts:59-117) and /v1/markets/stats adds OI/volume without specs (markets.ts:34-57); the "Phase 3.1" TODO sits at api/src/services/markets.ts:10-15. The rules live only in Rust: MarketConfig defaults at contracts/noether_common/src/types.rs:200-219 (min_collateral 10 USDC, max_leverage 10, mm 100 bps, liq fee 500 bps, max_position_size $100k, staleness 60s, deviation 100 bps, partial-liq 20%/30s/$1k), fee tiers at contracts/market/src/trading.rs:27-49 (deci-bps, testnet thresholds $20K/$50K/$100K), KeeperFeeConfig at types.rs:378-383 (0.50 USDC + 5 bps), vault cap defaults at contracts/vault/src/storage.rs:62-63 (7000/2500 bps) with NO public getters (ReserveCapBps instance storage :211-217, AssetCapBps persistent :219-230), and router sanity bands as a hardcoded const fn at contracts/noether_router/src/lib.rs:659-686 (not chain-readable at all). The market's get_config view was REMOVED for WASM (comment at contracts/market/src/lib.rs:2539; config is instance storage, storage.rs:140-145), so specs cannot be read by simulation. CODE-COMPLETE: the risk contract has get_config(asset) (contracts/risk/src/lib.rs:86) but is undeployed — contracts.json has no risk key. UIUX B27 (in-app contract-spec popover) is open.

**Design:** One SpecsService (api/src/services/specs.ts), TtlCache 60s, composing per-asset spec objects from four sources:

- (a) MarketConfig — new contractReader.readInstance(contractId): getLedgerEntries on the contract-instance key (xdr.ScVal.scvLedgerKeyContractInstance()), decode the ScContractInstance storage map, extract DataKey::Config → all MarketConfig fields (no view exists; this is the only read path). Fallback when the read fails: compiled defaults mirrored in a new packages/shared/src/specs.ts, with source:'defaults' stamped on the response (never silently wrong).
- (b) Per-asset risk — if the manifest resolves a risk contract (contracts.json key 'risk' or CONTRACT_RISK override), call risk.get_config(asset) via contractReader.read for {max_leverage, im_bps, mm_bps, skew_cap_bps, funding clamps}; else every asset gets the global MarketConfig values and imBps:null (no IM regime exists pre-L0-12). This is the "updates automatically" hook: the day batch-1 deploys risk + operators run risk.set_config, the endpoint turns per-asset with zero api changes.
- (c) OI caps — reserveCapBps from vault instance storage (default 7000), assetCapBps from vault persistent AssetCapBps(Symbol) entries (default 2500), reservedNow from vault.get_reserved_payout() simulation; absUsd:null until L0-14 adds the absolute field (then read it the same way).
- (d) Router bands — NOT chain-readable (const fn): mirror the 14-pair BANDS table into packages/shared/src/specs.ts as ROUTER_PRICE_BANDS with a pin-comment to noether_router/src/lib.rs:664-679 and a unit test asserting the known values; optionally (batch-1 rider, S) add a router view get_price_bounds(asset) so the mirror can be deleted — the router WASM has headroom, the market is untouched.

EXACT SHAPE (additive on /v1/markets rows and /v1/markets/:asset): `specs:{maxLeverage:10, imBps:null|n, mmBps:100, liquidationFeeBps:500, minCollateral:'100000000', maxPositionSizeUsd:'1000000000000', feeTiers:[{minVolume, makerFeeDeciBps, takerFeeDeciBps}×4], keeperFee:{baseUsdc:'5000000', variableBps:5}, partialLiq:{minNotional:'10000000000', trancheBps:2000, cooldownS:30}, oiCap:{reserveCapBps:7000, assetCapBps:2500, absUsd:null, reservedNow:'…'}, funding:{intervalS:3600, scope:'global', model:'skew-proportional', maxRatePerHourBps:1}, oracle:{source:'noeracle-shim', maxStalenessS:60, deviationBps:100, routerBand:{min,max}}, source:'chain'|'defaults', asOfLedger:n}`. Units annotated in the OpenAPI schema: amounts 7-dec i128 strings, fee tiers in deci-bps (FEE_PRECISION=100_000, 1 unit = 0.001%), everything else plain bps.

DOCS TABLE — in NoetherDEX/noether-docs add scripts/generate-specs.mjs (same pattern as the existing scripts/fetch-openapi.mjs) fetching /v1/markets at build and rendering pages/protocol/contract-specs.mdx (one row per pair: leverage, MM, liq fee, min/max size, OI caps, funding interval+cap, staleness/deviation/band); wire into the build so the table can never drift from the endpoint. SDKs: markets.specs(asset) in sdk-ts/src/sub/markets.ts + sdk-py mirror (thin picks of .specs). WEB B27: pair-selector "Contract details" popover consuming the same endpoint through web/lib/api/markets.ts — kills the pros-will-assume-5%-MM ambiguity flagged in UIUX B27.

**Implementation**

**packages/shared**
- [ ] Add src/specs.ts: MarketConfig default mirror + ROUTER_PRICE_BANDS 14-pair table (pin-comment to noether_router/src/lib.rs:664-679) + MarketSpecs TS type
- [ ] Test: specs.test.ts pins the band values and the defaults against the documented contract constants

**api**
- [ ] contractReader: add readInstance(contractId) — fetch the contract-instance ledger entry, decode the ScContractInstance storage map to a key→native map
- [ ] New services/specs.ts: compose specs per asset from market instance Config + optional risk.get_config + vault caps (instance ReserveCapBps, persistent AssetCapBps, get_reserved_payout sim) + shared band table; 60s TtlCache; source:'chain'|'defaults' stamping
- [ ] Extend routes/markets.ts: specs object on /v1/markets rows and /v1/markets/:asset with full response schema
- [ ] Tests: specs.test.ts — instance-storage fixture decodes all MarketConfig fields; risk-present fixture switches to per-asset values; RPC-failure path returns defaults with source:'defaults'; deci-bps vs bps fields asserted

**sdk-ts**
- [ ] markets.specs(asset) wrapper + MarketSpecs type re-export; test in test/markets.test.ts

**sdk-py**
- [ ] markets.specs(asset) mirror + model; test (new tests/test_specs.py)

**web**
- [ ] web/lib/api/markets.ts: getMarketSpecs(asset); B27 "Contract details" popover on the pair selector (trade page) rendering leverage/MM/fees/caps/oracle rows with an as-of badge; em-dash on failed fetch (money-truth)

**docs**
- [ ] noether-docs scripts/generate-specs.mjs fetching /v1/markets → pages/protocol/contract-specs.mdx table at build; link from the developers index
- [ ] Document units (7-dec strings, deci-bps fee tiers, bps everything else) on the same page

**contracts/noether_router**
- [ ] OPTIONAL (batch-1 rider, S): add get_price_bounds(asset) view returning the const band so the shared mirror can be deleted; router WASM has headroom, market untouched

**Acceptance:**
- api test "specs decodes MarketConfig from instance storage" passes with every field (mmBps 100, liquidationFeeBps 500, minCollateral '100000000', maxPositionSizeUsd '1000000000000')
- api test "specs falls back to shared defaults with source:defaults on RPC failure" passes
- api test "specs switches to per-asset risk.get_config values when a risk contract is resolved" passes — proving L0-12 lands with zero api changes
- Live staging: `curl /v1/markets/BTC | jq .specs` returns mmBps 100 and oiCap.reserveCapBps 7000 matching on-chain state
- packages/shared band-pin test fails if ROUTER_PRICE_BANDS is edited without matching values (manual-drift tripwire)
- docs build generates protocol/contract-specs.mdx with one row per supported pair (14) and fails the build when the gateway is unreachable
- sdk-ts and sdk-py markets.specs() tests pass; the endpoint appears in the L1-14 parity walk
- web: pair-selector popover renders live specs on staging; failed fetch renders em-dashes, not zeros

**Risks:** The router bands and any 'defaults' fallback are the only two places specs can lie — the band mirror is a manual-drift surface until the optional router view ships (flag every router-band edit as a two-file change), and the defaults mirror must be updated in the same PR as any MarketConfig default change (the pin tests are the tripwire). Instance-storage decoding is SDK-version-sensitive (ScContractInstance layout) — test against the pinned @stellar/stellar-sdk v14. When batch-1 lands (L0-12/13/14) the endpoint auto-updates from chain, but the funding.scope/model strings and oiCap.absUsd must be flipped in the same release as those contract changes or the endpoint under-describes the new regime. No market WASM impact; the optional router view rides batch-1 only if the surface freeze (L0-18) hasn't happened yet.

### L1-13 · Pool-capacity headroom API + OrderPanel clamp

**Status:** todo · **Effort:** M · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** L1-12 · **Blocks:** —
**Cross-refs:** LIGHTER-GAP §Platform, API & trust — [P1/S] Pool-capacity market data · AUDIT M-4 (no aggregate OI cap/reservation — the mechanism this exposes) · AUDIT V-3 (vault oversubscription — the reservation views this reads) · TASKS P1-3 (OI caps + real reservation, error #82, DONE — this item is its read-side) · TASKS P6-6 (guarded-launch config — published caps are part of the cap-raise-criteria story) · **Gap rows:** Platform, API & trust: Pool-capacity market data (the CLOB-depth translation) · Market specs & listings: Absolute per-market OI caps + net-skew cap (cap-exposure clause only — "expose live cap + utilization via the markets specs endpoint")

**Current state (verified):** PROD+STAGING: the enforcement exists on-chain — vault reserve_for_position rejects when reserved+amount exceeds AUM×reserve_cap_bps/10000, when the asset's per-side OI exceeds AUM×asset_cap_bps/10000, or when reserved+amount exceeds the vault's physical USDC balance, all as error #82 OpenInterestCapExceeded (contracts/vault/src/lib.rs:463-502; #82 defined at contracts/noether_common/src/errors.rs:137; defaults 7000/2500 bps at vault storage.rs:62-63). The market passes side_after = current per-asset side OI + size from its AssetExposure(Symbol) aggregates (contracts/market/src/lib.rs:2304-2319; storage at market storage.rs:82,216-227). But nothing exposes remaining HEADROOM: /v1/markets/stats returns only OI long/short/net + 24h volume (api/src/routes/markets.ts:9-27), the cap parameters have no public contract getters (ReserveCapBps instance :211-217, AssetCapBps persistent :219-230) and appear in no endpoint or docs table, and the ticker WS payload is price-only (api/src/services/wsBus.ts:18-24, oracleTicker.ts). The web learns about caps only from the post-signature error toast (web/lib/utils/contractErrors.ts:65: "#82 Open interest cap reached") — OrderPanel has no pre-trade clamp (grep: no headroom/capacity reference). The July #82 incidents that needed a $1M emergency prod vault deposit (2026-07-13) prove users hit this blind.

**Design:** New CapacityService (api/src/services/capacity.ts), 5s TtlCache, reading EXACTLY the values the contract checks so the clamp mirrors enforcement one-to-one (vault lib.rs:479-497): per refresh — one batched getLedgerEntries fetching vault ReservedPayout (persistent) + market AssetExposure(sym) for all 14 SUPPORTED_ASSETS (persistent) + the vault instance entry (for ReserveCapBps; default 7000 when absent) + AssetCapBps(sym) persistent entries (default 2500 when absent); plus two simulation reads via contractReader: vault.get_aum() (lib.rs:563) and usdcToken.balance(vault).

FORMULAS (all i128 7-dec USDC, floored at 0): reserveCap = AUM×reserveCapBps/10000; aggregateHeadroom = max(0, min(reserveCap − reservedPayout, vaultUsdcBalance − reservedPayout)); assetCap(a) = AUM×assetCapBps(a)/10000; headroomLong(a) = max(0, min(aggregateHeadroom, assetCap(a) − longSize(a))); headroomShort(a) symmetric with shortSize(a) — where longSize/shortSize are the ls/ss members of AssetExposure, the exact inputs reserve_with_vault passes (market lib.rs:2311-2315). Headroom is denominated in position NOTIONAL (size = collateral×leverage), because the reservation amount = size.

ENDPOINTS: GET /v1/markets/:asset/capacity → {asset, vaultAum, reservedPayout, reserveCapBps, assetCapBps, oiLong, oiShort, headroomLong, headroomShort, vaultUsdcBalance, asOfLedger, ts}; PLUS fold {headroomLong, headroomShort, assetCapBps} into each /v1/markets/stats row and {reserveCapBps, vaultAum, reservedPayout} at the response top level (additive schema). WS: extend TickerPayload with OPTIONAL headroomLong/headroomShort strings — oracleTicker reads the CapacityService cache each tick and includes them only when the cache is <15s fresh (omit, never fabricate — same money-truth rule as UX A14).

WEB CLAMP: web/lib/api/markets.ts getCapacity(asset) (React Query, 10s stale); OrderPanel computes notional = collateral×leverage and when notional > headroom(side): amber inline banner "Pool capacity: max ≈$X for {ASSET} {side} right now", clamp the size suggestion, and disable submit until under the bound — advisory only, the contract still enforces #82 (races between read and submit are expected; keep the existing #82 toast as the backstop). Degraded mode: capacity fetch fails → no clamp, behavior unchanged from today.

DOCS: publish reserveCapBps/assetCapBps + live utilization in the L1-12 specs table (oiCap.reservedNow already there; the capacity page explains the reservation model: every open reserves full notional, 70%/25% defaults). L0-14 forward-compat: when absolute caps land, assetCap(a) becomes min(bps-derived, absUsd) — the service adds one min() term and the response gains absUsd; the net-skew cap likewise appears as a third headroom constraint. Optional batch-1 rider (NOT required): vault views get_reserve_cap_bps()/get_asset_cap_bps(asset) to replace the raw storage reads — vault WASM has headroom.

**Implementation**

**api**
- [ ] New services/capacity.ts: batched ledger-entry reads + get_aum/balance sims, 5s TtlCache, headroom formulas mirroring vault lib.rs:479-497 with saturating floors
- [ ] New route GET /v1/markets/:asset/capacity + extend /v1/markets/stats rows with headroomLong/headroomShort/assetCapBps and top-level reserveCapBps/vaultAum/reservedPayout (schemas updated)
- [ ] oracleTicker: attach headroomLong/headroomShort to ticker frames when the capacity cache is <15s fresh; omit otherwise
- [ ] Tests: capacity.test.ts — fixture (AUM 1000, reserved 650, reserveCapBps 7000 → aggregateHeadroom 50; asset long 200 / cap 250 → headroomLong 50 = min(agg, 50)); floor-at-zero case; vault-balance-binding case; stale-cache ticker omission

**web**
- [ ] web/lib/api/markets.ts: getCapacity(asset) wrapper + React Query hook (10s)
- [ ] OrderPanel: pre-signature clamp — amber capacity banner + submit disable when notional > headroom(side); graceful no-clamp fallback on fetch failure; keep the #82 toast as backstop
- [ ] `npx tsc --noEmit` clean

**sdk-ts**
- [ ] markets.capacity(asset) wrapper + headroom fields on stats/ticker types; test

**sdk-py**
- [ ] markets.capacity(asset) mirror + model fields; test

**docs**
- [ ] Capacity/OI-cap section on the market-specs docs page: reservation model (full-notional, 70% aggregate / 25% per-asset-side defaults), headroom semantics (notional, per side), and the #82 error mapping

**contracts/vault**
- [ ] OPTIONAL (batch-1 rider, S): add get_reserve_cap_bps() + get_asset_cap_bps(asset) views so the API can drop raw storage reads; include in the audit-frozen surface if taken

**Acceptance:**
- api test "headroom mirrors vault reserve checks" passes on the documented fixture (aggregate binding, asset-cap binding, vault-balance binding, floor at 0)
- Live staging: GET /v1/markets/BTC/capacity returns reservedPayout equal to the vault.get_reserved_payout() simulation and headroomLong + oiLong ≤ AUM×assetCapBps/10000 within one refresh window
- e2e (staging): an open sized just UNDER headroomLong succeeds; sized just OVER fails with contract error #82 — proving the mirror matches enforcement
- Ticker WS frames on staging carry headroomLong/headroomShort strings; frames omit the fields (not zero) when the capacity cache is stale
- OrderPanel on staging shows the capacity banner and disables submit when the requested notional exceeds headroom; with the gateway blocked (devtools), ordering behaves exactly as today
- sdk-ts + sdk-py capacity tests pass and the endpoint is covered in the L1-14 parity walk
- Docs market-specs page lists reserveCapBps/assetCapBps with the reservation-model explanation

**Risks:** Headroom is advisory and racy by construction (5s cache + ledger close) — the clamp must never be sold as a guarantee, and the #82 backstop toast stays; document the race. Formula parity with the contract is the core correctness risk: any batch-1 change to reserve_for_position (L0-14 absolute caps, net-skew cap) MUST update CapacityService in the same release or the clamp misleads — add a parity fixture test that re-derives the vault check from the same inputs. The AssetExposure read couples the API to a market storage-key layout (tuple (lk,ls,sk,ss)) — a batch-1 storage change breaks the decode silently; pin with a test against a recorded ledger entry and re-record at redeploy. The vault instance-storage read for ReserveCapBps shares the ScContractInstance decode risk from L1-12 (shared helper, shared test). No WASM impact unless the optional vault views are taken (the vault has headroom; the market is untouched).

### L1-14 · SDK endpoint coverage + publish the 0.1.2 pair

**Status:** todo · **Effort:** S · **Lane:** mixed · **Ships in:** offchain-now · **Needs:** L0-21, L1-4, L1-6 · **Blocks:** L1-16
**Cross-refs:** LIGHTER-GAP §Platform, API & trust — [P1/S] SDK coverage of shipped market-data endpoints + publish the fixed Python SDK · AUDIT S-2 (published sdk-py cannot issue API keys — fix exists locally only) · AUDIT S-5 (SDK surface drift from gateway endpoints) · TASKS P4-19 (sdk-py key issuance fixed; OPERATOR publish 0.1.2 outstanding) · TASKS P4-21 (missing SDK endpoints round 1 — this closes the residue and adds the drift-proof CI) · **Gap rows:** Platform, API & trust: SDK coverage of shipped market-data endpoints + publish the fixed Python SDK

**Current state (verified):** The gateway serves 36 /v1 paths (grep api/src/routes) but both SDKs omit six of them: verified zero references in sdk-ts/src/sub or sdk-py/noether_sdk/sub to /v1/candles, /v1/trades, /v1/leaderboard, /v1/markets/stats, /v1/account/volume, or /v1/oracle/health (path grep of both sub trees). Local sdk-ts is 0.1.2 (sdk-ts/package.json, npm name 'noether-sdk') and local sdk-py is 0.1.2 (noether_sdk/__init__.py:38) with the S-2 manageData-challenge fix present (noether_sdk/sub/keys.py:28-48) — but the PUBLISHED releases are both 0.1.1 (npm + PyPI; the docs site's own callout at Noether_Docs/pages/developers/sdk-py.mdx:5,10 says "API-key issuance is broken in 0.1.1"), so a Python integrator today cannot authenticate at all. The tx-builders arity break (L0-21) additionally means 3 of 10 order ops in the published packages fail Soroban simulation against the 2026-07-06/10 deployments (packages/tx-builders/src/market/placeLimitOrder.ts:25-36 sends 8 args vs place_limit_order's 9 at contracts/market/src/lib.rs:1175-1186, with the stale count PINNED by test/builders.test.ts 'toHaveLength(8)'). No CI exists that fails when the gateway grows a path the SDKs lack (.github/workflows/ci.yml runs per-package tests only).

**Design:**

1. WRAPPERS — mirror routes 1:1, thin, no logic: sdk-ts adds markets.stats() → GET /v1/markets/stats; markets.candles({asset, interval, limit}) → GET /v1/candles (interval enum from the route schema; response keeps the source field); new sub-client trades.list({trader?, asset?, kind?, include_opens?, limit?, before_ts?}) → GET /v1/trades (kind enum open|close|liquidation|cross_liquidation per api/src/routes/trades.ts:17); new sub-client leaderboard.get({sort:'pnl'|'volume', limit}) → GET /v1/leaderboard; account.volume(address) → GET /v1/account/volume?address= (public, no auth); oracle.health() → GET /v1/oracle/health. sdk-py mirrors all six on the same sub-client names (markets.stats/candles on markets.py, new sub/trades.py, new sub/leaderboard.py, account.volume, oracle.health). Documented exclusion (not wrapped): POST /v1/oracle/heartbeat — keeper-to-gateway machine endpoint, secret-gated (api/src/routes/oracleHealth.ts:9,43).
2. PARITY CI — api gains an openapi:dump script: build the Fastify app without listen(), await app.ready(), write JSON.stringify(app.swagger()) to api/openapi.json (the app already registers @fastify/swagger — api/src/server.ts:81-93). sdk-ts exports src/coverage.ts: COVERED_PATHS: readonly string[] where every sub-client registers the exact route templates it wraps; test/parity.test.ts loads the dumped spec, normalizes Fastify :param to {param}, subtracts an explicit EXCLUDED_PATHS list (each entry with a why-comment), and fails listing any uncovered path. sdk-py tests/test_parity.py does the identical walk against the same artifact with its own registry. CI wiring in .github/workflows/ci.yml: the api job generates openapi.json (artifact or in-job regeneration) before the sdk-ts and sdk-py jobs run their parity tests — SDK lag becomes a red build instead of silent drift.
3. PUBLISH (operator runbook, executed only after L0-21's tx-builders fixes merge — founder-fixed coupling): bump both packages to 0.1.2 final with CHANGELOG entries (S-8 hygiene: S-2 auth fix, arity fixes, new endpoints); sdk-ts: `npm run build` (tsup) → `npm publish` from sdk-ts/ (package 'noether-sdk'); sdk-py: hatch build → twine upload (package 'noether-sdk', version from __init__.py); git tags sdk-ts-v0.1.2 + sdk-py-v0.1.2. Post-publish verification: `pip install noether-sdk==0.1.2` in a clean venv → issue a key against staging (proves S-2 dead in the wild); `npm i noether-sdk@0.1.2` in a scratch project → orders.prepare a limit order → simulation passes (proves L0-21 in the wild). Publish the pair TOGETHER — never ship new market-data wrappers on top of broken order builders.

**Implementation**

**sdk-ts**
- [ ] Add markets.stats() + markets.candles(); new sub-clients trades.ts and leaderboard.ts; account.volume(); oracle.health() — all thin transport.request wrappers with typed responses
- [ ] Add src/coverage.ts COVERED_PATHS registry populated by every sub-client; export for the parity test
- [ ] test/parity.test.ts: walk api/openapi.json paths minus EXCLUDED_PATHS (oracle/heartbeat with comment), fail on any uncovered path
- [ ] Fixture tests for each new wrapper; version 0.1.2; CHANGELOG entry

**sdk-py**
- [ ] Mirror the six wrappers (markets.stats/candles, sub/trades.py, sub/leaderboard.py, account.volume, oracle.health) + models
- [ ] tests/test_parity.py walking the same openapi.json artifact against a Python-side registry
- [ ] Wrapper tests; confirm __version__ 0.1.2; CHANGELOG entry

**api**
- [ ] Add openapi:dump script (boot app, await ready, write app.swagger() JSON to api/openapi.json); generate in CI, never hand-edit
- [ ] Ensure the six wrapped routes all carry complete response schemas (they feed SDK types)

**ops**
- [ ] Wire .github/workflows/ci.yml: api job dumps openapi.json → sdk-ts and sdk-py jobs consume it for parity tests
- [ ] AFTER L0-21 merges: publish runbook — npm publish sdk-ts 0.1.2 + twine upload sdk-py 0.1.2 together; tag both; clean-venv/scratch-project verification of key issuance + limit-order prepare against staging

**docs**
- [ ] Hand the 0.1.2 re-pinning to L1-16's docs sweep (sdk-ts.mdx/sdk-py.mdx currently document 0.1.1 with the broken-issuance warning — delete the callouts once 0.1.2 is live)

**Acceptance:**
- sdk-ts test/parity.test.ts and sdk-py tests/test_parity.py exist and PASS against the generated openapi.json; deleting any COVERED_PATHS entry makes them fail (verified once in review)
- All six new wrapper tests pass in both SDKs (stats, candles, trades, leaderboard, account volume, oracle health)
- CI run shows the parity jobs consuming the api-generated openapi.json on every push
- npm shows noether-sdk 0.1.2 and PyPI shows noether-sdk 0.1.2, published the same day, each with a CHANGELOG entry
- Clean-venv check: `pip install noether-sdk==0.1.2` → challenge → exchange issues a working key against staging (S-2 verified dead in the published artifact)
- Scratch-project check: noether-sdk@0.1.2 orders.prepare for a limit order returns an unsigned XDR that passes simulateTransaction against the current staging market (L0-21 verified in the published artifact)

**Risks:** The one hard rule is publish-coupling: 0.1.2 with new market-data wrappers but WITHOUT the L0-21 arity fixes would ship a second broken release and burn the remaining integrator trust — the publish step is gated on L0-21 merged and simulation-verified. Parity-test blind spot: it checks path existence, not schema/param correctness — L0-21's simulation-based builder CI covers the write path; read-path response drift is still only caught by wrapper fixtures (note it, don't oversell). The openapi.json artifact must never become a hand-edited second source of truth — CI-generated only; the docs repo's fetch-openapi.mjs keeps pulling from the live gateway. Batch-1 adds routes (L1-11 funding, L1-13 capacity, L1-6 margin) — the parity CI is exactly what forces SDK follow-through, so land it FIRST among this cluster's SDK work. No contract/WASM impact.

### L1-15 · Open-access mode + MM tier path + key management surface

**Status:** todo · **Effort:** M · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** L1-27 · **Blocks:** —
**Cross-refs:** LIGHTER-GAP §Platform, API & trust — [P1/M] Developer access program · LIGHTER-GAP §Fees & incentives — [P2/S] Self-serve API/MM tier · AUDIT SEC-5 (fail-closed defaults — the origin of the boot refusal this item makes configurable) · AUDIT A-1 (tiered per-key rate limiting — the 6000/min tier this makes reachable) · TASKS P0-14 (fail-closed defaults DONE — API_ACCESS_MODE extends it, does not weaken it) · KNOWN_ISSUES G-1 (wallet-only vs gated classification lesson for the restored page) · KNOWN_ISSUES G-5 (API_HMAC_PEPPER stability — unchanged invariant for all key work) · **Gap rows:** Platform, API & trust: Developer access program: closed-beta→open-access path, key lifecycle UX, MM tier · Fees & incentives: Self-serve API/MM tier — the Premium-account analog is unreachable

**Current state (verified):** PROD gateway boot REFUSES an empty allowlist: assertProductionEnv throws "API_KEY_ALLOWLIST must be set in production" (api/src/config.ts:100-104), so no supported open-access configuration exists — graduating from closed beta requires code changes at launch pressure. The market_maker tier exists only as data: rateLimit.ts defines public 60 / standard 600 / market_maker 6000 requests-per-minute (api/src/services/rateLimit.ts:11-13) but ApiKeyStore.issue() defaults tier='standard' (api/src/services/apiKeys.ts:33) and the only caller passes no tier (api/src/routes/keys.ts:178) — upgrades are undocumented manual DB edits. The in-browser key page was deleted 2026-07-12 (web commit c2d8d72 "API keys page retired to docs"; web/app has no api-keys dir) though its client wrappers survive intact (web/lib/api/keys.ts: requestChallenge/exchangeChallenge/listApiKeys/revokeApiKey). Keys have labels but no scopes, no expiry, and no per-owner cap (api_keys columns per apiKeys.ts:38-44: key_id, secret_hash, owner, tier, label, created_at, last_used_at, revoked_at); the allowlist is also frozen at module load (keys.ts:22 const ALLOWLIST). Key routes today: beta-status, challenge, POST/GET /v1/keys, DELETE /v1/keys/:keyId (keys.ts:69-235).

**Design:**

1. ACCESS MODE — new env API_ACCESS_MODE='allowlist'|'open' (default 'allowlist'). config.ts: in production, mode 'allowlist' keeps the current refusal of an empty API_KEY_ALLOWLIST (SEC-5 unchanged); mode 'open' permits an empty allowlist and REQUIRES the abuse guards active. keys.ts: move allowlist loading into route registration (kill the module-level const for testability); POST /v1/keys in open mode skips the allowlist check and enforces: (a) per-wallet active-key cap — API_MAX_KEYS_PER_WALLET default 5; issue() first counts WHERE owner=? AND revoked_at IS NULL and rejects with 403 {error:'key_limit_reached'}; (b) per-IP issuance throttle — dedicated bucket 'issue:<ip>' in the existing rate_limit_buckets table, API_KEY_ISSUANCE_PER_DAY default 10; (c) optional wallet-age heuristic — API_MIN_WALLET_AGE_HOURS (default 0 = off): Horizon GET /accounts/:id, reject younger accounts with 403 {error:'wallet_too_new'}, fail-open on Horizon errors so Horizon downtime never blocks issuance. GET /v1/keys/beta-status gains mode:'allowlist'|'open' (additive). Graduation to open access becomes a flag flip + announcement, no deploy.
2. TIER PATH — ops-reviewed, not auto (14d volume is cheaply washable on an oracle-fill venue — 2× taker fee per round trip — and auto-grant would hand 10× rate capacity to wash traders): new authed POST /v1/keys/:keyId/tier-request {requestedTier:'market_maker', contact, note} (owner-bound) → migration adds tier_requests(id, key_id, owner, requested_tier, note, contact, volume_14d_snapshot, status 'pending'|'approved'|'denied', created_at, decided_at); the handler snapshots StatsService.traderVolume14d(owner) into the row and fires the ops webhook (ALERT_WEBHOOK_URL). Grant path: scripts/admin/set-key-tier.ts (repo script, logged direct DB UPDATE api_keys SET tier=? WHERE key_id=?, closes the request row) — deliberately NOT an admin HTTP endpoint (no admin-auth surface exists in the gateway; adding one pre-audit is new attack surface). GET /v1/keys rows already return tier; the X-RateLimit-Tier header already exposes it per request. Publish request criteria + review SLA on the docs developers page ("reviewed, not automatic").
3. KEY LIFECYCLE — migration adds expires_at BIGINT NULL and scope TEXT NOT NULL DEFAULT 'trade' ('trade'|'read') to api_keys. POST /v1/keys accepts optional expiresInDays (1-365) and scope. Auth plugin: expired key → 401 {error:'expired_key'}; scope 'read' → 403 {error:'read_only_key'} on POST /v1/orders/prepare and POST /v1/tx/submit (the only mutating trade surface; keys can never sign txs regardless — non-custodial — so 'read' chiefly protects account privacy and blocks prepare/submit relay).
4. SURFACE — restore a minimal web /app/api-keys page from the c2d8d72 parent commit, rebuilt on the surviving web/lib/api/keys.ts wrappers: connect wallet → mode-aware beta-status banner → issue (label + optional expiry/scope) → one-time secret display → list with last-used/expiry → revoke; classify per the G-1 lesson (issuance = wallet-only public flow, list/revoke = key-authed). Optional follow-up: `noether-keys` CLI (sdk-ts bin) reusing keys.challenge/exchange — nice-to-have, not gating.
5. LAUNCH RUNBOOK — flip: set API_ACCESS_MODE=open on the Azure gateway app, keep API_CORS_ORIGIN strict and API_HMAC_PEPPER untouched (G-5), verify beta-status {gated:false, mode:'open'}, announce via the L1-16 #api-updates channel.

**Implementation**

**api**
- [ ] config.ts: API_ACCESS_MODE parse + production assertions per mode (allowlist keeps the refusal; open requires guards); expose accessMode on config
- [ ] Migration: api_keys ADD COLUMN expires_at BIGINT NULL, scope TEXT NOT NULL DEFAULT 'trade'; new tier_requests table
- [ ] apiKeys.ts: issue() gains expiresAt/scope params + active-key count cap; lookup paths return the new fields
- [ ] keys.ts: allowlist loading at registration time; open-mode issuance path with key cap + per-IP issuance bucket + optional wallet-age check; expiry/scope on POST /v1/keys; mode on beta-status
- [ ] auth plugin: reject expired keys (401 expired_key); enforce scope 'read' 403 on /v1/orders/prepare + /v1/tx/submit
- [ ] New POST /v1/keys/:keyId/tier-request with volume_14d snapshot + ops webhook
- [ ] Tests: accessMode.test.ts (open boots with empty allowlist + issues; allowlist mode still refuses empty in prod), key cap (6th key → 403 key_limit_reached), issuance IP throttle, expired-key 401, read-scope 403 on prepare/submit, tier-request row + snapshot

**web**
- [ ] Restore /app/api-keys (from commit c2d8d72's parent) on web/lib/api/keys.ts wrappers: mode-aware banner, issue with label/expiry/scope, one-time secret, list, revoke
- [ ] Add a "request market-maker tier" action posting to the tier-request endpoint from the key list
- [ ] `npx tsc --noEmit` clean

**sdk-ts**
- [ ] keys.create() accepts expiresInDays/scope; expose tierRequest(); OPTIONAL `noether-keys` bin (issue/list/revoke via challenge flow with a local keypair signer)

**sdk-py**
- [ ] Mirror expiry/scope params on keys.create() + tier_request(); tests

**docs**
- [ ] developers/authentication: document API_ACCESS_MODE semantics, key caps, expiry/scope, and the MM-tier request criteria + SLA ("reviewed, not automatic")

**ops**
- [ ] scripts/admin/set-key-tier.ts (logged DB update + request-row close)
- [ ] Launch-flip runbook entry: set API_ACCESS_MODE=open on Azure, verify beta-status, announce in #api-updates

**Acceptance:**
- api test "open mode boots in production with empty allowlist and issues a key" passes; "allowlist mode still refuses empty allowlist in production" passes (SEC-5 preserved)
- api test "sixth active key for one wallet returns 403 key_limit_reached; revoking one allows issuance again" passes
- api test "expired key returns 401 expired_key on any authed route" and "scope=read key gets 403 read_only_key on /v1/orders/prepare and /v1/tx/submit but 200 on GET /v1/keys" pass
- api test "tier-request creates a pending row with a volume_14d snapshot and fires the webhook stub" passes
- GET /v1/keys/beta-status returns {gated, allowed, mode} and flips correctly under both env settings
- Staging manual pass: /api-keys page issues, lists, and revokes a key end-to-end with a wallet; the MM-tier request appears in the DB
- After scripts/admin/set-key-tier.ts grants market_maker, the key's requests return X-RateLimit-Tier: market_maker and sustain >600 req/min in a soak test
- Docs page documents mode, caps, expiry/scope, and tier criteria

**Risks:** The failure mode to avoid is weakening SEC-5: open mode must be an explicit opt-in that keeps every other fail-closed check (pepper, CORS) — test both boot paths. Never rotate API_HMAC_PEPPER during any of this (G-5: invalidates every key). Open-mode abuse guards are heuristics, not sybil-proof — key issuance grants rate limit only, not funds access (non-custodial prepare/submit), so the blast radius is DB rows and RPC load; the per-IP bucket bounds it. Auto-tier-by-volume was rejected deliberately: oracle fills make 14d volume washable at ~2× taker fee, and the 6000/min tier is exactly what a wash operation wants — keep the human review. The restored page must re-apply the G-1 classification (issuance public, management authed) or non-beta wallets hit 403 walls again. Selling the MM tier (fee terms, latency envelope) depends on L1-27's measured numbers — this item builds only the plumbing.

### L1-16 · Docs corrections + stable API domain + changelog channel

**Status:** todo · **Effort:** S · **Lane:** mixed · **Ships in:** operator-track · **Needs:** L1-14 · **Blocks:** —
**Cross-refs:** LIGHTER-GAP §Platform, API & trust — [P1/S] Docs accuracy + API change communication · AUDIT D-7 (doc-layer drift class — same failure mode, new instance) · TASKS P3-5 (docs ground-truth pass pattern) · TASKS P3-3 (verify_stack.sh address-drift gate — the docs CI here is its docs-side twin) · TASKS G-7 (hosted docs site — the live surface being corrected) · KNOWN_ISSUES D-1 (env-propagation drift pattern) · KNOWN_ISSUES D-3 (multi-service address drift + ledgerAgeSeconds detection) · **Gap rows:** Platform, API & trust: Docs accuracy + API change communication

**Current state (verified):** Verified directly in the local NoetherDEX/noether-docs clone (Noether_Docs/, HEAD 6a1fe9e, 2026-07-10 — the site auto-deploys from main, and the Azure cutover happened 2026-07-15, after this last commit): the RETIRED Railway base URL noetherapi-production.up.railway.app appears in at least 8 pages including pages/_meta.js:14, pages/index.mdx:50, pages/protocol/contracts.mdx:13,38, pages/protocol/networks.mdx:29-31, pages/protocol/architecture.mdx:10,112, and pages/developers/authentication.mdx:7,29,48 — the real gateway has been noether-api.proudmeadow-533cf0d8.germanywestcentral.azurecontainerapps.io since 2026-07-15. The DELETED noether.exchange/api-keys page (removed in web commit c2d8d72, 2026-07-12) is still the documented key-issuance path at pages/developers/sdk-py.mdx:11, pages/developers/authentication.mdx:218, pages/developers/sdk-ts.mdx:140, and pages/guides/faq.mdx:101. Both SDK pages pin the broken 0.1.1 releases (sdk-py.mdx:5 with its own "issuance is broken in 0.1.1" callout; sdk-ts.mdx:5). No changelog page, no announcement channel, and no docs CI exist (Noether_Docs/.github/workflows absent; only scripts/fetch-openapi.mjs + generate-llms.mjs). The gateway side is ready to be checked against: GET /v1/health echoes resolved contract addresses + indexer.ledgerAgeSeconds (api/src/routes/health.ts:5-14,41-66).

**Design:** Runbook-style, four workstreams.

1. STABLE DOMAIN FIRST (so the sweep writes the final URL once): CNAME api.noether.exchange → the Azure Container Apps gateway. Commands: `az containerapp hostname add -n <gateway-app> -g noether-rg --hostname api.noether.exchange` (returns the asuid TXT validation token) → registrar DNS: TXT asuid.api = <token>, CNAME api = noether-api.proudmeadow-533cf0d8.germanywestcentral.azurecontainerapps.io → `az containerapp hostname bind -n <gateway-app> -g noether-rg --hostname api.noether.exchange --environment <env>` (managed cert). Then update the ecosystem to the stable name: Azure gateway env API_PUBLIC_URL=https://api.noether.exchange (drives the OpenAPI servers field per P4-4), Vercel NEXT_PUBLIC_NOETHER_API_URL (prod; decide + document staging naming separately), SDK examples/README default base URLs, keeper heartbeat target if configured. Verification: `curl -s https://api.noether.exchange/v1/health | jq .contracts.market.address` equals contracts.json market; a wss connect to /v1/ws succeeds. The raw Azure hostname keeps working — no breaking cutover, never delete it.
2. DOCS SWEEP (noether-docs repo): single-source the base URL — new lib/site.ts exporting API_BASE='https://api.noether.exchange'; replace every hardcoded URL (the 8+ pages above import the constant; _meta.js reads it too); grep gate: zero occurrences of 'railway.app'. Rewrite key issuance to the SDK/curl flow as primary (authentication.mdx already documents the curl challenge flow; the sdk-py quickstart switches to keys.exchange() from 0.1.2): remove all four references to the deleted /api-keys web page now — correct regardless of L1-15's restore timing; re-add the page link in a follow-up once L1-15 ships it. Re-pin SDK pages to 0.1.2 and DELETE the "issuance broken in 0.1.1" + "pin websockets<14" callouts — this half is gated on the L1-14 publish; the URL half is NOT gated and lands immediately.
3. CHANGELOG + CHANNEL: new pages/developers/changelog.mdx — reverse-chronological entries {date, component: gateway|sdk-ts|sdk-py|contracts, breaking yes/no, migration note}; backfill: the Azure base-URL cutover (2026-07-15), the key-page retirement (2026-07-12), the 0.1.2 SDK pair. Stated policy on the same page: breaking API changes announced ≥14 days ahead in both the changelog and the channel, old+new surfaces run in parallel through the window where feasible (beats Lighter's ≥1-day commitment). Operator creates Discord #api-updates (announce-only); the changelog page and the gateway /docs description link it. Process rule: any main-repo PR that changes api/src/routes response/param shapes must include a changelog entry — add a PR-template checklist line.
4. DOCS CI (noether-docs .github/workflows/docs-ci.yml, on PR + daily cron): step 1 — node scripts/check-live.mjs: fetch ${API_BASE}/v1/health (API_BASE imported from lib/site.ts, the same constant pages render), assert status ok AND indexer.ledgerAgeSeconds < 600; step 2 — address truth: GENERATE the protocol/contracts.mdx address table at build from the /v1/health echo (new script beside fetch-openapi.mjs, same pattern as L1-12's generate-specs.mjs) so documented addresses structurally cannot drift from what the gateway serves — with a cached last-good artifact so a transient gateway outage degrades to a stale-but-labeled table instead of a failed deploy; step 3 — `grep -r 'railway.app' pages/` fails the build if found. The daily cron catches silent infra moves; PR mode catches regressions.

**Implementation**

**ops**
- [ ] Provision api.noether.exchange: az containerapp hostname add → registrar TXT asuid + CNAME → az containerapp hostname bind (managed cert); verify /v1/health + WS over the new name; keep the raw Azure hostname alive as fallback
- [ ] Update API_PUBLIC_URL on the Azure gateway app; update NEXT_PUBLIC_NOETHER_API_URL in Vercel (prod); redeploy web; decide + document staging gateway naming
- [ ] Create Discord #api-updates (announce-only) and post the backfilled cutover notices
- [ ] Add the main-repo PR-template checklist line: "route shape changed? → changelog entry + #api-updates draft"

**docs**
- [ ] noether-docs: add lib/site.ts (API_BASE single source); replace every hardcoded base URL (_meta.js:14, index.mdx:50, protocol/contracts.mdx:13,38, protocol/networks.mdx:29-31, protocol/architecture.mdx:10,112, developers/authentication.mdx + SDK pages) with the constant
- [ ] Rewrite key issuance to SDK/curl primary across sdk-py.mdx:11, authentication.mdx:218, sdk-ts.mdx:140, guides/faq.mdx:101 (drop the deleted /api-keys links; re-link when L1-15 restores the page)
- [ ] After the L1-14 publish: re-pin sdk-ts.mdx + sdk-py.mdx to 0.1.2 and delete the 0.1.1 broken-issuance / websockets<14 callouts
- [ ] Add pages/developers/changelog.mdx with backfilled entries + the ≥14-day breaking-change policy + channel link
- [ ] Generate the protocol/contracts.mdx address table at build from the /v1/health echo (script beside fetch-openapi.mjs) with a cached last-good fallback
- [ ] Add .github/workflows/docs-ci.yml: PR + daily cron — health liveness (status ok, ledgerAgeSeconds<600), address-table generation, railway.app grep gate

**api**
- [ ] Confirm the OpenAPI servers URL follows API_PUBLIC_URL after the env change (P4-4 wiring) — no code expected; fix if hardcoded

**Acceptance:**
- `curl -s https://api.noether.exchange/v1/health` returns status ok with the market address matching contracts.json, over a valid managed TLS cert
- `grep -r 'railway.app'` over noether-docs pages/ returns zero hits, enforced by the CI gate (a seeded violation fails the workflow — verified once)
- docs-ci workflow green on PR and on the daily cron; it goes red when pointed at a dead base URL (verified with a temporary override)
- protocol/contracts.mdx address table is build-generated and matches the /v1/health echo byte-for-byte
- Zero remaining links to noether.exchange/api-keys until L1-15 restores the page; the key-issuance doc flow completes end-to-end via curl and via sdk 0.1.2 in a clean environment
- developers/changelog.mdx live with ≥3 backfilled entries and the stated ≥14-day breaking-change window; #api-updates exists and is linked from the changelog and the gateway /docs description
- SDK pages document 0.1.2 with the 0.1.1 warning callouts removed (post L1-14 publish)

**Risks:** Sequencing: the base-URL half must NOT wait on the SDK half — L1-14 gates only the 0.1.2 re-pinning; ship the URL sweep + CNAME immediately or every new integrator keeps bouncing off a dead host (the docs' own quickstart curl fails today). The local Noether_Docs clone may be behind origin — re-verify drift against origin/main before the sweep (claims here are pinned to commit 6a1fe9e). Custom-domain risk: Azure managed-cert binding depends on asuid TXT propagation — do hostname add/bind in a quiet window and keep the raw Azure hostname documented as fallback until the CNAME has soaked; never delete the old hostname. The address-table generation couples docs builds to gateway liveness — the cached last-good artifact keeps a transient outage from failing deploys. The ≥14-day deprecation promise becomes a public commitment — batch-1's API additions are additive (safe), but any future breaking change must actually honor the window or the changelog page itself becomes the next trust breach.

## Growth (L1-17..L1-21)

### L1-17 · Points program v1 (indexer-driven, wash-resistant)

**Status:** todo · **Effort:** M · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** L1-19 · **Blocks:** —
**Cross-refs:** TASKS G-4 · TASKS G-8 (Blend idle-yield explicitly NOT in scope here — post-launch) · LIGHTER-GAP §Fees & incentives (points row + LP-incentive row step 2) · **Gap rows:** Fees & incentives: No points/rewards program — the standard perp-DEX retail acquisition engine · Fees & incentives: LP incentive stack — LP (protocol-vault) deposits as a first-class points category with protocol-deposit neutralization (that row's build step 2)

**Current state (verified):** TASKS G-4 (TASKS.md:220) is untouched backlog: no points service, tables, routes, or UI exist anywhere (api/src/routes/ has no points.ts — verified by directory listing). The only gamification surface is GET /v1/leaderboard (api/src/routes/leaderboard.ts:25, StatsService.leaderboard in api/src/services/stats.ts:384, market-scoped + leaderboard_legacy baseline). All raw inputs already exist in indexer Postgres: trades (indexer/migrations/001_baseline.sql:69, kinds open/close/liquidation/cross_liquidation per api/src/routes/trades.ts:17), positions (:112), events_raw with a payload-trader index (:64), referral_bindings (:319), vault_deposits (factory, :200). Two code-verified facts make LINEAR volume points mechanically farmable: the tier fee is charged ONCE at open only (do_open lib.rs:358 taker, execute_limit_entry lib.rs:2469 maker) while closes charge zero fee but still record volume (record_volume_only at lib.rs:957 and :2193) — so a $10k round trip costs $5.00 (tier-0 taker, 50 deci-bps) yet books $20k of recorded volume; and oracle fills have no spread, so wash flow has no execution cost beyond that fee. The protocol-vault LP category input does NOT exist yet: the indexer never indexes the main vault (indexer/src/index.ts:34-50 registers only market/vaultFactory/referral) — that is L1-19. Identical on PROD and STAGING (pure off-chain gap).

**Design:** Weekly off-chain scoring engine inside the indexer service (single-writer, owns the DB), zero contract work.

EPOCHS: ISO week UTC (Mon 00:00:00 → Sun 23:59:59), id 'YYYY-Www'. Budget POINTS_WEEKLY_BUDGET env, default 100_000 points/epoch (points are NUMERIC, unitless).

TABLES (indexer migration 007_points.sql): `points_epochs(epoch_id TEXT PK, starts_at BIGINT, ends_at BIGINT, budget NUMERIC, params_json JSONB, finalized SMALLINT DEFAULT 0, computed_at BIGINT)`; `points_scores(epoch_id TEXT, wallet TEXT, category TEXT, raw_input NUMERIC, points NUMERIC, finalized SMALLINT, PRIMARY KEY(epoch_id, wallet, category))`; `points_flags(wallet TEXT PK, kind TEXT CHECK(kind IN ('protocol','sybil','leader_own_capital')), note TEXT, added_at BIGINT)`.

CATEGORIES + default budget weights (published, stored in params_json): taker_volume 0.40, oi_time 0.25, lp_deposits 0.25, referral 0.10.

CATEGORY INPUTS (all from Postgres):
1. taker_volume — FEE-ANCHORED, not raw size: raw_input = Σ estimated_fee = Σ size_i × tier_taker_deci_bps(trader, day_i) / FEE_PRECISION(100_000), where the tier is reconstructed per trader per day from trailing-14d trades sums (mirrors contracts/market/src/trading.rs:112-127 determine_fee_tier; count open+close rows to match on-chain TraderVolume double-count). Fee-anchoring is the load-bearing wash defense: score is proportional to fees actually paid, so farming points costs exactly face value.
2. oi_time — NET exposure hours: per wallet × asset × hour, exposure = |Σ signed open size| (long − short), from positions open/close event reconstruction; raw_input = Σ exposure × hours (USD-notional-hours, 7-decimal scaled down). Netting kills the delta-neutral long+short OI-farm.
3. lp_deposits — NOE-share-hours in the PROTOCOL vault from L1-19's lp_vault_flows deposit/withdraw rows (per-address running NOE balance × hours held).
4. referral — 10% kicker: referrer raw_input = Σ over bound referees of the referee's taker_volume raw_input (referral_bindings join).

SCORING (non-linear + partially undisclosed — mandatory per brief): per category, wallet points = category_budget × w_i^α / Σ_j w_j^α with α default 0.75. Published: "scoring is sublinear and partially undisclosed"; the exact α lives only in params_json (never in the API response) and is tunable per epoch. PER-DAY CAP (the 8.33%-floor analog for a 7-day epoch, published): any single UTC day contributes at most 25% of a wallet's weekly raw_input per category; excess truncated — one volatile day cannot drain an epoch. NEUTRALIZATION (Lighter LLP-rescaling, published): (a) points_flags kind='protocol' auto-seeded at job start from contracts.json admin + keeper + treasury + faucet addresses, plus manual rows; (b) kind='leader_own_capital': for the lp_deposits and taker_volume categories, vault-factory leaders' own deposits into their own vaults (vaults.leader == vault_deposits.depositor) are excluded; (c) flagged wallets score 0, then remaining wallets are RESCALED so the full category budget is still distributed. SYBIL/SELF-TRADE POLICY (published verbatim on /points + docs): "Wash, self-referral-cluster, and sybil flow scores zero. Detection heuristics are not disclosed. Decisions are final." v1 enforcement = manual: the job emits a per-epoch review report (top-20 wallets per category with round-trip-latency and fee-efficiency stats) to the logs; admin adds points_flags kind='sybil' rows before finalization.

JOB: indexer/src/points/engine.ts (pure, unit-tested scoring fns) + indexer/src/points/job.ts (in-process scheduler: hourly provisional recompute of the open epoch with finalized=0; at epoch end + POINTS_FINALIZE_DELAY (default 6h, allows flag review) upsert finalized=1 rows — idempotent by PK). Manual CLI: `npm -w @noether/indexer run points -- --epoch 2026-W30 [--dry-run]`. Env: POINTS_ENABLED (default false until the policy page is published), POINTS_WEEKLY_BUDGET, POINTS_FINALIZE_DELAY_MS.

API: GET /v1/points (public, standard rate tier): {epoch, startsAt, endsAt, finalized, budget, weights, board:[{wallet, total, byCategory}] (limit ≤200), policyUrl}; ?address=G... adds {wallet:{total, byCategory, rank}}. GET /v1/points/epochs lists past epochs. No auth (read-only, same posture as /v1/leaderboard).

WEB: /points page — epoch countdown, board, connected-wallet breakdown, "provisional until epoch close" badge, published policy block. SDKs: points sub-client in sdk-ts + sdk-py mirroring the two routes (S-5 parity pattern).

LAUNCH-DISCOUNT HOOK: params_json supports per-category multiplier overrides (e.g. lp_deposits × 2 for a launch window) — this is the L1-20-mandated "discounts as points multipliers, never fee cuts" mechanism.

**Implementation**

**indexer**
- [ ] Add migration 007_points.sql: points_epochs, points_scores, points_flags exactly as specced
- [ ] Write indexer/src/points/engine.ts: pure fns tierFor(trailing14dVolume), estimatedFeeInput, netOiTimeInput, lpShareHoursInput, referralKickerInput, applyDailyCap, applyPowerCurve(alpha), neutralizeAndRescale, computeEpoch(inputs, params)
- [ ] Write indexer/src/points/job.ts: hourly provisional recompute + finalize-at-epoch-end-plus-delay scheduler, idempotent upserts, protocol-wallet auto-flagging from contracts.json/env, per-epoch sybil review report to logs
- [ ] Wire the job into indexer/src/index.ts behind POINTS_ENABLED (same conditional pattern as the candle aggregator at index.ts:75-84)
- [ ] Add CLI script points.ts (`npm -w @noether/indexer run points -- --epoch <id> [--dry-run]`)
- [ ] Vitest (PGlite): test_points_fee_anchor_wash_roundtrip_scores_fee_equivalent, test_points_sublinear_monotone_but_concave, test_points_daily_cap_truncates, test_points_net_oi_time_zero_for_hedged_book, test_points_neutralization_rescales_full_budget, test_points_finalize_idempotent

**api**
- [ ] Add api/src/routes/points.ts: GET /v1/points (+?address=) and GET /v1/points/epochs with full response schemas, reading points_* tables; 60s TtlCache (reuse api/src/services/cache.ts)
- [ ] Vitest: test_points_route_board_shape, test_points_address_breakdown, test_points_missing_table_returns_empty (isMissingTable 42P01 guard)

**sdk-ts**
- [ ] Add src/sub/points.ts (board(), epochs()) + client wiring + drift-guard type test

**sdk-py**
- [ ] Mirror the points sub-client in noether_sdk/sub/points.py + test

**web**
- [ ] Add web/app/points/page.tsx: epoch board, wallet breakdown, provisional badge, published policy block (weights, per-day cap, neutralization, zero-score policy)
- [ ] Link /points from the site nav; `npx tsc --noEmit`

**docs**
- [ ] Add the points page to docs.noether.exchange: categories, published weights, 25% per-day cap, neutralization rule, sybil/self-trade zero-score policy, explicit "scoring is non-linear and partially undisclosed" statement

**ops**
- [ ] Operator: seed points_flags protocol rows (admin GCKIUOTK…, keeper, treasury, faucet), review the epoch-0 report, then set POINTS_ENABLED=true on the Azure indexer app

**Acceptance:**
- All six named indexer engine tests plus the three api route tests exist and pass in CI (npm test from root)
- A synthetic PGlite fixture where wallet W does one $10k open+close round trip and wallet H pays the same $5.00 estimated fee via 10 small honest trades yields points(W) ≤ points(H) in taker_volume (fee anchor + concavity)
- A wallet holding +$5k long and −$5k short the same asset for the whole epoch scores 0 in oi_time
- Flagging the admin wallet reduces no other wallet's points and the category sum still equals the category budget (rescaling)
- GET /v1/points returns a schema-valid board on staging with finalized=false mid-week and finalized=true after epoch close + delay; recomputing a finalized epoch is a no-op
- /points page renders the board and the published policy; wallet connect shows per-category breakdown
- lp_deposits category returns non-zero only once L1-19's lp_vault_flows table is populated (graceful zero before)

**Risks:** No WASM or contract risk (pure off-chain). Main risks: (1) scoring-parameter leakage — α and sybil heuristics must never appear in API responses or the public repo docs; keep them in params_json + env only; (2) tier reconstruction drift vs on-chain TraderVolume — the engine must count open AND close rows like the contract does (lib.rs:80 + record_volume_only :957/:2193), else estimated fees diverge from real fees; pin with the fee-anchor test; (3) L1-19 dependency — enabling the lp_deposits category before lp_vault_flows backfills under-rewards early LPs; ship with the category live-but-zero and announce its start epoch; (4) finalization races — the job must be idempotent because the indexer restarts on deploys (Azure Container Apps); PK upserts + the finalized flag handle it; (5) legal/marketing: publish the zero-score policy BEFORE the first scored epoch or retroactive zeroing becomes a trust incident.

### L1-18 · Referral economics activation — IN Redeploy Batch 1 (founder decision 2026-07-17)

**Status:** todo · **Effort:** M · **Lane:** mixed · **Ships in:** batch-1-redeploy · **Needs:** L2-18 (banked fee-split decision) · **Blocks:** L0-18, L1-22, L2-12
**Cross-refs:** TASKS V1.1-4 · TASKS P1-10 (set_fee_split — the funding mechanism, operator activation pending) · AUDIT R-1 · AUDIT R-2 · AUDIT R-3 · AUDIT R-5 · AUDIT R-8 · AUDIT M-8 · AUDIT SEC-7 · KNOWN_ISSUES G-2 (corrected entry: no discount exists anywhere) · KNOWN_ISSUES C-T2-1 · KNOWN_ISSUES G-1 (lesson: claim stays a wallet-only direct-chain op, never behind gateway auth) · LIGHTER-GAP §Fees & incentives (referral row) · **Gap rows:** Fees & incentives: Referral economics dormant end-to-end — advertised 4%/10% never pays

**Current state (verified):** Dormant end-to-end on PROD and STAGING alike. The market contract never calls the referral contract: the only record_trade reference in contracts/market/src/lib.rs is the internal trading::record_trade_volume (lib.rs:80); grep for "referral" in market sources returns nothing. The referral contract itself is complete: record_trade(referee, original_fee)→(discount,payout) is market-gated (contracts/referral/src/lib.rs:152-197) with DEFAULT_DISCOUNT_BPS=400 (4% of fee) and DEFAULT_REFERRER_SHARE_BPS=1_000 (10% of fee) (referral/src/types.rs:6-9), but claim() zeroes claimable and transfers NO USDC (lib.rs:203-216, comment defers the pay to "phase 11.x"), R-8 is live (total_volume_generated accumulates the FEE, not volume, lib.rs:178-181), min_code_volume is enforced nowhere (create_code lib.rs:74-114 never reads it, R-3), and the contract exposes no set_market or upgrade entrypoint (pub fn list verified) so it cannot follow a market redeploy. The gateway is read-only echo (ReferralReadService in api/src/services/referral.ts maps projection rows; toTradeRow ~:73-85; no fee/discount logic anywhere in api/). Web claims are hard-disabled ("Claims open in v1.1", web/components/referral/ClaimFeesCard.tsx:32-35, per P0-5's corrected copy). The funding rail exists but is inactive: set_fee_split(treasury, bps≤5000) at market lib.rs:193-201, applied in finalize_open lib.rs:2100-2119, default 2000 bps (storage.rs:209) — inactive until an operator sets a treasury. Indexer read side is ready: decoders/referral.ts already decodes code_created/referrer_set/trade_recorded/claimed (:14-64).

**Design:** Ship the loop in Redeploy Batch 1; the referral contract redeploys in the SAME batch (testnet code state is disposable; mainnet deploys fresh).

MARKET CHANGES (contracts/market):
- storage.rs: DataKey::Referral (instance) + get_referral(env)->Option<Address> + set_referral_addr.
- lib.rs: `pub fn set_referral(env, referral: Address) -> Result<(), NoetherError>`, admin-gated (mirror set_fee_split at :193-201). Keeping it a setter (not an initialize arg) lets the batch deploy market → referral → set_referral in order.
- New helper `fn apply_referral(env, trader, gross_fee, size) -> (i128 net_fee, i128 referrer_payout)`: if get_referral is None or gross_fee<=0 → (gross_fee, 0); else TRY-invoke referral.record_trade(trader, gross_fee, size) (env.try_invoke_contract); on Ok((discount,payout)) → net_fee = max(gross_fee − discount, 0); on ANY error → (gross_fee, 0). Fail-open to no-discount: a broken/paused referral contract must never block trading.
- Call sites (exactly two, the only fee-charging points): do_open — insert between lib.rs:358 (fee = calculate_fee_and_record_volume(...)) and :359 (net_collateral = collateral − fee), using net_fee for net_collateral; execute_limit_entry — same insertion at lib.rs:2469-2473. record_volume_only (closes) is untouched — closes bear no fee, so no referral call.
- finalize_open(env, position, fee, referrer_payout) (signature gains one param; fee is the NET fee): after cut = fee × protocol_fee_bps / 10_000 (BASIS_POINTS) at :2107, pay the referrer share FROM THE CUT: pot = min(referrer_payout, cut); transfer pot USDC market→referral contract address; transfer cut − pot to treasury; vault_share = fee − cut unchanged. The min() clamp structurally guarantees the founder constraint: the LP share (fee − cut) is NEVER reduced by the payout. If no treasury is set, cut=0 → pot=0 → payouts accrue nothing paid (operator MUST activate set_fee_split at deploy; see ops).
- Worked integers (test vector, $10,000 tier-0 taker open, 7-decimal units): gross fee 50_000_000 ($5.00); discount 2_000_000 ($0.20, = 4% of fee = 2 deci-bps of size, net taker 48 deci-bps = 0.048%); net fee 48_000_000; payout 5_000_000 ($0.50, 10% of gross); cut @2000bps = 9_600_000; pot 5_000_000 + treasury 4_600_000; vault 38_400_000.

REFERRAL CONTRACT CHANGES (contracts/referral, same batch):
- record_trade(referee, original_fee, volume) — third arg (position size, 7-dec notional); total_volume_generated += volume (fixes R-8's ~2000x understatement). The trade_recorded event payload becomes (referee, referrer, original_fee, discount, payout, volume) — indexer decoder updated in lockstep.
- Funded claim: store UsdcToken (new initialize arg usdc_token: Address + admin set_usdc_token for migration); claim() transfers info.claimable from the referral contract's own USDC balance to the referrer; if balance < amount → Err(ClaimUnfunded = 16) WITHOUT zeroing claimable (never burn an earned balance). The pot is funded push-style by the market's per-trade pot transfer, so under normal operation balance ≥ Σ claimable by construction.
- Admin controls (R-5): revoke_code(code) sets info.revoked=true (record_trade returns (0,0) for revoked referrers; new ReferralError RevokedCode=18 reserved), unbind(referee) deletes the binding, set_paused(bool) makes record_trade a (0,0) no-op (RegistryPaused=17 reserved for state-changing calls). All admin-gated, all event-emitting (code_revoked, unbound, registry_paused).
- min_code_volume enforcement (R-3): create_code cross-reads market.get_trader_volume(referrer) and requires ≥ min_code_volume (default 10_000_0000000 = $10,000, types.rs:16), Err(InsufficientVolume=13, already defined). Requires the small market view below.
- set_market(addr) + upgrade(new_wasm_hash) admin entrypoints so future market redeploys re-point without losing code/referrer state.

MARKET VIEW RE-ADD: `pub fn get_trader_volume(env, trader) -> i128` returning trading::sum_rolling_volume of the stored VolumeRecord (rotated to today). Tiny view; also un-deadens web getTraderFeeInfo which already calls exactly this name (web/lib/stellar/market.ts) and serves L1-20's tier preview. Size-check mandatory (market.wasm currently 70,044 B vs the 128KB protocol limit).

READ SIDE / WEB:
- Indexer: decoders/referral.ts adds volume to trade_recorded; migration adds referral_trades.volume TEXT NULL.
- Gateway: routes stay read-only (projections now carry real numbers). Claims are NOT gatewayed — wallet-only Soroban op per the KNOWN_ISSUES G-1 lesson.
- Web: ClaimFeesCard enabled — wallet-signed referral.claim(referrer) via a new tx-builders buildReferralClaimOp (single source of truth rule) consumed by web + both SDKs; restore 4%/10% earnings copy on /referrals sourced from referral.get_config() (never hardcoded); show claimable + claim button + claimed history.

OPERATOR (deploy-day, in order): deploy market+vault+router+referral → referral.initialize(admin, market, usdc) → market.set_referral(referral) → market.set_fee_split(treasury, 2000) → verify referral.get_config() == (400, 1000, 100000000000) → smoke: bind, trade, get_info shows claimable, claim pays USDC.

**Implementation**

**contracts/market**
- [ ] Add DataKey::Referral + storage helpers; add admin set_referral(env, addr)
- [ ] Add the apply_referral try-invoke helper; wire into do_open (lib.rs:358) and execute_limit_entry (lib.rs:2469); thread referrer_payout into finalize_open and route it from the treasury cut with the min(payout, cut) clamp
- [ ] Re-add view get_trader_volume(trader) -> i128 (rolling 14d sum)
- [ ] Tests: test_referral_discount_applied_at_open (48 deci-bps net, exact integers from the worked vector), test_referrer_payout_capped_by_treasury_cut (payout+treasury == cut; vault gets fee−cut exactly), test_referral_noop_when_unset_or_unreferred, test_referral_contract_failure_does_not_block_open (bad referral address), test_limit_entry_maker_discount_path, test_get_trader_volume_view
- [ ] `cargo test -p market && ./scripts/build_contracts.sh`; assert market.wasm well under the 128KB limit and record the new size

**contracts/vault**
- [ ] No changes — verify test_protocol_fee_split_routes_to_treasury (market lib.rs:3606) still passes with the pot slice added (LP share invariant unchanged)

**packages/tx-builders**
- [ ] Add referral/claim.ts: buildReferralClaimArgs/Op(referralContractId, {referrer}) + XDR snapshot test (P4-23 pattern) + simulation-based CI case once L0-21's harness exists

**indexer**
- [ ] Update decoders/referral.ts trade_recorded for the 6-field payload (…, volume); migration: ALTER referral_trades ADD COLUMN volume TEXT
- [ ] Decoder tests: fixture for the new payload; old 5-field fixture still decodes (backward-compat guard for pre-redeploy history)

**api**
- [ ] Expose volume in /v1/referral responses; no auth changes (claims stay off-gateway)
- [ ] Test: referral trade row includes volume when present

**sdk-ts**
- [ ] Add the orders/tx surface for referral claim (prepare/submit path using the new builder); resync vendored types

**sdk-py**
- [ ] Mirror the referral claim surface + test

**web**
- [ ] Enable ClaimFeesCard: real claim flow (wallet-signed, direct chain), success/error toasts, claimed history from /v1/referral
- [ ] Restore 4%/10% copy on /referrals + banner, values read from referral.get_config; remove the "v1.1" disable notes (reverting P0-5's interim copy)
- [ ] `npx tsc --noEmit`

**contracts/referral**
- [ ] record_trade gains the volume param + revoked/paused gates; funded claim() with ClaimUnfunded=16; admin revoke_code/unbind/set_paused/set_market/set_usdc_token/upgrade; initialize gains the usdc_token arg
- [ ] Tests: test_claim_transfers_usdc, test_claim_unfunded_preserves_claimable, test_record_trade_volume_stat_fixed (R-8), test_min_code_volume_gate (R-3), test_revoked_referrer_accrues_nothing, test_paused_registry_is_noop, test_set_market_repoints; `cargo test -p referral`

**docs**
- [ ] Docs referral page: exact economics (4% of fee discount / 10% of fee to referrer, funded from the protocol treasury split — never LP yield), claim mechanics, revocation policy
- [ ] Update KNOWN_ISSUES G-2 + C-T2-1 entries to "shipped in Batch 1" after deploy

**ops**
- [ ] Batch-1 runbook additions in order: referral.initialize(admin, market, usdc) → market.set_referral(referral) → market.set_fee_split(treasury, 2000) → verify get_config==(400,1000,100000000000) → e2e smoke: bind ?ref code with wallet B, open $1k, assert on-chain fee 0.048%, referral.get_info(A).claimable == 10% of the gross fee, claim() pays USDC

**Acceptance:**
- Contract tests named above all pass; the $10k worked vector asserts exact integers (gross 50_000_000, discount 2_000_000, payout 5_000_000, cut 9_600_000, treasury 4_600_000, vault 38_400_000)
- Property holds in test: for any protocol_fee_bps in [0,5000], the vault receives exactly net_fee − cut (LP share never funds the payout)
- On staging post-redeploy: a referred wallet's open emits trade_recorded with all six fields; /v1/referral/info shows earned/claimable > 0; claim() transfers USDC on-chain and the claimed row appears in /v1/referral history
- A broken referral address (set_referral to a non-contract) does not block opens (test + staging smoke)
- create_code from a wallet with < $10k 14d volume fails with InsufficientVolume (#13); ≥ $10k succeeds
- ClaimFeesCard shows an enabled Claim button with a non-zero balance and completes the flow in the browser; /referrals copy shows 4%/10% sourced from get_config
- market.wasm size recorded and < 128KB limit with ≥10KB headroom

**Risks:** WASM: the market grows by ~2 storage helpers + 1 try-invoke + 1 view + a finalize_open param — small, but the batch also carries L0-4/L0-5/L0-6/L1-21 market changes; build and size-check the COMBINED batch WASM early, not per-item. Event-format drift: trade_recorded gains a 6th field — the indexer decoder must ship before or with the redeploy (old events keep 5 fields; the decoder handles both) and the CLAUDE.md event table must be updated. Coupled ordering: the referral contract now redeploys with the batch and re-points via set_market on any FUTURE market redeploy — add to the deploy scripts' verify step or the price of forgetting = silent (0,0) no-ops (require_market fails inside try_invoke → fail-open, no discount, no error surfaced). Economics: self-referral pairs recapture 14% of their own fees (R-5) — bounded and net-positive for the protocol since the payout comes from the 20% cut, but L1-17 must zero-score such clusters; admin revoke/unbind are the backstop. tx-builders: the claim builder lands in the same package with the L0-21 arity break history — pin with XDR snapshot + simulation CI. Keeper: unaffected (no keeper flow touches fees at open).

### L1-19 · Protocol-vault indexing → real LP APY + NOE history

**Status:** todo · **Effort:** M · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** — · **Blocks:** L1-17
**Cross-refs:** TASKS P4-15 · TASKS P4-12 (LP-vault-event TVL/APY history TODO) · TASKS G-8 (Blend idle-yield — explicit non-goal here, post-launch) · AUDIT I-8 (LP vault events never indexed) · AUDIT W-3 (fake/absent APY) · KNOWN_ISSUES F-2 (vault APY hidden-until-real; real APR needs a NAV series) · KNOWN_ISSUES G-4 (indexer registers handlers only for contracts present in contracts.json) · LIGHTER-GAP §LP & vault products (track-record row) + §Fees & incentives (LP-incentive row) · **Gap rows:** LP & vault products: Protocol-vault LP track record: real APY, NOE price history, revenue breakdown · Fees & incentives: LP incentive stack: yield invisible (APR = "—") and zero deposit incentives (that row's build step 1: index the protocol vault → NAV/fee series → real trailing APR)

**Current state (verified):** The indexer registers handlers ONLY for market, vaultFactory, and referral (indexer/src/index.ts:37-50 builds contractIds from those three; :91-114 registers their handler sets) — the protocol vault's address is present in contracts.json ('vault': CBLVZZ… — verified) but never polled, so its events don't even reach events_raw. The vault contract emits everything needed (contracts/vault/src/lib.rs): deposit(depositor, usdc_amount, noe_amount, fee) :198-201, withdraw(withdrawer, noe_amount, net_usdc, fee) :282-285, pnl_settled(pnl) :376-379, payout_shortfall(pnl, paid, short) :367-370, loss_received(amount) :415-418, exposure_synced topic (exposure_synced, asset) data (asset_upnl, total, release) :448-451, buffer_seeded(amount) :680, buffer_funded(amount) :695, plus paused/unpaused/emergency_withdraw. Views for snapshots exist: get_pool_info (PoolInfo{total_usdc, total_glp, aum, unrealized_pnl, total_fees}) :509-519, get_noe_price :523-530, get_buffer_balance :700, get_reserved_payout :725, get_shortfall :730, get_usdc_balance :554. Because nothing is indexed, /vault APR renders "—" by design: web/app/vault/page.tsx:53 hardcodes apy: null ("real APR needs fee-revenue history (P4-15)") into StatsBar (web/components/vault/StatsBar.tsx:11, "—" branch at :53); api/src/services/vaults.ts computes APY only for FACTORY vaults from vault_trades (:246-282). One vault-accounting fact shapes the earnings breakdown: ALL income (trading fees, trader losses, funding, liquidation proceeds) arrives via receive_loss → loss_received events (the market's credit_vault_receipt helper invokes receive_loss at every credit point — call sites lib.rs:583/651/943/1075/1110/2178 (settle_isolated_close loss+funding) and finalize_open :2117), so income decomposition needs same-tx correlation with market events. Identical gap on PROD and STAGING; buffer/shortfall events exist only on the STAGING/Batch-1 contract code.

**Design:** Pure off-chain: new indexer decoder+handler pair + periodic snapshotter + one API route + web wiring. NAMING: the existing decoders/handlers "vault.ts" pair is the FACTORY (registered under the vaultFactory address) — the new pair is lpVault.ts to avoid collision.

INDEXER:
- index.ts: add vault to the conditional registration block (hasContract('vault')) and push it into contractIds — its events then land in events_raw automatically (KNOWN_ISSUES G-4 pattern).
- decoders/lpVault.ts: decode topics {deposit, withdraw, pnl_settled, payout_shortfall, loss_received, exposure_synced, buffer_seeded, buffer_funded, paused, unpaused, emergency_withdraw} with the exact payload shapes above (exposure_synced carries the asset in topic[1]).
- handlers/lpVault.ts → table lp_vault_flows (migration 004_lp_vault.sql): `(id IDENTITY PK, event_id TEXT UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('deposit','withdraw','pnl_settled','payout_shortfall','loss_received','buffer_seeded','buffer_funded','paused','unpaused','emergency_withdraw')), address TEXT NULL, usdc_amount TEXT NULL, noe_amount TEXT NULL, fee TEXT NULL, pnl TEXT NULL, paid TEXT NULL, short TEXT NULL, ledger BIGINT, ts BIGINT, tx_hash TEXT, contract_id TEXT)`; indexes (kind, ts DESC) and (address, ts DESC); idempotent upsert on event_id (uq_* pattern from 001_baseline.sql:225). exposure_synced is NOT projected into flows (high-frequency, low value) — events_raw retains it.
- indexer/src/lpVaultSnapshot.ts — LpVaultSnapshotter: every LP_SNAPSHOT_INTERVAL_MS (default 900_000 = 15 min), simulation-read get_pool_info, get_noe_price, get_buffer_balance, get_shortfall, get_reserved_payout, get_usdc_balance (precedent: vaultSync.ts reconcileAllVaults simulation reads; candle aggregator polling loop index.ts:75-84) and insert into lp_vault_snapshots `(ts BIGINT PK, contract_id TEXT, aum TEXT, total_usdc TEXT, unrealized_pnl TEXT, total_fees TEXT, noe_price TEXT, noe_circulating TEXT, buffer TEXT, shortfall TEXT, reserved_payout TEXT, usdc_balance TEXT)`. All amounts 7-decimal i128 decimal strings.

APY (7-decimal precision, bigint math): the NOE price already nets everything an LP experiences (AUM = total_usdc + total_fees − unrealized_pnl, buffer EXCLUDED from NAV), so trailing return is ground truth, not an estimate: apyBps(window) = (pNow − pThen) × 10_000 × 365 / (pThen × windowDays), pThen = earliest snapshot ≥ now − window. Honesty rule (mirror api/src/services/vaults.ts:27-32): if the oldest snapshot is younger than the window → apyKind='inception' (raw non-annualized return) — never annualize a days-old record; if no snapshots → null → web keeps "—".

EARNINGS BREAKDOWN (window aggregate, labeled "approximate decomposition"): feeIncome = Σ loss_received in txs whose tx_hash has a position_opened row (events_raw/trades join); traderNetSettlement = Σ loss_received in txs with position_closed/position_liquidated/position_partial_liq/cross_liq; winsPaid = Σ pnl_settled.pnl where pnl>0; shortfallBooked = Σ payout_shortfall.short; bufferInflow = Σ buffer_seeded + buffer_funded. Breakdown identity check displayed nowhere (approximation), the NAV chart is the truth.

API: GET /v1/vault/history?window=7d|30d|90d|all&interval=1h|1d (public): `{ contractId, window, interval, snapshots:[{ts, noePrice, aum, tvl:total_usdc, buffer, shortfall, reservedPayout}], apy:{d7Bps, d30Bps, kind}, earnings:{window, feeIncome, traderNetSettlement, winsPaid, shortfallBooked, bufferInflow} }` — 60s TtlCache; interval downsampling in SQL (bucket by ts/interval, last-in-bucket).

WEB (/vault): replace apy: null at web/app/vault/page.tsx:53 and :124 with the /v1/vault/history read (React Query, matching the 2026-07-16 trade-tab pattern); StatsBar gets the real number + methodology tooltip ("trailing 30d NOE-price return, annualized; fees + trader losses − trader wins"); add a NOE price chart (reuse the existing lightweight chart primitives from the trade page ChartHeader family — no new chart lib) + an "LP earnings" breakdown panel; keep "—" + "inception" badge states. /vaults marketplace hero "Variable" → real protocol APY once kind='annualized'.

SDKs: vaults.history() in sdk-ts/src/sub/vaults.ts + sdk-py mirror.

BACKFILL/OPERATOR: events before the vault joins contractIds were never captured; run `npm run reindex` (P4-11) with the indexer STOPPED and a cursor rewound to the 2026-07-06 prod-deploy ledger IF within RPC retention — otherwise accept a clean start: snapshots begin at feature deploy, apyKind='inception' until 7d elapse. Restart the indexer after adding the address (KNOWN_ISSUES G-4).

**Implementation**

**indexer**
- [ ] Migration 004_lp_vault.sql: lp_vault_flows + lp_vault_snapshots as specced (event_id unique upsert, kind CHECK)
- [ ] Add decoders/lpVault.ts for the 11 topics with exact payload tuples (deposit 4-tuple, withdraw 4-tuple, payout_shortfall 3-tuple, exposure_synced asset-in-topic)
- [ ] Add handlers/lpVault.ts (idempotent writes) and register under hasContract('vault') in index.ts; push vault into contractIds
- [ ] Add lpVaultSnapshot.ts snapshotter (15-min simulation reads of the 6 views) wired like the candle aggregator; env LP_SNAPSHOT_INTERVAL_MS
- [ ] Vitest (PGlite): test_lp_vault_decoder_fixtures (one per topic), test_lp_vault_handler_idempotent_replay, test_lp_snapshotter_writes_row (mock rpc), test_apy_window_math (bigint vectors incl. the inception guard)

**api**
- [ ] Add routes/vaultHistory.ts (or extend routes/vaults.ts): GET /v1/vault/history with full response schema, SQL downsampling, TtlCache 60s
- [ ] Service fn computing apyBps + the earnings decomposition with the same-tx-hash classification joins
- [ ] Vitest: test_vault_history_shape, test_vault_history_apy_inception_before_7d, test_vault_history_empty_tables (missing-table guard)

**sdk-ts**
- [ ] vaults.history(params) sub-client method + type + test

**sdk-py**
- [ ] vaults.history mirror + test

**web**
- [ ] web/app/vault/page.tsx: fetch /v1/vault/history via React Query; wire apy into StatsBar (drop the hardcoded nulls at :53/:124); inception badge; methodology tooltip
- [ ] Add the NOE price chart + "LP earnings = fees + trader losses − trader wins" breakdown panel on /vault
- [ ] /vaults hero: real protocol APY when annualized, "Variable" otherwise; `npx tsc --noEmit`

**docs**
- [ ] Docs vault/LP page: APY methodology (NOE-price trailing return, buffer excluded from NAV), earnings decomposition caveat, snapshot cadence

**ops**
- [ ] Restart the Azure indexer after deploy (address registration is boot-time); optionally run the stopped-indexer reindex with rewound cursor to backfill within RPC retention; verify lp_vault_snapshots rows accrue every 15 min via SQL

**Acceptance:**
- All named indexer + api tests pass in CI; decoder fixtures cover every projected topic
- On staging within one poll cycle of an LP deposit: lp_vault_flows gains a kind='deposit' row with usdc/noe/fee matching the on-chain event; replaying the same event does not duplicate it
- lp_vault_snapshots accrues a row per interval with noe_price equal to a direct get_noe_price simulation at the same time (spot check)
- GET /v1/vault/history returns apy.kind='inception' with a raw return before 7 days of snapshots, then d7Bps 'annualized' after; empty DB returns snapshots:[] and apy nulls (no fabricated numbers)
- /vault StatsBar shows a real APR percentage (or an explicit inception badge) instead of "—" once data exists, and still shows "—" when the gateway is unreachable (no fake $0/0%)
- The NOE chart renders the snapshot series; the earnings panel totals match the SQL aggregates for the selected window
- L1-17's lp_deposits category returns non-zero scores from lp_vault_flows in a fixture epoch

**Risks:** No contract or WASM risk. Event-format coupling: the decoder pins today's vault event payloads — Batch-1 vault changes (L0-2 bad_debt_recorded, L0-3 shortfall claims, L1-22 fee-stream buffer funding) will ADD topics/fields; the decoder must ship tolerant of unknown topics (they still archive to events_raw) and each batch change updates decoder+fixtures in the same PR (CLAUDE.md event-table discipline). The snapshotter is RPC-dependent: public-endpoint rate limits already forced SOROBAN_RPC_URLS failover (docs/RPC.md) — snapshot reads add 6 simulations/15 min, negligible, but reuse the RpcPool. History-gap honesty: pre-feature events are unrecoverable beyond RPC retention — the UI must show "inception" rather than backfilling estimates. Earnings decomposition is approximate by construction (all income funnels through loss_received; classification is same-tx-hash based) — label it, never reconcile it against NAV in UI. Ordering with the coupled redeploy: contract addresses change at Batch-1 — lp_vault_snapshots/flows carry contract_id so series can be scoped per deployment era (same lesson as the market-scoped leaderboard).

### L1-20 · Mainnet fee sheet + all-in cost story + GET /v1/fees

**Status:** todo · **Effort:** S · **Lane:** mixed · **Ships in:** offchain-now · **Needs:** — · **Blocks:** L0-18
**Cross-refs:** TASKS P1-10 (set_fee_split funding context) · TASKS P6-3 (check_mainnet_parity.sh already gates the tier thresholds) · TASKS P4-5 (GET /v1/account/volume exists; OrderPanel still not calling it) · AUDIT R-6 (OrderPanel fee preview baseline $0 / volume unreadable) · LIGHTER-GAP §Fees & incentives (fee-positioning row) · **Gap rows:** Fees & incentives: Retail fee positioning against a zero-fee anchor (mainnet fee sheet + all-in-cost story)

**Current state (verified):** The on-chain schedule is live on PROD and STAGING: 4 tiers in deci-bps (FEE_PRECISION=100_000) at 20/50 → 15/40 → 10/30 → 5/20 with TESTNET thresholds $20K/$50K/$100K (contracts/market/src/trading.rs:27-49; the doc comment already names the mainnet $1M/$5M/$25M plan), charged via calculate_tiered_fee (:139-142). Code-verified fee-story facts: the tier fee is charged ONCE at open (do_open lib.rs:358 taker; execute_limit_entry :2469 maker) and closes are FREE (record_volume_only :957/:2193 discards the fee) — a round trip costs one open-side fee. No public fee endpoint exists (api/src/routes/ has no fees.ts); GET /v1/account/volume exists (api/src/routes/volume.ts:13, P4-5) but the web OrderPanel does NOT call it — getTraderFeeInfo still simulates the REMOVED on-chain get_trader_volume view and always returns null (web/lib/stellar/market.ts getTraderFeeInfo; OrderPanel.tsx:146-148, 270-272 quote base tier as an estimate). NOTE: the gap doc's parity claim that OrderPanel uses /v1/account/volume is WRONG — code and TASKS P4-5 ("web OrderPanel still needs to CALL it") win. Constants are triple-duplicated: trading.rs, web/lib/utils/constants.ts:133-138 (FEE_TIERS, deci-bps values under a *Bps name), and nothing in packages/shared (verified: shared has assets/contracts/network/precision/rpc only). check_mainnet_parity.sh:40-44 already fails MAINNET=1 while testnet thresholds remain. set_fee_split (lib.rs:193-201, applied :2100-2119, default 2000 bps, storage.rs:209) is coded but operator-inactive, and it has NO on-chain getter. Docs-site fee coverage: UNVERIFIED (separate NoetherDEX/noether-docs repo not in this checkout) — treat as absent per the gap doc.

**Design:** Hold nonzero fees (LP compensation IS the product) and publish the honest all-in counter-story; ship the machinery now against testnet values, swap constants in Batch 1.

SINGLE SOURCE OF TRUTH: new packages/shared/src/fees.ts exporting `FEE_TIERS: [{minVolumeUsd: number, makerDeciBps: number, takerDeciBps: number}]` (deci-bps, 1 unit = 0.001%), FEE_PRECISION=100_000, VOLUME_WINDOW_DAYS=14, FEE_CHARGED_ON='open', KEEPER_FEE (current deployed values: {baseUsdc7: 5_000_000, variableBps: 5} — units per contracts/noether_common/src/types.rs:378-384; becomes {baseUsdc7: 0, variableDeciBps: 10} at Batch 1 per L1-21), plus a FEE_SCHEDULE_VERSION string tied to contracts.json deployedAt. api + sdk-ts consume it; web (standalone, not a workspace) keeps its mirror in constants.ts — parity enforced by check_mainnet_parity.sh:44 plus a new grep row for the shared file.

GET /v1/fees (api/src/routes/fees.ts, public, standard rate tier): response `{ unit:'deci-bps', feePrecision:100000, volumeWindowDays:14, chargedOn:'open', scheduleVersion, tiers:[{minVolume:'i128-string', makerDeciBps, takerDeciBps}], keeperFee:{baseUsdc:'i128-string', variableBps|variableDeciBps, appliesTo:['limit','stop-limit','stop-loss','take-profit','trailing-stop']}, protocolFeeShareBps: number|null }` (env FEE_SPLIT_BPS mirror — no on-chain getter exists; null when unset, never fabricated). Optional ?address=G…: adds `{ address, volume14d:'i128-string', tier:{index, makerDeciBps, takerDeciBps}, nextTier:{index, minVolume}|null }` computed with the SAME SQL as /v1/account/volume (reuse its service query verbatim so gateway tier == documented tier). IMPL VERIFICATION STEP: confirm /v1/account/volume sums BOTH open and close sizes to match on-chain TraderVolume accounting (opens lib.rs:358/:2469 AND closes :957/:2193 both record volume); fix the SQL if it counts opens only — otherwise gateway tiers run hot vs the contract.

WEB: OrderPanel replaces the dead getTraderFeeInfo chain read with GET /v1/fees?address= (closes the P4-5 leftover / AUDIT R-6); fallback to base-tier "estimated" labeling when the gateway is unreachable (current behavior preserved). Note L1-18's get_trader_volume view re-add makes the old chain path work again too — keep the gateway as primary, chain read as fallback #2.

MAINNET CONSTANTS (Batch-1 rider, contract side): trading.rs default_fee_tiers thresholds 20_000→1_000_000, 50_000→5_000_000, 100_000→25_000_000 (× PRECISION, 7-decimal); rates UNCHANGED (20/50, 15/40, 10/30, 5/20 deci-bps). Tiers are STORED at initialize (lib.rs:153-154) so the fresh Batch-1 deploy picks them up with no migration; update web constants.ts + shared/fees.ts in the same commit; check_mainnet_parity.sh rows 41-44 flip green under MAINNET=1. Freeze BEFORE the L0-18 audit scope lock (founder requirement).

DOCS FEE PAGE (docs.noether.exchange): (1) tier table (testnet + mainnet columns); (2) "fee charged once at open, closes free — a round trip costs one taker fee"; (3) keeper execution fee table (from L1-21, incl. the Batch-1 restructure note); (4) the all-in comparison with worked, honest examples: a $10,000 taker round trip on Noether = $5.00 total (5 bps, tier 0; $2.00 at tier 3) at oracle mid with ZERO spread and ZERO depth impact at any size within OI caps; a zero-fee CLOB round trip = crossing the spread twice ≈ half-spread × 2 (2-5 bps quoted spread → $2-5) PLUS depth impact that grows with size — state plainly that tight-spread BTC/ETH at small size is roughly a wash and Noether wins on mid/long-tail pairs (5-20+ bps spreads) and on size; (5) discount policy: volume tiers cut to 2 bps taker (75% off); launch-window promotions run as POINTS MULTIPLIERS (L1-17 params_json multipliers), never fee-schedule cuts — cutting fees starves the LP pool whose AUM caps OI (error #82).

SDKs: markets.fees() (sdk-ts) + mirror (sdk-py).

**Implementation**

**packages/shared**
- [ ] Add packages/shared/src/fees.ts with FEE_TIERS/KEEPER_FEE/FEE_PRECISION/VOLUME_WINDOW_DAYS/FEE_SCHEDULE_VERSION; export from index; rebuild packages (`npm run build:packages`)
- [ ] Add a unit test asserting shared FEE_TIERS deci-bps values match the documented contract table (drift tripwire)

**api**
- [ ] Verify /v1/account/volume SQL counts open AND close notional (match on-chain TraderVolume); fix + test if opens-only
- [ ] Add routes/fees.ts: GET /v1/fees (+?address=) per the response spec, reusing the volume SQL; schema'd, public, 60s TtlCache on the static block
- [ ] Vitest: test_fees_schedule_shape, test_fees_address_tier_matches_volume_route, test_fees_protocol_share_null_when_unset

**sdk-ts**
- [ ] markets.fees(address?) method + types + test

**sdk-py**
- [ ] markets.fees mirror + test

**web**
- [ ] OrderPanel: source tier/fee preview from GET /v1/fees?address= (primary), chain get_trader_volume (post-L1-18) then base-tier estimate as fallbacks; keep "est." labeling only on fallback
- [ ] `npx tsc --noEmit`

**contracts/market**
- [ ] BATCH-1 RIDER: swap trading.rs default_fee_tiers thresholds to 1M/5M/25M × PRECISION (rates unchanged); update the trading.rs doc table + tests (test_determine_fee_tier_* volume vectors)
- [ ] Update web/lib/utils/constants.ts FEE_TIERS + packages/shared/src/fees.ts in the SAME commit; run `MAINNET=1 ./scripts/check_mainnet_parity.sh` and assert the fee rows pass

**docs**
- [ ] Write the docs-site Fees page with the tier table, once-at-open rule, keeper fee table, worked all-in comparisons (honest BTC/ETH caveat), and the points-multiplier discount policy
- [ ] Cross-link from the trade UI fee tooltip to the docs page

**ops**
- [ ] Launch checklist row: MAINNET=1 check_mainnet_parity.sh green (P6-3 gate) + /v1/fees scheduleVersion matches the deployed contracts.json stamp

**Acceptance:**
- GET /v1/fees returns the schema-valid schedule; with ?address= for a wallet with known 14d volume it returns the same tier the contract would apply (integration test seeding events, asserting tier index against determine_fee_tier logic)
- test_fees_address_tier_matches_volume_route passes: /v1/fees tier derivation and /v1/account/volume agree on the same seed data
- OrderPanel shows a real tier (not "est.") when the gateway responds, and degrades to the labeled estimate offline — verified in the browser on staging
- Docs fee page live at docs.noether.exchange with the worked $10k round-trip comparison and the "fees are charged once at open" statement
- After the Batch-1 rider: contract tests pass with $1M/$5M/$25M vectors; `MAINNET=1 ./scripts/check_mainnet_parity.sh` exits 0 on the fee rows; /v1/fees serves the mainnet thresholds with a bumped scheduleVersion
- Both SDKs expose fees() and their tests pass

**Risks:** Constant-drift is the whole risk surface: the schedule lives compiled-in-contract with mirrors in shared/web — there is no on-chain fee-tier view (get_fee_tiers_config was removed for WASM), so the gateway can silently lie if a redeploy changes tiers without bumping mirrors; mitigations = scheduleVersion tied to contracts.json deployedAt, the parity-script rows (P6-3), and the shared-file grep row. protocolFeeShareBps has no getter either — serve env-mirrored or null, never a guessed 2000. Batch ordering: the threshold swap MUST be in the frozen, audited Batch-1 surface (blocks L0-18); doing it later means another redeploy. Marketing risk: the all-in story must keep the honest BTC/ETH caveat — overclaiming "beats zero-fee everywhere" is disprovable in one screenshot and burns the narrative; the defensible claims are zero spread/impact, once-at-open, and mid/long-tail dominance. Coupled with L1-21: the keeperFee block in /v1/fees changes value at Batch 1 — update shared/fees.ts in the same redeploy commit.

### L1-21 · Keeper-fee disclosure now + maker≤taker restructure in Batch 1

**Status:** todo · **Effort:** M · **Lane:** mixed · **Ships in:** batch-1-redeploy · **Needs:** L2-18 (banked fee-split decision) · **Blocks:** L0-18, L1-22
**Cross-refs:** AUDIT R-6 (fee-preview surface this disclosure extends) · TASKS P4-5 (OrderPanel fee preview wiring leftover) · LIGHTER-GAP §Fees & incentives (keeper-fee row; untracked in TASKS/AUDIT/KNOWN_ISSUES — this spec is its first tracking artifact) · **Gap rows:** Fees & incentives: Trigger-order keeper fee inverts maker economics and is undisclosed at order entry

**Current state (verified):** Verified on PROD and STAGING code alike: keeper-executed orders pay the tier fee PLUS a keeper surcharge of 0.50 USDC flat + 0.05% of size — KeeperFeeConfig::default = {base_fee: 5_000_000 (7-decimal USDC), variable_fee_bps: 5 (plain bps, divisor 10_000 at lib.rs:2394)} in contracts/noether_common/src/types.rs:371-384, computed in calculate_keeper_order_fee (market lib.rs:2378-2396: LimitEntry/StopLimit → collateral×leverage size; SL/TP/Trailing → position size). Charge points: execute_limit_entry deducts trading_fee + keeper_fee from order collateral and errors InsufficientCollateral if net ≤ 0 (lib.rs:2472-2477), paying the keeper at :2501-2508; close-type executions deduct it from remaining collateral capped at available (settle_isolated_close :2173-2183). Concrete inversion (tier 0): a $1,000 limit entry = maker $0.20 (20 deci-bps) + $0.50 + $0.50 (0.05%) = $1.20 vs $0.50 market taker → 2.4×; at min size ($10 collateral × 10x = $100 notional) = $0.02 + $0.50 + $0.05 = $0.57 vs $0.05 → 11.4×; at tier 3 the maker rate ($0.05/$1k) is 10× smaller than the keeper's variable cut alone. Disclosure is ZERO: grep of web/components/trading/*.tsx finds no keeper-fee mention (only an event-format comment in RecentTrades.tsx:145); OrderPanel's preview covers tier fees only (OrderPanel.tsx:1503-1535). The config is compiled-in (Default constructed at lib.rs:2379) — no storage, no admin setter, no view.

**Design:** Two-step exactly per the founder brief.

STEP 1 — DISCLOSURE (S, offchain-now, ships immediately against current deployed values):
- packages/shared/src/fees.ts KEEPER_FEE block (from L1-20) mirrors the deployed constants {baseUsdc7: 5_000_000, variableBps: 5} with an appliesTo list; served in GET /v1/fees.
- OrderPanel: for order types Limit, Stop-Limit, Trailing, and the TP/SL-at-open attachments, add an "Execution fee (keeper)" line: "$0.50 + 0.05% of size ($X.XX)" and an "Est. total fees" row = tier fee + keeper fee, also expressed in bps of size; when all-in maker cost > the market-order taker cost at the entered size, show an amber hint "A market order would cost less at this size ($Y.YY vs $Z.ZZ)". Fee math client-side from shared constants (web mirror), /v1/fees as the refresh source.
- Docs fee page (L1-20) gets the keeper-fee table: when it applies (keeper-executed limit/stop entries; SL/TP/trailing executions), how it's charged (from order collateral at entry; from remaining collateral capped at available on closes), and the Batch-1 restructure notice.

STEP 2 — RESTRUCTURE (M, Batch-1 contract change): make the resting path never strictly dominated. DECISION: bps-only keeper fee netted inside the maker/taker spread (founder option b). Option (a) "protocol pays keeper from treasury split" REJECTED for v1: the market holds no standing treasury balance (finalize_open transfers the cut out immediately, lib.rs:2107-2117), so it needs a fundable+drainable keeper-pool sub-balance, refill ops, and empty-pool fallback semantics — more WASM and a new attack surface for marginal benefit; revisit post-launch if third-party keeper economics demand it.
- Move the keeper fee into MarketConfig (delete KeeperFeeConfig): new fields keeper_fee_base: i128 (7-decimal USDC, DEFAULT 0) and keeper_fee_deci_bps: u32 (deci-bps, divisor FEE_PRECISION=100_000, DEFAULT 10 = 0.010%). The deci-bps rename + divisor change forces compile errors on any stale plain-bps assumption. calculate_keeper_order_fee becomes: fee = config.keeper_fee_base + size × keeper_fee_deci_bps / FEE_PRECISION.
- Validation (initialize + migrate_config): keeper_fee_deci_bps ≤ 15 and keeper_fee_base ≤ 500_000 (0.05 USDC dust allowance) — with the default tier table (maker 20/15/10/5, taker 50/40/30/20 deci-bps) the ≤15 bound guarantees maker + keeper ≤ taker at EVERY tier: 30≤50, 25≤40, 20≤30, 15≤20. A contract test pins this invariant against default_fee_tiers rather than trusting the comment.
- Resulting economics: $1,000 limit entry all-in = $0.20 + $0.10 = $0.30 vs $0.50 market (the maker path cheaper, as every trader expects); min size $100 = $0.02 + $0.01 = $0.03 vs $0.05; the keeper receives $0.10 per $1k executed. Keeper-side: Soroban resource fees are cents-scale with escalation capped at 5 XLM (P2-11) — small executions can be gas-negative in fee spikes; stance: the protocol keeper is treasury-subsidized infrastructure (its mandate is to execute everything), third-party keepers self-select into profitable executions; revisit with a keeper-pool if L0-19's second keeper needs standalone economics.
- Charge mechanics unchanged: entry-type from order collateral (net>0 check), close-type capped at available collateral. Config is admin-tunable post-launch via migrate_config (upgrade → migrate_config pattern documented at lib.rs:206-214) without a redeploy; the Batch-1 fresh deploy just initializes with the new defaults.
- Read-side sync at Batch 1: shared/fees.ts KEEPER_FEE → {baseUsdc7: 0, variableDeciBps: 10}; the /v1/fees keeperFee block schema gains variableDeciBps (keep variableBps until then); the OrderPanel line becomes "0.010% of size ($X.XX)"; docs page updated. check_mainnet_parity.sh gains a row asserting keeper_fee_base == 0 for MAINNET=1 (never ship the flat fee to mainnet).

**Implementation**

**web**
- [ ] IMMEDIATE (offchain-now): add the "Execution fee (keeper)" + "Est. total fees" lines to OrderPanel for limit/stop-limit/trailing/TP-SL-attach, computed from the shared keeper-fee constants; amber "market order cheaper" hint when all-in maker > taker at the entered size
- [ ] `npx tsc --noEmit`; visual pass on staging at $100 and $1k sizes

**api**
- [ ] IMMEDIATE: ensure the GET /v1/fees keeperFee block (L1-20) carries the current deployed values + appliesTo; test asserts the numbers
- [ ] AT BATCH 1: bump keeperFee to {baseUsdc:'0', variableDeciBps:10} with a scheduleVersion bump

**docs**
- [ ] IMMEDIATE: keeper-fee section on the docs fee page (when it applies, how charged, worked $1k example at current values) + explicit "changing in Batch 1: becomes 0.010% bps-only, maker path ≤ taker at every tier" notice
- [ ] AT BATCH 1: swap the section to the new schedule

**contracts/market**
- [ ] BATCH 1: add keeper_fee_base (default 0) + keeper_fee_deci_bps (default 10) to MarketConfig with validation (≤500_000 / ≤15); delete KeeperFeeConfig from noether_common/types.rs; rewrite calculate_keeper_order_fee to config-driven FEE_PRECISION math
- [ ] Tests: test_keeper_fee_maker_leq_taker_all_tiers (asserts maker_i + 10 ≤ taker_i for the default tier table AND that validation rejects deci_bps=16), test_keeper_fee_bps_only_at_min_size ($100 notional → 100×10^7×10/100_000 = 100_000 units = $0.01), test_keeper_fee_capped_at_available_collateral (close-type path), test_limit_entry_allin_cheaper_than_market_open ($1k integration), update every existing test constructing MarketConfig
- [ ] `cargo test -p market`; ./scripts/build_contracts.sh + record the combined Batch-1 market.wasm size vs 128KB
- [ ] Add the MAINNET=1 parity row: keeper_fee_base must be 0 (scripts/check_mainnet_parity.sh)

**keeper**
- [ ] Verify scripts/keeper has no hardcoded keeper-fee mirror (it simulates-first per P2-9/P2-10, so reward changes flow through simulation); add a log line surfacing per-execution reward vs tx fee so gas-negative executions are observable
- [ ] `cd scripts/keeper && npx tsc --noEmit`

**ops**
- [ ] Batch-1 runbook: initialize with the new MarketConfig fields; post-deploy smoke = place a $1k limit order, keeper executes, assert on-chain deductions equal maker fee + $0.10 and the OrderPanel preview matched the fill to the unit

**Acceptance:**
- IMMEDIATE: OrderPanel on staging shows the keeper line and correct all-in totals — a $1,000 limit entry displays $0.20 maker + $0.50 + $0.50 keeper = $1.20 total (current schedule) and the amber market-cheaper hint; GET /v1/fees keeperFee matches deployed constants
- BATCH 1: test_keeper_fee_maker_leq_taker_all_tiers passes and pins 30/25/20/15 ≤ 50/40/30/20 deci-bps all-in
- BATCH 1: test_limit_entry_allin_cheaper_than_market_open proves a $1k limit-entry round trip charges strictly less total fees than the market-open path
- BATCH 1 on staging: a keeper-executed $1k limit entry deducts exactly maker fee + 100_000 units ($0.10) — no flat component — and a $100-notional stop execution deducts 10_000 units ($0.01) capped at available collateral
- `MAINNET=1 ./scripts/check_mainnet_parity.sh` fails if keeper_fee_base ≠ 0
- Docs fee page shows the keeper fee in both eras with the changeover note; /v1/fees scheduleVersion bumps at the redeploy
- Keeper logs expose reward-vs-gas per execution (observable economics)

**Risks:** WASM: MarketConfig grows 2 fields + validation — small, but it rides the same crowded Batch-1 market refit as L0-4/5/6/12/13 and L1-18; size-check the combined artifact continuously (market.wasm 70,044 B today vs the 128KB limit). Migration hazard: MarketConfig field additions make the stored config undecodable after upgrade-in-place until migrate_config runs (documented trap, lib.rs:206-209) — Batch 1 is a fresh deploy so this bites only future upgrades; keep the pause→upgrade→migrate_config→unpause runbook line. Units hazard: the variable fee divisor changes 10_000→100_000 — the field rename to keeper_fee_deci_bps is the compile-time tripwire; every mirror (shared/fees.ts, docs, /v1/fees schema) must move in the same commit or the UI under-quotes fees by 10×. Keeper economics: bps-only rewards make small executions gas-negative during fee escalation (cap 5 XLM, P2-11) — acceptable for the treasury-subsidized protocol keeper but weakens third-party keeper incentives (interacts with L0-19 second-keeper and L1-23 bounty design; flag to those specs). Event formats: unchanged (order_cancelled/position events untouched) — no indexer/web decoder work.

## Ops & trust (L1-22..L1-28)

### L1-22 · Insurance-fund seeding + fee stream + published coverage ratio

**Status:** todo · **Effort:** M · **Lane:** mixed · **Ships in:** batch-1-redeploy · **Needs:** L1-18, L1-21, L2-18 (banked fee-split decision) · **Blocks:** L0-18, L1-23
**Cross-refs:** TASKS P5-6 (insurance buffer — done, market wiring rides redeploy) · TASKS P1-10 (set_fee_split — coded, operator activation pending) · TASKS P3-1 (monitoring hookup for the coverage alert) · TASKS param sheet "Insurance: seed ≥10% of aggregate OI cap · feed 100% liq penalties + 10-20% fees · waterfall margin→buffer→ADL→LP" (TASKS.md:239) · AUDIT M-4 (no insurance fund; bad debt sits on LPs) · AUDIT Part 2.2 #4 (insurance sizing: 10% of OI target, fee-fed) · AUDIT Part 2.4 #5 (insurance funds are fee-fed, not large upfront seeds) · **Gap rows:** Risk engine: No insurance-fund sizing/funding policy and no coverage transparency — buffer is unseeded, fee stream doesn't feed it, no target or published ratio [P1/S] · LP & vault products: Insurance buffer funding policy + published coverage ratio [P1/S]

**Current state (verified):** STAGING: the buffer exists and works as a winner-payout smoother — BufferBalance is a vault sub-balance excluded from LP AUM (contracts/vault/src/storage.rs:45-48), settle_pnl draws it FIRST before LP total_usdc (contracts/vault/src/lib.rs:330-362), and the market routes insurance_buffer_share_bps=1000 (10%, default at contracts/noether_common/src/types.rs:217) of all liquidation proceeds into fund_buffer on the partial (market lib.rs:581-584), full (lib.rs:649-652) and cross (lib.rs:1072-1076) paths. PROD (2026-07-06) predates all of this — no buffer at all. Funding streams today are only seed_buffer (admin, vault lib.rs:669-682 — the operator seed is still PENDING per TASKS.md:11) plus the 10% liquidation cut; trading fees do NOT feed it: finalize_open routes the protocol cut to a treasury ADDRESS via direct transfer (market lib.rs:2107-2113), inactive until set_fee_split (lib.rs:193-201) is called, and the storage.rs:46 claim that the buffer is fed by a "fee share" is aspirational. No target size exists anywhere in code, the vault has no get_reserve_cap/get_asset_cap/target getters (only setters at vault lib.rs:705-722), and no coverage metric is exposed: /v1/markets/stats returns only per-asset OI + volume (api/src/services/stats.ts:39-46) and the /vault Insurance Fund card (web/components/vault/StatsBar.tsx:70-72) shows a bare balance with no target context. The protocol vault's events (buffer_seeded/buffer_funded/payout_shortfall) are not indexed — the indexer registers only market/vaultFactory/referral (indexer/src/index.ts:34-50).

**Design:** Three pieces: a buffer target, a fee stream that fills it, and a published ratio.

1. TARGET — vault instance key `BufferTargetBps` (u32, default 1_000 = 10%); target_usd = ReservedPayout × buffer_target_bps / 10_000 (7-dec USDC). ReservedPayout is the live committed-max-payout liability (vault lib.rs:499), so the target scales with real exposure and is 0 when the book is empty (all fee flow then overflows to treasury). New entrypoints: `set_buffer_target(env, bps: u32)` (admin, bps ≤ 10_000), `get_buffer_target_bps(env) -> u32`, plus read-side getters `get_reserve_cap(env) -> u32` and `get_asset_cap(env, asset: Symbol) -> u32` (wrap existing storage fns at vault storage.rs:211-224) so the API can compute the aggregate OI cap without hardcoding defaults.
2. FEE STREAM — new vault entrypoint `route_protocol_fee(env, amount: i128, overflow_to: Address) -> Result<(), NoetherError>`: market-only auth (mirror fund_buffer at vault lib.rs:687-697); computes target as above; to_buffer = min(amount, max(0, target − BufferBalance)); credits BufferBalance += to_buffer; overflow = amount − to_buffer transferred vault→overflow_to; emits `protocol_fee_routed: (amount, to_buffer, overflow)`. Market side: in finalize_open (lib.rs:2100-2118), replace the direct treasury transfer with: transfer cut → vault, then invoke vault.route_protocol_fee(cut, treasury) (same receipt pattern as fund_vault_buffer at lib.rs:2342-2348). set_fee_split(treasury, bps) signature and semantics unchanged — treasury remains the overflow recipient. ORDERING inside the fee path (coordination, same redeploy): gross fee → L1-18 referral accrual first → protocol cut = set_fee_split bps of the remainder → route_protocol_fee (buffer-until-target, overflow to treasury, which also funds L1-18 referrer payouts and any L1-21 keeper-compensation restructure) → rest to the vault LP share via credit_vault_receipt. Never touch the LP share (founder decision). Operator defaults at activation: set_fee_split(treasury, 2_000) (20%, per the TASKS P1-10 default; sheet range 10-20%).
3. SEED (operator, launch gate) — `vault.seed_buffer(admin, amount)` with amount ≥ 1_000 bps × aggregate OI cap, where aggregate OI cap = get_reserve_cap() × get_aum() / 10_000 evaluated at launch AUM (AUDIT 2.2 #4 reference: ~$15-25k at $500k TVL); verify with get_buffer_balance. Add this as a check_mainnet_parity.sh line item.
4. COVERAGE EXPOSURE — extend GET /v1/markets/stats with a `solvency` object read via contractReader simulations (TtlCache 5s, same as stats): {vaultAum, reservedPayout, bufferBalance, bufferTargetBps, bufferTargetUsd, coverageBps: buffer × 10_000 / max(target_usd, 1) capped at 99_999, shortfall} — all i128 7-dec serialized as strings. Until the Batch-1 vault exposes get_buffer_target_bps, the API falls back to env `BUFFER_TARGET_BPS` (default 1000) so the endpoint ships against the STAGING vault now. Vault page: the StatsBar Insurance Fund card gains an "X% of target" subline + tooltip explaining the waterfall (margin → buffer → LP → shortfall; ADL when L0-1 lands); render "—" on read failure, never 0.
5. ALERT — the P3-1/L1-25 monitor watches coverageBps: warn < 5_000 (50% of target), critical < 2_500.

Migration: new vault instance keys default via unwrap_or — no vault migrate needed; no MarketConfig shape change from this item. Historical buffer/coverage series requires L1-19's vault indexing (not launch-gating; the live ratio is chain-read).

**Implementation**

**contracts/vault**
- [ ] Add DataKey::BufferTargetBps (instance u32, unwrap_or 1_000) to storage.rs with get/set helpers
- [ ] Add set_buffer_target(bps) admin entrypoint (bps ≤ 10_000, InvalidParameter otherwise) + get_buffer_target_bps() view
- [ ] Add get_reserve_cap() and get_asset_cap(asset) public views wrapping storage.rs:211-224
- [ ] Add route_protocol_fee(amount, overflow_to): market-only auth, buffer-until-target math, overflow transfer, protocol_fee_routed event
- [ ] Tests: protocol_fee_fills_buffer_to_target_then_overflows (buffer below target → all to buffer; straddling → split; at/above target → all to treasury; ReservedPayout=0 → all overflow), route_protocol_fee_rejects_non_market, set_buffer_target_admin_only

**contracts/market**
- [ ] In finalize_open (lib.rs:2100-2118): route the protocol cut via transfer-to-vault + invoke route_protocol_fee(cut, treasury) instead of the direct treasury transfer; keep cut=0 behavior when no treasury set
- [ ] Add helper route_protocol_fee_to_vault(env, vault, amount, treasury) beside fund_vault_buffer (lib.rs:2342-2348)
- [ ] Extend test_protocol_fee_split_routes_to_treasury (lib.rs:3606) into test_protocol_fee_split_buffer_first: assert the buffer fills to target before treasury receives anything, and the 80% LP share unchanged
- [ ] Coordinate the fee-path ordering with L1-18 (referral accrual precedes the protocol cut) in the same Batch-1 change

**api**
- [ ] Extend StatsService/markets stats route with the solvency block: contractReader simulations of vault get_aum/get_reserved_payout/get_buffer_balance/get_shortfall (+ get_buffer_target_bps post-redeploy, env BUFFER_TARGET_BPS=1000 fallback), TtlCache 5s
- [ ] Add solvency.coverageBps to the /v1/markets/stats OpenAPI response schema
- [ ] Test: the stats route returns the solvency object with string i128 fields and computed coverageBps; fallback path when the view is missing (staging-vault shape)

**web**
- [ ] StatsBar.tsx Insurance Fund card: add the coverage subline ("X% of target · target = 10% of reserved payouts") fed from /v1/markets/stats solvency, "—" on null
- [ ] vault page: extend the RiskDisclosure/HowItWorks copy with the funding-waterfall sentence (seed + 10% of liquidation proceeds + protocol fee cut until target)

**docs**
- [ ] docs.noether.exchange (NoetherDEX/noether-docs): Insurance Fund page — funding sources, target formula (10% of ReservedPayout), waterfall order, coverage ratio definition, link to the live /v1/markets/stats numbers

**ops**
- [ ] At Batch-1 promotion: market.set_fee_split(treasury_multisig_addr, 2000); vault.set_buffer_target(1000)
- [ ] Launch gate: vault.seed_buffer(admin, amount) with amount ≥ 10% × (get_reserve_cap × get_aum / 10_000); record the tx hash in the launch checklist
- [ ] Add a seed-verification line to scripts/check_mainnet_parity.sh (fail when get_buffer_balance < the computed floor)
- [ ] Register the coverage alert in the L1-25 monitor set (warn <50%, critical <25% of target)

**Acceptance:**
- `cargo test -p vault`: protocol_fee_fills_buffer_to_target_then_overflows, route_protocol_fee_rejects_non_market, set_buffer_target_admin_only pass
- `cargo test -p market`: test_protocol_fee_split_buffer_first passes and the existing insurance_buffer_pays_winners_before_lp (vault lib.rs:1050) still passes
- On-chain after Batch-1 + operator steps: get_buffer_balance ≥ 10% of (get_reserve_cap × get_aum / 10_000); opening a position with set_fee_split active increases get_buffer_balance while buffer < target and increases the treasury USDC balance once at target
- GET /v1/markets/stats returns solvency.{bufferBalance,bufferTargetUsd,coverageBps,reservedPayout,shortfall} as strings, coverageBps consistent with chain reads
- /vault Insurance Fund card renders balance + coverage-of-target, and "—" (not 0) when the gateway read fails

**Risks:** Fee-path surgery in finalize_open is shared with L1-18 (referral accrual) and L1-21 (keeper-fee restructure) — one engineer must own the combined ordering or the three specs double-spend the same cut; the founder constraint "never the LP share" must be asserted by a test that LP credit equals fee − referral − protocol cut exactly. WASM: +1 vault entrypoint and 3 views on a 37,458 B vault (2026-07-10 build) — ample headroom under the 128 KB limit; the market change is a net-neutral swap. route_protocol_fee adds one cross-contract call per open — measure the instruction budget in the Batch-1 simulation pass. Coverage reads against PROD fail until the coupled redeploy (the PROD vault predates get_buffer_balance) — the API must degrade to nulls, never 0 (money-truth rule). Buffer accounting is also touched by L0-2 (bad-debt draw) and L1-23 (bounty) — all three debit BufferBalance and must saturate at zero.

### L1-23 · Bankruptcy keeper bounty

**Status:** todo · **Effort:** S · **Lane:** contracts · **Ships in:** batch-1-redeploy · **Needs:** L0-2, L0-4, L1-22 · **Blocks:** L0-18
**Cross-refs:** TASKS param sheet "Partial liq: … penalty 1% notional (50/50 keeper/insurance, 5 USDC floor)" (TASKS.md:238) · AUDIT M-4 ("Keepers earn nothing on underwater positions") · AUDIT Part 2.2 #3 (keeper incentive ~1% of closed notional, 50/50 keeper/insurance, 5 USDC floor) · LIGHTER-GAP §Risk engine [P1/S] zero keeper incentive to clear bankrupt positions · **Gap rows:** Risk engine: Zero keeper incentive to clear bankrupt positions, and a single operational liquidator [P1/S] (bounty half; the second-keeper/runbook half is L0-19)

**Current state (verified):** PROD+STAGING: the keeper reward on isolated full liquidation is calculate_keeper_reward(remaining, liquidation_fee_bps) — 5% of remaining equity, and exactly 0 when remaining = collateral + pnl − funding ≤ 0 (contracts/market/src/lib.rs:624-628; liquidation_fee_bps=500 default at noether_common/types.rs:206), capped at 10% of collateral (lib.rs:631-635). Cross liquidation mirrors it: keeper_reward = equity × liquidation_fee_bps / 10_000 only when equity > 0 (lib.rs:1082-1090), so every bankrupt clear — the direct-bad-debt case where excess loss is "absorbed by vault" (lib.rs:1061-1062) — pays nothing. The partial-liquidation tranche path (STAGING only, lib.rs:535-618) pays a tranche-scaled reward but only fires when NOT bankrupt (lib.rs:516-517,535). The protocol keeper liquidates anyway (simulate-first pipeline, P2-9), but no rational third party will, and there is no published liquidator runbook. The buffer that would fund a bounty exists on STAGING (vault BufferBalance) but has no payout entrypoint besides settle_pnl's winner waterfall (vault lib.rs:321-384).

**Design:** Give bankrupt clears a flat floor paid from the insurance buffer, composing with L0-4's penalty restructure.

1. CONFIG — add `min_liq_bounty: i128` to MarketConfig (7-dec USDC, default 50_000_000 = 5 USDC; 0 disables). This is a config-shape change: rides the single Batch-1 migrate_config (market lib.rs:224-238 pattern: pause → upgrade → migrate_config → unpause), coordinated with L0-4/L0-12/L1-26 field additions in ONE new MarketConfig.
2. VAULT ENTRYPOINT — `pay_bounty(env, keeper: Address, amount: i128) -> Result<i128, NoetherError>`: market-only auth; paid = min(amount, BufferBalance, vault USDC balance); debits BufferBalance and transfers vault→keeper; returns paid (0 is fine — a dry buffer must NEVER block the clear); emits `bounty_paid: (keeper, requested, paid)`.
3. MARKET WIRING — semantics: the bounty tops the keeper leg up to the floor, i.e. topup = max(0, min_liq_bounty − keeper_leg_paid_from_equity). Post-L0-4, the keeper leg on non-bankrupt full liquidations is penalty/2 (0.5% of notional) so the topup binds only on small/bankrupt positions; pre-L0-4 semantics (if sequencing slips) degrade gracefully to topup = min_liq_bounty when remaining ≤ 0. Call sites: (a) isolated liquidate() full-liq settlement — after the keeper transfer block (lib.rs:655-658), when the actual keeper payout < min_liq_bounty, invoke vault.pay_bounty(keeper, floor − paid) and add the returned amount to the Ok() return value and to the keeper_reward field of the position_liquidated event tuple (event FORMAT unchanged — same 7 fields at lib.rs:666-669, only the value now includes the bounty; indexer/web decode untouched); (b) liquidate_cross_account — same topup after lib.rs:1092-1095, folded into the cross_liq keeper_reward field (lib.rs:1126-1129); (c) partial-liq tranche path: NO bounty (only fires non-bankrupt with equity-funded reward). No new market event; the vault's bounty_paid event is the audit trail (decoded when L1-19 vault indexing lands).
4. ECONOMIC BOUNDS — the bounty is capped by the buffer, cannot exceed the floor, and is per-liquidation-call; a griefing loop of dust-position bankruptcies is bounded by min_collateral = 10 USDC (types.rs:203) per position opened vs the 5 USDC bounty — an attacker burns ≥10 USDC collateral (which flows to vault/buffer as proceeds minus the 5 paid) per bounty extracted, i.e. buffer-negative griefing is not profitable; state this invariant in a test.
5. RUNBOOK — the L0-19 third-party liquidator runbook documents: entrypoints (market.liquidate / liquidate_cross_account, router liquidate_with_price / liquidate_cross_with_prices), reward math incl. the 5 USDC floor, the simulate-first pattern, and that bounties pay from the public get_buffer_balance. Keeper code: no change required (reward is a return value); optionally log bounty-only clears distinctly.

**Implementation**

**contracts/vault**
- [ ] Add pay_bounty(keeper, amount) -> i128: market-only, min(amount, buffer, vault balance), debit BufferBalance, transfer, bounty_paid event
- [ ] Tests: bounty_capped_at_buffer (buffer 3 USDC, request 5 → paid 3, buffer 0), bounty_zero_buffer_returns_zero_never_errors, pay_bounty_rejects_non_market

**contracts/market**
- [ ] Add min_liq_bounty to MarketConfig + Default (50_000_000) + migrate_config validation (≥ 0)
- [ ] liquidate(): after keeper payout, topup = max(0, min_liq_bounty − paid); invoke vault.pay_bounty; fold into the return + position_liquidated keeper_reward value
- [ ] liquidate_cross_account(): same topup after lib.rs:1092-1095, folded into the cross_liq keeper_reward
- [ ] Tests: test_bankrupt_liquidation_pays_flat_bounty (remaining ≤ 0 → keeper receives exactly 5 USDC from the buffer, buffer debited), test_bounty_tops_up_small_keeper_leg (leg 2 USDC → +3 topup), test_bounty_skipped_when_leg_exceeds_floor, test_bankrupt_cross_liq_pays_bounty, test_bounty_dry_buffer_liquidation_still_succeeds, test_bounty_griefing_unprofitable (min_collateral proceeds to vault exceed the bounty paid)
- [ ] Keep test_liquidation_reward_capped (lib.rs:3673) and test_liquidation_works_while_paused (lib.rs:3330) green

**keeper**
- [ ] No functional change; add a log line distinguishing bounty-funded clears (reward > 0 while simulated equity ≤ 0) for ops visibility

**docs**
- [ ] Contribute the bounty section to the L0-19 liquidator runbook: reward formula incl. the floor, funding source (public get_buffer_balance), simulate-first recipe, router price-carrying entrypoints

**Acceptance:**
- `cargo test -p market`: test_bankrupt_liquidation_pays_flat_bounty, test_bounty_tops_up_small_keeper_leg, test_bounty_skipped_when_leg_exceeds_floor, test_bankrupt_cross_liq_pays_bounty, test_bounty_dry_buffer_liquidation_still_succeeds, test_bounty_griefing_unprofitable all pass; existing liquidation suite unchanged
- `cargo test -p vault`: bounty_capped_at_buffer, bounty_zero_buffer_returns_zero_never_errors, pay_bounty_rejects_non_market pass
- On-chain (staging, post-Batch-1): liquidating a manufactured bankrupt position pays the keeper exactly min_liq_bounty from the buffer (keeper USDC +5, get_buffer_balance −5) and the position_liquidated event's keeper_reward field equals the paid amount
- Event formats unchanged: indexer decoders and web parsers pass without modification (the CLAUDE.md event table stays valid)
- The L0-19 runbook contains the bounty math and funding source

**Risks:** MarketConfig shape change → the market bricks between upgrade and migrate_config (documented trap at lib.rs:206-209); ALL Batch-1 config fields (this, L0-4 penalty bps, L0-12 per-asset ladder if it folds into MarketConfig, L1-26 clamp bps) must land as ONE struct and ONE migrate_config call — a second shape change post-audit-freeze reopens audit scope. If L0-12 replaces MarketConfig with per-asset config, min_liq_bounty should live in the global remainder, not per-asset. The buffer is triple-debited across L0-2/L1-22/L1-23 — order draws deterministically (bad-debt draw, then bounty) and saturate at zero. An unfunded buffer (operator seed skipped) silently reverts to today's zero-bounty economics — the check_mainnet_parity.sh seed gate (L1-22) is the guard. WASM: +~40 lines market, +1 vault entrypoint — trivial at the current 70,044 B / 128 KB.

### L1-24 · Listing pipeline runbook-as-code + per-asset halt

**Status:** todo · **Effort:** M · **Lane:** mixed · **Ships in:** batch-1-redeploy · **Needs:** L0-12, L0-14 · **Blocks:** L0-18, L2-19
**Cross-refs:** TASKS G-2 (new-pair policy: 3-5x leverage, 5%-TVL OI cap) · TASKS P2-6 (router coarse price bands — done, hardcoded) · AUDIT O-7 (price sanity bounds) · AUDIT O-8 (symbol→tag single source — fixed via noether_common::assets, PAIR_TAGS) · KNOWN_ISSUES G-4 (indexer silently skips contracts/addresses missing from contracts.json — the class of silent listing misconfig) · LIGHTER-GAP §Market specs & listings [P1/M] listing pipeline and per-market lifecycle controls · **Gap rows:** Market specs & listings: Listing pipeline and per-market lifecycle controls (listing agility) [P1/M]

**Current state (verified):** STAGING(+PROD, 14 pairs): the core mechanic is table-driven — PAIR_TAGS in contracts/noether_common/src/assets.rs:17-32 is the single symbol→tag source, and the file's own recipe (assets.rs:7-8) says adding a pair = new PAIR_TAGS row + a router band + upgrade/redeploy BOTH shim and router. The router's sanity bands are a HARDCODED const table (noether_router/src/lib.rs:664-679) and an asset absent from it makes price_bounds return Err(InvalidPrice) (lib.rs:685) — so the router relay path is dead for any new pair until a router upgrade. The keeper's per-asset bands are another hardcoded array (scripts/keeper/src/config.ts:18-34; env can tune maxMovePct only, not add assets). Remaining per-listing steps are scattered: vault set_asset_cap (vault lib.rs:715-722, default 2500 bps if unset), risk.set_config (contracts/risk/src/lib.rs:71 — risk contract UNDEPLOYED, no contracts.json entry), indexer candle seed via a Binance-only map (indexer/src/candles/seed.ts:23-38; HYPE deliberately absent → native-only charts), and TWO web/shared asset lists (packages/shared/src/assets.ts:8-24 and web/lib/utils/constants.ts:142). No per-asset halt exists — the market has only the global Paused instance flag; update_config was removed for WASM (contracts/CLAUDE.md removed-list), so one broken feed forces a whole-venue pause.

**Design:** Two contract changes + one script + one policy doc.

(A) PER-ASSET HALT (market, Batch 1) — storage `DataKey::AssetHalted(Symbol)` (persistent bool, unwrap_or false); entrypoint `set_asset_halt(env, asset: Symbol, halted: bool)`: require_admin, validate asset via noether_common::assets::symbol_to_tag (unknown symbol → its existing error), set the flag, emit `asset_halt_set: (asset, halted)`; new error `AssetHalted = 85` in noether_common/errors.rs (next free after LiquidationCooldown=83; 84 reserved for L1-28 — final numbering is a Batch-1 integration checkpoint). Gate helper `require_asset_open(env, asset)` called ONLY on risk-increasing paths, mirroring the M-2 strict/lenient split: do_open (covers open_position + open_position_cross), place_limit_order, place_stop_limit_order, and the entry-execution branch of execute_order (LimitEntry + StopLimit phase-0→1). Explicitly NOT gated: close_position(_cross), liquidate(_cross_account), cancel_order, SL/TP/trailing attach on existing positions (risk-reducing). Keeper: skip trigger-entry execution attempts for halted assets pre-simulation (avoid #85 alert noise); simulate-first already makes this safe. Web: map #85 in contractErrors.ts ("Trading in this market is temporarily halted — closing positions still works") and grey the asset in the selector when /v1/markets marks it halted (the API reads the flag via contractReader; add `halted: boolean` to /v1/markets rows).

(B) ADMIN-SETTABLE ROUTER BANDS (router, Batch 1) — storage `DataKey::PriceBand(Symbol) -> (i128, i128)`; `set_price_band(env, asset, lo: i128, hi: i128)` (admin; 0 < lo < hi) + `get_price_band(asset) -> Option<(i128,i128)>`; price_bounds() checks storage first, falls back to the compiled BANDS table so all 14 existing pairs need zero migration. New pairs then need NO router redeploy — only shim upgrade() (which already exists, noeracle_shim lib.rs:234) for the PAIR_TAGS table. Note: PAIR_TAGS is compiled into shim AND router; a new pair still requires upgrading both WASMs unless symbol_to_tag gains a storage-backed extension — DECISION: keep tags compile-time (byte-identical safety, O-8) and accept "new pair = rebuild + upgrade() shim & router in place" as the listing path; the script drives it.

(C) scripts/list_pair.ts — runbook-as-code, `npx tsx scripts/list_pair.ts --asset SYM [--execute]` (default dry-run prints PASS/PENDING/FAIL per step; --execute performs idempotent mutations, each guarded by a pre-check): 1. Noeracle feed live-check: fetch the latest attestation for tag SYMUSD from api.noeracle.org, require age < 60s and signed by the configured publisher set; 2. PAIR_TAGS row present in noether_common (grep) + built shim/router WASM hashes differ from deployed → prompt upgrade() calls; 3. shim read-check: simulate shim get_price_pers for the tag; 4. router band: get_price_band(SYM) set, else set_price_band from a per-asset config block in the script; 5. keeper config: assert SYM in DEFAULT_ASSETS (config.ts) and /v1/oracle/health shows the asset fresh — else FAIL with the exact edit; 6. vault caps: set_asset_cap(SYM, bps) per G-2 (new pairs 500 bps = 5% TVL) + the L0-14 absolute-USD cap variant when it exists; 7. risk config: risk.set_config(SYM, RiskConfig::new_pair()) (im 2000/mm 1000/5x, risk.rs:72-78) once L0-12 deploys the risk contract — PENDING before that; 8. market halt state: set_asset_halt(SYM, false) explicit (list halted-by-default: run steps 1-7 with halt ON, flip OFF last); 9. candle seed: run the indexer seed for (SYM × intervals) — Binance if BINANCE_PAIRS has it, else the Noeracle-history fallback (UNVERIFIED: whether api.noeracle.org exposes historical bars — if not, document "starts native-only" like HYPE, seed.ts:21-22); 10. web/shared lists: assert SYM in packages/shared SUPPORTED_ASSETS AND web constants.ts ASSETS; verify the deployed gateway /v1/markets returns it; 11. print the docs-site listing-table diff.

(D) LISTING POLICY (docs) — publish: G-2 defaults (3-5x, 5%-TVL cap), the L0-14 external-depth rule for the absolute cap, first-weeks review cadence, halt criteria (feed divergence/keeper gap), and the delist path (halt-open → allow-close window → cancel resting orders → remove from UI).

**Implementation**

**contracts/market**
- [ ] Add AssetHalted(Symbol) storage + set_asset_halt entrypoint + asset_halt_set event + AssetHalted=85 error
- [ ] Gate do_open / place_limit_order / place_stop_limit_order / execute_order-entry-branch with require_asset_open; leave all close/liquidate/cancel/attach paths ungated
- [ ] Tests: test_asset_halt_blocks_open_allows_close (halt BTC → open #85, close + liquidate succeed, ETH unaffected), test_asset_halt_blocks_entry_order_placement_and_execution, test_asset_halt_admin_only_and_unknown_symbol_rejected

**contracts/noether_router**
- [ ] Add PriceBand(Symbol) storage, set_price_band (admin, 0<lo<hi) + get_price_band; price_bounds() = storage override → compiled BANDS fallback
- [ ] Tests: band_override_takes_precedence_over_const_table, unknown_asset_with_stored_band_accepted, set_price_band_rejects_inverted_bounds

**keeper**
- [ ] Skip trigger-entry executions for assets the market reports halted (read the flag once per cycle via simulation, cache)
- [ ] Document in scripts/keeper/README: adding a pair = DEFAULT_ASSETS row (config.ts:18-34) + Railway redeploy

**indexer**
- [ ] Expose the candle seeder as a callable script entry (`npm -w @noether/indexer run seed -- --asset SYM`) instead of boot-only
- [ ] Add the Noeracle-history fallback seed path for non-Binance assets (or explicit "native-only start" log when no history source exists)

**api**
- [ ] Add halted: boolean to /v1/markets and /v1/markets/:asset rows via a contractReader read of AssetHalted (TtlCache), schema update
- [ ] Test: the markets route reflects a halted flag flip

**web**
- [ ] Map error #85 in contractErrors.ts; disable the OrderPanel submit + grey the pair in AssetSelectorDropdown when the markets API reports halted (closing UI untouched)

**ops**
- [ ] Write scripts/list_pair.ts implementing the 11-step idempotent checklist (dry-run default, --execute mutates), reading contracts.json + .env, exiting 1 on any FAIL
- [ ] Run it against an existing pair (LTC) as the no-op regression proof, then use it for the next real listing

**docs**
- [ ] Publish the listing policy page (defaults, cap sizing rule, halt/delist criteria, review cadence) on docs.noether.exchange and link it from the market-specs table (L1-12)

**Acceptance:**
- `cargo test -p market`: test_asset_halt_blocks_open_allows_close, test_asset_halt_blocks_entry_order_placement_and_execution, test_asset_halt_admin_only_and_unknown_symbol_rejected pass
- `cargo test -p noether_router`: band_override_takes_precedence_over_const_table, unknown_asset_with_stored_band_accepted, set_price_band_rejects_inverted_bounds pass
- On-chain (staging): set_asset_halt(BTC, true) → open_position reverts #85 while close_position and liquidate succeed and other pairs trade; set_price_band for a symbol NOT in the const table lets refresh_price accept a price for it
- `scripts/list_pair.ts --asset LTC` (dry-run) prints all-PASS against the live staging stack; `--asset FAKE` exits 1 at the feed check
- GET /v1/markets rows carry halted:false for all live pairs and flip within the cache TTL after set_asset_halt
- Listing policy page live on docs.noether.exchange

**Risks:** PAIR_TAGS stays compile-time in BOTH shim and router — the script must verify deployed WASM hash vs built hash or a listing silently serves the old table (O-8 drift class). The keeper band list is code, not config: a listing without the keeper edit leaves the new pair with no publisher — the script's step 5 FAIL is the only guard, keep it loud. Halt gating must never leak onto close/liquidate paths (M-2 philosophy) — the blocks-open-allows-close test is the invariant. Error #85 assignment collides if another Batch-1 spec claims it — reconcile codes at the Batch-1 integration checkpoint. The risk.set_config step is PENDING until L0-12 deploys the risk contract; the script must mark it PENDING, not PASS. WASM: market +~60 lines on 70,044 B — fine under 128 KB.

### L1-25 · Public status page + monitoring (closes P3-1)

**Status:** todo · **Effort:** S · **Lane:** mixed · **Ships in:** operator-track · **Needs:** — · **Blocks:** —
**Cross-refs:** TASKS P3-1 (monitoring stack — code part done, operator hookup open) · TASKS P3-7 (docs/INCIDENT_RUNBOOK.md — exists, internal) · TASKS P4-9 (indexer /healthz — done) · AUDIT D-2 (no monitoring/alerting/deadman for keeper/api/indexer) · AUDIT K-1 (keeper dies silently) · AUDIT O-5 (single-keeper liveness SPOF) · AUDIT O-6 (stale price rendered as live — age display) · KNOWN_ISSUES D-3 2026-07-13 addendum (5-week frozen indexer cursor — detection is ledgerAgeSeconds) · LIGHTER-GAP §Platform [P1/S] public status & transparency page · **Gap rows:** Platform, API & trust: Public status & transparency page [P1/S]

**Current state (verified):** STAGING+PROD: the machine surfaces already exist — GET /v1/health echoes resolved contract addresses plus indexer.ledgerAgeSeconds (api/src/routes/health.ts:45-59, kept truthful by the quiet-poll heartbeat, commit e130b4f); GET /v1/oracle/health serves per-asset on-chain price age (stale threshold 90s at api/src/routes/oracleHealth.ts:21) plus the keeper's last self-report, and the keeper already POSTs a heartbeat to /v1/oracle/heartbeat every cycle when KEEPER_HEARTBEAT_URL/SECRET are set (scripts/keeper/src/heartbeat.ts:19-25, config.ts:204-207; stale after 120s per oracleHealth.ts:23); the indexer serves /healthz (P4-9). Nothing watches any of it: no status page exists (no status route under web/app, no status.noether.exchange), no uptime history, no incident feed; P3-1's operator half is explicitly open (TASKS.md:118) and docs/INCIDENT_RUNBOOK.md is internal-only. On-chain solvency views (vault get_aum lib.rs:563-566, get_reserved_payout :725-727, get_buffer_balance :700-702, get_shortfall :730-732) are public reads with no published surface. Trust framing: one keeper and one oracle publisher (AUDIT O-5/K-1) means liveness IS the product.

**Design:** Operator runbook with three small code dashes.

1. STATUS PAGE (operator) — BetterStack (or UptimeRobot) public page at status.noether.exchange (CNAME via the domain registrar; domain inventory per the project_domains memo: prod=noether.exchange, gateway=Azure Container Apps URL until api.noether.exchange lands via L1-16). Monitors (name → probe → alert rule): [a] "API gateway" → GET https://<gateway>/v1/health expect 200 → down after 2 consecutive fails (60s interval); [b] "Indexer freshness" → same endpoint with JSON assertion indexer.ledgerAgeSeconds ≤ 120 (matches the web trust gate MAX_INDEXER_LAG_SECONDS=120 at web/lib/api/gateway.ts:26) → degraded >120s, major >600s; [c] "Oracle freshness" → GET /v1/oracle/health, assert every asset's on-chain age ≤ 90s (the server already flags at ONCHAIN_STALE_SEC=90) → degraded on any stale asset, major when the keeper heartbeat is also stale; [d] "Keeper deadman" → BetterStack heartbeat monitor expecting a ping every 60s, grace 120s (2 missed 30s cycles ≈ the 60s market staleness window); [e] "Web app" → GET https://noether.exchange expect 200; [f] "Insurance coverage" (once L1-22 ships) → /v1/markets/stats JSON assert solvency.coverageBps ≥ 5000 → warning, ≥2500 → major. Escalation: BetterStack → the existing keeper Discord/Telegram webhook channel (P2-7 alerting) + email both founders; incident templates seeded from the docs/INCIDENT_RUNBOOK.md triage table (oracle-stale, keeper-down, indexer-stale, exploit→pause).
2. KEEPER DEADMAN PING (keeper, ~5 lines) — extend scripts/keeper/src/heartbeat.ts to also GET/POST the BetterStack heartbeat URL from env DEADMAN_PING_URL each completed cycle (fire-and-forget like the existing gateway POST; never blocks the loop). Set KEEPER_HEARTBEAT_URL/SECRET on Railway at the same time so /v1/oracle/health carries the self-report (operator env step).
3. TRANSPARENCY PAGE (docs) — docs.noether.exchange "Transparency" page embedding: the BetterStack status widget/iframe, live solvency numbers fetched client-side from /v1/markets/stats solvency (L1-22) with the four raw view names documented (get_aum, get_reserved_payout, get_buffer_balance, get_shortfall) and a "recompute it yourself" curl/CLI snippet per view, plus links to /v1/health and /v1/oracle/health. This intentionally exceeds Lighter's transparency surface (their syntheticSpotInfo analog) at documentation cost.
4. FOOTER LINK (web) — add "Status" → status.noether.exchange in the site footer (LandingFooter) and the app shell.

Public-history retention: enable 90-day uptime history on the page from day one so mainnet launch inherits a track record. Cost envelope: BetterStack free/starter tier covers 6 monitors + heartbeat (per AUDIT 2.4 #7 ~$0-50/mo budget).

**Implementation**

**ops**
- [ ] Create the BetterStack account under the team org; create the 6 monitors with the exact probes/thresholds above; wire Discord/Telegram + founder email escalation
- [ ] Publish the public status page; CNAME status.noether.exchange to it; enable 90-day history
- [ ] Set Railway keeper env: KEEPER_HEARTBEAT_URL=<gateway>/v1/oracle/heartbeat, KEEPER_HEARTBEAT_SECRET (generate, mirror in gateway env), DEADMAN_PING_URL=<BetterStack heartbeat URL> — apply to noetherkeeperbotv2
- [ ] Seed incident templates from docs/INCIDENT_RUNBOOK.md; run one test incident end-to-end (pause the keeper 3 min → deadman fires → oracle-freshness degrades → recover → resolve incident)
- [ ] Mark TASKS P3-1 operator half done (do not edit TASKS.md per founder decision — record in the plan/launch checklist instead)

**keeper**
- [ ] Extend heartbeat.ts: fire-and-forget fetch(DEADMAN_PING_URL) per completed cycle when the env is set; never throw into the loop
- [ ] tsc + smoke: cycle completes with DEADMAN_PING_URL unset (no-op) and with a mock URL (ping fired)

**web**
- [ ] Add the Status footer link (LandingFooter + app footer) pointing at status.noether.exchange

**docs**
- [ ] Add the Transparency page: status embed, live solvency panel from /v1/markets/stats, raw on-chain view documentation with recompute snippets, links to /v1/health and /v1/oracle/health

**Acceptance:**
- status.noether.exchange resolves publicly and shows all six monitors green against the live prod stack
- Kill test: stopping the keeper for >2 min flips the deadman monitor and posts to Discord/Telegram; restarting recovers it without manual action
- Stall test: the indexer-freshness monitor turns degraded when ledgerAgeSeconds exceeds 120 (verifiable by pausing the indexer container briefly on staging)
- GET /v1/oracle/health shows keeper self-report populated (heartbeat env live on Railway)
- The docs Transparency page renders live solvency numbers that match direct chain reads of get_aum/get_reserved_payout/get_buffer_balance/get_shortfall
- The web footer links to the status page from prod

**Risks:** Monitor-vs-contract drift: the thresholds encode today's constants (120s trust gate, 90s oracle staleness, 30s keeper cadence) — if Batch 1 changes max_price_staleness or the keeper cadence, the monitors must be re-tuned in the same rollout or they false-alarm/miss. The gateway URL is the Azure Container Apps domain until L1-16's api.noether.exchange CNAME — build monitors against the stable CNAME once it exists or every infra move breaks probes (the exact docs-drift failure L1-16 fixes). The keeper deadman must stay fire-and-forget: a blocking ping inside the loop recreates the K-1 hang class the watchdog was built against. The coverage monitor depends on L1-22's solvency block — create it disabled until that endpoint ships to avoid a permanently-red tile.

### L1-26 · Exit guarantees published + stale-close disclosure/clamp

**Status:** todo · **Effort:** M · **Lane:** mixed · **Ships in:** batch-1-redeploy · **Needs:** L0-7, L0-15 · **Blocks:** L0-18
**Cross-refs:** AUDIT M-2 (market trusts oracle with zero bound; lenient path deliberate — halt-open/allow-close) · AUDIT O-6 (no read-time staleness guard — display consumers show frozen prices as live) · TASKS P1-5 (oracle deviation guard #81 — strict paths only; closes/liquidations never blocked) · TASKS P4-24 (e2e harness — the pattern the degraded-mode scenario extends) · UIUX A8 (never render unknown/stale money as a number — stale badge pattern) · LIGHTER-GAP §Amendments [P1/M] published trader exit guarantee under keeper/oracle halt + §Parity "trader-side escape hatch mostly exists by construction" · **Gap rows:** Amendments (platform+risk-adl): Published trader exit guarantee under keeper/oracle halt, with stale-close disclosure [P1/M]

**Current state (verified):** STAGING+PROD: the structural guarantee exists but is unpublished and unbounded. Closes and liquidations read the oracle with strict=false and are never blocked by the 60s staleness bound or the 1% deviation band (contracts/market/src/lib.rs:2042-2081; strict applies only to opens/trailing peaks per the M-2 comment at :2034-2041); winner settlement caps-not-reverts with shortfall booking (contracts/vault/src/lib.rs:321-371); liquidations are permissionless and pause-exempt (market lib.rs:477, test_liquidation_works_while_paused at :3330); and router close_with_price lets ANY party relay a fresh signed Noeracle attestation with their own close in one tx (contracts/noether_router/src/lib.rs:204-225). Residue: with the oracle halted, close_position executes at whatever price sits in the slot — get_oracle_price returns the stale print with no age disclosure to the caller and no bound on a deviant print reaching lenient consumers (:2077-2080 only refresh last-good when fresh). The web close flow (PositionsList handleClose at web/components/trading/PositionsList.tsx:139) shows no mark age, though the age data exists — shim getPrice returns {price, timestamp} (web/lib/stellar/oracle.ts:48-51) and the SSE watchdog exposes a stale flag (web/lib/stellar/noeracle.ts:95-167). No scenario test proves close + LP withdraw survive a keeper halt (e2e/src has only roundtrip.ts), and nothing on docs.noether.exchange documents any of it.

**Design:** Four components.

1. DOCS "Exit guarantees" page (NoetherDEX/noether-docs, next to the L2-14 verifiability story): a degraded-mode matrix — keeper down / oracle halted / gateway down / venue paused — listing per state what a trader and an LP can still do, each claim linked to code or a tx: closes never staleness/deviation-blocked (M-2), settle_pnl caps-not-reverts + shortfall ledger, liquidations permissionless + pause-exempt, LP withdraw subject only to the ReservedPayout floor (vault lib.rs:267-269). Include the SELF-RELAY WALKTHROUGH: fetch the latest signed attestation from the Noeracle public API (the same payload the web uses via noeracle.ts), then call router.close_with_price(trader, position_id, asset, price, timestamp, round_id, pubkeys, sigs) — document arg encoding (price i128 7-dec, tag = symbol_to_tag), a copy-paste stellar-cli invocation, and the honest caveats table (single publisher until L0-8, pause asymmetry until L0-15, admin EOA until L0-16). Publish AFTER the L0-7 prod cutover so the walkthrough describes the authenticated write path.
2. UI STALE-CLOSE DISCLOSURE (web, deployable now): in the close confirmation modal, read the shim mark age (oracle.ts timestamp) alongside the SSE stale flag; when age > 60s (= max_price_staleness) render an amber block: "Oracle mark is {age}s old — this close will execute at the last stored print (${price}), which may differ from the live market" and require an explicit checkbox before enabling Confirm; below 60s show a neutral "mark age {age}s" line. Same treatment on the cross-margin close and withdraw-cross flows. Never block the close (M-2 intent) — disclosure only.
3. E2E DEGRADED-MODE SCENARIO (e2e/src/degradedMode.ts, operator-run vs staging like roundtrip.ts): with a funded trader holding an open position, stop the keeper (or use an asset whose feed is intentionally not pushed) and wait > max_price_staleness; assert (a) open_position on that asset reverts #30 PriceStale, (b) close_position succeeds at the last print and the position row clears, (c) vault.withdraw succeeds for an LP, (d) router.close_with_price with a freshly-fetched attestation also succeeds for a second position. Wire as an npm script with a documented operator recipe; skip-path when env is absent (P4-24 pattern).
4. LENIENT-PATH CLAMP (contracts/market, Batch 1) — decision: implement, not just evaluate. Add `lenient_clamp_bps: u32` to MarketConfig (default 300 = 3%, 0 disables; rides the single Batch-1 migrate_config). In get_oracle_price (:2042-2081), on the strict=false branch: if a last-good price exists and now − last_ts ≤ 10 × max_price_staleness (reusing the exact band-disable window at :2065), clamp the returned price into [last × (1 − clamp), last × (1 + clamp)] instead of returning it raw; outside the window (long halt) pass through unclamped — closes must never brick. Semantics: during a pure oracle halt the slot equals last-good so the clamp is a no-op (disclosure is the remedy there); the clamp binds exactly against the dangerous case — a single deviant/malicious print reaching settlement — bounding close/liquidation mispricing to 3% per fresh round instead of unbounded. Tradeoff stated for the implementer: in a legitimate >3% inter-round gap, closes settle up to 3% off spot for at most one oracle round (~30s) until last-good refreshes at :2077-2079; that is the accepted cost. Trigger-mark smoothing for liquidation ELIGIBILITY remains L0-9's scope; this clamp governs the settlement read.

**Implementation**

**contracts/market**
- [ ] Add lenient_clamp_bps to MarketConfig + Default (300) + migrate_config validation (< BASIS_POINTS); coordinate the single Batch-1 config-shape migration with L1-23/L0-4/L0-12
- [ ] Implement the clamp in get_oracle_price's non-strict branch gated on the 10×-staleness last-good window
- [ ] Tests: test_lenient_clamp_bounds_wild_print_on_close (last-good 100, slot 150 → close settles at 103), test_lenient_clamp_releases_after_fresh_round (fresh 150 updates last-good → next close at 150), test_lenient_clamp_noop_during_pure_halt (stale slot == last-good → price unchanged, close succeeds), test_lenient_clamp_disabled_outside_window (last-good older than 10× staleness → raw price, close succeeds), test_clamp_zero_disables
- [ ] Assert existing test_stale_price_halts_opens_allows_closes (lib.rs:3415) and test_deviation_guard_halts_opens_allows_closes (:3383) stay green
- [ ] Re-measure optimized market.wasm and record the delta in the shared batch-1 size ledger (70,044 B baseline vs 131,072 B limit)

**web**
- [ ] Close modal (PositionsList): fetch the shim mark age pre-confirm; amber stale-close disclosure + explicit checkbox when age > 60s; neutral age line otherwise; same for cross close
- [ ] Reuse the SSE stale flag (noeracle.ts onStatus) as the fast-path trigger so the modal doesn't wait on a chain read when the stream is already flagged stale
- [ ] tsc + manual staging pass with the keeper paused

**docs**
- [ ] Write the Exit-guarantees page: degraded-mode matrix, self-relay close_with_price walkthrough with exact CLI invocation and attestation-fetch recipe, caveats table, link to the e2e scenario as the proof artifact
- [ ] Cross-link from the Transparency page (L1-25) and the future verifiability story (L2-14)

**ops**
- [ ] Build e2e/src/degradedMode.ts (keeper-halted-N-minutes scenario, assertions a-d above) + npm script + operator recipe in the e2e README
- [ ] Run it against staging post-Batch-1 and paste the run log into the docs page's proof section

**Acceptance:**
- `cargo test -p market`: the five clamp tests pass; test_stale_price_halts_opens_allows_closes and test_deviation_guard_halts_opens_allows_closes unchanged
- e2e degradedMode run against staging with the keeper stopped ≥ 2 min: open reverts #30, close succeeds at last print, LP withdraw succeeds, router self-relay close succeeds — all four assertions logged
- UI: with the keeper paused on staging, the close modal shows the amber "mark is Xs old" disclosure with a required checkbox, and the close still executes
- docs.noether.exchange/exit-guarantees is live, its walkthrough executes verbatim against the prod stack (post-L0-7), and every claim carries a code/tx link
- On-chain: a manufactured deviant print (test harness) settles a close within lenient_clamp_bps of last-good instead of at the raw print

**Risks:** The clamp changes settlement prices — the most audit-sensitive edit in this cluster; it must be in the frozen surface before L0-18's audit, and its interaction with L0-9 (smoothed trigger mark) and L0-10 (acceptablePrice) needs one shared review: three mechanisms now touch the close price (clamp, user bound, trigger mark) and must compose without double-bounding. Keeper/contract parity: the keeper's local health calc (P2-9) prices liquidation eligibility off raw feed values — after the clamp, on-chain settlement can differ from the keeper's preview by up to clamp_bps; simulate-first absorbs this but document it in the keeper README. MarketConfig shape change → same single-migrate_config coordination as L1-23. Publishing the exit-guarantee before the L0-7 prod cutover would document a spoofable write path — sequencing is deliberate. The UI disclosure must never become a block (M-2); code review should reject any early-return on staleness in the close path. WASM: config field + one clamp branch, ~negligible but measured — the batch budget is shared.

### L1-27 · Execution-latency instrumentation + optimistic pending UX + finality narrative

**Status:** todo · **Effort:** M · **Lane:** offchain · **Ships in:** offchain-now · **Needs:** — · **Blocks:** L1-15
**Cross-refs:** AUDIT A-8 (zero metrics in the gateway) · TASKS P4-2 (/v1/tx/submit taxonomy — the endpoint being instrumented) · UIUX B21 (5s-ledger lifecycle kit: optimistic ghost rows, staged submit button, tx-hash toasts — the flagship UI pattern this item implements the pending half of) · LIGHTER-GAP §Amendments [P1/M] execution-confirmation latency story + §Parity "everything-on-chain with ~5s L1 hard finality" · **Gap rows:** Amendments (fees+core translation): Execution-confirmation latency story — soft-finality UX for oracle-deterministic fills [P1/M]

**Current state (verified):** STAGING+PROD: latency is entirely unmeasured and the wait is unmanaged. The gateway's POST /v1/tx/submit polls to SUCCESS/FAILED with only a poll deadline — no timing captured anywhere (api/src/services/txSubmit.ts:67,82; api/src/routes/tx.ts) and the API has zero metrics infrastructure (AUDIT A-8; P4-4 added only x-request-id). The web submits then synchronously polls getTransaction up to 30×1s (web/lib/stellar/client.ts:191-200) while OrderPanel blocks on toast.promise with a single isSubmitting flag (OrderPanel.tsx:159, 519-543) — no optimistic row, no simulated-price display. The key enabler already exists unused: buildTransaction simulates every tx (client.ts:75-86) and for open_position the simulation retval is the full Position including entry_price — the exact struct openPosition parses from the confirmed result today (web/lib/stellar/market.ts:114-116); fills are oracle-deterministic, so the simulated price IS the fill price unless the tx reverts. No docs page states the ~5-6s envelope or the finality comparison; the MM-tier pitch (L1-15) has no latency envelope to cite.

**Design:** Three layers, zero contract work.

1. GATEWAY INSTRUMENTATION — in TxSubmitService.submit: record t0 before sendTransaction and elapsed at terminal status; keep an in-process ring buffer (last 1_000 submissions) of {ms, status, ledger, ts} — no external metrics dependency (A-8 reality). New public GET /v1/metrics/latency → {windowCount, p50Ms, p95Ms, maxMs, successRate, since} computed over the ring buffer (empty → nulls, never zeros); also fold {txLatencyP50Ms, txLatencyP95Ms} into /v1/health for the L1-25 monitors. Include per-op breakdown later; v1 is aggregate. Note the measured quantity precisely: gateway-submit → ledger-inclusion, which excludes wallet-signing time (stated in the schema description).
2. WEB MEASUREMENT + OPTIMISTIC PENDING — measurement: performance.now() from post-sign submit to SUCCESS; show "confirmed in X.Xs" in the success toast and keep a rolling in-memory median for the pending copy ("~5s"). Optimistic pending: change the open/close call surface in web/lib/stellar/market.ts to a two-phase shape — openPosition returns {simulated: Position, confirmed: Promise<Position>} where `simulated` is parsed from the simulateTransaction retval (same parsePosition path as :36 and :114-116) BEFORE wallet signing completes submission; the trade page inserts a ghost row (UIUX B21 spec: dim gold pulse, "pending · ~5s to finality") into PositionsList keyed by tx hash, rendering the SIMULATED entry price with an explicit "est." marker; on confirmed → replace with the on-chain Position (entry price is expected identical — log a warn if it ever differs); on failure → remove the ghost + decoded error toast (contractErrors.ts); on TxStillPendingError (client.ts:153-163) → keep the ghost with an explorer link, reconcile via the next positions refetch. v1 scope: isolated open + close on /trade; cross and orders inherit the shared ghost-row helper later. Reconciliation source: the staggered post-trade refetch already exists (P4-14: now+2.5s+6s) — the ghost clears when the gateway/chain row appears or the tx resolves, whichever first. Never fabricate money values: the ghost shows the simulated price + "est." and NO PnL until confirmed (money-truth rule).
3. NARRATIVE + ENVELOPE (docs) — trading-mechanics "Latency & finality" page: the two-lane truth (what you see at 300ms on Lighter is a soft receipt awaiting Ethereum proofs — Lighter's own whitepaper marks the feed pre-commitment as future work; what you see at ~5-6s on Noether IS L1 hard finality with the fill priced by the same-tx attestation), the measured p50/p95 from /v1/metrics/latency embedded live, the worst-case-price framing (opens are bounded by the #81 deviation band; L0-10 adds the user bound), and a stated MM-tier prerequisite note. Publish only measured numbers, never aspirational ones.

**Implementation**

**api**
- [ ] TxSubmitService: capture t0→terminal elapsed; add the 1,000-entry ring buffer with {ms,status,ledger,ts}
- [ ] Add GET /v1/metrics/latency (public, schema'd, nulls when empty) and fold txLatencyP50Ms/P95Ms into /v1/health
- [ ] Tests: submit outcomes populate the buffer; the latency route returns correct p50/p95 for a seeded buffer; empty buffer → nulls not zeros

**web**
- [ ] market.ts: refactor openPosition/closePosition to the {simulated, confirmed} two-phase return, parsing the simulation retval via the existing parsePosition
- [ ] Build the shared ghost-row helper (pending state keyed by tx hash: simulated price + "est." + pulse; confirm/replace, fail/remove, still-pending/explorer-link) and wire it into PositionsList + the trade page for isolated open/close
- [ ] Success toast gains "confirmed in X.Xs" from the measured elapsed; rolling median feeds the "~Ns" pending copy
- [ ] tsc + manual staging pass: open shows the ghost with the simulated entry price, flips to confirmed within one ledger; a forced revert (#82 via a tiny asset cap on staging) removes the ghost with the decoded error

**sdk-ts**
- [ ] Expose metrics.latency() sub-client method mirroring GET /v1/metrics/latency (one thin wrapper; rides the L1-14 coverage batch)

**sdk-py**
- [ ] Mirror metrics.latency() in noether_sdk (same L1-14 publish train)

**docs**
- [ ] Write the Latency & finality page: soft-vs-hard finality comparison with the Lighter pre-commitment caveat, live measured envelope, worst-case-price framing, MM-tier prerequisite note
- [ ] Link it from the developers section (bots budget ~5-6s inclusion; polling guidance)

**Acceptance:**
- api tests: latency ring buffer + GET /v1/metrics/latency p50/p95 assertions pass; /v1/health carries txLatencyP50Ms after ≥1 submission
- Against live staging: 20 sequential test submissions yield a plausible envelope (p50 ≈ 4-7s) served by /v1/metrics/latency
- UI state sequence observable on staging: sign → ghost row with simulated entry price + "est." + "~5s" → confirmed row with identical price; a forced #82 revert removes the ghost and shows the decoded error; the 30s poll timeout keeps the ghost with an explorer link (no false failure, B21 requirement)
- Simulated-vs-confirmed entry price logged equal on ≥20 staging opens (warn counter stays 0)
- docs Latency & finality page live with the measured p50/p95 embedded, no unmeasured claims

**Risks:** The simulated price is only deterministic while the oracle slot doesn't move between simulate and inclusion — a same-window keeper push can shift the fill within the #81 band (1%); the "est." marker and the equal-price warn counter are the honesty guards, and the ghost must never render PnL (fabricated-money pitfall class from CLAUDE.md). Ring-buffer metrics are per-instance — if the gateway ever scales past one replica the numbers become per-replica (acceptable; note in the schema description). The two-phase market.ts refactor touches every open/close call site — keep the old single-promise export as a wrapper so vaults/leader flows compile unchanged. Do not let the pending UX mask real failures: TxStillPendingError must surface the hash (duplicate-leveraged-position footgun, UIUX B21/client.ts:221-226).

### L1-28 · LP withdrawal cooldown (JIT/NAV-sniping protection)

**Status:** todo · **Effort:** S · **Lane:** contracts · **Ships in:** batch-1-redeploy · **Needs:** L0-15 · **Blocks:** L0-18
**Cross-refs:** TASKS V1.1-6 (vault UX growth loop — withdrawal cooldown explicitly backlogged) · AUDIT V-2 (LP front-running of stale NAV — the sibling risk; real-time NAV via P1-4 sync_exposure closed the stale half, timing games remain) · AUDIT Part 2.1 #9 (copy-trading/vault ops gaps: withdrawal lockup — HL uses 1 day) · UIUX B14 ("available to withdraw now" figure on /vault) · LIGHTER-GAP §LP & vault [P1/S] LP withdrawal cooldown · **Gap rows:** LP & vault products: LP withdrawal cooldown (JIT-LP / NAV-sniping protection) [P1/S]

**Current state (verified):** STAGING+PROD: protocol-vault withdrawals are instant — withdraw(withdrawer, noe_amount) at contracts/vault/src/lib.rs:224-290 checks only balance, the vault's real USDC, and the ReservedPayout solvency floor (:267-269); deposit (:144-206) records per-address cumulative volume for the deposit cap (set_deposited at :191, Deposited(Address) key at storage.rs:51) but stores NO timestamp, so nothing distinguishes a 10-second-old deposit from a 10-day-old one. Meanwhile NOE NAV marks trader uPnL in real time — the market pushes per-asset exposure via vault.sync_exposure on every open/close/liquidation (vault lib.rs:427-454; market adjust_oi choke point lib.rs:2204-2209) and sync_asset_pnl (market lib.rs:244-249) is a permissionless freshener — so deposit/withdraw can be timed around large closes and liquidations (classic GLP toxicity). The only frictions today are the 30 bps deposit/withdraw fees (storage.rs:118,126) and pause, which blocks BOTH directions (:146,:226 — the L0-15 problem). Cooldown is explicitly deferred backlog (TASKS V1.1-6). Scope note: this item covers the PROTOCOL vault only; factory-vault (vault_factory) economics are v1.1 (V-1 gate).

**Design:** Per-address cooldown after each deposit; everything else stays instant.

1. STORAGE — `DataKey::LastDepositTs(Address)` (persistent u64, unwrap_or 0; extend_ttl on write like Deposited) and `DataKey::WithdrawCooldownSecs` (instance u64, unwrap_or 1_800). Default 1_800s = 30 min — inside the founder band (15-60 min), long enough to span several oracle rounds and any single liquidation cascade, short enough to preserve the "no lockup" LP story.
2. WRITE — in deposit(), alongside set_deposited (:191): set LastDepositTs(depositor) = env.ledger().timestamp(). Every new deposit RESETS the clock (deliberate: topping up re-arms the cooldown, killing the deposit-just-before-a-whale-loss-realizes entry timing).
3. GATE — in withdraw(), after require_auth (:232) and before any math: let last = LastDepositTs(withdrawer); if cooldown > 0 && last > 0 && now < last + cooldown → Err(NoetherError::WithdrawCooldownActive = 84) (new error in noether_common/errors.rs after LiquidationCooldown=83; 85 reserved for L1-24 — final numbering reconciled at the Batch-1 integration checkpoint). Addresses that never deposited post-upgrade (last == 0) are exempt — clean migration, no backfill needed.
4. ADMIN + VIEWS — `set_withdraw_cooldown(env, secs: u64)` (admin; secs ≤ 86_400 else InvalidParameter; 0 disables; emits `withdraw_cooldown_set: (secs,)`), `get_withdraw_cooldown() -> u64`, `get_last_deposit_ts(who: Address) -> u64` (UI countdown source). No new money events.
5. PAUSE INTERACTION (L0-15, same redeploy) — under exit-only pause, withdrawals remain allowed but STILL cooldown-gated: the gate is about deposit-timing games, and an emergency must not become a cooldown bypass; order the checks require_not_paused-successor (exit-only) → cooldown → solvency floor.
6. EXIT FEE — the brief's optional time-decaying stress exit fee is explicitly DEFERRED post-launch: the cooldown alone breaks the JIT vector, the 30 bps withdraw fee already exists as baseline friction, and a stress-conditional fee needs a stress oracle nobody has specced — banked as a post-launch decision, do not implement.
7. WEB — DepositWithdrawModal + /vault: pre-sign check via get_last_deposit_ts + get_withdraw_cooldown → disable Withdraw with a countdown ("available in 12:34 — cooldown after each deposit"); map #84 in contractErrors.ts ("Withdrawals unlock N minutes after your last deposit"); update the vault copy that currently implies instant/anytime withdrawals (UIUX A7 flagged that copy) to "instant, 30 min after your latest deposit". tx-builders/SDKs: untouched — vault deposit/withdraw flow through web/lib/stellar/vault.ts, not tx-builders (tx-builders is market ops only).

**Implementation**

**contracts/vault**
- [ ] Add LastDepositTs(Address) + WithdrawCooldownSecs storage with helpers (persistent TTL extension mirrors Deposited)
- [ ] Stamp LastDepositTs in deposit(); add the cooldown gate at the top of withdraw()
- [ ] Add set_withdraw_cooldown (admin, ≤ 86_400, event) + get_withdraw_cooldown + get_last_deposit_ts views
- [ ] Add WithdrawCooldownActive = 84 to noether_common/errors.rs (coordinate the final code assignment with L1-24's #85 at the Batch-1 checkpoint)
- [ ] Tests: withdraw_inside_cooldown_rejected_84, withdraw_after_cooldown_succeeds (ledger time advance), second_deposit_resets_cooldown, cooldown_zero_disables_gate, pre_upgrade_depositor_exempt (last==0 path), set_withdraw_cooldown_admin_only_and_capped, cooldown_composes_with_reserved_payout_floor

**web**
- [ ] DepositWithdrawModal + vault page: fetch get_last_deposit_ts/get_withdraw_cooldown on open; disable Withdraw with a live countdown while inside cooldown; "—" (enabled, post-sign error as backstop) when the reads fail
- [ ] contractErrors.ts: map #84 to the human message; update /vault + /vaults "instant withdrawals" copy to the cooldown-qualified version (the A7 copy fix rides along)
- [ ] tsc + staging manual pass: deposit → Withdraw disabled with countdown → unlocks at T+cooldown

**docs**
- [ ] Vault page on docs.noether.exchange: document the cooldown (value, reset-on-deposit rule, rationale: NAV marks live uPnL, cooldown prevents deposit/exit timing around large settlements) and the admin tunability

**ops**
- [ ] Batch-1 promotion checklist: verify get_withdraw_cooldown() == 1800 on the new vault (default) or call set_withdraw_cooldown explicitly; record in the launch config sheet next to set_deposit_cap (P6-6)

**Acceptance:**
- `cargo test -p vault`: withdraw_inside_cooldown_rejected_84, withdraw_after_cooldown_succeeds, second_deposit_resets_cooldown, cooldown_zero_disables_gate, pre_upgrade_depositor_exempt, set_withdraw_cooldown_admin_only_and_capped, cooldown_composes_with_reserved_payout_floor all pass; existing vault suite (incl. insurance_buffer_pays_winners_before_lp) unchanged
- On-chain (staging): deposit then immediate withdraw reverts #84; withdraw at T+31min succeeds; a wallet that only deposited pre-upgrade withdraws immediately
- UI: after a staging deposit the Withdraw button is disabled with a ticking countdown and re-enables at expiry; the raw #84 never reaches a user as an unmapped code
- get_withdraw_cooldown returns 1800 on the freshly-promoted stack (parity-checklist line)
- Vault docs page states the cooldown and its rationale

**Risks:** Must compose with L0-15's exit-only pause in the SAME redeploy — if pause semantics ship without the cooldown-still-applies ordering, a pause window becomes a cooldown bypass (or worse, the cooldown blocks emergency exits longer than intended; the ≤86_400s admin cap bounds that to one day). Error-code collision with other Batch-1 specs claiming 84 — reconcile once. UX honesty: the countdown must derive from chain reads, not client clocks alone (ledger timestamp vs wallet clock skew — compute remaining from on-chain last_deposit_ts + cooldown against Date.now with a ±1-ledger tolerance). No migration hazard: new storage keys default via unwrap_or and pre-upgrade depositors are exempt by construction; the vault WASM grows ~30 lines on 37,458 B — trivial. The cooldown does NOT protect against exit-before-loss-realizes (only entry-timing) — that residual is accepted and documented; the deeper fix is L0-1/L0-2 making large settlements less NAV-lumpy.

## Verification-round additions (L1-29, L1-30)

Two gap rows the original item registry orphaned, surfaced by the coverage verifier and added 2026-07-17. Both are Batch-1 contract surface and appear in the P0 manifest, L0-18's needs, and the riders list above.

### L1-29 · Utilization borrow fee (dual-slope, second cumulative index)

**Status:** todo · **Effort:** M · **Lane:** contracts · **Ships in:** batch-1-redeploy · **Needs:** L0-13 · **Blocks:** L0-18
**Cross-refs:** TASKS P5-4 (dual-slope borrow fee — compute-only in the risk crate, unwired) · Gap doc §Mark price, index & funding "[P1/M] Interest/borrow component of carry (utilization-priced capacity)"
**Gap rows:** Mark price, index & funding — interest/borrow component of carry (utilization-priced capacity) [P1/M]

**Current state (verified via the gap-doc inventory):** The live market charges nothing for holding a position beyond near-vestigial funding, while every open reserves FULL notional from vault AUM until close (reserve_for_position, the 70%/25% caps behind error #82) — capacity squatting is free: a balanced long+short pair locks 2× notional of LP capacity indefinitely at zero carry, starving OI caps (the July #82 incidents) and paying LPs nothing. A dual-slope borrow-fee function is coded and tested in the undeployed contracts/risk crate (P5-4) but no consumption path exists. Lighter's funding formula embeds a nonzero baseline carry (InterestRate/8 = 1 bp per 8h) active even in balanced markets.

**Design:** Second per-asset lazy cumulative index riding L0-13's exact machinery. `DataKey::BorrowState(Symbol)` parallel to L0-13's FundingState: {cumulative_borrow_index, last_ts}. Accrual inside the same permissionless `apply_funding(asset)` tick: utilization = reserved_payout / aum read once per tick from the existing vault views (get_reserved_payout, get_pool_info — one cross-contract read per hour per asset batch); rate from the risk-crate dual-slope function wired as-is (single-digit bps/h below the kink, steep above; exact presets from contracts/risk — do not re-derive). Per-position snapshot in a parallel map `BorrowSnapshot(position_id)` initialized to the current index at open — and, for positions predating the upgrade, defaulting via unwrap_or to the index value at first touch so accrual starts at upgrade, never retroactively (avoids Position struct surgery and its decode-migration hazard). Settlement: pending_borrow = size × (index_now − snapshot) / PRECISION, charged on close/liquidate exactly like pending funding, routed to the vault via the existing credit path (LP yield). Equity integration: pending_borrow subtracts from equity everywhere pending funding does — position.rs cross aggregation, should_liquidate_with_funding, withdraw gates — in the SAME expressions, or health math diverges. Borrow params live in the L0-12/L0-13 per-asset config census (P0 manifest "Coordinate ONCE" item a). No new error codes.

**Implementation**

**contracts/market**
- [ ] Add BorrowState(Symbol) + BorrowSnapshot(position_id) storage keys with unwrap_or defaults
- [ ] Wire the risk-crate dual-slope function into apply_funding(asset) (inline the pure function if the risk contract stays undeployed); one vault utilization read per tick
- [ ] Snapshot at open (do_open + keeper-executed entries); settle in close/liquidate/partial paths alongside funding
- [ ] Extend equity/health expressions (position.rs aggregation, should_liquidate_with_funding, withdraw gates) with pending_borrow, mirroring pending funding
- [ ] Tests: test_borrow_accrues_with_utilization (util below kink → base rate; above → steep slope), test_borrow_settles_on_close, test_borrow_in_liquidation_health, test_pre_upgrade_position_accrues_from_first_touch
- [ ] Re-measure optimized market.wasm and record the delta in the shared batch-1 size ledger

**keeper**
- [ ] Mirror pending_borrow in the local health calc (scripts/keeper/src/health.ts) — P2-9 parity requirement

**offchain (rides L1-11's funding surfaces later)**
- [ ] Include accruedBorrow alongside accruedFunding in /v1/positions/open rows once L1-11 lands; document the borrow model on the docs fee/funding page

**Acceptance:**
- Named tests pass; a balanced long+short pair on a high-utilization asset visibly bleeds carry to the vault over simulated hours
- Keeper health preview equals contract health on positions with nonzero pending borrow
- Docs state the dual-slope parameters per asset class

**Risks:** Crowds the already-large Batch-1 market surface (WASM + audit scope) — if the freeze decision trims scope, the explicit fallback is a P2 out-of-scope deferral note ("deferred until per-asset funding proves out; capacity squatting bounded by OI caps meanwhile"), never a silent drop. Health-math integration is the dangerous part: pending_borrow must appear in EVERY expression pending funding appears in, contract and keeper both, or liquidation previews diverge. One cross-contract vault read per accrual tick is new — fail-open (skip accrual, log) if the read fails; never block apply_funding.

### L1-30 · Leader protective-order proxies on factory vaults

**Status:** todo · **Effort:** S · **Lane:** contracts · **Ships in:** batch-1-redeploy · **Needs:** L0-20 · **Blocks:** L0-18
**Cross-refs:** Gap doc §LP & vault products "[P1/S] Leader protective-order proxies (SL/TP/trailing/stop-limit on follower capital)" · L0-20 (PositionVault/OrderVault maps + reconcile_order this item consumes) · market error #80 (SL/TP isolated-only — leader trades are already isolated-only, so the proxies are legal today)
**Gap rows:** LP & vault products — leader protective-order proxies (SL/TP/trailing/stop-limit on follower capital) [P1/S]

**Current state (verified via the gap-doc inventory):** Leader proxies are only leader_open_position (isolated-only), leader_close_position, leader_place_limit_order (time_in_force hardcoded to 0=GTC at contracts/vault_factory/src/lib.rs:408), and leader_cancel_order (lib.rs:280-457). No SL/TP/trailing/stop-limit proxies exist — a leader cannot set protective orders on follower capital, so vault money runs with no stops through keeper-cycle gaps and overnight moves. L0-20's spec explicitly punts TIF pass-through to this item.

**Design:** Four new entrypoints mirroring the existing proxy pattern exactly (require_leader_call(vault_id, leader) → ownership check → authorize_as_current_contract → market call → post-call sync + check_invariant): `leader_set_stop_loss(leader, vault_id, position_id, trigger_price, slippage_bps)`, `leader_set_take_profit(leader, vault_id, position_id, trigger_price, slippage_bps, limit_price)` (5-arg deployed signature per L0-21), `leader_place_trailing_stop(leader, vault_id, position_id, trail_bps, slippage_bps)`, `leader_place_stop_limit(leader, vault_id, args…)`. Ownership: require PositionVault(position_id) == Some(vault_id) (L0-20's map) else NotVaultPosition. Collateral accounting: SL/TP/trailing lock nothing market-side → no delta accounting at placement; stop-limit prefunds → measured-delta + OrderVault map, identical to leader_place_limit_order. Keeper-executed protective closes settle proceeds to the factory address OUTSIDE any factory call → reconciliation rides L0-20's reconcile_order machinery (extend it to position-close reconciliation if the executed-close path proves unreachable from order status alone — coordinate with L0-20's spec, which owns the invariant). TIF pass-through: `time_in_force: u32` param on leader_place_limit_order replacing the hardcoded 0 at lib.rs:408. All proxies stay isolated-only (leader opens are isolated-only by design, matching market #80; no interaction with L1-1's cross lift).

**Implementation**

**contracts/vault_factory**
- [ ] Add the four proxies on the require_leader_call pattern + PositionVault/OrderVault ownership checks
- [ ] Add time_in_force param to leader_place_limit_order (arity bump — coordinate tx-builders/SDK update in the same change, per the L0-21 lesson)
- [ ] Stop-limit placement: measured-delta accounting + OrderVault write; cancel refund path via existing leader_cancel_order
- [ ] Tests: test_leader_sets_stop_loss_on_vault_position, test_leader_proxy_rejects_foreign_position (NotVaultPosition), test_leader_stop_limit_delta_accounting, test_tif_passthrough_not_hardcoded, invariant test across an executed protective close + reconcile
- [ ] Re-measure factory WASM (fresh deploy in this batch; L0-20 adds upgrade())

**web**
- [ ] Leader-mode OrderPanel: enable SL/TP/trailing/stop-limit controls on /vaults/[id]/manage positions (currently hidden), wired through the new proxies

**Acceptance:**
- All named factory tests pass; sum-invariant (Σ vault.total_usdc + deployed collateral == factory USDC balance) holds across place → execute → reconcile of a leader stop-loss on staging
- A leader on staging can attach SL/TP to a vault position from /vaults/[id]/manage and the executed close credits the owning vault, not the commingled pool
- tx-builders/SDK leader surfaces updated with the new arity in the same merge

**Risks:** Coupled to L0-20's delta-accounting + reconcile design — this item consumes its maps and invariant; land AFTER L0-20 inside the batch, one reviewer across both. The executed-close reconciliation is the subtle path: if proceeds arrive with no factory call and no order row to reconcile from, the invariant test must catch it (that's what it exists for). Factory WASM budget is not a concern (fresh deploy, small binary), but the arity bump on leader_place_limit_order breaks any existing tx-builder for it — same failure class as L0-21, fix in the same merge.

