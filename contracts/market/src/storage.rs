//! # Market Storage
//!
//! Storage keys and helpers for the Market contract.

use soroban_sdk::{contracttype, panic_with_error, Address, Env, Symbol, Vec};
use noether_common::{NoetherError, Position, MarketConfig, AssetRiskParams, Order, OrderStatus, FeeTier, VolumeRecord};

// ═══════════════════════════════════════════════════════════════════════════
// Storage Keys
// ═══════════════════════════════════════════════════════════════════════════

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Admin address
    Admin,
    /// Oracle adapter contract address
    OracleAdapter,
    /// Vault contract address
    Vault,
    /// USDC token contract address
    UsdcToken,
    /// Market configuration
    Config,
    /// Position counter (for ID generation)
    PositionCounter,
    /// Total long position size
    TotalLongSize,
    /// Total short position size
    TotalShortSize,
    /// Last funding time
    LastFundingTime,
    /// Current funding rate (latest hourly rate)
    CurrentFundingRate,
    /// Cumulative funding rate (accumulated over time for accurate per-position funding)
    CumulativeFundingRate,
    /// Whether initialized
    Initialized,
    /// Whether paused (LEGACY bool — left unread after the L0-15 upgrade;
    /// superseded by PauseState. Kept so old stored value doesn't break decode)
    Paused,
    /// Two-tier pause (L0-15): (mode, since) where mode 0=live, 1=halt-open,
    /// 2=full-freeze; since = ledger seconds the current mode began.
    PauseState,
    /// L1-24: per-asset trading halt (persistent bool, unwrap_or false). When
    /// true, risk-INCREASING ops on the asset revert #92; closing/liquidating
    /// still works — one broken feed no longer forces a whole-venue pause.
    AssetHalted(Symbol),
    /// L1-30: proceeds (USDC to trader) from a full isolated close, keyed by
    /// position_id, in TEMPORARY storage. Lets a vault_factory owner reconcile
    /// a keeper-executed protective close to the exact amount that landed at
    /// the factory (no factory call fires on a keeper execution).
    ClosedProceeds(u64),
    /// Position by ID
    Position(u64),
    /// Position IDs for a trader
    TraderPositions(Address),
    /// Count of live Position rows (u32). Replaces the AllPositions Vec:
    /// the global index was rewritten in full on every open and close, so a
    /// busy market paid O(open positions) per trade and every transaction
    /// raced every other on one shared entry. Off-chain discovery walks
    /// Position(id) ledger entries directly and uses this count as its
    /// completeness checksum. Unit key — encodes as scvVec([scvSymbol]).
    OpenPositionCount,
    /// Order by ID
    Order(u64),
    /// Order counter (for ID generation)
    OrderCounter,
    /// Count of Pending Order rows (u32). Replaces the AllOrders Vec — same
    /// story as OpenPositionCount. Orders are status updated rather than
    /// deleted, so "counted" means status == Pending, and the off-chain walk
    /// treats any terminal status as absent.
    OpenOrderCount,
    /// Count of Pending orders per trader (u32). Replaces the TraderOrders
    /// Vec, which existed only to bound MAX_OPEN_ORDERS_PER_TRADER — nothing
    /// on or off chain ever enumerated it.
    OrderCountOf(Address),
    /// One-shot latch for seed_open_counts. A DEDICATED marker rather than
    /// "does OpenPositionCount exist": liquidations run even while paused,
    /// and the very first close/liquidation after an in-place upgrade
    /// CREATES the counter key (saturating 0), which would slam a
    /// presence-based latch shut before the admin ever seeded.
    OpenCountsSeeded,
    /// Stop-loss order ID attached to a position
    PositionStopLoss(u64),
    /// Take-profit order ID attached to a position
    PositionTakeProfit(u64),
    /// Per-trader 14-day rolling volume record
    TraderVolume(Address),
    /// Fee tier configuration (Vec<FeeTier>)
    FeeTiers,
    /// Cross-margin balance per trader (i128)
    CrossMarginBalance(Address),
    /// Cross-margin position IDs per trader (Vec<u64>)
    CrossMarginPositions(Address),
    /// Peak price tracked for trailing stop orders (order_id -> i128)
    TrailingStopPeak(u64),
    /// Trailing-stop order ID attached to a position
    PositionTrailingStop(u64),
    /// Last accepted fresh oracle price + timestamp per asset (deviation guard)
    LastGoodPrice(Symbol),
    /// Treasury address receiving the protocol's share of trading fees
    Treasury,
    /// L1-18: the referral registry the fee path try-invokes. Unset = no-op.
    Referral,
    /// Protocol share of trading fees in bps (default 2000 = 20%)
    ProtocolFeeBps,
    /// Per-asset aggregate exposure (long_k, long_size, short_k, short_size)
    /// where k = sum of size*PRECISION/entry — lets unrealized PnL at mark P
    /// be computed incrementally without iterating positions
    AssetExposure(Symbol),
    /// Ledger timestamp of the last partial liquidation of a position
    /// (T3-D4 grace period). Removed with the position.
    PartialLiqTs(u64),
    /// Ledger timestamp of the last STAGED cross-account liquidation round
    /// (L0-5 grace period) — account-scoped, cleared on full close.
    CrossPartialLiqTs(Address),
    /// ADL solvency flag per asset (L0-1): while set, new opens are
    /// rejected and adl_close may force-realize winners at mark.
    AdlActive(Symbol),
    /// Per-market risk params (L0-12): leverage cap, IM/MM/close-out,
    /// max size, funding velocity/clamp, skew scale. Unset = ladder
    /// inactive for the asset (risk-increasing ops fail #88).
    AssetRisk(Symbol),
    /// Ledger timestamp the ladder went live (L0-12), stamped once by the
    /// first set_asset_risk. Positions opened before it keep the legacy
    /// maintenance margin so an in-place upgrade liquidates nobody.
    RiskEpochTs,
    /// Per-asset funding state (L0-13): (cumulative_index, current_rate,
    /// last_ts), all fraction-units/h (1e7 = 100%/h) except last_ts.
    /// Replaces the single global CumulativeFundingRate for per-market
    /// funding. Absent = (0, 0, 0).
    FundingState(Symbol),
    /// Per-asset time-weighted skew integral (L0-13, M-7 kill):
    /// (integral [notional×seconds], last_touch_ts). Accumulated in
    /// adjust_oi, drained by apply_funding.
    SkewIntegral(Symbol),
}

// ═══════════════════════════════════════════════════════════════════════════
// Instance Storage
// ═══════════════════════════════════════════════════════════════════════════

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env, value: bool) {
    env.storage().instance().set(&DataKey::Initialized, &value);
}

/// LEGACY (L0-15): the pre-two-tier bool, still written by initialize for a
/// clean default; superseded by PauseState. Never read on any gate path
/// (get_paused removed — nothing reads it).
pub fn set_paused(env: &Env, value: bool) {
    env.storage().instance().set(&DataKey::Paused, &value);
}

/// Full-freeze (mode 2) auto-degrades to halt-open (mode 1) after this many
/// seconds — a bounded blast radius so a stuck full-freeze can't strand
/// closes/liquidations forever (L0-15). Mode 1 never auto-expires.
pub const FULL_FREEZE_MAX_SECS: u64 = 259_200; // 72h

/// Raw stored (mode, since). Unset = (0, 0) = live.
pub fn get_pause_state(env: &Env) -> (u32, u64) {
    env.storage().instance().get(&DataKey::PauseState).unwrap_or((0u32, 0u64))
}

pub fn set_pause_state(env: &Env, mode: u32, since: u64) {
    env.storage().instance().set(&DataKey::PauseState, &(mode, since));
}

/// Effective pause mode for a WRITE path: reads the stored mode and, if a
/// full-freeze has outlived FULL_FREEZE_MAX_SECS, persists the degrade to
/// mode 1 + emits pause_degraded before returning 1. Safe to write because
/// every caller is a write entrypoint (a rejecting gate simply rolls the
/// degrade back — it re-fires on the next op). Read-only callers use
/// effective_pause_mode_view instead.
pub fn effective_mode(env: &Env) -> u32 {
    let (mode, since) = get_pause_state(env);
    if mode == 2 && env.ledger().timestamp() >= since.saturating_add(FULL_FREEZE_MAX_SECS) {
        set_pause_state(env, 1, since);
        env.events().publish((Symbol::new(env, "pause_degraded"),), (2u32, 1u32));
        return 1;
    }
    mode
}

/// Read-only effective mode (no persist, no event) — for views. Same 72h
/// degrade logic, computed logically.
pub fn effective_pause_mode_view(env: &Env) -> u32 {
    let (mode, since) = get_pause_state(env);
    if mode == 2 && env.ledger().timestamp() >= since.saturating_add(FULL_FREEZE_MAX_SECS) {
        return 1;
    }
    mode
}

/// Gate for risk-INCREASING ops (opens, non-reduce-only order placement,
/// margin removal): allowed ONLY when fully live. #4 Paused in mode 1/2.
pub fn require_can_increase_risk(env: &Env) -> Result<(), NoetherError> {
    if effective_mode(env) != 0 {
        return Err(NoetherError::Paused);
    }
    Ok(())
}

/// Gate for risk-REDUCING ops (closes, liquidations, cross deposit/withdraw,
/// stops, funding): allowed in live + halt-open; #90 Frozen only in mode 2.
pub fn require_can_reduce_risk(env: &Env) -> Result<(), NoetherError> {
    if effective_mode(env) > 1 {
        return Err(NoetherError::Frozen);
    }
    Ok(())
}

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_oracle_adapter(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::OracleAdapter).unwrap()
}

pub fn set_oracle_adapter(env: &Env, oracle: &Address) {
    env.storage().instance().set(&DataKey::OracleAdapter, oracle);
}

pub fn get_vault(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Vault).unwrap()
}

pub fn set_vault(env: &Env, vault: &Address) {
    env.storage().instance().set(&DataKey::Vault, vault);
}

pub fn get_usdc_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::UsdcToken).unwrap()
}

pub fn set_usdc_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::UsdcToken, token);
}

pub fn get_config(env: &Env) -> MarketConfig {
    env.storage().instance().get(&DataKey::Config).unwrap_or_default()
}

pub fn set_config(env: &Env, config: &MarketConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

// ═══════════════════════════════════════════════════════════════════════════
// Persistent Storage - Market State
// ═══════════════════════════════════════════════════════════════════════════

pub fn get_position_counter(env: &Env) -> u64 {
    env.storage().persistent().get(&DataKey::PositionCounter).unwrap_or(0)
}

pub fn set_position_counter(env: &Env, counter: u64) {
    env.storage().persistent().set(&DataKey::PositionCounter, &counter);
    extend_persistent_ttl(env, &DataKey::PositionCounter);
}

pub fn next_position_id(env: &Env) -> u64 {
    let counter = get_position_counter(env);
    let next_id = counter + 1;
    set_position_counter(env, next_id);
    next_id
}

pub fn get_total_long_size(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::TotalLongSize).unwrap_or(0)
}

pub fn set_total_long_size(env: &Env, size: i128) {
    env.storage().persistent().set(&DataKey::TotalLongSize, &size);
    extend_persistent_ttl(env, &DataKey::TotalLongSize);
}

pub fn get_total_short_size(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::TotalShortSize).unwrap_or(0)
}

pub fn set_total_short_size(env: &Env, size: i128) {
    env.storage().persistent().set(&DataKey::TotalShortSize, &size);
    extend_persistent_ttl(env, &DataKey::TotalShortSize);
}

// L0-13: legacy global funding replaced by per-asset FundingState. The
// LastFundingTime/CurrentFundingRate keys are seeded at initialize for
// consistency but no longer read on the funding path; get_last_funding_time
// and set_current_funding_rate were removed as dead.

pub fn set_last_funding_time(env: &Env, time: u64) {
    env.storage().persistent().set(&DataKey::LastFundingTime, &time);
    extend_persistent_ttl(env, &DataKey::LastFundingTime);
}

pub fn get_treasury(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Treasury)
}

pub fn get_referral(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Referral)
}

pub fn set_referral_addr(env: &Env, referral: &Address) {
    env.storage().instance().set(&DataKey::Referral, referral);
}

pub fn set_treasury(env: &Env, treasury: &Address) {
    env.storage().instance().set(&DataKey::Treasury, treasury);
}

pub fn get_protocol_fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::ProtocolFeeBps).unwrap_or(2_000)
}

pub fn set_protocol_fee_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::ProtocolFeeBps, &bps);
}

pub fn get_asset_exposure(env: &Env, asset: &Symbol) -> (i128, i128, i128, i128) {
    env.storage()
        .persistent()
        .get(&DataKey::AssetExposure(asset.clone()))
        .unwrap_or((0, 0, 0, 0))
}

pub fn set_asset_exposure(env: &Env, asset: &Symbol, exposure: &(i128, i128, i128, i128)) {
    let key = DataKey::AssetExposure(asset.clone());
    env.storage().persistent().set(&key, exposure);
    extend_persistent_ttl(env, &key);
}

pub fn get_last_good_price(env: &Env, asset: &Symbol) -> Option<(i128, u64)> {
    env.storage().persistent().get(&DataKey::LastGoodPrice(asset.clone()))
}

pub fn set_last_good_price(env: &Env, asset: &Symbol, price: i128, ts: u64) {
    let key = DataKey::LastGoodPrice(asset.clone());
    env.storage().persistent().set(&key, &(price, ts));
    extend_persistent_ttl(env, &key);
}

pub fn get_cumulative_funding_rate(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::CumulativeFundingRate).unwrap_or(0)
}

pub fn set_cumulative_funding_rate(env: &Env, rate: i128) {
    env.storage().persistent().set(&DataKey::CumulativeFundingRate, &rate);
    extend_persistent_ttl(env, &DataKey::CumulativeFundingRate);
}

// ═══════════════════════════════════════════════════════════════════════════
// Index growth caps (M-5)
// ═══════════════════════════════════════════════════════════════════════════
// The market-wide caps are enforced against O(1) counters
// (OpenPositionCount / OpenOrderCount / OrderCountOf) — the global Vec
// indexes they used to gate were rewritten in full on every insert/delete,
// which made every open pay O(n) and race every concurrent trade on one
// shared entry. Deletes and in-place updates are never gated: closing and
// liquidating always work at cap. All sites reuse
// NoetherError::OpenInterestCapExceeded (#82) — the error enum is at its
// 50-variant budget, and "at capacity" is the message.

/// Max open positions market-wide (OpenPositionCount).
pub const MAX_OPEN_POSITIONS_TOTAL: u32 = 1000;
/// Max open positions per trader, isolated + cross combined (TraderPositions).
/// Transitively bounds CrossMarginPositions — a subset filled on the same
/// insert path — and with it the staged cross-liquidation loop.
pub const MAX_OPEN_POSITIONS_PER_TRADER: u32 = 32;
/// Max pending orders market-wide (OpenOrderCount).
pub const MAX_OPEN_ORDERS_TOTAL: u32 = 2000;
/// Max pending orders per trader (OrderCountOf): 32 positions × 3 protective
/// orders (SL/TP/trailing) leaves 32 slots for resting entries.
pub const MAX_OPEN_ORDERS_PER_TRADER: u32 = 128;

// ═══════════════════════════════════════════════════════════════════════════
// Open counters
// ═══════════════════════════════════════════════════════════════════════════
// Live-market checksums, not id generators (those are PositionCounter and
// OrderCounter, which only ever grow). A contract upgraded in place starts
// with these keys ABSENT while real positions are open, so getters default
// to 0 and every decrement saturates — seed_open_counts must run immediately
// after upgrade() or the counts under-report forever.

pub fn get_open_position_count(env: &Env) -> u32 {
    env.storage().persistent().get(&DataKey::OpenPositionCount).unwrap_or(0)
}

pub fn set_open_position_count(env: &Env, count: u32) {
    env.storage().persistent().set(&DataKey::OpenPositionCount, &count);
    extend_persistent_ttl(env, &DataKey::OpenPositionCount);
}

pub fn get_open_order_count(env: &Env) -> u32 {
    env.storage().persistent().get(&DataKey::OpenOrderCount).unwrap_or(0)
}

pub fn set_open_order_count(env: &Env, count: u32) {
    env.storage().persistent().set(&DataKey::OpenOrderCount, &count);
    extend_persistent_ttl(env, &DataKey::OpenOrderCount);
}

pub fn get_order_count_of(env: &Env, trader: &Address) -> u32 {
    env.storage().persistent().get(&DataKey::OrderCountOf(trader.clone())).unwrap_or(0)
}

pub fn set_order_count_of(env: &Env, trader: &Address, count: u32) {
    let key = DataKey::OrderCountOf(trader.clone());
    env.storage().persistent().set(&key, &count);
    extend_persistent_ttl(env, &key);
}

// ═══════════════════════════════════════════════════════════════════════════
// Position Storage
// ═══════════════════════════════════════════════════════════════════════════

pub fn get_position(env: &Env, id: u64) -> Option<Position> {
    env.storage().persistent().get(&DataKey::Position(id))
}

pub fn save_position(env: &Env, position: &Position) {
    // A row that already exists is an in-place update (add_collateral,
    // partial liquidation): the id is already in TraderPositions and already
    // counted, so only the row itself is rewritten. A position id enters the
    // trader list and the counter on exactly the save that creates its row,
    // and leaves both on exactly the delete that removes it — the row's
    // existence IS the membership test, which is what lets the O(n) global
    // dedup scan disappear.
    let row_key = DataKey::Position(position.id);
    let is_new = !env.storage().persistent().has(&row_key);
    env.storage().persistent().set(&row_key, position);
    extend_position_ttl(env, &row_key);
    if !is_new {
        return;
    }

    // Add to trader's position list (kept: cross-margin aggregation and the
    // staged cross-liquidation loop genuinely read it, and per-trader length
    // is bounded small)
    let trader_key = DataKey::TraderPositions(position.trader.clone());
    let mut trader_positions: Vec<u64> = env.storage()
        .persistent()
        .get(&trader_key)
        .unwrap_or(Vec::new(env));
    if trader_positions.len() >= MAX_OPEN_POSITIONS_PER_TRADER {
        panic_with_error!(env, NoetherError::OpenInterestCapExceeded);
    }
    trader_positions.push_back(position.id);
    env.storage().persistent().set(&trader_key, &trader_positions);
    extend_persistent_ttl(env, &trader_key);

    // Market-wide cap via the O(1) counter (replaces the AllPositions Vec)
    let open = get_open_position_count(env);
    if open >= MAX_OPEN_POSITIONS_TOTAL {
        panic_with_error!(env, NoetherError::OpenInterestCapExceeded);
    }
    set_open_position_count(env, open + 1);
}

pub fn get_partial_liq_ts(env: &Env, position_id: u64) -> Option<u64> {
    env.storage().persistent().get(&DataKey::PartialLiqTs(position_id))
}

pub fn set_partial_liq_ts(env: &Env, position_id: u64, ts: u64) {
    let key = DataKey::PartialLiqTs(position_id);
    env.storage().persistent().set(&key, &ts);
    extend_persistent_ttl(env, &key);
}

pub fn get_cross_partial_liq_ts(env: &Env, trader: &Address) -> Option<u64> {
    env.storage().persistent().get(&DataKey::CrossPartialLiqTs(trader.clone()))
}

pub fn set_cross_partial_liq_ts(env: &Env, trader: &Address, ts: u64) {
    let key = DataKey::CrossPartialLiqTs(trader.clone());
    env.storage().persistent().set(&key, &ts);
    extend_persistent_ttl(env, &key);
}

pub fn remove_cross_partial_liq_ts(env: &Env, trader: &Address) {
    env.storage().persistent().remove(&DataKey::CrossPartialLiqTs(trader.clone()));
}

pub fn get_adl_active(env: &Env, asset: &Symbol) -> bool {
    env.storage().persistent().get(&DataKey::AdlActive(asset.clone())).unwrap_or(false)
}

pub fn set_adl_active(env: &Env, asset: &Symbol, active: bool) {
    let key = DataKey::AdlActive(asset.clone());
    env.storage().persistent().set(&key, &active);
    extend_persistent_ttl(env, &key);
}

/// Write the ADL flag back unchanged when the entry exists — footprint
/// stability for settlement paths that only sometimes flip it. Never creates
/// the entry (no new per-asset ledger entries, no archival exposure).
pub fn touch_adl_active(env: &Env, asset: &Symbol) {
    let key = DataKey::AdlActive(asset.clone());
    if let Some(active) = env.storage().persistent().get::<DataKey, bool>(&key) {
        env.storage().persistent().set(&key, &active);
        extend_persistent_ttl(env, &key);
    }
}

pub fn get_asset_risk(env: &Env, asset: &Symbol) -> Option<AssetRiskParams> {
    env.storage().persistent().get(&DataKey::AssetRisk(asset.clone()))
}

pub fn set_asset_risk(env: &Env, asset: &Symbol, params: &AssetRiskParams) {
    let key = DataKey::AssetRisk(asset.clone());
    env.storage().persistent().set(&key, params);
    extend_persistent_ttl(env, &key);
}

pub fn get_risk_epoch_ts(env: &Env) -> u64 {
    env.storage().persistent().get(&DataKey::RiskEpochTs).unwrap_or(0)
}

pub fn set_risk_epoch_ts(env: &Env, ts: u64) {
    env.storage().persistent().set(&DataKey::RiskEpochTs, &ts);
    extend_persistent_ttl(env, &DataKey::RiskEpochTs);
}

/// Per-asset funding state (L0-13): (cumulative, current_rate, last_ts).
pub fn get_funding_state(env: &Env, asset: &Symbol) -> (i128, i128, u64) {
    env.storage().persistent().get(&DataKey::FundingState(asset.clone())).unwrap_or((0, 0, 0))
}

pub fn set_funding_state(env: &Env, asset: &Symbol, state: &(i128, i128, u64)) {
    let key = DataKey::FundingState(asset.clone());
    env.storage().persistent().set(&key, state);
    extend_persistent_ttl(env, &key);
}

/// Per-asset skew integral (L0-13): (integral, last_touch_ts).
pub fn get_skew_integral(env: &Env, asset: &Symbol) -> (i128, u64) {
    env.storage().persistent().get(&DataKey::SkewIntegral(asset.clone())).unwrap_or((0, 0))
}

pub fn set_skew_integral(env: &Env, asset: &Symbol, v: &(i128, u64)) {
    let key = DataKey::SkewIntegral(asset.clone());
    env.storage().persistent().set(&key, v);
    extend_persistent_ttl(env, &key);
}

pub fn delete_position(env: &Env, id: u64, trader: &Address) {
    // Remove from storage (incl. any partial-liquidation grace marker). The
    // counter decrements only when the row actually existed: no-op deletes
    // are common because auto-netting deletes legs a prior arm already
    // removed, and decrementing on those would drift the count low.
    let row_key = DataKey::Position(id);
    let existed = env.storage().persistent().has(&row_key);
    env.storage().persistent().remove(&row_key);
    env.storage().persistent().remove(&DataKey::PartialLiqTs(id));

    // Remove from trader's list
    let trader_key = DataKey::TraderPositions(trader.clone());
    let trader_positions: Vec<u64> = env.storage()
        .persistent()
        .get(&trader_key)
        .unwrap_or(Vec::new(env));

    // The write below is skipped when the id was not in the list — the
    // rewrite re-serializes the WHOLE Vec, so an unconditional set made every
    // no-op delete pay full price. NOTE: TraderPositions holds BOTH isolated
    // and cross positions (finalize_open calls save_position for every
    // position), and MAX_OPEN_POSITIONS_PER_TRADER is what bounds the cross
    // set — do not assume cross positions live only in CrossMarginPositions.
    let mut new_list = Vec::new(env);
    for i in 0..trader_positions.len() {
        let pos_id = trader_positions.get(i).unwrap();
        if pos_id != id {
            new_list.push_back(pos_id);
        }
    }
    if new_list.len() != trader_positions.len() {
        env.storage().persistent().set(&trader_key, &new_list);
        extend_persistent_ttl(env, &trader_key);
    }

    if existed {
        set_open_position_count(env, get_open_position_count(env).saturating_sub(1));
    }
}

// get_trader_positions removed for WASM size - per-trader reads use
// get_trader_position_ids + get_position; market-wide discovery walks
// Position(id) ledger entries off chain with OpenPositionCount as checksum

pub fn get_trader_position_ids(env: &Env, trader: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::TraderPositions(trader.clone()))
        .unwrap_or(Vec::new(env))
}

// ═══════════════════════════════════════════════════════════════════════════
// Authorization Helpers
// ═══════════════════════════════════════════════════════════════════════════

pub fn require_initialized(env: &Env) -> Result<(), NoetherError> {
    if !is_initialized(env) {
        return Err(NoetherError::NotInitialized);
    }
    // R-1: every live call re-arms the instance rent (no-op above the
    // threshold), so an actively-used contract can never archive.
    extend_instance_ttl(env);
    Ok(())
}

// require_not_paused REMOVED (L0-15) — replaced by require_can_increase_risk
// / require_can_reduce_risk per the two-tier pause matrix.

pub fn require_admin(env: &Env) -> Result<(), NoetherError> {
    require_initialized(env)?;
    let admin = get_admin(env);
    admin.require_auth();
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
// TTL Management
// ═══════════════════════════════════════════════════════════════════════════

use noether_common::ttl::{TTL_EXTEND_TO, TTL_THRESHOLD};

pub fn extend_instance_ttl(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn extend_persistent_ttl(env: &Env, key: &DataKey) {
    env.storage().persistent().extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Position and order DATA entries can sit idle far longer than the shared
/// 30-day window: funding is lazy (no writes refresh their TTL) and a limit
/// order may wait indefinitely for its trigger. A ~150-day window keeps them
/// live to close / liquidate / execute without an intervening restore (audit
/// #12). The per-trader and global INDEX lists keep the standard window —
/// market activity refreshes them. extend_ttl caps at the network max, so an
/// over-large target never traps.
const POSITION_TTL_EXTEND_TO: u32 = 2_592_000; // ~150 days

fn extend_position_ttl(env: &Env, key: &DataKey) {
    env.storage().persistent().extend_ttl(key, TTL_THRESHOLD, POSITION_TTL_EXTEND_TO);
}

// ═══════════════════════════════════════════════════════════════════════════
// Order Storage
// ═══════════════════════════════════════════════════════════════════════════

pub fn get_order_counter(env: &Env) -> u64 {
    env.storage().persistent().get(&DataKey::OrderCounter).unwrap_or(0)
}

pub fn set_order_counter(env: &Env, counter: u64) {
    env.storage().persistent().set(&DataKey::OrderCounter, &counter);
    extend_persistent_ttl(env, &DataKey::OrderCounter);
}

pub fn next_order_id(env: &Env) -> u64 {
    let counter = get_order_counter(env);
    let next_id = counter + 1;
    set_order_counter(env, next_id);
    next_id
}

pub fn get_order(env: &Env, id: u64) -> Option<Order> {
    env.storage().persistent().get(&DataKey::Order(id))
}

pub fn save_order(env: &Env, order: &Order) {
    // The counters track "row exists AND status == Pending", and the write
    // path maintains that invariant by watching the edge between the
    // previous stored status and the incoming one. That makes the accounting
    // structural: a double cancel or an execute after cancel sees
    // was_counted == false and cannot decrement twice, no matter which entry
    // point drove the transition.
    let was_counted = env
        .storage()
        .persistent()
        .get::<DataKey, Order>(&DataKey::Order(order.id))
        .map(|prev| prev.status == OrderStatus::Pending)
        .unwrap_or(false);
    save_order_with_prev(env, order, was_counted);
}

/// The write half of save_order for callers that ALREADY hold the previous
/// row (update_order_status): re-reading a full Order just to learn its old
/// status would double the decode work on the hottest transaction — a close
/// or liquidation bulk-cancelling its attached SL/TP/trailing orders.
fn save_order_with_prev(env: &Env, order: &Order, was_counted: bool) {
    let row_key = DataKey::Order(order.id);
    let now_counted = order.status == OrderStatus::Pending;

    env.storage().persistent().set(&row_key, order);
    extend_position_ttl(env, &row_key);

    if now_counted && !was_counted {
        // Entering the pending set: both caps gate here, reusing #82.
        let per_trader = get_order_count_of(env, &order.trader);
        if per_trader >= MAX_OPEN_ORDERS_PER_TRADER {
            panic_with_error!(env, NoetherError::OpenInterestCapExceeded);
        }
        let total = get_open_order_count(env);
        if total >= MAX_OPEN_ORDERS_TOTAL {
            panic_with_error!(env, NoetherError::OpenInterestCapExceeded);
        }
        set_order_count_of(env, &order.trader, per_trader + 1);
        set_open_order_count(env, total + 1);
    } else if was_counted && !now_counted {
        // Leaving the pending set (executed, cancelled, slippage, expired).
        set_order_count_of(env, &order.trader, get_order_count_of(env, &order.trader).saturating_sub(1));
        set_open_order_count(env, get_open_order_count(env).saturating_sub(1));
    }
}

pub fn update_order_status(env: &Env, order_id: u64, status: OrderStatus) {
    // Single decode: the row read here supplies both the mutated order and
    // its previous counted-ness, so the Pending-edge accounting still has
    // exactly one owner without a second read inside the save.
    if let Some(mut order) = get_order(env, order_id) {
        let was_counted = order.status == OrderStatus::Pending;
        order.status = status;
        save_order_with_prev(env, &order, was_counted);
    }
}

// ── L1-24 per-asset halt ──
pub fn get_asset_halted(env: &Env, asset: &Symbol) -> bool {
    env.storage().persistent().get(&DataKey::AssetHalted(asset.clone())).unwrap_or(false)
}

pub fn set_asset_halted(env: &Env, asset: &Symbol, halted: bool) {
    let key = DataKey::AssetHalted(asset.clone());
    env.storage().persistent().set(&key, &halted);
    extend_persistent_ttl(env, &key);
}

/// L1-30: record a full isolated close's trader-proceeds in TEMPORARY storage
/// so a vault_factory owner can reconcile a keeper-executed protective close to
/// the exact amount (a keeper execution fires no factory call). Temporary =
/// auto-GC'd; the keeper reconciles promptly. Recorded even when 0 (a total
/// loss) so reconcile can distinguish a closed position from an open one.
pub fn record_close_proceeds(env: &Env, position_id: u64, amount: i128) {
    let key = DataKey::ClosedProceeds(position_id);
    env.storage().temporary().set(&key, &amount);
    env.storage().temporary().extend_ttl(&key, 17_280, 34_560); // ~1-2 days
}

pub fn get_close_proceeds(env: &Env, position_id: u64) -> i128 {
    env.storage()
        .temporary()
        .get(&DataKey::ClosedProceeds(position_id))
        .unwrap_or(0)
}

/// Record the position an entry order created on its (persisted) row (L0-20).
/// The row survives execution with its final status, so vault_factory can
/// trustlessly reconcile a leader's executed limit order to its position via
/// market.get_order. No-op if the order row is gone.
pub fn set_order_position_id(env: &Env, order_id: u64, position_id: u64) {
    if let Some(mut order) = get_order(env, order_id) {
        order.position_id = position_id;
        env.storage().persistent().set(&DataKey::Order(order_id), &order);
        extend_position_ttl(env, &DataKey::Order(order_id));
    }
}

// remove_order_from_lists removed with the order Vec indexes — save_order
// owns the Pending-edge counter accounting, and update_order_status routes
// through it

// delete_order removed for WASM size - orders are status-updated, not deleted

// get_trader_orders removed - off-chain discovery walks Order(id) ledger
// entries with OpenOrderCount as checksum; terminal statuses read as absent

// Position SL/TP attachment helpers
pub fn get_position_stop_loss(env: &Env, position_id: u64) -> Option<u64> {
    env.storage().persistent().get(&DataKey::PositionStopLoss(position_id))
}

pub fn set_position_stop_loss(env: &Env, position_id: u64, order_id: u64) {
    env.storage().persistent().set(&DataKey::PositionStopLoss(position_id), &order_id);
    extend_persistent_ttl(env, &DataKey::PositionStopLoss(position_id));
}

pub fn remove_position_stop_loss(env: &Env, position_id: u64) {
    env.storage().persistent().remove(&DataKey::PositionStopLoss(position_id));
}

pub fn get_position_take_profit(env: &Env, position_id: u64) -> Option<u64> {
    env.storage().persistent().get(&DataKey::PositionTakeProfit(position_id))
}

pub fn set_position_take_profit(env: &Env, position_id: u64, order_id: u64) {
    env.storage().persistent().set(&DataKey::PositionTakeProfit(position_id), &order_id);
    extend_persistent_ttl(env, &DataKey::PositionTakeProfit(position_id));
}

pub fn remove_position_take_profit(env: &Env, position_id: u64) {
    env.storage().persistent().remove(&DataKey::PositionTakeProfit(position_id));
}

pub fn get_position_trailing_stop(env: &Env, position_id: u64) -> Option<u64> {
    env.storage().persistent().get(&DataKey::PositionTrailingStop(position_id))
}

pub fn set_position_trailing_stop(env: &Env, position_id: u64, order_id: u64) {
    env.storage().persistent().set(&DataKey::PositionTrailingStop(position_id), &order_id);
    extend_persistent_ttl(env, &DataKey::PositionTrailingStop(position_id));
}

pub fn remove_position_trailing_stop(env: &Env, position_id: u64) {
    env.storage().persistent().remove(&DataKey::PositionTrailingStop(position_id));
}

// ═══════════════════════════════════════════════════════════════════════════
// Fee Tier Storage
// ═══════════════════════════════════════════════════════════════════════════

pub fn get_fee_tiers(env: &Env) -> Vec<FeeTier> {
    env.storage()
        .persistent()
        .get(&DataKey::FeeTiers)
        .unwrap_or(Vec::new(env))
}

pub fn set_fee_tiers(env: &Env, tiers: &Vec<FeeTier>) {
    env.storage().persistent().set(&DataKey::FeeTiers, tiers);
    extend_persistent_ttl(env, &DataKey::FeeTiers);
}

pub fn get_trader_volume(env: &Env, trader: &Address) -> Option<VolumeRecord> {
    env.storage().persistent().get(&DataKey::TraderVolume(trader.clone()))
}

pub fn set_trader_volume(env: &Env, trader: &Address, record: &VolumeRecord) {
    let key = DataKey::TraderVolume(trader.clone());
    env.storage().persistent().set(&key, record);
    extend_persistent_ttl(env, &key);
}

// ═══════════════════════════════════════════════════════════════════════════
// Cross-Margin Storage
// ═══════════════════════════════════════════════════════════════════════════

pub fn get_cross_margin_balance(env: &Env, trader: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::CrossMarginBalance(trader.clone()))
        .unwrap_or(0)
}

pub fn set_cross_margin_balance(env: &Env, trader: &Address, balance: i128) {
    let key = DataKey::CrossMarginBalance(trader.clone());
    env.storage().persistent().set(&key, &balance);
    extend_persistent_ttl(env, &key);
}

pub fn get_cross_margin_position_ids(env: &Env, trader: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::CrossMarginPositions(trader.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn add_cross_margin_position(env: &Env, trader: &Address, position_id: u64) {
    let key = DataKey::CrossMarginPositions(trader.clone());
    let mut ids: Vec<u64> = env.storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(env));

    // Only add if not already present
    let mut found = false;
    for i in 0..ids.len() {
        if ids.get(i).unwrap() == position_id {
            found = true;
            break;
        }
    }
    if !found {
        ids.push_back(position_id);
        env.storage().persistent().set(&key, &ids);
        extend_persistent_ttl(env, &key);
    }
}

pub fn remove_cross_margin_position(env: &Env, trader: &Address, position_id: u64) {
    let key = DataKey::CrossMarginPositions(trader.clone());
    let ids: Vec<u64> = env.storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(env));

    let mut new_ids = Vec::new(env);
    for i in 0..ids.len() {
        let id = ids.get(i).unwrap();
        if id != position_id {
            new_ids.push_back(id);
        }
    }
    env.storage().persistent().set(&key, &new_ids);
    extend_persistent_ttl(env, &key);
}



pub fn get_trailing_stop_peak(env: &Env, order_id: u64) -> Option<i128> {
    env.storage().persistent().get(&DataKey::TrailingStopPeak(order_id))
}

pub fn set_trailing_stop_peak(env: &Env, order_id: u64, peak: i128) {
    let key = DataKey::TrailingStopPeak(order_id);
    env.storage().persistent().set(&key, &peak);
    extend_persistent_ttl(env, &key);
}

pub fn remove_trailing_stop_peak(env: &Env, order_id: u64) {
    env.storage().persistent().remove(&DataKey::TrailingStopPeak(order_id));
}

