import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { ApiConfig } from './config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMarketsRoutes } from './routes/markets.js';
import { registerOracleRoutes } from './routes/oracle.js';
import { registerEventsRoutes } from './routes/events.js';
import { ContractReader } from './services/contractReader.js';
import { OracleService } from './services/oracle.js';
import { MarketsService } from './services/markets.js';
import { EventsService } from './services/events.js';
import { createIndexerDb } from './services/indexerDb.js';

export interface ServerDeps {
  oracle: OracleService;
  markets: MarketsService;
  events: EventsService;
}

export async function buildServer(config: ApiConfig, depsOverride?: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  await app.register(cors, { origin: config.corsOrigin });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Noether API',
        description:
          'Public REST + WebSocket gateway for the Noether decentralized perpetual exchange on Stellar / Soroban.',
        version: '0.0.0-dev',
      },
      servers: [{ url: `http://${config.host}:${config.port}` }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  const deps = depsOverride ?? buildDefaultDeps(config);

  await app.register(registerHealthRoutes);
  await app.register((instance) => registerMarketsRoutes(instance, deps.markets));
  await app.register((instance) => registerOracleRoutes(instance, deps.oracle));
  await app.register((instance) => registerEventsRoutes(instance, deps.events));

  return app;
}

function buildDefaultDeps(config: ApiConfig): ServerDeps {
  const reader = new ContractReader({
    rpcUrl: config.rpcUrl,
    network: config.network,
    sourceAccount: config.sourceAccount,
  });
  const oracle = new OracleService(reader, config.contracts.contracts.mockOracle);
  const markets = new MarketsService(oracle);
  const db = createIndexerDb(config);
  const events = new EventsService(db);
  return { oracle, markets, events };
}
