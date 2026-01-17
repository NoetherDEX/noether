import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
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
      <body className={inter.className}>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#18181b',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.1)',
            },
            success: {
              iconTheme: {
                primary: '#10b981',
                secondary: '#fff',
              },
            },
            error: {
              iconTheme: {
                primary: '#ef4444',
                secondary: '#fff',
              },
            },
          }}
        />
      </body>
    </html>
  )
}
