import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Each test file boots its own in-memory Postgres (PGlite). With every
    // file running in parallel the WASM instantiation contends for CPU, so
    // the FIRST test in a file can absorb multiple seconds of cold-start —
    // vitest's 5s default flakes on it.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
