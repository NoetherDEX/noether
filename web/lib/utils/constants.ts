// Contract addresses from deployment
export const CONTRACTS = {
  MOCK_ORACLE: process.env.NEXT_PUBLIC_MOCK_ORACLE_ID || 'CAUGTIO44JFE3KV74OLJJHYLEGPFIZTZAXVF5BBY6WNUAUHHEO4JCGIH',
  ORACLE_ADAPTER: process.env.NEXT_PUBLIC_ORACLE_ADAPTER_ID || 'CBDH7R4PBFHMN4AER74O4RG7VHUWUMFI67UKDIY6ISNQP4H5KFKMSBS4',
  VAULT: process.env.NEXT_PUBLIC_VAULT_ID || 'CD5WYLEHTFHOKPPH2GMNUFW2MK7XIQFKI365G6CBAATYWVNPE3RFYMY3',
  MARKET: process.env.NEXT_PUBLIC_MARKET_ID || 'CBBSM4FYZZN4ONAV3JMHLW6S5BRKUXKARTF77SKRJ4GC4IIJGFL6SN6O',
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
  MIN_COLLATERAL: 10, // 10 XLM minimum
  MAX_LEVERAGE: 10,
  PRECISION: 10_000_000, // 7 decimals
  TRADING_FEE_BPS: 10, // 0.1%
  LIQUIDATION_FEE_BPS: 500, // 5%
} as const;

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
export const BINANCE_API = 'https://api.binance.us/api/v3';
