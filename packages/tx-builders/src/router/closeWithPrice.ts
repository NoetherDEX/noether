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
import { attestationStructArg, type PriceAttestation } from './attestation.js';

const METHOD = 'close_with_price';

export interface CloseWithPriceParams {
  trader: StellarAddress;
  positionId: number | bigint;
  /** L0-10 worst-fill bound (7dp). 0 = unbounded. */
  acceptablePrice: bigint;
  attestation: PriceAttestation;
}

export function buildCloseWithPriceArgs(params: CloseWithPriceParams): xdr.ScVal[] {
  return [
    toScVal(params.trader, 'address'),
    toScVal(params.positionId, 'u64'),
    toScVal(params.acceptablePrice, 'i128'),
    attestationStructArg(params.attestation),
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
  return buildContractTx(ctx, params.trader, routerContractId, METHOD, buildCloseWithPriceArgs(params), {
    op: 'close',
    keyCtx: { asset: params.attestation.asset, positionId: BigInt(params.positionId) },
  });
}
