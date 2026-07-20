import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { Toaster } from 'react-hot-toast'
import './globals.css'

// Self-hosted variable fonts (latin). Previously next/font/google, which
// fetches from fonts.gstatic.com at BUILD time — a flaky Vercel build machine
// → Google Fonts connection intermittently ETIMEDOUT and failed the whole
// build. Local files remove that network dependency entirely.
const inter = localFont({
  src: './fonts/Inter.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-inter',
})
const sora = localFont({
  src: './fonts/Sora.woff2',
  weight: '100 800',
  display: 'swap',
  variable: '--font-sora',
})
const jetbrainsMono = localFont({
  src: './fonts/JetBrainsMono.woff2',
  weight: '100 800',
  display: 'swap',
  variable: '--font-jetbrains-mono',
})
// Editorial display serif (landing hero / display headings only).
const instrumentSerif = localFont({
  src: [
    { path: './fonts/InstrumentSerif.woff2', weight: '400', style: 'normal' },
    { path: './fonts/InstrumentSerifItalic.woff2', weight: '400', style: 'italic' },
  ],
  display: 'swap',
  variable: '--font-instrument-serif',
})

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
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
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
import { TestnetRibbon } from '@/components/TestnetRibbon'
import { PauseBanner } from '@/components/PauseBanner'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark scroll-smooth">
      <body className={`${inter.variable} ${sora.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable} font-sans antialiased bg-background text-foreground`}>
        <a
          href="#main-content"
          data-noether-chrome
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-[#eab308] focus:text-black focus:text-sm focus:font-semibold"
        >
          Skip to content
        </a>
        <TestnetRibbon />
        <PauseBanner />
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
