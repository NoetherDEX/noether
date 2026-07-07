'use client';

import type { VaultTradeRow } from '@/types/vault';
import { fmtUsdc7, formatDateTimeFull } from '@/lib/utils/format';
import { STELLAR_EXPERT_BASE } from '@/lib/utils/constants';

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
                // Sign lives OUTSIDE the '$' ('+$12.34' / '-$12.34'); exact
                // zero renders neutral and unsigned.
                let pnlRaw: bigint | null = null;
                if (t.action === 'close' && t.pnl != null) {
                  try {
                    pnlRaw = BigInt(t.pnl);
                  } catch {
                    pnlRaw = null;
                  }
                }
                const pnlDisplay =
                  pnlRaw == null
                    ? '—'
                    : pnlRaw === 0n
                    ? `$${fmtUsdc7(pnlRaw)}`
                    : `${pnlRaw < 0n ? '-' : '+'}$${fmtUsdc7(pnlRaw < 0n ? -pnlRaw : pnlRaw)}`;
                const pnlClass =
                  pnlRaw == null
                    ? 'text-muted-foreground'
                    : pnlRaw > 0n
                    ? 'text-[#22c55e]'
                    : pnlRaw < 0n
                    ? 'text-red-400'
                    : 'text-muted-foreground';
                return (
                  <tr key={t.id} className="border-b border-white/5 last:border-0">
                    <td className="px-6 py-3 text-muted-foreground">{formatDateTimeFull(t.ts)}</td>
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
                      {t.action === 'open' ? `$${fmtUsdc7(t.collateral)}` : '—'}
                    </td>
                    <td className={`px-6 py-3 text-right font-mono tabular-nums ${pnlClass}`}>
                      {pnlDisplay}
                    </td>
                    <td className="px-6 py-3 text-right text-xs">
                      <a
                        href={`${STELLAR_EXPERT_BASE}/tx/${t.txHash}`}
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
