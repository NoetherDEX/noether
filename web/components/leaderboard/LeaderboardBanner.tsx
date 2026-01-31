'use client';

import { Trophy, Clock, Flame } from 'lucide-react';
import { useEffect, useState } from 'react';

export function LeaderboardBanner() {
  const [timeLeft, setTimeLeft] = useState({
    days: 14,
    hours: 8,
    minutes: 42,
    seconds: 15,
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        let { days, hours, minutes, seconds } = prev;
        seconds--;
        if (seconds < 0) {
          seconds = 59;
          minutes--;
        }
        if (minutes < 0) {
          minutes = 59;
          hours--;
        }
        if (hours < 0) {
          hours = 23;
          days--;
        }
        if (days < 0) {
          days = 0;
          hours = 0;
          minutes = 0;
          seconds = 0;
        }
        return { days, hours, minutes, seconds };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1a1a2e] via-[#16162a] to-[#0a0a0a] p-8">
      {/* Background effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.15),transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(59,130,246,0.1),transparent_50%)]" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-violet-500/10 blur-[100px] rounded-full" />

      {/* Grid pattern overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px]" />

      <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-8">
        {/* Left: Title section */}
        <div className="text-center lg:text-left">
          <div className="flex items-center justify-center lg:justify-start gap-3 mb-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-blue-500/20 border border-violet-500/30">
              <Trophy className="w-6 h-6 text-violet-400" />
            </div>
            <span className="text-xs font-medium text-violet-400 uppercase tracking-widest">Competition</span>
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold bg-gradient-to-r from-white via-violet-200 to-blue-200 bg-clip-text text-transparent mb-2">
            Stellar Trading Arena
          </h1>
          <p className="text-lg text-muted-foreground">
            <span className="text-violet-400 font-semibold">Season 1: Genesis</span>
            <span className="mx-2">&bull;</span>
            <span className="inline-flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-orange-400" />
              Top traders compete for glory
            </span>
          </p>
        </div>

        {/* Center: Countdown */}
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
            <Clock className="w-3.5 h-3.5" />
            <span>Season ends in</span>
          </div>
          <div className="flex items-center gap-2">
            {[
              { value: timeLeft.days, label: 'Days' },
              { value: timeLeft.hours, label: 'Hrs' },
              { value: timeLeft.minutes, label: 'Min' },
              { value: timeLeft.seconds, label: 'Sec' },
            ].map((item, i) => (
              <div key={item.label} className="flex items-center gap-2">
                <div className="flex flex-col items-center">
                  <div className="w-14 h-14 rounded-lg bg-black/50 border border-white/10 flex items-center justify-center">
                    <span className="font-mono text-2xl font-bold text-white">
                      {String(item.value).padStart(2, '0')}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">{item.label}</span>
                </div>
                {i < 3 && <span className="text-2xl text-white/30 font-light mb-4">:</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Prize Pool */}
        <div className="text-center lg:text-right">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Total Prize Pool</p>
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-green-500/20 to-emerald-500/20 blur-xl rounded-full" />
            <p className="relative font-mono text-4xl lg:text-5xl font-bold text-[#22c55e]">$20,000</p>
          </div>
          <p className="text-sm text-muted-foreground mt-1">USDC</p>
        </div>
      </div>
    </div>
  );
}
