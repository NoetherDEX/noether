import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import {
  classifyTxFailure,
  conditionalWriteKeys,
  contractDataKey,
  padFootprint,
  type KeyCtx,
} from '../src/footprintGuard.js';

const VAULT = 'CBSWA5P75NGV2LP5KOY7A7LOAX2CENI5OYBSJ5IVLHENKQJF2I3ZBSYE';
const MARKET = 'CBHHWFAYLB3SXJCE232DC6WNSK74IBEOROAGCI2AFBA2H5NQOH2KYKNN';
const TRADER = Keypair.random().publicKey();
const ctx: KeyCtx = { vault: VAULT, market: MARKET, trader: TRADER, asset: 'BTC', positionId: 22404n };

const id = (k: xdr.LedgerKey) => k.toXDR('base64');
const names = (keys: xdr.LedgerKey[]) =>
  keys.map((k) => {
    const cd = k.contractData();
    const vec = cd.key().vec() ?? [];
    return vec[0]?.sym().toString() ?? '?';
  });

/** An assembled-looking Soroban tx with a given footprint (no network). */
function sorobanTx(readOnly: xdr.LedgerKey[], readWrite: xdr.LedgerKey[], resourceFee = 100_000n) {
  const source = new Account(TRADER, '1');
  const data = new SorobanDataBuilder()
    .setReadOnly(readOnly)
    .setReadWrite(readWrite)
    .setResources(1_000_000, 145, 7_850)
    .setResourceFee(resourceFee)
    .build();
  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(MARKET).call('close_position', new Address(TRADER).toScVal()))
    .setTimeout(300)
    .setSorobanData(data)
    .build();
}

describe('contractDataKey', () => {
  it('encodes unit and tuple enum variants the way #[contracttype] does', () => {
    const unit = contractDataKey(VAULT, 'BufferBalance').contractData();
    expect(unit.key().vec()!.map((v) => v.sym().toString())).toEqual(['BufferBalance']);
    expect(unit.durability().name).toBe('persistent');

    const tuple = contractDataKey(MARKET, 'LastGoodPrice', [xdr.ScVal.scvSymbol('BTC')]).contractData();
    const vec = tuple.key().vec()!;
    expect(vec[0]!.sym().toString()).toBe('LastGoodPrice');
    expect(vec[1]!.sym().toString()).toBe('BTC');

    const temp = contractDataKey(MARKET, 'ClosedProceeds', [], 'temporary').contractData();
    expect(temp.durability().name).toBe('temporary');
  });
});

describe('conditionalWriteKeys', () => {
  it('lists the vault buckets and market flags a close may write', () => {
    const keys = names(conditionalWriteKeys('close', ctx));
    expect(keys).toEqual([
      'BufferBalance', 'TotalUsdc', 'TotalFees', 'ShortfallReserve', 'Shortfall', 'CumShortfall',
      'ShortfallOwed', 'CumBadDebtCovered', 'CumBadDebtLpAbsorbed', 'AdlActive', 'LastGoodPrice',
    ]);
  });

  it('scopes ShortfallOwed to the trader and the market flags to the asset', () => {
    const keys = conditionalWriteKeys('close', ctx);
    const owed = keys.find((k) => names([k])[0] === 'ShortfallOwed')!.contractData().key().vec()!;
    expect(Address.fromScVal(owed[1]!).toString()).toBe(TRADER);
    const adl = keys.find((k) => names([k])[0] === 'AdlActive')!.contractData().key().vec()!;
    expect(adl[1]!.sym().toString()).toBe('BTC');
  });

  it('opens pad the buffer/LP buckets and last-good price only', () => {
    expect(names(conditionalWriteKeys('open', ctx))).toEqual([
      'BufferBalance', 'TotalUsdc', 'TotalFees', 'ShortfallReserve', 'LastGoodPrice',
    ]);
    expect(conditionalWriteKeys('place_order', ctx)).toEqual([]);
    expect(conditionalWriteKeys('cancel_order', ctx)).toEqual([]);
  });

  it('liquidations add the partial-liq timestamp and closed-proceeds entries', () => {
    const keys = names(conditionalWriteKeys('liquidate', ctx));
    expect(keys).toContain('PartialLiqTs');
    expect(keys).toContain('ClosedProceeds');
    const cross = names(conditionalWriteKeys('liquidate_cross', { ...ctx, assets: ['BTC', 'ETH'] }));
    expect(cross.filter((n) => n === 'AdlActive')).toHaveLength(2);
    expect(cross).toContain('CrossPartialLiqTs');
  });

  it('never repeats a key', () => {
    for (const op of ['close', 'open', 'execute_order', 'liquidate', 'liquidate_cross', 'adl'] as const) {
      const keys = conditionalWriteKeys(op, { ...ctx, assets: ['BTC', 'ETH'] });
      expect(new Set(keys.map(id)).size).toBe(keys.length);
    }
  });
});

describe('padFootprint', () => {
  const buffer = contractDataKey(VAULT, 'BufferBalance');
  const totalUsdc = contractDataKey(VAULT, 'TotalUsdc');
  const position = contractDataKey(MARKET, 'Position', [xdr.ScVal.scvU64(new xdr.Uint64(22404))]);

  it('moves a read-only key into read-write and appends missing ones, bumping bytes and fee', () => {
    const tx = sorobanTx([buffer], [position]);
    const padded = padFootprint(tx, [buffer, totalUsdc]);
    const data = padded.toEnvelope().v1().tx().ext().sorobanData()!;
    const fp = data.resources().footprint();
    expect(fp.readOnly().map(id)).toEqual([]);
    expect(fp.readWrite().map(id)).toEqual([position, buffer, totalUsdc].map(id));
    expect(data.resources().writeBytes()).toBe(7_850 + 2 * 256);
    expect(data.resources().diskReadBytes()).toBe(145 + 2 * 256);
    expect(BigInt(data.resourceFee().toString())).toBe(100_000n + 2n * 30_000n);
    // Inclusion fee (BASE_FEE per op) is preserved; the total = inclusion + resource fee.
    expect(BigInt(padded.fee)).toBe(BigInt(BASE_FEE) + 160_000n);
  });

  it('is idempotent and a no-op when every key is already read-write', () => {
    const tx = sorobanTx([], [position, buffer]);
    const once = padFootprint(tx, [buffer]);
    expect(once.toXDR()).toBe(tx.toXDR());
    const twice = padFootprint(padFootprint(tx, [totalUsdc]), [totalUsdc]);
    const fp = twice.toEnvelope().v1().tx().ext().sorobanData()!.resources().footprint();
    expect(fp.readWrite().filter((k) => id(k) === id(totalUsdc))).toHaveLength(1);
  });

  it('passes classic transactions through untouched', () => {
    const source = new Account(TRADER, '1');
    const classic = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(new Contract(MARKET).call('noop'))
      .setTimeout(30)
      .build();
    expect(padFootprint(classic, [buffer]).toXDR()).toBe(classic.toXDR());
  });
});

describe('classifyTxFailure', () => {
  it('flags footprint/budget traps and stale-resource result codes', () => {
    expect(classifyTxFailure({ hostError: { type: 'storage', code: 'exceeded_limit' } })).toBe('stale_footprint');
    expect(classifyTxFailure({ hostError: { type: 'budget', code: 'exceeded_limit' } })).toBe('stale_footprint');
    expect(classifyTxFailure({ txResultCode: 'txSorobanInvalid' })).toBe('stale_footprint');
    expect(classifyTxFailure({ txResultCode: 'txInsufficientRefundableFee' })).toBe('stale_footprint');
  });

  it('flags a full RPC queue as try-again-later', () => {
    expect(classifyTxFailure({ sendStatus: 'TRY_AGAIN_LATER' })).toBe('try_again_later');
  });

  it('never retries a contract revert or an unrelated failure', () => {
    expect(classifyTxFailure({ contractCode: 30, hostError: { type: 'storage', code: 'exceeded_limit' } })).toBe('none');
    expect(classifyTxFailure({ txResultCode: 'txBadSeq' })).toBe('none');
    expect(classifyTxFailure({ hostError: { type: 'wasm_vm', code: 'invalid_action' } })).toBe('none');
    expect(classifyTxFailure({})).toBe('none');
  });
});

describe('web copy drift guard', () => {
  it('web/lib/stellar/footprintGuard.ts is byte-identical to the canonical module', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const canonical = resolve(here, '../src/footprintGuard.ts');
    const webCopy = resolve(here, '../../../web/lib/stellar/footprintGuard.ts');
    if (!existsSync(webCopy)) return; // published package checkouts have no web/
    expect(readFileSync(webCopy, 'utf8')).toBe(readFileSync(canonical, 'utf8'));
  });
});
