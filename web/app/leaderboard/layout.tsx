import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Leaderboard',
  description:
    'Top traders on Noether by volume and realized PnL — every rank backed by on-chain Stellar testnet activity.',
}

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return children
}
