//! # Vault Factory Contract
//!
//! Tranche 2 deliverable D3 — user-created trading vaults.
//!
//! Any address can call `create_vault(leader, name)` to mint a new
//! vault. Depositors send USDC to the vault and receive proportional
//! "shares". The leader trades on behalf of all depositors using the
//! shared collateral and earns a 10% profit share above the
//! high-water mark. The leader is required to keep at least 5% of
//! their own capital in the vault at all times.
//!
//! Phase 10.1 — crate scaffold only. Public surface lands across
//! subsequent commits in this branch.

#![no_std]

use soroban_sdk::{contract, contractimpl, Env, Symbol};

mod math;
mod storage;
mod types;

pub use types::{FactoryError, VaultInfo};

#[contract]
pub struct VaultFactoryContract;

#[contractimpl]
impl VaultFactoryContract {
    /// Marker placeholder so the contract compiles to a valid WASM
    /// module while later commits build out the real public surface
    /// (create_vault, deposit, withdraw, leader_*, claim_leader_fees).
    pub fn version(env: Env) -> Symbol {
        Symbol::new(&env, "vault_factory_v0")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn version_returns_marker() {
        let env = Env::default();
        let id = env.register_contract(None, VaultFactoryContract);
        let client = VaultFactoryContractClient::new(&env, &id);
        assert_eq!(client.version(), Symbol::new(&env, "vault_factory_v0"));
    }
}
