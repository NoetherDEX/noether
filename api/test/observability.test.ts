import { readFileSync } from 'node:fs';
import { describe, expect, it, afterEach } from 'vitest';
import { setupTestServer } from './helpers.js';

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  delete process.env.API_PUBLIC_URL;
});

const PKG = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

describe('observability', () => {
  it('stamps x-request-id on every response', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/markets' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('echoes an incoming x-request-id header', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const res = await app.inject({
      method: 'GET',
      url: '/v1/markets',
      headers: { 'x-request-id': 'trace-me-42' },
    });
    expect(res.headers['x-request-id']).toBe('trace-me-42');
  });

  it('stamps x-request-id on error responses too', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/definitely-not-a-route' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('reports the package.json version in the OpenAPI document', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json() as { info: { version: string }; servers: { url: string }[] };
    expect(spec.info.version).toBe(PKG.version);
    expect(spec.info.version).not.toBe('0.0.0-dev');
    expect(spec.servers[0]!.url).toContain('http://localhost');
  });

  it('uses API_PUBLIC_URL for the OpenAPI servers block when set', async () => {
    process.env.API_PUBLIC_URL = 'https://api.noether.exchange';
    const setup = await setupTestServer();
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    const spec = res.json() as { servers: { url: string }[] };
    expect(spec.servers[0]!.url).toBe('https://api.noether.exchange');
  });
});
