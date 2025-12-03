"use client"

import { TrendingUp, Lock, DollarSign } from "lucide-react"

export function VaultHeroStats() {
  // Mini sparkline data for APR
  const sparklineData = [18, 20, 19, 22, 21, 24, 23, 24.5]
  const maxVal = Math.max(...sparklineData)
  const minVal = Math.min(...sparklineData)
  const range = maxVal - minVal

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* TVL Card */}
      <div className="relative group">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#8b5cf6]/20 to-[#3b82f6]/10 opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="relative rounded-2xl border border-white/10 bg-[#0d0d0d] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/20">
              <Lock className="h-5 w-5 text-[#8b5cf6]" />
            </div>
            <span className="text-sm text-muted-foreground font-medium">Total Value Locked</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold font-mono text-foreground">$4,250,000</span>
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-[#22c55e] font-mono">+12.4%</span>
            <span className="text-muted-foreground">past 7 days</span>
          </div>
          {/* Vault visual element */}
          <div className="absolute bottom-4 right-4 opacity-5">
            <svg className="h-20 w-20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z" />
            </svg>
          </div>
        </div>
      </div>

      {/* APR Card */}
      <div className="relative group">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#22c55e]/20 to-[#22c55e]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="relative rounded-2xl border border-white/10 bg-[#0d0d0d] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-xl bg-[#22c55e]/10 border border-[#22c55e]/20">
              <TrendingUp className="h-5 w-5 text-[#22c55e]" />
            </div>
            <span className="text-sm text-muted-foreground font-medium">Current APR</span>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-bold font-mono text-[#22c55e]">24.5%</span>
            {/* Sparkline */}
            <svg className="h-8 w-20" viewBox="0 0 80 32">
              <defs>
                <linearGradient id="sparkGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* Area fill */}
              <path
                d={`M0,${32 - ((sparklineData[0] - minVal) / range) * 28} ${sparklineData
                  .map((val, i) => `L${(i / (sparklineData.length - 1)) * 80},${32 - ((val - minVal) / range) * 28}`)
                  .join(" ")} L80,32 L0,32 Z`}
                fill="url(#sparkGradient)"
              />
              {/* Line */}
              <path
                d={`M0,${32 - ((sparklineData[0] - minVal) / range) * 28} ${sparklineData
                  .map((val, i) => `L${(i / (sparklineData.length - 1)) * 80},${32 - ((val - minVal) / range) * 28}`)
                  .join(" ")}`}
                fill="none"
                stroke="#22c55e"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Variable rate based on trading fees</span>
          </div>
        </div>
      </div>

      {/* NLP Price Card */}
      <div className="relative group">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#3b82f6]/20 to-[#3b82f6]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="relative rounded-2xl border border-white/10 bg-[#0d0d0d] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-xl bg-[#3b82f6]/10 border border-[#3b82f6]/20">
              <DollarSign className="h-5 w-5 text-[#3b82f6]" />
            </div>
            <span className="text-sm text-muted-foreground font-medium">NLP Token Price</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold font-mono text-foreground">$1.042</span>
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-[#22c55e] font-mono">+4.2%</span>
            <span className="text-muted-foreground">since genesis</span>
          </div>
          {/* Token stack visual */}
          <div className="absolute bottom-4 right-4 flex -space-x-2 opacity-20">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-8 w-8 rounded-full bg-gradient-to-br from-[#8b5cf6] to-[#3b82f6] border-2 border-[#0d0d0d]"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
