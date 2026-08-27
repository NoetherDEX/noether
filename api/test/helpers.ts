import { PGlite } from '@electric-sql/pglite';
import { createPgliteDb } from '@noether/db/pglite';
import type { Db } from '@noether/db';
import {
  Account,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { buildServer, type ServerDeps } from '../src/server.js';

export const TEST_CONFIG_PASSPHRASE = Networks.TESTNET;

/** In-memory Postgres (PGlite) behind the same Db surface production uses. */
export function makeTestDb(): Db {
  return createPgliteDb(new PGlite());
}

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

/** Stands in for every contract id in tests. Exported so seeded projection
 *  rows can carry the same contract_id the indexer writes in production,
 *  which is what the market scoped reads filter on. */
export const FAKE_CONTRACT = 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD';

export const TEST_CONFIG: ApiConfig = {
  network: 'testnet',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'debug',
  corsOrigin: '*',
  rpcUrls: ['http://example.invalid'],
  rpcUrl: 'http://example.invalid',
  sourceAccount: 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN',
  // Tests always inject a PGlite-backed Db; this URL is never dialed.
  databaseUrl: 'postgresql://injected-by-tests.invalid/test',
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
  ws: {
    maxConnections: 1000,
    maxPerIp: 100,
    pingIntervalMs: 1_000_000,
    msgRate: 1000,
    maxBufferedBytes: 1_048_576,
  },
  adminWallets: [],
};

/**
 * Seed the Postgres tables used by the API.
 * Mirrors indexer/migrations/001_baseline.sql — duplicated here so the API
 * test suite stays self-contained.
 */
export async function seedSchema(db: Db): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS api_keys (
      key_id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL,
      owner TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'standard',
      label TEXT,
      created_at BIGINT NOT NULL,
      last_used_at BIGINT,
      revoked_at BIGINT
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      key_id TEXT NOT NULL,
      window_start BIGINT NOT NULL,
      count BIGINT NOT NULL,
      PRIMARY KEY (key_id, window_start)
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS events_raw (
      event_id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      ledger BIGINT NOT NULL,
      ledger_close_ts BIGINT NOT NULL,
      tx_hash TEXT NOT NULL,
      payload_json JSONB NOT NULL,
      inserted_at BIGINT NOT NULL
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS positions (
      position_id BIGINT PRIMARY KEY,
      trader TEXT NOT NULL,
      asset TEXT NOT NULL,
      direction SMALLINT NOT NULL,
      size TEXT NOT NULL,
      entry_price TEXT NOT NULL,
      opened_at BIGINT NOT NULL,
      opened_tx_hash TEXT NOT NULL,
      contract_id TEXT
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS poll_cursor (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_ledger BIGINT NOT NULL,
      last_pagination_token TEXT,
      updated_at BIGINT NOT NULL
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS leaderboard_legacy (
      address TEXT PRIMARY KEY,
      trade_count BIGINT NOT NULL DEFAULT 0,
      total_volume NUMERIC NOT NULL DEFAULT 0,
      total_pnl NUMERIC NOT NULL DEFAULT 0,
      liq_count BIGINT NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'test',
      imported_at BIGINT NOT NULL,
      scope_key TEXT NOT NULL DEFAULT 'testnet'
    );
  `);
  // Workstream A access system — mirrors indexer/migrations/009_access_grants.sql
  await db.execute(`
    CREATE TABLE IF NOT EXISTS access_grants (
      wallet        TEXT PRIMARY KEY,
      email         TEXT,
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
      source        TEXT NOT NULL
                    CHECK (source IN ('waitlist', 'admin', 'code_migration')),
      wave          TEXT,
      segment       TEXT CHECK (segment IN ('trader', 'lp', 'both')),
      attested_at   TIMESTAMPTZ,
      tos_version   TEXT,
      requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_at    TIMESTAMPTZ,
      decided_by    TEXT,
      notes         TEXT,
      email_sent_at TIMESTAMPTZ
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS access_audit_log (
      id     BIGSERIAL PRIMARY KEY,
      at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor  TEXT NOT NULL,
      action TEXT NOT NULL,
      wallet TEXT,
      detail JSONB
    );
  `);
}

export async function setupTestServer(opts?: {
  oraclePrices?: Record<string, [bigint, bigint]>;
  db?: Db;
  /** Seed events_raw with these rows (only when db not provided manually). */
  seedEvents?: {
    eventId: string;
    topic: string;
    ledger: number;
    payload: object;
    contractId?: string;
    ledgerCloseTs?: number;
    txHash?: string;
  }[];
  ordersOverride?: import('../src/routes/orders.js').OrdersRouteDeps;
  txOverride?: import('../src/routes/tx.js').TxRoutesDeps;
  /** Enables POST /v1/oracle/heartbeat with this shared secret. */
  keeperHeartbeatSecret?: string;
  /** L0-1: decoded position states served to the AdlQueueService in place
   *  of ledger-entry hydration. */
  adlPositions?: import('../src/services/adlQueue.js').AdlPositionState[];
  /** L0-3: vault shortfall view values; absent = the reader throws like a
   *  pre-Batch-1 vault (supported:false path). */
  shortfall?: { owed: bigint; reserve: bigint };
  /** L1-13: chain values behind the capacity headroom fields. Absent = every
   *  capacity read throws and /v1/markets/stats omits `capacity` / `pool`. */
  capacity?: {
    aum: bigint;
    reservedPayout: bigint;
    usdcBalance: bigint;
    shortfallReserve: bigint;
    reserveCapBps: number;
    /** [assetCapBps, capAbs, skewCapBps] per asset; default [2500, 0n, 1500]. */
    assetCaps?: Record<string, [number, bigint, number]>;
    /** get_asset_risk.max_position_size; null = unset on chain; default $100k. */
    maxPositionSize?: bigint | null;
    exposure?: Record<string, { long: bigint; short: bigint }>;
    latestLedger?: number;
  };
  /** Stellar network the gateway serves (leaderboard scope gate); defaults
   *  to the TEST_CONFIG testnet. */
  network?: import('@noether/types').Network;
  /** Wallets granted the /v1/admin/* surface. */
  adminWallets?: string[];
  /** Workstream A: waitlist join 503s when Turnstile is unconfigured. */
  turnstileDisabled?: boolean;
}) {
  const cap = opts?.capacity;
  const reader = {
    async read<T>(_contractId: string, method: string, args: unknown[] = []): Promise<T> {
      if (cap) {
        if (method === 'get_aum') return cap.aum as T;
        if (method === 'get_reserved_payout') return cap.reservedPayout as T;
        if (method === 'get_usdc_balance') return cap.usdcBalance as T;
        if (method === 'get_reserve_cap') return cap.reserveCapBps as T;
        if (method === 'get_shortfall_reserve' && !opts?.shortfall) return cap.shortfallReserve as T;
        if (method === 'get_asset_caps') {
          const [bps, abs, skew] = cap.assetCaps?.[extractSymbol(args[0])] ?? [2500, 0n, 1500];
          return [bps, abs, skew, (cap.aum * BigInt(bps)) / 10_000n] as T;
        }
        if (method === 'get_asset_risk') {
          if (cap.maxPositionSize === null) return null as T;
          return { max_position_size: cap.maxPositionSize ?? 1_000_000_000_000n } as T;
        }
      }
      if (method === 'get_shortfall_owed') {
        if (!opts?.shortfall) throw new Error('MissingValue: invoking unknown export');
        return opts.shortfall.owed as T;
      }
      if (method === 'get_shortfall_reserve') {
        if (!opts?.shortfall) throw new Error('MissingValue: invoking unknown export');
        return opts.shortfall.reserve as T;
      }
      const arg = args[0];
      const symbol = extractSymbol(arg);
      const tuple = (opts?.oraclePrices ?? {})[symbol] ?? [0n, 0n];
      return tuple as T;
    },
    async readAssetExposure(_marketId: string, symbols: readonly string[]) {
      if (!cap) throw new Error('getLedgerEntries unavailable');
      const exposure = new Map(
        symbols.map((s) => [s, cap.exposure?.[s] ?? { long: 0n, short: 0n }] as const),
      );
      return { exposure, latestLedger: cap.latestLedger ?? null };
    },
  } as unknown as ContractReader;

  const oracle = new OracleService(reader, FAKE_CONTRACT);
  const markets = new MarketsService(oracle);
  const db = opts?.db ?? makeTestDb();
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
          e.ledgerCloseTs ?? 1745923200,
          e.txHash ?? 't',
          JSON.stringify(e.payload),
          Date.now(),
        ],
      });
    }
  }
  const events = new EventsService(db);
  const apiKeys = new ApiKeyStore(db, 'test-pepper');
  const walletAuth = new WalletAuth(TEST_CONFIG_PASSPHRASE);
  const access = new (await import('../src/services/accessGrants.js')).AccessGrantsService(db);
  const accessWalletAuth = new WalletAuth(TEST_CONFIG_PASSPHRASE);
  // Stub Turnstile: the literal token 'valid-token' passes, all else fails.
  const turnstile = opts?.turnstileDisabled
    ? { enabled: false as const, verify: async () => false }
    : { enabled: true as const, verify: async (token: string) => token === 'valid-token' };
  const sentEmails: Array<{ to: string; wave: string | null }> = [];
  const approvalEmailer = {
    enabled: true as const,
    sendApproval: async (to: string, wave: string | null) => {
      sentEmails.push({ to, wave });
      return true;
    },
  };
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
  const stubSubmit = async () => ({ kind: 'success' as const, hash: 'stub-hash' });

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
    submitService: { submit: stubSubmit },
  };

  const network = opts?.network ?? TEST_CONFIG.network;
  const vaults = new (await import('../src/services/vaults.js')).VaultsService(db);
  const referral = new (await import('../src/services/referral.js')).ReferralReadService(db);
  const stats = new (await import('../src/services/stats.js')).StatsService(
    db,
    FAKE_CONTRACT,
    network,
  );
  const adlQueue = new (await import('../src/services/adlQueue.js')).AdlQueueService({
    db,
    oracle,
    marketContractId: FAKE_CONTRACT,
    rpcUrl: TEST_CONFIG.rpcUrl,
    hydratePositions: async (ids) =>
      (opts?.adlPositions ?? []).filter((p) => ids.includes(p.positionId)),
  });
  const shortfall = new (await import('../src/services/shortfall.js')).ShortfallService(
    reader,
    FAKE_CONTRACT,
  );
  const capacity = new (await import('../src/services/capacity.js')).CapacityService({
    reader,
    vaultId: FAKE_CONTRACT,
    marketId: FAKE_CONTRACT,
  });
  const deps: ServerDeps = {
    oracle, markets, events, apiKeys, walletAuth, access, accessWalletAuth,
    turnstile, approvalEmailer, rateLimiter, db,
    orders, tx, wsBus, wsManager, oracleTicker, liveTailer, vaults, referral, stats,
    adlQueue, shortfall, capacity,
  };
  const app = await buildServer(
    {
      ...TEST_CONFIG,
      network,
      keeperHeartbeatSecret: opts?.keeperHeartbeatSecret,
      adminWallets: opts?.adminWallets ?? [],
    },
    deps,
  );
  return { app, db, deps, sentEmails };
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
