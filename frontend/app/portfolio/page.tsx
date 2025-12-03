import { TopNavbar } from "@/components/top-navbar"
import { PortfolioAccountHealth } from "@/components/portfolio-account-health"
import { PortfolioPnlChart } from "@/components/portfolio-pnl-chart"
import { PortfolioAllocation } from "@/components/portfolio-allocation"
import { PortfolioHistory } from "@/components/portfolio-history"

export default function PortfolioPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <TopNavbar />
      <main className="p-4 max-w-[1600px] mx-auto">
        <div className="flex flex-col gap-4">
          {/* Row 1 - Account Health */}
          <PortfolioAccountHealth />

          {/* Row 2 - Performance & Allocation */}
          <div className="grid grid-cols-[60%_40%] gap-4">
            <PortfolioPnlChart />
            <PortfolioAllocation />
          </div>

          {/* Row 3 - History Table */}
          <PortfolioHistory />
        </div>
      </main>
    </div>
  )
}
