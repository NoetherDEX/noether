//! # Noether Common Library
//!
//! Shared types, errors, and utilities for the Noether PerpDex protocol.
//! This crate is used by all Noether smart contracts.

#![no_std]

pub mod types;
pub mod errors;
pub mod math;

// Re-export all public items for convenient importing
pub use types::*;
pub use errors::*;
pub use math::*;
