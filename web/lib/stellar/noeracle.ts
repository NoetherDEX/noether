import { xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { NOERACLE_API_URL } from '@/lib/utils/constants';

/**
 * Noeracle attestation reader for the router trade path.
 *
 * When the verify-then-trade router is enabled (NEXT_PUBLIC_NOETHER_ROUTER_ID),
 * the web fetches one freshly-signed price here at trade time and hands its raw
 * fields to `noether_router.open_with_price`. Uses a plain `fetch` against the
 * public attestation service — no `@noeracle/sdk` dependency, browser-native.
 */

/** One signed Noeracle attestation, decoded for building a router call. */
export interface Attestation {
  /** Integer price scaled by 1e7 (matches Noether's 7-decimal precision). */
  price: bigint;
  /** Unix seconds the round was signed. */
  timestamp: number;
  roundId: number;
  /** Publisher Ed25519 public key, 32-byte hex. */
  publisherHex: string;
  /** Ed25519 signature over the round, 64-byte hex. */
  signatureHex: string;
}

interface LatestEntry {
  price: string;
  timestamp: number;
  round_id: number;
  publisher: string;
  signature: string;
}

/**
 * Fetch the latest signed attestation for an asset ("BTC" / "ETH" / "XLM")
 * from the Noeracle attestation service. Returns null if unavailable so the
 * caller can fail the trade loudly rather than open on a missing price.
 */
export async function fetchAttestation(asset: string): Promise<Attestation | null> {
  try {
    const res = await fetch(`${NOERACLE_API_URL}/v1/latest`);
    if (!res.ok) return null;
    const body = (await res.json()) as { assets?: Record<string, LatestEntry> };
    const att = body.assets?.[`${asset}/USD`];
    if (!att) return null;
    return {
      price: BigInt(att.price),
      timestamp: Number(att.timestamp),
      roundId: Number(att.round_id),
      publisherHex: att.publisher,
      signatureHex: att.signature,
    };
  } catch {
    return null;
  }
}

/**
 * The five price-related ScVal args the router expects AFTER the trade args:
 * (price: i128, timestamp: u64, round_id: u64, pubkeys: Vec<BytesN<32>>, sigs: Vec<BytesN<64>>).
 * The router derives the 8-byte asset tag itself, so it is not passed here.
 */
export function priceTailArgs(att: Attestation): xdr.ScVal[] {
  return [
    nativeToScVal(att.price, { type: 'i128' }),
    nativeToScVal(BigInt(att.timestamp), { type: 'u64' }),
    nativeToScVal(BigInt(att.roundId), { type: 'u64' }),
    xdr.ScVal.scvVec([xdr.ScVal.scvBytes(Buffer.from(att.publisherHex, 'hex'))]),
    xdr.ScVal.scvVec([xdr.ScVal.scvBytes(Buffer.from(att.signatureHex, 'hex'))]),
  ];
}
