#![no_std]
use noether_common::{Asset, Error, Position};
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, vec, token::TokenClient, Address, Env, IntoVal, Symbol, Val, Vec,
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
    PositionDirection(Address, Asset), // Store if position is long or short
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

        // Extend TTL for instance storage
        env.storage().instance().extend_ttl(100_000, 100_000);

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
        // Require user authorization
        user.require_auth();

        if collateral <= 0 || size_delta <= 0 {
            return Err(Error::InvalidInput);
        }

        // 1. Get entry price from oracle (REAL price from Band/DIA)
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
        let direction_key = DataKey::PositionDirection(user.clone(), asset);
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
            // Calculate liquidation price based on direction
            if is_long {
                // Long: liquidated when price drops
                position.liquidation_price = entry_price - (entry_price * collateral) / size_delta;
            } else {
                // Short: liquidated when price rises
                position.liquidation_price = entry_price + (entry_price * collateral) / size_delta;
            }
            // Store direction
            env.storage().persistent().set(&direction_key, &is_long);
        } else {
            // Existing position - average entry price
            let total_cost = (position.entry_price * position.size) + (entry_price * size_delta);
            position.size += size_delta;
            position.entry_price = total_cost / position.size;
            position.collateral += collateral;

            // Recalculate liquidation price
            let stored_is_long: bool = env.storage().persistent().get(&direction_key).unwrap_or(true);
            if stored_is_long {
                position.liquidation_price =
                    position.entry_price - (position.entry_price * position.collateral) / position.size;
            } else {
                position.liquidation_price =
                    position.entry_price + (position.entry_price * position.collateral) / position.size;
            }
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
        // Require user authorization
        user.require_auth();

        // 1. Load position
        let position_key = DataKey::Position(user.clone(), asset);
        let direction_key = DataKey::PositionDirection(user.clone(), asset);
        let position: Position = env
            .storage()
            .persistent()
            .get(&position_key)
            .ok_or(Error::InvalidInput)?;

        // 2. Get exit price from oracle (REAL price from Band/DIA)
        let exit_price = Self::get_oracle_price(&env, asset)?;

        // 3. Get position direction
        let is_long: bool = env.storage().persistent().get(&direction_key).unwrap_or(true);

        // 4. Calculate PnL
        let pnl = if position.size > 0 {
            if is_long {
                // Long position: profit when exit > entry
                ((exit_price - position.entry_price) * position.size) / PRECISION
            } else {
                // Short position: profit when entry > exit
                ((position.entry_price - exit_price) * position.size) / PRECISION
            }
        } else {
            0
        };

        // 5. Settlement
        let settlement_amount = if pnl > 0 {
            // Profit: return collateral + profit
            position.collateral + pnl
        } else if pnl < 0 && pnl.abs() < position.collateral {
            // Loss but not liquidated: return collateral - loss
            position.collateral + pnl // pnl is negative, so this subtracts
        } else {
            // Liquidated: return nothing (loss exceeded collateral)
            0
        };

        // 6. Withdraw settlement from vault via cross-contract call
        if settlement_amount > 0 {
            let vault_addr: Address = env
                .storage()
                .instance()
                .get(&VAULT_ADDR)
                .ok_or(Error::NotInitialized)?;
            Self::call_vault_withdraw_pnl(&env, &vault_addr, &user, settlement_amount)?;
        }

        // 7. Update open interest
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

        // 8. Remove position from storage
        env.storage().persistent().remove(&position_key);
        env.storage().persistent().remove(&direction_key);

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

    /// Get position direction (true = long, false = short)
    pub fn get_position_direction(env: Env, user: Address, asset: Asset) -> Result<bool, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::PositionDirection(user, asset))
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

    /// Get current price from oracle (public function for UI)
    pub fn get_current_price(env: Env, asset: Asset) -> Result<i128, Error> {
        Self::get_oracle_price(&env, asset)
    }

    /// Get vault address
    pub fn get_vault(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&VAULT_ADDR)
            .ok_or(Error::NotInitialized)
    }

    /// Get oracle address
    pub fn get_oracle(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&ORACLE_ADDR)
            .ok_or(Error::NotInitialized)
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&ADMIN)
            .ok_or(Error::NotInitialized)
    }
}

// ============================================================================
// Internal Implementation
// ============================================================================

impl NoetherMarket {
    /// Get price from Oracle Adapter via cross-contract call
    /// This calls the real Band/DIA oracle through our adapter
    fn get_oracle_price(env: &Env, asset: Asset) -> Result<i128, Error> {
        let oracle_addr: Address = env
            .storage()
            .instance()
            .get(&ORACLE_ADDR)
            .ok_or(Error::NotInitialized)?;

        // Prepare arguments for oracle's get_price function
        let args: Vec<Val> = vec![env, asset.into_val(env)];

        // Cross-contract call to Oracle Adapter
        // Function: get_price(asset: Asset) -> Result<i128, Error>
        let price: i128 = env.invoke_contract(
            &oracle_addr,
            &Symbol::new(env, "get_price"),
            args,
        );

        if price <= 0 {
            return Err(Error::PriceDivergence);
        }

        Ok(price)
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
        let imbalance = long_oi - short_oi;
        let funding_rate = (imbalance * PRECISION) / total_oi;

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

    /// Call vault's withdraw_trader_pnl function via cross-contract call
    fn call_vault_withdraw_pnl(
        env: &Env,
        vault_addr: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(), Error> {
        // Prepare arguments for vault's withdraw_trader_pnl function
        let args: Vec<Val> = vec![env, to.into_val(env), amount.into_val(env)];

        // Cross-contract call to Vault
        // Function: withdraw_trader_pnl(to: Address, amount: i128) -> Result<(), Error>
        let _result: () = env.invoke_contract(
            vault_addr,
            &Symbol::new(env, "withdraw_trader_pnl"),
            args,
        );

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
        assert_eq!(client.get_vault(), vault);
        assert_eq!(client.get_oracle(), oracle);
        assert_eq!(client.get_admin(), admin);
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
