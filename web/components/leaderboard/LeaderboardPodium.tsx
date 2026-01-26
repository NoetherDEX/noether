'use client';

import { Crown, Medal, Award, LucideIcon } from 'lucide-react';

interface TopTrader {
  rank: number;
  address: string;
  displayName?: string;
  pnl: string;
  prize: string;
  volume: string;
  color: 'gold' | 'silver' | 'bronze';
  icon: LucideIcon;
}

const topTraders: TopTrader[] = [
  {
    rank: 2,
    address: 'GBXM...K8L2',
    pnl: '+312%',
    prize: '$5,000',
    volume: '$2.4M',
    color: 'silver',
    icon: Medal,
  },
  {
    rank: 1,
    address: 'GCSA...A1B2',
    displayName: 'StellarWhale',
    pnl: '+450%',
    prize: '$10,000',
    volume: '$4.2M',
    color: 'gold',
    icon: Crown,
  },
  {
    rank: 3,
    address: 'GDVX...P9Q3',
    pnl: '+278%',
    prize: '$3,000',
    volume: '$1.8M',
    color: 'bronze',
    icon: Award,
  },
];

const colorStyles = {
  gold: {
    border: 'border-yellow-500/50',
    glow: 'shadow-[0_0_60px_-15px_rgba(234,179,8,0.5)]',
    gradient: 'from-yellow-500/20 via-amber-500/10 to-transparent',
    text: 'text-yellow-400',
    badge: 'bg-gradient-to-br from-yellow-500 to-amber-600',
    ring: 'ring-yellow-500/30',
  },
  silver: {
    border: 'border-slate-400/50',
    glow: 'shadow-[0_0_40px_-15px_rgba(148,163,184,0.4)]',
    gradient: 'from-slate-400/20 via-slate-500/10 to-transparent',
    text: 'text-slate-300',
    badge: 'bg-gradient-to-br from-slate-400 to-slate-500',
    ring: 'ring-slate-400/30',
  },
  bronze: {
    border: 'border-orange-600/50',
    glow: 'shadow-[0_0_40px_-15px_rgba(234,88,12,0.4)]',
    gradient: 'from-orange-600/20 via-orange-700/10 to-transparent',
    text: 'text-orange-400',
    badge: 'bg-gradient-to-br from-orange-500 to-orange-700',
    ring: 'ring-orange-500/30',
  },
};

function generateAvatar(seed: string, color: string) {
  const hue = color === 'gold' ? 45 : color === 'silver' ? 220 : 25;
  return (
    <div className="relative">
      <svg viewBox="0 0 80 80" className="w-full h-full">
        <defs>
          <linearGradient id={`grad-${seed}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={`hsl(${hue}, 70%, 60%)`} />
            <stop offset="100%" stopColor={`hsl(${hue + 20}, 60%, 40%)`} />
          </linearGradient>
        </defs>
        <rect width="80" height="80" fill={`url(#grad-${seed})`} rx="16" />
        {/* Geometric pattern */}
        <polygon points="20,60 40,20 60,60" fill="rgba(255,255,255,0.15)" />
        <circle cx="40" cy="45" r="12" fill="rgba(255,255,255,0.2)" />
        <rect x="25" y="55" width="30" height="4" rx="2" fill="rgba(255,255,255,0.1)" />
      </svg>
    </div>
  );
}

export function LeaderboardPodium() {
  return (
    <div className="grid grid-cols-3 gap-4 lg:gap-6 items-end">
      {topTraders.map((trader) => {
        const styles = colorStyles[trader.color];
        const Icon = trader.icon;
        const isFirst = trader.rank === 1;

        return (
          <div
            key={trader.rank}
            className={`relative rounded-2xl border ${styles.border} bg-gradient-to-b ${styles.gradient} backdrop-blur-sm ${styles.glow} ${
              isFirst ? 'lg:scale-110 z-10' : ''
            } transition-transform hover:scale-105`}
          >
            {/* Rank badge */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <div
                className={`w-10 h-10 rounded-full ${styles.badge} flex items-center justify-center ring-4 ${styles.ring} ring-offset-2 ring-offset-background`}
              >
                <Icon className="w-5 h-5 text-white" />
              </div>
            </div>

            <div className={`p-5 ${isFirst ? 'lg:p-6' : ''} pt-8`}>
              {/* Avatar */}
              <div
                className={`w-16 h-16 ${isFirst ? 'lg:w-20 lg:h-20' : ''} mx-auto mb-3 rounded-xl overflow-hidden ring-2 ${styles.ring}`}
              >
                {generateAvatar(trader.address, trader.color)}
              </div>

              {/* Info */}
              <div className="text-center">
                {trader.displayName && (
                  <p className={`text-sm font-semibold ${styles.text} mb-0.5`}>{trader.displayName}</p>
                )}
                <p className="font-mono text-xs text-muted-foreground mb-3">{trader.address}</p>

                {/* PnL */}
                <div className="inline-block px-3 py-1.5 rounded-lg bg-[#22c55e]/10 mb-3">
                  <span className="font-mono text-xl font-bold text-[#22c55e]">{trader.pnl}</span>
                  <span className="text-xs text-[#22c55e]/70 ml-1">ROI</span>
                </div>

                {/* Stats */}
                <div className="flex items-center justify-between text-xs border-t border-white/5 pt-3 mt-1">
                  <div>
                    <p className="text-muted-foreground">Volume</p>
                    <p className="font-mono text-foreground">{trader.volume}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground">Prize</p>
                    <p className={`font-mono font-semibold ${styles.text}`}>{trader.prize}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
