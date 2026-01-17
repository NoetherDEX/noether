// Contract addresses from deployment
export const CONTRACTS = {
  MOCK_ORACLE: process.env.NEXT_PUBLIC_MOCK_ORACLE_ID || 'CAUGTIO44JFE3KV74OLJJHYLEGPFIZTZAXVF5BBY6WNUAUHHEO4JCGIH',
  ORACLE_ADAPTER: process.env.NEXT_PUBLIC_ORACLE_ADAPTER_ID || 'CBDH7R4PBFHMN4AER74O4RG7VHUWUMFI67UKDIY6ISNQP4H5KFKMSBS4',
  VAULT: process.env.NEXT_PUBLIC_VAULT_ID || 'CAMBRSDQT3RQFNSHE2YLTSM766OFHCNIRJW5UVXYL3WGH2CVVLFJUI2V',
  MARKET: process.env.NEXT_PUBLIC_MARKET_ID || 'CAYTPAEGFHOJGLAL2KLJPPHZBMGYGYOXB4K4ERL4ZQICKTQWWBTNYJCQ',
  USDC_TOKEN: process.env.NEXT_PUBLIC_USDC_TOKEN_ID || 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
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
export const BINANCE_API = 'https://api.binance.com/api/v3';
