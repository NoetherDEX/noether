'use client';

import { useState } from 'react';
import { ArrowUpRight, ArrowDownRight, Download, Filter, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { Trade } from '@/types';

const tabs = ['Trade History', 'Transfers'] as const;
type Tab = (typeof tabs)[number];

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
    return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
  };

  return (
    <div className="rounded-xl border border-white/10 bg-card">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        {/* Tabs */}
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-all',
                activeTab === tab
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
          <button className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <Filter className="h-4 w-4" />
            Filter
          </button>
          <button className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
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
        ) : activeTab === 'Trade History' ? (
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
                      <span
                        className={cn(
                          'font-mono text-sm font-semibold',
                          (trade.pnl || 0) >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'
                        )}
                      >
                        {(trade.pnl || 0) >= 0 ? '+' : '-'}${Math.abs(trade.pnl || 0).toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono text-xs text-muted-foreground">-${trade.fee.toFixed(2)}</span>
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
