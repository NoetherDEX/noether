import { IS_MAINNET_BUILD } from '@/lib/utils/constants';

// Single source of truth for app navigation links.
// The app Header and the landing footer both render from this list so the
// IA can never drift again (the pre-T2 landing footer shipped stale links).
// The faucet is a testnet-only surface — mainnet builds drop it entirely.
export const APP_NAV_ITEMS = [
  { href: '/trade', label: 'Trade' },
  { href: '/portfolio', label: 'Portfolio' },
  // B24: the protocol LP pool holds user funds — it cannot be orphaned from
  // primary nav, and "Earn" separates it from the leader-vault marketplace
  // one letter away.
  { href: '/vault', label: 'Earn' },
  { href: '/vaults', label: 'Vaults' },
  { href: '/referrals', label: 'Referrals' },
  { href: '/leaderboard', label: 'Leaderboard' },
  ...(IS_MAINNET_BUILD ? [] : [{ href: '/faucet', label: 'Faucet' }]),
];

// Canonical docs link — the real docs site (was a Google Drive folder).
export const DOCS_URL = 'https://docs.noether.exchange';
