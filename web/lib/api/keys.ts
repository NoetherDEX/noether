/**
 * Thin REST client for API key issuance + management.
 * Targets the @noether/api gateway via NEXT_PUBLIC_NOETHER_API_URL.
 */

const API_BASE = process.env.NEXT_PUBLIC_NOETHER_API_URL ?? 'http://localhost:4000';

export interface IssuedChallenge {
  challengeHex: string;
  expiresAt: number;
}

export interface IssuedApiKey {
  keyId: string;
  secret: string;
  owner: string;
  tier: 'standard' | 'market_maker';
  createdAt: number;
}

export interface ApiKeyRecord {
  keyId: string;
  owner: string;
  tier: 'standard' | 'market_maker';
  label: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

async function postJson<T>(path: string, body: unknown, auth?: { keyId: string; secret: string }): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (auth) {
    headers.authorization = `Bearer ${auth.keyId}:${auth.secret}`;
    headers['x-timestamp'] = String(Math.floor(Date.now() / 1000));
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function getJson<T>(path: string, auth?: { keyId: string; secret: string }): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (auth) {
    headers.authorization = `Bearer ${auth.keyId}:${auth.secret}`;
    headers['x-timestamp'] = String(Math.floor(Date.now() / 1000));
  }
  const res = await fetch(`${API_BASE}${path}`, { headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function deleteJson(path: string, auth: { keyId: string; secret: string }): Promise<void> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${auth.keyId}:${auth.secret}`,
    'x-timestamp': String(Math.floor(Date.now() / 1000)),
  };
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
}

export async function requestChallenge(address: string): Promise<IssuedChallenge> {
  return postJson<IssuedChallenge>('/v1/keys/challenge', { address });
}

export interface BetaStatus {
  /** Whether key issuance is currently locked to an allowlist. */
  gated: boolean;
  /** Whether the queried address (if any) is on the allowlist. */
  allowed: boolean;
}

export async function getBetaStatus(address?: string): Promise<BetaStatus> {
  const qs = address ? `?address=${encodeURIComponent(address)}` : '';
  return getJson<BetaStatus>(`/v1/keys/beta-status${qs}`);
}

export async function exchangeChallenge(input: {
  address: string;
  challenge: string;
  signatureHex: string;
  label?: string;
}): Promise<IssuedApiKey> {
  return postJson<IssuedApiKey>('/v1/keys', {
    address: input.address,
    challenge: input.challenge,
    signature: input.signatureHex,
    label: input.label,
  });
}

export async function listApiKeys(auth: { keyId: string; secret: string }): Promise<ApiKeyRecord[]> {
  const { keys } = await getJson<{ keys: ApiKeyRecord[] }>('/v1/keys', auth);
  return keys;
}

export async function revokeApiKey(
  auth: { keyId: string; secret: string },
  keyId: string,
): Promise<void> {
  await deleteJson(`/v1/keys/${encodeURIComponent(keyId)}`, auth);
}
