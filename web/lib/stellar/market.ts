import { marketContract, buildTransaction, submitTransaction, toScVal, rpc } from './client';
import type { Position, DisplayPosition, MarketConfig, Direction } from '@/types';
import { fromPrecision, calculatePnL } from '@/lib/utils/format';
import { SorobanRpc, scValToNative } from '@stellar/stellar-sdk';

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
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(params.asset, 'symbol'),
    toScVal(params.collateral, 'i128'),
    toScVal(params.leverage, 'u32'),
    toScVal(params.direction === 'Long' ? { Long: {} } : { Short: {} }, 'symbol'),
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
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(positionId, 'u32'),
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
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(positionId, 'u32'),
    toScVal(amount, 'i128'),
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

    const result = await rpc.simulateTransaction(
      await buildSimulateTransaction(traderPublicKey, 'get_positions', args)
    );

    if (SorobanRpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as Position[];
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
    const args = [toScVal(positionId, 'u32')];

    const result = await rpc.simulateTransaction(
      await buildSimulateTransaction(traderPublicKey, 'get_position_pnl', args)
    );

    if (SorobanRpc.Api.isSimulationSuccess(result) && result.result?.retval) {
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
    const result = await rpc.simulateTransaction(
      await buildSimulateTransaction(publicKey, 'get_config', [])
    );

    if (SorobanRpc.Api.isSimulationSuccess(result) && result.result?.retval) {
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

  const account = await rpc.getAccount(publicKey);
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
  const entryPrice = fromPrecision(position.entryPrice);
  const collateral = fromPrecision(position.collateral);
  const size = fromPrecision(position.size);
  const liquidationPrice = fromPrecision(position.liquidationPrice);
  const leverage = size / collateral;

  const { pnl, pnlPercent } = calculatePnL(
    entryPrice,
    currentPrice,
    size,
    position.direction === 'Long'
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
    pnl,
    pnlPercent,
    leverage,
    openedAt: new Date(position.openedAt * 1000),
  };
}
