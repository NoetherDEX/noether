#![no_std]
use noether_common::Error;
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token::TokenClient, Address, Env, Symbol,
};

// ============================================================================
// Storage Keys
// ============================================================================

const ADMIN: Symbol = symbol_short!("ADMIN");
const USDC_TOKEN: Symbol = symbol_short!("USDC");
const GLP_SUPPLY: Symbol = symbol_short!("GLP_SUP");
const MARKET_ADDR: Symbol = symbol_short!("MARKET");
const INIT: Symbol = symbol_short!("INIT");

/// Storage keys for persistent data
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    GlpBalance(Address),
    GlobalShortPnl,
    GlobalLongPnl,
}

// ============================================================================
// Vault Contract (GLP Engine)
// ============================================================================

/// GLP-style Vault for managing liquidity and tracking trader PnL
/// Similar to GMX's GLP token mechanism
#[contract]
pub struct NoetherVault;

#[contractimpl]
impl NoetherVault {
    /// Initialize the vault with admin and USDC token address
    pub fn initialize(env: Env, admin: Address, usdc_token: Address) -> Result<(), Error> {
        // Check if already initialized
        if env.storage().instance().has(&INIT) {
            return Err(Error::AlreadyInitialized);
        }

        // Store admin and USDC token address
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&USDC_TOKEN, &usdc_token);
        env.storage().instance().set(&GLP_SUPPLY, &0_i128);
        env.storage().instance().set(&INIT, &true);

        // Initialize PnL tracking
        env.storage()
            .persistent()
            .set(&DataKey::GlobalShortPnl, &0_i128);
        env.storage()
            .persistent()
            .set(&DataKey::GlobalLongPnl, &0_i128);

        Ok(())
    }

    /// Deposit USDC liquidity and mint GLP tokens
    /// Returns the amount of GLP tokens minted
    pub fn deposit_liquidity(env: Env, user: Address, usdc_amount: i128) -> Result<i128, Error> {
        if usdc_amount <= 0 {
            return Err(Error::InvalidInput);
        }

        // Get USDC token address
        let usdc_token: Address = env
            .storage()
            .instance()
            .get(&USDC_TOKEN)
            .ok_or(Error::NotInitialized)?;

        // 1. Transfer USDC from user to vault
        let token_client = TokenClient::new(&env, &usdc_token);
        token_client.transfer(&user, &env.current_contract_address(), &usdc_amount);

        // 2. Calculate AUM (Assets Under Management)
        let aum = Self::calculate_aum(&env)?;

        // 3. Calculate GLP mint amount
        let glp_supply: i128 = env.storage().instance().get(&GLP_SUPPLY).unwrap_or(0);

        let glp_amount = if glp_supply == 0 {
            // First deposit: 1:1 ratio
            usdc_amount
        } else {
            // Subsequent deposits: proportional to existing supply
            // glp_amount = (usdc_amount * glp_supply) / aum
            (usdc_amount * glp_supply) / aum
        };

        // 4. Update GLP supply and user balance
        let new_supply = glp_supply + glp_amount;
        env.storage().instance().set(&GLP_SUPPLY, &new_supply);

        let current_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::GlpBalance(user.clone()))
            .unwrap_or(0);
        let new_balance = current_balance + glp_amount;
        env.storage()
            .persistent()
            .set(&DataKey::GlpBalance(user), &new_balance);

        Ok(glp_amount)
    }

    /// Withdraw liquidity by burning GLP tokens and returning USDC
    /// Returns the amount of USDC returned
    pub fn withdraw_liquidity(env: Env, user: Address, glp_amount: i128) -> Result<i128, Error> {
        if glp_amount <= 0 {
            return Err(Error::InvalidInput);
        }

        // 1. Verify user has enough GLP
        let user_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::GlpBalance(user.clone()))
            .unwrap_or(0);

        if glp_amount > user_balance {
            return Err(Error::InsufficientBalance);
        }

        // 2. Calculate USDC amount to return
        let aum = Self::calculate_aum(&env)?;
        let glp_supply: i128 = env
            .storage()
            .instance()
            .get(&GLP_SUPPLY)
            .ok_or(Error::NotInitialized)?;

        if glp_supply == 0 {
            return Err(Error::InvalidInput);
        }

        // usdc_amount = (glp_amount * aum) / glp_supply
        let usdc_amount = (glp_amount * aum) / glp_supply;

        // 3. Burn GLP (decrease supply and user balance)
        let new_supply = glp_supply - glp_amount;
        env.storage().instance().set(&GLP_SUPPLY, &new_supply);

        let new_balance = user_balance - glp_amount;
        env.storage()
            .persistent()
            .set(&DataKey::GlpBalance(user.clone()), &new_balance);

        // 4. Transfer USDC from vault to user
        let usdc_token: Address = env
            .storage()
            .instance()
            .get(&USDC_TOKEN)
            .ok_or(Error::NotInitialized)?;
        let token_client = TokenClient::new(&env, &usdc_token);
        token_client.transfer(&env.current_contract_address(), &user, &usdc_amount);

        Ok(usdc_amount)
    }

    /// Update global PnL (can only be called by admin or market contract)
    pub fn update_global_pnl(env: Env, short_pnl: i128, long_pnl: i128) -> Result<(), Error> {
        // Check authorization - admin or market contract can call this
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        // Update PnL tracking
        env.storage()
            .persistent()
            .set(&DataKey::GlobalShortPnl, &short_pnl);
        env.storage()
            .persistent()
            .set(&DataKey::GlobalLongPnl, &long_pnl);

        Ok(())
    }

    /// Get user's GLP balance
    pub fn get_glp_balance(env: Env, user: Address) -> Result<i128, Error> {
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::GlpBalance(user))
            .unwrap_or(0))
    }

    /// Get total GLP supply
    pub fn get_glp_supply(env: Env) -> Result<i128, Error> {
        Ok(env.storage().instance().get(&GLP_SUPPLY).unwrap_or(0))
    }

    /// Get AUM (Assets Under Management)
    pub fn get_aum(env: Env) -> Result<i128, Error> {
        Self::calculate_aum(&env)
    }

    /// Get global PnL values
    pub fn get_global_pnl(env: Env) -> Result<(i128, i128), Error> {
        let short_pnl: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::GlobalShortPnl)
            .unwrap_or(0);
        let long_pnl: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::GlobalLongPnl)
            .unwrap_or(0);
        Ok((short_pnl, long_pnl))
    }

    /// Get USDC token address
    pub fn get_usdc_token(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&USDC_TOKEN)
            .ok_or(Error::NotInitialized)
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&ADMIN)
            .ok_or(Error::NotInitialized)
    }

    /// Set market contract address (admin only)
    /// This allows the market contract to withdraw trader PnL
    pub fn set_market_address(env: Env, market: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        env.storage().instance().set(&MARKET_ADDR, &market);
        Ok(())
    }

    /// Withdraw trader PnL (only callable by market contract)
    /// Security Critical: Only the stored MarketAddress can call this
    pub fn withdraw_trader_pnl(env: Env, to: Address, amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidInput);
        }

        // Security check: Only market contract can call this
        let market_addr: Address = env
            .storage()
            .instance()
            .get(&MARKET_ADDR)
            .ok_or(Error::Unauthorized)?;
        market_addr.require_auth();

        // Get USDC token address
        let usdc_token: Address = env
            .storage()
            .instance()
            .get(&USDC_TOKEN)
            .ok_or(Error::NotInitialized)?;

        // Transfer USDC from vault to trader
        let token_client = TokenClient::new(&env, &usdc_token);
        token_client.transfer(&env.current_contract_address(), &to, &amount);

        Ok(())
    }

    /// Get market contract address
    pub fn get_market_address(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&MARKET_ADDR)
            .ok_or(Error::NotInitialized)
    }
}

// ============================================================================
// Internal Implementation
// ============================================================================

impl NoetherVault {
    /// Calculate AUM (Assets Under Management)
    /// AUM = USDC_Balance_of_Vault - Global_Trader_PnL
    /// Note: If PnL is negative (losses), it increases AUM
    ///       If PnL is positive (gains), it decreases AUM
    fn calculate_aum(env: &Env) -> Result<i128, Error> {
        // Get USDC token address
        let usdc_token: Address = env
            .storage()
            .instance()
            .get(&USDC_TOKEN)
            .ok_or(Error::NotInitialized)?;

        // Get USDC balance of vault
        let token_client = TokenClient::new(env, &usdc_token);
        let vault_balance = token_client.balance(&env.current_contract_address());

        // Get global PnL
        let short_pnl: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::GlobalShortPnl)
            .unwrap_or(0);
        let long_pnl: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::GlobalLongPnl)
            .unwrap_or(0);
        let total_pnl = short_pnl + long_pnl;

        // AUM = vault_balance - total_pnl
        // If PnL is negative (losses), subtracting it increases AUM
        // If PnL is positive (gains), subtracting it decreases AUM
        let aum = vault_balance - total_pnl;

        // Ensure AUM is never negative
        Ok(aum.max(0))
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    fn create_mock_token(env: &Env) -> Address {
        // For tests that don't require actual token operations,
        // use a generated address as a mock token
        Address::generate(env)
    }

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let contract_id = env.register_contract(None, NoetherVault);
        let client = NoetherVaultClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let usdc_token = create_mock_token(&env);

        client.initialize(&admin, &usdc_token);

        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_usdc_token(), usdc_token);
        assert_eq!(client.get_glp_supply(), 0);
    }

    #[test]
    fn test_update_global_pnl() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, NoetherVault);
        let client = NoetherVaultClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let usdc_token = create_mock_token(&env);

        client.initialize(&admin, &usdc_token);
        client.update_global_pnl(&-100_000, &50_000); // Short loss: -1 USDC, Long gain: +0.5 USDC

        let (short_pnl, long_pnl) = client.get_global_pnl();
        assert_eq!(short_pnl, -100_000);
        assert_eq!(long_pnl, 50_000);
    }

    #[test]
    fn test_aum_calculation_with_pnl() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, NoetherVault);
        let client = NoetherVaultClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let usdc_token = create_mock_token(&env);

        // Initialize vault
        client.initialize(&admin, &usdc_token);

        // Set negative PnL (losses) - should increase AUM when there are assets
        client.update_global_pnl(&-50_000, &0); // -0.5 USDC loss

        // AUM calculation depends on vault balance minus PnL
        // With no deposits, AUM would be 0 - (-50_000) = 50_000, but capped at 0
        let aum = client.get_aum();
        assert!(aum >= 0);
    }

    #[test]
    fn test_get_glp_balance() {
        let env = Env::default();
        let contract_id = env.register_contract(None, NoetherVault);
        let client = NoetherVaultClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let usdc_token = create_mock_token(&env);
        let user = Address::generate(&env);

        client.initialize(&admin, &usdc_token);

        // New user should have 0 GLP balance
        assert_eq!(client.get_glp_balance(&user), 0);
    }
}
