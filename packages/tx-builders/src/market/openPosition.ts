import type { Direction, StellarAddress } from '@noether/types';
import { buildContractTx, type PreparedTx, type TxBuildContext } from '../client.js';
import { toScVal } from '../scval.js';

export interface OpenPositionParams {
  trader: StellarAddress;
  asset: string;
  collateral: bigint;
  leverage: number;
  direction: Direction;
}

export async function buildOpenPositionTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: OpenPositionParams,
): Promise<PreparedTx> {
  const args = [
    toScVal(params.trader, 'address'),
    toScVal(params.asset, 'symbol'),
    toScVal(params.collateral, 'i128'),
    toScVal(params.leverage, 'u32'),
    toScVal(params.direction, 'direction'),
  ];
  return buildContractTx(ctx, params.trader, marketContractId, 'open_position', args);
}
