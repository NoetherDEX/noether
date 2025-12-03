import { InteractiveTradingChart } from "@/components/interactive-trading-chart"

export default function ChartDemoPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground mb-2">Interactive Trading Chart</h1>
          <p className="text-muted-foreground">
            TradingView-grade chart with crosshair interaction, axis badges, and real-time OHLC display
          </p>
        </div>

        <InteractiveTradingChart />

        <div className="mt-6 grid grid-cols-3 gap-4 text-sm">
          <div className="p-4 rounded-lg border border-white/10 bg-card">
            <h3 className="font-medium text-foreground mb-2">Crosshair</h3>
            <p className="text-muted-foreground">
              Move your mouse over the chart to see the dashed crosshair lines tracking your cursor.
            </p>
          </div>
          <div className="p-4 rounded-lg border border-white/10 bg-card">
            <h3 className="font-medium text-foreground mb-2">Axis Badges</h3>
            <p className="text-muted-foreground">
              Blue badge on Y-axis shows exact price. Grey badge on X-axis shows time.
            </p>
          </div>
          <div className="p-4 rounded-lg border border-white/10 bg-card">
            <h3 className="font-medium text-foreground mb-2">OHLC Display</h3>
            <p className="text-muted-foreground">
              Header shows Open, High, Low, Close, and Volume of the active candle under cursor.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
