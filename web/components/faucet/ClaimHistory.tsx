'use client';

import { useState } from 'react';
import { History, ExternalLink, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { formatDateTimeFull, formatNumber } from '@/lib/utils/format';
import { STELLAR_EXPERT_BASE } from '@/lib/utils/constants';
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

  const getStellarExpertUrl = (txHash: string) => {
    return `${STELLAR_EXPERT_BASE}/tx/${txHash}`;
  };

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-foreground flex items-center gap-2">
          <History className="w-5 h-5 text-muted-foreground" />
          Claim History
        </h3>
        <div className="text-sm text-muted-foreground">
          Total Received:{' '}
          <span className="text-foreground font-medium font-mono tabular-nums">
            {formatNumber(totalAllTime, 0)} USDC
          </span>
        </div>
      </div>

      <div className="p-6">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 bg-surface-2 rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-lg bg-surface-2 mb-4">
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
            <div className="grid grid-cols-4 gap-4 px-4 py-2 text-[11px] text-faint uppercase tracking-wide">
              <span>Date & Time</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Running Total</span>
              <span className="text-right">Transaction</span>
            </div>

            {/* Records */}
            {displayedRecords.map((record) => (
              <div
                key={record.id}
                className="grid grid-cols-4 gap-4 px-4 py-2 bg-surface-2 rounded-lg border border-border hover:bg-surface-3/50 transition-colors"
              >
                <span className="text-xs text-muted-foreground font-mono tabular-nums">
                  {formatDateTimeFull(record.timestamp)}
                </span>
                <span className="text-xs text-long font-medium font-mono tabular-nums text-right">
                  +{formatNumber(record.amount, 0)} USDC
                </span>
                <span className="text-xs text-muted-foreground font-mono tabular-nums text-right">
                  {formatNumber(record.runningTotal, 0)} USDC
                </span>
                <div className="text-right">
                  <a
                    href={getStellarExpertUrl(record.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-faint hover:text-muted-foreground transition-colors font-mono"
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
                  'w-full mt-4 py-3 text-sm font-medium rounded-md transition-colors',
                  'flex items-center justify-center gap-2',
                  'text-muted-foreground hover:text-foreground',
                  'bg-surface-2 hover:bg-surface-3 border border-border'
                )}
              >
                <ChevronDown className="w-4 h-4" />
                Load More (<span className="font-mono tabular-nums">{records.length - displayCount}</span> remaining)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
