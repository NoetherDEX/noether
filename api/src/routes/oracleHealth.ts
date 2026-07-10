/**
 * Oracle health surface (T3-D1).
 *
 * GET /v1/oracle/health — public, per-source oracle status: on-chain shim
 * price age per asset (served from the OracleService cache the ticker keeps
 * warm), plus the keeper's last self-report. This is the endpoint an uptime
 * monitor should watch.
 *
 * POST /v1/oracle/heartbeat — machine-to-machine: the keeper posts a status
 * snapshot every oracle cycle, authenticated by a shared secret header
 * (`x-keeper-secret`). With no KEEPER_HEARTBEAT_SECRET configured the
 * endpoint is disabled (503) and health serves the on-chain-only view —
 * fail-open, and no new fail-closed boot requirement.
 */

import type { FastifyInstance } from 'fastify';
import { SUPPORTED_ASSETS } from '@noether/shared';
import type { OracleService } from '../services/oracle.js';

/** On-chain price older than this is stale (market halts at 60s + slack). */
const ONCHAIN_STALE_SEC = 90;
/** Keeper heartbeat older than this is stale (~4 missed 30s cycles). */
const KEEPER_STALE_MS = 120_000;

export interface OracleHealthDeps {
  oracle: OracleService;
  /** Shared secret for the keeper heartbeat; undefined disables the POST. */
  heartbeatSecret?: string;
}

interface HeartbeatRecord {
  receivedAt: number;
  body: Record<string, unknown>;
}

export async function registerOracleHealthRoutes(
  app: FastifyInstance,
  deps: OracleHealthDeps,
): Promise<void> {
  let lastHeartbeat: HeartbeatRecord | null = null;

  app.post(
    '/v1/oracle/heartbeat',
    {
      schema: {
        description:
          'Keeper status ingest (shared-secret header x-keeper-secret). Disabled without KEEPER_HEARTBEAT_SECRET.',
        tags: ['oracle'],
        body: { type: 'object', additionalProperties: true },
        response: {
          204: { type: 'null' },
          401: { type: 'object', additionalProperties: true },
          503: { type: 'object', additionalProperties: true },
        },
      },
    },
    async (req, reply) => {
      if (!deps.heartbeatSecret) {
        return reply.code(503).send({ error: 'heartbeat_disabled' });
      }
      if (req.headers['x-keeper-secret'] !== deps.heartbeatSecret) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      lastHeartbeat = {
        receivedAt: Date.now(),
        body: (req.body ?? {}) as Record<string, unknown>,
      };
      return reply.code(204).send();
    },
  );

  app.get(
    '/v1/oracle/health',
    {
      schema: {
        description:
          'Per-source oracle health: on-chain price age per asset + the keeper self-report. Point uptime monitoring here.',
        tags: ['oracle'],
        response: {
          200: { type: 'object', additionalProperties: true },
        },
      },
    },
    async (_req, reply) => {
      const nowSec = Math.floor(Date.now() / 1000);
      const assets = await Promise.all(
        SUPPORTED_ASSETS.map(async (a) => {
          try {
            const p = await deps.oracle.getPrice(a.symbol);
            const ageSec = Math.max(0, nowSec - p.timestamp);
            return {
              asset: a.symbol,
              priceFloat: p.priceFloat,
              ageSec,
              stale: ageSec > ONCHAIN_STALE_SEC,
              error: null as string | null,
            };
          } catch (err) {
            return {
              asset: a.symbol,
              priceFloat: null as number | null,
              ageSec: null as number | null,
              stale: true,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );

      const staleCount = assets.filter((a) => a.stale).length;
      const keeperConfigured = Boolean(deps.heartbeatSecret);
      const keeperAgeMs = lastHeartbeat ? Date.now() - lastHeartbeat.receivedAt : null;
      const keeperStale =
        keeperConfigured && (keeperAgeMs === null || keeperAgeMs > KEEPER_STALE_MS);

      const status =
        staleCount === assets.length
          ? 'down'
          : staleCount > 0 || keeperStale
            ? 'degraded'
            : 'ok';

      return reply.send({
        status,
        onchain: { staleAfterSec: ONCHAIN_STALE_SEC, staleCount, assets },
        keeper: {
          configured: keeperConfigured,
          ageMs: keeperAgeMs,
          stale: keeperStale,
          lastReport: lastHeartbeat?.body ?? null,
        },
      });
    },
  );
}
