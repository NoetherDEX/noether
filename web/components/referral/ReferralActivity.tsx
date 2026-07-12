'use client';

import { Card, CardContent } from '@/components/ui';
import type { ReferralTradeRow, ReferralClaimRow } from '@/types/referral';
import { fmtReferralUsdc } from '@/types/referral';
import { formatDateTimeFull } from '@/lib/utils/format';
import { STELLAR_EXPERT_BASE } from '@/lib/utils/constants';

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

export function ReferralTradesTable({ rows }: { rows: ReferralTradeRow[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-5 py-3 border-b border-border flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-medium">Trades you earned on</h3>
          <p className="text-[11px] text-faint font-mono tabular-nums">{rows.length} entries</p>
        </div>
        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No trades yet. Fee accrual starts in v1.1 — share your code now so
            your referees are already bound.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-faint border-b border-border">
                <tr>
                  <th className="text-left px-5 py-2">Time</th>
                  <th className="text-left px-5 py-2">Referee</th>
                  <th className="text-right px-5 py-2">Original Fee</th>
                  <th className="text-right px-5 py-2">Their Discount</th>
                  <th className="text-right px-5 py-2 text-long">Your Payout</th>
                  <th className="text-right px-5 py-2">Tx</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-3/50 transition-colors">
                    <td className="px-5 py-2 text-muted-foreground font-mono tabular-nums">{formatDateTimeFull(r.ts)}</td>
                    <td className="px-5 py-2 font-mono text-xs">{shortAddr(r.referee)}</td>
                    <td className="px-5 py-2 text-right font-mono tabular-nums">${fmtReferralUsdc(r.originalFee)}</td>
                    <td className="px-5 py-2 text-right font-mono tabular-nums text-muted-foreground">${fmtReferralUsdc(r.discount)}</td>
                    <td className="px-5 py-2 text-right font-mono tabular-nums text-long">${fmtReferralUsdc(r.payout)}</td>
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

export function ReferralClaimsTable({ rows }: { rows: ReferralClaimRow[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-5 py-3 border-b border-border flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-medium">Claim history</h3>
          <p className="text-[11px] text-faint font-mono tabular-nums">{rows.length} entries</p>
        </div>
        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            You haven't claimed any referral earnings yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-faint border-b border-border">
                <tr>
                  <th className="text-left px-5 py-2">Time</th>
                  <th className="text-right px-5 py-2">Amount</th>
                  <th className="text-right px-5 py-2">Tx</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-3/50 transition-colors">
                    <td className="px-5 py-2 text-muted-foreground font-mono tabular-nums">{formatDateTimeFull(r.ts)}</td>
                    <td className="px-5 py-2 text-right font-mono tabular-nums">${fmtReferralUsdc(r.amount)}</td>
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
