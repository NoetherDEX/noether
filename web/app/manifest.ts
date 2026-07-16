import type { MetadataRoute } from 'next'

// PWA manifest: gives add-to-home-screen a real name/icon for the
// WalletConnect mobile audience instead of a blank tile.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Noether — Perpetuals on Stellar',
    short_name: 'Noether',
    description:
      'Decentralized perpetual futures exchange on Stellar. Trade BTC, ETH and XLM perps with up to 10x leverage on testnet.',
    start_url: '/trade',
    display: 'standalone',
    background_color: '#0B0D10',
    theme_color: '#0B0D10',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  }
}
