'use client';

import { User, TrendingUp, ArrowUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/hooks/useWallet';

interface LeaderboardUserRankProps {
  rank?: number;
  roi?: number;
  winRate?: number;
  volume?: number;
}

export function LeaderboardUserRank({
  rank = 142,
  roi = 28.4,
  winRate = 54,
  volume = 24800,
}: LeaderboardUserRankProps) {
  const router = useRouter();
  const { isConnected } = useWallet();

  const ranksToTop100 = rank > 100 ? rank - 100 : 0;

  if (!isConnected) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 border border-violet-500/30 flex items-center justify-center">
                <User className="w-5 h-5 text-violet-400" />
              </div>
              <p className="text-sm text-muted-foreground">Connect wallet to see your rank</p>
            </div>
            <button
              onClick={() => router.push('/trade')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-sm font-medium transition-all"
            >
              <TrendingUp className="w-4 h-4" />
              <span>Trade Now</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-background/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Left: User info */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 border border-violet-500/30 flex items-center justify-center">
                <User className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Your Rank</p>
                <p className="font-mono text-lg font-bold text-foreground">#{rank}</p>
              </div>
            </div>

            <div className="h-8 w-px bg-white/10" />

            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#22c55e]/10">
              <ArrowUp className="w-3.5 h-3.5 text-[#22c55e]" />
              <span className="text-xs font-medium text-[#22c55e]">+12 today</span>
            </div>
          </div>

          {/* Center: Stats */}
          <div className="hidden md:flex items-center gap-8">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Your ROI</p>
              <p className="font-mono text-sm font-semibold text-[#22c55e]">+{roi}%</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Win Rate</p>
              <p className="font-mono text-sm font-semibold text-foreground">{winRate}%</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Total Volume</p>
              <p className="font-mono text-sm font-semibold text-foreground">
                ${volume.toLocaleString()}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Est. Prize</p>
              <p className="font-mono text-sm font-semibold text-muted-foreground">
                {rank <= 100 ? '$500' : '\u2014'}
              </p>
            </div>
          </div>

          {/* Right: CTA */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <p className="text-xs text-muted-foreground">Top 100 for prizes</p>
              {ranksToTop100 > 0 ? (
                <p className="text-xs text-violet-400">{ranksToTop100} ranks to go</p>
              ) : (
                <p className="text-xs text-[#22c55e]">You&apos;re in!</p>
              )}
            </div>
            <button
              onClick={() => router.push('/trade')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-sm font-medium transition-all"
            >
              <TrendingUp className="w-4 h-4" />
              <span>Trade Now</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
