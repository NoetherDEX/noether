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
    <div className="rounded-xl border border-white/10 bg-card">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        {/* Tabs */}
        <div className="flex items-center gap-1">
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-all',
                currentTab === tab
                  ? 'bg-[#eab308]/20 text-[#eab308]'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
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
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
          >
            <Download className="h-4 w-4" />
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
                <div key={i} className="h-12 bg-secondary/30 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        ) : currentTab === 'Trade History' ? (
          trades.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-muted-foreground">No trade history yet</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Date</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Market</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Side</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Size</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Entry Price</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Exit Price</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Realized PnL</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Fee</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Tx</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr key={trade.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-muted-foreground">{formatDate(trade.timestamp)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground text-sm">{trade.asset}-PERP</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-xs font-medium',
                          trade.direction === 'Long' ? 'text-[#22c55e]' : 'text-[#ef4444]'
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
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono text-sm text-foreground">
                        ${trade.size.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono text-sm text-foreground">
                        ${trade.entryPrice?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono text-sm text-foreground">
                        ${trade.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {/* A15: unknown PnL/fee render '—', never a fabricated $0 */}
                      {trade.pnl == null ? (
                        <span className="font-mono text-sm text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={cn(
                            'font-mono text-sm font-semibold',
                            trade.pnl >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'
                          )}
                        >
                          {trade.pnl >= 0 ? '+' : '-'}${Math.abs(trade.pnl).toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {trade.fee == null ? (
                        <span
                          className="font-mono text-xs text-muted-foreground"
                          title="Fee breakdown ships with the next contract deploy"
                        >
                          —
                        </span>
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground">-${trade.fee.toFixed(2)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={getStellarExpertUrl(trade.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white/60 transition-colors font-mono"
                      >
                        {trade.txHash.slice(0, 6)}...
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          // Transfers tab
          transfers.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-muted-foreground">No transfers yet</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Date</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Type</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Asset</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Amount</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Tx Hash</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((transfer) => (
                  <tr key={transfer.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-muted-foreground">{formatDate(transfer.date)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded',
                          transfer.type === 'Deposit'
                            ? 'bg-[#22c55e]/10 text-[#22c55e]'
                            : 'bg-[#ef4444]/10 text-[#ef4444]'
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
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground text-sm">{transfer.asset}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono text-sm text-foreground">
                        {transfer.type === 'Deposit' ? '+' : '-'}
                        {transfer.amount.toLocaleString()} {transfer.asset}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={getStellarExpertUrl(transfer.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-white/40 hover:text-white/60 hover:underline"
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
