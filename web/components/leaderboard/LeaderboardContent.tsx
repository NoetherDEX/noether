'use client';

import { useEffect, useState } from 'react';
import { ArrowUpDown, Users, BarChart3, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { formatUSD, truncateAddress } from '@/lib/utils/format';
import { getLeaderboardData, type LeaderboardTrader } from '@/lib/stellar/leaderboard';

type SortField = 'totalVolume' | 'pnl';

function PnlCell({ value }: { value: number }) {
  const isPositive = value >= 0;
  return (
    <span className={cn('font-mono text-sm', isPositive ? 'text-[#22c55e]' : 'text-[#ef4444]')}>
      {isPositive ? '+' : ''}{formatUSD(value)}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="py-3 px-4">
          <div className="h-4 bg-white/[0.06] rounded animate-pulse" style={{ width: i === 1 ? '120px' : '60px' }} />
        </td>
      ))}
    </tr>
  );
}

export function LeaderboardContent() {
  const [traders, setTraders] = useState<LeaderboardTrader[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortField>('totalVolume');

  useEffect(() => {
    async function fetchData() {
      try {
        const data = await getLeaderboardData();
        setTraders(data);
      } catch (error) {
        console.error('[Leaderboard] Failed to fetch:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();

    // Refresh every 60 seconds
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, []);

  const sorted = [...traders].sort((a, b) => {
    if (sortBy === 'pnl') return b.pnl - a.pnl;
    return b.totalVolume - a.totalVolume;
  });

  const totalTraders = traders.length;
  const totalVolume = traders.reduce((sum, t) => sum + t.totalVolume, 0);
  const totalTrades = traders.reduce((sum, t) => sum + t.tradeCount, 0);

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center">
              <Users className="w-4 h-4 text-white/40" />
            </div>
            <span className="text-xs text-white/40 uppercase tracking-wider">Traders</span>
          </div>
          <div className="text-2xl font-bold font-mono">
            {loading ? <div className="h-7 w-12 bg-white/[0.06] rounded animate-pulse" /> : totalTraders}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-white/40" />
            </div>
            <span className="text-xs text-white/40 uppercase tracking-wider">Total Volume</span>
          </div>
          <div className="text-2xl font-bold font-mono">
            {loading ? <div className="h-7 w-24 bg-white/[0.06] rounded animate-pulse" /> : formatUSD(totalVolume, 0)}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-white/40" />
            </div>
            <span className="text-xs text-white/40 uppercase tracking-wider">Total Trades</span>
          </div>
          <div className="text-2xl font-bold font-mono">
            {loading ? <div className="h-7 w-12 bg-white/[0.06] rounded animate-pulse" /> : totalTrades}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0a0a0a] overflow-hidden">
        {/* Table header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <h3 className="text-sm font-semibold">Rankings</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">Sort by:</span>
            {(['totalVolume', 'pnl'] as const).map((field) => (
              <button
                key={field}
                onClick={() => setSortBy(field)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors',
                  sortBy === field
                    ? 'bg-white/10 text-white'
                    : 'text-white/40 hover:text-white/60'
                )}
              >
                {field === 'totalVolume' ? 'Volume' : 'PnL'}
                <ArrowUpDown className="w-3 h-3" />
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-white/40 border-b border-white/5">
                <th className="text-left py-3 px-4 font-medium w-14">#</th>
                <th className="text-left py-3 px-4 font-medium">Wallet</th>
                <th className="text-right py-3 px-4 font-medium">Trades</th>
                <th className="text-right py-3 px-4 font-medium">Volume</th>
                <th className="text-right py-3 px-4 font-medium">PnL</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-white/30 text-sm">
                    No traders yet. Be the first to open a position!
                  </td>
                </tr>
              ) : (
                sorted.map((trader, idx) => (
                    <tr
                      key={trader.address}
                      className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-3 px-4">
                        <span className="font-mono text-sm text-white/50">{idx + 1}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-sm">{truncateAddress(trader.address, 4, 4)}</span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="font-mono text-sm text-white/60">{trader.tradeCount}</span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="font-mono text-sm text-white/60">{formatUSD(trader.totalVolume, 0)}</span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <PnlCell value={trader.pnl} />
                      </td>
                    </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
