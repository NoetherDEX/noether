//! Canonical asset-symbol -> Noeracle 8-byte tag derivation.
//!
//! Noeracle's on-chain slot key is ASCII("<SYM>USD") zero-padded to 8
//! bytes (confirmed against live api.noeracle.org attestations). The
//! router WRITES that slot and the shim READS it on the market's
//! behalf, so both must derive byte-identical tags — this is the one
//! source of truth (O-8). Adding a pair = extend here + redeploy both.

use soroban_sdk::{BytesN, Env, Symbol};

use crate::errors::NoetherError;

pub fn symbol_to_tag(env: &Env, asset: &Symbol) -> Result<BytesN<8>, NoetherError> {
    let btc = Symbol::new(env, "BTC");
    let eth = Symbol::new(env, "ETH");
    let xlm = Symbol::new(env, "XLM");

    let bytes: [u8; 8] = if asset == &btc {
        [b'B', b'T', b'C', b'U', b'S', b'D', 0, 0]
    } else if asset == &eth {
        [b'E', b'T', b'H', b'U', b'S', b'D', 0, 0]
    } else if asset == &xlm {
        [b'X', b'L', b'M', b'U', b'S', b'D', 0, 0]
    } else {
        return Err(NoetherError::InvalidPrice);
    };

    Ok(BytesN::from_array(env, &bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_pairs_map_to_padded_usd_tags() {
        let env = Env::default();
        for (sym, expect) in [
            ("BTC", *b"BTCUSD\0\0"),
            ("ETH", *b"ETHUSD\0\0"),
            ("XLM", *b"XLMUSD\0\0"),
        ] {
            let tag = symbol_to_tag(&env, &Symbol::new(&env, sym)).unwrap();
            assert_eq!(tag, BytesN::from_array(&env, &expect));
        }
    }

    #[test]
    fn unknown_symbol_errors() {
        let env = Env::default();
        let res = symbol_to_tag(&env, &Symbol::new(&env, "DOGE"));
        assert_eq!(res, Err(NoetherError::InvalidPrice));
    }
}
