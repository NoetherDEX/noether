import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { RateLimiter, RateLimitTier } from '../services/rateLimit.js';

export interface RateLimitPluginOpts {
  limiter: RateLimiter;
}

async function rateLimitPluginImpl(app: FastifyInstance, opts: RateLimitPluginOpts): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url === '/v1/health' || request.url.startsWith('/docs')) {
      return; // free-tier convenience
    }
    const tier: RateLimitTier = request.user?.tier ?? 'public';
    const bucket = request.user
      ? `key:${request.user.keyId}`
      : `ip:${pickClientIp(request)}`;

    const decision = await opts.limiter.checkAndConsume(bucket, tier);
    reply.header('X-RateLimit-Tier', tier);
    reply.header('X-RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed) {
      reply.header('Retry-After', String(decision.retryAfterSec));
      return reply.code(429).send({ error: 'rate_limited', retry_after_sec: decision.retryAfterSec });
    }
  });
}

function pickClientIp(request: FastifyRequest): string {
  const xff = request.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0];
    if (first) return first.trim();
  }
  return request.ip;
}

export const rateLimitPlugin = fp(rateLimitPluginImpl, { name: 'noether-rate-limit' });
