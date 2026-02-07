'use client';

import { useState } from 'react';
import { History, ExternalLink, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { ClaimRecord } from '@/lib/stellar/faucet';

interface ClaimHistoryProps {
  records: (ClaimRecord & { runningTotal: number })[];
  totalAllTime: number;
  isLoading: boolean;
}

const RECORDS_PER_PAGE = 10;

export function ClaimHistory({
  records,
  totalAllTime,
  isLoading,
}: ClaimHistoryProps) {
  const [displayCount, setDisplayCount] = useState(RECORDS_PER_PAGE);
  const displayedRecords = records.slice(0, displayCount);
  const hasMore = records.length > displayCount;

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const getStellarExpertUrl = (txHash: string) => {
    return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <History className="w-5 h-5 text-muted-foreground" />
          Claim History
        </h3>
        <div className="text-sm text-muted-foreground">
          Total Received:{' '}
          <span className="text-foreground font-medium font-mono">
            {totalAllTime.toLocaleString()} USDC
          </span>
        </div>
      </div>

      <div className="p-6">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 bg-secondary/30 rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/[0.04] mb-4">
              <History className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-foreground font-medium mb-1">No claims yet</p>
            <p className="text-sm text-muted-foreground">
              Claim some USDC to see your history here
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Table Header */}
            <div className="grid grid-cols-4 gap-4 px-4 py-2 text-xs text-muted-foreground uppercase tracking-wider">
              <span>Date & Time</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Running Total</span>
              <span className="text-right">Transaction</span>
            </div>

            {/* Records */}
            {displayedRecords.map((record) => (
              <div
                key={record.id}
                className="grid grid-cols-4 gap-4 px-4 py-3 bg-secondary/20 rounded-lg border border-white/5 hover:bg-secondary/30 transition-colors"
              >
                <span className="text-sm text-muted-foreground">
                  {formatDate(record.timestamp)}
                </span>
                <span className="text-sm text-[#22c55e] font-medium font-mono text-right">
                  +{record.amount.toLocaleString()} USDC
                </span>
                <span className="text-sm text-muted-foreground font-mono text-right">
                  {record.runningTotal.toLocaleString()} USDC
                </span>
                <div className="text-right">
                  <a
                    href={getStellarExpertUrl(record.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white/60 transition-colors font-mono"
                  >
                    {record.txHash.slice(0, 8)}...
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ))}

            {/* Load More Button */}
            {hasMore && (
              <button
                onClick={() => setDisplayCount((c) => c + RECORDS_PER_PAGE)}
                className={cn(
                  'w-full mt-4 py-3 text-sm font-medium rounded-lg transition-all',
                  'flex items-center justify-center gap-2',
                  'text-muted-foreground hover:text-foreground',
                  'bg-secondary/30 hover:bg-secondary/50 border border-white/5'
                )}
              >
                <ChevronDown className="w-4 h-4" />
                Load More ({records.length - displayCount} remaining)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
