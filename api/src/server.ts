import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { ApiConfig } from './config.js';
import { registerHealthRoutes } from './routes/health.js';

export async function buildServer(config: ApiConfig): Promise<FastifyInstance> {
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

  await app.register(registerHealthRoutes);

  return app;
}
