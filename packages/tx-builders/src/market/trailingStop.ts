import type { StellarAddress } from '@noether/types';
import type { xdr } from '@stellar/stellar-sdk';
import {
  buildContractTx,
  buildInvokeOp,
  type InvokeOp,
  type PreparedTx,
  type TxBuildContext,
} from '../client.js';
import { toScVal } from '../scval.js';

const METHOD = 'place_trailing_stop';

export interface PlaceTrailingStopParams {
  trader: StellarAddress;
  positionId: number | bigint;
  trailingPercentBps: number;
  slippageToleranceBps: number;
}

export function buildPlaceTrailingStopArgs(params: PlaceTrailingStopParams): xdr.ScVal[] {
  return [
    toScVal(params.trader, 'address'),
    toScVal(params.positionId, 'u64'),
    toScVal(params.trailingPercentBps, 'u32'),
    toScVal(params.slippageToleranceBps, 'u32'),
  ];
}

export function buildPlaceTrailingStopOp(
  marketContractId: string,
  params: PlaceTrailingStopParams,
): InvokeOp {
  return buildInvokeOp(marketContractId, METHOD, buildPlaceTrailingStopArgs(params));
}

export async function buildPlaceTrailingStopTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: PlaceTrailingStopParams,
): Promise<PreparedTx> {
  return buildContractTx(ctx, params.trader, marketContractId, METHOD, buildPlaceTrailingStopArgs(params));
}
