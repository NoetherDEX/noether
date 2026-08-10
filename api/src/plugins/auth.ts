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

export type AuthFailure =
  | 'missing_bearer'
  | 'malformed_bearer'
  | 'missing_timestamp'
  | 'stale_timestamp'
  | 'invalid_credentials';

/**
 * Resolve the bearer credentials on a request and populate `request.user`.
 * Returns null on success or the failure reason without replying — callers
 * decide whether an unauthenticated request is fatal (requireAuth) or fine
 * (the rate-limit hook, which falls back to the public tier).
 */
export async function resolveRequestUser(
  request: FastifyRequest,
  apiKeys: ApiKeyStore,
): Promise<AuthFailure | null> {
  const auth = (request.headers.authorization ?? '').toString();
  if (!auth.startsWith('Bearer ')) {
    return 'missing_bearer';
  }
  const bearer = auth.slice('Bearer '.length).trim();
  const sep = bearer.indexOf(':');
  if (sep < 0) {
    return 'malformed_bearer';
  }
  const keyId = bearer.slice(0, sep);
  const secret = bearer.slice(sep + 1);

  // X-Timestamp replay protection is REQUIRED on authenticated requests.
  // While it was optional, a captured bearer token could be replayed forever
  // simply by omitting the header — the check was opt-in for the attacker.
  // Every first-party client already sends it (sdk-ts transport, sdk-py
  // transport, and web/lib/api/*), so requiring it costs them nothing.
  const tsRaw = request.headers['x-timestamp'];
  if (tsRaw === undefined) {
    return 'missing_timestamp';
  }
  const ts = Number(Array.isArray(tsRaw) ? tsRaw[0] : tsRaw);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TIMESTAMP_TOLERANCE_SEC) {
    return 'stale_timestamp';
  }

  const record = await apiKeys.lookupForAuth(keyId, secret);
  if (!record) {
    return 'invalid_credentials';
  }
  request.user = { keyId: record.keyId, owner: record.owner, tier: record.tier };
  return null;
}

async function authPluginImpl(app: FastifyInstance, opts: AuthPluginOpts): Promise<void> {
  app.decorate('requireAuth', async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
    if (request.user) return;
    const failure = await resolveRequestUser(request, opts.apiKeys);
    if (failure === 'malformed_bearer') {
      return reply.code(401).send({ error: 'malformed_bearer', hint: 'use Bearer <keyId>:<secret>' });
    }
    if (failure) {
      return reply.code(401).send({ error: failure });
    }
  });
}

export const authPlugin = fp(authPluginImpl, { name: 'noether-auth' });
