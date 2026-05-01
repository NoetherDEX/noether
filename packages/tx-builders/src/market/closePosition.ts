import type { StellarAddress } from '@noether/types';
import { buildContractTx, type PreparedTx, type TxBuildContext } from '../client.js';
import { toScVal } from '../scval.js';

export interface ClosePositionParams {
  trader: StellarAddress;
  positionId: number | bigint;
}

export async function buildClosePositionTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: ClosePositionParams,
): Promise<PreparedTx> {
  const args = [
    toScVal(params.trader, 'address'),
    toScVal(params.positionId, 'u64'),
  ];
  return buildContractTx(ctx, params.trader, marketContractId, 'close_position', args);
}
