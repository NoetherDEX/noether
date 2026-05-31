import { createClient, type Client } from '@libsql/client';
import {
  Account,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { buildServer, type ServerDeps } from '../src/server.js';

export const TEST_CONFIG_PASSPHRASE = Networks.TESTNET;

/**
 * Build a SEP-10-style signed XDR for the wallet challenge — same flow
 * the SDK + web client use. Tests call this instead of `kp.sign(bytes)`
 * because the API verifies the signature against the transaction hash.
 */
export function signChallengeXdr(kp: Keypair, challengeHex: string): string {
  const placeholderSource = Keypair.random().publicKey();
  const account = new Account(placeholderSource, '0');
  const tx = new TransactionBuilder(account, {
    fee: '0',
    networkPassphrase: TEST_CONFIG_PASSPHRASE,
  })
    .addOperation(
      Operation.manageData({
        name: 'noether-api auth',
        value: Buffer.from(challengeHex, 'hex'),
        source: kp.publicKey(),
      }),
    )
    .setTimeout(0)
    .build();
  tx.sign(kp);
  return tx.toXDR();
}
import type { ApiConfig } from '../src/config.js';
import { MarketsService } from '../src/services/markets.js';
import { OracleService } from '../src/services/oracle.js';
import { EventsService } from '../src/services/events.js';
import { ApiKeyStore } from '../src/services/apiKeys.js';
import { WalletAuth } from '../src/services/walletAuth.js';
import { RateLimiter } from '../src/services/rateLimit.js';
import type { ContractReader } from '../src/services/contractReader.js';

const FAKE_CONTRACT = 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD';

export const TEST_CONFIG: ApiConfig = {
  network: 'testnet',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'debug',
  corsOrigin: '*',
  rpcUrls: ['http://example.invalid'],
  rpcUrl: 'http://example.invalid',
  sourceAccount: 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN',
  libsqlUrl: ':memory:',
  libsqlAuthToken: undefined,
  contracts: {
    network: 'testnet',
    deployedAt: '2026-01-01T00:00:00Z',
    admin: 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN',
    contracts: {
      noeracleShim: FAKE_CONTRACT,
      noeracle: FAKE_CONTRACT,
      noetherRouter: FAKE_CONTRACT,
      vault: FAKE_CONTRACT,
      market: FAKE_CONTRACT,
      usdcToken: FAKE_CONTRACT,
      noeToken: FAKE_CONTRACT,
      vaultFactory: FAKE_CONTRACT,
      referral: FAKE_CONTRACT,
      mockOracle: FAKE_CONTRACT,
      oracleAdapter: FAKE_CONTRACT,
    },
    noeAsset: { code: 'NOE', issuer: FAKE_CONTRACT },
  },
};

/**
 * Seed the libsql tables used by the API.
 * Mirrors the indexer's migrations 001 + 002 — duplicated here so the API
 * test suite stays self-contained.
 */
export async function seedSchema(db: Client): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS api_keys (
      key_id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL,
      owner TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'standard',
      label TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      revoked_at INTEGER
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      key_id TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (key_id, window_start)
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS events_raw (
      event_id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      ledger INTEGER NOT NULL,
      ledger_close_ts INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      inserted_at INTEGER NOT NULL
    );
  `);
}

export async function setupTestServer(opts?: {
  oraclePrices?: Record<string, [bigint, bigint]>;
  db?: Client;
  /** Seed events_raw with these rows (only when db not provided manually). */
  seedEvents?: { eventId: string; topic: string; ledger: number; payload: object; contractId?: string }[];
  ordersOverride?: import('../src/routes/orders.js').OrdersRouteDeps;
  txOverride?: import('../src/routes/tx.js').TxRoutesDeps;
}) {
  const reader = {
    async read<T>(_contractId: string, _method: string, args: unknown[] = []): Promise<T> {
      const arg = args[0];
      const symbol = extractSymbol(arg);
      const tuple = (opts?.oraclePrices ?? {})[symbol] ?? [0n, 0n];
      return tuple as T;
    },
  } as unknown as ContractReader;

  const oracle = new OracleService(reader, FAKE_CONTRACT);
  const markets = new MarketsService(oracle);
  const db = opts?.db ?? createClient({ url: ':memory:' });
  await seedSchema(db);
  if (opts?.seedEvents) {
    for (const e of opts.seedEvents) {
      await db.execute({
        sql: `INSERT INTO events_raw (event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, inserted_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          e.eventId,
          e.contractId ?? FAKE_CONTRACT,
          e.topic,
          e.ledger,
          1745923200,
          't',
          JSON.stringify(e.payload),
          Date.now(),
        ],
      });
    }
  }
  const events = new EventsService(db);
  const apiKeys = new ApiKeyStore(db, 'test-pepper');
  const walletAuth = new WalletAuth(TEST_CONFIG_PASSPHRASE);
  const rateLimiter = new RateLimiter(db);
  const wsBus = new (await import('../src/services/wsBus.js')).WsBus();
  const noopLogger = makeNoopLogger();
  const wsManager = new (await import('../src/services/wsManager.js')).WsManager(wsBus, noopLogger);
  const oracleTicker = new (await import('../src/services/oracleTicker.js')).OracleTicker({
    oracle, bus: wsBus, log: noopLogger, intervalMs: 1_000_000,
  });
  const liveTailer = new (await import('../src/services/liveTailer.js')).LiveTailer({
    db, bus: wsBus, log: noopLogger, intervalMs: 1_000_000,
  });

  const stubBuilder = async () => ({
    xdr: 'AAAAAg==',
    simulation: { minResourceFee: '1000', latestLedger: 0, transactionData: undefined } as never,
  });
  const stubSubmit = async () => ({ hash: 'stub-hash', status: 'SUCCESS' as const, result: undefined });

  const orders = opts?.ordersOverride ?? {
    txCtx: { rpcUrl: TEST_CONFIG.rpcUrl, network: TEST_CONFIG.network },
    marketContractId: FAKE_CONTRACT,
    builders: {
      openPosition: stubBuilder as never,
      closePosition: stubBuilder as never,
      placeLimitOrder: stubBuilder as never,
      cancelOrder: stubBuilder as never,
    },
  };
  const tx = opts?.txOverride ?? {
    txCtx: { rpcUrl: TEST_CONFIG.rpcUrl, network: TEST_CONFIG.network },
    submit: stubSubmit as never,
  };

  const vaults = new (await import('../src/services/vaults.js')).VaultsService(db);
  const referral = new (await import('../src/services/referral.js')).ReferralReadService(db);
  const deps: ServerDeps = {
    oracle, markets, events, apiKeys, walletAuth, rateLimiter, db,
    orders, tx, wsBus, wsManager, oracleTicker, liveTailer, vaults, referral,
  };
  const app = await buildServer(TEST_CONFIG, deps);
  return { app, db, deps };
}

function makeNoopLogger() {
  const noop = () => undefined;
  const logger: import('pino').Logger = {
    level: 'silent',
    fatal: noop, error: noop, warn: noop, info: noop, debug: noop, trace: noop,
    silent: noop, child: () => logger,
  } as unknown as import('pino').Logger;
  return logger;
}

function extractSymbol(scVal: unknown): string {
  if (!scVal || typeof scVal !== 'object') return '';
  const s = scVal as { sym?: () => unknown };
  try {
    if (typeof s.sym === 'function') {
      const sym = s.sym();
      if (typeof sym === 'string') return sym;
      if (sym && typeof (sym as Buffer).toString === 'function') return (sym as Buffer).toString();
    }
  } catch {
    // fall through
  }
  return '';
}
