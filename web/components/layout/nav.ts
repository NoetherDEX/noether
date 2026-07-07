// Single source of truth for app navigation links.
// The app Header and the landing footer both render from this list so the
// IA can never drift again (the pre-T2 landing footer shipped stale links).
export const APP_NAV_ITEMS = [
  { href: '/trade', label: 'Trade' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/vaults', label: 'Vaults' },
  { href: '/referrals', label: 'Referrals' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/api-keys', label: 'API Keys' },
  { href: '/faucet', label: 'Faucet' },
];

// Canonical docs link (today: the technical-architecture folder the landing footer links)
export const DOCS_URL =
  'https://drive.google.com/drive/folders/1_W3c5DZy2b4Aj8hQVcCkvObZSqCDBzmv';
