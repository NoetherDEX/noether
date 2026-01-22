'use client';

import { useState } from 'react';
import { History, ExternalLink, ChevronDown } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@/components/ui';
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="w-5 h-5" />
            Claim History
          </CardTitle>
          <div className="text-sm text-neutral-400">
            Total Received:{' '}
            <span className="text-white font-medium">
              {totalAllTime.toLocaleString()} USDC
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 bg-white/5 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-12">
            <History className="w-12 h-12 text-neutral-700 mx-auto mb-4" />
            <p className="text-neutral-400 mb-2">No claims yet</p>
            <p className="text-sm text-neutral-600">
              Claim some USDC to see your history here
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Table Header */}
            <div className="grid grid-cols-4 gap-4 px-4 py-2 text-xs text-neutral-500 uppercase tracking-wider">
              <span>Date & Time</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Running Total</span>
              <span className="text-right">Transaction</span>
            </div>

            {/* Records */}
            {displayedRecords.map((record) => (
              <div
                key={record.id}
                className="grid grid-cols-4 gap-4 px-4 py-3 bg-white/[0.02] rounded-xl hover:bg-white/[0.04] transition-colors"
              >
                <span className="text-sm text-neutral-300">
                  {formatDate(record.timestamp)}
                </span>
                <span className="text-sm text-emerald-400 font-medium text-right">
                  +{record.amount.toLocaleString()} USDC
                </span>
                <span className="text-sm text-neutral-400 text-right">
                  {record.runningTotal.toLocaleString()} USDC
                </span>
                <div className="text-right">
                  <a
                    href={getStellarExpertUrl(record.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    {record.txHash.slice(0, 8)}...
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ))}

            {/* Load More Button */}
            {hasMore && (
              <Button
                variant="ghost"
                className="w-full mt-4"
                onClick={() => setDisplayCount((c) => c + RECORDS_PER_PAGE)}
              >
                <ChevronDown className="w-4 h-4 mr-2" />
                Load More ({records.length - displayCount} remaining)
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
