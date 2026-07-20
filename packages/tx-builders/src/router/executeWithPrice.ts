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

const METHOD = 'execute_with_price';

export interface ExecuteWithPriceParams {
  keeper: StellarAddress;
  orderId: number | bigint;
  attestation: PriceAttestation;
}

export function buildExecuteWithPriceArgs(params: ExecuteWithPriceParams): xdr.ScVal[] {
  return [
    toScVal(params.keeper, 'address'),
    toScVal(params.orderId, 'u64'),
    attestationStructArg(params.attestation),
  ];
}

export function buildExecuteWithPriceOp(
  routerContractId: string,
  params: ExecuteWithPriceParams,
): InvokeOp {
  return buildInvokeOp(routerContractId, METHOD, buildExecuteWithPriceArgs(params));
}

export async function buildExecuteWithPriceTx(
  ctx: TxBuildContext,
  routerContractId: string,
  params: ExecuteWithPriceParams,
): Promise<PreparedTx> {
  return buildContractTx(ctx, params.keeper, routerContractId, METHOD, buildExecuteWithPriceArgs(params));
}
