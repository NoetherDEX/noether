import type { StellarAddress } from '@noether/types';
import { buildContractTx, type PreparedTx, type TxBuildContext } from '../client.js';
import { toScVal } from '../scval.js';

export interface PlaceTrailingStopParams {
  trader: StellarAddress;
  positionId: number | bigint;
  trailingPercentBps: number;
  slippageToleranceBps: number;
}

export async function buildPlaceTrailingStopTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: PlaceTrailingStopParams,
): Promise<PreparedTx> {
  const args = [
    toScVal(params.trader, 'address'),
    toScVal(params.positionId, 'u64'),
    toScVal(params.trailingPercentBps, 'u32'),
    toScVal(params.slippageToleranceBps, 'u32'),
  ];
  return buildContractTx(ctx, params.trader, marketContractId, 'place_trailing_stop', args);
}
