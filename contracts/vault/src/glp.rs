//! # GLP Token Management
//!
//! Internal GLP (Global Liquidity Provider) token logic.
//! GLP is not a separate token contract - it's tracked within the vault.

use soroban_sdk::{Address, Env};
use crate::storage::{get_glp_balance, set_glp_balance, get_total_glp, set_total_glp};

/// Mint GLP tokens to a recipient.
///
/// # Arguments
/// * `env` - Contract environment
/// * `to` - Address to mint to
/// * `amount` - Amount to mint (7 decimals)
pub fn mint(env: &Env, to: &Address, amount: i128) {
    // Increase user balance
    let current_balance = get_glp_balance(env, to);
    set_glp_balance(env, to, current_balance + amount);

    // Increase total supply
    let total_supply = get_total_glp(env);
    set_total_glp(env, total_supply + amount);
}

/// Burn GLP tokens from a holder.
///
/// # Arguments
/// * `env` - Contract environment
/// * `from` - Address to burn from
/// * `amount` - Amount to burn (7 decimals)
///
/// # Panics
/// Panics if user doesn't have enough balance (should be checked before calling)
pub fn burn(env: &Env, from: &Address, amount: i128) {
    // Decrease user balance
    let current_balance = get_glp_balance(env, from);
    assert!(current_balance >= amount, "Insufficient GLP balance");
    set_glp_balance(env, from, current_balance - amount);

    // Decrease total supply
    let total_supply = get_total_glp(env);
    set_total_glp(env, total_supply - amount);
}

/// Get GLP balance for an address.
pub fn balance(env: &Env, user: &Address) -> i128 {
    get_glp_balance(env, user)
}

/// Transfer GLP between addresses (internal use only).
///
/// # Arguments
/// * `env` - Contract environment
/// * `from` - Sender address
/// * `to` - Recipient address
/// * `amount` - Amount to transfer
pub fn transfer(env: &Env, from: &Address, to: &Address, amount: i128) {
    let from_balance = get_glp_balance(env, from);
    assert!(from_balance >= amount, "Insufficient GLP balance");

    set_glp_balance(env, from, from_balance - amount);

    let to_balance = get_glp_balance(env, to);
    set_glp_balance(env, to, to_balance + amount);
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_mint() {
        let env = Env::default();
        let user = Address::generate(&env);

        // Initial balance should be 0
        assert_eq!(balance(&env, &user), 0);
        assert_eq!(get_total_glp(&env), 0);

        // Mint 100 GLP
        mint(&env, &user, 1_000_000_000); // 100 with 7 decimals

        assert_eq!(balance(&env, &user), 1_000_000_000);
        assert_eq!(get_total_glp(&env), 1_000_000_000);
    }

    #[test]
    fn test_burn() {
        let env = Env::default();
        let user = Address::generate(&env);

        // Mint first
        mint(&env, &user, 1_000_000_000);

        // Burn 50 GLP
        burn(&env, &user, 500_000_000);

        assert_eq!(balance(&env, &user), 500_000_000);
        assert_eq!(get_total_glp(&env), 500_000_000);
    }

    #[test]
    fn test_transfer() {
        let env = Env::default();
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        // Mint to user1
        mint(&env, &user1, 1_000_000_000);

        // Transfer to user2
        transfer(&env, &user1, &user2, 400_000_000);

        assert_eq!(balance(&env, &user1), 600_000_000);
        assert_eq!(balance(&env, &user2), 400_000_000);
        assert_eq!(get_total_glp(&env), 1_000_000_000); // Total unchanged
    }

    #[test]
    #[should_panic(expected = "Insufficient GLP balance")]
    fn test_burn_insufficient() {
        let env = Env::default();
        let user = Address::generate(&env);

        mint(&env, &user, 500_000_000);
        burn(&env, &user, 1_000_000_000); // Should panic
    }
}
