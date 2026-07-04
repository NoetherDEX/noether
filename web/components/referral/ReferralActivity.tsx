'use client';

import { Card, CardContent } from '@/components/ui';
import type { ReferralTradeRow, ReferralClaimRow } from '@/types/referral';
import { fmtReferralUsdc } from '@/types/referral';

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

function fmtTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

export function ReferralTradesTable({ rows }: { rows: ReferralTradeRow[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-5 py-3 border-b border-zinc-800">
          <h3 className="font-medium">Trades you earned on</h3>
          <p className="text-xs text-zinc-500">{rows.length} entries</p>
        </div>
        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-zinc-500">
            No trades yet. Fee accrual starts in v1.1 — share your code now so
            your referees are already bound.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500 border-b border-zinc-800/50">
                <tr>
                  <th className="text-left px-5 py-2">Time</th>
                  <th className="text-left px-5 py-2">Referee</th>
                  <th className="text-right px-5 py-2">Original Fee</th>
                  <th className="text-right px-5 py-2">Their Discount</th>
                  <th className="text-right px-5 py-2 text-emerald-400">Your Payout</th>
                  <th className="text-right px-5 py-2">Tx</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-800/30 last:border-0">
                    <td className="px-5 py-3 text-zinc-400">{fmtTs(r.ts)}</td>
                    <td className="px-5 py-3 font-mono text-xs">{shortAddr(r.referee)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">${fmtReferralUsdc(r.originalFee)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-zinc-400">${fmtReferralUsdc(r.discount)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-emerald-400">${fmtReferralUsdc(r.payout)}</td>
                    <td className="px-5 py-3 text-right font-mono text-xs">
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${r.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-500 hover:text-amber-400 transition-colors"
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
        <div className="px-5 py-3 border-b border-zinc-800">
          <h3 className="font-medium">Claim history</h3>
          <p className="text-xs text-zinc-500">{rows.length} entries</p>
        </div>
        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-zinc-500">
            You haven't claimed any referral earnings yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500 border-b border-zinc-800/50">
                <tr>
                  <th className="text-left px-5 py-2">Time</th>
                  <th className="text-right px-5 py-2">Amount</th>
                  <th className="text-right px-5 py-2">Tx</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-800/30 last:border-0">
                    <td className="px-5 py-3 text-zinc-400">{fmtTs(r.ts)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">${fmtReferralUsdc(r.amount)}</td>
                    <td className="px-5 py-3 text-right font-mono text-xs">
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${r.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-500 hover:text-amber-400 transition-colors"
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
