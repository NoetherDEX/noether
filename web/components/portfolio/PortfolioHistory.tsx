'use client';

import { useState } from 'react';
import { ArrowUpRight, ArrowDownRight, Download, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { STELLAR_EXPERT_BASE } from '@/lib/utils/constants';
import type { Trade } from '@/types';

const tabs = ['Trade History', 'Transfers'] as const;
type Tab = (typeof tabs)[number];

// Quote a CSV field when it contains a delimiter, quote, or newline.
function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

interface PortfolioHistoryProps {
  trades: Trade[];
  transfers?: {
    id: string;
    date: Date;
    type: 'Deposit' | 'Withdraw';
    asset: string;
    amount: number;
    txHash: string;
  }[];
  isLoading: boolean;
}

export function PortfolioHistory({ trades, transfers = [], isLoading }: PortfolioHistoryProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Trade History');

  // A13: the Transfers tab is hidden until a real transfer feed exists —
  // a permanently empty tab is a dead affordance.
  const showTransfers = transfers.length > 0;
  const visibleTabs: readonly Tab[] = showTransfers ? tabs : (['Trade History'] as const);
  const currentTab: Tab = showTransfers ? activeTab : 'Trade History';

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  };

  const getStellarExpertUrl = (txHash: string) => {
    return `${STELLAR_EXPERT_BASE}/tx/${txHash}`;
  };

  // A13: client-side CSV export of the in-memory trade list.
  // Unknown values (fee/PnL pending the next contract deploy) export as
  // empty fields, never as 0.
  const handleExport = () => {
    if (trades.length === 0) return;
    const header = ['Date (UTC)', 'Market', 'Side', 'Size (USD)', 'Entry Price', 'Exit Price', 'Realized PnL', 'Fee', 'Tx Hash'];
    const rows = trades.map((t) => [
      t.timestamp.toISOString(),
      `${t.asset}-PERP`,
      t.direction,
      t.size.toFixed(2),
      t.entryPrice == null ? '' : t.entryPrice.toFixed(2),
      t.price.toFixed(2),
      t.pnl == null ? '' : t.pnl.toFixed(2),
      t.fee == null ? '' : t.fee.toFixed(2),
      t.txHash,
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvField).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `noether-trades-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-lg border border-border bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        {/* Tabs */}
        <div className="flex items-center gap-1">
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                currentTab === tab
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-surface-2'
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={isLoading || trades.length === 0 || currentTab !== 'Trade History'}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="p-8">
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-9 bg-surface-2 rounded-md animate-pulse" />
              ))}
            </div>
          </div>
        ) : currentTab === 'Trade History' ? (
          trades.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">No trade history yet</p>
            </div>
          ) : (
            <>
            {/* B25: card layout below sm — a 9-column table on a 390px screen
                reads as a broken panel. Same null-honesty as the rows. */}
            <div className="sm:hidden divide-y divide-border">
              {trades.map((trade) => (
                <div key={trade.id} className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[13px] text-foreground">
                      {trade.asset}-PERP{' '}
                      <span className={cn('text-xs font-medium', trade.direction === 'Long' ? 'text-long' : 'text-short')}>
                        {trade.direction}
                      </span>
                    </span>
                    {trade.pnl == null ? (
                      <span className="font-mono tabular-nums text-[13px] text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={cn(
                          'font-mono tabular-nums text-[13px] font-medium',
                          trade.pnl >= 0 ? 'text-long' : 'text-short'
                        )}
                      >
                        {trade.pnl >= 0 ? '+' : '-'}${Math.abs(trade.pnl).toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between font-mono tabular-nums text-xs text-muted-foreground">
                    <span>${trade.size.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    <span>
                      {trade.entryPrice != null
                        ? `$${trade.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                        : '—'}
                      {' → '}
                      ${trade.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-faint">
                    <span className="font-mono tabular-nums">{formatDate(trade.timestamp)}</span>
                    <a
                      href={getStellarExpertUrl(trade.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:text-muted-foreground transition-colors font-mono min-h-[32px]"
                    >
                      {trade.txHash.slice(0, 6)}…
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
            <table className="w-full hidden sm:table">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-[11px] font-medium uppercase tracking-wide text-faint px-4 py-2">Date</th>
                  <th className="text-left text-[11px] font-medium uppercase tracking-wide text-faint px-4 py-2">Market</th>
                  <th className="text-left text-[11px] font-medium uppercase tracking-wide text-faint px-4 py-2">Side</th>
                  <th className="text-right text-[11px] font-medium uppercase tracking-wide text-faint px-4 py-2">Size</th>
                  <th className="text-right text-[11px] font-medium uppercase tracking-wide text-faint px-4 py-2">Entry Price</th>
                  <th className="text-right text-[11px] font-medium uppercase tracking-wide text-faint px-4 py-2">Exit Price</th>
                  <th className="text-right text-[11px] font-medium uppercase tracking-wide text-faint px-4 py-2">Realized PnL</th>
                  <th className="text-right text-[11px] font-medium uppercase tracking-wide text-faint px-4 py-2">Fee</th>
                  <th className="text-right text-[11px] font-medium uppercase tracking-wide text-faint px-4 py-2">Tx</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr key={trade.id} className="border-b border-border hover:bg-surface-3/50 transition-colors">
                    <td className="px-4 py-2">
                      <span className="font-mono tabular-nums text-xs text-faint">{formatDate(trade.timestamp)}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className="font-medium text-foreground text-[13px]">{trade.asset}-PERP</span>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-xs font-medium',
                          trade.direction === 'Long' ? 'text-long' : 'text-short'
                        )}
                      >
                        {trade.direction === 'Long' ? (
                          <ArrowUpRight className="h-3 w-3" />
                        ) : (
                          <ArrowDownRight className="h-3 w-3" />
                        )}
                        {trade.direction}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="font-mono tabular-nums text-[13px] text-foreground">
                        ${trade.size.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="font-mono tabular-nums text-[13px] text-foreground">
                        ${trade.entryPrice?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="font-mono tabular-nums text-[13px] text-foreground">
                        ${trade.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {/* A15: unknown PnL/fee render '—', never a fabricated $0 */}
                      {trade.pnl == null ? (
                        <span className="font-mono tabular-nums text-[13px] text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={cn(
                            'font-mono tabular-nums text-[13px] font-medium',
                            trade.pnl >= 0 ? 'text-long' : 'text-short'
                          )}
                        >
                          {trade.pnl >= 0 ? '+' : '-'}${Math.abs(trade.pnl).toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {trade.fee == null ? (
                        <span
                          className="font-mono tabular-nums text-xs text-muted-foreground"
                          title="Fee breakdown ships with the next contract deploy"
                        >
                          —
                        </span>
                      ) : (
                        <span className="font-mono tabular-nums text-xs text-muted-foreground">-${trade.fee.toFixed(2)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <a
                        href={getStellarExpertUrl(trade.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-faint hover:text-muted-foreground transition-colors font-mono"
                      >
                        {trade.txHash.slice(0, 6)}...
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )
        ) : (
          // Transfers tab
          transfers.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">No transfers yet</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-[11px] font-medium uppercase tracking-wide text-faint px-4 py-2">Date</th>
                  <th className="text-left text-[11px] font-medium uppercase tracking-wide text-faint px-4 py-2">Type</th>
                  <th className="text-left text-[11px] font-medium uppercase tracking-wide text-faint px-4 py-2">Asset</th>
                  <th className="text-right text-[11px] font-medium uppercase tracking-wide text-faint px-4 py-2">Amount</th>
                  <th className="text-right text-[11px] font-medium uppercase tracking-wide text-faint px-4 py-2">Tx Hash</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((transfer) => (
                  <tr key={transfer.id} className="border-b border-border hover:bg-surface-3/50 transition-colors">
                    <td className="px-4 py-2">
                      <span className="font-mono tabular-nums text-xs text-faint">{formatDate(transfer.date)}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-sm',
                          transfer.type === 'Deposit'
                            ? 'bg-long/10 text-long'
                            : 'bg-short/10 text-short'
                        )}
                      >
                        {transfer.type === 'Deposit' ? (
                          <ArrowDownRight className="h-3 w-3" />
                        ) : (
                          <ArrowUpRight className="h-3 w-3" />
                        )}
                        {transfer.type}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className="font-medium text-foreground text-[13px]">{transfer.asset}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="font-mono tabular-nums text-[13px] text-foreground">
                        {transfer.type === 'Deposit' ? '+' : '-'}
                        {transfer.amount.toLocaleString()} {transfer.asset}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <a
                        href={getStellarExpertUrl(transfer.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-faint hover:text-muted-foreground hover:underline transition-colors"
                      >
                        {transfer.txHash.slice(0, 8)}...{transfer.txHash.slice(-6)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
