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

import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { SUPPORTED_ASSETS } from '@noether/shared';
import type { OracleService } from '../services/oracle.js';

/**
 * Constant-time secret comparison.
 *
 * Both sides are hashed first so the operands are always 32 bytes:
 * `timingSafeEqual` throws outright on a length mismatch, and comparing raw
 * strings would leak the secret's length before any byte comparison happens.
 */
function secretsMatch(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * On-chain price older than this counts as stale here.
 *
 * The market reverts an open once the price passes its 60s max staleness, so
 * a looser threshold here reported green while opens were already failing with
 * error 30. This tracks the contract at 60 so the page turns amber the moment
 * trading is actually affected, not thirty seconds later.
 */
const ONCHAIN_STALE_SEC = 60;
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
      // Constant-time: `!==` short-circuits on the first differing byte, and
      // this is a low-entropy operator-chosen secret, so a plain comparison
      // leaks it a byte at a time to anyone who can time the response.
      const presented = req.headers['x-keeper-secret'];
      if (typeof presented !== 'string' || !secretsMatch(presented, deps.heartbeatSecret)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      lastHeartbeat = {
        receivedAt: Date.now(),
        body: (req.body ?? {}) as Record<string, unknown>,
      };
      return reply.code(204).send();
    },
  );

  app.get<{ Querystring: { strict?: string } }>(
    '/v1/oracle/health',
    {
      schema: {
        description:
          'Per-source oracle health: on-chain price age per asset + the keeper self-report. ' +
          'Point uptime monitoring here. Pass strict=1 to get 503 instead of 200 when the ' +
          'status is not ok, so a status-code monitor can page.',
        tags: ['oracle'],
        querystring: {
          type: 'object',
          properties: { strict: { type: 'string' } },
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          503: { type: 'object', additionalProperties: true },
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
      // With no heartbeat secret we have no keeper signal at all, which is a
      // blind spot, not health. It used to fall through to ok and hid that the
      // keeper reporting path was never wired up.
      const keeperUnknown = !keeperConfigured;

      const status =
        staleCount === assets.length
          ? 'down'
          : staleCount > 0 || keeperStale || keeperUnknown
            ? 'degraded'
            : 'ok';

      // With strict, the endpoint answers with an http status a plain uptime
      // monitor can page on: 200 only when everything is ok, 503 otherwise.
      // Without it the body still carries the same status string as before.
      const httpCode = _req.query.strict && status !== 'ok' ? 503 : 200;

      return reply.code(httpCode).send({
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
