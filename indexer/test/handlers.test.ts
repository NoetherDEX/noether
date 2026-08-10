import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createPgliteDb } from '@noether/db/pglite';
import { Account, Address, Keypair, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import { IndexerBus } from '../src/bus.js';
import { EventRouter, type HandlerContext } from '../src/router.js';
import { buildMarketRegistrations } from '../src/handlers/market.js';
import { buildReferralRegistrations } from '../src/handlers/referral.js';
import { buildVaultRegistrations } from '../src/handlers/vault.js';
import { buildLpVaultRegistrations } from '../src/handlers/lpVault.js';
import { pruneRetiredFactoryRows } from '../src/vaultSync.js';
import { runMigrations } from '../src/migrations.js';
import type {
  CrossLiquidatedEvent,
  DecodedMarketEvent,
  PositionClosedEvent,
  PositionLiquidatedEvent,
  PositionOpenedEvent,
} from '../src/types/events.js';
import type { Logger } from 'pino';

const FAKE_CONTRACT = 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD';
const FAKE_TRADER = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';
const FAKE_REFERRAL = 'CAGZXABWTJN6FU7TMCIWL3RH7EC6K4CQLLZJWUFN3CD7YHVDYWJCIG3O';
const FAKE_FACTORY = 'CCEQJKB3WVADOSCLCMFXL3VBZ4RKYEGFCG4SJVPERLFEWSIFMIWROLZA';
const FAKE_LP_VAULT = 'CBSWA5P75NGV2LP5KOY7A7LOAX2CENI5OYBSJ5IVLHENKQJF2I3ZBSYE';

const noopLogger: Logger = {
  level: 'silent',
  fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
  silent: vi.fn(), child: () => noopLogger as Logger,
} as unknown as Logger;

async function setupDb() {
  // In-memory Postgres (PGlite) behind the production Db surface. Running
  // the real migration runner here makes 001_baseline.sql the schema under
  // test.
  const db = createPgliteDb(new PGlite());
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
    expect(Number(row.ledger)).toBe(100);
    const payload = JSON.parse(row.payload_json as string);
    expect(payload.positionId).toBe(42);
    expect(payload.size).toBe('15000000000');

    expect(seenEvent).toHaveBeenCalledOnce();
    expect(seenTrade).toHaveBeenCalledOnce();
    expect(seenTrade.mock.calls[0]?.[0]?.kind).toBe('open');

    await db.close();
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

    await db.close();
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

    await db.close();
  });
});

describe('market trades projection', () => {
  function closedEvent(id: string): PositionClosedEvent {
    return {
      id,
      contractId: FAKE_CONTRACT,
      topic: 'position_closed',
      ledger: 120,
      ledgerCloseTs: 1745923500,
      txHash: 'e'.repeat(64),
      positionId: 7,
      trader: FAKE_TRADER,
      asset: 'ETH',
      direction: 1,
      size: 3_000_0000000n,
      entryPrice: 3_000_0000000n,
      closePrice: 3_200_0000000n,
      pnl: 200_0000000n,
    };
  }

  function makeMarketRouter(): EventRouter {
    const router = new EventRouter();
    for (const reg of buildMarketRegistrations(FAKE_CONTRACT)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }
    return router;
  }

  it('writes a realized-trade row on close with its asset + pnl', async () => {
    const db = await setupDb();
    const router = makeMarketRouter();
    const ctx: HandlerContext = { db, rpc: {} as never, bus: new IndexerBus(), log: noopLogger };

    await router.dispatch(closedEvent('evt-close-1'), ctx);

    const rows = await db.execute('SELECT * FROM trades');
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0]!;
    expect(row.event_id).toBe('evt-close-1');
    expect(Number(row.position_id)).toBe(7);
    expect(row.trader).toBe(FAKE_TRADER);
    expect(row.asset).toBe('ETH');
    expect(Number(row.direction)).toBe(1);
    expect(row.kind).toBe('close');
    expect(String(row.size)).toBe('30000000000');
    expect(String(row.entry_price)).toBe('30000000000');
    expect(String(row.close_price)).toBe('32000000000');
    expect(String(row.pnl)).toBe('2000000000');
    expect(row.contract_id).toBe(FAKE_CONTRACT);

    await db.close();
  });

  it('is idempotent — redelivering the same close writes one row', async () => {
    const db = await setupDb();
    const router = makeMarketRouter();
    const ctx: HandlerContext = { db, rpc: {} as never, bus: new IndexerBus(), log: noopLogger };

    await router.dispatch(closedEvent('evt-close-dup'), ctx);
    await router.dispatch(closedEvent('evt-close-dup'), ctx);

    const rows = await db.execute('SELECT COUNT(*) AS n FROM trades');
    expect(Number(rows.rows[0]!.n)).toBe(1);

    await db.close();
  });

  it('records a liquidation with null pnl and entry_price', async () => {
    const db = await setupDb();
    const router = makeMarketRouter();
    const ctx: HandlerContext = { db, rpc: {} as never, bus: new IndexerBus(), log: noopLogger };

    const liq: PositionLiquidatedEvent = {
      id: 'evt-liq-1',
      contractId: FAKE_CONTRACT,
      topic: 'position_liquidated',
      ledger: 130,
      ledgerCloseTs: 1745923600,
      txHash: 'f'.repeat(64),
      positionId: 9,
      trader: FAKE_TRADER,
      asset: 'BTC',
      direction: 0,
      size: 1_500_0000000n,
      keeperReward: 5_0000000n,
      closePrice: 55_000_0000000n,
    };
    await router.dispatch(liq, ctx);

    const rows = await db.execute('SELECT kind, asset, size, entry_price, close_price, pnl FROM trades');
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0]!;
    expect(row.kind).toBe('liquidation');
    expect(row.asset).toBe('BTC');
    expect(String(row.size)).toBe('15000000000');
    expect(String(row.close_price)).toBe('550000000000');
    expect(row.entry_price).toBeNull();
    expect(row.pnl).toBeNull();

    await db.close();
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
      // L1-18 six-field payload (volume = referred notional).
      referee: REFEREE, referrer: FAKE_TRADER, originalFee: 1000n, discount: 40n, payout: 100n, volume: 200_000n,
    }), ctx);

    // Exact redelivery (same event ids) must be a no-op.
    await router.dispatch(referralEvent('evt-r2', 'referrer_set', { referee: REFEREE, referrer: FAKE_TRADER, code: 'EMMY' }), ctx);
    await router.dispatch(referralEvent('evt-r3', 'trade_recorded', {
      referee: REFEREE, referrer: FAKE_TRADER, originalFee: 1000n, discount: 40n, payout: 100n, volume: 200_000n,
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
    const volCol = await db.execute('SELECT volume FROM referral_trades');
    expect(String(volCol.rows[0]!.volume)).toBe('200000');
    expect(seenEvent).toHaveBeenCalledTimes(3);

    // Pre-Batch-1 five-field payload (no volume) still projects — NULL column.
    await router.dispatch(referralEvent('evt-r3b', 'trade_recorded', {
      referee: REFEREE, referrer: FAKE_TRADER, originalFee: 500n, discount: 20n, payout: 50n, volume: null,
    }), ctx);
    const legacy = await db.execute({
      sql: 'SELECT volume FROM referral_trades WHERE event_id = ?',
      args: ['evt-r3b'],
    });
    expect(legacy.rows[0]!.volume).toBeNull();

    // A re-applied code_created (fresh event id) must preserve lifetime counters.
    await router.dispatch(referralEvent('evt-r4', 'code_created', { referrer: FAKE_TRADER, code: 'EMMY' }), ctx);

    const after = await db.execute({
      sql: 'SELECT code, referred_count, total_earned, claimable FROM referrers WHERE referrer = ?',
      args: [FAKE_TRADER],
    });
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]!.code).toBe('EMMY');
    expect(Number(after.rows[0]!.referred_count)).toBe(1);
    // 100 from evt-r3 + 50 from the legacy-payload evt-r3b above.
    expect(Number(after.rows[0]!.total_earned)).toBe(150);
    expect(Number(after.rows[0]!.claimable)).toBe(150);

    await db.close();
  });
});

describe('vault handler idempotency + atomicity', () => {
  function vaultEvent(id: string, topic: string, vaultId: number, fields: Record<string, unknown>): DecodedMarketEvent {
    return {
      id,
      contractId: FAKE_FACTORY,
      topic,
      vaultId,
      ledger: 300,
      ledgerCloseTs: 1745923500,
      txHash: 'd'.repeat(64),
      ...fields,
    } as unknown as DecodedMarketEvent;
  }

  function makeVaultRouter() {
    const router = new EventRouter();
    for (const reg of buildVaultRegistrations(FAKE_FACTORY)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }
    return router;
  }

  it('replayed deposits do not double-apply totals or duplicate activity rows', async () => {
    const db = await setupDb();
    const router = makeVaultRouter();
    const ctx: HandlerContext = { db, rpc: {} as never, bus: new IndexerBus(), log: noopLogger };

    await router.dispatch(vaultEvent('evt-v1', 'vault_created', 1, { leader: FAKE_TRADER, name: 'Alpha' }), ctx);
    const deposit = vaultEvent('evt-v2', 'deposit', 1, { depositor: FAKE_TRADER, amount: 1000n, shares: 1000n });
    await router.dispatch(deposit, ctx);
    await router.dispatch(deposit, ctx);

    const vault = await db.execute('SELECT total_usdc, circulating_shares, leader_shares, contract_id FROM vaults WHERE id = 1');
    expect(Number(vault.rows[0]!.total_usdc)).toBe(1000);
    expect(Number(vault.rows[0]!.circulating_shares)).toBe(1000);
    expect(Number(vault.rows[0]!.leader_shares)).toBe(1000);
    expect(vault.rows[0]!.contract_id).toBe(FAKE_FACTORY);

    const deposits = await db.execute('SELECT event_id, contract_id FROM vault_deposits');
    expect(deposits.rows).toHaveLength(1);
    expect(deposits.rows[0]!.event_id).toBe('evt-v2');
    expect(deposits.rows[0]!.contract_id).toBe(FAKE_FACTORY);

    await db.close();
  });

  it('rolls back every projection write when one statement in the event fails', async () => {
    const db = await setupDb();
    const router = makeVaultRouter();
    const ctx: HandlerContext = { db, rpc: {} as never, bus: new IndexerBus(), log: noopLogger };

    await router.dispatch(vaultEvent('evt-v3', 'vault_created', 2, { leader: FAKE_TRADER, name: 'Beta' }), ctx);

    // depositor is missing → the vaults UPDATE succeeds inside the tx,
    // then the vault_deposits INSERT violates NOT NULL. Without the
    // transaction this would leave total_usdc bumped with no activity row.
    const poisoned = vaultEvent('evt-v4', 'deposit', 2, { depositor: undefined, amount: 500n, shares: 500n });
    await expect(router.dispatch(poisoned, ctx)).rejects.toThrow();

    const vault = await db.execute('SELECT total_usdc, circulating_shares FROM vaults WHERE id = 2');
    expect(Number(vault.rows[0]!.total_usdc)).toBe(0);
    expect(Number(vault.rows[0]!.circulating_shares)).toBe(0);

    const deposits = await db.execute('SELECT COUNT(*) AS n FROM vault_deposits');
    expect(Number(deposits.rows[0]!.n)).toBe(0);

    // The event is still archived so the retry pass hits the
    // idempotency guard and the cursor can advance past it.
    const raw = await db.execute("SELECT event_id FROM events_raw WHERE event_id = 'evt-v4'");
    expect(raw.rows).toHaveLength(1);

    // Redelivery (same event id, now well-formed) is a no-op: fail-loud
    // once, recorded in dead_letter by the poller, never half-applied.
    const redelivered = vaultEvent('evt-v4', 'deposit', 2, { depositor: FAKE_TRADER, amount: 500n, shares: 500n });
    await router.dispatch(redelivered, ctx);
    const after = await db.execute('SELECT total_usdc FROM vaults WHERE id = 2');
    expect(Number(after.rows[0]!.total_usdc)).toBe(0);

    await db.close();
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

    await db.close();
  });
});

describe('lp vault handler', () => {
  function lpEvent(id: string, topic: string, fields: Record<string, unknown>): DecodedMarketEvent {
    return {
      id,
      contractId: FAKE_LP_VAULT,
      topic,
      ledger: 400,
      ledgerCloseTs: 1745923700,
      txHash: 'ab'.repeat(32),
      ...fields,
    } as unknown as DecodedMarketEvent;
  }

  function makeLpRouter(): EventRouter {
    const router = new EventRouter();
    for (const reg of buildLpVaultRegistrations(FAKE_LP_VAULT)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }
    return router;
  }

  it('archives a deposit and writes the typed row exactly once', async () => {
    const db = await setupDb();
    const bus = new IndexerBus();
    const router = makeLpRouter();
    const seenEvent = vi.fn();
    bus.on('event', seenEvent);
    const ctx: HandlerContext = { db, rpc: {} as never, bus, log: noopLogger };

    const deposit = lpEvent('evt-lp1', 'deposit', {
      depositor: FAKE_TRADER,
      usdcAmount: 1_000_0000000n,
      noeMinted: 990_0000000n,
      fee: 10_0000000n,
    });
    await router.dispatch(deposit, ctx);
    await router.dispatch(deposit, ctx);

    const raw = await db.execute("SELECT topic, contract_id, payload_json FROM events_raw WHERE event_id = 'evt-lp1'");
    expect(raw.rows).toHaveLength(1);
    expect(raw.rows[0]!.topic).toBe('deposit');
    expect(raw.rows[0]!.contract_id).toBe(FAKE_LP_VAULT);
    const payload = JSON.parse(raw.rows[0]!.payload_json as string);
    expect(payload.depositor).toBe(FAKE_TRADER);
    expect(payload.usdcAmount).toBe('10000000000');

    const typed = await db.execute('SELECT * FROM lp_vault_deposits');
    expect(typed.rows).toHaveLength(1);
    const row = typed.rows[0]!;
    expect(row.event_id).toBe('evt-lp1');
    expect(row.depositor).toBe(FAKE_TRADER);
    expect(String(row.usdc_amount)).toBe('10000000000');
    expect(String(row.noe_minted)).toBe('9900000000');
    expect(String(row.fee)).toBe('100000000');
    expect(row.contract_id).toBe(FAKE_LP_VAULT);

    expect(seenEvent).toHaveBeenCalledOnce();

    await db.close();
  });

  it('writes withdraw, pnl settlement and buffer flow rows', async () => {
    const db = await setupDb();
    const router = makeLpRouter();
    const ctx: HandlerContext = { db, rpc: {} as never, bus: new IndexerBus(), log: noopLogger };

    await router.dispatch(
      lpEvent('evt-lp2', 'withdraw', {
        withdrawer: FAKE_TRADER,
        noeBurned: 500_0000000n,
        usdcOut: 495_0000000n,
        fee: 5_0000000n,
      }),
      ctx,
    );
    await router.dispatch(lpEvent('evt-lp3', 'pnl_settled', { pnl: -250_0000000n }), ctx);
    await router.dispatch(
      lpEvent('evt-lp4', 'buffer_funded', { amount: 100_0000000n, toReserve: 20_0000000n }),
      ctx,
    );
    await router.dispatch(
      lpEvent('evt-lp5', 'buffer_paid', { to: FAKE_TRADER, amount: 40_0000000n, paid: 30_0000000n }),
      ctx,
    );

    const withdraws = await db.execute('SELECT withdrawer, noe_burned, usdc_out FROM lp_vault_withdraws');
    expect(withdraws.rows).toHaveLength(1);
    expect(withdraws.rows[0]!.withdrawer).toBe(FAKE_TRADER);
    expect(String(withdraws.rows[0]!.usdc_out)).toBe('4950000000');

    const pnl = await db.execute('SELECT pnl FROM lp_vault_pnl_settlements');
    expect(pnl.rows).toHaveLength(1);
    expect(String(pnl.rows[0]!.pnl)).toBe('-2500000000');

    const flows = await db.execute('SELECT kind, amount, secondary_amount, counterparty FROM lp_vault_buffer_flows ORDER BY id');
    expect(flows.rows).toHaveLength(2);
    expect(flows.rows[0]!.kind).toBe('buffer_funded');
    expect(String(flows.rows[0]!.amount)).toBe('1000000000');
    expect(String(flows.rows[0]!.secondary_amount)).toBe('200000000');
    expect(flows.rows[0]!.counterparty).toBeNull();
    expect(flows.rows[1]!.kind).toBe('buffer_paid');
    expect(String(flows.rows[1]!.secondary_amount)).toBe('300000000');
    expect(flows.rows[1]!.counterparty).toBe(FAKE_TRADER);

    await db.close();
  });

  it('captures config and solvency topics in the archive only', async () => {
    const db = await setupDb();
    const router = makeLpRouter();
    const ctx: HandlerContext = { db, rpc: {} as never, bus: new IndexerBus(), log: noopLogger };

    await router.dispatch(
      lpEvent('evt-lp6', 'protocol_fee_routed', { amount: 10n, toBuffer: 5n, overflow: 0n }),
      ctx,
    );
    await router.dispatch(lpEvent('evt-lp7', 'paused', {}), ctx);

    const raw = await db.execute({
      sql: 'SELECT event_id, topic FROM events_raw WHERE contract_id = ? ORDER BY event_id',
      args: [FAKE_LP_VAULT],
    });
    expect(raw.rows.map((r) => r.topic)).toEqual(['protocol_fee_routed', 'paused']);

    for (const table of ['lp_vault_deposits', 'lp_vault_withdraws', 'lp_vault_pnl_settlements', 'lp_vault_buffer_flows']) {
      const count = await db.execute(`SELECT COUNT(*) AS n FROM ${table}`);
      expect(Number(count.rows[0]!.n)).toBe(0);
    }

    await db.close();
  });
});

describe('pruneRetiredFactoryRows', () => {
  it('deletes rows with a NULL or retired contract_id and keeps the live factory rows', async () => {
    const db = await setupDb();
    const OLD_FACTORY = 'CAOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLD';

    const seedVault = (id: number, contractId: string | null) =>
      db.execute({
        sql: `
          INSERT INTO vaults (id, leader, name, created_at, updated_at, contract_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        args: [id, FAKE_TRADER, `vault-${id}`, 1745900000, Date.now(), contractId],
      });
    await seedVault(0, null);
    await seedVault(12, OLD_FACTORY);
    await seedVault(3, FAKE_FACTORY);

    const seedDeposit = (eventId: string, contractId: string | null) =>
      db.execute({
        sql: `
          INSERT INTO vault_deposits (vault_id, depositor, amount, shares, ledger, ts, tx_hash, event_id, contract_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [0, FAKE_TRADER, '1000', '1000', 100, 1745900000, 'c'.repeat(64), eventId, contractId],
      });
    await seedDeposit('evt-old-dep', null);
    await seedDeposit('evt-live-dep', FAKE_FACTORY);

    await pruneRetiredFactoryRows(db, FAKE_FACTORY, noopLogger);

    const vaults = await db.execute('SELECT id, contract_id FROM vaults ORDER BY id');
    expect(vaults.rows.map((r) => Number(r.id))).toEqual([3]);
    expect(vaults.rows[0]!.contract_id).toBe(FAKE_FACTORY);

    const deposits = await db.execute('SELECT event_id FROM vault_deposits');
    expect(deposits.rows.map((r) => r.event_id)).toEqual(['evt-live-dep']);

    await db.close();
  });

  it('deletes nothing when no factory id is configured', async () => {
    const db = await setupDb();
    await db.execute({
      sql: `INSERT INTO vaults (id, leader, name, created_at, updated_at, contract_id)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [3, FAKE_TRADER, 'vault-3', 1745900000, Date.now(), FAKE_FACTORY],
    });

    // An empty factory id must be a no-op, never a wipe. With IS DISTINCT FROM
    // an empty string every row looks retired and the whole projection would go.
    await pruneRetiredFactoryRows(db, '', noopLogger);

    const vaults = await db.execute('SELECT id FROM vaults');
    expect(vaults.rows.map((r) => Number(r.id))).toEqual([3]);
    await db.close();
  });
});
