import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { ApiKeyStore, KeyTier } from '../services/apiKeys.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      keyId: string;
      owner: string;
      tier: KeyTier;
    };
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export interface AuthPluginOpts {
  apiKeys: ApiKeyStore;
}

const TIMESTAMP_TOLERANCE_SEC = 30;

async function authPluginImpl(app: FastifyInstance, opts: AuthPluginOpts): Promise<void> {
  app.decorate('requireAuth', async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
    const auth = (request.headers.authorization ?? '').toString();
    if (!auth.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'missing_bearer' });
    }
    const bearer = auth.slice('Bearer '.length).trim();
    const sep = bearer.indexOf(':');
    if (sep < 0) {
      return reply.code(401).send({ error: 'malformed_bearer', hint: 'use Bearer <keyId>:<secret>' });
    }
    const keyId = bearer.slice(0, sep);
    const secret = bearer.slice(sep + 1);

    // Optional X-Timestamp replay protection (clients are encouraged but not
    // required to send it; HTTPS is the primary mitigation).
    const tsRaw = request.headers['x-timestamp'];
    if (tsRaw !== undefined) {
      const ts = Number(Array.isArray(tsRaw) ? tsRaw[0] : tsRaw);
      const now = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(ts) || Math.abs(now - ts) > TIMESTAMP_TOLERANCE_SEC) {
        return reply.code(401).send({ error: 'stale_timestamp' });
      }
    }

    const record = await opts.apiKeys.lookupForAuth(keyId, secret);
    if (!record) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    request.user = { keyId: record.keyId, owner: record.owner, tier: record.tier };
  });
}

export const authPlugin = fp(authPluginImpl, { name: 'noether-auth' });
