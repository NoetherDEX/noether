import { marketContract, buildTransaction, submitTransaction, toScVal, rpc as sorobanRpc } from './client';
import type { Position, DisplayPosition, MarketConfig, Direction } from '@/types';
import { fromPrecision, calculatePnL } from '@/lib/utils/format';
import { rpc, scValToNative } from '@stellar/stellar-sdk';

/**
 * Raw position data from contract (before parsing)
 * Contract uses snake_case and enum indices
 */
interface RawPosition {
  id: number | bigint;
  trader: string;
  asset: string;
  direction: number | bigint; // 0 = Long, 1 = Short
  collateral: bigint;
  size: bigint;
  entry_price: bigint; // snake_case from contract
  liquidation_price: bigint; // snake_case from contract
  opened_at: number | bigint; // snake_case from contract
  last_funding_at: number | bigint;
  accumulated_funding: bigint;
}

/**
 * Parse raw contract position to typed Position
 */
function parsePosition(raw: RawPosition): Position {
  return {
    id: Number(raw.id),
    trader: raw.trader,
    asset: raw.asset,
    direction: Number(raw.direction) === 0 ? 'Long' : 'Short',
    collateral: raw.collateral,
    size: raw.size,
    entryPrice: raw.entry_price,
    liquidationPrice: raw.liquidation_price,
    openedAt: Number(raw.opened_at),
    lastFundingAt: Number(raw.last_funding_at),
    accumulatedFunding: raw.accumulated_funding,
  };
}

/**
 * Safely convert BigInt to number with precision (7 decimals)
 */
function bigIntToNumber(value: bigint | number | undefined, decimals = 7): number {
  if (value === undefined || value === null) return 0;
  const num = typeof value === 'bigint' ? Number(value) : value;
  if (isNaN(num)) return 0;
  return num / Math.pow(10, decimals);
}

/**
 * Open a new leveraged position
 */
export async function openPosition(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  params: {
    asset: string;
    collateral: bigint;
    leverage: number;
    direction: Direction;
  }
): Promise<Position> {
  // Build arguments matching contract signature:
  // open_position(trader: Address, asset: Symbol, collateral: i128, leverage: u32, direction: Direction)
  const args = [
    toScVal(signerPublicKey, 'address'),  // trader: Address
    toScVal(params.asset, 'symbol'),       // asset: Symbol (e.g., "XLM", "BTC")
    toScVal(params.collateral, 'i128'),    // collateral: i128 (7 decimals)
    toScVal(params.leverage, 'u32'),       // leverage: u32 (1-10)
    toScVal(params.direction, 'direction'), // direction: Direction enum (Long=0, Short=1)
  ];

  const xdr = await buildTransaction(signerPublicKey, marketContract, 'open_position', args);
  const signedXdr = await signTransaction(xdr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS' && result.returnValue) {
    return scValToNative(result.returnValue) as Position;
  }

  throw new Error('Failed to open position');
}

/**
 * Close a position
 */
export async function closePosition(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  positionId: number
): Promise<{ pnl: bigint; fee: bigint }> {
  // Contract signature: close_position(trader: Address, position_id: u64)
  const args = [
    toScVal(signerPublicKey, 'address'),  // trader: Address
    toScVal(positionId, 'u64'),            // position_id: u64 (not u32!)
  ];

  const xdr = await buildTransaction(signerPublicKey, marketContract, 'close_position', args);
  const signedXdr = await signTransaction(xdr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS' && result.returnValue) {
    return scValToNative(result.returnValue) as { pnl: bigint; fee: bigint };
  }

  throw new Error('Failed to close position');
}

/**
 * Add collateral to a position
 */
export async function addCollateral(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  positionId: number,
  amount: bigint
): Promise<void> {
  // Contract signature: add_collateral(trader: Address, position_id: u64, amount: i128)
  const args = [
    toScVal(signerPublicKey, 'address'),  // trader: Address
    toScVal(positionId, 'u64'),            // position_id: u64 (not u32!)
    toScVal(amount, 'i128'),               // amount: i128
  ];

  const xdr = await buildTransaction(signerPublicKey, marketContract, 'add_collateral', args);
  const signedXdr = await signTransaction(xdr);
  await submitTransaction(signedXdr);
}

/**
 * Get all positions for a trader (read-only)
 */
export async function getPositions(traderPublicKey: string): Promise<Position[]> {
  try {
    const args = [toScVal(traderPublicKey, 'address')];

    const result = await sorobanRpc.simulateTransaction(
      await buildSimulateTransaction(traderPublicKey, 'get_positions', args)
    );

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      const rawPositions = scValToNative(result.result.retval) as RawPosition[];
      console.log('[DEBUG] Raw positions from contract:', rawPositions);
      return rawPositions.map(parsePosition);
    }

    return [];
  } catch (error) {
    console.error('Error fetching positions:', error);
    return [];
  }
}

/**
 * Get position PnL (read-only)
 */
export async function getPositionPnL(
  traderPublicKey: string,
  positionId: number
): Promise<bigint> {
  try {
    // Contract signature: get_position_pnl(position_id: u64)
    const args = [toScVal(positionId, 'u64')];

    const result = await sorobanRpc.simulateTransaction(
      await buildSimulateTransaction(traderPublicKey, 'get_position_pnl', args)
    );

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as bigint;
    }

    return BigInt(0);
  } catch {
    return BigInt(0);
  }
}

/**
 * Get market configuration (read-only)
 */
export async function getMarketConfig(publicKey: string): Promise<MarketConfig | null> {
  try {
    const result = await sorobanRpc.simulateTransaction(
      await buildSimulateTransaction(publicKey, 'get_config', [])
    );

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as MarketConfig;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Build transaction for simulation (read-only calls)
 */
async function buildSimulateTransaction(
  publicKey: string,
  method: string,
  args: ReturnType<typeof toScVal>[]
) {
  const { TransactionBuilder, BASE_FEE } = await import('@stellar/stellar-sdk');
  const { NETWORK } = await import('@/lib/utils/constants');

  const account = await sorobanRpc.getAccount(publicKey);
  const operation = marketContract.call(method, ...args);

  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();
}

/**
 * Convert contract Position to DisplayPosition
 */
export function toDisplayPosition(
  position: Position,
  currentPrice: number
): DisplayPosition {
  const entryPrice = bigIntToNumber(position.entryPrice);
  const collateral = bigIntToNumber(position.collateral);
  const size = bigIntToNumber(position.size);
  const liquidationPrice = bigIntToNumber(position.liquidationPrice);
  const leverage = collateral > 0 ? size / collateral : 0;

  const isLong = position.direction === 'Long';
  const { pnl, pnlPercent } = calculatePnL(
    entryPrice,
    currentPrice,
    size,
    isLong
  );

  return {
    id: position.id,
    trader: position.trader,
    asset: position.asset,
    direction: position.direction,
    collateral,
    size,
    entryPrice,
    liquidationPrice,
    currentPrice,
    pnl: isNaN(pnl) ? 0 : pnl,
    pnlPercent: isNaN(pnlPercent) ? 0 : pnlPercent,
    leverage: isNaN(leverage) ? 0 : leverage,
    openedAt: new Date(position.openedAt * 1000),
  };
}
