import type { Direction, StellarAddress, TriggerCondition } from '@noether/types';
import { buildContractTx, type PreparedTx, type TxBuildContext } from '../client.js';
import { toScVal } from '../scval.js';

export interface PlaceLimitOrderParams {
  trader: StellarAddress;
  asset: string;
  direction: Direction;
  collateral: bigint;
  leverage: number;
  triggerPrice: bigint;
  triggerCondition: TriggerCondition;
  slippageToleranceBps: number;
}

export async function buildPlaceLimitOrderTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: PlaceLimitOrderParams,
): Promise<PreparedTx> {
  const args = [
    toScVal(params.trader, 'address'),
    toScVal(params.asset, 'symbol'),
    toScVal(params.direction, 'direction'),
    toScVal(params.collateral, 'i128'),
    toScVal(params.leverage, 'u32'),
    toScVal(params.triggerPrice, 'i128'),
    toScVal(params.triggerCondition, 'trigger_above'),
    toScVal(params.slippageToleranceBps, 'u32'),
  ];
  return buildContractTx(ctx, params.trader, marketContractId, 'place_limit_order', args);
}
