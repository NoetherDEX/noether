import { describe, expect, it, afterEach } from 'vitest';
import { setupTestServer } from './helpers.js';

/**
 * The route manifest is an explicit, committed list. Its purpose is to make
 * "deployed but uncommitted" impossible to repeat: GET /v1/leaderboard/totals
 * ran in production for weeks while existing in no commit, so a rebuild from
 * git would have silently dropped it. If a route is added or removed, this
 * test fails until the list below is updated in the same change — which forces
 * the surface to move deliberately, not by image drift. A newly appearing
 * (e.g. unauthenticated) route is surfaced for review rather than shipped
 * silently.
 *
 * Method + path only; handler behaviour is covered by the per-route tests.
 * HEAD/OPTIONS and the /docs Swagger-UI internals are excluded as plugin noise.
 */
const EXPECTED_ROUTES = [
  'DELETE /v1/keys/:keyId',
  'GET /docs',
  'GET /v1/account/me',
  'GET /v1/account/me/events',
  'GET /v1/account/me/orders',
  'GET /v1/account/me/positions',
  'GET /v1/account/shortfall',
  'GET /v1/account/volume',
  'GET /v1/adl/queue',
  'GET /v1/admin/waitlist',
  'GET /v1/admin/waitlist/export.csv',
  'GET /v1/candles',
  'GET /v1/events',
  'GET /v1/health',
  'GET /v1/keys',
  'GET /v1/keys/beta-status',
  'GET /v1/leaderboard',
  'GET /v1/leaderboard/rank',
  'GET /v1/leaderboard/totals',
  'GET /v1/markets',
  'GET /v1/markets/:asset',
  'GET /v1/markets/:asset/price',
  'GET /v1/markets/stats',
  'GET /v1/oracle/health',
  'GET /v1/oracle/prices',
  'GET /v1/orders/open',
  'GET /v1/positions/open',
  'GET /v1/referral/info',
  'GET /v1/referral/lookup',
  'GET /v1/referral/me',
  'GET /v1/referral/me/claims',
  'GET /v1/referral/me/trades',
  'GET /v1/trades',
  'GET /v1/vaults',
  'GET /v1/vaults/:id',
  'GET /v1/vaults/:id/deposits',
  'GET /v1/vaults/:id/fee-claims',
  'GET /v1/vaults/:id/trades',
  'GET /v1/vaults/:id/withdraws',
  'GET /v1/waitlist/status',
  'GET /v1/ws',
  'POST /v1/access/challenge',
  'POST /v1/access/verify',
  'POST /v1/admin/waitlist/decide',
  'POST /v1/keys',
  'POST /v1/keys/challenge',
  'POST /v1/oracle/heartbeat',
  'POST /v1/orders/prepare',
  'POST /v1/tx/submit',
  'POST /v1/waitlist',
];

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

/**
 * Fastify renders routes as an indented tree whose children carry only their
 * own path segment; reconstruct full paths by tracking indentation depth
 * (4 columns per level).
 */
function routeManifest(instance: Awaited<ReturnType<typeof setupTestServer>>['app']): string[] {
  const printed = instance.printRoutes({ commonPrefix: false });
  const out = new Set<string>();
  const stack: string[] = [];
  for (const raw of printed.split('\n')) {
    const marker = raw.match(/(├──|└──) /);
    if (!marker || marker.index === undefined) continue;
    const depth = Math.round(marker.index / 4);
    const rest = raw.slice(marker.index + 4);
    const m = rest.match(/^(\S+) \(([^)]+)\)\s*$/);
    if (!m) continue;
    stack[depth] = m[1];
    stack.length = depth + 1;
    const path = stack.join('');
    if (path.includes('*') || path.startsWith('/docs/')) continue;
    for (const method of m[2].split(',').map((s) => s.trim())) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      out.add(`${method} ${path}`);
    }
  }
  return [...out].sort();
}

describe('route manifest', () => {
  it('exposes exactly the committed set of routes', async () => {
    const setup = await setupTestServer({ keeperHeartbeatSecret: 'test-secret' });
    app = setup.app;
    await app.ready();
    expect(routeManifest(app)).toEqual([...EXPECTED_ROUTES].sort());
  });
});
