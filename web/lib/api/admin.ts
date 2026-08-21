import { apiBase, apiError } from './base';

/** Workstream A — admin waitlist surface (bearer key + ADMIN_WALLETS). */

export interface AdminAuth {
  keyId: string;
  secret: string;
}

export interface GrantRow {
  wallet: string;
  email: string | null;
  status: string;
  source: string;
  wave: string | null;
  segment: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  notes: string | null;
  emailSentAt: string | null;
}

export type GrantAction = 'approve' | 'reject' | 'revoke';

function headers(auth: AdminAuth): Record<string, string> {
  return {
    accept: 'application/json',
    authorization: `Bearer ${auth.keyId}:${auth.secret}`,
    'x-timestamp': String(Math.floor(Date.now() / 1000)),
  };
}

export async function listGrants(
  auth: AdminAuth,
  filter: { status?: string; wave?: string; q?: string } = {},
): Promise<{ rows: GrantRow[]; counts: Record<string, number> }> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.wave) params.set('wave', filter.wave);
  if (filter.q) params.set('q', filter.q);
  params.set('limit', '500');
  const res = await fetch(`${apiBase()}/v1/admin/waitlist?${params}`, {
    headers: headers(auth),
    cache: 'no-store',
  });
  if (!res.ok) throw await apiError(res, '/v1/admin/waitlist');
  return (await res.json()) as { rows: GrantRow[]; counts: Record<string, number> };
}

export async function decideGrants(
  auth: AdminAuth,
  input: { wallets: string[]; action: GrantAction; wave?: string; notes?: string },
): Promise<{ updated: string[]; emailed: string[] }> {
  const res = await fetch(`${apiBase()}/v1/admin/waitlist/decide`, {
    method: 'POST',
    headers: { ...headers(auth), 'content-type': 'application/json' },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
  if (!res.ok) throw await apiError(res, '/v1/admin/waitlist/decide');
  return (await res.json()) as { updated: string[]; emailed: string[] };
}

/** PII erasure — nulls the stored email; status + audit trail stay intact. */
export async function forgetGrantEmail(
  auth: AdminAuth,
  wallet: string,
): Promise<{ forgotten: boolean }> {
  const res = await fetch(`${apiBase()}/v1/admin/waitlist/forget`, {
    method: 'POST',
    headers: { ...headers(auth), 'content-type': 'application/json' },
    body: JSON.stringify({ wallet }),
    cache: 'no-store',
  });
  if (!res.ok) throw await apiError(res, '/v1/admin/waitlist/forget');
  return (await res.json()) as { forgotten: boolean };
}

export async function exportGrantsCsv(auth: AdminAuth, status?: string): Promise<string> {
  const params = status ? `?status=${status}` : '';
  const res = await fetch(`${apiBase()}/v1/admin/waitlist/export.csv${params}`, {
    headers: headers(auth),
    cache: 'no-store',
  });
  if (!res.ok) throw await apiError(res, '/v1/admin/waitlist/export.csv');
  return res.text();
}
