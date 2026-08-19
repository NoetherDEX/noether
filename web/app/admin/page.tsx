'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { useWalletStore } from '@/lib/store/walletStore';
import { getSessionAuth, useSessionAuthStore } from '@/lib/store/sessionAuthStore';
import { ApiError } from '@/lib/api/base';
import { requestChallenge, exchangeChallenge } from '@/lib/api/keys';
import {
  decideGrants,
  exportGrantsCsv,
  listGrants,
  type GrantAction,
  type GrantRow,
} from '@/lib/api/admin';

/**
 * Waitlist approvals panel (Workstream A). Auth = the same in-browser
 * wallet-challenge → session bearer key flow as the referral dashboard;
 * the gateway additionally requires the key's wallet ∈ ADMIN_WALLETS, so
 * this page is useless (403) to everyone else.
 */

const STATUSES = ['pending', 'approved', 'rejected', 'revoked'] as const;

const statusColor: Record<string, string> = {
  pending: 'bg-white/10 text-white/70',
  approved: 'bg-emerald-500/15 text-emerald-300',
  rejected: 'bg-red-500/15 text-red-300',
  revoked: 'bg-amber-500/15 text-amber-300',
};

export default function AdminPage() {
  const wallet = useWalletStore((s) => s.address);
  const auth = useSessionAuthStore((s) => (s.keyId && s.secret ? { keyId: s.keyId, secret: s.secret } : null));
  const setAuth = useSessionAuthStore((s) => s.setAuth);

  const [signingIn, setSigningIn] = useState(false);
  const [notAdmin, setNotAdmin] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<GrantRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [wave, setWave] = useState('wave-1');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');

  const refresh = useCallback(async () => {
    const a = getSessionAuth();
    if (!a) return;
    setError('');
    try {
      const data = await listGrants(a, statusFilter ? { status: statusFilter } : {});
      setRows(data.rows);
      setCounts(data.counts);
      setNotAdmin(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setNotAdmin(true);
      else setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [statusFilter]);

  useEffect(() => {
    if (auth) void refresh();
  }, [auth, refresh]);

  const signIn = useCallback(async () => {
    if (!wallet) return;
    setSigningIn(true);
    setError('');
    try {
      const challenge = await requestChallenge(wallet);
      const { signChallengeWithWallet } = await import('@/lib/api/sign');
      const signedXdr = await signChallengeWithWallet(challenge.challengeHex, wallet);
      const key = await exchangeChallenge({
        address: wallet,
        challenge: challenge.challengeHex,
        signatureHex: signedXdr,
        label: 'admin-panel',
      });
      setAuth({ keyId: key.keyId, secret: key.secret, owner: key.owner });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSigningIn(false);
    }
  }, [wallet, setAuth]);

  const act = useCallback(
    async (action: GrantAction) => {
      const a = getSessionAuth();
      if (!a || selected.size === 0) return;
      setBusy(true);
      setFlash('');
      setError('');
      try {
        const result = await decideGrants(a, {
          wallets: [...selected],
          action,
          wave: action === 'approve' && wave.trim() ? wave.trim() : undefined,
          notes: notes.trim() || undefined,
        });
        setFlash(
          `${action}: ${result.updated.length} wallet(s)` +
            (result.emailed.length ? `, ${result.emailed.length} emailed` : ''),
        );
        setSelected(new Set());
        setNotes('');
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : `${action} failed`);
      } finally {
        setBusy(false);
      }
    },
    [selected, wave, notes, refresh],
  );

  const downloadCsv = useCallback(async () => {
    const a = getSessionAuth();
    if (!a) return;
    try {
      const csv = await exportGrantsCsv(a, statusFilter || undefined);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `noether-waitlist-${statusFilter || 'all'}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  }, [statusFilter]);

  const allSelected = useMemo(
    () => rows.length > 0 && rows.every((r) => selected.has(r.wallet)),
    [rows, selected],
  );

  if (!auth || notAdmin) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold text-white" style={{ fontFamily: 'var(--font-sora)' }}>
          Waitlist admin
        </h1>
        {notAdmin ? (
          <p className="mt-4 text-sm text-red-400">
            This wallet is not on the admin list.
          </p>
        ) : (
          <p className="mt-4 text-sm text-white/60">
            Sign a one-time challenge with an admin wallet to continue.
          </p>
        )}
        <div className="mt-6 flex flex-col items-center gap-3">
          {!wallet ? (
            <ConnectButton />
          ) : (
            <button
              onClick={signIn}
              disabled={signingIn}
              className="rounded-xl bg-[#eab308] px-6 py-3 text-sm font-semibold text-black hover:bg-[#facc15] disabled:opacity-50"
            >
              {signingIn ? 'Waiting for wallet…' : `Sign in as ${wallet.slice(0, 4)}…${wallet.slice(-4)}`}
            </button>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-white" style={{ fontFamily: 'var(--font-sora)' }}>
          Waitlist admin
        </h1>
        <div className="flex items-center gap-3 text-xs text-white/50">
          {STATUSES.map((s) => (
            <span key={s}>
              {s}: <span className="text-white/90">{counts[s] ?? 0}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          value={wave}
          onChange={(e) => setWave(e.target.value)}
          placeholder="wave tag"
          className="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="notes (optional)"
          className="w-48 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30"
        />
        <button
          onClick={() => act('approve')}
          disabled={busy || selected.size === 0}
          className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
        >
          Approve ({selected.size})
        </button>
        <button
          onClick={() => act('reject')}
          disabled={busy || selected.size === 0}
          className="rounded-lg bg-red-500/80 px-4 py-2 text-sm font-semibold text-black hover:bg-red-400 disabled:opacity-40"
        >
          Reject
        </button>
        <button
          onClick={() => act('revoke')}
          disabled={busy || selected.size === 0}
          className="rounded-lg bg-amber-500/80 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-40"
        >
          Revoke
        </button>
        <button
          onClick={downloadCsv}
          className="ml-auto rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:text-white"
        >
          Export CSV
        </button>
      </div>

      {flash && <p className="mt-3 text-sm text-emerald-300">{flash}</p>}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase text-white/40">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(rows.map((r) => r.wallet)) : new Set())
                  }
                  className="accent-[#eab308]"
                />
              </th>
              <th className="px-3 py-2">Wallet</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Wave</th>
              <th className="px-3 py-2">Segment</th>
              <th className="px-3 py-2">Requested</th>
              <th className="px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-white/80">
            {rows.map((r) => (
              <tr key={r.wallet} className="hover:bg-white/[0.03]">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(r.wallet)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(r.wallet);
                      else next.delete(r.wallet);
                      setSelected(next);
                    }}
                    className="accent-[#eab308]"
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {r.wallet.slice(0, 6)}…{r.wallet.slice(-6)}
                </td>
                <td className="px-3 py-2">{r.email ?? <span className="text-white/25">—</span>}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${statusColor[r.status] ?? ''}`}>
                    {r.status}
                  </span>
                  {r.emailSentAt && <span className="ml-1 text-xs text-white/30" title="approval email sent">✉</span>}
                </td>
                <td className="px-3 py-2">{r.wave ?? <span className="text-white/25">—</span>}</td>
                <td className="px-3 py-2">{r.segment ?? <span className="text-white/25">—</span>}</td>
                <td className="px-3 py-2 text-xs text-white/50">
                  {new Date(r.requestedAt).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 text-xs text-white/50">{r.notes ?? ''}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-white/40">
                  Nothing here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
