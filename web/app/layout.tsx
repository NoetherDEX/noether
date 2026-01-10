import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Noether | Decentralized Perpetual Exchange on Stellar',
  description: 'Trade crypto perpetuals with up to 10x leverage on the first decentralized perpetual exchange built on Stellar using Soroban smart contracts.',
  keywords: ['DeFi', 'perpetuals', 'DEX', 'Stellar', 'Soroban', 'trading', 'leverage', 'crypto'],
  openGraph: {
    title: 'Noether | Decentralized Perpetual Exchange on Stellar',
    description: 'Trade crypto perpetuals with up to 10x leverage on the first decentralized perpetual exchange built on Stellar.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Noether | Decentralized Perpetual Exchange on Stellar',
    description: 'Trade crypto perpetuals with up to 10x leverage on the first decentralized perpetual exchange built on Stellar.',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
