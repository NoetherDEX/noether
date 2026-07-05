// Contract addresses, resolved from NEXT_PUBLIC_* env vars.
//
// SAFETY: there are deliberately NO hardcoded address fallbacks. Previously this
// file fell back to (stale) production contract addresses when an env var was
// missing — which meant a misconfigured deploy (e.g. staging.noether.exchange
// with one var unset) would silently trade against PRODUCTION contracts. That is
// the exact disaster a staging environment exists to prevent. Now a missing var
// resolves to '' and is caught loudly (see assertContractsConfigured below), so a
// broken deploy fails visibly instead of pointing at the wrong chain state.
export const CONTRACTS = {
  // SEP-40-compatible shim that proxies to Noeracle's get_price_pers. This is the
  // only on-chain oracle in the Noeracle-only stack (mock_oracle / oracle_adapter
  // are retired). Set NEXT_PUBLIC_NOERACLE_SHIM_ID after running scripts/deploy_noeracle_shim.sh.
  NOERACLE_SHIM: process.env.NEXT_PUBLIC_NOERACLE_SHIM_ID || '',
  // Atomic verify-then-trade router (Pattern B). When set, the web routes open()
  // through noether_router.open_with_price so each trade executes on a
  // sub-second-fresh Noeracle price (no #30 staleness). Unset = direct market
  // calls (unchanged). Set NEXT_PUBLIC_NOETHER_ROUTER_ID after running
  // scripts/deploy_noether_router.sh.
  NOETHER_ROUTER: process.env.NEXT_PUBLIC_NOETHER_ROUTER_ID || '',
  VAULT: process.env.NEXT_PUBLIC_VAULT_ID || '',
  MARKET: process.env.NEXT_PUBLIC_MARKET_ID || '',
  USDC_TOKEN: process.env.NEXT_PUBLIC_USDC_TOKEN_ID || '',
  NOE_TOKEN: process.env.NEXT_PUBLIC_NOE_TOKEN_ID || '',
  // Tranche 2 contracts — optional (their features hide when unset), so they
  // are NOT in REQUIRED_CONTRACTS. Used to pick the right error table when a
  // failed call targets vault_factory / referral (see contractErrors.ts).
  VAULT_FACTORY: process.env.NEXT_PUBLIC_VAULT_FACTORY_ID || '',
  REFERRAL: process.env.NEXT_PUBLIC_REFERRAL_ID || '',
} as const;

// Deploy environment, as reported by Vercel ('production' | 'preview' |
// 'development'); undefined for local/other. Used to scope the strictness of the
// config check so a missing var never silently degrades into the wrong chain.
export const DEPLOY_ENV = process.env.NEXT_PUBLIC_VERCEL_ENV || 'development';

// Contract addresses that MUST be configured for the trading UI to function.
const REQUIRED_CONTRACTS: ReadonlyArray<keyof typeof CONTRACTS> = [
  'NOERACLE_SHIM',
  'VAULT',
  'MARKET',
  'USDC_TOKEN',
  'NOE_TOKEN',
];

/**
 * Fail loud on a misconfigured deploy. Call once on the client at app start.
 *
 * Throws (in the browser) when a required contract address is missing, listing
 * exactly which env vars to set. With no hardcoded fallbacks, a missing var can
 * no longer silently resolve to a production address — the worst case is now a
 * clear, immediate error instead of trading on the wrong contracts.
 */
export function assertContractsConfigured(): void {
  const missing = REQUIRED_CONTRACTS.filter((k) => !CONTRACTS[k]);
  if (missing.length === 0) return;

  const envVars = missing.map((k) => `NEXT_PUBLIC_${k}_ID`).join(', ');
  const message =
    `Missing contract address env var(s) for the "${DEPLOY_ENV}" deploy: ${envVars}. ` +
    `Set them in the matching Vercel Environment Variables scope ` +
    `(Production = live addresses, Preview = staging/green addresses).`;

  // Always surface it; throw on the client so the broken deploy is unmissable.
  console.error(`[noether] ${message}`);
  if (typeof window !== 'undefined') {
    throw new Error(message);
  }
}

// Noeracle attestation service — the web fetches a fresh signed price here at
// trade time when the router is enabled (NEXT_PUBLIC_NOETHER_ROUTER_ID set).
export const NOERACLE_API_URL =
  process.env.NEXT_PUBLIC_NOERACLE_API_URL || 'https://api.noeracle.org';

// NOE Asset (Classic Stellar Asset)
export const NOE_ASSET = {
  CODE: process.env.NEXT_PUBLIC_NOE_ASSET_CODE || 'NOE',
  ISSUER: process.env.NEXT_PUBLIC_NOE_ISSUER || 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN',
} as const;

// USDC Asset (Classic Stellar Asset wrapped by the USDC SAC) — the single
// source for the issuer previously duplicated in faucet.ts, TrustlineSection,
// and the faucet claim route. Testnet issuer = the admin account.
export const USDC_ASSET = {
  CODE: process.env.NEXT_PUBLIC_USDC_ASSET_CODE || 'USDC',
  ISSUER: process.env.NEXT_PUBLIC_USDC_ISSUER || 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN',
} as const;

// Faucet daily claim limit (USDC) — single source for the client lib
// (faucet.ts) and the api/faucet/* route responses.
export const FAUCET_DAILY_LIMIT_USDC = 1000;

// Community links — ONE canonical invite (three different invites used to be
// hardcoded across not-found / landing footer / referral + keys cards). This
// is the invite the active T2 surfaces (referrals, api-keys) already shipped.
export const DISCORD_URL = 'https://discord.gg/2BxYv6Uc';

// Network configuration
export const NETWORK = {
  NAME: 'testnet' as const,
  PASSPHRASE: 'Test SDF Network ; September 2015',
  RPC_URL: 'https://soroban-testnet.stellar.org',
  HORIZON_URL: 'https://horizon-testnet.stellar.org',
} as const;

// stellar.expert explorer base for the current network — use instead of
// hardcoding the '/testnet/' path segment in links.
export const STELLAR_EXPERT_BASE = `https://stellar.expert/explorer/${NETWORK.NAME}`;

// Well-known all-zeros public key: the source account for unauthenticated
// read-only Soroban simulations (build with `new Account(NULL_ACCOUNT, '0')`,
// no getAccount round-trip needed — simulation ignores sequence numbers).
// Lets logged-out visitors get real on-chain reads instead of fabricated 0s.
export const NULL_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

// Trading constants
export const TRADING = {
  MIN_COLLATERAL: 10, // 10 USDC minimum
  MAX_LEVERAGE: 10,
  PRECISION: 10_000_000, // 7 decimals
  // Legacy flat fee (deprecated - now using maker/taker tiers)
  TRADING_FEE_BPS: 10, // 0.1% (fallback)
  LIQUIDATION_FEE_BPS: 500, // 5%
  // Maker/Taker base fees in deci-bps (1 unit = 0.001%)
  // E.g., 20 = 2.0 bps = 0.020%
  BASE_MAKER_FEE_BPS: 20, // 0.020%
  BASE_TAKER_FEE_BPS: 50, // 0.050%
  FEE_PRECISION: 100_000, // Divisor for deci-bps: fee = size * feeBps / FEE_PRECISION
} as const;

// Fee tier thresholds (for display) - values in deci-bps
export const FEE_TIERS = [
  { name: 'Base', minVolume: 0, makerBps: 20, takerBps: 50 },
  { name: 'Tier 1', minVolume: 20_000, makerBps: 15, takerBps: 40 },
  { name: 'Tier 2', minVolume: 50_000, makerBps: 10, takerBps: 30 },
  { name: 'Tier 3', minVolume: 100_000, makerBps: 5, takerBps: 20 },
] as const;

// Supported assets
export const ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin', decimals: 8 },
  { symbol: 'ETH', name: 'Ethereum', decimals: 8 },
  { symbol: 'XLM', name: 'Stellar Lumens', decimals: 7 },
] as const;

// Chart timeframes
export const TIMEFRAMES = [
  { label: '1m', value: '1m', seconds: 60 },
  { label: '5m', value: '5m', seconds: 300 },
  { label: '15m', value: '15m', seconds: 900 },
  { label: '1H', value: '1h', seconds: 3600 },
  { label: '4H', value: '4h', seconds: 14400 },
  { label: '1D', value: '1d', seconds: 86400 },
] as const;

// Binance API for chart data
// Binance API accessed via server-side proxy at /api/price to avoid geo-blocks
// export const BINANCE_API = 'https://api.binance.com/api/v3';
