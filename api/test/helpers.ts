import { createClient, type Client } from '@libsql/client';
import { buildServer, type ServerDeps } from '../src/server.js';
import type { ApiConfig } from '../src/config.js';
import { MarketsService } from '../src/services/markets.js';
import { OracleService } from '../src/services/oracle.js';
import { EventsService } from '../src/services/events.js';
import type { ContractReader } from '../src/services/contractReader.js';

const FAKE_CONTRACT = 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD';

export const TEST_CONFIG: ApiConfig = {
  network: 'testnet',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'error',
  corsOrigin: '*',
  rpcUrl: 'http://example.invalid',
  sourceAccount: 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN',
  libsqlUrl: ':memory:',
  libsqlAuthToken: undefined,
  contracts: {
    network: 'testnet',
    deployedAt: '2026-01-01T00:00:00Z',
    admin: 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN',
    contracts: {
      mockOracle: FAKE_CONTRACT,
      oracleAdapter: FAKE_CONTRACT,
      vault: FAKE_CONTRACT,
      market: FAKE_CONTRACT,
      usdcToken: FAKE_CONTRACT,
      noeToken: FAKE_CONTRACT,
      vaultFactory: FAKE_CONTRACT,
      referral: FAKE_CONTRACT,
    },
    noeAsset: { code: 'NOE', issuer: FAKE_CONTRACT },
  },
};

/** Stub ContractReader that returns a configured map of (contract, method) -> value. */
export function makeStubReader(map: Map<string, unknown>): ContractReader {
  return {
    async read<T>(contractId: string, method: string): Promise<T> {
      const key = `${contractId}.${method}`;
      if (!map.has(key)) {
        throw new Error(`stub reader has no entry for ${key}`);
      }
      return map.get(key) as T;
    },
  } as unknown as ContractReader;
}

export async function setupTestServer(opts?: {
  oraclePrices?: Record<string, [bigint, bigint]>;
  db?: Client;
}) {
  const map = new Map<string, unknown>();
  for (const [asset, tuple] of Object.entries(opts?.oraclePrices ?? {})) {
    map.set(`${FAKE_CONTRACT}.lastprice`, tuple);
    // also keyed per-asset variant when oracle is asked for different ones
    map.set(`lastprice:${asset}`, tuple);
  }
  // The oracle uses a single entry keyed by contract.method; each call replaces
  // the value via a different stub strategy below.

  const reader = {
    async read<T>(_contractId: string, _method: string, args: unknown[] = []): Promise<T> {
      // Decode the symbol arg (first), expect ScVal — convert to native via toString.
      const arg = args[0];
      const symbol = extractSymbol(arg);
      const tuple = (opts?.oraclePrices ?? {})[symbol] ?? [0n, 0n];
      return tuple as T;
    },
  } as unknown as ContractReader;

  const oracle = new OracleService(reader, FAKE_CONTRACT);
  const markets = new MarketsService(oracle);
  const db = opts?.db ?? createClient({ url: ':memory:' });
  const events = new EventsService(db);
  const deps: ServerDeps = { oracle, markets, events };
  const app = await buildServer(TEST_CONFIG, deps);
  return { app, db, deps };
}

function extractSymbol(scVal: unknown): string {
  if (!scVal || typeof scVal !== 'object') return '';
  const s = scVal as { sym?: () => unknown; switch?: () => { name: string } };
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
