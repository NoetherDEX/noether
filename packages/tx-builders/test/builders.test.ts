import { describe, expect, it } from 'vitest';
import { StrKey, scValToNative } from '@stellar/stellar-sdk';
import { Market, Referral, Router, buildInvokeOp, toScVal } from '../src/index.js';
import type { PriceAttestation } from '../src/router/index.js';

// Fixed, valid StrKey inputs so every op XDR below is fully deterministic.
const MARKET = 'CC2HH34Q7GOMNBNPSNSQIIUSYYXLYLOOLMUY3ZTFFBLJ2DENWHGS6GNB';
const ROUTER = 'CCEQJKB3WVADOSCLCMFXL3VBZ4RKYEGFCG4SJVPERLFEWSIFMIWROLZA';
const TRADER = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';
const KEEPER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));

const ATT: PriceAttestation = {
  asset: 'BTC',
  prices: [700_000_000_000n],
  timestamp: 1_700_000_000,
  roundId: 42,
  pubkeys: ['11'.repeat(32)],
  sigs: ['22'.repeat(64)],
};

// ───────────────────────────────────────────────────────────────────────────
// scval.ts — pin the primitive encodings nothing else was guarding.
// ───────────────────────────────────────────────────────────────────────────

describe('scval encodings', () => {
  it('encodes Direction as u32 (Long=0, Short=1)', () => {
    const long = toScVal('Long', 'direction');
    expect(long.switch().name).toBe('scvU32');
    expect(long.u32()).toBe(0);
    const short = toScVal('Short', 'direction');
    expect(short.switch().name).toBe('scvU32');
    expect(short.u32()).toBe(1);
  });

  it('encodes TriggerCondition as bool (Above=true, Below=false)', () => {
    const above = toScVal('Above', 'trigger_above');
    expect(above.switch().name).toBe('scvBool');
    expect(above.b()).toBe(true);
    const below = toScVal('Below', 'trigger_above');
    expect(below.switch().name).toBe('scvBool');
    expect(below.b()).toBe(false);
  });

  it('encodes i128 as hi/lo parts', () => {
    const small = toScVal(700_000_000_000n, 'i128');
    expect(small.switch().name).toBe('scvI128');
    expect(small.i128().hi().toString()).toBe('0');
    expect(small.i128().lo().toString()).toBe('700000000000');

    const big = toScVal((1n << 70n) + 5n, 'i128');
    expect(big.i128().hi().toString()).toBe('64');
    expect(big.i128().lo().toString()).toBe('5');
    expect(scValToNative(big)).toBe((1n << 70n) + 5n);
  });

  it('encodes a single BytesN from hex or a byte array', () => {
    const fromHex = toScVal('11'.repeat(32), 'bytes');
    expect(fromHex.switch().name).toBe('scvBytes');
    expect(fromHex.bytes().toString('hex')).toBe('11'.repeat(32));
    const fromBytes = toScVal(new Uint8Array(64).fill(0x22), 'bytes');
    expect(fromBytes.bytes()).toHaveLength(64);
  });

  it('encodes Vec<BytesN> as scvVec of scvBytes', () => {
    const v = toScVal(['11'.repeat(32), new Uint8Array(64).fill(0x22)], 'bytes_vec');
    expect(v.switch().name).toBe('scvVec');
    const items = v.vec()!;
    expect(items).toHaveLength(2);
    expect(items[0]!.switch().name).toBe('scvBytes');
    expect(items[0]!.bytes()).toHaveLength(32);
    expect(items[1]!.bytes()).toHaveLength(64);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Market builders — direct market calls (fallback path).
// ───────────────────────────────────────────────────────────────────────────

describe('market builder XDR', () => {
  it('open_position', () => {
    const params = { trader: TRADER, asset: 'BTC', collateral: 1_000_000_000n, leverage: 5, direction: 'Long' as const };
    const args = Market.buildOpenPositionArgs(params);
    expect(args).toHaveLength(5);
    expect(args[3]!.u32()).toBe(5);
    expect(args[4]!.switch().name).toBe('scvU32');
    expect(args[4]!.u32()).toBe(0);
    expect(Market.buildOpenPositionOp(MARKET, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAbRz75D5nMaFr5NlBCKSxi68Lc5bKY3mZShWnQyNsc0vAAAADW9wZW5fcG9zaXRpb24AAAAAAAAFAAAAEgAAAAAAAAAAlIo6attsPe3NP+cCRFJZBXXaDAb/88kx4TTK/U+BQQUAAAAPAAAAA0JUQwAAAAAKAAAAAAAAAAAAAAAAO5rKAAAAAAMAAAAFAAAAAwAAAAAAAAAA"`);
  });

  it('close_position', () => {
    const params = { trader: TRADER, positionId: 7 };
    const args = Market.buildClosePositionArgs(params);
    expect(args).toHaveLength(2);
    expect(args[1]!.switch().name).toBe('scvU64');
    expect(Market.buildClosePositionOp(MARKET, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAbRz75D5nMaFr5NlBCKSxi68Lc5bKY3mZShWnQyNsc0vAAAADmNsb3NlX3Bvc2l0aW9uAAAAAAACAAAAEgAAAAAAAAAAlIo6attsPe3NP+cCRFJZBXXaDAb/88kx4TTK/U+BQQUAAAAFAAAAAAAAAAcAAAAA"`);
  });

  it('place_limit_order', () => {
    const params = {
      trader: TRADER,
      asset: 'ETH',
      direction: 'Short' as const,
      collateral: 1_000_000_000n,
      leverage: 3,
      triggerPrice: 650_000_000_000n,
      triggerCondition: 'Below' as const,
      slippageToleranceBps: 50,
      timeInForce: 1 | 0x100, // IOC + reduce-only — pins the bit-8 packing
    };
    const args = Market.buildPlaceLimitOrderArgs(params);
    expect(args).toHaveLength(9);
    expect(args[6]!.switch().name).toBe('scvBool');
    expect(args[6]!.b()).toBe(false);
    expect(args[8]!.switch().name).toBe('scvU32');
    expect(args[8]!.u32()).toBe(257);
    // Omitted timeInForce defaults to 0 (GTC) — the deployed 9-arg signature is always satisfied.
    const defaulted = Market.buildPlaceLimitOrderArgs({ ...params, timeInForce: undefined });
    expect(defaulted).toHaveLength(9);
    expect(defaulted[8]!.u32()).toBe(0);
    expect(Market.buildPlaceLimitOrderOp(MARKET, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAbRz75D5nMaFr5NlBCKSxi68Lc5bKY3mZShWnQyNsc0vAAAAEXBsYWNlX2xpbWl0X29yZGVyAAAAAAAACQAAABIAAAAAAAAAAJSKOmrbbD3tzT/nAkRSWQV12gwG//PJMeE0yv1PgUEFAAAADwAAAANFVEgAAAAAAwAAAAEAAAAKAAAAAAAAAAAAAAAAO5rKAAAAAAMAAAADAAAACgAAAAAAAAAAAAAAl1cE5AAAAAAAAAAAAAAAAAMAAAAyAAAAAwAAAQEAAAAA"`);
  });

  it('place_stop_limit_order', () => {
    const params = {
      trader: TRADER,
      asset: 'BTC',
      direction: 'Long' as const,
      collateral: 1_000_000_000n,
      leverage: 10,
      triggerPrice: 650_000_000_000n,
      limitPrice: 660_000_000_000n,
      triggerCondition: 'Above' as const,
      slippageToleranceBps: 25,
    };
    const args = Market.buildPlaceStopLimitOrderArgs(params);
    expect(args).toHaveLength(10);
    expect(args[7]!.switch().name).toBe('scvBool');
    expect(args[7]!.b()).toBe(true);
    expect(args[9]!.switch().name).toBe('scvU32');
    expect(args[9]!.u32()).toBe(0);
    expect(Market.buildPlaceStopLimitOrderOp(MARKET, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAbRz75D5nMaFr5NlBCKSxi68Lc5bKY3mZShWnQyNsc0vAAAAFnBsYWNlX3N0b3BfbGltaXRfb3JkZXIAAAAAAAoAAAASAAAAAAAAAACUijpq22w97c0/5wJEUlkFddoMBv/zyTHhNMr9T4FBBQAAAA8AAAADQlRDAAAAAAMAAAAAAAAACgAAAAAAAAAAAAAAADuaygAAAAADAAAACgAAAAoAAAAAAAAAAAAAAJdXBOQAAAAACgAAAAAAAAAAAAAAmasQyAAAAAAAAAAAAQAAAAMAAAAZAAAAAwAAAAAAAAAA"`);
  });

  it('set_stop_loss', () => {
    const params = { trader: TRADER, positionId: 7, triggerPrice: 580_000_000_000n, slippageToleranceBps: 50 };
    const args = Market.buildSetStopLossArgs(params);
    expect(args).toHaveLength(4);
    expect(args[1]!.switch().name).toBe('scvU64');
    expect(Market.buildSetStopLossOp(MARKET, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAbRz75D5nMaFr5NlBCKSxi68Lc5bKY3mZShWnQyNsc0vAAAADXNldF9zdG9wX2xvc3MAAAAAAAAEAAAAEgAAAAAAAAAAlIo6attsPe3NP+cCRFJZBXXaDAb/88kx4TTK/U+BQQUAAAAFAAAAAAAAAAcAAAAKAAAAAAAAAAAAAACHCrGoAAAAAAMAAAAyAAAAAA=="`);
  });

  it('set_take_profit', () => {
    const params = {
      trader: TRADER,
      positionId: 7,
      triggerPrice: 720_000_000_000n,
      slippageToleranceBps: 50,
      limitPrice: 715_000_000_000n,
    };
    const args = Market.buildSetTakeProfitArgs(params);
    expect(args).toHaveLength(5);
    expect(args[4]!.switch().name).toBe('scvI128');
    // Omitted limitPrice defaults to 0 (plain TP) — still the deployed 5-arg signature.
    const defaulted = Market.buildSetTakeProfitArgs({ ...params, limitPrice: undefined });
    expect(defaulted).toHaveLength(5);
    expect(Market.buildSetTakeProfitOp(MARKET, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAbRz75D5nMaFr5NlBCKSxi68Lc5bKY3mZShWnQyNsc0vAAAAD3NldF90YWtlX3Byb2ZpdAAAAAAFAAAAEgAAAAAAAAAAlIo6attsPe3NP+cCRFJZBXXaDAb/88kx4TTK/U+BQQUAAAAFAAAAAAAAAAcAAAAKAAAAAAAAAAAAAACno1ggAAAAAAMAAAAyAAAACgAAAAAAAAAAAAAApnlSLgAAAAAA"`);
  });

  it('place_trailing_stop', () => {
    const params = { trader: TRADER, positionId: 7, trailingPercentBps: 200, slippageToleranceBps: 50 };
    const args = Market.buildPlaceTrailingStopArgs(params);
    expect(args).toHaveLength(4);
    expect(Market.buildPlaceTrailingStopOp(MARKET, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAbRz75D5nMaFr5NlBCKSxi68Lc5bKY3mZShWnQyNsc0vAAAAE3BsYWNlX3RyYWlsaW5nX3N0b3AAAAAABAAAABIAAAAAAAAAAJSKOmrbbD3tzT/nAkRSWQV12gwG//PJMeE0yv1PgUEFAAAABQAAAAAAAAAHAAAAAwAAAMgAAAADAAAAMgAAAAA="`);
  });

  it('cancel_order', () => {
    const params = { trader: TRADER, orderId: 12 };
    const args = Market.buildCancelOrderArgs(params);
    expect(args).toHaveLength(2);
    expect(args[1]!.switch().name).toBe('scvU64');
    expect(Market.buildCancelOrderOp(MARKET, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAbRz75D5nMaFr5NlBCKSxi68Lc5bKY3mZShWnQyNsc0vAAAADGNhbmNlbF9vcmRlcgAAAAIAAAASAAAAAAAAAACUijpq22w97c0/5wJEUlkFddoMBv/zyTHhNMr9T4FBBQAAAAUAAAAAAAAADAAAAAA="`);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Router builders — verify-then-trade, Batch-1 quorum ABI (L0-8): every
// entry point ends in ONE PriceAttestation struct; the asset rides inside.
// ───────────────────────────────────────────────────────────────────────────

function expectAttestationStruct(att: ReturnType<typeof toScVal>): void {
  expect(att.switch().name).toBe('scvMap');
  const entries = att.map()!;
  // Soroban UDT maps are key-sorted; a wrong order fails on-chain decode.
  expect(entries.map((e) => e.key().sym().toString())).toEqual([
    'asset',
    'prices',
    'pubkeys',
    'round_id',
    'sigs',
    'timestamp',
  ]);
  expect(entries[1]!.val().vec()![0]!.switch().name).toBe('scvI128');
  expect(entries[2]!.val().vec()![0]!.bytes()).toHaveLength(32);
  expect(entries[4]!.val().vec()![0]!.bytes()).toHaveLength(64);
}

describe('router builder XDR', () => {
  it('open_with_price', () => {
    const params = {
      trader: TRADER,
      collateral: 1_000_000_000n,
      leverage: 5,
      direction: 'Long' as const,
      acceptablePrice: 710_000_000_000n,
      attestation: ATT,
    };
    const args = Router.buildOpenWithPriceArgs(params);
    expect(args).toHaveLength(6);
    expect(args[3]!.u32()).toBe(0); // direction Long
    expect(args[4]!.switch().name).toBe('scvI128'); // acceptable_price
    expectAttestationStruct(args[5]!);
    expect(Router.buildOpenWithPriceOp(ROUTER, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAYkEqDu1QDdISxMLde6hzyKsEMURuSTV5IrKS0kFYi0XAAAAD29wZW5fd2l0aF9wcmljZQAAAAAGAAAAEgAAAAAAAAAAlIo6attsPe3NP+cCRFJZBXXaDAb/88kx4TTK/U+BQQUAAAAKAAAAAAAAAAAAAAAAO5rKAAAAAAMAAAAFAAAAAwAAAAAAAAAKAAAAAAAAAAAAAAClT0w8AAAAABEAAAABAAAABgAAAA8AAAAFYXNzZXQAAAAAAAAPAAAAA0JUQwAAAAAPAAAABnByaWNlcwAAAAAAEAAAAAEAAAABAAAACgAAAAAAAAAAAAAAovtAWAAAAAAPAAAAB3B1YmtleXMAAAAAEAAAAAEAAAABAAAADQAAACAREREREREREREREREREREREREREREREREREREREREREQAAAA8AAAAIcm91bmRfaWQAAAAFAAAAAAAAACoAAAAPAAAABHNpZ3MAAAAQAAAAAQAAAAEAAAANAAAAQCIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIAAAAPAAAACXRpbWVzdGFtcAAAAAAAAAUAAAAAZVPxAAAAAAA="`);
  });

  it('close_with_price', () => {
    const params = {
      trader: TRADER,
      positionId: 7,
      acceptablePrice: 0n,
      attestation: { ...ATT, asset: 'ETH' },
    };
    const args = Router.buildCloseWithPriceArgs(params);
    expect(args).toHaveLength(4);
    expect(args[1]!.switch().name).toBe('scvU64');
    expect(args[2]!.switch().name).toBe('scvI128');
    expectAttestationStruct(args[3]!);
    expect(Router.buildCloseWithPriceOp(ROUTER, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAYkEqDu1QDdISxMLde6hzyKsEMURuSTV5IrKS0kFYi0XAAAAEGNsb3NlX3dpdGhfcHJpY2UAAAAEAAAAEgAAAAAAAAAAlIo6attsPe3NP+cCRFJZBXXaDAb/88kx4TTK/U+BQQUAAAAFAAAAAAAAAAcAAAAKAAAAAAAAAAAAAAAAAAAAAAAAABEAAAABAAAABgAAAA8AAAAFYXNzZXQAAAAAAAAPAAAAA0VUSAAAAAAPAAAABnByaWNlcwAAAAAAEAAAAAEAAAABAAAACgAAAAAAAAAAAAAAovtAWAAAAAAPAAAAB3B1YmtleXMAAAAAEAAAAAEAAAABAAAADQAAACAREREREREREREREREREREREREREREREREREREREREREQAAAA8AAAAIcm91bmRfaWQAAAAFAAAAAAAAACoAAAAPAAAABHNpZ3MAAAAQAAAAAQAAAAEAAAANAAAAQCIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIAAAAPAAAACXRpbWVzdGFtcAAAAAAAAAUAAAAAZVPxAAAAAAA="`);
  });

  it('close_partial_with_price', () => {
    const params = {
      trader: TRADER,
      positionId: 7,
      closeSize: 500_000_000n,
      attestation: { ...ATT, asset: 'ETH' },
    };
    const args = Router.buildClosePartialWithPriceArgs(params);
    expect(args).toHaveLength(4);
    expect(args[2]!.switch().name).toBe('scvI128');
    expectAttestationStruct(args[3]!);
    expect(Router.buildClosePartialWithPriceOp(ROUTER, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAYkEqDu1QDdISxMLde6hzyKsEMURuSTV5IrKS0kFYi0XAAAAGGNsb3NlX3BhcnRpYWxfd2l0aF9wcmljZQAAAAQAAAASAAAAAAAAAACUijpq22w97c0/5wJEUlkFddoMBv/zyTHhNMr9T4FBBQAAAAUAAAAAAAAABwAAAAoAAAAAAAAAAAAAAAAdzWUAAAAAEQAAAAEAAAAGAAAADwAAAAVhc3NldAAAAAAAAA8AAAADRVRIAAAAAA8AAAAGcHJpY2VzAAAAAAAQAAAAAQAAAAEAAAAKAAAAAAAAAAAAAACi+0BYAAAAAA8AAAAHcHVia2V5cwAAAAAQAAAAAQAAAAEAAAANAAAAIBERERERERERERERERERERERERERERERERERERERERERAAAADwAAAAhyb3VuZF9pZAAAAAUAAAAAAAAAKgAAAA8AAAAEc2lncwAAABAAAAABAAAAAQAAAA0AAABAIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIgAAAA8AAAAJdGltZXN0YW1wAAAAAAAABQAAAABlU/EAAAAAAA=="`);
  });

  it('liquidate_with_price', () => {
    const params = { keeper: KEEPER, positionId: 7, attestation: ATT };
    const args = Router.buildLiquidateWithPriceArgs(params);
    expect(args).toHaveLength(3);
    expect(args[0]!.switch().name).toBe('scvAddress');
    expectAttestationStruct(args[2]!);
    expect(Router.buildLiquidateWithPriceOp(ROUTER, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAYkEqDu1QDdISxMLde6hzyKsEMURuSTV5IrKS0kFYi0XAAAAFGxpcXVpZGF0ZV93aXRoX3ByaWNlAAAAAwAAABIAAAAAAAAAAAcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHAAAABQAAAAAAAAAHAAAAEQAAAAEAAAAGAAAADwAAAAVhc3NldAAAAAAAAA8AAAADQlRDAAAAAA8AAAAGcHJpY2VzAAAAAAAQAAAAAQAAAAEAAAAKAAAAAAAAAAAAAACi+0BYAAAAAA8AAAAHcHVia2V5cwAAAAAQAAAAAQAAAAEAAAANAAAAIBERERERERERERERERERERERERERERERERERERERERERAAAADwAAAAhyb3VuZF9pZAAAAAUAAAAAAAAAKgAAAA8AAAAEc2lncwAAABAAAAABAAAAAQAAAA0AAABAIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIgAAAA8AAAAJdGltZXN0YW1wAAAAAAAABQAAAABlU/EAAAAAAA=="`);
  });

  it('adl_with_price', () => {
    const params = { caller: KEEPER, positionId: 9, attestation: ATT };
    const args = Router.buildAdlWithPriceArgs(params);
    expect(args).toHaveLength(3);
    expectAttestationStruct(args[2]!);
    expect(Router.buildAdlWithPriceOp(ROUTER, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAYkEqDu1QDdISxMLde6hzyKsEMURuSTV5IrKS0kFYi0XAAAADmFkbF93aXRoX3ByaWNlAAAAAAADAAAAEgAAAAAAAAAABwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcAAAAFAAAAAAAAAAkAAAARAAAAAQAAAAYAAAAPAAAABWFzc2V0AAAAAAAADwAAAANCVEMAAAAADwAAAAZwcmljZXMAAAAAABAAAAABAAAAAQAAAAoAAAAAAAAAAAAAAKL7QFgAAAAADwAAAAdwdWJrZXlzAAAAABAAAAABAAAAAQAAAA0AAAAgEREREREREREREREREREREREREREREREREREREREREREAAAAPAAAACHJvdW5kX2lkAAAABQAAAAAAAAAqAAAADwAAAARzaWdzAAAAEAAAAAEAAAABAAAADQAAAEAiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiAAAADwAAAAl0aW1lc3RhbXAAAAAAAAAFAAAAAGVT8QAAAAAA"`);
  });

  it('execute_with_price', () => {
    const params = { keeper: KEEPER, orderId: 12, attestation: { ...ATT, asset: 'XLM' } };
    const args = Router.buildExecuteWithPriceArgs(params);
    expect(args).toHaveLength(3);
    expect(args[1]!.switch().name).toBe('scvU64');
    expectAttestationStruct(args[2]!);
    expect(Router.buildExecuteWithPriceOp(ROUTER, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAYkEqDu1QDdISxMLde6hzyKsEMURuSTV5IrKS0kFYi0XAAAAEmV4ZWN1dGVfd2l0aF9wcmljZQAAAAAAAwAAABIAAAAAAAAAAAcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHAAAABQAAAAAAAAAMAAAAEQAAAAEAAAAGAAAADwAAAAVhc3NldAAAAAAAAA8AAAADWExNAAAAAA8AAAAGcHJpY2VzAAAAAAAQAAAAAQAAAAEAAAAKAAAAAAAAAAAAAACi+0BYAAAAAA8AAAAHcHVia2V5cwAAAAAQAAAAAQAAAAEAAAANAAAAIBERERERERERERERERERERERERERERERERERERERERERAAAADwAAAAhyb3VuZF9pZAAAAAUAAAAAAAAAKgAAAA8AAAAEc2lncwAAABAAAAABAAAAAQAAAA0AAABAIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIgAAAA8AAAAJdGltZXN0YW1wAAAAAAAABQAAAABlU/EAAAAAAA=="`);
  });

  it('liquidate_cross_with_prices', () => {
    const params = {
      keeper: KEEPER,
      trader: TRADER,
      attestations: [ATT, { ...ATT, asset: 'XLM', prices: [1_000_000n] }],
    };
    const args = Router.buildLiquidateCrossWithPricesArgs(params);
    expect(args).toHaveLength(3);
    expect(args[2]!.switch().name).toBe('scvVec');
    expect(args[2]!.vec()).toHaveLength(2);
    expectAttestationStruct(args[2]!.vec()![0]!);
    expect(Router.buildLiquidateCrossWithPricesOp(ROUTER, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAYkEqDu1QDdISxMLde6hzyKsEMURuSTV5IrKS0kFYi0XAAAAG2xpcXVpZGF0ZV9jcm9zc193aXRoX3ByaWNlcwAAAAADAAAAEgAAAAAAAAAABwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcAAAASAAAAAAAAAACUijpq22w97c0/5wJEUlkFddoMBv/zyTHhNMr9T4FBBQAAABAAAAABAAAAAgAAABEAAAABAAAABgAAAA8AAAAFYXNzZXQAAAAAAAAPAAAAA0JUQwAAAAAPAAAABnByaWNlcwAAAAAAEAAAAAEAAAABAAAACgAAAAAAAAAAAAAAovtAWAAAAAAPAAAAB3B1YmtleXMAAAAAEAAAAAEAAAABAAAADQAAACAREREREREREREREREREREREREREREREREREREREREREQAAAA8AAAAIcm91bmRfaWQAAAAFAAAAAAAAACoAAAAPAAAABHNpZ3MAAAAQAAAAAQAAAAEAAAANAAAAQCIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIAAAAPAAAACXRpbWVzdGFtcAAAAAAAAAUAAAAAZVPxAAAAABEAAAABAAAABgAAAA8AAAAFYXNzZXQAAAAAAAAPAAAAA1hMTQAAAAAPAAAABnByaWNlcwAAAAAAEAAAAAEAAAABAAAACgAAAAAAAAAAAAAAAAAPQkAAAAAPAAAAB3B1YmtleXMAAAAAEAAAAAEAAAABAAAADQAAACAREREREREREREREREREREREREREREREREREREREREREQAAAA8AAAAIcm91bmRfaWQAAAAFAAAAAAAAACoAAAAPAAAABHNpZ3MAAAAQAAAAAQAAAAEAAAANAAAAQCIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIAAAAPAAAACXRpbWVzdGFtcAAAAAAAAAUAAAAAZVPxAAAAAAA="`);
  });

  it('multi-publisher bundle keeps arrays aligned in the struct', () => {
    const quorum: PriceAttestation = {
      asset: 'BTC',
      prices: [700_000_000_000n, 702_000_000_000n],
      timestamp: 1_700_000_000,
      roundId: 42,
      pubkeys: ['11'.repeat(32), '33'.repeat(32)],
      sigs: ['22'.repeat(64), '44'.repeat(64)],
    };
    const att = Router.attestationStructArg(quorum);
    const entries = att.map()!;
    expect(entries[1]!.val().vec()).toHaveLength(2); // prices
    expect(entries[2]!.val().vec()).toHaveLength(2); // pubkeys
    expect(entries[4]!.val().vec()).toHaveLength(2); // sigs
  });

  it('buildInvokeOp matches the per-builder op helper', () => {
    const params = {
      trader: TRADER,
      collateral: 1_000_000_000n,
      leverage: 5,
      direction: 'Long' as const,
      acceptablePrice: 0n,
      attestation: ATT,
    };
    const viaHelper = Router.buildOpenWithPriceOp(ROUTER, params).toXDR('base64');
    const viaGeneric = buildInvokeOp(ROUTER, 'open_with_price', Router.buildOpenWithPriceArgs(params)).toXDR('base64');
    expect(viaGeneric).toBe(viaHelper);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Referral builders (L1-18) — the wallet-only claim, single source of truth
// for web + both SDKs. Snapshot pins the XDR (the G-6 drift-class guard).
// ───────────────────────────────────────────────────────────────────────────

describe('referral builders', () => {
  it('claim', () => {
    const params = { referrer: TRADER };
    const args = Referral.buildReferralClaimArgs(params);
    expect(args).toHaveLength(1);
    expect(args[0]!.switch().name).toBe('scvAddress');
    expect(Referral.buildReferralClaimOp(MARKET, params).toXDR('base64')).toMatchInlineSnapshot(`"AAAAAAAAABgAAAAAAAAAAbRz75D5nMaFr5NlBCKSxi68Lc5bKY3mZShWnQyNsc0vAAAABWNsYWltAAAAAAAAAQAAABIAAAAAAAAAAJSKOmrbbD3tzT/nAkRSWQV12gwG//PJMeE0yv1PgUEFAAAAAA=="`);
  });
});
