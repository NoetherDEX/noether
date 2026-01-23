//! # NOE Token Management
//!
//! NOE (Noether LP Token) operations using real Stellar Classic Asset.
//! NOE is a SAC-wrapped classic asset - users can see it in wallets and trade on SDEX.
//!
//! ## Pre-mint + Transfer Model
//!
//! - Admin pre-mints NOE supply to the vault contract
//! - On deposit: Vault transfers NOE to user
//! - On withdraw: User transfers NOE back to vault

use soroban_sdk::{token, Address, Env};
use crate::storage::{get_noe_token, get_total_noe_circulating, set_total_noe_circulating};

/// Transfer NOE tokens from vault to user (on deposit).
///
/// # Arguments
/// * `env` - Contract environment
/// * `to` - Address to receive NOE
/// * `amount` - Amount to transfer (7 decimals)
pub fn transfer_to_user(env: &Env, to: &Address, amount: i128) {
    let noe_token = get_noe_token(env);
    let token_client = token::Client::new(env, &noe_token);

    // Transfer NOE from vault to user
    token_client.transfer(&env.current_contract_address(), to, &amount);

    // Update circulating supply tracking
    let circulating = get_total_noe_circulating(env);
    set_total_noe_circulating(env, circulating + amount);
}

/// Transfer NOE tokens from user back to vault (on withdraw).
///
/// # Arguments
/// * `env` - Contract environment
/// * `from` - Address sending NOE
/// * `amount` - Amount to transfer (7 decimals)
///
/// Note: The user must have already approved or transferred the tokens.
/// We use transfer_from with the vault as spender.
pub fn transfer_from_user(env: &Env, from: &Address, amount: i128) {
    let noe_token = get_noe_token(env);
    let token_client = token::Client::new(env, &noe_token);

    // Transfer NOE from user to vault
    // User must have called approve() for vault beforehand, or we use direct transfer
    // Since user has already authorized the withdraw call, we can use transfer_from
    token_client.transfer_from(
        &env.current_contract_address(),
        from,
        &env.current_contract_address(),
        &amount,
    );

    // Update circulating supply tracking
    let circulating = get_total_noe_circulating(env);
    set_total_noe_circulating(env, circulating - amount);
}

/// Get NOE balance for an address by querying the token contract.
pub fn balance(env: &Env, user: &Address) -> i128 {
    let noe_token = get_noe_token(env);
    let token_client = token::Client::new(env, &noe_token);
    token_client.balance(user)
}

/// Get the vault's NOE balance (available for distribution).
pub fn vault_balance(env: &Env) -> i128 {
    let noe_token = get_noe_token(env);
    let token_client = token::Client::new(env, &noe_token);
    token_client.balance(&env.current_contract_address())
}

/// Get total NOE supply by querying the token contract.
pub fn total_supply(env: &Env) -> i128 {
    // For classic assets, we track circulating supply (what users hold)
    // plus vault's balance
    let circulating = get_total_noe_circulating(env);
    let vault_bal = vault_balance(env);
    circulating + vault_bal
}

/// Get total circulating NOE (held by users, not in vault).
/// This is used for NOE price calculation.
pub fn circulating_supply(env: &Env) -> i128 {
    get_total_noe_circulating(env)
}
