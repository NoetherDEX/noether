'use client';

import { ArrowUpDown, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils/cn';

interface Trader {
  rank: number;
  address: string;
  winRate: number;
  volume: string;
  pnl: string;
  roi: number;
}

const traders: Trader[] = [
  { rank: 4, address: 'GDHK...M4N5', winRate: 82, volume: '$1.2M', pnl: '+$48,200', roi: 241 },
  { rank: 5, address: 'GCPQ...R6S7', winRate: 78, volume: '$980K', pnl: '+$38,500', roi: 192 },
  { rank: 6, address: 'GBWX...T8U9', winRate: 75, volume: '$1.5M', pnl: '+$42,100', roi: 168 },
  { rank: 7, address: 'GDYZ...V0W1', winRate: 71, volume: '$720K', pnl: '+$28,900', roi: 145 },
  { rank: 8, address: 'GCAB...X2Y3', winRate: 69, volume: '$890K', pnl: '+$31,200', roi: 139 },
  { rank: 9, address: 'GBCD...Z4A5', winRate: 68, volume: '$1.1M', pnl: '+$35,800', roi: 131 },
  { rank: 10, address: 'GDEF...B6C7', winRate: 66, volume: '$650K', pnl: '+$22,400', roi: 124 },
  { rank: 11, address: 'GDGH...D8E9', winRate: 65, volume: '$580K', pnl: '+$19,800', roi: 118 },
  { rank: 12, address: 'GCIJ...F0G1', winRate: 64, volume: '$920K', pnl: '+$27,600', roi: 112 },
  { rank: 13, address: 'GBKL...H2I3', winRate: 62, volume: '$440K', pnl: '+$14,200', roi: 106 },
  { rank: 14, address: 'GDMN...J4K5', winRate: 61, volume: '$780K', pnl: '+$23,100', roi: 99 },
  { rank: 15, address: 'GCOP...L6M7', winRate: 59, volume: '$510K', pnl: '+$15,800', roi: 94 },
];

export function LeaderboardTable() {
  const [sortBy, setSortBy] = useState<'roi' | 'volume' | 'pnl'>('roi');

  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0a] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h3 className="text-sm font-semibold text-foreground">Rankings</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort by:</span>
          <button
            onClick={() => setSortBy('roi')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
              sortBy === 'roi'
                ? 'bg-[#8b5cf6]/20 text-[#8b5cf6]'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            ROI
            <ArrowUpDown className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-white/5">
              <th className="text-left py-3 px-4 font-medium w-16">#</th>
              <th className="text-left py-3 px-4 font-medium">Trader</th>
              <th className="text-right py-3 px-4 font-medium">Win Rate</th>
              <th className="text-right py-3 px-4 font-medium">Volume</th>
              <th className="text-right py-3 px-4 font-medium">Total PnL</th>
              <th className="text-right py-3 px-4 font-medium">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#8b5cf6]/10 text-[#8b5cf6]">
                  ROI %
                  <ChevronDown className="w-3 h-3" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {traders.map((trader, idx) => (
              <tr
                key={trader.rank}
                className={cn(
                  'border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors',
                  idx % 2 === 0 ? 'bg-white/[0.01]' : ''
                )}
              >
                <td className="py-3 px-4">
                  <span className="font-mono text-sm text-muted-foreground">{trader.rank}</span>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    {/* Mini avatar */}
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/30 to-blue-500/30 flex items-center justify-center">
                      <span className="text-xs font-mono text-white/70">{trader.address.slice(0, 2)}</span>
                    </div>
                    <span className="font-mono text-sm text-foreground">{trader.address}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-12 h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500"
                        style={{ width: `${trader.winRate}%` }}
                      />
                    </div>
                    <span className="font-mono text-sm text-foreground">{trader.winRate}%</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-right">
                  <span className="font-mono text-sm text-muted-foreground">{trader.volume}</span>
                </td>
                <td className="py-3 px-4 text-right">
                  <span className="font-mono text-sm text-[#22c55e]">{trader.pnl}</span>
                </td>
                <td className="py-3 px-4 text-right">
                  <span className="font-mono text-sm font-semibold text-foreground">{trader.roi}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      <div className="flex items-center justify-center py-4 border-t border-white/5">
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
          <span>Load more</span>
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
