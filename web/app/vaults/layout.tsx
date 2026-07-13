import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Vaults',
  description:
    'Browse user-created trading vaults on Noether — deposit USDC behind a leader, with the 5% minimum leader stake enforced on-chain.',
}

export default function VaultsLayout({ children }: { children: React.ReactNode }) {
  return children
}
