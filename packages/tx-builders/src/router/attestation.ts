import type { xdr } from '@stellar/stellar-sdk';
import { toScVal, type BytesLike } from '../scval.js';

/**
 * One signed Noeracle price attestation, as the `noether_router` verify-then-
 * trade entry points consume it. `pubkeys` / `sigs` are the raw fields of a
 * `Vec<BytesN<32>>` / `Vec<BytesN<64>>` — a caller with a single publisher
 * passes one-element arrays.
 */
export interface PriceAttestation {
  price: bigint;
  timestamp: number | bigint;
  roundId: number | bigint;
  pubkeys: BytesLike[];
  sigs: BytesLike[];
}

/**
 * The five price-related ScVal args every router entry point expects AFTER its
 * trade args: (price: i128, timestamp: u64, round_id: u64,
 * pubkeys: Vec<BytesN<32>>, sigs: Vec<BytesN<64>>). The router derives the
 * 8-byte asset tag itself, so it is not passed here.
 */
export function attestationTailArgs(att: PriceAttestation): xdr.ScVal[] {
  return [
    toScVal(att.price, 'i128'),
    toScVal(att.timestamp, 'u64'),
    toScVal(att.roundId, 'u64'),
    toScVal(att.pubkeys, 'bytes_vec'),
    toScVal(att.sigs, 'bytes_vec'),
  ];
}
