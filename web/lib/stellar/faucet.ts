import {
  Horizon,
  Asset,
  TransactionBuilder,
  Networks,
  Operation,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { NETWORK, TRADING } from '@/lib/utils/constants';

// USDC Issuer (also the admin account that mints)
const USDC_ISSUER = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';
const USDC_ASSET = new Asset('USDC', USDC_ISSUER);

// Daily limit in USDC (human-readable)
export const DAILY_LIMIT_USDC = 1000;

// Valid claim amounts
export const CLAIM_AMOUNTS = [100, 500, 1000] as const;
export type ClaimAmount = (typeof CLAIM_AMOUNTS)[number];

// Horizon server for querying
const horizonServer = new Horizon.Server(NETWORK.HORIZON_URL);

/**
 * Claim record from blockchain
 */
export interface ClaimRecord {
  id: string;
  amount: number; // In USDC (human-readable)
  timestamp: Date;
  txHash: string;
}

/**
 * Faucet state for a user
 */
export interface FaucetState {
  hasTrustline: boolean;
  claimedToday: number;
  remainingToday: number;
  totalAllTime: number;
  history: ClaimRecord[];
}

/**
 * Check if a user has a USDC trustline
 */
export async function hasTrustline(publicKey: string): Promise<boolean> {
  try {
    const account = await horizonServer.loadAccount(publicKey);

    return account.balances.some(
      (balance) =>
        balance.asset_type === 'credit_alphanum4' &&
        balance.asset_code === 'USDC' &&
        balance.asset_issuer === USDC_ISSUER
    );
  } catch (error: unknown) {
    // Account not found on network - not an error, just inactive
    if (error && typeof error === 'object' && 'response' in error) {
      const resp = error as { response?: { status?: number } };
      if (resp.response?.status === 404) return false;
    }
    console.error('Error checking trustline:', error);
    return false;
  }
}

/**
 * Build a transaction to add USDC trustline
 * Returns the XDR for signing with Freighter
 */
export async function buildAddTrustlineTransaction(
  publicKey: string
): Promise<string> {
  const account = await horizonServer.loadAccount(publicKey);

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.changeTrust({
        asset: USDC_ASSET,
      })
    )
    .setTimeout(30)
    .build();

  return transaction.toXDR();
}

/**
 * Submit a signed transaction to the network
 */
export async function submitTransaction(signedXdr: string): Promise<string> {
  const transaction = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
  const result = await horizonServer.submitTransaction(transaction);
  return result.hash;
}

/**
 * Get all faucet claim history for a user
 * Fetches payments from the USDC issuer to the user
 */
export async function getClaimHistory(
  publicKey: string,
  limit: number = 50
): Promise<ClaimRecord[]> {
  try {
    const payments = await horizonServer
      .payments()
      .forAccount(publicKey)
      .order('desc')
      .limit(200)
      .call();

    const claims: ClaimRecord[] = [];

    for (const record of payments.records) {
      // Check if it's a payment from the issuer
      if (
        record.type === 'payment' &&
        'from' in record &&
        record.from === USDC_ISSUER &&
        'asset_code' in record &&
        record.asset_code === 'USDC' &&
        'asset_issuer' in record &&
        record.asset_issuer === USDC_ISSUER
      ) {
        claims.push({
          id: record.id,
          amount: parseFloat(record.amount),
          timestamp: new Date(record.created_at),
          txHash: record.transaction_hash,
        });
      }
    }

    return claims.slice(0, limit);
  } catch (error: unknown) {
    // Account not found on network - not an error, just inactive
    if (error && typeof error === 'object' && 'response' in error) {
      const resp = error as { response?: { status?: number } };
      if (resp.response?.status === 404) return [];
    }
    console.error('Error fetching claim history:', error);
    return [];
  }
}

/**
 * Get claims made today (UTC)
 */
export function getTodaysClaims(history: ClaimRecord[]): ClaimRecord[] {
  const now = new Date();
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  return history.filter((claim) => claim.timestamp >= dayStart);
}

/**
 * Calculate remaining daily allowance
 */
export function getRemainingAllowance(history: ClaimRecord[]): number {
  const todaysClaims = getTodaysClaims(history);
  const totalClaimed = todaysClaims.reduce((sum, c) => sum + c.amount, 0);
  return Math.max(0, DAILY_LIMIT_USDC - totalClaimed);
}

/**
 * Calculate total claimed all time
 */
export function getTotalAllTime(history: ClaimRecord[]): number {
  return history.reduce((sum, c) => sum + c.amount, 0);
}

/**
 * Get available amounts based on remaining allowance
 */
export function getAvailableAmounts(
  remainingAllowance: number
): { amount: ClaimAmount; enabled: boolean }[] {
  return CLAIM_AMOUNTS.map((amount) => ({
    amount,
    enabled: remainingAllowance >= amount,
  }));
}

/**
 * Calculate running totals for history display
 */
export function calculateRunningTotals(
  history: ClaimRecord[]
): (ClaimRecord & { runningTotal: number })[] {
  // Sort by timestamp ascending to calculate running totals
  const sorted = [...history].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );

  let runningTotal = 0;
  const withTotals = sorted.map((record) => {
    runningTotal += record.amount;
    return { ...record, runningTotal };
  });

  // Return in descending order (most recent first)
  return withTotals.reverse();
}

/**
 * Format amount for display
 */
export function formatClaimAmount(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Get time until daily limit resets (UTC midnight)
 */
export function getTimeUntilReset(): {
  hours: number;
  minutes: number;
  seconds: number;
} {
  const now = new Date();
  const tomorrow = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0
    )
  );
  const diff = tomorrow.getTime() - now.getTime();

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return { hours, minutes, seconds };
}

/**
 * Validate a claim request
 */
export function validateClaimRequest(
  amount: number,
  remainingAllowance: number,
  hasTrustline: boolean
): { valid: boolean; error?: string } {
  if (!hasTrustline) {
    return { valid: false, error: 'USDC trustline required' };
  }

  if (!CLAIM_AMOUNTS.includes(amount as ClaimAmount)) {
    return { valid: false, error: 'Invalid amount' };
  }

  if (amount > remainingAllowance) {
    return {
      valid: false,
      error: `Daily limit exceeded. You can claim up to ${formatClaimAmount(remainingAllowance)} USDC today.`,
    };
  }

  return { valid: true };
}
