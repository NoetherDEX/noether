"use client"

const compositionData = [
  { asset: "USDC", percentage: 85, color: "#2775ca", value: 3612500 },
  { asset: "XLM", percentage: 10, color: "#8b5cf6", value: 425000 },
  { asset: "BTC", percentage: 5, color: "#f7931a", value: 212500 },
]

export function VaultCompositionChart() {
  // Calculate donut chart segments
  let cumulativePercentage = 0
  const segments = compositionData.map((item) => {
    const start = cumulativePercentage
    cumulativePercentage += item.percentage
    return { ...item, start, end: cumulativePercentage }
  })

  const createArcPath = (startPercent: number, endPercent: number, radius: number, innerRadius: number) => {
    const startAngle = (startPercent / 100) * 360 - 90
    const endAngle = (endPercent / 100) * 360 - 90

    const startOuterX = 50 + radius * Math.cos((startAngle * Math.PI) / 180)
    const startOuterY = 50 + radius * Math.sin((startAngle * Math.PI) / 180)
    const endOuterX = 50 + radius * Math.cos((endAngle * Math.PI) / 180)
    const endOuterY = 50 + radius * Math.sin((endAngle * Math.PI) / 180)

    const startInnerX = 50 + innerRadius * Math.cos((endAngle * Math.PI) / 180)
    const startInnerY = 50 + innerRadius * Math.sin((endAngle * Math.PI) / 180)
    const endInnerX = 50 + innerRadius * Math.cos((startAngle * Math.PI) / 180)
    const endInnerY = 50 + innerRadius * Math.sin((startAngle * Math.PI) / 180)

    const largeArcFlag = endPercent - startPercent > 50 ? 1 : 0

    return `M ${startOuterX} ${startOuterY} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endOuterX} ${endOuterY} L ${startInnerX} ${startInnerY} A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${endInnerX} ${endInnerY} Z`
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="font-semibold text-foreground">Pool Composition</h3>
          <p className="text-sm text-muted-foreground">Asset allocation breakdown</p>
        </div>
        <div className="px-3 py-1.5 rounded-full bg-[#22c55e]/10 border border-[#22c55e]/20">
          <span className="text-xs font-medium text-[#22c55e]">Healthy</span>
        </div>
      </div>

      <div className="flex items-center gap-8">
        {/* Donut Chart */}
        <div className="relative w-48 h-48 flex-shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            {/* Background circle */}
            <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />

            {/* Segments */}
            {segments.map((segment, index) => (
              <path
                key={index}
                d={createArcPath(segment.start, segment.end, 46, 34)}
                fill={segment.color}
                className="transition-all hover:opacity-80"
                style={{ filter: "drop-shadow(0 0 8px rgba(0,0,0,0.3))" }}
              />
            ))}
          </svg>

          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Total</span>
            <span className="text-xl font-bold font-mono text-foreground">$4.25M</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-4">
          {compositionData.map((item, index) => (
            <div key={index} className="flex items-center gap-4">
              <div className="flex items-center gap-3 w-24">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="font-medium text-foreground">{item.asset}</span>
              </div>
              <div className="flex-1">
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${item.percentage}%`, backgroundColor: item.color }}
                  />
                </div>
              </div>
              <div className="text-right w-28">
                <span className="font-mono text-sm text-foreground">{item.percentage}%</span>
                <span className="text-xs text-muted-foreground ml-2">${(item.value / 1000000).toFixed(2)}M</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Coming Soon Banner */}
      <div className="mt-6 p-3 rounded-xl bg-gradient-to-r from-[#8b5cf6]/10 to-[#3b82f6]/10 border border-white/5">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-[#8b5cf6]/20">
            <svg className="h-4 w-4 text-[#8b5cf6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div className="flex-1">
            <span className="text-sm text-foreground">Multi-asset support coming soon</span>
            <span className="text-xs text-muted-foreground ml-2">XLM & BTC collateral in Q1 2025</span>
          </div>
        </div>
      </div>
    </div>
  )
}
