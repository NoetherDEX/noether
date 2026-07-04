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
import { attestationTailArgs, type PriceAttestation } from './attestation.js';

const METHOD = 'close_with_price';

export interface CloseWithPriceParams {
  trader: StellarAddress;
  positionId: number | bigint;
  asset: string;
  attestation: PriceAttestation;
}

export function buildCloseWithPriceArgs(params: CloseWithPriceParams): xdr.ScVal[] {
  return [
    toScVal(params.trader, 'address'),
    toScVal(params.positionId, 'u64'),
    toScVal(params.asset, 'symbol'),
    ...attestationTailArgs(params.attestation),
  ];
}

export function buildCloseWithPriceOp(routerContractId: string, params: CloseWithPriceParams): InvokeOp {
  return buildInvokeOp(routerContractId, METHOD, buildCloseWithPriceArgs(params));
}

export async function buildCloseWithPriceTx(
  ctx: TxBuildContext,
  routerContractId: string,
  params: CloseWithPriceParams,
): Promise<PreparedTx> {
  return buildContractTx(ctx, params.trader, routerContractId, METHOD, buildCloseWithPriceArgs(params));
}
