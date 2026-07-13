import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Wallet-scoped dashboards have no crawlable content of their own.
      disallow: ['/portfolio', '/api/'],
    },
    sitemap: 'https://noether.exchange/sitemap.xml',
  }
}
