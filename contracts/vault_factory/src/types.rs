//! On-chain types for the vault factory.
//!
//! Everything stored in instance / persistent storage flows through
//! these types. The `VaultInfo` struct is the per-vault row; share
//! balances are kept in a separate `(vault_id, depositor)` map.

use soroban_sdk::{contracterror, contracttype, Address, String};

/// Default leader profit share = 10% (in basis points).
pub const DEFAULT_PROFIT_SHARE_BPS: u32 = 1_000;

/// Minimum percentage of total vault NAV the leader must hold themselves
/// (in basis points). 5% = 500 bps.
pub const LEADER_MIN_HOLDING_BPS: u32 = 500;

/// Hard cap on profit share to keep leader incentives sane.
pub const MAX_PROFIT_SHARE_BPS: u32 = 5_000; // 50%

/// 7-decimal fixed-point precision (matches the rest of the protocol).
pub const PRECISION: i128 = 10_000_000;

/// Basis points denominator.
pub const BPS_DENOM: u32 = 10_000;

/// Max concurrent open positions + pending orders a single vault may hold
/// (L0-20). Bounds the full-NAV cross-contract read loop's gas.
pub const MAX_OPEN_PER_VAULT: u32 = 16;

#[contracttype]
#[derive(Clone, Debug)]
pub struct VaultInfo {
    pub id: u32,
    pub leader: Address,
    pub name: String,
    pub created_at: u64,
    /// USDC currently parked in the vault's accounting (deposits minus
    /// withdrawals plus realized PnL).
    pub total_usdc: i128,
    /// Total share supply outstanding across all depositors.
    pub circulating_shares: i128,
    /// High-water mark — NAV per share at the last `claim_leader_fees`
    /// call (or 1.0 at vault creation).
    pub hwm_nav: i128,
    /// Realized PnL from closed positions, accounting only.
    pub realized_pnl: i128,
    /// Leader's own share balance — checked against the 5% invariant
    /// after every `leader_*` call.
    pub leader_shares: i128,
    /// Profit share (basis points) the leader receives above HWM.
    pub profit_share_bps: u32,
    /// If true, deposits/withdrawals are blocked (leader / admin pause).
    pub paused: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum StorageKey {
    /// Singleton — admin address (allowed to globally pause).
    Admin,
    /// Singleton — market contract address (target of leader_* proxy calls).
    Market,
    /// Singleton — USDC token contract address (deposits / withdrawals).
    Usdc,
    /// Singleton — monotonically increasing next vault id.
    NextVaultId,
    /// Per-vault info row.
    Vault(u32),
    /// Depositor share balance for `(vault_id, depositor)`.
    Shares(u32, Address),
    /// Set of all vault ids ever created (for marketplace listing).
    /// Stored as a `Vec<u32>` to keep enumeration cheap.
    VaultList,
    /// Whether `initialize` has been called (one-shot).
    Initialized,
    // ── L0-20: per-vault fund isolation ──
    /// position_id → owning vault id. The market's sole trader is the
    /// factory, so this map is what stops one leader closing another
    /// vault's position.
    PositionVault(u64),
    /// pending order_id → owning vault id (same guard for orders).
    OrderVault(u64),
    /// vault_id → its open position ids (`Vec<u64>`, capped MAX_OPEN_PER_VAULT).
    VaultPositions(u32),
    /// vault_id → its pending order ids (`Vec<u64>`, capped MAX_OPEN_PER_VAULT).
    VaultOrders(u32),
    /// Instance — leader creation allowlist (`Vec<Address>`; empty = permissionless).
    LeaderAllowlist,
    /// Instance — max active vaults (`u32`; 0 = unlimited).
    MaxActiveVaults,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum FactoryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidParameter = 3,
    InvalidName = 4,
    VaultNotFound = 5,
    NotLeader = 6,
    NotAdmin = 7,
    AmountMustBePositive = 8,
    InsufficientShares = 9,
    InsufficientBalance = 10,
    LeaderMinimumViolated = 11,
    Paused = 12,
    Overflow = 13,
    NavCalculationFailed = 14,
    NoFeesToClaim = 15,
    // ── L0-20 ──
    /// A leader op referenced a position/order not owned by its vault.
    NotVaultPosition = 16,
    /// Withdrawal priced fairly at full NAV but exceeds the vault's LIQUID
    /// cash — capital is deployed in open positions; wait for the leader to
    /// free it (a distinct liveness error, never a silent NAV haircut).
    LiquidityDeployed = 17,
    /// Full-NAV valuation could not read a position's equity or an order
    /// (oracle/market failure) — deposits/withdrawals/claims fail-close.
    ValuationUnavailable = 18,
    /// The vault already holds MAX_OPEN_PER_VAULT positions + orders.
    TooManyOpenSlots = 19,
    /// create_vault blocked by the leader allowlist or the max-vaults cap.
    CreationRestricted = 20,
}
