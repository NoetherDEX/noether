'use client';

import { useEffect, useState } from 'react';
import { Button, Card, CardContent } from '@/components/ui';
import { useSessionAuthStore } from '@/lib/store';
import { listApiKeys, revokeApiKey } from '@/lib/api/keys';
import type { ApiKeyRecord, IssuedApiKey } from '@/lib/api/keys';
import { formatDateTimeFull } from '@/lib/utils/format';
import { toUserMessage } from '@/lib/utils/userError';
import toast from 'react-hot-toast';

// Epoch seconds → pinned en-US datetime; 0/null → '—'.
const fmtTs = (ts: number | null): string => (ts ? formatDateTimeFull(ts) : '—');

export function ApiKeysList({ refreshKey }: { refreshKey: IssuedApiKey | null }) {
  const auth = useSessionAuthStore();
  const [rows, setRows] = useState<ApiKeyRecord[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const creds = auth.keyId && auth.secret ? { keyId: auth.keyId, secret: auth.secret } : null;

  useEffect(() => {
    if (!creds) {
      setRows(null);
      return;
    }
    let cancelled = false;
    setRows(null);
    setErr(null);
    listApiKeys(creds)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled) setErr(toUserMessage(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.keyId, auth.secret, refreshKey?.keyId]);

  if (!creds) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-zinc-400">
          Sign in by issuing a key above — your existing keys will be listed
          here once you've authenticated.
        </CardContent>
      </Card>
    );
  }

  if (err) {
    return (
      <Card className="border-red-500/30">
        <CardContent className="p-5 text-sm text-red-400">
          Could not load keys: {err}
        </CardContent>
      </Card>
    );
  }

  if (rows === null) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-zinc-400">Loading keys…</CardContent>
      </Card>
    );
  }

  async function doRevoke(keyId: string) {
    if (!creds) return;
    if (!confirm(`Revoke key ${keyId}? This cannot be undone.`)) return;
    setBusy(keyId);
    try {
      await revokeApiKey(creds, keyId);
      toast.success('Revoked');
      setRows((prev) => prev?.map((k) => (k.keyId === keyId ? { ...k, revokedAt: Math.floor(Date.now() / 1000) } : k)) ?? null);
    } catch (e) {
      toast.error(`Revoke failed: ${toUserMessage(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-5 py-3 border-b border-zinc-800">
          <h3 className="font-medium">Your keys</h3>
          <p className="text-xs text-zinc-500">{rows.length} keys for {auth.owner ? `${auth.owner.slice(0, 4)}…${auth.owner.slice(-4)}` : 'this wallet'}</p>
        </div>
        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-zinc-500">No keys yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500 border-b border-zinc-800/50">
                <tr>
                  <th className="text-left px-5 py-2">Key ID</th>
                  <th className="text-left px-5 py-2">Label</th>
                  <th className="text-left px-5 py-2">Tier</th>
                  <th className="text-left px-5 py-2">Created</th>
                  <th className="text-left px-5 py-2">Last used</th>
                  <th className="text-right px-5 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((k) => {
                  const revoked = k.revokedAt !== null;
                  return (
                    <tr key={k.keyId} className="border-b border-zinc-800/30 last:border-0">
                      <td className="px-5 py-3 font-mono text-xs">{k.keyId.slice(0, 16)}…</td>
                      <td className="px-5 py-3 text-zinc-400">{k.label ?? '—'}</td>
                      <td className="px-5 py-3 text-zinc-400">{k.tier}</td>
                      <td className="px-5 py-3 text-zinc-400">{fmtTs(k.createdAt)}</td>
                      <td className="px-5 py-3 text-zinc-400">{fmtTs(k.lastUsedAt)}</td>
                      <td className="px-5 py-3 text-right">
                        {revoked ? (
                          <span className="text-xs text-zinc-500">revoked</span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy === k.keyId}
                            onClick={() => doRevoke(k.keyId)}
                          >
                            {busy === k.keyId ? 'Revoking…' : 'Revoke'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
