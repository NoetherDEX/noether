import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * L1-10: first test infra in web/ — deliberately scoped to PURE modules
 * under lib/ (no DOM, no Next, no chain). Notification dedupe and the
 * contract-error coverage guard are exactly the silent-failure logic that
 * needs pinning; components stay out of scope.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
