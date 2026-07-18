import type { Direction, StellarAddress } from '@noether/types';
import { buildContractTx, type PreparedTx, type TxBuildContext } from '../client.js';
import { toScVal } from '../scval.js';

export interface OpenPositionCrossParams {
  trader: StellarAddress;
  asset: string;
  collateral: bigint;
  leverage: number;
  direction: Direction;
}

export async function buildOpenPositionCrossTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: OpenPositionCrossParams,
): Promise<PreparedTx> {
  const args = [
    toScVal(params.trader, 'address'),
    toScVal(params.asset, 'symbol'),
    toScVal(params.collateral, 'i128'),
    toScVal(params.leverage, 'u32'),
    toScVal(params.direction, 'direction'),
  ];
  return buildContractTx(ctx, params.trader, marketContractId, 'open_position_cross', args);
}

export interface ClosePositionCrossParams {
  trader: StellarAddress;
  positionId: number | bigint;
}

export async function buildClosePositionCrossTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: ClosePositionCrossParams,
): Promise<PreparedTx> {
  const args = [
    toScVal(params.trader, 'address'),
    toScVal(params.positionId, 'u64'),
  ];
  return buildContractTx(ctx, params.trader, marketContractId, 'close_position_cross', args);
}
