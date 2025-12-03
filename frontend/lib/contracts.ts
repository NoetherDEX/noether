/**
 * Noether Protocol - Contract Configuration
 * 
 * This file contains contract addresses and network configuration.
 * Update these values after deploying contracts in Phase 7.
 */

// Network Configuration
export const NETWORK = {
  name: "testnet",
  passphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
} as const;

// Contract IDs (Placeholders - Update after deployment)
export const CONTRACTS = {
  // Market contract for trading positions
  MARKET: "PLACEHOLDER_MARKET_CONTRACT_ID",
  
  // Vault contract for liquidity provision
  VAULT: "PLACEHOLDER_VAULT_CONTRACT_ID",
  
  // Oracle contract for price feeds
  ORACLE: "PLACEHOLDER_ORACLE_CONTRACT_ID",
  
  // USDC token contract (testnet)
  USDC_TOKEN: "PLACEHOLDER_USDC_TOKEN_CONTRACT_ID",
  
  // NLP token contract (vault LP token)
  NLP_TOKEN: "PLACEHOLDER_NLP_TOKEN_CONTRACT_ID",
} as const;

// Asset definitions
export const ASSETS = {
  STELLAR: { symbol: "XLM", decimals: 7 },
  USDC: { symbol: "USDC", decimals: 7 },
} as const;

// Precision for calculations (7 decimals - Stellar standard)
export const PRECISION = 10_000_000;

// Trading constants
export const TRADING = {
  MAX_LEVERAGE: 10, // 10x max leverage
  MIN_COLLATERAL: 10_000_000, // 1 USDC minimum (7 decimals)
  TAKER_FEE_BPS: 5, // 0.05% taker fee
  MAKER_FEE_BPS: 2, // 0.02% maker fee
} as const;

// Helper to format amounts with precision
export function toContractAmount(humanAmount: number): bigint {
  return BigInt(Math.floor(humanAmount * PRECISION));
}

// Helper to parse contract amounts to human readable
export function fromContractAmount(contractAmount: bigint | number): number {
  return Number(contractAmount) / PRECISION;
}


