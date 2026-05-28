'use client';

import { Card, CardContent } from '@/components/ui';
import { VAULT_PRECISION } from '@/types/vault';
import type { VaultTradeRow } from '@/types/vault';

function fmtUsdc(raw: string, dp = 2): string {
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / VAULT_PRECISION;
  const frac = abs % VAULT_PRECISION;
  return `${negative ? '-' : ''}${whole}.${frac.toString().padStart(7, '0').slice(0, dp)}`;
}

function fmtTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

/**
 * Vault trade history — surfaces every leader_open / leader_close
 * event the indexer has recorded for this vault. Maps to the SCF
 * Tranche 2 deliverable: "trade history" on the per-vault detail page.
 */
export function VaultTradeHistory({ trades }: { trades: VaultTradeRow[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10">
        <h3 className="text-base font-semibold text-foreground">Leader Trade History</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {trades.length === 0
            ? 'No leader trades yet'
            : `${trades.length} leader_open / leader_close event${trades.length === 1 ? '' : 's'}`}
        </p>
      </div>
      {trades.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">
          The leader hasn&apos;t opened or closed any positions from this vault yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground border-b border-white/5">
              <tr>
                <th className="text-left px-6 py-2">Time</th>
                <th className="text-left px-6 py-2">Action</th>
                <th className="text-right px-6 py-2">Position ID</th>
                <th className="text-right px-6 py-2">Collateral</th>
                <th className="text-right px-6 py-2">PnL</th>
                <th className="text-right px-6 py-2">Tx</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const pnlNum = t.pnl != null ? Number(t.pnl) : null;
                const pnlClass =
                  pnlNum == null
                    ? 'text-muted-foreground'
                    : pnlNum > 0
                    ? 'text-[#22c55e]'
                    : pnlNum < 0
                    ? 'text-red-400'
                    : 'text-muted-foreground';
                return (
                  <tr key={t.id} className="border-b border-white/5 last:border-0">
                    <td className="px-6 py-3 text-muted-foreground">{fmtTs(t.ts)}</td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ${
                          t.action === 'open'
                            ? 'text-[#22c55e] bg-[#22c55e]/10'
                            : 'text-amber-400 bg-amber-500/10'
                        }`}
                      >
                        {t.action === 'open' ? '↗ Open' : '↘ Close'}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right font-mono tabular-nums">
                      #{t.positionId}
                    </td>
                    <td className="px-6 py-3 text-right font-mono tabular-nums">
                      {t.action === 'open' ? `$${fmtUsdc(t.collateral)}` : '—'}
                    </td>
                    <td className={`px-6 py-3 text-right font-mono tabular-nums ${pnlClass}`}>
                      {t.action === 'close' && pnlNum != null
                        ? `${pnlNum >= 0 ? '+' : ''}$${fmtUsdc(t.pnl ?? '0')}`
                        : '—'}
                    </td>
                    <td className="px-6 py-3 text-right text-xs">
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${t.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-muted-foreground hover:text-amber-400"
                      >
                        {shortHash(t.txHash)} ↗
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
