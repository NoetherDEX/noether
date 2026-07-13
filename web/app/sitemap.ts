import type { MetadataRoute } from 'next'

const BASE = 'https://noether.exchange'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/trade`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/vaults`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/vault`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE}/leaderboard`, changeFrequency: 'daily', priority: 0.6 },
    { url: `${BASE}/faucet`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/referrals`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/terms`, changeFrequency: 'yearly', priority: 0.2 },
  ]
}
