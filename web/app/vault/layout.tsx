import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Earn — Protocol Vault',
  description:
    'Provide USDC liquidity to the Noether protocol vault, the counterparty to all trades, and earn NOE LP tokens.',
}

export default function VaultLayout({ children }: { children: React.ReactNode }) {
  return children
}
