import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { Account, Address, Keypair, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import { IndexerBus } from '../src/bus.js';
import { EventRouter, type HandlerContext } from '../src/router.js';
import { buildMarketRegistrations } from '../src/handlers/market.js';
import { buildReferralRegistrations } from '../src/handlers/referral.js';
import { runMigrations } from '../src/migrations.js';
import type { CrossLiquidatedEvent, DecodedMarketEvent, PositionOpenedEvent } from '../src/types/events.js';
import type { Logger } from 'pino';

const FAKE_CONTRACT = 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD';
const FAKE_TRADER = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';
const FAKE_REFERRAL = 'CAGZXABWTJN6FU7TMCIWL3RH7EC6K4CQLLZJWUFN3CD7YHVDYWJCIG3O';

const noopLogger: Logger = {
  level: 'silent',
  fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
  silent: vi.fn(), child: () => noopLogger as Logger,
} as unknown as Logger;

async function setupDb() {
  const db = createClient({ url: ':memory:' });
  await runMigrations(db);
  return db;
}

describe('market handler', () => {
  it('persists position_opened to events_raw and emits on bus', async () => {
    const db = await setupDb();
    const bus = new IndexerBus();
    const router = new EventRouter();

    const seenTrade = vi.fn();
    bus.on('trade', seenTrade);
    const seenEvent = vi.fn();
    bus.on('event', seenEvent);

    for (const reg of buildMarketRegistrations(FAKE_CONTRACT)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }

    const event: PositionOpenedEvent = {
      id: 'evt-1',
      contractId: FAKE_CONTRACT,
      topic: 'position_opened',
      ledger: 100,
      ledgerCloseTs: 1745923200,
      txHash: 'a'.repeat(64),
      positionId: 42,
      trader: FAKE_TRADER,
      asset: 'BTC',
      direction: 0,
      size: 1_500_0000000n,
      entryPrice: 60_000_0000000n,
    };

    const ctx: HandlerContext = { db, rpc: {} as never, bus, log: noopLogger };
    await router.dispatch(event, ctx);

    const rows = await db.execute('SELECT event_id, topic, ledger, payload_json FROM events_raw');
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0]!;
    expect(row.event_id).toBe('evt-1');
    expect(row.topic).toBe('position_opened');
    expect(row.ledger).toBe(100);
    const payload = JSON.parse(row.payload_json as string);
    expect(payload.positionId).toBe(42);
    expect(payload.size).toBe('15000000000');

    expect(seenEvent).toHaveBeenCalledOnce();
    expect(seenTrade).toHaveBeenCalledOnce();
    expect(seenTrade.mock.calls[0]?.[0]?.kind).toBe('open');

    db.close();
  });

  it('insert is idempotent on duplicate event_id', async () => {
    const db = await setupDb();
    const bus = new IndexerBus();
    const router = new EventRouter();
    for (const reg of buildMarketRegistrations(FAKE_CONTRACT)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }

    const event: PositionOpenedEvent = {
      id: 'evt-dup',
      contractId: FAKE_CONTRACT,
      topic: 'position_opened',
      ledger: 100,
      ledgerCloseTs: 1745923200,
      txHash: 'a'.repeat(64),
      positionId: 1,
      trader: FAKE_TRADER,
      asset: 'BTC',
      direction: 0,
      size: 100n,
      entryPrice: 60n,
    };
    const ctx: HandlerContext = { db, rpc: {} as never, bus, log: noopLogger };
    await router.dispatch(event, ctx);
    await router.dispatch(event, ctx);

    const rows = await db.execute('SELECT COUNT(*) AS n FROM events_raw');
    expect(Number(rows.rows[0]!.n)).toBe(1);

    db.close();
  });

  it('skips projection and bus emit on duplicate delivery', async () => {
    const db = await setupDb();
    const bus = new IndexerBus();
    const router = new EventRouter();

    const seenEvent = vi.fn();
    bus.on('event', seenEvent);
    const seenTrade = vi.fn();
    bus.on('trade', seenTrade);

    for (const reg of buildMarketRegistrations(FAKE_CONTRACT)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }

    const event: PositionOpenedEvent = {
      id: 'evt-replay',
      contractId: FAKE_CONTRACT,
      topic: 'position_opened',
      ledger: 100,
      ledgerCloseTs: 1745923200,
      txHash: 'a'.repeat(64),
      positionId: 5,
      trader: FAKE_TRADER,
      asset: 'BTC',
      direction: 0,
      size: 100n,
      entryPrice: 60n,
    };
    const ctx: HandlerContext = { db, rpc: {} as never, bus, log: noopLogger };
    await router.dispatch(event, ctx);
    await router.dispatch(event, ctx);

    expect(seenEvent).toHaveBeenCalledOnce();
    expect(seenTrade).toHaveBeenCalledOnce();

    const positions = await db.execute('SELECT COUNT(*) AS n FROM positions');
    expect(Number(positions.rows[0]!.n)).toBe(1);

    db.close();
  });
});

describe('referral handler', () => {
  const REFEREE = Keypair.random().publicKey();

  function referralEvent(id: string, topic: string, fields: Record<string, unknown>): DecodedMarketEvent {
    return {
      id,
      contractId: FAKE_REFERRAL,
      topic,
      ledger: 200,
      ledgerCloseTs: 1745923300,
      txHash: 'b'.repeat(64),
      ...fields,
    } as unknown as DecodedMarketEvent;
  }

  it('replaying events does not double-apply projections or reset counters', async () => {
    const db = await setupDb();
    const bus = new IndexerBus();
    const router = new EventRouter();

    const seenEvent = vi.fn();
    bus.on('event', seenEvent);

    for (const reg of buildReferralRegistrations(FAKE_REFERRAL)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }
    const ctx: HandlerContext = { db, rpc: {} as never, bus, log: noopLogger };

    await router.dispatch(referralEvent('evt-r1', 'code_created', { referrer: FAKE_TRADER, code: 'EMMY' }), ctx);
    await router.dispatch(referralEvent('evt-r2', 'referrer_set', { referee: REFEREE, referrer: FAKE_TRADER, code: 'EMMY' }), ctx);
    await router.dispatch(referralEvent('evt-r3', 'trade_recorded', {
      referee: REFEREE, referrer: FAKE_TRADER, originalFee: 1000n, discount: 40n, payout: 100n,
    }), ctx);

    // Exact redelivery (same event ids) must be a no-op.
    await router.dispatch(referralEvent('evt-r2', 'referrer_set', { referee: REFEREE, referrer: FAKE_TRADER, code: 'EMMY' }), ctx);
    await router.dispatch(referralEvent('evt-r3', 'trade_recorded', {
      referee: REFEREE, referrer: FAKE_TRADER, originalFee: 1000n, discount: 40n, payout: 100n,
    }), ctx);

    const referrer = await db.execute({
      sql: 'SELECT referred_count, total_earned, claimable FROM referrers WHERE referrer = ?',
      args: [FAKE_TRADER],
    });
    expect(Number(referrer.rows[0]!.referred_count)).toBe(1);
    expect(Number(referrer.rows[0]!.total_earned)).toBe(100);
    expect(Number(referrer.rows[0]!.claimable)).toBe(100);

    const trades = await db.execute('SELECT COUNT(*) AS n FROM referral_trades');
    expect(Number(trades.rows[0]!.n)).toBe(1);
    expect(seenEvent).toHaveBeenCalledTimes(3);

    // A re-applied code_created (fresh event id) must preserve lifetime counters.
    await router.dispatch(referralEvent('evt-r4', 'code_created', { referrer: FAKE_TRADER, code: 'EMMY' }), ctx);

    const after = await db.execute({
      sql: 'SELECT code, referred_count, total_earned, claimable FROM referrers WHERE referrer = ?',
      args: [FAKE_TRADER],
    });
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]!.code).toBe('EMMY');
    expect(Number(after.rows[0]!.referred_count)).toBe(1);
    expect(Number(after.rows[0]!.total_earned)).toBe(100);
    expect(Number(after.rows[0]!.claimable)).toBe(100);

    db.close();
  });
});

describe('cross_liq projection cleanup', () => {
  const OTHER_TRADER = Keypair.random().publicKey();

  function openedEvent(id: string, positionId: number, trader: string): PositionOpenedEvent {
    return {
      id,
      contractId: FAKE_CONTRACT,
      topic: 'position_opened',
      ledger: 100,
      ledgerCloseTs: 1745923200,
      txHash: 'a'.repeat(64),
      positionId,
      trader,
      asset: 'BTC',
      direction: 0,
      size: 100n,
      entryPrice: 60n,
    };
  }

  function mockRpc(liveOnChain: Set<number>) {
    return {
      getAccount: vi.fn(async () => new Account(FAKE_TRADER, '1')),
      simulateTransaction: vi.fn(async (tx: unknown) => {
        const op = (tx as { operations: Array<{ func: xdr.HostFunction }> }).operations[0]!;
        const positionId = Number(scValToNative(op.func.invokeContract().args()[0]!));
        const retval = liveOnChain.has(positionId)
          ? xdr.ScVal.scvMap([
              new xdr.ScMapEntry({
                key: nativeToScVal('trader', { type: 'symbol' }),
                val: Address.fromString(FAKE_TRADER).toScVal(),
              }),
            ])
          : xdr.ScVal.scvVoid();
        return { transactionData: {}, events: [], minResourceFee: '0', result: { auth: [], retval }, latestLedger: 200 };
      }),
    };
  }

  it('removes the trader\'s dead position rows and keeps live and other-trader rows', async () => {
    const db = await setupDb();
    const bus = new IndexerBus();
    const router = new EventRouter();
    for (const reg of buildMarketRegistrations(FAKE_CONTRACT)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }

    // Position 10 is cross-margin (deleted on-chain by the liquidation);
    // 11 is an isolated position still open; 12 belongs to another trader.
    const rpc = mockRpc(new Set([11, 12]));
    const ctx: HandlerContext = { db, rpc: rpc as never, bus, log: noopLogger };

    await router.dispatch(openedEvent('evt-o10', 10, FAKE_TRADER), ctx);
    await router.dispatch(openedEvent('evt-o11', 11, FAKE_TRADER), ctx);
    await router.dispatch(openedEvent('evt-o12', 12, OTHER_TRADER), ctx);

    const crossLiq: CrossLiquidatedEvent = {
      id: 'evt-xliq',
      contractId: FAKE_CONTRACT,
      topic: 'cross_liq',
      ledger: 110,
      ledgerCloseTs: 1745923400,
      txHash: 'c'.repeat(64),
      trader: FAKE_TRADER,
      totalPnl: -500n,
      keeperReward: 25n,
    };
    await router.dispatch(crossLiq, ctx);

    const rows = await db.execute('SELECT position_id, trader FROM positions ORDER BY position_id');
    expect(rows.rows.map((r) => Number(r.position_id))).toEqual([11, 12]);

    // Only the cross_liq trader's rows were verified on-chain.
    expect(rpc.simulateTransaction).toHaveBeenCalledTimes(2);

    db.close();
  });
});
