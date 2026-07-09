import type {
  ReferralClaimRow,
  ReferralMeResponse,
  ReferralTradeRow,
  ReferrerRow,
} from '@/types/referral';

import { apiBase, apiError } from './base';

interface AuthHeaders {
  keyId: string;
  secret: string;
}

async function fetchJson<T>(path: string, auth?: AuthHeaders): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (auth) {
    headers.authorization = `Bearer ${auth.keyId}:${auth.secret}`;
    headers['x-timestamp'] = String(Math.floor(Date.now() / 1000));
  }
  const res = await fetch(`${apiBase()}${path}`, { headers, cache: 'no-store' });
  if (!res.ok) {
    if (res.status === 404) throw new Error('not_found');
    throw await apiError(res, path);
  }
  return (await res.json()) as T;
}

export async function lookupReferralCode(code: string): Promise<ReferrerRow | null> {
  try {
    return await fetchJson<ReferrerRow>(`/v1/referral/lookup?code=${encodeURIComponent(code)}`);
  } catch (err) {
    if (err instanceof Error && err.message === 'not_found') return null;
    throw err;
  }
}

/**
 * Public — look up a referrer profile by Stellar address. Returns null
 * if the address has never registered a code. No API key required.
 */
export async function getReferralInfo(address: string): Promise<ReferralMeResponse | null> {
  try {
    return await fetchJson<ReferralMeResponse>(
      `/v1/referral/info?address=${encodeURIComponent(address)}`,
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'not_found') return null;
    throw err;
  }
}

export async function getReferralMe(auth: AuthHeaders): Promise<ReferralMeResponse> {
  return fetchJson<ReferralMeResponse>('/v1/referral/me', auth);
}

export async function getReferralTrades(
  auth: AuthHeaders,
  limit = 25,
): Promise<ReferralTradeRow[]> {
  const { trades } = await fetchJson<{ trades: ReferralTradeRow[] }>(
    `/v1/referral/me/trades?limit=${limit}`,
    auth,
  );
  return trades;
}

export async function getReferralClaims(
  auth: AuthHeaders,
  limit = 25,
): Promise<ReferralClaimRow[]> {
  const { claims } = await fetchJson<{ claims: ReferralClaimRow[] }>(
    `/v1/referral/me/claims?limit=${limit}`,
    auth,
  );
  return claims;
}
