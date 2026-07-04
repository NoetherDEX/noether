import type { FastifyInstance } from 'fastify';
import type { Client } from '@libsql/client';
import { resolvedContracts, type ContractKey, type ContractsManifest } from '@noether/shared';

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
  db: Client;
  contracts: ContractsManifest;
}

export async function registerHealthRoutes(app: FastifyInstance, deps?: HealthDeps): Promise<void> {
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

      return { ...base, network: deps.contracts.network, contracts, indexer };
    },
  );
}
