/**
 * Minimal /healthz endpoint for Railway healthchecks (I-4).
 *
 * The indexer is not a web service, so this is a bare
 * http.createServer — no framework. Reports poller liveness and
 * cursor lag (now - last indexed event's ledger close time). Returns
 * 503 once the poller stops (e.g. cursor CAS miss) or when no poll
 * has completed within maxPollAgeMs.
 */

import { createServer, type Server } from 'node:http';
import type { Client } from '@libsql/client';
import type { Logger } from 'pino';
import { readCursor, type PollCursor } from './cursor.js';
import type { PollerHealth } from './poll.js';

export interface HealthServerOpts {
  port: number;
  db: Client;
  log: Logger;
  maxPollAgeMs: number;
  source: { health(): PollerHealth };
}

export interface HealthPayload {
  statusCode: number;
  body: {
    status: 'ok' | 'unhealthy';
    fatal: string | null;
    lastLedger: number | null;
    pollAgeMs: number | null;
    cursorLagSeconds: number | null;
    cursorUpdatedAt: number | null;
  };
}

export function buildHealthPayload(
  health: PollerHealth,
  cursor: PollCursor | null,
  nowMs: number,
  maxPollAgeMs: number,
): HealthPayload {
  const sinceMs = health.lastPollOkAt ?? health.startedAt;
  const pollAgeMs = sinceMs === null ? null : nowMs - sinceMs;
  const cursorLagSeconds =
    health.lastEventCloseTs === null
      ? null
      : Math.max(0, Math.floor(nowMs / 1000) - health.lastEventCloseTs);
  const healthy =
    health.running && health.fatal === null && pollAgeMs !== null && pollAgeMs <= maxPollAgeMs;
  return {
    statusCode: healthy ? 200 : 503,
    body: {
      status: healthy ? 'ok' : 'unhealthy',
      fatal: health.fatal,
      lastLedger: health.lastLedger ?? cursor?.lastLedger ?? null,
      pollAgeMs,
      cursorLagSeconds,
      cursorUpdatedAt: cursor?.updatedAt ?? null,
    },
  };
}

export function startHealthServer(opts: HealthServerOpts): Server {
  const server = createServer((req, res) => {
    if ((req.url ?? '').split('?')[0] !== '/healthz') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not_found"}');
      return;
    }
    void (async () => {
      try {
        const cursor = await readCursor(opts.db).catch(() => null);
        const payload = buildHealthPayload(opts.source.health(), cursor, Date.now(), opts.maxPollAgeMs);
        res.writeHead(payload.statusCode, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload.body));
      } catch {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"status":"error"}');
      }
    })();
  });
  server.listen(opts.port, () => {
    opts.log.info({ port: opts.port }, 'Health endpoint listening on /healthz');
  });
  return server;
}
