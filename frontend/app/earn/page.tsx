import { TopNavbar } from "@/components/top-navbar"
import { VaultHeroStats } from "@/components/vault-hero-stats"
import { VaultActionCard } from "@/components/vault-action-card"
import { VaultCompositionChart } from "@/components/vault-composition-chart"
import { VaultInfo } from "@/components/vault-info"

export default function EarnPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <TopNavbar />

      <main className="p-6">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="relative h-10 w-10">
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-[#8b5cf6] to-[#3b82f6] opacity-20" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg
                  className="h-6 w-6 text-[#8b5cf6]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
                  />
                </svg>
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Noether Liquidity Pool</h1>
              <p className="text-sm text-muted-foreground">Earn yield by providing liquidity to perpetual markets</p>
            </div>
          </div>
        </div>

        {/* Hero Stats Row */}
        <VaultHeroStats />

        {/* Main Content Grid */}
        <div className="grid grid-cols-12 gap-6 mt-6">
          {/* Left Column - Composition Chart & Info */}
          <div className="col-span-7 space-y-6">
            <VaultCompositionChart />
            <VaultInfo />
          </div>

          {/* Right Column - Action Card */}
          <div className="col-span-5">
            <VaultActionCard />
          </div>
        </div>
      </main>
    </div>
  )
}
