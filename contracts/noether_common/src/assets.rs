//! Canonical asset-symbol -> Noeracle 8-byte tag derivation.
//!
//! Noeracle's on-chain slot key is ASCII("<SYM>USD") zero-padded to 8
//! bytes (confirmed against live api.noeracle.org attestations). The
//! router WRITES that slot and the shim READS it on the market's
//! behalf, so both must derive byte-identical tags — this is the one
//! source of truth (O-8). Adding a pair = add a row to PAIR_TAGS (and a
//! band to the router's price_bounds), then upgrade/redeploy both.

use soroban_sdk::{BytesN, Env, Symbol};

use crate::errors::NoetherError;

/// Every supported pair: (market symbol, Noeracle slot tag).
/// Must stay in lockstep with the live feed list at api.noeracle.org
/// and the router's price_bounds table.
pub const PAIR_TAGS: &[(&str, &[u8; 8])] = &[
    ("BTC", b"BTCUSD\0\0"),
    ("ETH", b"ETHUSD\0\0"),
    ("XLM", b"XLMUSD\0\0"),
    ("SOL", b"SOLUSD\0\0"),
    ("XRP", b"XRPUSD\0\0"),
    ("ADA", b"ADAUSD\0\0"),
    ("BNB", b"BNBUSD\0\0"),
    ("TRX", b"TRXUSD\0\0"),
    ("HYPE", b"HYPEUSD\0"),
    ("DOGE", b"DOGEUSD\0"),
    ("ZEC", b"ZECUSD\0\0"),
    ("LINK", b"LINKUSD\0"),
    ("BCH", b"BCHUSD\0\0"),
    ("LTC", b"LTCUSD\0\0"),
];

pub fn symbol_to_tag(env: &Env, asset: &Symbol) -> Result<BytesN<8>, NoetherError> {
    for (sym, tag) in PAIR_TAGS {
        if asset == &Symbol::new(env, sym) {
            return Ok(BytesN::from_array(env, tag));
        }
    }
    Err(NoetherError::InvalidPrice)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_pairs_map_to_padded_usd_tags() {
        let env = Env::default();
        for (sym, expect) in PAIR_TAGS {
            let tag = symbol_to_tag(&env, &Symbol::new(&env, sym)).unwrap();
            assert_eq!(tag, BytesN::from_array(&env, expect));
        }
    }

    #[test]
    fn every_tag_is_symbol_plus_usd_zero_padded() {
        for (sym, tag) in PAIR_TAGS {
            let mut expect = [0u8; 8];
            expect[..sym.len()].copy_from_slice(sym.as_bytes());
            expect[sym.len()..sym.len() + 3].copy_from_slice(b"USD");
            assert_eq!(*tag, &expect, "tag mismatch for {sym}");
        }
    }

    #[test]
    fn unknown_symbol_errors() {
        let env = Env::default();
        let res = symbol_to_tag(&env, &Symbol::new(&env, "PEPE"));
        assert_eq!(res, Err(NoetherError::InvalidPrice));
    }
}
