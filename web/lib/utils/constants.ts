// Contract addresses from deployment
export const CONTRACTS = {
  MOCK_ORACLE: process.env.NEXT_PUBLIC_MOCK_ORACLE_ID || 'CDPSYV6YWJ2NNJLTMDBZD66OFATSDFR36LXGLLDYH6HWWXC5PEEAFFE2',
  ORACLE_ADAPTER: process.env.NEXT_PUBLIC_ORACLE_ADAPTER_ID || 'CC5GDLFJ66RPORK56ZHKOWJQVTNDHVLLQD5TZTKY3Y7CG75FLM5GOFTF',
  VAULT: process.env.NEXT_PUBLIC_VAULT_ID || 'CANZSXRBURPDI5546QTYJEIGUFPQ2T4N2BSXMVYYNT7YGPCCWAMJIOA5',
  MARKET: process.env.NEXT_PUBLIC_MARKET_ID || 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD',
  USDC_TOKEN: process.env.NEXT_PUBLIC_USDC_TOKEN_ID || 'CA63EPM4EEXUVUANF6FQUJEJ37RWRYIXCARWFXYUMPP7RLZWFNLTVNR4',
  NOE_TOKEN: process.env.NEXT_PUBLIC_NOE_TOKEN_ID || 'CD7VRBXIDYP2C2F2AZZL242GY4PRDVDH2BG3LAN2ASXYUXCPHWQJTDP5',
} as const;

// NOE Asset (Classic Stellar Asset)
export const NOE_ASSET = {
  CODE: process.env.NEXT_PUBLIC_NOE_ASSET_CODE || 'NOE',
  ISSUER: process.env.NEXT_PUBLIC_NOE_ISSUER || 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN',
} as const;

// Network configuration
export const NETWORK = {
  NAME: 'testnet' as const,
  PASSPHRASE: 'Test SDF Network ; September 2015',
  RPC_URL: 'https://soroban-testnet.stellar.org',
  HORIZON_URL: 'https://horizon-testnet.stellar.org',
} as const;

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
