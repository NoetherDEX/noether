#![no_std]
use soroban_sdk::{contracttype, contracterror, Address, Env};

/// Asset enum representing supported assets
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum Asset {
    Stellar,
    USDC,
}

/// Direction enum for position direction
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum Direction {
    Long,
    Short,
}

/// Position struct representing a trading position
/// Note: asset and direction are tracked via DataKey in the market contract
/// to keep Position struct simple and storage-efficient
#[derive(Clone, Debug)]
#[contracttype]
pub struct Position {
    pub owner: Address,
    pub collateral: i128,
    pub size: i128,
    pub entry_price: i128,
    pub liquidation_price: i128,
}

/// Error enum for common contract errors
#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    SlippageExceeded = 1,
    OracleStale = 2,
    PriceDivergence = 3,
    OverLeveraged = 4,
    AssetNotSupported = 5,
    Unauthorized = 6,
    AlreadyInitialized = 7,
    NotInitialized = 8,
    InvalidInput = 9,
    InsufficientBalance = 10,
}

/// Oracle price data structure
#[derive(Clone, Debug)]
#[contracttype]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// Oracle trait for price fetching
pub trait OracleTrait {
    fn get_price(env: Env, asset: Asset) -> Result<i128, Error>;
}
