import type { Direction, StellarAddress } from '@noether/types';
import { buildContractTx, type PreparedTx, type TxBuildContext } from '../client.js';
import { toScVal } from '../scval.js';

export interface OpenPositionCrossParams {
  trader: StellarAddress;
  asset: string;
  collateral: bigint;
  leverage: number;
  direction: Direction;
  /** L0-10 worst-fill bound (7dp). Omitted or 0 = unbounded fill. */
  acceptablePrice?: bigint;
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
    toScVal(params.acceptablePrice ?? 0n, 'i128'),
  ];
  return buildContractTx(ctx, params.trader, marketContractId, 'open_position_cross', args, {
    op: 'open_cross',
    keyCtx: { asset: params.asset },
  });
}

export interface ClosePositionCrossParams {
  trader: StellarAddress;
  positionId: number | bigint;
  /** L0-10 worst-fill bound (7dp). Omitted or 0 = unbounded fill. */
  acceptablePrice?: bigint;
}

export async function buildClosePositionCrossTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: ClosePositionCrossParams,
): Promise<PreparedTx> {
  const args = [
    toScVal(params.trader, 'address'),
    toScVal(params.positionId, 'u64'),
    toScVal(params.acceptablePrice ?? 0n, 'i128'),
  ];
  return buildContractTx(ctx, params.trader, marketContractId, 'close_position_cross', args, {
    op: 'close_cross',
    keyCtx: { positionId: BigInt(params.positionId) },
  });
}
