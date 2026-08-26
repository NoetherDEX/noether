# Funding counterparty fix — design (2026-08-27)

Status: approved by Yahya 2026-08-27 ("go"); both markets frozen (pause mode 2) while this ships.

## Problem

The market contract is not zero-sum for funding. In every settlement path a
position that **pays** funding sends it to the vault (`to_vault`, capped at
its own collateral; the excess is booked as bad debt), but a position that
**receives** funding is paid out of the market's own USDC custody
(`to_trader = available + paid + earned_funding`). Nothing backs that
payout — it is other traders' collateral. The vault is only ever asked for
price PnL (`settle_with_vault(pnl)`); no vault entrypoint pays funding.

With `funding_clamp_bps = 100` (1 %/h) and weeks of one-sided skew, prod
receivers accrued multiples of notional (position 22250: $2.2k collateral,
$47.8k equity; 22171: $4.3k → $282k). Measured 2026-08-27 on prod: custody
$27,107 vs $241k tracked collateral, $1.135M of pending gains owed, growing
~$93k/day. Every payout now fails with SAC `#10 balance is not sufficient`
— liquidations included. Staging shows the same in miniature.

## Goals

1. Conservation: after any operation, market USDC ≥ Σ isolated collateral +
   Σ cross balances + Σ pending LimitEntry/StopLimit escrow. The market never
   pays out more for a position than it received for it plus what the vault
   handed it.
2. The vault is the funding counterparty, symmetrically: receivers are paid
   by the vault (through the existing `settle_pnl` waterfall, with shortfall
   booking), payers pay the vault (as today).
3. A one-time admin tool to void the pending funding accrued under the bug
   before this upgrade goes live on prod (decided: **void**, not pay).
4. Sane funding parameters on both stacks and a guardrail so a custody
   deficit can never again go unnoticed.

Non-goals: redesigning the funding rate model (SIP-279 velocity stays);
touching liquidation paths that are already conserved; any vault change.

## Design

### 1. Net settlement (market contract)

Let `funding` keep its sign convention (> 0 pays, < 0 receives) and define
`net = pnl − funding` per closed portion.

`settle_isolated_close`, `settle_partial_close`:

```
paid = if net > 0 { settle_with_vault(net) } else { 0 }
flag_adl_on_shortfall(asset, net, paid)
remaining = collateral_closed + net            // unchanged arithmetic
if remaining < 0 { record_bad_debt(-remaining) }
available = collateral_closed
to_vault = if net < 0 { min(-net, available) } else { 0 }; available -= to_vault
fee_paid = min(keeper_fee, available);          available -= fee_paid
transfer market→vault to_vault (+ credit_vault_receipt)
transfer market→keeper fee_paid
to_trader = available + paid                    // NO earned_funding term
```

Outflow = collateral_closed + paid; inflow for the position = collateral_closed
(at open) + paid (from vault) → conserved by construction. Funding income
the vault cannot cover is booked as the trader's shortfall (claimable via
`claim_shortfall`) exactly like unpaid PnL, and flags ADL. When funding
income exceeds a price loss (net > 0, pnl < 0) the vault pays only the net;
when a funding payment exceeds a price gain (net < 0, pnl > 0) the trader
pays only the net — same economics as today with fewer transfers.

`close_cross_leg`: same substitution — `paid = net > 0 ? settle(net) : 0`,
`to_vault = net < 0 ? −net : 0` (still capped at `min(max_outflow, balance)`),
and `pool_delta = collateral + (net > 0 ? paid : net)`. The cross pool is
then never credited with unbacked funding, which also removes the reason the
cross liquidation legs had to clamp payouts to the whole market balance
(those `balance()` caps stay as belts).

Liquidation paths (`liquidate` full/partial, cross liquidation loop) are
left alone: their payouts are bounded by `remaining < MM ≤ collateral` and
earned funding is already netted against the vault's share.

### 2. `reseed_funding` (admin, one-shot)

```
pub fn reseed_funding(env, ids: Vec<u64>) -> Result<u32, NoetherError>
```
Admin-only; refuses unless the market is in full-freeze (mode 2) — reuses
`InvalidParameter` (the error enum sits at its 50-variant ceiling). For each
existing position sets `entry_cumulative_funding = cum_funding(asset)`,
saves, emits `funding_reseeded(id, old_entry, new_entry)`; returns the count
touched. Unknown ids are skipped. Batched by the operator (~20 ids per tx).

### 3. Parameters

`set_asset_risk` on all 14 pairs, both stacks: `funding_clamp_bps` 100 → 5
(0.05 %/h, ≈1.2 %/day), `max_funding_velocity_bps` 3600 → 5; everything
else unchanged. Generated from the live `get_asset_risk` values by
`scripts/funding_params.sh` (prints the 14 invoke lines; operator runs them).

### 4. Guardrail

Gateway `GET /v1/markets/stats.pool` gains `marketUsdcBalance`,
`trackedCustody` (Σ live isolated collateral + Σ cross balances + Σ pending
entry-order escrow) and `custodyDeficit`; the keeper's health loop alerts
(`warn`, dedup 10 min) when `marketUsdcBalance < trackedCustody`.
`docs/MAINNET-RUNBOOK.md` §1 gets a gate line: conservation test green,
funding clamp ≤ 10 bps/h, custody monitor live. (Shipped after the contract
work; not a blocker for unfreezing.)

## Rollout

1. Contract: tests first (below), then the three settle paths, then
   `reseed_funding`; `cargo test -p market`, `cargo clippy --workspace
   --all-targets -- -D warnings`, WASM ≤ 131,072 B after
   `stellar contract optimize` (baseline 123,673 B unoptimized).
2. Staging (Claude): `upgrade` → `reseed_funding([3])` → `set_asset_risk`
   ×14 → mint the custody gap into the market (≈ $3; no market-side belt,
   plain SAC transfer) → `pause(0)` → drill trades: open long+short, run
   `apply_funding` across hours, close the receiver, assert the vault paid
   and custody ≥ tracked (scratchpad `deficit.ts`); liquidate a bankrupt
   position; snapshot config.
3. Prod (Yahya, command block prepared by Claude): `upgrade` →
   `reseed_funding` (60 ids, 3 batches) → `set_asset_risk` ×14 → mint the
   custody gap (≈ $214k + escrow, exact figure from `deficit.ts` at the
   time) → `pause(0)` → keeper clears the four bankrupt shorts and order 20
   → `deficit.ts` shows custody ≥ tracked → config snapshot committed.
4. Guardrail PR (gateway + keeper + runbook).

## Tests (market `lib.rs` tests module)

- `test_funding_receiver_paid_by_vault_not_custody`: long-heavy XLM book
  (big long, small short), seed + accrue funding over several hours, close
  the **short** (receiver): trader receives collateral − fee + earned; vault
  `total_usdc` decreases by earned (buffer-first waterfall); market USDC ≥
  remaining long's collateral. Then close the long (payer): funding lands in
  the vault; market USDC == 0 (or == escrow).
- `test_funding_receiver_shortfall_books_claim`: tiny vault; receiver's net
  exceeds coverage → `payout_shortfall` booked, trader paid what the vault
  could, market custody untouched.
- `test_cross_receiver_pool_credit_is_backed`: cross short in a long-heavy
  book; after close the pool delta equals collateral + vault-paid amount and
  a full withdraw succeeds without dipping below other custody.
- `test_partial_close_receiver_conserves_usdc` (extends the existing
  partial-close conservation test with earned funding).
- `test_reseed_funding_voids_pending`: accrue, `reseed_funding` while frozen
  → `get_position_equity == collateral + pnl`; close moves no funding; the
  call fails when not frozen and when not admin.
- Existing `test_funding_accrues_and_settles_on_close` (payer) must stay
  green unchanged.

## Risks / notes

- `settle_pnl` is now called with `net` rather than price PnL; the vault
  uses the value only for payment + shortfall (uPnL sync is separate via
  `adjust_oi`), so no vault change is needed. Its `pnl_settled`-style event
  will carry the net figure — acceptable; noted for the indexer (no schema
  impact).
- Pending gains on prod (~$1.135M) are voided by reseed before unfreezing;
  traders keep only price PnL. Decided by Yahya 2026-08-27 (testnet money).
- Positions that were funding-bankrupt (equity 0) may become healthy after
  reseed and simply continue.
- WASM headroom is ~7 KB before optimization; the change removes code as
  much as it adds. Measured before deploy.
