import { describe, expect, it } from 'vitest';
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { decodeMarketEvent, type RawEvent } from '../src/decoders/market.js';

const FAKE_CONTRACT = 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD';
const FAKE_TRADER = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';
const FAKE_TX_HASH = 'a'.repeat(64);

function makeRawEvent(topic: string, value: xdr.ScVal, ledger = 100): RawEvent {
  return {
    id: `${ledger}-1`,
    contractId: FAKE_CONTRACT,
    type: 'contract',
    topic: [nativeToScVal(topic, { type: 'symbol' })],
    value,
    ledger,
    ledgerClosedAt: '2026-04-29T00:00:00Z',
    txHash: FAKE_TX_HASH,
    transactionIndex: 0,
    operationIndex: 0,
    inSuccessfulContractCall: true,
  } as unknown as RawEvent;
}

function vec(...vals: xdr.ScVal[]): xdr.ScVal {
  return xdr.ScVal.scvVec(vals);
}

describe('decodeMarketEvent', () => {
  it('decodes position_opened', () => {
    // Contract emits 6-tuple: (id, trader, asset, direction, size, entry_price)
    const value = vec(
      nativeToScVal(42n, { type: 'u64' }),
      Address.fromString(FAKE_TRADER).toScVal(),
      nativeToScVal('BTC', { type: 'symbol' }),
      nativeToScVal(0n, { type: 'u32' }), // direction (Long=0)
      nativeToScVal(1_500_0000000n, { type: 'i128' }),
      nativeToScVal(60_000_0000000n, { type: 'i128' }),
    );
    const decoded = decodeMarketEvent(makeRawEvent('position_opened', value));
    expect(decoded?.topic).toBe('position_opened');
    if (decoded?.topic !== 'position_opened') throw new Error('wrong topic');
    expect(decoded.positionId).toBe(42);
    expect(decoded.trader).toBe(FAKE_TRADER);
    expect(decoded.size).toBe(1_500_0000000n);
    expect(decoded.entryPrice).toBe(60_000_0000000n);
    expect(decoded.contractId).toBe(FAKE_CONTRACT);
    expect(decoded.txHash).toBe(FAKE_TX_HASH);
  });

  it('decodes position_closed', () => {
    // Contract emits 8-tuple:
    //   (id, trader, asset, direction, size, entry_price, current_price, pnl)
    const value = vec(
      nativeToScVal(7n, { type: 'u64' }),
      Address.fromString(FAKE_TRADER).toScVal(),
      nativeToScVal('BTC', { type: 'symbol' }),
      nativeToScVal(0n, { type: 'u32' }),
      nativeToScVal(500_0000000n, { type: 'i128' }),  // size
      nativeToScVal(60_000_0000000n, { type: 'i128' }), // entry_price
      nativeToScVal(58_500_0000000n, { type: 'i128' }), // close_price
      nativeToScVal(-100_0000000n, { type: 'i128' }),   // pnl
    );
    const decoded = decodeMarketEvent(makeRawEvent('position_closed', value));
    expect(decoded?.topic).toBe('position_closed');
    if (decoded?.topic !== 'position_closed') throw new Error('wrong topic');
    expect(decoded.positionId).toBe(7);
    // Closes carry their asset/direction/size/entry now (I-6) — this is
    // what unlocks close-side volume and kills trades.UNKNOWN.
    expect(decoded.asset).toBe('BTC');
    expect(decoded.direction).toBe(0);
    expect(decoded.size).toBe(500_0000000n);
    expect(decoded.entryPrice).toBe(60_000_0000000n);
    expect(decoded.pnl).toBe(-100_0000000n);
    expect(decoded.closePrice).toBe(58_500_0000000n);
  });

  it('decodes position_liquidated with asset, direction and size', () => {
    // Contract emits 7-tuple:
    //   (id, trader, asset, direction, size, keeper_reward, current_price)
    const value = vec(
      nativeToScVal(8n, { type: 'u64' }),
      Address.fromString(FAKE_TRADER).toScVal(),
      nativeToScVal('ETH', { type: 'symbol' }),
      nativeToScVal(1n, { type: 'u32' }),
      nativeToScVal(300_0000000n, { type: 'i128' }),   // size
      nativeToScVal(15_0000000n, { type: 'i128' }),    // keeper_reward
      nativeToScVal(3_100_0000000n, { type: 'i128' }), // current_price
    );
    const decoded = decodeMarketEvent(makeRawEvent('position_liquidated', value));
    expect(decoded?.topic).toBe('position_liquidated');
    if (decoded?.topic !== 'position_liquidated') throw new Error('wrong topic');
    expect(decoded.positionId).toBe(8);
    expect(decoded.asset).toBe('ETH');
    expect(decoded.direction).toBe(1);
    expect(decoded.size).toBe(300_0000000n);
    expect(decoded.keeperReward).toBe(15_0000000n);
    expect(decoded.closePrice).toBe(3_100_0000000n);
  });

  it('decodes order_cancelled with reason symbol', () => {
    const value = vec(
      nativeToScVal(99n, { type: 'u64' }),
      nativeToScVal('user', { type: 'symbol' }),
    );
    const decoded = decodeMarketEvent(makeRawEvent('order_cancelled', value));
    expect(decoded?.topic).toBe('order_cancelled');
    if (decoded?.topic !== 'order_cancelled') throw new Error('wrong topic');
    expect(decoded.orderId).toBe(99);
    expect(decoded.reason).toBe('user');
  });

  it('decodes order_executed', () => {
    const value = vec(
      nativeToScVal(123n, { type: 'u64' }),
      nativeToScVal(50_0000n, { type: 'i128' }),
    );
    const decoded = decodeMarketEvent(makeRawEvent('order_executed', value));
    expect(decoded?.topic).toBe('order_executed');
    if (decoded?.topic !== 'order_executed') throw new Error('wrong topic');
    expect(decoded.orderId).toBe(123);
    expect(decoded.keeperReward).toBe(50_0000n);
  });

  it('decodes funding_applied', () => {
    const value = vec(
      nativeToScVal(50n, { type: 'i128' }),
      nativeToScVal(8n, { type: 'u64' }),
    );
    const decoded = decodeMarketEvent(makeRawEvent('funding_applied', value));
    expect(decoded?.topic).toBe('funding_applied');
    if (decoded?.topic !== 'funding_applied') throw new Error('wrong topic');
    expect(decoded.fundingRate).toBe(50n);
    expect(decoded.hoursElapsed).toBe(8n);
  });

  it('decodes cross_liq', () => {
    // Contract emits 3-tuple: (trader, total_pnl, keeper_reward)
    const value = vec(
      Address.fromString(FAKE_TRADER).toScVal(),
      nativeToScVal(-1_200_0000000n, { type: 'i128' }),
      nativeToScVal(25_0000n, { type: 'i128' }),
    );
    const decoded = decodeMarketEvent(makeRawEvent('cross_liq', value));
    expect(decoded?.topic).toBe('cross_liq');
    if (decoded?.topic !== 'cross_liq') throw new Error('wrong topic');
    expect(decoded.trader).toBe(FAKE_TRADER);
    expect(decoded.totalPnl).toBe(-1_200_0000000n);
    expect(decoded.keeperReward).toBe(25_0000n);
  });

  it('returns null for unknown topics (forward-compatibility)', () => {
    const value = vec(nativeToScVal(1n, { type: 'i128' }));
    const decoded = decodeMarketEvent(makeRawEvent('something_new', value));
    expect(decoded).toBeNull();
  });
});
