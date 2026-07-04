/**
 * ScVal helpers for Noether contract calls.
 *
 * Mirrors the conventions used by web/lib/stellar/client.ts so that tx
 * built here are byte-identical to txs built by the frontend. In
 * particular: Direction is encoded as u32 (Long=0, Short=1) — confirmed
 * empirically against the deployed market contract.
 */

import { Address, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import type { Direction, TriggerCondition } from '@noether/types';

export type ScArgType =
  | 'address'
  | 'symbol'
  | 'string'
  | 'i128'
  | 'u32'
  | 'u64'
  | 'i64'
  | 'bool'
  | 'direction'
  | 'trigger_above'
  | 'bytes'
  | 'bytes_vec';

/** Raw bytes for a BytesN<N> field: a hex string or a byte array. */
export type BytesLike = string | Uint8Array;

function toBytes(value: BytesLike): Buffer {
  return typeof value === 'string' ? Buffer.from(value, 'hex') : Buffer.from(value);
}

export function toScVal(value: unknown, type: ScArgType): xdr.ScVal {
  switch (type) {
    case 'address':
      return new Address(value as string).toScVal();
    case 'symbol':
      return nativeToScVal(value as string, { type: 'symbol' });
    case 'string':
      return nativeToScVal(value as string, { type: 'string' });
    case 'i128':
      return nativeToScVal(BigInt(value as number | bigint | string), { type: 'i128' });
    case 'u32':
      return nativeToScVal(value as number, { type: 'u32' });
    case 'u64':
      return nativeToScVal(BigInt(value as number | bigint | string), { type: 'u64' });
    case 'i64':
      return nativeToScVal(BigInt(value as number | bigint | string), { type: 'i64' });
    case 'bool':
      return nativeToScVal(value as boolean, { type: 'bool' });
    case 'direction': {
      const v = value as Direction;
      return nativeToScVal(v === 'Long' ? 0 : 1, { type: 'u32' });
    }
    case 'trigger_above': {
      const v = value as TriggerCondition;
      return nativeToScVal(v === 'Above', { type: 'bool' });
    }
    case 'bytes':
      return xdr.ScVal.scvBytes(toBytes(value as BytesLike));
    case 'bytes_vec':
      return xdr.ScVal.scvVec((value as BytesLike[]).map((b) => xdr.ScVal.scvBytes(toBytes(b))));
    default: {
      const exhaustive: never = type;
      throw new Error(`unknown ScArgType: ${exhaustive as string}`);
    }
  }
}

export function fromScVal<T = unknown>(scVal: xdr.ScVal): T {
  return scValToNative(scVal) as T;
}
