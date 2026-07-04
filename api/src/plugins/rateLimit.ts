import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { ApiKeyStore } from '../services/apiKeys.js';
import type { RateLimiter, RateLimitTier } from '../services/rateLimit.js';
import { resolveRequestUser } from './auth.js';

export interface RateLimitPluginOpts {
  limiter: RateLimiter;
  apiKeys: ApiKeyStore;
}

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

async function rateLimitPluginImpl(app: FastifyInstance, opts: RateLimitPluginOpts): Promise<void> {
  const sweepTimer = setInterval(() => {
    void opts.limiter.sweepExpired().catch(() => undefined);
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();
  app.addHook('onClose', async () => {
    clearInterval(sweepTimer);
  });

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url === '/v1/health' || request.url.startsWith('/docs')) {
      return; // free-tier convenience
    }
    // Resolve the bearer key here so the tier is known before the limit is
    // applied — requireAuth runs in a later preHandler phase and short-circuits
    // when request.user is already populated. Failures are ignored: the
    // request stays on the public tier and requireAuth still 401s authed routes.
    if (!request.user) {
      await resolveRequestUser(request, opts.apiKeys);
    }
    const tier: RateLimitTier = request.user?.tier ?? 'public';
    const bucket = request.user
      ? `key:${request.user.keyId}`
      : `ip:${request.ip}`;

    const decision = await opts.limiter.checkAndConsume(bucket, tier);
    reply.header('X-RateLimit-Tier', tier);
    reply.header('X-RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed) {
      reply.header('Retry-After', String(decision.retryAfterSec));
      return reply.code(429).send({ error: 'rate_limited', retry_after_sec: decision.retryAfterSec });
    }
  });
}

export const rateLimitPlugin = fp(rateLimitPluginImpl, { name: 'noether-rate-limit' });
