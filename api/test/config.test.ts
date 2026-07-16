import { describe, expect, it, afterEach } from 'vitest';
import { DEFAULT_HMAC_PEPPER, loadConfig } from '../src/config.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function setProductionEnv(): void {
  process.env.NODE_ENV = 'production';
  process.env.API_HMAC_PEPPER = 'a'.repeat(64);
  process.env.API_KEY_ALLOWLIST = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';
  process.env.API_CORS_ORIGIN = 'https://noether.exchange';
  process.env.DATABASE_URL = 'postgresql://config-test.invalid/db';
}

describe('production fail-closed startup', () => {
  it('boots with a fully configured production env', () => {
    setProductionEnv();
    expect(() => loadConfig()).not.toThrow();
  });

  it('throws when API_HMAC_PEPPER is unset', () => {
    setProductionEnv();
    delete process.env.API_HMAC_PEPPER;
    expect(() => loadConfig()).toThrow(/API_HMAC_PEPPER/);
  });

  it('throws when API_HMAC_PEPPER equals the dev default', () => {
    setProductionEnv();
    process.env.API_HMAC_PEPPER = DEFAULT_HMAC_PEPPER;
    expect(() => loadConfig()).toThrow(/API_HMAC_PEPPER/);
  });

  it('throws when API_KEY_ALLOWLIST is unset or empty', () => {
    setProductionEnv();
    delete process.env.API_KEY_ALLOWLIST;
    expect(() => loadConfig()).toThrow(/API_KEY_ALLOWLIST/);
    setProductionEnv();
    process.env.API_KEY_ALLOWLIST = '  ';
    expect(() => loadConfig()).toThrow(/API_KEY_ALLOWLIST/);
  });

  it('throws when CORS is the wildcard default', () => {
    setProductionEnv();
    delete process.env.API_CORS_ORIGIN;
    expect(() => loadConfig()).toThrow(/API_CORS_ORIGIN/);
    setProductionEnv();
    process.env.API_CORS_ORIGIN = '*';
    expect(() => loadConfig()).toThrow(/API_CORS_ORIGIN/);
  });

  it('throws when DATABASE_URL is unset (any env)', () => {
    setProductionEnv();
    delete process.env.DATABASE_URL;
    expect(() => loadConfig()).toThrow(/DATABASE_URL/);
  });

  it('still boots with defaults outside production (DATABASE_URL required)', () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.NODE_ENV;
    delete process.env.API_HMAC_PEPPER;
    delete process.env.API_KEY_ALLOWLIST;
    delete process.env.API_CORS_ORIGIN;
    process.env.DATABASE_URL = 'postgresql://config-test.invalid/db';
    expect(() => loadConfig()).not.toThrow();
    expect(loadConfig().corsOrigin).toBe('*');
  });
});

describe('CORS origin parsing', () => {
  it('splits a comma-separated API_CORS_ORIGIN into a list', () => {
    setProductionEnv();
    process.env.API_CORS_ORIGIN =
      'https://noether.exchange, https://staging.noether.exchange';
    expect(loadConfig().corsOrigin).toEqual([
      'https://noether.exchange',
      'https://staging.noether.exchange',
    ]);
  });

  it('keeps a single origin as a plain string', () => {
    setProductionEnv();
    expect(loadConfig().corsOrigin).toBe('https://noether.exchange');
  });
});
