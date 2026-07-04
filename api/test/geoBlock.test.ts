import { describe, it, expect, afterEach } from 'vitest';
import { isBlocked } from '../src/plugins/geoBlock.js';
import { setupTestServer } from './helpers.js';

describe('geo-block (P6-4)', () => {
  it('isBlocked: countries + Ontario region', () => {
    expect(isBlocked('US', '')).toBe(true);
    expect(isBlocked('IR', '')).toBe(true);
    expect(isBlocked('CA', 'ON')).toBe(true); // Ontario
    expect(isBlocked('CA', 'BC')).toBe(false); // other CA provinces ok
    expect(isBlocked('GB', '')).toBe(false);
    expect(isBlocked('', '')).toBe(false); // no header → never block
  });

  const prev = process.env.API_GEOBLOCK;
  afterEach(() => {
    if (prev === undefined) delete process.env.API_GEOBLOCK;
    else process.env.API_GEOBLOCK = prev;
  });

  it('451s a trading endpoint from a blocked country, leaves reads open', async () => {
    process.env.API_GEOBLOCK = '1';
    const { app } = await setupTestServer();

    // Guarded trading endpoint from a blocked country → 451.
    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/tx/submit',
      headers: { 'cf-ipcountry': 'US', 'content-type': 'application/json' },
      payload: JSON.stringify({ xdr: 'AAAA' }),
    });
    expect(blocked.statusCode).toBe(451);
    expect(blocked.json().error).toBe('region_restricted');

    // Same endpoint from an allowed country is NOT geo-blocked (fails later
    // for auth/validation, not 451).
    const allowed = await app.inject({
      method: 'POST',
      url: '/v1/tx/submit',
      headers: { 'cf-ipcountry': 'GB', 'content-type': 'application/json' },
      payload: JSON.stringify({ xdr: 'AAAA' }),
    });
    expect(allowed.statusCode).not.toBe(451);

    // A public read endpoint is never geo-blocked, even from a blocked country.
    const read = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'cf-ipcountry': 'US' },
    });
    expect(read.statusCode).toBe(200);

    await app.close();
  });
});
