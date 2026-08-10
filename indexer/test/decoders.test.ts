import { describe, expect, it } from 'vitest';
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { decodeMarketEvent, type RawEvent } from '../src/decoders/market.js';
import { decodeVaultEvent } from '../src/decoders/vault.js';
import { decodeLpVaultEvent } from '../src/decoders/lpVault.js';

const FAKE_CONTRACT = 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD';
const FAKE_TRADER = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';
const FAKE_TX_HASH = 'a'.repeat(64);

function makeRawEvent(
  topic: string,
  value: xdr.ScVal,
  ledger = 100,
  extraTopics: xdr.ScVal[] = [],
): RawEvent {
  return {
    id: `${ledger}-1`,
    contractId: FAKE_CONTRACT,
    type: 'contract',
    topic: [nativeToScVal(topic, { type: 'symbol' }), ...extraTopics],
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

  it('decodes funding_applied as the L0-13 4-tuple (asset, rate, hours, cum)', () => {
    const value = vec(
      nativeToScVal('XLM', { type: 'symbol' }),
      nativeToScVal(3_600n, { type: 'i128' }),
      nativeToScVal(1n, { type: 'u64' }),
      nativeToScVal(12_345n, { type: 'i128' }),
    );
    const decoded = decodeMarketEvent(makeRawEvent('funding_applied', value));
    if (decoded?.topic !== 'funding_applied') throw new Error('wrong topic');
    expect(decoded.asset).toBe('XLM');
    expect(decoded.fundingRate).toBe(3_600n);
    expect(decoded.hoursElapsed).toBe(1n);
    expect(decoded.cumulativeIndex).toBe(12_345n);
  });

  it('decodes the legacy funding_applied 2-tuple (rate, hours)', () => {
    const value = vec(
      nativeToScVal(3_600n, { type: 'i128' }),
      nativeToScVal(2n, { type: 'u64' }),
    );
    const decoded = decodeMarketEvent(makeRawEvent('funding_applied', value));
    if (decoded?.topic !== 'funding_applied') throw new Error('wrong topic');
    expect(decoded.asset).toBeUndefined();
    expect(decoded.fundingRate).toBe(3_600n);
    expect(decoded.hoursElapsed).toBe(2n);
  });

  it('decodes position_reduced (L0-6 partial close)', () => {
    const value = vec(
      nativeToScVal(9n, { type: 'u64' }),
      Address.fromString(FAKE_TRADER).toScVal(),
      nativeToScVal('BTC', { type: 'symbol' }),
      nativeToScVal(200_0000000n, { type: 'i128' }), // closed_size
      nativeToScVal(300_0000000n, { type: 'i128' }), // remaining_size
      nativeToScVal(60_000_0000000n, { type: 'i128' }),
      nativeToScVal(50_0000000n, { type: 'i128' }), // pnl
    );
    const decoded = decodeMarketEvent(makeRawEvent('position_reduced', value));
    if (decoded?.topic !== 'position_reduced') throw new Error('wrong topic');
    expect(decoded.positionId).toBe(9);
    expect(decoded.closedSize).toBe(200_0000000n);
    expect(decoded.remainingSize).toBe(300_0000000n);
    expect(decoded.pnl).toBe(50_0000000n);
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

  it('decodes liq_refund for isolated and cross (position_id 0) rows', () => {
    // L0-4 emits: (trader, position_id, refund, penalty)
    const iso = vec(
      Address.fromString(FAKE_TRADER).toScVal(),
      nativeToScVal(12n, { type: 'u64' }),
      nativeToScVal(38_8050000n, { type: 'i128' }),
      nativeToScVal(9_9500000n, { type: 'i128' }),
    );
    const decoded = decodeMarketEvent(makeRawEvent('liq_refund', iso));
    expect(decoded?.topic).toBe('liq_refund');
    if (decoded?.topic !== 'liq_refund') throw new Error('wrong topic');
    expect(decoded.positionId).toBe(12);
    expect(decoded.refund).toBe(38_8050000n);
    expect(decoded.penalty).toBe(9_9500000n);

    const cross = vec(
      Address.fromString(FAKE_TRADER).toScVal(),
      nativeToScVal(0n, { type: 'u64' }), // account-level
      nativeToScVal(5_0000000n, { type: 'i128' }),
      nativeToScVal(1_0000000n, { type: 'i128' }),
    );
    const decodedCross = decodeMarketEvent(makeRawEvent('liq_refund', cross));
    if (decodedCross?.topic !== 'liq_refund') throw new Error('wrong topic');
    expect(decodedCross.positionId).toBe(0);
  });

  it('decodes bad_debt_recorded incl. the CROSS sentinel asset', () => {
    // L0-2 emits: (trader, asset, amount, buffer_covered, lp_absorbed)
    const value = vec(
      Address.fromString(FAKE_TRADER).toScVal(),
      nativeToScVal('CROSS', { type: 'symbol' }),
      nativeToScVal(49_7500000n, { type: 'i128' }),
      nativeToScVal(20_0000000n, { type: 'i128' }),
      nativeToScVal(29_7500000n, { type: 'i128' }),
    );
    const decoded = decodeMarketEvent(makeRawEvent('bad_debt_recorded', value));
    expect(decoded?.topic).toBe('bad_debt_recorded');
    if (decoded?.topic !== 'bad_debt_recorded') throw new Error('wrong topic');
    expect(decoded.asset).toBe('CROSS');
    expect(decoded.amount).toBe(49_7500000n);
    expect(decoded.bufferCovered + decoded.lpAbsorbed).toBe(decoded.amount);
  });

  it('decodes adl_executed 8-tuple and the adl flag events', () => {
    // L0-1 emits: (position_id, trader, asset, direction, size, price, pnl, score)
    const value = vec(
      nativeToScVal(5n, { type: 'u64' }),
      Address.fromString(FAKE_TRADER).toScVal(),
      nativeToScVal('XLM', { type: 'symbol' }),
      nativeToScVal(0n, { type: 'u32' }),
      nativeToScVal(49_7500000n, { type: 'i128' }),
      nativeToScVal(3000000n, { type: 'i128' }),
      nativeToScVal(99_5000000n, { type: 'i128' }),
      nativeToScVal(100_000n, { type: 'i128' }),
    );
    const decoded = decodeMarketEvent(makeRawEvent('adl_executed', value));
    expect(decoded?.topic).toBe('adl_executed');
    if (decoded?.topic !== 'adl_executed') throw new Error('wrong topic');
    expect(decoded.positionId).toBe(5);
    expect(decoded.price).toBe(3000000n);
    expect(decoded.pnl).toBe(99_5000000n);
    expect(decoded.score).toBe(100_000n);

    // adl_triggered / adl_cleared: (asset, reason, payable_upnl, coverage)
    const flag = vec(
      nativeToScVal('XLM', { type: 'symbol' }),
      nativeToScVal(1n, { type: 'u32' }), // shortfall auto-flip
      nativeToScVal(0n, { type: 'i128' }),
      nativeToScVal(0n, { type: 'i128' }),
    );
    const trig = decodeMarketEvent(makeRawEvent('adl_triggered', flag));
    expect(trig?.topic).toBe('adl_triggered');
    if (trig?.topic !== 'adl_triggered') throw new Error('wrong topic');
    expect(trig.reason).toBe(1);
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

  it('decodes paused as the L0-15 (mode, since) tuple', () => {
    const value = vec(
      nativeToScVal(2n, { type: 'u32' }),
      nativeToScVal(1_700_000_000n, { type: 'u64' }),
    );
    const decoded = decodeMarketEvent(makeRawEvent('paused', value));
    if (decoded?.topic !== 'paused') throw new Error('wrong topic');
    expect(decoded.mode).toBe(2);
    expect(decoded.since).toBe(1_700_000_000);
  });

  it('decodes pause_degraded (from, to)', () => {
    const value = vec(
      nativeToScVal(2n, { type: 'u32' }),
      nativeToScVal(1n, { type: 'u32' }),
    );
    const decoded = decodeMarketEvent(makeRawEvent('pause_degraded', value));
    if (decoded?.topic !== 'pause_degraded') throw new Error('wrong topic');
    expect(decoded.fromMode).toBe(2);
    expect(decoded.toMode).toBe(1);
  });

  it('decodes asset_halt_set (asset in topic[1], halted 1-tuple payload)', () => {
    const value = vec(nativeToScVal(true, { type: 'bool' }));
    const decoded = decodeMarketEvent(
      makeRawEvent('asset_halt_set', value, 100, [nativeToScVal('DOGE', { type: 'symbol' })]),
    );
    if (decoded?.topic !== 'asset_halt_set') throw new Error('wrong topic');
    expect(decoded.asset).toBe('DOGE');
    expect(decoded.halted).toBe(true);
  });

  it('decodes collateral_added / collateral_removed (id, trader, amount, liq_price)', () => {
    const value = vec(
      nativeToScVal(42n, { type: 'u64' }),
      Address.fromString(FAKE_TRADER).toScVal(),
      nativeToScVal(50_0000000n, { type: 'i128' }),
      nativeToScVal(58_000_0000000n, { type: 'i128' }),
    );
    for (const topic of ['collateral_added', 'collateral_removed'] as const) {
      const decoded = decodeMarketEvent(makeRawEvent(topic, value));
      if (decoded?.topic !== topic) throw new Error('wrong topic');
      expect(decoded.positionId).toBe(42);
      expect(decoded.trader).toBe(FAKE_TRADER);
      expect(decoded.amount).toBe(50_0000000n);
      expect(decoded.liquidationPrice).toBe(58_000_0000000n);
    }
  });
});

describe('decodeVaultEvent — Batch-1 factory topics', () => {
  const vaultTopic = (id: number) => [nativeToScVal(id, { type: 'u32' })];

  it('decodes leader_limit / leader_cancel / leader_stop_limit (leader, order_id)', () => {
    const value = vec(
      Address.fromString(FAKE_TRADER).toScVal(),
      nativeToScVal(9n, { type: 'u64' }),
    );
    for (const topic of ['leader_limit', 'leader_cancel', 'leader_stop_limit'] as const) {
      const decoded = decodeVaultEvent(makeRawEvent(topic, value, 100, vaultTopic(3)));
      if (decoded?.topic !== topic) throw new Error('wrong topic');
      expect(decoded.vaultId).toBe(3);
      expect(decoded.leader).toBe(FAKE_TRADER);
      expect(decoded.orderId).toBe(9n);
    }
  });

  it('decodes leader_sl / leader_tp / leader_trail (leader, order_id, position_id)', () => {
    const value = vec(
      Address.fromString(FAKE_TRADER).toScVal(),
      nativeToScVal(9n, { type: 'u64' }),
      nativeToScVal(42n, { type: 'u64' }),
    );
    for (const topic of ['leader_sl', 'leader_tp', 'leader_trail'] as const) {
      const decoded = decodeVaultEvent(makeRawEvent(topic, value, 100, vaultTopic(3)));
      if (decoded?.topic !== topic) throw new Error('wrong topic');
      expect(decoded.orderId).toBe(9n);
      expect(decoded.positionId).toBe(42n);
    }
  });

  it('decodes order_reconciled (order_id, position_id, credited)', () => {
    const value = vec(
      nativeToScVal(9n, { type: 'u64' }),
      nativeToScVal(0n, { type: 'u64' }), // cancelled/expired refund path
      nativeToScVal(75_0000000n, { type: 'i128' }),
    );
    const decoded = decodeVaultEvent(makeRawEvent('order_reconciled', value, 100, vaultTopic(3)));
    if (decoded?.topic !== 'order_reconciled') throw new Error('wrong topic');
    expect(decoded.orderId).toBe(9n);
    expect(decoded.positionId).toBe(0n);
    expect(decoded.credited).toBe(75_0000000n);
  });

  it('decodes position_reconciled (position_id, proceeds)', () => {
    const value = vec(
      nativeToScVal(42n, { type: 'u64' }),
      nativeToScVal(130_0000000n, { type: 'i128' }),
    );
    const decoded = decodeVaultEvent(makeRawEvent('position_reconciled', value, 100, vaultTopic(3)));
    if (decoded?.topic !== 'position_reconciled') throw new Error('wrong topic');
    expect(decoded.positionId).toBe(42n);
    expect(decoded.proceeds).toBe(130_0000000n);
  });
});

describe('decodeLpVaultEvent (LP pool topics)', () => {
  it('decodes deposit (depositor, usdc_amount, noe_minted, fee)', () => {
    const value = vec(
      Address.fromString(FAKE_TRADER).toScVal(),
      nativeToScVal(1_000_0000000n, { type: 'i128' }),
      nativeToScVal(990_0000000n, { type: 'i128' }),
      nativeToScVal(10_0000000n, { type: 'i128' }),
    );
    const decoded = decodeLpVaultEvent(makeRawEvent('deposit', value));
    expect(decoded?.topic).toBe('deposit');
    expect(decoded?.depositor).toBe(FAKE_TRADER);
    expect(decoded?.usdcAmount).toBe(1_000_0000000n);
    expect(decoded?.noeMinted).toBe(990_0000000n);
    expect(decoded?.fee).toBe(10_0000000n);
    expect(decoded?.contractId).toBe(FAKE_CONTRACT);
    expect(decoded?.txHash).toBe(FAKE_TX_HASH);
  });

  it('decodes withdraw (withdrawer, noe_amount, net_usdc, fee)', () => {
    const value = vec(
      Address.fromString(FAKE_TRADER).toScVal(),
      nativeToScVal(500_0000000n, { type: 'i128' }),
      nativeToScVal(495_0000000n, { type: 'i128' }),
      nativeToScVal(5_0000000n, { type: 'i128' }),
    );
    const decoded = decodeLpVaultEvent(makeRawEvent('withdraw', value));
    expect(decoded?.topic).toBe('withdraw');
    expect(decoded?.withdrawer).toBe(FAKE_TRADER);
    expect(decoded?.noeBurned).toBe(500_0000000n);
    expect(decoded?.usdcOut).toBe(495_0000000n);
    expect(decoded?.fee).toBe(5_0000000n);
  });

  it('decodes pnl_settled as a single value payload with a signed pnl', () => {
    const value = vec(nativeToScVal(-250_0000000n, { type: 'i128' }));
    const decoded = decodeLpVaultEvent(makeRawEvent('pnl_settled', value));
    expect(decoded?.topic).toBe('pnl_settled');
    expect(decoded?.pnl).toBe(-250_0000000n);
  });

  it('decodes buffer_drawn (amount, covered) and buffer_paid (to, amount, paid)', () => {
    const drawn = decodeLpVaultEvent(
      makeRawEvent(
        'buffer_drawn',
        vec(nativeToScVal(100_0000000n, { type: 'i128' }), nativeToScVal(60_0000000n, { type: 'i128' })),
      ),
    );
    expect(drawn?.topic).toBe('buffer_drawn');
    expect(drawn?.amount).toBe(100_0000000n);
    expect(drawn?.covered).toBe(60_0000000n);

    const paid = decodeLpVaultEvent(
      makeRawEvent(
        'buffer_paid',
        vec(
          Address.fromString(FAKE_TRADER).toScVal(),
          nativeToScVal(40_0000000n, { type: 'i128' }),
          nativeToScVal(30_0000000n, { type: 'i128' }),
        ),
      ),
    );
    expect(paid?.topic).toBe('buffer_paid');
    expect(paid?.to).toBe(FAKE_TRADER);
    expect(paid?.amount).toBe(40_0000000n);
    expect(paid?.paid).toBe(30_0000000n);
  });

  it('decodes exposure_synced with the asset symbol in topic[1]', () => {
    const value = vec(
      nativeToScVal(-12_0000000n, { type: 'i128' }),
      nativeToScVal(-30_0000000n, { type: 'i128' }),
      nativeToScVal(7_0000000n, { type: 'i128' }),
    );
    const decoded = decodeLpVaultEvent(
      makeRawEvent('exposure_synced', value, 100, [nativeToScVal('BTC', { type: 'symbol' })]),
    );
    expect(decoded?.topic).toBe('exposure_synced');
    expect(decoded?.asset).toBe('BTC');
    expect(decoded?.assetUnrealizedPnl).toBe(-12_0000000n);
    expect(decoded?.totalUnrealizedPnl).toBe(-30_0000000n);
    expect(decoded?.release).toBe(7_0000000n);
  });

  it('decodes paused with an empty payload and no stray fields', () => {
    const decoded = decodeLpVaultEvent(makeRawEvent('paused', xdr.ScVal.scvVoid()));
    expect(decoded?.topic).toBe('paused');
    expect(decoded?.asset).toBeUndefined();
    expect(decoded?.extra0).toBeUndefined();
  });

  it('keeps appended payload values under extra keys instead of dropping them', () => {
    const value = vec(
      nativeToScVal(-250_0000000n, { type: 'i128' }),
      nativeToScVal(1n, { type: 'u64' }),
    );
    const decoded = decodeLpVaultEvent(makeRawEvent('pnl_settled', value));
    expect(decoded?.pnl).toBe(-250_0000000n);
    expect(decoded?.extra0).toBe(1n);
  });

  it('returns null for topics the LP vault does not emit', () => {
    const value = vec(nativeToScVal(1n, { type: 'i128' }));
    expect(decodeLpVaultEvent(makeRawEvent('something_new', value))).toBeNull();
  });
});
