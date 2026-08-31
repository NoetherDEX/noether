import { apiBase, apiError } from './base';

/**
 * Workstream A client — waitlist join/status against the gateway, and the
 * approved-wallet unlock (challenge from the gateway, signed XDR posted to
 * OUR /api/access/wallet route, which alone consumes the one-shot challenge
 * server-side and sets the gate cookie).
 */

export type WaitlistStatus = 'approved' | 'pending' | 'none';
export type WaitlistSegment = 'trader' | 'lp' | 'both';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) throw await apiError(res, path);
  return (await res.json()) as T;
}

export async function joinWaitlist(input: {
  wallet: string;
  email?: string;
  segment?: WaitlistSegment;
}): Promise<{ status: string }> {
  return fetchJson<{ status: string }>('/v1/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, attest: true }),
  });
}

export async function waitlistStatus(wallet: string): Promise<WaitlistStatus> {
  const { status } = await fetchJson<{ status: WaitlistStatus }>(
    `/v1/waitlist/status?wallet=${encodeURIComponent(wallet)}`,
  );
  return status;
}

export async function requestAccessChallenge(address: string): Promise<string> {
  const { challengeHex } = await fetchJson<{ challengeHex: string }>('/v1/access/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  return challengeHex;
}

/** Exchange the signed challenge for the gate cookie via our own route. */
export async function unlockWithWallet(input: {
  address: string;
  challenge: string;
  signature: string;
}): Promise<{ ok: boolean; wave: string | null }> {
  const res = await fetch('/api/access/wallet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `unlock failed (${res.status})`);
  }
  return (await res.json()) as { ok: boolean; wave: string | null };
}
