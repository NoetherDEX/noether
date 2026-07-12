'use client';

import { Header } from '@/components/layout';
import { WalletProvider } from '@/components/wallet';
import { LeaderboardContent } from '@/components/leaderboard';

function LeaderboardPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-12 pb-16">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <h1 className="text-xl font-medium mb-6">Leaderboard</h1>
          <LeaderboardContent />
        </div>
      </main>
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
