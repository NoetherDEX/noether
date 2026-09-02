/**
 * Footprint guard — stale-footprint hardening for Soroban trade transactions.
 *
 * Soroban freezes a transaction's read/write footprint at simulation time.
 * Several Noether settlement branches only write a key under state that
 * other transactions move between our simulation and our apply (the vault's
 * insurance buffer, the LP bucket, the ADL flag, the last-good price…). When
 * such a branch flips, the host traps the whole transaction with
 * `Error(Storage, ExceededLimit)` — "trying to access contract data key
 * outside of the footprint" — and the fee is still charged. That is the
 * 2026-08-30 "network moved on — resource estimate went stale" incident.
 *
 * `withResourceHeadroom` pads declared SIZES; nothing can pad KEYS after the
 * fact, so this module declares, per operation, the keys the contracts MAY
 * write and moves them into the read-write footprint before signing. The
 * contracts themselves now write those keys unconditionally, so this is
 * belt-and-braces for older deployments and for any branch a future upgrade
 * adds. Declaring an unused read-write key costs a small ledger-entry fee and
 * nothing else.
 *
 * IMPORTANT: this file is duplicated verbatim at web/lib/stellar/footprintGuard.ts
 * (the web app is not a workspace member and cannot import packages/). A drift
 * test keeps the two copies identical — edit both.
 */

import {
  Address,
  BASE_FEE,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';

export type TradeOp =
  | 'open'
  | 'open_cross'
  | 'close'
  | 'close_partial'
  | 'close_cross'
  | 'place_order'
  | 'cancel_order'
  | 'execute_order'
  | 'liquidate'
  | 'liquidate_cross'
  | 'adl'
  | 'other';

export interface KeyCtx {
  /** Vault contract id (C…). */
  vault: string;
  /** Market contract id (C…). */
  market: string;
  /** Trader (or keeper) account the operation settles for (G…). */
  trader: string;
  /** Market symbol touched by the operation (BTC, ETH, …). */
  asset?: string;
  /** Every asset a cross liquidation may settle. */
  assets?: string[];
  /** Position id for close / liquidate / execute-order operations. */
  positionId?: bigint | number;
}

export type FailureClass = 'stale_footprint' | 'try_again_later' | 'none';

export interface PadOptions {
  /** Declared write bytes added per padded key (default 256 — entries here are a few dozen bytes). */
  bytesPerKey?: number;
  /** Resource fee added per padded key in stroops (default 30_000 — well above the per-entry read+write fee). */
  feePerKeyStroops?: bigint;
}

const DEFAULT_BYTES_PER_KEY = 256;
const DEFAULT_FEE_PER_KEY = 30_000n;

/**
 * Ledger key for a `#[contracttype]` enum storage key. Unit variants encode as
 * `ScVec([Symbol(variant)])`, tuple variants append their payload — exactly
 * how the contracts' `DataKey` enums serialise (see `["LastGoodPrice","BTC"]`
 * in any decoded footprint).
 */
export function contractDataKey(
  contract: string,
  variant: string,
  payload: xdr.ScVal[] = [],
  durability: 'persistent' | 'temporary' = 'persistent',
): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contract).toScAddress(),
      key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant), ...payload]),
      durability:
        durability === 'temporary'
          ? xdr.ContractDataDurability.temporary()
          : xdr.ContractDataDurability.persistent(),
    }),
  );
}

const sym = (s: string): xdr.ScVal => xdr.ScVal.scvSymbol(s);
const addr = (a: string): xdr.ScVal => new Address(a).toScVal();
const u64 = (n: bigint | number): xdr.ScVal => nativeToScVal(BigInt(n), { type: 'u64' });

/** Vault buckets every settlement may read or write regardless of outcome. */
function vaultSettlementKeys(vault: string, trader: string): xdr.LedgerKey[] {
  return [
    contractDataKey(vault, 'BufferBalance'),
    contractDataKey(vault, 'TotalUsdc'),
    contractDataKey(vault, 'TotalFees'),
    contractDataKey(vault, 'ShortfallReserve'),
    contractDataKey(vault, 'Shortfall'),
    contractDataKey(vault, 'CumShortfall'),
    contractDataKey(vault, 'ShortfallOwed', [addr(trader)]),
    contractDataKey(vault, 'CumBadDebtCovered'),
    contractDataKey(vault, 'CumBadDebtLpAbsorbed'),
  ];
}

function marketSettlementKeys(market: string, asset: string | undefined): xdr.LedgerKey[] {
  if (!asset) return [];
  return [
    contractDataKey(market, 'AdlActive', [sym(asset)]),
    contractDataKey(market, 'LastGoodPrice', [sym(asset)]),
  ];
}

function openKeys(ctx: KeyCtx): xdr.LedgerKey[] {
  return [
    contractDataKey(ctx.vault, 'BufferBalance'),
    contractDataKey(ctx.vault, 'TotalUsdc'),
    contractDataKey(ctx.vault, 'TotalFees'),
    contractDataKey(ctx.vault, 'ShortfallReserve'),
    ...marketSettlementKeys(ctx.market, ctx.asset).filter((_, i) => i === 1), // LastGoodPrice only
  ];
}

function closeKeys(ctx: KeyCtx): xdr.LedgerKey[] {
  return [...vaultSettlementKeys(ctx.vault, ctx.trader), ...marketSettlementKeys(ctx.market, ctx.asset)];
}

/**
 * Keys the contracts MAY write for `op` depending on transient state. Each
 * list is a superset: declaring a key that ends up unused is harmless.
 */
export function conditionalWriteKeys(op: TradeOp, ctx: KeyCtx): xdr.LedgerKey[] {
  switch (op) {
    case 'open':
    case 'open_cross':
      return openKeys(ctx);
    case 'close':
    case 'close_cross':
    case 'adl':
      return closeKeys(ctx);
    case 'close_partial': {
      // A partial close whose size equals the live position size delegates
      // to the full-close path (market close_position_partial), which writes
      // ClosedProceeds and removes PartialLiqTs. The position can shrink to
      // exactly close_size between simulate and apply (a keeper tranche, a
      // double-submitted "close 50%"), so both are declared up front.
      const keys = closeKeys(ctx);
      if (ctx.positionId !== undefined) {
        keys.push(
          contractDataKey(ctx.market, 'PartialLiqTs', [u64(ctx.positionId)]),
          contractDataKey(ctx.market, 'ClosedProceeds', [u64(ctx.positionId)], 'temporary'),
        );
      }
      return dedupe(keys);
    }
    case 'execute_order': {
      const keys = [...openKeys(ctx), ...closeKeys(ctx)];
      if (ctx.asset) {
        keys.push(
          contractDataKey(ctx.market, 'AssetExposure', [sym(ctx.asset)]),
          contractDataKey(ctx.vault, 'AssetUnrealizedPnl', [sym(ctx.asset)]),
        );
      }
      keys.push(contractDataKey(ctx.vault, 'UnrealizedPnl'), contractDataKey(ctx.vault, 'ReservedPayout'));
      if (ctx.positionId !== undefined) {
        keys.push(contractDataKey(ctx.market, 'ClosedProceeds', [u64(ctx.positionId)], 'temporary'));
      }
      return dedupe(keys);
    }
    case 'liquidate': {
      const keys = [...closeKeys(ctx), contractDataKey(ctx.vault, 'ShortfallReserve')];
      if (ctx.positionId !== undefined) {
        keys.push(
          contractDataKey(ctx.market, 'PartialLiqTs', [u64(ctx.positionId)]),
          contractDataKey(ctx.market, 'ClosedProceeds', [u64(ctx.positionId)], 'temporary'),
        );
      }
      return dedupe(keys);
    }
    case 'liquidate_cross': {
      const keys = [...vaultSettlementKeys(ctx.vault, ctx.trader), contractDataKey(ctx.vault, 'ShortfallReserve')];
      for (const a of ctx.assets ?? (ctx.asset ? [ctx.asset] : [])) {
        keys.push(...marketSettlementKeys(ctx.market, a));
      }
      keys.push(contractDataKey(ctx.market, 'CrossPartialLiqTs', [addr(ctx.trader)]));
      return dedupe(keys);
    }
    case 'place_order':
    case 'cancel_order':
    case 'other':
    default:
      return [];
  }
}

function keyId(k: xdr.LedgerKey): string {
  return k.toXDR('base64');
}

function dedupe(keys: xdr.LedgerKey[]): xdr.LedgerKey[] {
  const seen = new Set<string>();
  const out: xdr.LedgerKey[] = [];
  for (const k of keys) {
    const id = keyId(k);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(k);
  }
  return out;
}

/**
 * Move `keys` into the read-write footprint of an assembled Soroban
 * transaction (out of read-only when present there), and widen the declared
 * write/read bytes and resource fee to pay for them. Idempotent; a no-op for
 * transactions without Soroban data or when every key is already read-write.
 * The inclusion fee is preserved exactly as `withResourceHeadroom` does (the
 * builder adds the resource fee itself, so only the base portion is passed).
 */
export function padFootprint(tx: Transaction, keys: xdr.LedgerKey[], opts: PadOptions = {}): Transaction {
  const sorobanData = tx.toEnvelope().v1().tx().ext().sorobanData();
  if (!sorobanData || keys.length === 0) return tx;

  const wanted = new Map(dedupe(keys).map((k) => [keyId(k), k] as const));
  const res = sorobanData.resources();
  const fp = res.footprint();
  const readOnly = fp.readOnly().filter((k) => !wanted.has(keyId(k)));
  const readWrite = fp.readWrite();
  const present = new Set(readWrite.map(keyId));
  const added = [...wanted.values()].filter((k) => !present.has(keyId(k)));
  const movedFromReadOnly = fp.readOnly().length - readOnly.length;
  if (added.length === 0 && movedFromReadOnly === 0) return tx;

  const bytesPerKey = opts.bytesPerKey ?? DEFAULT_BYTES_PER_KEY;
  const feePerKey = opts.feePerKeyStroops ?? DEFAULT_FEE_PER_KEY;
  const originalResourceFee = BigInt(sorobanData.resourceFee().toString());
  const extraBytes = added.length * bytesPerKey;

  const data = new SorobanDataBuilder(sorobanData)
    .setReadOnly(readOnly)
    .setReadWrite([...readWrite, ...added])
    .setResources(res.instructions(), res.diskReadBytes() + extraBytes, res.writeBytes() + extraBytes)
    .setResourceFee(originalResourceFee + BigInt(added.length) * feePerKey)
    .build();

  const numOps = BigInt(tx.operations.length || 1);
  const basePortion = BigInt(tx.fee) - originalResourceFee;
  const perOpBase = basePortion > 0n ? basePortion / numOps : BigInt(BASE_FEE);

  return TransactionBuilder.cloneFrom(tx, { fee: perOpBase.toString() }).setSorobanData(data).build();
}

/** Inputs to `classifyTxFailure`, all optional — pass whatever the failure surfaced. */
export interface TxFailureFacts {
  /** `sendTransaction` status when the failure happened at send time. */
  sendStatus?: string | null;
  /** Outer transaction result code name (txFailed, txSorobanInvalid, …). */
  txResultCode?: string | null;
  /** Decoded non-contract host error, e.g. `{ type: 'storage', code: 'exceeded_limit' }`. */
  hostError?: { type: string; code: string } | null;
  /** `Error(Contract, #N)` code when the contract itself reverted. */
  contractCode?: number | null;
}

/**
 * Is this failure the "state moved between simulate and apply" class that a
 * fresh rebuild fixes? Contract reverts are never retried — the contract said
 * no, and it will say no again.
 */
export function classifyTxFailure(f: TxFailureFacts): FailureClass {
  if (f.contractCode !== undefined && f.contractCode !== null) return 'none';
  if (f.sendStatus === 'TRY_AGAIN_LATER') return 'try_again_later';
  const code = f.txResultCode ?? '';
  if (/^txSorobanInvalid$/i.test(code) || /^txInsufficientRefundableFee$/i.test(code)) return 'stale_footprint';
  const he = f.hostError;
  if (he && he.code === 'exceeded_limit' && (he.type === 'storage' || he.type === 'budget')) {
    return 'stale_footprint';
  }
  return 'none';
}
