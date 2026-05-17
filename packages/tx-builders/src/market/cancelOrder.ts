import type { StellarAddress } from '@noether/types';
import { buildContractTx, type PreparedTx, type TxBuildContext } from '../client.js';
import { toScVal } from '../scval.js';

export interface CancelOrderParams {
  trader: StellarAddress;
  orderId: number | bigint;
}

export async function buildCancelOrderTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: CancelOrderParams,
): Promise<PreparedTx> {
  const args = [
    toScVal(params.trader, 'address'),
    toScVal(params.orderId, 'u64'),
  ];
  return buildContractTx(ctx, params.trader, marketContractId, 'cancel_order', args);
}
