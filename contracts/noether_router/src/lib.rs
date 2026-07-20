//! # Noether Router — atomic verify-then-trade
//!
//! Soroban permits exactly one host-function operation per transaction, so a
//! consumer cannot "prepend" a Noeracle price-update op to its own
//! `open_position` op (the two-operation Pattern A in Noeracle's docs can't be
//! submitted on Stellar). This router collapses both into ONE invocation: it
//! relays a freshly-signed Noeracle price into the oracle's persistent storage,
//! then immediately calls the (untouched) market in the same transaction.
//!
//! Because the market reads price through `oracle_adapter → noeracle_shim →
//! get_price_pers`, it sees the price this router just stored — sub-second
//! fresh at execution time, so it can never trip the market's staleness check
//! (`#30 PriceStale`). The market contract is not modified or redeployed.
//!
//! ## Auth
//!
//! The trader is the transaction source account and authorises the whole call
//! tree (router → market.open_position → USDC transfer) with their normal
//! signature. Unlike `vault_factory` — where the vault's own funds move and the
//! contract must `authorize_as_current_contract` — this router moves none of
//! its own funds, so it needs no auth gymnastics. It is a transparent
//! pass-through; the market remains the real authorisation gate.
//!
//! ## Security
//!
//! The persistent slot is written via Noeracle's HARDENED
//! `update_batch_ed25519_persistent` (S-1 fixed upstream 2026-07-10):
//! Noeracle itself enforces the registered-publisher gate, a 60s staleness
//! bound, and monotonic round_ids (lagging rounds are a silent no-op so a
//! trade is never reverted by cross-consumer ordering). The router's own
//! publisher allowlist (O-2) and coarse price bands (O-7) stay in front of it
//! as defense-in-depth. Requires a Noeracle deployment that exports the
//! hardened entrypoint — the pre-hardening instance does not.
//!
//! ## Stork second source (T3-D1)
//!
//! An optional, admin-enabled dual-source layer: anyone may `relay_stork` a
//! Stork Fast `signed_ecdsa` payload (secp256k1-verified on-chain against
//! the pinned aggregator address), and risk-increasing paths (open,
//! execute) then cross-check the Noeracle attestation against the fresh
//! Stork price — halting opens (#81) on divergence while closes and
//! liquidations stay ungated. Fail-open by design: unconfigured, disabled,
//! or Stork-missing/stale (with `require_fresh` off) all mean the router
//! behaves exactly as single-source.

#![no_std]
// Soroban entry points carrying full oracle attestations exceed clippy's 7-arg heuristic
#![allow(clippy::too_many_arguments)]

use noether_common::{assets::symbol_to_tag, ttl::{TTL_EXTEND_TO, TTL_THRESHOLD}, Direction, NoetherError, Position};
use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, IntoVal, Symbol, Val, Vec,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Market,
    Noeracle,
    Initialized,
    /// Publisher pubkeys whose attestations refresh_price will relay
    Publishers,
    /// Stork second-source configuration (T3-D1); absent = feature off
    Stork,
    /// Stork taxonomy asset_id → Noether 8-byte tag mapping
    StorkAssets,
    /// Last verified Stork price per tag (temporary storage)
    StorkPrice(BytesN<8>),
    /// L1-24: admin-set sanity band (lo, hi) overriding the compiled BANDS
    /// table for one asset — a new pair needs no router redeploy, only a
    /// set_price_band + the shim upgrade() for its tag.
    PriceBand(Symbol),
    /// L0-8 leg (a3): assets whose opens/entry-executions REQUIRE fresh
    /// Stork data (fail-closed #30) even when global require_fresh is off.
    StorkStrictAssets,
    /// L0-8 leg (c): Reflector/SEP-40 divergence-check configuration.
    Reflector,
}

/// Stork second-source configuration (T3-D1). The feature is inert until an
/// admin stores this with `enabled = true` — with it absent or disabled the
/// router behaves exactly as a single-source (Noeracle) deployment.
#[contracttype]
#[derive(Clone)]
pub struct StorkConfig {
    pub enabled: bool,
    /// Strict mode: opens REQUIRE fresh Stork data. Off = fail-open — a
    /// missing/stale Stork price skips the cross-check (the system must
    /// run when Stork doesn't).
    pub require_fresh: bool,
    /// EVM-style address of Stork's aggregator key:
    /// keccak256(uncompressed_pubkey[1..65])[12..32].
    pub signer: BytesN<20>,
    /// Stork Fast taxonomy id this deployment consumes.
    pub taxonomy: u32,
    /// Ignore Stork prices older than this many seconds.
    pub max_age_secs: u64,
    /// Halt opens when |noeracle − stork| exceeds this many bps of stork.
    pub max_dev_bps: u32,
}

/// One verified Stork price (7-decimal fixed point + signing time in ns).
#[contracttype]
#[derive(Clone)]
pub struct StorkPriceEntry {
    pub price: i128,
    pub timestamp_ns: u64,
}

// Stork payload layout (Stork Fast `signed_ecdsa`, all big-endian):
//   [0..64)  signature r ‖ s
//   [64]     recovery byte (0/1 — raw, NOT the EVM +27 form)
//   [65..67) taxonomy id, u16
//   [67..75) timestamp, u64 UNIX NANOSECONDS (one per batch)
//   [75..)   N × (asset_id u16 ‖ quantized_value i128, 10^18-scaled)
// Verification is raw keccak256 over payload[65..] — no EIP-191 prefix.
const STORK_HEADER_LEN: u32 = 75;
const STORK_ENTRY_LEN: u32 = 18;
// 10^18 (Stork quantization) → 10^7 (Noether PRECISION)
const STORK_SCALE_DIVISOR: i128 = 100_000_000_000;
// Temporary-storage TTL for relayed prices (ledgers, ~5s each): entries
// only need to outlive max_age_secs, not rent long-term.
const STORK_TTL_THRESHOLD: u32 = 60;
const STORK_TTL_EXTEND: u32 = 240;

/// One signed Noeracle round for a single asset (L0-8): `prices[i]` is
/// what `pubkeys[i]` signed with `sigs[i]` over the shared
/// (timestamp, round_id) — publishers sign THEIR OWN price and the
/// on-chain median forms at the Noeracle. A single-publisher deployment
/// carries one-element vectors; the shape is quorum-ready without any
/// further ABI change.
#[contracttype]
#[derive(Clone)]
pub struct PriceAttestation {
    pub asset: Symbol,
    pub prices: Vec<i128>,
    pub timestamp: u64,
    pub round_id: u64,
    pub pubkeys: Vec<BytesN<32>>,
    pub sigs: Vec<BytesN<64>>,
}

/// Mirror of the Noeracle quorum entrypoint's PublisherRound (field names
/// must match — UDT map encoding): one publisher's aligned contribution.
#[contracttype]
#[derive(Clone)]
pub struct PublisherRound {
    pub pubkey: BytesN<32>,
    pub prices: Vec<i128>,
    pub sigs: Vec<BytesN<64>>,
}

/// L0-8 leg (c): Reflector (or any SEP-40 feed) as a live divergence
/// check on risk-increasing paths. Inert when absent/disabled.
#[contracttype]
#[derive(Clone)]
pub struct ReflectorConfig {
    pub enabled: bool,
    pub oracle: Address,
    /// The vendor feed's decimals (rescaled to Noether's 7).
    pub decimals: u32,
    /// Ignore vendor prices older than this (Reflector cadence ~5min).
    pub max_age_secs: u64,
    /// Halt opens when |noeracle − vendor| exceeds this many bps.
    pub max_dev_bps: u32,
}

/// SEP-40 call shapes for the divergence leg (field/variant names match
/// the standard so cross-contract decoding works without importing the
/// vendor crate).
#[contracttype]
#[derive(Clone)]
pub enum Sep40Asset {
    Stellar(Address),
    Other(Symbol),
}

#[contracttype]
#[derive(Clone)]
pub struct Sep40PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[contract]
pub struct NoetherRouterContract;

#[contractimpl]
impl NoetherRouterContract {
    /// One-time setup. Records the admin (who can rotate the market /
    /// Noeracle addresses), the market and Noeracle contract addresses,
    /// and the allowed publisher keys — refresh_price relays ONLY
    /// attestations signed by these (O-2: without the allowlist any
    /// trader could self-sign a price and trade against it).
    pub fn initialize(
        env: Env,
        admin: Address,
        market: Address,
        noeracle: Address,
        publishers: Vec<BytesN<32>>,
    ) -> Result<(), NoetherError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(NoetherError::AlreadyInitialized);
        }
        if publishers.is_empty() {
            return Err(NoetherError::InvalidParameter);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Market, &market);
        env.storage().instance().set(&DataKey::Noeracle, &noeracle);
        env.storage().instance().set(&DataKey::Publishers, &publishers);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    /// Verify a freshly-signed Noeracle price, store it, then open a position
    /// against it — atomically, in one transaction.
    ///
    /// `asset` is the market asset symbol (e.g. "BTC"); the 8-byte Noeracle tag
    /// is derived from it, so it must equal the tag the publisher signed (the
    /// canonical `<SYM>USD` form) or the oracle's signature check fails and the
    /// whole transaction reverts. `price` / `timestamp` / `round_id` /
    /// `pubkeys` / `sigs` are the raw fields of one Noeracle attestation.
    pub fn open_with_price(
        env: Env,
        trader: Address,
        collateral: i128,
        leverage: u32,
        direction: Direction,
        acceptable_price: i128,
        att: PriceAttestation,
    ) -> Result<Position, NoetherError> {
        Self::require_initialized(&env)?;
        trader.require_auth();

        Self::refresh_price(&env, &att)?;
        // Second-source cross-checks (Stork + SEP-40/Reflector) against the
        // bundle's median — risk-increasing paths only; closes and
        // liquidations are never gated on either guard.
        let guard_price = Self::median_of(&env, &att.prices);
        Self::stork_guard(&env, &att.asset, guard_price)?;
        Self::sep40_guard(&env, &att.asset, guard_price)?;

        let market = Self::market_addr(&env)?;
        let open_args: Vec<Val> = (
            trader,
            att.asset.clone(),
            collateral,
            leverage,
            direction,
            acceptable_price,
        )
            .into_val(&env);
        let position: Position =
            env.invoke_contract(&market, &Symbol::new(&env, "open_position"), open_args);
        Ok(position)
    }

    /// Verify a freshly-signed Noeracle price for the position's asset, store
    /// it, then close the position against it — atomically. `asset` MUST be the
    /// position's asset (the market reads that asset's oracle price on close).
    /// Returns realised PnL.
    pub fn close_with_price(
        env: Env,
        trader: Address,
        position_id: u64,
        acceptable_price: i128,
        att: PriceAttestation,
    ) -> Result<i128, NoetherError> {
        Self::require_initialized(&env)?;
        trader.require_auth();

        Self::refresh_price(&env, &att)?;

        let market = Self::market_addr(&env)?;
        let close_args: Vec<Val> = (trader, position_id, acceptable_price).into_val(&env);
        let pnl: i128 =
            env.invoke_contract(&market, &Symbol::new(&env, "close_position"), close_args);
        Ok(pnl)
    }

    /// Verify + store a fresh price, then partially close the position
    /// against it (L0-6) — web partial closes get the same fresh-fill path
    /// as full closes. Returns pnl on the closed portion.
    pub fn close_partial_with_price(
        env: Env,
        trader: Address,
        position_id: u64,
        close_size: i128,
        att: PriceAttestation,
    ) -> Result<i128, NoetherError> {
        Self::require_initialized(&env)?;
        trader.require_auth();

        Self::refresh_price(&env, &att)?;

        let market = Self::market_addr(&env)?;
        let args: Vec<Val> = (trader, position_id, close_size).into_val(&env);
        let pnl: i128 =
            env.invoke_contract(&market, &Symbol::new(&env, "close_position_partial"), args);
        Ok(pnl)
    }

    /// Verify + store a fresh price, then liquidate the position against
    /// it — liquidations no longer depend on the heartbeat staying inside
    /// the market's 60s staleness window (O-3/K-3). Returns the keeper
    /// reward.
    pub fn liquidate_with_price(
        env: Env,
        keeper: Address,
        position_id: u64,
        att: PriceAttestation,
    ) -> Result<i128, NoetherError> {
        Self::require_initialized(&env)?;
        keeper.require_auth();

        Self::refresh_price(&env, &att)?;

        let market = Self::market_addr(&env)?;
        let args: Vec<Val> = (keeper, position_id).into_val(&env);
        let reward: i128 = env.invoke_contract(&market, &Symbol::new(&env, "liquidate"), args);
        Ok(reward)
    }

    /// Verify + store a fresh price, then force-realize an ADL candidate
    /// against it in the same tx (L0-1) — forced realizations settle on a
    /// fresh mark rather than a stale lenient-path print. Mirrors
    /// liquidate_with_price. `asset` MUST be the position's asset.
    pub fn adl_with_price(
        env: Env,
        caller: Address,
        position_id: u64,
        att: PriceAttestation,
    ) -> Result<i128, NoetherError> {
        Self::require_initialized(&env)?;
        caller.require_auth();

        Self::refresh_price(&env, &att)?;

        let market = Self::market_addr(&env)?;
        let args: Vec<Val> = (caller, position_id).into_val(&env);
        let realized: i128 = env.invoke_contract(&market, &Symbol::new(&env, "adl_close"), args);
        Ok(realized)
    }

    /// Verify + store a fresh price, then execute the pending order
    /// against it. `asset` MUST be the order's asset. Returns the keeper
    /// fee (0 = order cancelled rather than executed).
    pub fn execute_with_price(
        env: Env,
        keeper: Address,
        order_id: u64,
        att: PriceAttestation,
    ) -> Result<i128, NoetherError> {
        Self::require_initialized(&env)?;
        keeper.require_auth();

        Self::refresh_price(&env, &att)?;
        // Order execution can open/extend exposure, so it gets the same
        // cross-checks as opens (closes/liquidations are never gated).
        let guard_price = Self::median_of(&env, &att.prices);
        Self::stork_guard(&env, &att.asset, guard_price)?;
        Self::sep40_guard(&env, &att.asset, guard_price)?;

        let market = Self::market_addr(&env)?;
        let args: Vec<Val> = (keeper, order_id).into_val(&env);
        let fee: i128 = env.invoke_contract(&market, &Symbol::new(&env, "execute_order"), args);
        Ok(fee)
    }

    /// Refresh EVERY asset the trader holds (one attestation each), then
    /// liquidate the whole cross-margin account — the account-level
    /// equity check reads all of them. Returns the keeper reward.
    pub fn liquidate_cross_with_prices(
        env: Env,
        keeper: Address,
        trader: Address,
        attestations: Vec<PriceAttestation>,
    ) -> Result<i128, NoetherError> {
        Self::require_initialized(&env)?;
        keeper.require_auth();

        for att in attestations.iter() {
            Self::refresh_price(&env, &att)?;
        }

        let market = Self::market_addr(&env)?;
        let args: Vec<Val> = (keeper, trader).into_val(&env);
        let reward: i128 =
            env.invoke_contract(&market, &Symbol::new(&env, "liquidate_cross_account"), args);
        Ok(reward)
    }

    /// Relay one Stork Fast `signed_ecdsa` payload: verify the secp256k1
    /// signature against the configured aggregator address, then store every
    /// mapped asset's price (converted to 7-decimal fixed point) for the
    /// open-path cross-check. Permissionless — validity comes from the
    /// signature, exactly like Noeracle attestation relaying. Returns how
    /// many asset prices were stored (unmapped taxonomy ids are skipped).
    pub fn relay_stork(env: Env, payload: Bytes) -> Result<u32, NoetherError> {
        let cfg: StorkConfig = env
            .storage()
            .instance()
            .get(&DataKey::Stork)
            .ok_or(NoetherError::NotInitialized)?;
        if !cfg.enabled {
            return Err(NoetherError::Unauthorized);
        }

        let len = payload.len();
        if len < STORK_HEADER_LEN + STORK_ENTRY_LEN
            || !(len - STORK_HEADER_LEN).is_multiple_of(STORK_ENTRY_LEN)
        {
            return Err(NoetherError::InvalidParameter);
        }

        // Signature: raw keccak256 over payload[65..], recovery byte 0/1.
        let mut sig = [0u8; 64];
        payload.slice(0..64).copy_into_slice(&mut sig);
        let rid = payload.get(64).ok_or(NoetherError::InvalidParameter)?;
        if rid > 1 {
            return Err(NoetherError::InvalidParameter);
        }
        let digest = env.crypto().keccak256(&payload.slice(65..len));
        let pk = env
            .crypto()
            .secp256k1_recover(&digest, &BytesN::from_array(&env, &sig), rid as u32);
        // EVM address of the recovered key = keccak256(pubkey[1..65])[12..32]
        let pk_bytes: Bytes = pk.into();
        let addr_hash: Bytes = env.crypto().keccak256(&pk_bytes.slice(1..65)).to_bytes().into();
        let mut signer20 = [0u8; 20];
        addr_hash.slice(12..32).copy_into_slice(&mut signer20);
        if BytesN::from_array(&env, &signer20) != cfg.signer {
            return Err(NoetherError::Unauthorized);
        }

        // Header: taxonomy must match; one timestamp covers the batch.
        let mut two = [0u8; 2];
        payload.slice(65..67).copy_into_slice(&mut two);
        if u16::from_be_bytes(two) as u32 != cfg.taxonomy {
            return Err(NoetherError::InvalidParameter);
        }
        let mut eight = [0u8; 8];
        payload.slice(67..75).copy_into_slice(&mut eight);
        let ts_ns = u64::from_be_bytes(eight);
        let now = env.ledger().timestamp();
        if now.saturating_sub(ts_ns / 1_000_000_000) > cfg.max_age_secs {
            return Err(NoetherError::PriceStale);
        }

        let map: Vec<(u32, BytesN<8>)> = env
            .storage()
            .instance()
            .get(&DataKey::StorkAssets)
            .unwrap_or(Vec::new(&env));

        let mut stored: u32 = 0;
        let mut off = STORK_HEADER_LEN;
        while off + STORK_ENTRY_LEN <= len {
            payload.slice(off..off + 2).copy_into_slice(&mut two);
            let id = u16::from_be_bytes(two) as u32;
            let mut sixteen = [0u8; 16];
            payload.slice(off + 2..off + 18).copy_into_slice(&mut sixteen);
            let value = i128::from_be_bytes(sixteen);
            off += STORK_ENTRY_LEN;

            let mut tag: Option<BytesN<8>> = None;
            for pair in map.iter() {
                if pair.0 == id {
                    tag = Some(pair.1.clone());
                    break;
                }
            }
            let Some(tag) = tag else { continue };
            let price = value / STORK_SCALE_DIVISOR;
            if price <= 0 {
                continue;
            }

            // Monotonic per asset (compared in ns): an older relayed payload
            // must never overwrite fresher data. A lagging payload is a
            // silent skip, mirroring Noeracle's round semantics.
            let key = DataKey::StorkPrice(tag);
            let prev: Option<StorkPriceEntry> = env.storage().temporary().get(&key);
            if let Some(prev) = prev {
                if ts_ns <= prev.timestamp_ns {
                    continue;
                }
            }
            env.storage().temporary().set(
                &key,
                &StorkPriceEntry { price, timestamp_ns: ts_ns },
            );
            env.storage()
                .temporary()
                .extend_ttl(&key, STORK_TTL_THRESHOLD, STORK_TTL_EXTEND);
            stored += 1;
        }
        Ok(stored)
    }

    // ───────────────────────────────────────────────────────────────────────
    // Admin
    // ───────────────────────────────────────────────────────────────────────

    /// Store the Stork second-source configuration. Admin-authenticated.
    /// Storing `enabled = false` (or never calling this) keeps the router
    /// single-source: every trade path behaves exactly as before.
    pub fn set_stork_config(env: Env, config: StorkConfig) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        if config.enabled && (config.max_age_secs == 0 || config.max_dev_bps == 0) {
            return Err(NoetherError::InvalidParameter);
        }
        env.storage().instance().set(&DataKey::Stork, &config);
        Ok(())
    }

    /// Replace the Stork taxonomy asset_id → Noether tag mapping (full
    /// replace, parallel vectors). Admin-authenticated.
    pub fn set_stork_assets(
        env: Env,
        ids: Vec<u32>,
        tags: Vec<BytesN<8>>,
    ) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        if ids.len() != tags.len() {
            return Err(NoetherError::InvalidParameter);
        }
        let mut map: Vec<(u32, BytesN<8>)> = Vec::new(&env);
        for i in 0..ids.len() {
            map.push_back((ids.get_unchecked(i), tags.get_unchecked(i)));
        }
        env.storage().instance().set(&DataKey::StorkAssets, &map);
        Ok(())
    }

    /// L0-8: per-asset strict list — assets named here refuse risk-increasing
    /// trades whenever the Stork cross-check cannot run (missing/stale/
    /// unreadable), even if the global `require_fresh` is off. Full replace;
    /// an empty vec clears the list. Admin-authenticated.
    pub fn set_stork_strict_assets(
        env: Env,
        assets: Vec<Symbol>,
    ) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::StorkStrictAssets, &assets);
        Ok(())
    }

    /// L0-8: store the SEP-40/Reflector third-source configuration.
    /// `enabled = false` (or never calling this) keeps the guard inert.
    /// Admin-authenticated.
    pub fn set_reflector_config(
        env: Env,
        config: ReflectorConfig,
    ) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        if config.enabled
            && (config.max_age_secs == 0 || config.max_dev_bps == 0 || config.decimals > 18)
        {
            return Err(NoetherError::InvalidParameter);
        }
        env.storage().instance().set(&DataKey::Reflector, &config);
        Ok(())
    }

    /// Replace the allowed publisher key set. Admin-authenticated.
    pub fn set_publishers(
        env: Env,
        publishers: Vec<BytesN<32>>,
    ) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        if publishers.is_empty() {
            return Err(NoetherError::InvalidParameter);
        }
        env.storage().instance().set(&DataKey::Publishers, &publishers);
        Ok(())
    }

    /// Point the router at a different market deployment. Admin-authenticated.
    pub fn set_market(env: Env, new_market: Address) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::Market, &new_market);
        Ok(())
    }

    /// Point the router at a different Noeracle deployment. Admin-authenticated.
    pub fn set_noeracle(env: Env, new_noeracle: Address) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::Noeracle, &new_noeracle);
        Ok(())
    }

    /// Swap the running WASM in place (admin-gated).
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Rotate the admin. Both old and new admins must sign.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        new_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    /// L1-24: set/override the price sanity band for one asset (admin, 0<lo<hi).
    /// A stored band lets a new pair relay without a router redeploy.
    pub fn set_price_band(env: Env, asset: Symbol, lo: i128, hi: i128) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        if lo <= 0 || hi <= lo {
            return Err(NoetherError::InvalidParameter);
        }
        env.storage().persistent().set(&DataKey::PriceBand(asset.clone()), &(lo, hi));
        env.events().publish((Symbol::new(&env, "price_band_set"), asset), (lo, hi));
        Ok(())
    }

    /// L1-24 view: the stored band override (None = compiled BANDS fallback).
    pub fn get_price_band(env: Env, asset: Symbol) -> Option<(i128, i128)> {
        env.storage().persistent().get(&DataKey::PriceBand(asset))
    }

    // ───────────────────────────────────────────────────────────────────────
    // Views
    // ───────────────────────────────────────────────────────────────────────

    pub fn get_admin(env: Env) -> Result<Address, NoetherError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(NoetherError::NotInitialized)
    }

    pub fn get_market(env: Env) -> Result<Address, NoetherError> {
        Self::market_addr(&env)
    }

    pub fn get_noeracle(env: Env) -> Result<Address, NoetherError> {
        Self::noeracle_addr(&env)
    }

    pub fn get_stork_config(env: Env) -> Option<StorkConfig> {
        env.storage().instance().get(&DataKey::Stork)
    }

    pub fn get_stork_strict_assets(env: Env) -> Option<Vec<Symbol>> {
        env.storage().instance().get(&DataKey::StorkStrictAssets)
    }

    pub fn get_reflector_config(env: Env) -> Option<ReflectorConfig> {
        env.storage().instance().get(&DataKey::Reflector)
    }

    /// Last verified Stork price for a market asset symbol (7-decimal fixed
    /// point + signing time in ns), or None when never relayed / expired.
    /// Consumed by the oracle health surface.
    pub fn get_stork_price(env: Env, asset: Symbol) -> Option<StorkPriceEntry> {
        let tag = symbol_to_tag(&env, &asset).ok()?;
        env.storage().temporary().get(&DataKey::StorkPrice(tag))
    }

    // ───────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ───────────────────────────────────────────────────────────────────────

    /// Relay one signed attestation into Noeracle's persistent storage. The
    /// 8-byte tag is derived from `asset` so it always matches the slot the
    /// `noeracle_shim` will read on the market's behalf. If the derived tag
    /// doesn't match the signed message, Noeracle's signature check fails and
    /// the whole transaction reverts (a safe failure).
    fn refresh_price(env: &Env, att: &PriceAttestation) -> Result<(), NoetherError> {
        // Bundle alignment: prices[i] is what pubkeys[i] signed with
        // sigs[i]. A misaligned bundle is malformed, never relayable.
        let n = att.pubkeys.len();
        if n == 0 || att.sigs.len() != n || att.prices.len() != n {
            return Err(NoetherError::InvalidParameter);
        }

        // Publisher allowlist (O-2): every supplied key must be
        // registered — the router never relays a self-signed price.
        // Defense-in-depth: O-1 hardening in Noeracle itself remains the
        // primary gate.
        let allowed: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&DataKey::Publishers)
            .ok_or(NoetherError::NotInitialized)?;
        for pk in att.pubkeys.iter() {
            if !allowed.contains(&pk) {
                return Err(NoetherError::Unauthorized);
            }
        }

        // Coarse sanity bounds (O-7 backstop) on EVERY submitted price —
        // one garbage publisher price rejects the whole relay.
        let (lo, hi) = price_bounds(env, &att.asset)?;
        for p in att.prices.iter() {
            if p < lo || p > hi {
                return Err(NoetherError::InvalidPrice);
            }
        }

        let noeracle = Self::noeracle_addr(env)?;
        let tag = symbol_to_tag(env, &att.asset)?;
        // L0-8: forward per-publisher rounds to the QUORUM entrypoint —
        // the on-chain MEDIAN becomes the stored price. Noeracle re-checks
        // publisher registration, staleness, quorum count and per-publisher
        // round monotonicity; any failure traps and reverts the whole
        // trade (fail-closed). A single-publisher bundle passes at
        // quorum=1 (the staged-rollout setting).
        let assets: Vec<BytesN<8>> = soroban_sdk::vec![env, tag];
        let mut rounds: Vec<PublisherRound> = Vec::new(env);
        for i in 0..n {
            rounds.push_back(PublisherRound {
                pubkey: att.pubkeys.get_unchecked(i),
                prices: soroban_sdk::vec![env, att.prices.get_unchecked(i)],
                sigs: soroban_sdk::vec![env, att.sigs.get_unchecked(i)],
            });
        }
        let update_args: Vec<Val> =
            (assets, att.timestamp, att.round_id, rounds).into_val(env);
        env.invoke_contract::<()>(
            &noeracle,
            &Symbol::new(env, "update_quorum_ed25519_persistent"),
            update_args,
        );
        Ok(())
    }

    /// Stork second-source cross-check for risk-increasing paths (T3-D1).
    ///
    /// FAIL-OPEN when the feature is unconfigured/disabled, or when Stork
    /// data is missing/stale and `require_fresh` is off — the system must
    /// run without Stork. FAIL-CLOSED when fresh Stork data disagrees with
    /// the Noeracle attestation beyond `max_dev_bps`: two independent
    /// sources disagreeing means one of them is wrong, and opens halt
    /// (#81) until they re-converge. Closes/liquidations never call this.
    fn stork_guard(env: &Env, asset: &Symbol, noeracle_price: i128) -> Result<(), NoetherError> {
        let cfg_opt: Option<StorkConfig> = env.storage().instance().get(&DataKey::Stork);
        let Some(cfg) = cfg_opt else { return Ok(()) };
        if !cfg.enabled {
            return Ok(());
        }

        let tag = symbol_to_tag(env, asset)?;
        let entry: Option<StorkPriceEntry> =
            env.storage().temporary().get(&DataKey::StorkPrice(tag));
        let now = env.ledger().timestamp();
        let fresh = entry
            .as_ref()
            .map(|e| now.saturating_sub(e.timestamp_ns / 1_000_000_000) <= cfg.max_age_secs)
            .unwrap_or(false);
        if !fresh {
            // L0-8 leg (a3): per-asset strictness — majors can be armed
            // fail-closed while unmapped pairs stay fail-open.
            let strict = cfg.require_fresh || {
                let strict_assets: Option<Vec<Symbol>> =
                    env.storage().instance().get(&DataKey::StorkStrictAssets);
                strict_assets.map(|list| list.contains(asset)).unwrap_or(false)
            };
            return if strict {
                Err(NoetherError::PriceStale)
            } else {
                Ok(())
            };
        }

        let stork = entry.unwrap().price;
        let dev_bps = (noeracle_price - stork).abs() * 10_000 / stork;
        if dev_bps > cfg.max_dev_bps as i128 {
            return Err(NoetherError::PriceDeviationTooHigh);
        }
        Ok(())
    }

    /// L0-8 leg (c): SEP-40 (Reflector) divergence check — same policy as
    /// stork_guard: FAIL-OPEN on unconfigured/disabled/read-failure/stale
    /// data, FAIL-CLOSED (#81) on a live divergence beyond max_dev_bps.
    /// Risk-increasing paths only; closes/liquidations never call this.
    fn sep40_guard(env: &Env, asset: &Symbol, noeracle_price: i128) -> Result<(), NoetherError> {
        let cfg_opt: Option<ReflectorConfig> = env.storage().instance().get(&DataKey::Reflector);
        let Some(cfg) = cfg_opt else { return Ok(()) };
        if !cfg.enabled {
            return Ok(());
        }

        let args: Vec<Val> = (Sep40Asset::Other(asset.clone()),).into_val(env);
        let data = match env.try_invoke_contract::<Option<Sep40PriceData>, soroban_sdk::Error>(
            &cfg.oracle,
            &Symbol::new(env, "lastprice"),
            args,
        ) {
            Ok(Ok(Some(d))) => d,
            _ => return Ok(()), // fail-open: vendor unreadable/absent
        };
        let now = env.ledger().timestamp();
        if now.saturating_sub(data.timestamp) > cfg.max_age_secs {
            return Ok(());
        }

        // Rescale vendor decimals → Noether's 7dp.
        let mut vendor = data.price;
        if cfg.decimals > 7 {
            let mut d = cfg.decimals - 7;
            while d > 0 {
                vendor /= 10;
                d -= 1;
            }
        } else if cfg.decimals < 7 {
            let mut d = 7 - cfg.decimals;
            while d > 0 {
                vendor = vendor.saturating_mul(10);
                d -= 1;
            }
        }
        if vendor <= 0 {
            return Ok(());
        }

        let dev_bps = (noeracle_price - vendor).abs() * 10_000 / vendor;
        if dev_bps > cfg.max_dev_bps as i128 {
            return Err(NoetherError::PriceDeviationTooHigh);
        }
        Ok(())
    }

    /// Median of a non-empty price bundle (even count → mean of middles) —
    /// the router-side mirror of the value the Noeracle stores, used as the
    /// reference for the divergence guards.
    fn median_of(env: &Env, prices: &Vec<i128>) -> i128 {
        let mut sorted: Vec<i128> = Vec::new(env);
        for p in prices.iter() {
            let mut idx = sorted.len();
            for i in 0..sorted.len() {
                if p < sorted.get_unchecked(i) {
                    idx = i;
                    break;
                }
            }
            sorted.insert(idx, p);
        }
        let n = sorted.len();
        if n % 2 == 1 {
            sorted.get_unchecked(n / 2)
        } else {
            (sorted.get_unchecked(n / 2 - 1) + sorted.get_unchecked(n / 2)) / 2
        }
    }

    fn market_addr(env: &Env) -> Result<Address, NoetherError> {
        env.storage()
            .instance()
            .get(&DataKey::Market)
            .ok_or(NoetherError::NotInitialized)
    }

    fn noeracle_addr(env: &Env) -> Result<Address, NoetherError> {
        env.storage()
            .instance()
            .get(&DataKey::Noeracle)
            .ok_or(NoetherError::NotInitialized)
    }

    fn require_initialized(env: &Env) -> Result<(), NoetherError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(NoetherError::NotInitialized);
        }
        Ok(())
    }

    fn require_admin(env: &Env) -> Result<(), NoetherError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(NoetherError::NotInitialized)?;
        admin.require_auth();
        Ok(())
    }
}


// Coarse per-asset sanity bands, 7-decimal fixed point. Deliberately
// wide — they only reject obvious garbage, never legitimate volatility.
fn price_bounds(env: &Env, asset: &Symbol) -> Result<(i128, i128), NoetherError> {
    // L1-24: an admin-stored band wins over the compiled table (new pairs +
    // per-asset retuning without a router redeploy).
    if let Some(band) = env
        .storage()
        .persistent()
        .get::<_, (i128, i128)>(&DataKey::PriceBand(asset.clone()))
    {
        return Ok(band);
    }
    const P: i128 = 10_000_000;
    // Coarse sanity bands in 7-dec USD: wide enough to never bind in a real
    // market, tight enough to reject a wildly wrong attestation. Must cover
    // every symbol in noether_common::assets::PAIR_TAGS.
    const BANDS: &[(&str, i128, i128)] = &[
        ("BTC", 1_000 * P, 1_000_000 * P),
        ("ETH", 50 * P, 100_000 * P),
        ("XLM", P / 100, 100 * P),
        ("SOL", P, 100_000 * P),
        ("XRP", P / 100, 1_000 * P),
        ("ADA", P / 100, 1_000 * P),
        ("BNB", 10 * P, 100_000 * P),
        ("TRX", P / 100, 1_000 * P),
        ("HYPE", P / 10, 100_000 * P),
        ("DOGE", P / 1_000, 100 * P),
        ("ZEC", P, 100_000 * P),
        ("LINK", P / 10, 10_000 * P),
        ("BCH", P, 100_000 * P),
        ("LTC", P, 100_000 * P),
    ];
    for (sym, lo, hi) in BANDS {
        if asset == &Symbol::new(env, sym) {
            return Ok((*lo, *hi));
        }
    }
    Err(NoetherError::InvalidPrice)
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use noether_common::PRECISION;
    use soroban_sdk::testutils::Address as _;

    // Mock Noeracle: records the price + tag it was asked to store so tests can
    // assert the router relayed the right values. Accepts any signature (real
    // verification is the live contract's job; we test the router's plumbing).
    mod mock_noeracle {
        use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, BytesN, Env, Vec};

        /// Mirror of the upstream quorum round struct — field names must
        /// match the router's `PublisherRound` for cross-contract UDT decode.
        #[contracttype]
        #[derive(Clone)]
        pub struct PublisherRound {
            pub pubkey: BytesN<32>,
            pub prices: Vec<i128>,
            pub sigs: Vec<BytesN<64>>,
        }

        #[contract]
        pub struct MockNoeracle;

        #[contractimpl]
        impl MockNoeracle {
            pub fn update_quorum_ed25519_persistent(
                env: Env,
                assets: Vec<BytesN<8>>,
                timestamp: u64,
                round_id: u64,
                rounds: Vec<PublisherRound>,
            ) {
                // Median forming is Noeracle's job — the mock just records
                // the first round's prices and the round count so tests can
                // assert the router forwarded the full bundle.
                let first = rounds.get_unchecked(0);
                for i in 0..assets.len() {
                    let asset = assets.get_unchecked(i);
                    let price = first.prices.get_unchecked(i);
                    env.storage().instance().set(&symbol_short!("PRICE"), &price);
                    env.storage().instance().set(&symbol_short!("TAG"), &asset);
                    // per-tag map for multi-asset tests
                    env.storage().instance().set(&asset, &price);
                }
                env.storage()
                    .instance()
                    .set(&symbol_short!("NROUNDS"), &rounds.len());
                let _ = (timestamp, round_id);
            }

            pub fn recorded_price(env: Env) -> i128 {
                env.storage().instance().get(&symbol_short!("PRICE")).unwrap_or(0)
            }

            pub fn recorded_tag(env: Env) -> BytesN<8> {
                env.storage().instance().get(&symbol_short!("TAG")).unwrap()
            }

            pub fn price_for(env: Env, tag: BytesN<8>) -> i128 {
                env.storage().instance().get(&tag).unwrap_or(0)
            }

            pub fn recorded_rounds(env: Env) -> u32 {
                env.storage().instance().get(&symbol_short!("NROUNDS")).unwrap_or(0)
            }
        }
    }

    // Mock Market: returns a recognisable Position / PnL so tests can confirm
    // the router forwarded the trade args and returned the market's result.
    mod mock_market {
        use noether_common::{Direction, Position};
        use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Symbol};

        #[contract]
        pub struct MockMarket;

        #[contractimpl]
        impl MockMarket {
            pub fn open_position(
                env: Env,
                trader: Address,
                asset: Symbol,
                collateral: i128,
                leverage: u32,
                direction: Direction,
                acceptable_price: i128,
            ) -> Position {
                env.storage()
                    .instance()
                    .set(&symbol_short!("ACCEPT"), &acceptable_price);
                Position {
                    id: 777,
                    trader,
                    asset,
                    collateral,
                    size: collateral * (leverage as i128),
                    entry_price: 700_000_000_000_000,
                    direction,
                    leverage,
                    liquidation_price: 0,
                    timestamp: 0,
                    entry_cumulative_funding: 0,
                    margin_mode: 0,
                }
            }

            pub fn close_position(
                env: Env,
                _trader: Address,
                _position_id: u64,
                acceptable_price: i128,
            ) -> i128 {
                env.storage()
                    .instance()
                    .set(&symbol_short!("ACCEPT"), &acceptable_price);
                4_321
            }

            pub fn last_acceptable(env: Env) -> i128 {
                env.storage().instance().get(&symbol_short!("ACCEPT")).unwrap_or(-1)
            }

            pub fn close_position_partial(
                _env: Env, _trader: Address, _position_id: u64, _close_size: i128,
            ) -> i128 {
                2_100
            }

            pub fn liquidate(_env: Env, _keeper: Address, _position_id: u64) -> i128 {
                55
            }

            pub fn execute_order(_env: Env, _keeper: Address, _order_id: u64) -> i128 {
                66
            }

            pub fn liquidate_cross_account(_env: Env, _keeper: Address, _trader: Address) -> i128 {
                77
            }
        }
    }

    // Mock SEP-40 vendor (Reflector stand-in) for the third-source guard.
    // Variant/field names mirror the router's Sep40Asset/Sep40PriceData so
    // the cross-contract UDT decode round-trips.
    mod mock_sep40 {
        use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

        #[contracttype]
        #[derive(Clone)]
        pub enum Asset {
            Stellar(Address),
            Other(Symbol),
        }

        #[contracttype]
        #[derive(Clone)]
        pub struct PriceData {
            pub price: i128,
            pub timestamp: u64,
        }

        #[contract]
        pub struct MockSep40;

        #[contractimpl]
        impl MockSep40 {
            pub fn set(env: Env, asset: Symbol, price: i128, timestamp: u64) {
                env.storage().instance().set(&asset, &PriceData { price, timestamp });
            }

            pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
                match asset {
                    Asset::Other(sym) => env.storage().instance().get(&sym),
                    _ => None,
                }
            }
        }
    }

    fn pubkeys(env: &Env) -> Vec<BytesN<32>> {
        soroban_sdk::vec![env, BytesN::from_array(env, &[7u8; 32])]
    }

    fn sigs(env: &Env) -> Vec<BytesN<64>> {
        soroban_sdk::vec![env, BytesN::from_array(env, &[9u8; 64])]
    }

    /// Single-publisher attestation bundle for the default fixture key.
    fn att(env: &Env, asset: &str, price: i128, timestamp: u64, round_id: u64) -> PriceAttestation {
        PriceAttestation {
            asset: Symbol::new(env, asset),
            prices: soroban_sdk::vec![env, price],
            timestamp,
            round_id,
            pubkeys: pubkeys(env),
            sigs: sigs(env),
        }
    }

    struct Fixture {
        env: Env,
        admin: Address,
        market_id: Address,
        noeracle_id: Address,
        client: NoetherRouterContractClient<'static>,
    }

    fn setup() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let noeracle_id = env.register_contract(None, mock_noeracle::MockNoeracle);
        let market_id = env.register_contract(None, mock_market::MockMarket);
        let router_id = env.register_contract(None, NoetherRouterContract);
        let client = NoetherRouterContractClient::new(&env, &router_id);
        client.initialize(&admin, &market_id, &noeracle_id, &pubkeys(&env));
        Fixture { env, admin, market_id, noeracle_id, client }
    }

    #[test]
    fn set_price_band_override_and_validation() {
        let f = setup();
        let btc = Symbol::new(&f.env, "BTC");
        assert_eq!(f.client.get_price_band(&btc), None); // compiled table by default

        f.client.set_price_band(&btc, &(100 * 10_000_000), &(200 * 10_000_000));
        assert_eq!(
            f.client.get_price_band(&btc),
            Some((100 * 10_000_000, 200 * 10_000_000))
        );
        // Inverted / non-positive bounds rejected.
        assert!(matches!(
            f.client.try_set_price_band(&btc, &(200 * 10_000_000), &(100 * 10_000_000)),
            Err(Ok(NoetherError::InvalidParameter))
        ));
        assert!(matches!(
            f.client.try_set_price_band(&btc, &0, &(100 * 10_000_000)),
            Err(Ok(NoetherError::InvalidParameter))
        ));
    }

    #[test]
    fn initialize_records_addresses() {
        let f = setup();
        assert_eq!(f.client.get_admin(), f.admin);
        assert_eq!(f.client.get_market(), f.market_id);
        assert_eq!(f.client.get_noeracle(), f.noeracle_id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")] // AlreadyInitialized
    fn initialize_twice_errors() {
        let f = setup();
        f.client.initialize(&f.admin, &f.market_id, &f.noeracle_id, &pubkeys(&f.env));
    }

    #[test]
    fn open_with_price_stores_then_opens() {
        let f = setup();
        let price = 70_000 * PRECISION;
        let acceptable = 71_000 * PRECISION;
        let pos = f.client.open_with_price(
            &Address::generate(&f.env),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &acceptable,
            &att(&f.env, "BTC", price, 1_700_000_000, 42),
        );

        // Market result is forwarded through unchanged.
        assert_eq!(pos.id, 777);
        assert_eq!(pos.collateral, 100 * PRECISION);
        assert_eq!(pos.leverage, 5);
        assert_eq!(pos.direction, Direction::Long);

        // The router relayed the price and derived the canonical BTC tag.
        let noeracle = mock_noeracle::MockNoeracleClient::new(&f.env, &f.noeracle_id);
        assert_eq!(noeracle.recorded_price(), price);
        assert_eq!(
            noeracle.recorded_tag(),
            BytesN::from_array(&f.env, &[b'B', b'T', b'C', b'U', b'S', b'D', 0, 0])
        );

        // L0-10: the trader's acceptable_price bound reached the market.
        let market = mock_market::MockMarketClient::new(&f.env, &f.market_id);
        assert_eq!(market.last_acceptable(), acceptable);
    }

    #[test]
    fn close_with_price_stores_then_closes() {
        let f = setup();
        let price = 350_000_000_000i128;
        let acceptable = 340_000_000_000i128;
        let pnl = f.client.close_with_price(
            &Address::generate(&f.env),
            &99u64,
            &acceptable,
            &att(&f.env, "ETH", price, 1_700_000_000, 7),
        );

        assert_eq!(pnl, 4_321);

        let noeracle = mock_noeracle::MockNoeracleClient::new(&f.env, &f.noeracle_id);
        assert_eq!(noeracle.recorded_price(), price);
        assert_eq!(
            noeracle.recorded_tag(),
            BytesN::from_array(&f.env, &[b'E', b'T', b'H', b'U', b'S', b'D', 0, 0])
        );

        // L0-10: the close bound reached the market too.
        let market = mock_market::MockMarketClient::new(&f.env, &f.market_id);
        assert_eq!(market.last_acceptable(), acceptable);
    }

    #[test]
    fn close_partial_with_price_stores_then_reduces() {
        let f = setup();
        let price = 350_000_000_000i128;
        let pnl = f.client.close_partial_with_price(
            &Address::generate(&f.env),
            &99u64,
            &(500_0000000i128), // close_size
            &att(&f.env, "ETH", price, 1_700_000_000, 7),
        );
        assert_eq!(pnl, 2_100); // mock partial-close return
        let noeracle = mock_noeracle::MockNoeracleClient::new(&f.env, &f.noeracle_id);
        assert_eq!(noeracle.recorded_price(), price);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #31)")] // InvalidPrice (unknown asset)
    fn open_with_unknown_asset_errors() {
        let f = setup();
        let _ = f.client.open_with_price(
            &Address::generate(&f.env),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &0i128,
            &att(&f.env, "PEPE", 1i128, 1_700_000_000, 1),
        );
    }

    #[test]
    fn admin_can_rotate_market_and_noeracle() {
        let f = setup();
        let new_market = Address::generate(&f.env);
        let new_noeracle = Address::generate(&f.env);
        f.client.set_market(&new_market);
        f.client.set_noeracle(&new_noeracle);
        assert_eq!(f.client.get_market(), new_market);
        assert_eq!(f.client.get_noeracle(), new_noeracle);
    }

    #[test]
    fn admin_can_rotate_admin() {
        let f = setup();
        let new_admin = Address::generate(&f.env);
        f.client.set_admin(&new_admin);
        assert_eq!(f.client.get_admin(), new_admin);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Publisher allowlist (O-2 / P2-4)
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")] // Unauthorized
    fn foreign_publisher_key_rejected() {
        let f = setup();
        let mut a = att(&f.env, "BTC", 70_000 * PRECISION, 1_700_000_000, 1);
        a.pubkeys = soroban_sdk::vec![&f.env, BytesN::from_array(&f.env, &[42u8; 32])];
        let _ = f.client.open_with_price(
            &Address::generate(&f.env),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &0i128,
            &a,
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")] // InvalidParameter (malformed bundle)
    fn empty_publisher_set_rejected() {
        let f = setup();
        let mut a = att(&f.env, "BTC", 70_000 * PRECISION, 1_700_000_000, 1);
        a.pubkeys = soroban_sdk::vec![&f.env];
        // An empty bundle now fails the alignment check (n == 0) before the
        // allowlist is even consulted — malformed, not merely unauthorized.
        let _ = f.client.open_with_price(
            &Address::generate(&f.env),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &0i128,
            &a,
        );
    }

    #[test]
    fn admin_can_rotate_publishers() {
        let f = setup();
        let new_keys = soroban_sdk::vec![&f.env, BytesN::from_array(&f.env, &[9u8; 32])];
        f.client.set_publishers(&new_keys);
        // Old key now rejected
        let res = f.client.try_open_with_price(
            &Address::generate(&f.env),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &0i128,
            &att(&f.env, "BTC", 70_000 * PRECISION, 1_700_000_000, 1),
        );
        assert!(res.is_err());
    }

    // ═══════════════════════════════════════════════════════════════════
    // Keeper entry points (O-3 / P2-5)
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn liquidate_with_price_stores_then_liquidates() {
        let f = setup();
        let price = 65_000 * PRECISION;
        let reward = f.client.liquidate_with_price(
            &Address::generate(&f.env),
            &7u64,
            &att(&f.env, "BTC", price, 1_700_000_000, 3),
        );
        assert_eq!(reward, 55);
        let noeracle = mock_noeracle::MockNoeracleClient::new(&f.env, &f.noeracle_id);
        assert_eq!(noeracle.recorded_price(), price);
    }

    #[test]
    fn execute_with_price_stores_then_executes() {
        let f = setup();
        let fee = f.client.execute_with_price(
            &Address::generate(&f.env),
            &12u64,
            &att(&f.env, "ETH", 3_000 * PRECISION, 1_700_000_000, 4),
        );
        assert_eq!(fee, 66);
    }

    #[test]
    fn liquidate_cross_with_prices_refreshes_every_asset() {
        let f = setup();
        let atts = soroban_sdk::vec![
            &f.env,
            att(&f.env, "BTC", 64_000 * PRECISION, 1_700_000_000, 5),
            att(&f.env, "XLM", PRECISION / 10, 1_700_000_000, 5),
        ];
        let reward = f.client.liquidate_cross_with_prices(
            &Address::generate(&f.env),
            &Address::generate(&f.env),
            &atts,
        );
        assert_eq!(reward, 77);

        let noeracle = mock_noeracle::MockNoeracleClient::new(&f.env, &f.noeracle_id);
        let btc_tag = BytesN::from_array(&f.env, &[b'B', b'T', b'C', b'U', b'S', b'D', 0, 0]);
        let xlm_tag = BytesN::from_array(&f.env, &[b'X', b'L', b'M', b'U', b'S', b'D', 0, 0]);
        assert_eq!(noeracle.price_for(&btc_tag), 64_000 * PRECISION);
        assert_eq!(noeracle.price_for(&xlm_tag), PRECISION / 10);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Coarse sanity bounds (O-7 / P2-6)
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    #[should_panic(expected = "Error(Contract, #31)")] // InvalidPrice
    fn absurd_price_rejected_even_with_valid_publisher() {
        let f = setup();
        let _ = f.client.open_with_price(
            &Address::generate(&f.env),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &0i128,
            // BTC at $1 — below the 1k floor
            &att(&f.env, "BTC", PRECISION, 1_700_000_000, 1),
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // Stork second source (T3-D1)
    // ═══════════════════════════════════════════════════════════════════

    mod stork_helpers {
        extern crate std;
        use sha3::{Digest, Keccak256};

        pub const TAXONOMY: u16 = 1;

        /// Deterministic test signing key (Stork aggregator stand-in).
        pub fn signing_key() -> k256::ecdsa::SigningKey {
            k256::ecdsa::SigningKey::from_slice(&[0x42u8; 32]).unwrap()
        }

        pub fn rogue_key() -> k256::ecdsa::SigningKey {
            k256::ecdsa::SigningKey::from_slice(&[0x24u8; 32]).unwrap()
        }

        /// EVM-style address of a key: keccak256(uncompressed[1..65])[12..32].
        pub fn signer_evm_addr(sk: &k256::ecdsa::SigningKey) -> [u8; 20] {
            let pk = sk.verifying_key().to_encoded_point(false);
            let hash = Keccak256::digest(&pk.as_bytes()[1..]);
            hash[12..32].try_into().unwrap()
        }

        /// Build a signed Stork Fast payload:
        /// sig(64) ‖ rid(1) ‖ taxonomy(2) ‖ ts_ns(8) ‖ N×(id(2) ‖ value(16)).
        pub fn payload(
            sk: &k256::ecdsa::SigningKey,
            taxonomy: u16,
            ts_ns: u64,
            entries: &[(u16, i128)],
        ) -> std::vec::Vec<u8> {
            let mut tail = std::vec::Vec::new();
            tail.extend_from_slice(&taxonomy.to_be_bytes());
            tail.extend_from_slice(&ts_ns.to_be_bytes());
            for (id, value) in entries {
                tail.extend_from_slice(&id.to_be_bytes());
                tail.extend_from_slice(&value.to_be_bytes());
            }
            let digest = Keccak256::digest(&tail);
            let (sig, rid) = sk.sign_prehash_recoverable(&digest).unwrap();
            let mut out = sig.to_bytes().to_vec();
            out.push(rid.to_byte());
            out.extend_from_slice(&tail);
            out
        }
    }

    use soroban_sdk::testutils::Ledger as _;

    const NS: u64 = 1_000_000_000;
    const STORK_TS: u64 = 1_700_000_000; // seconds
    const E18: i128 = 1_000_000_000_000_000_000;

    /// Enable the Stork layer on the fixture: config + BTC/ETH id mapping.
    /// Returns the aggregator signing key.
    fn enable_stork(f: &Fixture, require_fresh: bool) -> k256::ecdsa::SigningKey {
        let sk = stork_helpers::signing_key();
        f.client.set_stork_config(&StorkConfig {
            enabled: true,
            require_fresh,
            signer: BytesN::from_array(&f.env, &stork_helpers::signer_evm_addr(&sk)),
            taxonomy: stork_helpers::TAXONOMY as u32,
            max_age_secs: 60,
            max_dev_bps: 100, // 1%
        });
        f.client.set_stork_assets(
            &soroban_sdk::vec![&f.env, 0u32, 1u32],
            &soroban_sdk::vec![
                &f.env,
                BytesN::from_array(&f.env, b"BTCUSD\0\0"),
                BytesN::from_array(&f.env, b"ETHUSD\0\0"),
            ],
        );
        sk
    }

    fn open_btc_at(f: &Fixture, noeracle_price: i128) -> Result<Position, NoetherError> {
        f.client
            .try_open_with_price(
                &Address::generate(&f.env),
                &(100 * PRECISION),
                &5,
                &Direction::Long,
                &0i128,
                &att(&f.env, "BTC", noeracle_price, STORK_TS, 1),
            )
            .map_err(|e| e.unwrap())
            .map(|r| r.unwrap())
    }

    #[test]
    fn relay_stork_stores_mapped_assets_at_7dp() {
        let f = setup();
        let sk = enable_stork(&f, false);
        f.env.ledger().set_timestamp(STORK_TS);

        // BTC $70k + ETH $3k at 10^18, plus one unmapped taxonomy id (99).
        let raw = stork_helpers::payload(
            &sk,
            stork_helpers::TAXONOMY,
            STORK_TS * NS,
            &[(0, 70_000 * E18), (1, 3_000 * E18), (99, 70_000 * E18)],
        );
        let stored = f.client.relay_stork(&Bytes::from_slice(&f.env, &raw));
        assert_eq!(stored, 2);

        let btc = f.client.get_stork_price(&Symbol::new(&f.env, "BTC")).unwrap();
        assert_eq!(btc.price, 70_000 * PRECISION);
        assert_eq!(btc.timestamp_ns, STORK_TS * NS);
        let eth = f.client.get_stork_price(&Symbol::new(&f.env, "ETH")).unwrap();
        assert_eq!(eth.price, 3_000 * PRECISION);
    }

    #[test]
    fn relay_stork_rejects_wrong_signer() {
        let f = setup();
        let _ = enable_stork(&f, false);
        f.env.ledger().set_timestamp(STORK_TS);

        let raw = stork_helpers::payload(
            &stork_helpers::rogue_key(),
            stork_helpers::TAXONOMY,
            STORK_TS * NS,
            &[(0, 70_000 * E18)],
        );
        let res = f.client.try_relay_stork(&Bytes::from_slice(&f.env, &raw));
        assert_eq!(res, Err(Ok(NoetherError::Unauthorized)));
        assert!(f.client.get_stork_price(&Symbol::new(&f.env, "BTC")).is_none());
    }

    #[test]
    fn relay_stork_rejects_stale_payload() {
        let f = setup();
        let sk = enable_stork(&f, false);
        f.env.ledger().set_timestamp(STORK_TS + 120); // 2 min past signing

        let raw = stork_helpers::payload(
            &sk,
            stork_helpers::TAXONOMY,
            STORK_TS * NS,
            &[(0, 70_000 * E18)],
        );
        let res = f.client.try_relay_stork(&Bytes::from_slice(&f.env, &raw));
        assert_eq!(res, Err(Ok(NoetherError::PriceStale)));
    }

    #[test]
    fn relay_stork_rejects_wrong_taxonomy() {
        let f = setup();
        let sk = enable_stork(&f, false);
        f.env.ledger().set_timestamp(STORK_TS);

        let raw = stork_helpers::payload(&sk, 7, STORK_TS * NS, &[(0, 70_000 * E18)]);
        let res = f.client.try_relay_stork(&Bytes::from_slice(&f.env, &raw));
        assert_eq!(res, Err(Ok(NoetherError::InvalidParameter)));
    }

    #[test]
    fn relay_stork_rejects_malformed_length() {
        let f = setup();
        let _ = enable_stork(&f, false);
        let res = f
            .client
            .try_relay_stork(&Bytes::from_slice(&f.env, &[0u8; 80]));
        assert_eq!(res, Err(Ok(NoetherError::InvalidParameter)));
    }

    #[test]
    fn relay_stork_disabled_rejects_relays_but_opens_work() {
        let f = setup();
        let sk = stork_helpers::signing_key();
        f.client.set_stork_config(&StorkConfig {
            enabled: false,
            require_fresh: true, // must be irrelevant while disabled
            signer: BytesN::from_array(&f.env, &stork_helpers::signer_evm_addr(&sk)),
            taxonomy: stork_helpers::TAXONOMY as u32,
            max_age_secs: 60,
            max_dev_bps: 100,
        });
        f.env.ledger().set_timestamp(STORK_TS);

        let raw = stork_helpers::payload(
            &sk,
            stork_helpers::TAXONOMY,
            STORK_TS * NS,
            &[(0, 70_000 * E18)],
        );
        let res = f.client.try_relay_stork(&Bytes::from_slice(&f.env, &raw));
        assert_eq!(res, Err(Ok(NoetherError::Unauthorized)));

        // The guard is inert too: opens behave single-source.
        let pos = open_btc_at(&f, 70_000 * PRECISION).unwrap();
        assert_eq!(pos.id, 777);
    }

    #[test]
    fn relay_stork_older_payload_is_silent_skip() {
        let f = setup();
        let sk = enable_stork(&f, false);
        f.env.ledger().set_timestamp(STORK_TS);

        let newer = stork_helpers::payload(
            &sk,
            stork_helpers::TAXONOMY,
            STORK_TS * NS,
            &[(0, 70_000 * E18)],
        );
        assert_eq!(f.client.relay_stork(&Bytes::from_slice(&f.env, &newer)), 1);

        // An older (but still unexpired) payload must not overwrite.
        let older = stork_helpers::payload(
            &sk,
            stork_helpers::TAXONOMY,
            (STORK_TS - 10) * NS,
            &[(0, 60_000 * E18)],
        );
        assert_eq!(f.client.relay_stork(&Bytes::from_slice(&f.env, &older)), 0);

        let btc = f.client.get_stork_price(&Symbol::new(&f.env, "BTC")).unwrap();
        assert_eq!(btc.price, 70_000 * PRECISION);
    }

    #[test]
    fn stork_guard_blocks_divergent_open() {
        let f = setup();
        let sk = enable_stork(&f, false);
        f.env.ledger().set_timestamp(STORK_TS);

        let raw = stork_helpers::payload(
            &sk,
            stork_helpers::TAXONOMY,
            STORK_TS * NS,
            &[(0, 70_000 * E18)],
        );
        f.client.relay_stork(&Bytes::from_slice(&f.env, &raw));

        // Noeracle attestation 3% above Stork — far over the 1% band.
        let res = open_btc_at(&f, 72_100 * PRECISION);
        assert!(matches!(res, Err(NoetherError::PriceDeviationTooHigh)));
    }

    #[test]
    fn stork_guard_allows_open_within_band() {
        let f = setup();
        let sk = enable_stork(&f, false);
        f.env.ledger().set_timestamp(STORK_TS);

        let raw = stork_helpers::payload(
            &sk,
            stork_helpers::TAXONOMY,
            STORK_TS * NS,
            &[(0, 70_000 * E18)],
        );
        f.client.relay_stork(&Bytes::from_slice(&f.env, &raw));

        // 0.5% divergence — inside the 1% band.
        let pos = open_btc_at(&f, 70_350 * PRECISION).unwrap();
        assert_eq!(pos.id, 777);
    }

    #[test]
    fn stork_missing_data_fails_open_by_default() {
        let f = setup();
        let _ = enable_stork(&f, false);
        f.env.ledger().set_timestamp(STORK_TS);

        // Nothing relayed: fail-open — the system must run without Stork.
        let pos = open_btc_at(&f, 70_000 * PRECISION).unwrap();
        assert_eq!(pos.id, 777);
    }

    #[test]
    fn stork_stale_data_does_not_veto_by_default() {
        let f = setup();
        let sk = enable_stork(&f, false);
        f.env.ledger().set_timestamp(STORK_TS);

        let raw = stork_helpers::payload(
            &sk,
            stork_helpers::TAXONOMY,
            STORK_TS * NS,
            &[(0, 60_000 * E18)],
        );
        f.client.relay_stork(&Bytes::from_slice(&f.env, &raw));

        // 2 minutes later the Stork entry is stale (max_age 60s): a wildly
        // divergent open must NOT be vetoed by expired data.
        f.env.ledger().set_timestamp(STORK_TS + 120);
        let pos = open_btc_at(&f, 70_000 * PRECISION).unwrap();
        assert_eq!(pos.id, 777);
    }

    #[test]
    fn stork_require_fresh_blocks_open_without_data() {
        let f = setup();
        let _ = enable_stork(&f, true); // strict dual-source mode
        f.env.ledger().set_timestamp(STORK_TS);

        let res = open_btc_at(&f, 70_000 * PRECISION);
        assert!(matches!(res, Err(NoetherError::PriceStale)));
    }

    #[test]
    fn close_never_gated_by_stork() {
        let f = setup();
        let _ = enable_stork(&f, true); // strict mode, and NO Stork data
        f.env.ledger().set_timestamp(STORK_TS);

        // Closes must always work regardless of Stork state.
        let pnl = f.client.close_with_price(
            &Address::generate(&f.env),
            &99u64,
            &0i128,
            &att(&f.env, "ETH", 3_000 * PRECISION, STORK_TS, 7),
        );
        assert_eq!(pnl, 4_321);
    }

    // ═══════════════════════════════════════════════════════════════════
    // L0-8: quorum bundles (multi-publisher attestations)
    // ═══════════════════════════════════════════════════════════════════

    /// Two-publisher bundle for BTC: registers both keys, then builds an
    /// aligned (prices, pubkeys, sigs) attestation.
    fn quorum_att_btc(f: &Fixture, p1: i128, p2: i128) -> PriceAttestation {
        let k1 = BytesN::from_array(&f.env, &[7u8; 32]);
        let k2 = BytesN::from_array(&f.env, &[8u8; 32]);
        f.client
            .set_publishers(&soroban_sdk::vec![&f.env, k1.clone(), k2.clone()]);
        PriceAttestation {
            asset: Symbol::new(&f.env, "BTC"),
            prices: soroban_sdk::vec![&f.env, p1, p2],
            timestamp: STORK_TS,
            round_id: 42,
            pubkeys: soroban_sdk::vec![&f.env, k1, k2],
            sigs: soroban_sdk::vec![
                &f.env,
                BytesN::from_array(&f.env, &[9u8; 64]),
                BytesN::from_array(&f.env, &[10u8; 64]),
            ],
        }
    }

    #[test]
    fn multi_publisher_bundle_forwards_all_rounds() {
        let f = setup();
        let a = quorum_att_btc(&f, 70_000 * PRECISION, 70_200 * PRECISION);
        let pos = f.client.open_with_price(
            &Address::generate(&f.env),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &0i128,
            &a,
        );
        assert_eq!(pos.id, 777);

        // One PublisherRound per publisher reached Noeracle's quorum
        // entrypoint — the median forms there, not in the router.
        let noeracle = mock_noeracle::MockNoeracleClient::new(&f.env, &f.noeracle_id);
        assert_eq!(noeracle.recorded_rounds(), 2);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")] // InvalidParameter
    fn misaligned_bundle_rejected() {
        let f = setup();
        let mut a = att(&f.env, "BTC", 70_000 * PRECISION, 1_700_000_000, 1);
        // Two prices signed by one key: malformed, never relayable.
        a.prices = soroban_sdk::vec![&f.env, 70_000 * PRECISION, 70_100 * PRECISION];
        let _ = f.client.open_with_price(
            &Address::generate(&f.env),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &0i128,
            &a,
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #31)")] // InvalidPrice
    fn one_out_of_band_price_rejects_whole_bundle() {
        let f = setup();
        // Second publisher claims BTC at $1 — the whole relay dies, even
        // though the first price is sane.
        let a = quorum_att_btc(&f, 70_000 * PRECISION, PRECISION);
        let _ = f.client.open_with_price(
            &Address::generate(&f.env),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &0i128,
            &a,
        );
    }

    #[test]
    fn stork_guard_checks_bundle_median() {
        let f = setup();
        let sk = enable_stork(&f, false);
        f.env.ledger().set_timestamp(STORK_TS);
        let raw = stork_helpers::payload(
            &sk,
            stork_helpers::TAXONOMY,
            STORK_TS * NS,
            &[(0, 70_000 * E18)],
        );
        f.client.relay_stork(&Bytes::from_slice(&f.env, &raw));

        // Prices [70_000, 74_200]: median 72_100 is 3% over Stork's 70_000
        // (1% band) — the guard must judge the MEDIAN, not the first price.
        let a = quorum_att_btc(&f, 70_000 * PRECISION, 74_200 * PRECISION);
        let res = f.client.try_open_with_price(
            &Address::generate(&f.env),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &0i128,
            &a,
        );
        assert!(matches!(res, Err(Ok(NoetherError::PriceDeviationTooHigh))));
    }

    // ═══════════════════════════════════════════════════════════════════
    // L0-8: per-asset Stork strictness
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn strict_asset_blocks_open_when_stork_dark_but_others_pass() {
        let f = setup();
        let _ = enable_stork(&f, false); // globally fail-open
        f.client
            .set_stork_strict_assets(&soroban_sdk::vec![&f.env, Symbol::new(&f.env, "BTC")]);
        f.env.ledger().set_timestamp(STORK_TS);

        // BTC is strict: no Stork data → risk-increasing open blocked.
        let res = open_btc_at(&f, 70_000 * PRECISION);
        assert!(matches!(res, Err(NoetherError::PriceStale)));

        // ETH is not on the strict list: same darkness, open passes.
        let pos = f.client.open_with_price(
            &Address::generate(&f.env),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &0i128,
            &att(&f.env, "ETH", 3_000 * PRECISION, STORK_TS, 1),
        );
        assert_eq!(pos.id, 777);

        // Clearing the list restores fail-open for BTC.
        f.client.set_stork_strict_assets(&soroban_sdk::vec![&f.env]);
        let pos = open_btc_at(&f, 70_000 * PRECISION).unwrap();
        assert_eq!(pos.id, 777);
    }

    #[test]
    fn strict_asset_never_gates_closes() {
        let f = setup();
        let _ = enable_stork(&f, false);
        f.client
            .set_stork_strict_assets(&soroban_sdk::vec![&f.env, Symbol::new(&f.env, "BTC")]);
        f.env.ledger().set_timestamp(STORK_TS);

        let pnl = f.client.close_with_price(
            &Address::generate(&f.env),
            &99u64,
            &0i128,
            &att(&f.env, "BTC", 70_000 * PRECISION, STORK_TS, 7),
        );
        assert_eq!(pnl, 4_321);
    }

    // ═══════════════════════════════════════════════════════════════════
    // L0-8: SEP-40 (Reflector) third source
    // ═══════════════════════════════════════════════════════════════════

    const E14: i128 = 100_000_000_000_000; // Reflector testnet ships 14dp

    fn enable_reflector(f: &Fixture, decimals: u32) -> Address {
        let oracle = f.env.register_contract(None, mock_sep40::MockSep40);
        f.client.set_reflector_config(&ReflectorConfig {
            enabled: true,
            oracle: oracle.clone(),
            decimals,
            max_age_secs: 300,
            max_dev_bps: 100, // 1%
        });
        oracle
    }

    #[test]
    fn reflector_divergence_blocks_open_within_band_passes() {
        let f = setup();
        let oracle = enable_reflector(&f, 14);
        f.env.ledger().set_timestamp(STORK_TS);
        let sep = mock_sep40::MockSep40Client::new(&f.env, &oracle);
        sep.set(&Symbol::new(&f.env, "BTC"), &(70_000 * E14), &STORK_TS);

        // 3% over the vendor price — blocked (#81) despite valid sigs.
        let res = open_btc_at(&f, 72_100 * PRECISION);
        assert!(matches!(res, Err(NoetherError::PriceDeviationTooHigh)));

        // 0.5% divergence — inside the 1% band, passes (also proves the
        // 14dp → 7dp rescale is right; a decimals bug would be ~10^7 off).
        let pos = open_btc_at(&f, 70_350 * PRECISION).unwrap();
        assert_eq!(pos.id, 777);
    }

    #[test]
    fn reflector_fails_open_on_missing_stale_or_disabled() {
        let f = setup();
        let oracle = enable_reflector(&f, 14);
        f.env.ledger().set_timestamp(STORK_TS);

        // (a) vendor has no data at all → open passes.
        let pos = open_btc_at(&f, 70_000 * PRECISION).unwrap();
        assert_eq!(pos.id, 777);

        // (b) vendor data stale (10 min old vs 300s max) → a divergent
        // open must NOT be vetoed by expired data.
        let sep = mock_sep40::MockSep40Client::new(&f.env, &oracle);
        sep.set(&Symbol::new(&f.env, "BTC"), &(60_000 * E14), &(STORK_TS - 600));
        let pos = open_btc_at(&f, 70_000 * PRECISION).unwrap();
        assert_eq!(pos.id, 777);

        // (c) fresh divergent data but the guard is disabled → ignored.
        sep.set(&Symbol::new(&f.env, "BTC"), &(60_000 * E14), &STORK_TS);
        f.client.set_reflector_config(&ReflectorConfig {
            enabled: false,
            oracle: oracle.clone(),
            decimals: 14,
            max_age_secs: 300,
            max_dev_bps: 100,
        });
        let pos = open_btc_at(&f, 70_000 * PRECISION).unwrap();
        assert_eq!(pos.id, 777);
    }

    #[test]
    fn reflector_config_validation() {
        let f = setup();
        let oracle = Address::generate(&f.env);
        // Enabled with a zero freshness window: rejected.
        assert!(f
            .client
            .try_set_reflector_config(&ReflectorConfig {
                enabled: true,
                oracle: oracle.clone(),
                decimals: 14,
                max_age_secs: 0,
                max_dev_bps: 100,
            })
            .is_err());
        // Absurd decimals: rejected.
        assert!(f
            .client
            .try_set_reflector_config(&ReflectorConfig {
                enabled: true,
                oracle: oracle.clone(),
                decimals: 19,
                max_age_secs: 300,
                max_dev_bps: 100,
            })
            .is_err());
        // Disabled config stores without validation of the live fields.
        f.client.set_reflector_config(&ReflectorConfig {
            enabled: false,
            oracle,
            decimals: 0,
            max_age_secs: 0,
            max_dev_bps: 0,
        });
        assert!(!f.client.get_reflector_config().unwrap().enabled);
    }
}
