import { TopNavbar } from "@/components/top-navbar"
import { LeaderboardBanner } from "@/components/leaderboard-banner"
import { LeaderboardPodium } from "@/components/leaderboard-podium"
import { LeaderboardTable } from "@/components/leaderboard-table"
import { LeaderboardUserRank } from "@/components/leaderboard-user-rank"

export default function LeaderboardPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNavbar />
      <main className="pt-14 pb-20">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
          <LeaderboardBanner />
          <LeaderboardPodium />
          <LeaderboardTable />
        </div>
      </main>
      <LeaderboardUserRank />
    </div>
  )
}
