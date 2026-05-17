import { scValToNative, xdr } from '@stellar/stellar-sdk';

/** Decode a ScVal to a native JS value (bigint for i128/u128, strkey for Address, etc.). */
export function decodeScVal<T = unknown>(value: xdr.ScVal): T {
  return scValToNative(value) as T;
}

/**
 * Soroban contract events publish a payload as a Vec when emitting tuples.
 * `scValToNative` on a ScVec returns a normal array. This helper coerces
 * scalar payloads to a single-element array so downstream decoders can
 * treat all events uniformly.
 */
export function decodeEventValue(value: xdr.ScVal): unknown[] {
  const native = decodeScVal<unknown>(value);
  return Array.isArray(native) ? native : [native];
}

export function decodeTopics(topics: xdr.ScVal[]): unknown[] {
  return topics.map((t) => decodeScVal<unknown>(t));
}

export function asBigInt(v: unknown, label: string): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  throw new Error(`Expected bigint for ${label}, got ${typeof v}`);
}

export function asNumber(v: unknown, label: string): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  throw new Error(`Expected number for ${label}, got ${typeof v}`);
}

export function asString(v: unknown, label: string): string {
  if (typeof v === 'string') return v;
  throw new Error(`Expected string for ${label}, got ${typeof v}`);
}
