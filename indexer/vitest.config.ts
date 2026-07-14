import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // PGlite (in-memory Postgres) cold-start can exceed vitest's 5s default
    // when files run in parallel — see api/vitest.config.ts.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
