'use client';

import { Header } from '@/components/layout';
import { WalletProvider } from '@/components/wallet';
import {
  LeaderboardBanner,
  LeaderboardPodium,
  LeaderboardTable,
  LeaderboardUserRank,
} from '@/components/leaderboard';

function LeaderboardPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Header />

      <main className="pt-16 pb-20">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
          <LeaderboardBanner />
          <LeaderboardPodium />
          <LeaderboardTable />
        </div>
      </main>

      <LeaderboardUserRank />
    </div>
  );
}

export default function LeaderboardPageWrapper() {
  return (
    <WalletProvider>
      <LeaderboardPage />
    </WalletProvider>
  );
}
