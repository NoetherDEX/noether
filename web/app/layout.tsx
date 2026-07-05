import type { Metadata, Viewport } from 'next'
import { Inter, Sora, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const sora = Sora({ subsets: ['latin'], variable: '--font-sora' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' })

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export const metadata: Metadata = {
  metadataBase: new URL('https://noether.exchange'),
  title: {
    default: 'Noether Testnet | Decentralized Perpetual Exchange on Stellar',
    template: '%s | Noether Testnet',
  },
  description: 'Trade crypto perpetuals with up to 10x leverage on the first decentralized perpetual exchange built on Stellar using Soroban smart contracts.',
  keywords: ['DeFi', 'perpetuals', 'DEX', 'Stellar', 'Soroban', 'trading', 'leverage', 'crypto'],
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    title: 'Noether | Decentralized Perpetual Exchange on Stellar',
    description: 'Trade crypto perpetuals with up to 10x leverage on the first decentralized perpetual exchange built on Stellar. Currently live on Stellar testnet.',
    type: 'website',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Noether DEX' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Noether | Decentralized Perpetual Exchange on Stellar',
    description: 'Trade crypto perpetuals with up to 10x leverage on the first decentralized perpetual exchange built on Stellar. Currently live on Stellar testnet.',
    images: ['/og-image.png'],
  },
}

import { Providers } from './providers'
import { FeedbackButton } from '@/components/feedback/FeedbackButton'
import { ReferralBanner } from '@/components/referral/ReferralBanner'
import { AppFooter } from '@/components/layout/AppFooter'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark scroll-smooth">
      <body className={`${inter.variable} ${sora.variable} ${jetbrainsMono.variable} font-sans antialiased bg-background text-foreground`}>
        <a
          href="#main-content"
          data-noether-chrome
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-[#eab308] focus:text-black focus:text-sm focus:font-semibold"
        >
          Skip to content
        </a>
        <Providers>
          <ReferralBanner />
          {children}
          <AppFooter />
        </Providers>
        <FeedbackButton />
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: '#18181b',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.1)',
              maxWidth: '90vw',
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
