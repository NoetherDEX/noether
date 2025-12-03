#![no_std]
use noether_common::{Asset, Direction, Error, Position};
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token::TokenClient, Address, Env, Symbol,
};

// ============================================================================
// Cross-Contract Client Definitions
// ============================================================================

// Vault contract client - manually defined interface
mod vault_client {
    use soroban_sdk::{contractclient, Env};

    #[contractclient(name = "VaultClient")]
    #[allow(dead_code)]
    pub trait VaultInterface {
        fn withdraw_trader_pnl(env: Env, to: soroban_sdk::Address, amount: i128);
    }
}

// Oracle contract client - manually defined interface
mod oracle_client {
    use noether_common::Asset;
    use soroban_sdk::{contractclient, Env};

    #[contractclient(name = "OracleClient")]
    #[allow(dead_code)]
    pub trait OracleInterface {
        fn get_price(env: Env, asset: Asset) -> i128;
    }
}

use oracle_client::OracleClient;
use vault_client::VaultClient;

// ============================================================================
// Storage Keys
// ============================================================================

const VAULT_ADDR: Symbol = symbol_short!("VAULT");
const ORACLE_ADDR: Symbol = symbol_short!("ORACLE");
const USDC_TOKEN: Symbol = symbol_short!("USDC");
const ADMIN: Symbol = symbol_short!("ADMIN");
const INIT: Symbol = symbol_short!("INIT");

/// Storage keys for persistent data
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Position(Address, Asset),
    TotalOpenInterestLong(Asset),
    TotalOpenInterestShort(Asset),
    FundingIndex(Asset),
}

// ============================================================================
// Constants
// ============================================================================

/// Maximum leverage (10x = 1000 basis points where 100 = 1x)
const MAX_LEVERAGE_BPS: i128 = 1000;

/// Precision for calculations (7 decimals - Stellar standard)
const PRECISION: i128 = 10_000_000;

/// Funding rate precision
const FUNDING_PRECISION: i128 = 1_000_000;

// ============================================================================
// Market Contract (Trading Engine)
// ============================================================================

#[contract]
pub struct NoetherMarket;

#[contractimpl]
impl NoetherMarket {
    /// Initialize the market contract
    pub fn initialize(
        env: Env,
        admin: Address,
        vault: Address,
        oracle: Address,
        usdc_token: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&INIT) {
            return Err(Error::AlreadyInitialized);
        }

        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&VAULT_ADDR, &vault);
        env.storage().instance().set(&ORACLE_ADDR, &oracle);
        env.storage().instance().set(&USDC_TOKEN, &usdc_token);
        env.storage().instance().set(&INIT, &true);

        // Initialize open interest for each asset
        env.storage()
            .persistent()
            .set(&DataKey::TotalOpenInterestLong(Asset::Stellar), &0_i128);
        env.storage()
            .persistent()
            .set(&DataKey::TotalOpenInterestShort(Asset::Stellar), &0_i128);
        env.storage()
            .persistent()
            .set(&DataKey::TotalOpenInterestLong(Asset::USDC), &0_i128);
        env.storage()
            .persistent()
            .set(&DataKey::TotalOpenInterestShort(Asset::USDC), &0_i128);

        // Initialize funding indices
        env.storage()
            .persistent()
            .set(&DataKey::FundingIndex(Asset::Stellar), &0_i128);
        env.storage()
            .persistent()
            .set(&DataKey::FundingIndex(Asset::USDC), &0_i128);

        Ok(())
    }

    /// Open a trading position
    /// Requires user authorization
    pub fn open_position(
        env: Env,
        user: Address,
        asset: Asset,
        collateral: i128,
        size_delta: i128,
        direction: Direction,
    ) -> Result<Position, Error> {
        // 1. Require user authorization
        user.require_auth();

        if collateral <= 0 || size_delta <= 0 {
            return Err(Error::InvalidInput);
        }

        // 2. Get entry price from oracle (REAL cross-contract call)
        let entry_price = Self::get_oracle_price(&env, asset)?;

        // 3. Leverage check: (size_delta * 100) / collateral <= MaxLeverage
        let leverage_bps = (size_delta * 100) / collateral;
        if leverage_bps > MAX_LEVERAGE_BPS {
            return Err(Error::OverLeveraged);
        }

        // 4. Get contract addresses
        let usdc_token: Address = env
            .storage()
            .instance()
            .get(&USDC_TOKEN)
            .ok_or(Error::NotInitialized)?;
        let vault_addr: Address = env
            .storage()
            .instance()
            .get(&VAULT_ADDR)
            .ok_or(Error::NotInitialized)?;

        // 5. Transfer collateral from user to vault (REAL token transfer)
        let token_client = TokenClient::new(&env, &usdc_token);
        token_client.transfer(&user, &vault_addr, &collateral);

        // 6. Load or create position
        let position_key = DataKey::Position(user.clone(), asset);
        let existing_position: Option<Position> = env.storage().persistent().get(&position_key);

        let position = match existing_position {
            Some(mut pos) => {
                // Existing position - must be same direction
                if pos.direction != direction {
                    return Err(Error::InvalidInput);
                }

                // Average entry price calculation
                let total_cost = (pos.entry_price * pos.size) + (entry_price * size_delta);
                pos.size += size_delta;
                pos.entry_price = total_cost / pos.size;
                pos.collateral += collateral;

                // Update liquidation price
                pos.liquidation_price = Self::calculate_liquidation_price(
                    pos.entry_price,
                    pos.collateral,
                    pos.size,
                    &pos.direction,
                );
                pos
            }
            None => {
                // New position
                let liquidation_price = Self::calculate_liquidation_price(
                    entry_price,
                    collateral,
                    size_delta,
                    &direction,
                );

                Position {
                    owner: user.clone(),
                    asset,
                    direction: direction.clone(),
                    collateral,
                    size: size_delta,
                    entry_price,
                    liquidation_price,
                }
            }
        };

        // 7. Save position to storage
        env.storage().persistent().set(&position_key, &position);

        // 8. Update total open interest
        match direction {
            Direction::Long => {
                let current_oi: i128 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::TotalOpenInterestLong(asset))
                    .unwrap_or(0);
                env.storage().persistent().set(
                    &DataKey::TotalOpenInterestLong(asset),
                    &(current_oi + size_delta),
                );
            }
            Direction::Short => {
                let current_oi: i128 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::TotalOpenInterestShort(asset))
                    .unwrap_or(0);
                env.storage().persistent().set(
                    &DataKey::TotalOpenInterestShort(asset),
                    &(current_oi + size_delta),
                );
            }
        }

        // 9. Update funding rate
        Self::update_funding_rate(&env, asset)?;

        Ok(position)
    }

    /// Close a trading position
    /// Requires user authorization
    pub fn close_position(env: Env, user: Address, asset: Asset) -> Result<i128, Error> {
        // 1. Require user authorization
        user.require_auth();

        // 2. Load position
        let position_key = DataKey::Position(user.clone(), asset);
        let position: Position = env
            .storage()
            .persistent()
            .get(&position_key)
            .ok_or(Error::InvalidInput)?;

        // Verify ownership
        if position.owner != user {
            return Err(Error::Unauthorized);
        }

        // 3. Get exit price from oracle (REAL cross-contract call)
        let exit_price = Self::get_oracle_price(&env, asset)?;

        // 4. Calculate PnL based on direction
        let pnl = match position.direction {
            Direction::Long => {
                // Long: profit when exit > entry
                // pnl = (exit_price - entry_price) * size / PRECISION
                ((exit_price - position.entry_price) * position.size) / PRECISION
            }
            Direction::Short => {
                // Short: profit when entry > exit
                // pnl = (entry_price - exit_price) * size / PRECISION
                ((position.entry_price - exit_price) * position.size) / PRECISION
            }
        };

        // 5. Calculate settlement amount
        let settlement_amount = if pnl > 0 {
            // Profit: return collateral + profit
            position.collateral + pnl
        } else if pnl < 0 && pnl.abs() < position.collateral {
            // Loss but not liquidated: return collateral - loss
            position.collateral + pnl // pnl is negative
        } else {
            // Liquidated: return nothing
            0
        };

        // 6. Get vault address
        let vault_addr: Address = env
            .storage()
            .instance()
            .get(&VAULT_ADDR)
            .ok_or(Error::NotInitialized)?;

        // 7. Withdraw settlement from vault using REAL cross-contract call
        if settlement_amount > 0 {
            let vault_client = VaultClient::new(&env, &vault_addr);
            vault_client.withdraw_trader_pnl(&user, &settlement_amount);
        }

        // 8. Update open interest
        match position.direction {
            Direction::Long => {
                let current_oi: i128 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::TotalOpenInterestLong(asset))
                    .unwrap_or(0);
                let new_oi = (current_oi - position.size).max(0);
                env.storage()
                    .persistent()
                    .set(&DataKey::TotalOpenInterestLong(asset), &new_oi);
            }
            Direction::Short => {
                let current_oi: i128 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::TotalOpenInterestShort(asset))
                    .unwrap_or(0);
                let new_oi = (current_oi - position.size).max(0);
                env.storage()
                    .persistent()
                    .set(&DataKey::TotalOpenInterestShort(asset), &new_oi);
            }
        }

        // 9. Remove position from storage
        env.storage().persistent().remove(&position_key);

        // 10. Update funding rate
        Self::update_funding_rate(&env, asset)?;

        Ok(settlement_amount)
    }

    /// Get a user's position
    pub fn get_position(env: Env, user: Address, asset: Asset) -> Result<Position, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Position(user, asset))
            .ok_or(Error::InvalidInput)
    }

    /// Get total open interest for an asset
    pub fn get_open_interest(env: Env, asset: Asset) -> Result<(i128, i128), Error> {
        let long_oi: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalOpenInterestLong(asset))
            .unwrap_or(0);
        let short_oi: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalOpenInterestShort(asset))
            .unwrap_or(0);
        Ok((long_oi, short_oi))
    }

    /// Get funding index for an asset
    pub fn get_funding_index(env: Env, asset: Asset) -> Result<i128, Error> {
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::FundingIndex(asset))
            .unwrap_or(0))
    }

    /// Get vault address
    pub fn get_vault_address(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&VAULT_ADDR)
            .ok_or(Error::NotInitialized)
    }

    /// Get oracle address
    pub fn get_oracle_address(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&ORACLE_ADDR)
            .ok_or(Error::NotInitialized)
    }

    /// Calculate unrealized PnL for a position
    pub fn get_unrealized_pnl(env: Env, user: Address, asset: Asset) -> Result<i128, Error> {
        let position: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(user, asset))
            .ok_or(Error::InvalidInput)?;

        let current_price = Self::get_oracle_price(&env, asset)?;

        let pnl = match position.direction {
            Direction::Long => ((current_price - position.entry_price) * position.size) / PRECISION,
            Direction::Short => {
                ((position.entry_price - current_price) * position.size) / PRECISION
            }
        };

        Ok(pnl)
    }
}

// ============================================================================
// Internal Implementation
// ============================================================================

impl NoetherMarket {
    /// Get price from oracle adapter using REAL cross-contract call
    fn get_oracle_price(env: &Env, asset: Asset) -> Result<i128, Error> {
        let oracle_addr: Address = env
            .storage()
            .instance()
            .get(&ORACLE_ADDR)
            .ok_or(Error::NotInitialized)?;

        // REAL cross-contract call to oracle
        let oracle_client = OracleClient::new(env, &oracle_addr);
        let price = oracle_client.get_price(&asset);

        Ok(price)
    }

    /// Calculate liquidation price based on direction
    fn calculate_liquidation_price(
        entry_price: i128,
        collateral: i128,
        size: i128,
        direction: &Direction,
    ) -> i128 {
        // Liquidation occurs when losses >= collateral
        // For Long: liquidation_price = entry_price - (collateral * PRECISION / size)
        // For Short: liquidation_price = entry_price + (collateral * PRECISION / size)
        let margin_per_unit = (collateral * PRECISION) / size;

        match direction {
            Direction::Long => entry_price - margin_per_unit,
            Direction::Short => entry_price + margin_per_unit,
        }
    }

    /// Update funding rate based on long/short imbalance
    fn update_funding_rate(env: &Env, asset: Asset) -> Result<(), Error> {
        let long_oi: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalOpenInterestLong(asset))
            .unwrap_or(0);
        let short_oi: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalOpenInterestShort(asset))
            .unwrap_or(0);

        let total_oi = long_oi + short_oi;
        if total_oi == 0 {
            return Ok(());
        }

        // Calculate funding rate: (Longs - Shorts) / TotalOI
        // Positive = longs pay shorts, Negative = shorts pay longs
        let imbalance = long_oi - short_oi;
        let funding_rate = (imbalance * FUNDING_PRECISION) / total_oi;

        // Update cumulative funding index
        let current_index: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::FundingIndex(asset))
            .unwrap_or(0);
        let new_index = current_index + funding_rate;
        env.storage()
            .persistent()
            .set(&DataKey::FundingIndex(asset), &new_index);

        Ok(())
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let contract_id = env.register_contract(None, NoetherMarket);
        let client = NoetherMarketClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let vault = Address::generate(&env);
        let oracle = Address::generate(&env);
        let usdc_token = Address::generate(&env);

        client.initialize(&admin, &vault, &oracle, &usdc_token);

        let (long_oi, short_oi) = client.get_open_interest(&Asset::Stellar);
        assert_eq!(long_oi, 0);
        assert_eq!(short_oi, 0);
    }

    #[test]
    fn test_calculate_liquidation_price_long() {
        // Entry: $0.15 (1_500_000), Collateral: $100 (1_000_000_000), Size: $1000 (10_000_000_000)
        // Margin per unit = (1_000_000_000 * 10_000_000) / 10_000_000_000 = 1_000_000
        // Liquidation = 1_500_000 - 1_000_000 = 500_000 ($0.05)
        let entry_price = 1_500_000_i128;
        let collateral = 1_000_000_000_i128;
        let size = 10_000_000_000_i128;

        let liq_price = NoetherMarket::calculate_liquidation_price(
            entry_price,
            collateral,
            size,
            &Direction::Long,
        );

        assert_eq!(liq_price, 500_000);
    }

    #[test]
    fn test_calculate_liquidation_price_short() {
        // Entry: $0.15 (1_500_000), Collateral: $100 (1_000_000_000), Size: $1000 (10_000_000_000)
        // Margin per unit = 1_000_000
        // Liquidation = 1_500_000 + 1_000_000 = 2_500_000 ($0.25)
        let entry_price = 1_500_000_i128;
        let collateral = 1_000_000_000_i128;
        let size = 10_000_000_000_i128;

        let liq_price = NoetherMarket::calculate_liquidation_price(
            entry_price,
            collateral,
            size,
            &Direction::Short,
        );

        assert_eq!(liq_price, 2_500_000);
    }
}
