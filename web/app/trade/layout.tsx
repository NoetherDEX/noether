import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Trade',
  description:
    'Trade BTC, ETH and XLM perpetual futures with up to 10x leverage — oracle-priced, fully on-chain on Stellar testnet.',
}

export default function TradeLayout({ children }: { children: React.ReactNode }) {
  return children
}
