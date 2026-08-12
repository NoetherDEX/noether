import type { FastifyInstance } from 'fastify';
import { isMissingTable, type Db } from '@noether/db';
import { resolvedContracts, type ContractKey, type ContractsManifest } from '@noether/shared';
import type { PauseStateService } from '../services/pauseState.js';
import { TtlCache } from '../services/cache.js';

/** How long one sampled counts block serves /v1/health hits. Uptime probes
 *  poll this route continuously; without a cache every hit costs an RPC
 *  getLedgerEntries plus a Postgres count. Same pattern as PauseStateService. */
const COUNTS_TTL_MS = 15_000;
/** Ceiling on the chain read — the RPC client has NO transport timeout of
 *  its own (axios default is infinite), and a blackholed RPC must degrade
 *  this block to nulls, not hang the health route. */
const COUNTS_RPC_TIMEOUT_MS = 3_000;

const ECHOED_KEYS: readonly ContractKey[] = [
  'market',
  'vault',
  'noeracleShim',
  'noetherRouter',
  'usdcToken',
  'noeToken',
  'vaultFactory',
  'referral',
];

export interface HealthDeps {
  db: Db;
  contracts: ContractsManifest;
  /** L0-15 market pause state (Batch-1) — omitted in minimal test setups. */
  pauseState?: PauseStateService;
  /** Phase 4 drift alarm: the market's on-chain open counters, read straight
   *  from ledger storage. Null fields until the market is upgraded. */
  openCounts?: () => Promise<{ chainOpenPositions: number | null; chainOpenOrders: number | null }>;
  /** Market id the positions projection is scoped to for the drift compare. */
  marketId?: string;
}

interface CountsBlock {
  chainOpenPositions: number | null;
  chainOpenOrders: number | null;
  indexedOpenPositions: number | null;
  drift: boolean | null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);
}

export async function registerHealthRoutes(app: FastifyInstance, deps?: HealthDeps): Promise<void> {
  const countsCache = new TtlCache<CountsBlock>(COUNTS_TTL_MS);
  app.get(
    '/v1/health',
    {
      schema: {
        description:
          'Liveness + config probe. Reports uptime, the resolved contract addresses this ' +
          'process actually serves (env override vs baked manifest — D-4), and how stale the ' +
          'indexer read-side is (age of the last indexed ledger).',
        tags: ['system'],
      },
    },
    async () => {
      const base = {
        status: 'ok',
        uptime: process.uptime(),
        version: process.env.npm_package_version ?? '0.0.0-dev',
      };
      if (!deps) return base;

      const contracts = resolvedContracts(ECHOED_KEYS, deps.contracts);

      // Last indexed ledger + its age. A cursor that stops advancing is the
      // signal an UptimeRobot/BetterStack check should alert on (P3-1/D-2).
      let indexer: {
        lastLedger: number | null;
        lastUpdatedAt: number | null;
        ledgerAgeSeconds: number | null;
      } = { lastLedger: null, lastUpdatedAt: null, ledgerAgeSeconds: null };
      try {
        const row = (
          await deps.db.execute('SELECT last_ledger, updated_at FROM poll_cursor WHERE id = 1')
        ).rows[0] as { last_ledger: number | bigint; updated_at: number | bigint } | undefined;
        if (row) {
          const updatedAt = Number(row.updated_at);
          indexer = {
            lastLedger: Number(row.last_ledger),
            lastUpdatedAt: updatedAt,
            ledgerAgeSeconds: Math.max(0, Math.round(Date.now() / 1000 - updatedAt / 1000)),
          };
        }
      } catch {
        // poll_cursor absent (fresh DB) — leave nulls
      }

      // L0-15 (Batch-1): the market's effective pause mode. supported:false
      // on the pre-Batch-1 chain — consumers must not read that as "live".
      const market = deps.pauseState
        ? { pauseState: await deps.pauseState.pauseState() }
        : undefined;

      // Phase 4 drift alarm: on-chain OpenPositionCount vs the indexer's
      // open-positions projection. All-null until the market upgrade lands
      // (the counter keys don't exist before it) — never a fabricated zero.
      // One sample serves COUNTS_TTL_MS of health hits; both sides are read
      // in the same sample so drift compares one moment, not two.
      let counts: CountsBlock | undefined;
      if (deps.openCounts) {
        counts = await countsCache.getOrLoad('counts', async () => {
          let chain = {
            chainOpenPositions: null as number | null,
            chainOpenOrders: null as number | null,
          };
          try {
            chain = await withTimeout(deps.openCounts!(), COUNTS_RPC_TIMEOUT_MS);
          } catch (err) {
            app.log.warn({ err }, 'health: open-count chain read failed');
          }
          let indexedOpenPositions: number | null = null;
          if (deps.marketId) {
            try {
              const row = (
                await deps.db.execute({
                  sql: 'SELECT count(*) AS n FROM positions WHERE contract_id = ?',
                  args: [deps.marketId],
                })
              ).rows[0] as { n: number | bigint | string } | undefined;
              if (row) indexedOpenPositions = Number(row.n);
            } catch (err) {
              // Absent table (fresh DB) is expected; anything else is worth a line.
              if (!isMissingTable(err)) {
                app.log.warn({ err }, 'health: positions count read failed');
              }
            }
          }
          const drift =
            chain.chainOpenPositions !== null && indexedOpenPositions !== null
              ? chain.chainOpenPositions !== indexedOpenPositions
              : null;
          return { ...chain, indexedOpenPositions, drift };
        });
      }

      return {
        ...base,
        network: deps.contracts.network,
        contracts,
        indexer,
        ...(market ? { market } : {}),
        ...(counts ? { counts } : {}),
      };
    },
  );
}
