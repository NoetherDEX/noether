/**
 * API gateway entry point — Phase 1 skeleton.
 *
 * Phase 1 ships a Fastify shell with /v1/health and /docs (Swagger UI).
 * Public read endpoints land in Phase 3, auth in Phase 4, trading in
 * Phase 5, WebSocket in Phase 8.
 */

import { resolvedContracts } from '@noether/shared';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);

  // Log which stack this process actually serves (env override vs baked
  // manifest). D-4 was a silent divergence — now it's in the boot log and
  // echoed from /v1/health.
  app.log.info(
    {
      resolved: resolvedContracts(
        ['market', 'vault', 'noeracleShim', 'noetherRouter', 'usdcToken', 'noeToken', 'vaultFactory', 'referral'],
        config.contracts,
      ),
    },
    'Resolved contract addresses',
  );

  const close = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));

  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info(
      { host: config.host, port: config.port, network: config.network },
      'API listening',
    );
  } catch (err) {
    app.log.error(err, 'Failed to start API');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('API fatal error:', err);
  process.exit(1);
});
