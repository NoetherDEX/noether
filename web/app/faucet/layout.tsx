import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Faucet',
  description:
    'Claim free testnet USDC to trade perpetuals on Noether — up to 1,000 USDC per day, no strings attached.',
}

export default function FaucetLayout({ children }: { children: React.ReactNode }) {
  return children
}
