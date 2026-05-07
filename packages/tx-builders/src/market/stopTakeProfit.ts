import type { StellarAddress } from '@noether/types';
import { buildContractTx, type PreparedTx, type TxBuildContext } from '../client.js';
import { toScVal } from '../scval.js';

export interface SetStopLossParams {
  trader: StellarAddress;
  positionId: number | bigint;
  triggerPrice: bigint;
  slippageToleranceBps: number;
}

export async function buildSetStopLossTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: SetStopLossParams,
): Promise<PreparedTx> {
  const args = [
    toScVal(params.trader, 'address'),
    toScVal(params.positionId, 'u64'),
    toScVal(params.triggerPrice, 'i128'),
    toScVal(params.slippageToleranceBps, 'u32'),
  ];
  return buildContractTx(ctx, params.trader, marketContractId, 'set_stop_loss', args);
}

export interface SetTakeProfitParams {
  trader: StellarAddress;
  positionId: number | bigint;
  triggerPrice: bigint;
  slippageToleranceBps: number;
}

export async function buildSetTakeProfitTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: SetTakeProfitParams,
): Promise<PreparedTx> {
  const args = [
    toScVal(params.trader, 'address'),
    toScVal(params.positionId, 'u64'),
    toScVal(params.triggerPrice, 'i128'),
    toScVal(params.slippageToleranceBps, 'u32'),
  ];
  return buildContractTx(ctx, params.trader, marketContractId, 'set_take_profit', args);
}
