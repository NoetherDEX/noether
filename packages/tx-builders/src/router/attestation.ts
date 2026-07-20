import { xdr } from '@stellar/stellar-sdk';
import { toScVal, type BytesLike } from '../scval.js';

/**
 * One signed Noeracle price bundle, as the Batch-1 `noether_router`
 * verify-then-trade entry points consume it (L0-8 quorum ABI).
 *
 * `prices[i]` is what `pubkeys[i]` signed with `sigs[i]` — the three arrays
 * MUST be aligned and equal-length or the router rejects the bundle as
 * malformed (#5). A caller with a single publisher passes one-element
 * arrays; the on-chain MEDIAN across publishers becomes the stored price.
 *
 * NOTE: the pre-Batch-1 router used flattened tail args with a single
 * price. These builders target the Batch-1 ABI only; the web app and
 * keeper carry their own legacy path for the old deployment.
 */
export interface PriceAttestation {
  /** Market asset symbol ("BTC") — the router derives the 8-byte tag. */
  asset: string;
  /** Per-publisher 7-decimal prices, aligned with pubkeys/sigs. */
  prices: bigint[];
  timestamp: number | bigint;
  roundId: number | bigint;
  /** Publisher Ed25519 keys, 32-byte hex or bytes. */
  pubkeys: BytesLike[];
  /** Ed25519 signatures, 64-byte hex or bytes. */
  sigs: BytesLike[];
}

/**
 * The `PriceAttestation` struct ScVal every router entry point takes as its
 * final argument. Soroban UDT structs travel as ScMaps with entries SORTED
 * BY KEY: asset < prices < pubkeys < round_id < sigs < timestamp.
 */
export function attestationStructArg(att: PriceAttestation): xdr.ScVal {
  const entry = (key: string, val: xdr.ScVal) =>
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
  return xdr.ScVal.scvMap([
    entry('asset', toScVal(att.asset, 'symbol')),
    entry('prices', xdr.ScVal.scvVec(att.prices.map((p) => toScVal(p, 'i128')))),
    entry('pubkeys', toScVal(att.pubkeys, 'bytes_vec')),
    entry('round_id', toScVal(att.roundId, 'u64')),
    entry('sigs', toScVal(att.sigs, 'bytes_vec')),
    entry('timestamp', toScVal(att.timestamp, 'u64')),
  ]);
}
