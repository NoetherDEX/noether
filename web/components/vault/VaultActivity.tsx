'use client';

import { Card, CardContent } from '@/components/ui';
import type { VaultActivityRow } from '@/types/vault';
import { fmtUsdc7, formatDateTimeFull } from '@/lib/utils/format';
import { STELLAR_EXPERT_BASE } from '@/lib/utils/constants';

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

export interface VaultActivityProps {
  title: string;
  rows: VaultActivityRow[];
  amountLabel: string;
  showShares?: boolean;
  empty?: string;
}

export function VaultActivity({
  title,
  rows,
  amountLabel,
  showShares,
  empty,
}: VaultActivityProps) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          <p className="text-xs text-faint font-mono tabular-nums">{rows.length} entries</p>
        </div>
        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            {empty ?? 'No activity yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-[11px] uppercase tracking-wide text-faint border-b border-border">
                <tr>
                  <th className="text-left px-5 py-2">Time</th>
                  <th className="text-left px-5 py-2">Principal</th>
                  <th className="text-right px-5 py-2">{amountLabel}</th>
                  {showShares && <th className="text-right px-5 py-2">Shares</th>}
                  <th className="text-right px-5 py-2">Tx</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-border last:border-0 hover:bg-surface-3/50 transition-colors"
                  >
                    <td className="px-5 py-2 text-muted-foreground font-mono tabular-nums">{formatDateTimeFull(r.ts)}</td>
                    <td className="px-5 py-2 font-mono text-xs">{shortAddr(r.principal)}</td>
                    <td className="px-5 py-2 text-right font-mono tabular-nums">${fmtUsdc7(r.amount)}</td>
                    {showShares && (
                      <td className="px-5 py-2 text-right font-mono tabular-nums">
                        {r.shares ? fmtUsdc7(r.shares) : '—'}
                      </td>
                    )}
                    <td className="px-5 py-2 text-right font-mono text-xs">
                      <a
                        href={`${STELLAR_EXPERT_BASE}/tx/${r.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-faint hover:text-primary transition-colors"
                        title={r.txHash}
                      >
                        {shortHash(r.txHash)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
