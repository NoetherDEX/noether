# Noether v2 - Development Roadmap

> Last updated: 2026-03-19
> Owner: NoetherDEX Team
> Repository: https://github.com/NoetherDEX/noether

---

## Executive Summary

Noether is an on-chain perpetual futures exchange on Stellar/Soroban. This roadmap covers 3 tranches from MVP enhancements through mainnet launch. Each tranche is a funded milestone with measurable deliverables.

| Tranche | Phase | Deadline | Budget | Focus |
|---------|-------|----------|--------|-------|
| **1** | MVP | **2026-03-28** | $17,240 | Core trading upgrades (cross-margin, advanced orders, fee tiers) |
| **2** | Testnet | **2026-05-09** | $25,800 | Programmatic access (API, WebSocket, vaults, multi-wallet) |
| **3** | Mainnet | **2026-06-21** | $34,480 | Production hardening (oracle, deploy, mobile, insurance fund) |

**Total: $77,520**

---

## How to Read This Document

- **Current State** = what exists in codebase today
- **Target State** = what we are building
- **Change Map** = exact files and functions that will be created or modified
- **Dependencies** = what must be completed before this task can start
- **Definition of Done** = measurable criteria to consider the deliverable complete
- Task IDs follow the pattern `T{tranche}.{feature}.{task}` (e.g., `T1.1.4`)
- Branch per feature: `feature/cross-margin`, `feature/advanced-orders`, `feature/fee-tiers`

---

## Master Dependency Graph

```
                    TRANCHE 1 (Mar 28)
                    ─────────────────
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
 [T1.1]          [T1.2]          [T1.3]
 Cross-Margin    Advanced        Fee Tiers
                 Orders          (maker/taker)
    │               │               │
    │               └──────┬────────┘
    │                      │ T1.3 needs T1.2 for
    │                      │ maker/taker classification
    │                      │
    ├──────────────────────┼────────────────────────
    │   TRANCHE 2 (May 9)  │
    │   ─────────────────  │
    ▼                      ▼
 [T2.3]              [T2.1] REST API ◄── needs T1.1 + T1.2 + T1.3
 Vaults              │
 (needs T1.1)        ▼
    │            [T2.2] WebSocket ◄── shares infra with T2.1
    │                │
    │            [T2.4] Multi-Wallet & Referral ◄── needs T1.3
    │                │
    ├────────────────┼────────────────────────────
    │   TRANCHE 3    │
    │   (Jun 21)     │
    ▼                ▼
 [T3.2]          [T3.1] Oracle (independent, can start early)
 Mainnet Deploy      │
 (needs ALL)     [T3.3] Frontend + Docs (needs T2.1, T2.2)
    │
 [T3.4] Partial Liquidation + Insurance Fund (needs T1.1)
```

**Critical Path:** T1.1 → T1.2 → T1.3 → T2.1 → T2.2 → T3.2 → T3.3

**Parallelizable:**
- T1.1, T1.2 can run in parallel (different contract areas)
- T2.3, T2.4 can run in parallel with T2.1/T2.2
- T3.1 can start during Tranche 2 (independent)
- T3.4 can start during Tranche 2 (only needs T1.1)

---

# TRANCHE 1 - MVP

**Deadline: 2026-03-28 (9 days from now)**
**Budget: $17,240**
**Branch: `develop` ← `feature/cross-margin`, `feature/advanced-orders`, `feature/fee-tiers`**

---

## T1.1 Cross-Margin Mode

### Context

**Current State:**
All positions use isolated margin. Each position has its own collateral, independent liquidation price, and no interaction with other positions. A trader with 3 positions has 3 separate collateral pools. If one position is liquidated, the others are unaffected.

Relevant code:
- `Position.collateral` is per-position (types.rs:43)
- `open_position()` takes collateral per trade (lib.rs:148)
- `liquidate()` checks single position's `liquidation_price` (lib.rs:440)
- No concept of shared margin or account-level equity

**Target State:**
Users can choose between Isolated and Cross margin modes. In Cross mode:
- A shared collateral pool per account (deposited separately)
- Opening a position reserves margin from the pool but doesn't lock collateral into the position
- Unrealized PnL from all cross positions contributes to available margin
- Liquidation checks account-level equity vs aggregate maintenance margin
- If liquidated, ALL cross positions close simultaneously

**How Exchanges Do It (reference: Binance, Bybit):**
- Cross-margin account has a "wallet balance"
- Available margin = wallet balance + unrealized PnL - initial margin used
- Liquidation when: wallet balance + unrealized PnL < maintenance margin (all positions)
- Users can switch between modes per position (but not while position is open)

### Definition of Done

- [ ] `deposit_cross_margin()` and `withdraw_cross_margin()` working on testnet
- [ ] User opens 2+ cross-margin positions sharing same collateral pool
- [ ] Unrealized profit from position A increases available margin for position B
- [ ] Unrealized loss from position A decreases available margin for position B
- [ ] Liquidation triggers when `account_equity < aggregate_maintenance_margin`
- [ ] All cross positions liquidated simultaneously on trigger
- [ ] Isolated positions remain unaffected by cross-margin liquidation
- [ ] Frontend shows margin mode toggle, cross-margin balance, account health
- [ ] Keeper bot scans cross-margin accounts for liquidation
- [ ] `cargo test` passes for: multi-position PnL sharing, liquidation cascade, partial close in cross mode, withdraw blocked when margin insufficient

### Change Map

#### New Types (`contracts/noether_common/src/types.rs`)

```rust
// NEW: Margin mode selection
pub enum MarginMode {
    Isolated = 0,    // Current behavior (default)
    Cross = 1,       // Shared collateral pool
}

// NEW: Cross-margin account state
pub struct CrossMarginAccount {
    pub balance: i128,              // Deposited USDC (not locked in positions)
    pub total_initial_margin: i128, // Sum of (size / leverage) for all cross positions
}

// MODIFY: Position struct - add margin_mode field
pub struct Position {
    // ... existing fields ...
    pub margin_mode: MarginMode,    // NEW: which mode this position uses
}
```

#### New Storage Keys (`contracts/market/src/storage.rs`)

```rust
// NEW keys in DataKey enum:
CrossMarginBalance(Address),      // i128 - trader's cross-margin pool balance
CrossMarginPositions(Address),    // Vec<u64> - position IDs in cross mode
AllCrossMarginTraders,            // Vec<Address> - for keeper to scan
```

New storage functions needed:
- `get_cross_margin_balance(env, trader) -> i128`
- `set_cross_margin_balance(env, trader, amount)`
- `get_cross_margin_positions(env, trader) -> Vec<u64>`
- `add_cross_margin_position(env, trader, position_id)`
- `remove_cross_margin_position(env, trader, position_id)`
- `get_all_cross_margin_traders(env) -> Vec<Address>`

#### New Contract Functions (`contracts/market/src/lib.rs`)

| Function | Signature | Description |
|----------|-----------|-------------|
| `deposit_cross_margin` | `(trader: Address, amount: i128) -> Result<()>` | Transfer USDC to contract, add to cross-margin balance |
| `withdraw_cross_margin` | `(trader: Address, amount: i128) -> Result<()>` | Check free margin, transfer USDC back to trader |
| `open_position_cross` | `(trader: Address, asset: Symbol, collateral: i128, leverage: u32, direction: Direction) -> Result<Position>` | Open position using cross-margin pool. `collateral` param = initial margin amount deducted from pool |
| `get_cross_margin_info` | `(trader: Address) -> CrossMarginInfo` | Return balance, equity, used margin, free margin, margin ratio |
| `is_cross_liquidatable` | `(trader: Address) -> Result<bool>` | Check if account equity < aggregate maintenance margin |
| `liquidate_cross_account` | `(keeper: Address, trader: Address) -> Result<i128>` | Close ALL cross positions, pay keeper reward |
| `get_cross_liquidatable_accounts` | `() -> Vec<Address>` | Return list of liquidatable cross-margin accounts |

#### Modified Contract Functions (`contracts/market/src/lib.rs`)

| Function | What Changes |
|----------|-------------|
| `close_position` (line 250) | If cross-margin: return PnL to cross-margin pool instead of trader wallet |
| `add_collateral` (line 366) | If cross-margin: add to pool balance, not position collateral |

#### New Calculation Functions

| File | Function | Formula |
|------|----------|---------|
| `position.rs` | `calculate_account_equity(env, trader)` | `cross_balance + sum(unrealized_pnl) - sum(accumulated_funding)` |
| `position.rs` | `calculate_aggregate_maintenance_margin(env, trader)` | `sum(position_size * maintenance_margin_bps / 10_000)` |
| `position.rs` | `calculate_free_margin(env, trader)` | `equity - aggregate_initial_margin` |
| `liquidation.rs` | `check_cross_liquidation(env, trader, price_fn)` | `account_equity < aggregate_maintenance_margin` |
| `liquidation.rs` | `calculate_cross_liquidation_distribution(env, trader, price_fn)` | Distributes remaining equity: keeper reward + vault |

#### Keeper Bot (`scripts/keeper/src/`)

| File | Change |
|------|--------|
| `index.ts` | Add `checkCrossMarginLiquidations()` to main loop |
| `stellar.ts` | Add `getCrossMarginTraders()`, `isCrossLiquidatable(trader)`, `liquidateCrossAccount(trader)` |
| `types.ts` | Add `CrossMarginInfo` type |

#### Frontend (`web/`)

| File | Change |
|------|--------|
| `components/trading/OrderPanel.tsx` | Add Isolated/Cross toggle at top. In cross mode, show pool balance instead of per-trade collateral |
| `components/trading/PositionsList.tsx` | Group cross positions together, show account health bar, aggregate stats |
| `components/trading/CrossMarginPanel.tsx` | **NEW**: Deposit/withdraw UI, equity breakdown, margin ratio gauge |
| `lib/stellar/market.ts` | Add `depositCrossMargin()`, `withdrawCrossMargin()`, `openPositionCross()`, `getCrossMarginInfo()` |
| `lib/utils/constants.ts` | Add margin mode constants |
| `types/contracts.ts` | Add `CrossMarginInfo`, `MarginMode` types |

### Task Breakdown

| ID | Task | Layer | Files | Depends | Est |
|----|------|-------|-------|---------|-----|
| T1.1.1 | Add `MarginMode` enum, `CrossMarginAccount` struct, extend `Position` | Contract Types | `types.rs` | - | 1h |
| T1.1.2 | Add cross-margin storage keys + CRUD functions | Contract Storage | `storage.rs` | T1.1.1 | 2h |
| T1.1.3 | Implement `deposit_cross_margin` + `withdraw_cross_margin` | Contract Core | `lib.rs` | T1.1.2 | 3h |
| T1.1.4 | Implement `open_position_cross` (shared margin, no per-position collateral lock) | Contract Core | `lib.rs` | T1.1.3 | 4h |
| T1.1.5 | Modify `close_position` for cross-margin (PnL returns to pool) | Contract Core | `lib.rs` | T1.1.4 | 3h |
| T1.1.6 | Implement account equity + aggregate MM calculations | Contract Math | `position.rs`, `liquidation.rs` | T1.1.4 | 3h |
| T1.1.7 | Implement `is_cross_liquidatable` + `liquidate_cross_account` | Contract Liq | `lib.rs`, `liquidation.rs` | T1.1.6 | 4h |
| T1.1.8 | Implement `get_cross_liquidatable_accounts` + `get_cross_margin_info` | Contract View | `lib.rs` | T1.1.7 | 2h |
| T1.1.9 | Modify `add_collateral` for cross mode | Contract Core | `lib.rs` | T1.1.3 | 1h |
| T1.1.10 | Unit tests: open 2+ cross positions, PnL sharing, liquidation, partial close, withdraw limits | Contract Test | `test.rs` | T1.1.7 | 5h |
| T1.1.11 | Keeper: cross-margin liquidation scanning + execution | Keeper | `index.ts`, `stellar.ts` | T1.1.8 | 3h |
| T1.1.12 | Frontend: margin mode toggle + cross-margin deposit/withdraw | Frontend | `OrderPanel.tsx`, new `CrossMarginPanel.tsx` | T1.1.8 | 4h |
| T1.1.13 | Frontend: contract calls + position list grouping | Frontend | `market.ts`, `PositionsList.tsx` | T1.1.12 | 3h |
| T1.1.14 | Frontend: account health display, equity breakdown | Frontend | `CrossMarginPanel.tsx`, `PositionsList.tsx` | T1.1.13 | 2h |

**Total: ~40 hours**

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Cross liquidation closes profitable positions unnecessarily | High | Calculate per-position contribution to margin deficit, document clearly |
| Storage bloat from `AllCrossMarginTraders` growing | Medium | Consider pagination or TTL-based cleanup |
| Race condition: price changes between equity check and liquidation execution | Medium | Liquidation re-checks in same tx, revert if no longer liquidatable |
| Withdraw front-running: withdraw right before liquidation | High | `withdraw_cross_margin` must re-verify equity after withdrawal |

---

## T1.2 Advanced Order Types & Execution Modes

### Context

**Current State:**
3 order types exist:
- `LimitEntry` - opens new position at trigger price (lib.rs:827)
- `StopLoss` - closes position on loss (lib.rs:918)
- `TakeProfit` - closes position on profit (lib.rs:1016)

No Time-in-Force options. No trailing stops. No stop-limit. Order execution is binary: trigger → market execute.

Relevant code:
- `OrderType` enum: 3 variants (types.rs:201)
- `Order` struct: 14 fields (types.rs:239)
- `execute_order()`: handles LimitEntry or StopLoss/TakeProfit (lib.rs:1174)
- Keeper checks `should_execute_order()` every 5s (lib.rs:1279)

**Target State:**
7 order types with 3 TIF modes:

| Order Type | Behavior | Use Case |
|------------|----------|----------|
| LimitEntry | Open position when price reaches trigger | "Buy BTC at $60k" |
| StopLoss | Close position to limit loss | "Close if BTC drops to $58k" |
| TakeProfit | Close position to lock profit | "Close if BTC hits $70k" |
| **StopLimit** | When stop triggers, place limit order (not market) | "If BTC drops to $60k, place buy limit at $59.5k" |
| **TakeLimit** | When TP triggers, place limit order | "If BTC hits $70k, place sell limit at $70.5k" |
| **TrailingStop** | Dynamic stop that follows peak price | "Close if BTC drops 3% from its peak" |
| **ReduceOnly** | Can only decrease position, never increase | Safety for automated strategies |

| TIF Mode | Behavior |
|----------|----------|
| **GTC** | Good Till Cancel - stays active until filled or cancelled (current default) |
| **IOC** | Immediate Or Cancel - fill immediately at trigger or cancel entire order |
| **PostOnly** | Reject if would execute immediately (guarantees maker fee) |

### Definition of Done

- [ ] All 7 order types placeable from frontend
- [ ] StopLimit two-phase execution working (stop triggers → limit order created)
- [ ] TrailingStop tracks peak price via keeper updates
- [ ] TrailingStop triggers correctly when price drops X% from peak
- [ ] ReduceOnly rejects if it would increase net position
- [ ] IOC cancels if not immediately triggerable
- [ ] PostOnly rejects if immediately triggerable
- [ ] Keeper bot handles trailing stop peak updates every cycle
- [ ] Keeper bot handles two-phase stop-limit execution
- [ ] Unit tests for all order types + TIF combinations

### Change Map

#### Modified Types (`contracts/noether_common/src/types.rs`)

```rust
// MODIFY: Add new variants
pub enum OrderType {
    LimitEntry = 0,
    StopLoss = 1,
    TakeProfit = 2,
    StopLimit = 3,      // NEW
    TakeLimit = 4,      // NEW
    TrailingStop = 5,   // NEW
    ReduceOnly = 6,     // NEW
}

// NEW: Time-in-force
pub enum TimeInForce {
    GTC = 0,
    IOC = 1,
    PostOnly = 2,
}

// NEW: StopLimit phases
pub enum StopLimitPhase {
    WaitingForStop = 0,   // Waiting for stop price trigger
    LimitActive = 1,      // Stop triggered, limit order active
}

// MODIFY: Extend Order struct
pub struct Order {
    // ... existing 14 fields ...
    pub time_in_force: u32,           // NEW: 0=GTC, 1=IOC, 2=PostOnly
    pub limit_price: i128,            // NEW: For StopLimit/TakeLimit second price
    pub trailing_percent_bps: u32,    // NEW: For TrailingStop (200 = 2%)
    pub is_reduce_only: bool,         // NEW: ReduceOnly flag
    pub stop_limit_phase: u32,        // NEW: 0=WaitingForStop, 1=LimitActive
}
```

#### New Storage Keys (`contracts/market/src/storage.rs`)

```rust
TrailingStopPeak(u64),    // order_id -> i128 (highest/lowest price seen)
```

#### New/Modified Contract Functions (`contracts/market/src/lib.rs`)

| Function | Type | Description |
|----------|------|-------------|
| `place_stop_limit_order` | NEW | Two prices: stop triggers monitoring, limit price for execution |
| `place_take_limit_order` | NEW | Two prices: TP trigger, then limit execution |
| `place_trailing_stop` | NEW | Attached to position, tracks peak, triggers at % drop |
| `update_trailing_stops` | NEW | Called by keeper each cycle to update peak prices |
| `execute_order` (line 1174) | MODIFY | Handle StopLimit two-phase, TrailingStop, ReduceOnly validation |
| `should_execute_order` (line 1279) | MODIFY | Add trigger logic for new types |
| `place_limit_order` (line 827) | MODIFY | Add `time_in_force` param, IOC/PostOnly logic |

**StopLimit Two-Phase Flow:**
```
Phase 1: WaitingForStop
  Keeper sees price hit stop_price → sets stop_limit_phase = LimitActive

Phase 2: LimitActive
  Keeper sees price hit limit_price → executes order (opens position / closes position)
  If price moves away from limit → order stays pending (GTC) or cancels (IOC)
```

**TrailingStop Flow:**
```
On place: store current price as peak (TrailingStopPeak)
Each keeper cycle: call update_trailing_stops(asset)
  - Long position: peak = max(peak, current_price)
    trigger when: current_price <= peak * (1 - trailing_percent_bps / 10000)
  - Short position: peak = min(peak, current_price)
    trigger when: current_price >= peak * (1 + trailing_percent_bps / 10000)
```

#### Keeper Bot (`scripts/keeper/src/`)

| File | Change |
|------|--------|
| `index.ts` | Add `updateTrailingStops()` call every cycle (before order checks) |
| `index.ts` | Update `checkOrders()` to handle StopLimit phase transitions |
| `stellar.ts` | Add `updateTrailingStops(asset)`, handle two-phase StopLimit results |
| `types.ts` | Add new OrderType variants, TimeInForce, StopLimitPhase |

#### Frontend (`web/`)

| File | Change |
|------|--------|
| `OrderPanel.tsx` | Add order type dropdown (Market, Limit, Stop Limit, Trailing Stop). Show relevant inputs per type. Add TIF selector for limit orders. Add Reduce Only checkbox. |
| `OrderPanel.tsx` | Stop Limit: two price inputs (stop price + limit price) |
| `OrderPanel.tsx` | Trailing Stop: percentage slider with calculated trigger price preview |
| `OrdersList.tsx` | Show new order types, StopLimit phase indicator, trailing stop peak/trigger |
| `OrderBook.tsx` | Include stop-limit resting orders (phase = LimitActive) |
| `market.ts` | Add `placeStopLimitOrder()`, `placeTakeLimitOrder()`, `placeTrailingStop()` |
| `types/contracts.ts` | Add TypeScript types for new order structures |

### Task Breakdown

| ID | Task | Layer | Files | Depends | Est |
|----|------|-------|-------|---------|-----|
| T1.2.1 | Add OrderType variants, TimeInForce enum, StopLimitPhase enum | Contract Types | `types.rs` | - | 1h |
| T1.2.2 | Extend Order struct with new fields (time_in_force, limit_price, etc.) | Contract Types | `types.rs` | T1.2.1 | 1h |
| T1.2.3 | Add TrailingStopPeak storage key + helpers | Contract Storage | `storage.rs` | T1.2.1 | 1h |
| T1.2.4 | Implement `place_stop_limit_order()` | Contract Core | `lib.rs` | T1.2.2 | 3h |
| T1.2.5 | Implement `place_take_limit_order()` | Contract Core | `lib.rs` | T1.2.2 | 2h |
| T1.2.6 | Implement `place_trailing_stop()` + peak initialization | Contract Core | `lib.rs` | T1.2.3 | 3h |
| T1.2.7 | Implement `update_trailing_stops(asset)` for keeper | Contract Core | `lib.rs` | T1.2.6 | 3h |
| T1.2.8 | Implement ReduceOnly validation in order execution | Contract Core | `lib.rs` | T1.2.2 | 2h |
| T1.2.9 | Add IOC logic to `place_limit_order` | Contract Core | `lib.rs` | T1.2.2 | 2h |
| T1.2.10 | Add PostOnly logic to `place_limit_order` | Contract Core | `lib.rs` | T1.2.2 | 2h |
| T1.2.11 | Update `execute_order()` for StopLimit two-phase + TrailingStop | Contract Core | `lib.rs` | T1.2.4, T1.2.7 | 4h |
| T1.2.12 | Update `should_execute_order()` for all new types | Contract Core | `lib.rs` | T1.2.11 | 2h |
| T1.2.13 | Unit tests for all new order types and TIF modes | Contract Test | `test.rs` | T1.2.12 | 5h |
| T1.2.14 | Keeper: trailing stop updates + StopLimit phase handling | Keeper | `index.ts`, `stellar.ts` | T1.2.12 | 3h |
| T1.2.15 | Frontend: order type selector + Stop Limit UI (two prices) | Frontend | `OrderPanel.tsx` | T1.2.4 | 3h |
| T1.2.16 | Frontend: Trailing Stop UI (% slider + preview) | Frontend | `OrderPanel.tsx` | T1.2.6 | 2h |
| T1.2.17 | Frontend: TIF selector + Reduce Only checkbox | Frontend | `OrderPanel.tsx` | T1.2.9 | 2h |
| T1.2.18 | Frontend: OrdersList + OrderBook updates for new types | Frontend | `OrdersList.tsx`, `OrderBook.tsx` | T1.2.15 | 2h |
| T1.2.19 | Frontend: contract call functions for new order types | Frontend | `market.ts` | T1.2.4-T1.2.7 | 2h |

**Total: ~45 hours**

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Trailing stop peak updates = high gas if many orders | High | Batch by asset, only update if price actually changed |
| StopLimit two-phase adds complexity to keeper flow | Medium | Clear state machine, explicit phase tracking |
| IOC/PostOnly needs "immediate trigger" detection that doesn't exist | Medium | Compare trigger_price vs current oracle price at placement time |
| Order struct grows large (18+ fields) → storage cost | Low | Consider splitting into base + extension structs |

---

## T1.3 Maker/Taker Fee System with Volume Tiers

### Context

**Current State:**
Flat 0.1% (10 bps) trading fee on all trades. Defined in `MarketConfig.trading_fee_bps` (types.rs:143). Applied in `open_position()` (lib.rs:218) and `execute_limit_entry()` (lib.rs:1470). No distinction between maker and taker. No volume tracking.

**Target State:**
- Maker fee (limit orders resting on book) < Taker fee (market orders, immediate fills)
- 4 volume tiers based on 14-day rolling volume per address
- Volume tracked on-chain, updated on every trade
- Fee tier visible on frontend

**Why Maker < Taker:** Makers add liquidity (limit orders on book), takers remove it. Lower maker fees incentivize deeper order books.

### Fee Schedule

| Tier | 14-Day Volume | Maker Fee | Taker Fee |
|------|--------------|-----------|-----------|
| 0 (base) | $0 - $1M | 0.02% (2 bps) | 0.05% (5 bps) |
| 1 | > $1M | 0.015% (1.5 bps) | 0.04% (4 bps) |
| 2 | > $5M | 0.01% (1 bps) | 0.03% (3 bps) |
| 3 | > $25M | 0.005% (0.5 bps) | 0.02% (2 bps) |

### Maker vs Taker Classification

| Action | Classification | Why |
|--------|---------------|-----|
| `open_position()` (market order) | **Taker** | Immediately executes at oracle price, removes liquidity |
| `execute_limit_entry()` (limit order fills) | **Maker** | Was resting on book, added liquidity |
| `execute_close_order()` (SL/TP fills) | **Taker** | Triggered by price, removes liquidity |
| PostOnly limit order | **Always Maker** | Guaranteed by TIF mode |

### Dependencies

- **T1.2 (partially):** PostOnly TIF mode guarantees maker classification. Fee system can be built independently, but PostOnly integration needs T1.2.
- The fee calculation engine itself has no blockers and can start immediately.

### Definition of Done

- [ ] Base fees: 0.02% maker / 0.05% taker deployed on testnet
- [ ] `open_position()` charges taker fee
- [ ] `execute_limit_entry()` charges maker fee
- [ ] 14-day rolling volume tracked per address on every trade
- [ ] Volume correctly expires after 14 days (old days drop off)
- [ ] `get_trader_fee_info()` returns correct tier, volume, and fees
- [ ] `set_fee_tiers()` admin function works
- [ ] Frontend shows: maker fee for limit orders, taker fee for market orders
- [ ] Frontend shows: current tier, 14-day volume, progress to next tier
- [ ] Unit tests verify: fee at each tier, volume rolling window, maker vs taker, day boundary rollover

### Change Map

#### New/Modified Types (`contracts/noether_common/src/types.rs`)

```rust
// NEW: Fee tier definition
pub struct FeeTier {
    pub min_volume: i128,      // Minimum 14-day volume for this tier (7 decimals)
    pub maker_fee_bps: u32,    // Maker fee in basis points
    pub taker_fee_bps: u32,    // Taker fee in basis points
}

// NEW: Per-trader volume tracking
pub struct VolumeRecord {
    pub daily_volumes: Vec<i128>,  // 14 slots, one per day (Soroban Vec, not Rust array)
    pub last_update_day: u64,      // Unix timestamp / 86400
}

// NEW: View return type
pub struct TraderFeeInfo {
    pub volume_14d: i128,      // Total 14-day volume
    pub tier: u32,             // Current tier index (0-3)
    pub maker_fee_bps: u32,    // Applied maker fee
    pub taker_fee_bps: u32,    // Applied taker fee
    pub next_tier_volume: i128,// Volume needed for next tier (0 if max tier)
}

// MODIFY: MarketConfig
pub struct MarketConfig {
    // REMOVE: pub trading_fee_bps: u32,
    pub base_maker_fee_bps: u32,    // NEW: default 2 (0.02%)
    pub base_taker_fee_bps: u32,    // NEW: default 5 (0.05%)
    // ... other existing fields unchanged ...
}
```

#### New Storage Keys (`contracts/market/src/storage.rs`)

```rust
TraderVolume(Address),   // VolumeRecord - per-trader rolling volume
FeeTiers,                // Vec<FeeTier> - admin-configured tier thresholds
```

#### New Trading Functions (`contracts/market/src/trading.rs`)

| Function | Signature | Description |
|----------|-----------|-------------|
| `record_volume` | `(env, trader: &Address, size: i128)` | Add trade size to today's slot in rolling window |
| `get_rolling_volume` | `(env, trader: &Address) -> i128` | Sum all 14 daily slots |
| `get_fee_tier` | `(env, trader: &Address) -> FeeTier` | Match volume to tier |
| `calculate_fee` | `(env, trader: &Address, size: i128, is_maker: bool) -> i128` | Get tier → apply maker or taker rate |
| `rotate_volume_window` | `(env, record: &mut VolumeRecord, current_day: u64)` | Zero out expired days, advance window |

**14-Day Rolling Window Logic:**
```
current_day = env.ledger().timestamp() / 86400
days_since_update = current_day - record.last_update_day

if days_since_update == 0:
    // Same day, just add to current slot
    record.daily_volumes[current_day % 14] += size

if days_since_update >= 14:
    // All data expired, reset everything
    record.daily_volumes = [0; 14]
    record.daily_volumes[current_day % 14] = size

if 0 < days_since_update < 14:
    // Zero out the expired days
    for i in 1..=days_since_update:
        record.daily_volumes[(record.last_update_day + i) % 14] = 0
    record.daily_volumes[current_day % 14] = size

record.last_update_day = current_day
```

#### Modified Contract Functions (`contracts/market/src/lib.rs`)

| Function | Line | Change |
|----------|------|--------|
| `open_position` | ~218 | Replace `calculate_trading_fee(size, config.trading_fee_bps)` with `calculate_fee(env, &trader, size, false)` (taker). Add `record_volume()`. |
| `execute_limit_entry` | ~1470 | Replace fee calc with `calculate_fee(env, &order.trader, size, true)` (maker). Add `record_volume()`. |
| `execute_close_order` | ~1520 | Add `record_volume()` for the close trade. |
| `initialize` | ~68 | Set default fee tiers on init. |

New functions:
| Function | Description |
|----------|-------------|
| `set_fee_tiers(admin, tiers: Vec<FeeTier>)` | Admin: update tier thresholds and rates |
| `get_fee_tiers()` | View: return current tier config |
| `get_trader_fee_info(trader: Address)` | View: return trader's volume, tier, and fees |

### Task Breakdown

| ID | Task | Layer | Files | Depends | Est |
|----|------|-------|-------|---------|-----|
| T1.3.1 | Add FeeTier, VolumeRecord, TraderFeeInfo structs | Contract Types | `types.rs` | - | 1h |
| T1.3.2 | Modify MarketConfig: remove trading_fee_bps, add base_maker/taker_fee_bps | Contract Types | `types.rs` | T1.3.1 | 1h |
| T1.3.3 | Add TraderVolume + FeeTiers storage keys and helpers | Contract Storage | `storage.rs` | T1.3.1 | 1.5h |
| T1.3.4 | Implement `rotate_volume_window` + `record_volume` | Contract Trading | `trading.rs` | T1.3.3 | 2.5h |
| T1.3.5 | Implement `get_rolling_volume` + `get_fee_tier` | Contract Trading | `trading.rs` | T1.3.4 | 1.5h |
| T1.3.6 | Implement `calculate_fee(trader, size, is_maker)` | Contract Trading | `trading.rs` | T1.3.5 | 2h |
| T1.3.7 | Integrate into `open_position` (taker fee + record_volume) | Contract Core | `lib.rs` | T1.3.6 | 2h |
| T1.3.8 | Integrate into `execute_limit_entry` (maker fee + record_volume) | Contract Core | `lib.rs` | T1.3.6 | 2h |
| T1.3.9 | Integrate into `execute_close_order` (record_volume) | Contract Core | `lib.rs` | T1.3.6 | 1h |
| T1.3.10 | Add `set_fee_tiers`, `get_fee_tiers`, `get_trader_fee_info` | Contract Core | `lib.rs` | T1.3.5 | 2h |
| T1.3.11 | Update `initialize` to set default fee tiers | Contract Core | `lib.rs` | T1.3.10 | 0.5h |
| T1.3.12 | Unit tests: each tier, volume window rotation, day boundary, maker vs taker | Contract Test | `test.rs` | T1.3.10 | 4h |
| T1.3.13 | Frontend: show maker/taker fee in OrderPanel based on order type | Frontend | `OrderPanel.tsx` | T1.3.7 | 2h |
| T1.3.14 | Frontend: FeeTierInfo component (tier, volume, progress bar) | Frontend | new `FeeTierInfo.tsx` | T1.3.10 | 3h |
| T1.3.15 | Frontend: `getTraderFeeInfo()` + `getFeeTiers()` contract calls | Frontend | `market.ts` | T1.3.10 | 1h |
| T1.3.16 | Frontend: update constants with new fee structure | Frontend | `constants.ts` | T1.3.2 | 0.5h |

**Total: ~28 hours**

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| VolumeRecord storage per-trader grows over time | Low | Fixed 14-slot Vec, constant size. Old traders auto-expire to tier 0. |
| Day boundary calculation wrong across timezones | Medium | Use UTC exclusively (ledger timestamp is UTC) |
| Removing `trading_fee_bps` breaks existing deploy/init scripts | Medium | Backward-compatible: keep field but ignore if fee tiers are set |
| Volume manipulation via wash trading | Low | Out of scope for now, monitor post-launch |

---

## T1 Sprint Plan

### Sprint 1: Foundation (Mar 19-21, 3 days)

**Goal:** All new types, enums, structs, and storage keys in place. Code compiles.

| Day | Tasks | Owner |
|-----|-------|-------|
| Mar 19 | T1.1.1, T1.2.1, T1.2.2, T1.3.1, T1.3.2 (all type definitions) | - |
| Mar 20 | T1.1.2, T1.2.3, T1.3.3 (all storage keys) | - |
| Mar 21 | T1.1.3, T1.3.4, T1.3.5 (cross-margin deposit/withdraw, volume tracking) | - |

**Checkpoint:** `cargo build` passes with all new types. No new logic yet.

### Sprint 2: Core Logic (Mar 22-24, 3 days)

**Goal:** All smart contract logic implemented. Functions callable but not yet tested end-to-end.

| Day | Tasks | Owner |
|-----|-------|-------|
| Mar 22 | T1.1.4, T1.1.5 (cross-margin open + close) | - |
| Mar 22 | T1.2.4, T1.2.5 (stop-limit, take-limit) | - |
| Mar 23 | T1.1.6, T1.1.7 (cross-margin equity + liquidation) | - |
| Mar 23 | T1.2.6, T1.2.7 (trailing stop + peak updates) | - |
| Mar 23 | T1.3.6, T1.3.7, T1.3.8 (fee calc + integration) | - |
| Mar 24 | T1.1.8, T1.1.9 (view funcs, add_collateral) | - |
| Mar 24 | T1.2.8, T1.2.9, T1.2.10 (reduce-only, IOC, PostOnly) | - |
| Mar 24 | T1.3.9, T1.3.10, T1.3.11 (close order volume, admin funcs) | - |

**Checkpoint:** All contract functions implemented. `cargo build` passes.

### Sprint 3: Testing & Integration (Mar 25-26, 2 days)

**Goal:** All unit tests passing. Keeper bot updated.

| Day | Tasks | Owner |
|-----|-------|-------|
| Mar 25 | T1.1.10 (cross-margin tests) | - |
| Mar 25 | T1.2.11, T1.2.12 (execute_order updates, should_execute updates) | - |
| Mar 25 | T1.2.13 (order type tests) | - |
| Mar 26 | T1.3.12 (fee tier tests) | - |
| Mar 26 | T1.1.11, T1.2.14 (keeper bot updates) | - |

**Checkpoint:** `cargo test` all green. Keeper bot runs with new order types.

### Sprint 4: Frontend & Deploy (Mar 27-28, 2 days)

**Goal:** Full frontend UI. Deployed to testnet. Demo-ready.

| Day | Tasks | Owner |
|-----|-------|-------|
| Mar 27 | T1.1.12, T1.1.13, T1.1.14 (cross-margin UI) | - |
| Mar 27 | T1.2.15, T1.2.16, T1.2.17 (order type UI) | - |
| Mar 27 | T1.3.13, T1.3.14, T1.3.15, T1.3.16 (fee UI) | - |
| Mar 28 | T1.2.18, T1.2.19 (order list/book updates) | - |
| Mar 28 | Deploy to testnet, smoke test all features, fix bugs | - |

**Checkpoint:** All features live on testnet. Acceptance criteria met.

---

# TRANCHE 2 - Testnet

**Deadline: 2026-05-09 (51 days from now)**
**Budget: $25,800**
**Prerequisites: Tranche 1 complete**

---

## T2.1 REST API for Programmatic Trading & SDK

### Context

**Current State:** No API. All interactions go through frontend → Soroban RPC directly.

**Target State:** Public REST API with API key auth, rate limiting, and TypeScript/Python SDKs.

### API Endpoints

```
Authentication:
  POST   /api/v1/auth/apikey              Generate API key (wallet signature required)
  DELETE /api/v1/auth/apikey/:key          Revoke API key

Trading:
  POST   /api/v1/orders                   Place order (all 7 types)
  DELETE /api/v1/orders/:id               Cancel order
  GET    /api/v1/orders                   List user's orders (with filters)
  GET    /api/v1/orders/:id               Get order details

Positions:
  GET    /api/v1/positions                List user's positions
  POST   /api/v1/positions/:id/close      Close position
  POST   /api/v1/positions/:id/collateral Add collateral

Account:
  GET    /api/v1/account                  Balance, margin, fee tier info
  GET    /api/v1/account/history          Trade history (paginated)

Market Data (public, no auth):
  GET    /api/v1/market/:pair/book        Order book snapshot
  GET    /api/v1/market/:pair/trades      Recent trades
  GET    /api/v1/market/:pair/candles     OHLCV candles (1m, 5m, 15m, 1h, 4h, 1d)
  GET    /api/v1/market/:pair/ticker      24h ticker (price, volume, change)
  GET    /api/v1/market/pairs             List all trading pairs
```

### Definition of Done

- [ ] All endpoints functional and returning correct data
- [ ] API key auth via `X-API-Key` header
- [ ] Rate limiting: 10 req/s for trading, 30 req/s for market data
- [ ] TypeScript SDK published with all endpoints
- [ ] Python SDK published with all endpoints
- [ ] OpenAPI/Swagger documentation auto-generated
- [ ] Integration tests covering all endpoints

### Task Breakdown

| ID | Task | Est |
|----|------|-----|
| T2.1.1 | API server setup (Fastify + TypeScript), project structure, config | 4h |
| T2.1.2 | Database setup (PostgreSQL) for API keys, candles, trade history | 6h |
| T2.1.3 | API key generation + wallet signature verification middleware | 6h |
| T2.1.4 | Rate limiting middleware (per key + per endpoint) | 3h |
| T2.1.5 | Soroban event indexer: listen to contract events, store in DB | 8h |
| T2.1.6 | Trading endpoints: place/cancel/list orders | 8h |
| T2.1.7 | Position endpoints: list/close/add-collateral | 6h |
| T2.1.8 | Account endpoints: balance, margin, fee tier, history | 4h |
| T2.1.9 | Market data: orderbook, recent trades, ticker | 6h |
| T2.1.10 | OHLCV candle aggregation from indexed trades | 8h |
| T2.1.11 | TypeScript SDK package | 8h |
| T2.1.12 | Python SDK package | 8h |
| T2.1.13 | OpenAPI spec + Swagger UI | 4h |
| T2.1.14 | Integration tests | 6h |

**Total: ~85 hours**

---

## T2.2 WebSocket API for Real-Time Data

### Context

**Current State:** Frontend polls Soroban RPC directly. No real-time push.

**Target State:** WebSocket server streaming live data with sub-500ms latency.

### Channels

| Channel | Auth | Data |
|---------|------|------|
| `orderbook:{pair}` | No | Live orderbook deltas (add/remove/update) |
| `trades:{pair}` | No | New trades as they execute |
| `ticker:{pair}` | No | Price, 24h change, volume (every 1s) |
| `prices` | No | All asset prices (every 1s) |
| `positions` | API Key | User's position updates (open/close/liquidate) |
| `orders` | API Key | User's order updates (placed/executed/cancelled) |
| `account` | API Key | Balance changes, margin updates |

### Definition of Done

- [ ] WebSocket server deployed alongside REST API
- [ ] All channels functional with correct data
- [ ] Sub-500ms latency from on-chain event to client delivery
- [ ] Reconnection + heartbeat handling
- [ ] Documentation with Python and TypeScript examples
- [ ] Load test: 1000 concurrent connections sustained

### Task Breakdown

| ID | Task | Est |
|----|------|-----|
| T2.2.1 | WebSocket server (ws library), connection manager, auth | 4h |
| T2.2.2 | Channel subscription/unsubscription protocol | 3h |
| T2.2.3 | Event bridge: Soroban indexer → WebSocket broadcast | 6h |
| T2.2.4 | Orderbook channel with delta updates | 6h |
| T2.2.5 | Trades channel | 3h |
| T2.2.6 | Ticker + prices channels with aggregation | 4h |
| T2.2.7 | Authenticated channels (positions, orders, account) | 6h |
| T2.2.8 | Heartbeat + reconnection protocol | 3h |
| T2.2.9 | Documentation with code examples | 4h |
| T2.2.10 | Load testing + latency benchmarks | 4h |

**Total: ~43 hours**

---

## T2.3 User-Created Vaults (Vault Leaders & Depositors)

### Context

**Current State:** Single protocol-owned vault (LP pool) for liquidity. No user-created vaults.

**Target State:** Any user can create a trading vault. Vault leaders trade with pooled capital, earn 10% profit share. Marketplace page lists all vaults.

### Smart Contract Architecture

```
VaultFactory (new contract)
├── create_vault() → deploys UserVault instance
├── list_vaults() → all vault addresses + metadata
└── get_vault_stats() → aggregate TVL, count

UserVault (new contract, one per vault)
├── deposit(depositor, amount) → mint vault shares
├── withdraw(depositor, shares) → burn shares, return USDC
├── trade(leader, ...) → open/close positions via Market contract
├── get_performance() → APY, drawdown, PnL history
└── Leader constraints: min 5% balance, profit share calc
```

### Definition of Done

- [ ] VaultFactory contract deployed on testnet
- [ ] Users can create vaults with name and description
- [ ] Depositors can deposit/withdraw from vaults
- [ ] Leaders can trade from vault funds
- [ ] 10% profit share calculated and distributed correctly
- [ ] Leaders maintain minimum 5% of vault balance
- [ ] Marketplace page lists all vaults with APY, TVL, drawdown, depositor count
- [ ] Individual vault page shows PnL history, open positions, trade history

### Task Breakdown

| ID | Task | Est |
|----|------|-----|
| T2.3.1 | VaultFactory contract: create_vault, list_vaults, get_vault_stats | 8h |
| T2.3.2 | UserVault contract: deposit, withdraw, share token mint/burn | 10h |
| T2.3.3 | UserVault trading: leader trades via Market contract integration | 8h |
| T2.3.4 | Profit share calculation (10% of profits to leader) | 4h |
| T2.3.5 | Leader constraints: min 5% balance, max drawdown tracking | 4h |
| T2.3.6 | Performance metrics: APY, max drawdown, trade count, win rate | 6h |
| T2.3.7 | Vault marketplace frontend page | 8h |
| T2.3.8 | Individual vault detail page (PnL chart, positions, history) | 8h |
| T2.3.9 | Vault creation + deposit/withdraw UI | 6h |
| T2.3.10 | Trade UI integration (trade as vault leader) | 6h |
| T2.3.11 | Unit tests for vault contracts | 6h |

**Total: ~74 hours**

---

## T2.4 Multi-Wallet Support & On-Chain Referral System

### Context

**Current State:** Freighter + WalletConnect + xBull (basic). No referral system.

**Target State:** Full support for Freighter, Lobstr, xBull, Albedo, Ledger. On-chain referral with 10% fee share.

### Referral Mechanics

```
Referrer creates code → "ALICE2026"
Referee signs up with code → linked on-chain
On every referee trade:
  - Referee gets 4% fee discount (applied before fee goes to vault)
  - Referrer earns 10% of referee's fee (from vault's portion)
  - Example: $100k trade, taker fee 0.05% = $50 fee
    - Referee pays: $50 - 4% discount = $48
    - Referrer earns: $48 * 10% = $4.80
    - Vault receives: $48 - $4.80 = $43.20
```

### Definition of Done

- [ ] All 5 wallets can connect, sign, and trade
- [ ] Referral code generation for qualifying users (volume threshold)
- [ ] Referred users automatically receive 4% fee discount
- [ ] Referrers earn 10% of referred users' fees
- [ ] Referral dashboard: earnings, referred users count, claim button
- [ ] Referral earnings claimable (accumulated, not per-trade)

### Task Breakdown

| ID | Task | Est |
|----|------|-----|
| T2.4.1 | Unified wallet adapter interface (abstract sign/connect/disconnect) | 6h |
| T2.4.2 | Lobstr wallet integration | 4h |
| T2.4.3 | xBull wallet integration (upgrade existing basic support) | 2h |
| T2.4.4 | Albedo wallet integration | 3h |
| T2.4.5 | Ledger wallet integration (Stellar Ledger transport) | 6h |
| T2.4.6 | Wallet selection modal redesign (all 5 wallets) | 3h |
| T2.4.7 | Referral contract: code generation, mapping, fee split logic, claim | 8h |
| T2.4.8 | Integrate referral into Market fee calculation (discount + share) | 4h |
| T2.4.9 | Referral dashboard frontend (earnings, users, history, claim) | 6h |
| T2.4.10 | Referral link sharing + code input during first trade | 3h |
| T2.4.11 | Unit tests for referral contract | 4h |

**Total: ~49 hours**

---

# TRANCHE 3 - Mainnet

**Deadline: 2026-06-21 (94 days from now)**
**Budget: $34,480**
**Prerequisites: Tranche 1 + 2 complete**

---

## T3.1 Production-Grade Multi-Source Oracle

### Context

**Current State:** Single mock oracle fed by keeper (Binance only). No redundancy, no cross-validation.

**Target State:** 3-layer architecture with 5 CEX sources, on-chain trust anchors, and cached fallback.

### Architecture

```
Layer 1: CEX Aggregation (off-chain, keeper)
┌─────────┬─────────┬─────────┬─────────┬─────────┐
│ Binance │  OKX    │ Bybit   │ Kraken  │ KuCoin  │
└────┬────┴────┬────┴────┬────┴────┬────┴────┬────┘
     └─────────┴─────────┼─────────┴─────────┘
                         ▼
              Weighted Median (exclude outliers)
                         │
                         ▼ Push on-chain every 3s
Layer 2: On-Chain Cross-Validation
┌───────────┬───────────┬───────────┐
│ Reflector │    DIA    │   Band    │
└─────┬─────┴─────┬─────┴─────┬─────┘
      └───────────┼───────────┘
                  ▼
      Deviation check vs Layer 1
      If deviation > threshold → AUTO-PAUSE asset
                  │
Layer 3: Fallback
      If all sources fail → use cached price (max 30s)
      If cache stale → AUTO-PAUSE all trading
```

### Definition of Done

- [ ] Keeper fetches from 5 CEXs simultaneously every 3 seconds
- [ ] Weighted median excludes sources deviating > 2% from median
- [ ] On-chain cross-validation with Reflector, DIA, Band
- [ ] Auto-pause triggers on cross-layer deviation > threshold
- [ ] Auto-pause triggers when all sources fail
- [ ] Oracle health monitoring endpoint with per-source status
- [ ] Chainlink-ready: swap primary oracle via single admin call
- [ ] Alerting to Discord/Telegram on pause or source failure

### Task Breakdown

| ID | Task | Est |
|----|------|-----|
| T3.1.1 | Multi-CEX fetcher: Binance, OKX, Bybit, Kraken, KuCoin (parallel) | 6h |
| T3.1.2 | Weighted median with outlier exclusion algorithm | 4h |
| T3.1.3 | Reflector oracle integration (on-chain read) | 6h |
| T3.1.4 | DIA oracle integration (upgrade existing) | 4h |
| T3.1.5 | Band Protocol integration (upgrade existing) | 4h |
| T3.1.6 | Cross-layer deviation check + auto-pause in oracle adapter contract | 6h |
| T3.1.7 | Cached price fallback with staleness auto-pause | 3h |
| T3.1.8 | Oracle health monitoring API endpoint | 4h |
| T3.1.9 | Chainlink adapter interface (swap via admin function) | 3h |
| T3.1.10 | Keeper bot: 3-second cycle, multi-source push | 6h |
| T3.1.11 | Discord/Telegram alerting on pause or failure | 3h |
| T3.1.12 | Integration tests with simulated source failures | 4h |

**Total: ~53 hours**

---

## T3.2 Mainnet Smart Contract Deployment & Migration

### Definition of Done

- [ ] All contracts (Market, Vault, VaultFactory, OracleAdapter, NOE Token) deployed to mainnet
- [ ] Contract addresses published in docs and frontend config
- [ ] Production keeper bot running with 99%+ uptime, health checks, alerting
- [ ] Production parameters: 25x max leverage, maker/taker fees, 4+ pairs (BTC, ETH, XLM, SOL)
- [ ] Mainnet USDC integration tested
- [ ] Emergency pause mechanism tested and documented

### Task Breakdown

| ID | Task | Est |
|----|------|-----|
| T3.2.1 | Mainnet deployment scripts with parameter configuration | 6h |
| T3.2.2 | Production parameter tuning and review | 4h |
| T3.2.3 | Mainnet USDC integration and testing | 4h |
| T3.2.4 | Production keeper infrastructure (Docker, auto-restart, health checks) | 8h |
| T3.2.5 | Monitoring + alerting (uptime, gas balance, error rates, position count) | 6h |
| T3.2.6 | Emergency pause testing + runbook documentation | 3h |
| T3.2.7 | Contract verification + audit checklist | 4h |
| T3.2.8 | Frontend config: testnet ↔ mainnet environment switch | 2h |

**Total: ~37 hours**

---

## T3.3 Production Frontend, Documentation & Additional Trading Pairs

### Definition of Done

- [ ] Frontend loads under 3 seconds on standard connection
- [ ] Full mobile-responsive trading on iOS and Android
- [ ] 10+ total trading pairs live on mainnet
- [ ] User docs: Getting Started, Trading Guide, Vault Guide, FAQ
- [ ] Developer docs: REST API reference, WebSocket API reference, SDK quickstart
- [ ] All docs hosted and linked from frontend
- [ ] Error boundaries and graceful error handling on all pages

### Task Breakdown

| ID | Task | Est |
|----|------|-----|
| T3.3.1 | Performance audit + optimization (bundle splitting, lazy loading, image opt) | 8h |
| T3.3.2 | Mobile-responsive trading interface (all components) | 12h |
| T3.3.3 | Error boundaries + graceful degradation on every page | 6h |
| T3.3.4 | Loading states + skeleton screens | 4h |
| T3.3.5 | Add 7+ trading pairs (SOL, DOGE, AVAX, LINK, MATIC, ADA, DOT) | 6h |
| T3.3.6 | User documentation: Getting Started + Trading Guide | 6h |
| T3.3.7 | User documentation: Vault Guide + FAQ | 4h |
| T3.3.8 | Developer documentation: REST API reference (from OpenAPI spec) | 6h |
| T3.3.9 | Developer documentation: WebSocket API + SDK quickstart | 4h |
| T3.3.10 | Documentation site hosting (Docusaurus/GitBook) | 3h |

**Total: ~59 hours**

---

## T3.4 Partial Liquidation System & Insurance Fund

### Context

**Current State:** Full liquidation only. When position is liquidatable, 100% is closed immediately. No insurance fund.

**Target State:**
- Positions > $1,000: liquidate 20% first, wait 30 seconds
- If still liquidatable after 30s: full liquidation
- Insurance fund accumulates 10% of all liquidation proceeds
- Fund used to cover socialized losses in extreme events

### Partial Liquidation Flow

```
Position $5,000, liquidatable:

Step 1 (t=0): Partial liquidation
  - Close 20% = $1,000 of position
  - Remaining: $4,000
  - Set cooldown: 30 seconds
  - 10% of liquidation proceeds → insurance fund

Step 2 (t=30s): Re-check
  - If still liquidatable → full liquidation of remaining $4,000
  - If no longer liquidatable (price recovered) → position survives

Positions < $1,000: immediate full liquidation (gas cost not worth partial)
```

### Definition of Done

- [ ] Positions > $1,000 are 20% liquidated first with 30-second cooldown
- [ ] Cooldown prevents re-liquidation within 30 seconds
- [ ] If still liquidatable after cooldown, full liquidation executes
- [ ] Insurance fund contract deployed, accumulating 10% of liquidation proceeds
- [ ] Insurance fund balance viewable on frontend stats bar
- [ ] Full liquidation cascade tested with multiple simultaneous positions
- [ ] Unit tests for: partial close math, cooldown enforcement, insufficient margin after partial, multiple rounds, insurance fund accumulation

### Task Breakdown

| ID | Task | Est |
|----|------|-----|
| T3.4.1 | Insurance fund contract: receive, accumulate, admin withdraw, view balance | 6h |
| T3.4.2 | Modify liquidation: partial (20%) for positions > $1,000 threshold | 6h |
| T3.4.3 | Cooldown storage + enforcement (30s between partial and full) | 4h |
| T3.4.4 | Route 10% of liquidation proceeds to insurance fund | 3h |
| T3.4.5 | Update keeper bot: two-phase liquidation (partial → wait → re-check) | 4h |
| T3.4.6 | Frontend: insurance fund balance in stats bar | 2h |
| T3.4.7 | Liquidation cascade testing (5+ positions, mixed isolated/cross) | 4h |
| T3.4.8 | Unit tests for edge cases | 4h |

**Total: ~33 hours**

---

## Grand Total: Effort Summary

| Tranche | Contract | Keeper | Frontend | API/Infra | Docs | Total |
|---------|----------|--------|----------|-----------|------|-------|
| T1 (Mar 28) | ~70h | ~6h | ~24h | - | - | **~100h** |
| T2 (May 9) | ~55h | - | ~47h | ~128h | ~8h | **~238h** |
| T3 (Jun 21) | ~33h | ~17h | ~47h | ~23h | ~23h | **~143h** |
| **Total** | **~158h** | **~23h** | **~118h** | **~151h** | **~31h** | **~481h** |

---

## Risk Register

| # | Risk | Impact | Probability | Mitigation |
|---|------|--------|-------------|------------|
| R1 | Cross-margin liquidation edge cases (negative equity, cascade) | Critical | Medium | Extensive unit tests, 1-week testnet soak before release |
| R2 | Trailing stop gas costs with many active orders | High | Medium | Batch updates per asset, skip if price unchanged |
| R3 | 14-day volume window incorrect at day boundaries (timezone) | Medium | Low | Use UTC ledger timestamp exclusively, test boundary cases |
| R4 | Soroban contract size limit exceeded with new features | High | Low | Monitor WASM size per feature, split modules if needed |
| R5 | Oracle source downtime during mainnet trading | Critical | Medium | 3-layer fallback + auto-pause + cached prices |
| R6 | WebSocket server can't sustain 1000+ connections | Medium | Medium | Connection pooling, message batching, horizontal scaling plan |
| R7 | Mainnet USDC behaves differently from testnet | Medium | Low | Test on mainnet staging with small amounts first |
| R8 | StopLimit two-phase creates stuck orders | High | Medium | Timeout for phase 2 (if limit not filled in 1h, cancel) |
| R9 | Vault leader manipulation (front-running depositors) | High | Medium | Timelock on withdrawals, transparent trade history |
| R10 | T1 deadline too tight (9 days, ~100h work) | High | High | Prioritize contract work, frontend can slip 2-3 days |

---

## Technical Decisions Log

| # | Decision | Rationale | Alternatives Considered |
|---|----------|-----------|------------------------|
| D1 | Cross-margin uses explicit deposit/withdraw (not automatic) | User must opt-in to cross mode. Prevents accidental exposure. Clear UX. | Auto-cross for all positions (too risky), per-position toggle (complex) |
| D2 | Trailing stop peak stored on-chain, updated by keeper | Trustless peak tracking. Keeper can't manipulate (only update to current price). | Off-chain tracking (trust issue), on-chain per-trade update (gas) |
| D3 | Volume window = 14 fixed slots (Vec, not Map) | Constant storage size regardless of trading frequency. O(1) rotation. | Per-trade timestamps (unbounded), daily Map entries (cleanup needed) |
| D4 | Maker = resting limit order, Taker = everything else | Simple classification. Matches industry standard. PostOnly guarantees maker. | Complex matching engine (overkill for current orderbook design) |
| D5 | Partial liquidation only for positions > $1,000 | Gas cost of partial liquidation not worth it for small positions. | All positions (wasteful), $5,000 threshold (too high) |
| D6 | Insurance fund = separate contract | Clean separation of concerns. Independent upgrade cycle. Admin control. | Inside Market contract (bloat), inside Vault (conflates LP and insurance) |
| D7 | StopLimit has timeout (1h) for phase 2 | Prevents permanently stuck orders if limit price never reached. | No timeout (stuck forever), short timeout (not enough time for fill) |
| D8 | REST API uses PostgreSQL for indexing | Need OHLCV candles, trade history, API keys. Soroban events alone insufficient. | SQLite (no concurrent access), Redis (no complex queries) |
