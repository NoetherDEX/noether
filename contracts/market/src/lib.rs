#![no_std]
use noether_common::{Asset, Error, Position};
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token::TokenClient, Address, Env, Symbol,
};

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
    Position(Address, Asset), // User address and asset
    TotalOpenInterestLong(Asset),
    TotalOpenInterestShort(Asset),
    FundingIndex(Asset), // Cumulative funding rate index
}

// ============================================================================
// Constants
// ============================================================================

/// Maximum leverage (e.g., 10x = 1000%)
const MAX_LEVERAGE_BPS: i128 = 1000; // 10x leverage

/// Precision for calculations (7 decimals)
const PRECISION: i128 = 10_000_000; // 1e7

// ============================================================================
// Market Contract (Trading Engine)
// ============================================================================

/// Market contract for opening/closing positions and calculating PnL
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
    pub fn open_position(
        env: Env,
        user: Address,
        asset: Asset,
        collateral: i128,
        size_delta: i128,
        is_long: bool,
    ) -> Result<Position, Error> {
        if collateral <= 0 || size_delta <= 0 {
            return Err(Error::InvalidInput);
        }

        // 1. Get entry price from oracle
        let entry_price = Self::get_oracle_price(&env, asset)?;

        // 2. Leverage check
        let leverage_bps = (size_delta * 10000) / collateral;
        if leverage_bps > MAX_LEVERAGE_BPS {
            return Err(Error::OverLeveraged);
        }

        // 3. Transfer collateral from user to vault
        let usdc_token: Address = env
            .storage()
            .instance()
            .get(&USDC_TOKEN)
            .ok_or(Error::NotInitialized)?;
        let token_client = TokenClient::new(&env, &usdc_token);

        let vault_addr: Address = env
            .storage()
            .instance()
            .get(&VAULT_ADDR)
            .ok_or(Error::NotInitialized)?;
        token_client.transfer(&user, &vault_addr, &collateral);

        // 4. Load or create position
        let position_key = DataKey::Position(user.clone(), asset);
        let mut position: Position =
            env.storage()
                .persistent()
                .get(&position_key)
                .unwrap_or(Position {
                    owner: user.clone(),
                    collateral: 0,
                    size: 0,
                    entry_price: 0,
                    liquidation_price: 0,
                });

        // Update position
        if position.size == 0 {
            // New position
            position.owner = user.clone();
            position.collateral = collateral;
            position.size = size_delta;
            position.entry_price = entry_price;
            // Simplified liquidation price calculation
            // liquidation_price = entry_price * (1 - collateral/size)
            position.liquidation_price = entry_price - (entry_price * collateral) / size_delta;
        } else {
            // Existing position - average entry price
            let total_cost = (position.entry_price * position.size) + (entry_price * size_delta);
            position.size += size_delta;
            position.entry_price = total_cost / position.size;
            position.collateral += collateral;
            position.liquidation_price =
                position.entry_price - (position.entry_price * position.collateral) / position.size;
        }

        // Save position
        env.storage().persistent().set(&position_key, &position);

        // 5. Update total open interest
        if is_long {
            let current_oi: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::TotalOpenInterestLong(asset))
                .unwrap_or(0);
            env.storage().persistent().set(
                &DataKey::TotalOpenInterestLong(asset),
                &(current_oi + size_delta),
            );
        } else {
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

        // Update funding rate
        Self::update_funding_rate(&env, asset)?;

        Ok(position)
    }

    /// Close a trading position
    pub fn close_position(env: Env, user: Address, asset: Asset) -> Result<i128, Error> {
        // 1. Load position
        let position_key = DataKey::Position(user.clone(), asset);
        let position: Position = env
            .storage()
            .persistent()
            .get(&position_key)
            .ok_or(Error::InvalidInput)?;

        // 2. Get exit price from oracle
        let exit_price = Self::get_oracle_price(&env, asset)?;

        // 3. Calculate PnL
        let pnl = if position.size > 0 {
            // Determine if long or short based on position
            // For simplicity, we'll check if entry_price < exit_price suggests long
            // In production, you'd store direction explicitly
            let is_long = exit_price >= position.entry_price;

            if is_long {
                // Long position: profit when exit > entry
                (exit_price - position.entry_price) * position.size / PRECISION
            } else {
                // Short position: profit when entry > exit
                (position.entry_price - exit_price) * position.size / PRECISION
            }
        } else {
            0
        };

        // Determine position direction from open interest
        // This is a simplification - in production, store direction in Position
        let _long_oi: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalOpenInterestLong(asset))
            .unwrap_or(0);
        let _short_oi: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalOpenInterestShort(asset))
            .unwrap_or(0);

        // For now, assume long if size is positive (simplified)
        let is_long = true; // Would be determined from position data

        // 4. Settlement
        let settlement_amount = if pnl > 0 {
            // Profit: return collateral + profit
            position.collateral + pnl
        } else if pnl < 0 && pnl.abs() < position.collateral {
            // Loss but not liquidated: return collateral - loss
            position.collateral + pnl // pnl is negative, so this subtracts
        } else {
            // Liquidated: return minimal dust or nothing
            0
        };

        // Update global PnL in vault
        let vault_addr: Address = env
            .storage()
            .instance()
            .get(&VAULT_ADDR)
            .ok_or(Error::NotInitialized)?;

        // Note: In production, you'd call vault.update_global_pnl()
        // For now, we'll just withdraw the settlement amount

        // 5. Withdraw settlement from vault
        if settlement_amount > 0 {
            Self::call_vault_withdraw_pnl(&env, &vault_addr, &user, settlement_amount)?;
        }

        // 6. Update open interest
        if is_long {
            let current_oi: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::TotalOpenInterestLong(asset))
                .unwrap_or(0);
            let new_oi = (current_oi - position.size).max(0);
            env.storage()
                .persistent()
                .set(&DataKey::TotalOpenInterestLong(asset), &new_oi);
        } else {
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

        // 7. Remove position from storage
        env.storage().persistent().remove(&position_key);

        // Update funding rate
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
}

// ============================================================================
// Internal Implementation
// ============================================================================

impl NoetherMarket {
    /// Get price from oracle adapter
    fn get_oracle_price(env: &Env, asset: Asset) -> Result<i128, Error> {
        let _oracle_addr: Address = env
            .storage()
            .instance()
            .get(&ORACLE_ADDR)
            .ok_or(Error::NotInitialized)?;

        // In production, you would use cross-contract call:
        // let oracle_client = OracleAdapterClient::new(env, &oracle_addr);
        // oracle_client.get_price(asset)

        // For now, return a mock price
        // In production, implement actual cross-contract call
        match asset {
            Asset::Stellar => Ok(1_500_000), // $0.15 with 7 decimals
            Asset::USDC => Ok(10_000_000),   // $1.00 with 7 decimals
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

        // Calculate funding rate: (Longs - Shorts) / PoolSize
        // Simplified: use open interest as proxy for pool size
        let imbalance = long_oi - short_oi;
        let funding_rate = (imbalance * PRECISION) / total_oi.max(1);

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

    /// Call vault's withdraw_trader_pnl function
    fn call_vault_withdraw_pnl(
        env: &Env,
        vault_addr: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(), Error> {
        // In production, you would use cross-contract call:
        // let vault_client = NoetherVaultClient::new(env, vault_addr);
        // vault_client.withdraw_trader_pnl(to, amount)

        // For now, we'll simulate by transferring directly
        // In production, implement actual cross-contract call
        let usdc_token: Address = env
            .storage()
            .instance()
            .get(&USDC_TOKEN)
            .ok_or(Error::NotInitialized)?;
        let token_client = TokenClient::new(env, &usdc_token);

        // Note: This assumes vault has approved this contract or we have direct access
        // In production, use the vault's withdraw_trader_pnl function
        token_client.transfer(vault_addr, to, &amount);

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
    fn test_leverage_check() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, NoetherMarket);
        let client = NoetherMarketClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let vault = Address::generate(&env);
        let oracle = Address::generate(&env);
        let usdc_token = Address::generate(&env);

        client.initialize(&admin, &vault, &oracle, &usdc_token);

        let user = Address::generate(&env);

        // Try to open position with too high leverage (20x when max is 10x)
        let collateral = 100_000; // 1 USDC
        let size_delta = 2_000_000; // Would be 20x leverage

        let result =
            client.try_open_position(&user, &Asset::Stellar, &collateral, &size_delta, &true);
        assert!(result.is_err());
    }
}
