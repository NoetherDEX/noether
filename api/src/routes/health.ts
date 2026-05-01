import type { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/v1/health',
    {
      schema: {
        description: 'Liveness probe. Returns 200 when the API process is up.',
        tags: ['system'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              uptime: { type: 'number' },
              version: { type: 'string' },
            },
            required: ['status', 'uptime', 'version'],
          },
        },
      },
    },
    async () => ({
      status: 'ok',
      uptime: process.uptime(),
      version: process.env.npm_package_version ?? '0.0.0-dev',
    }),
  );
}
