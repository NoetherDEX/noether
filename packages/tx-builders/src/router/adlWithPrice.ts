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

const METHOD = 'adl_with_price';

export interface AdlWithPriceParams {
  caller: StellarAddress;
  positionId: number | bigint;
  attestation: PriceAttestation;
}

export function buildAdlWithPriceArgs(params: AdlWithPriceParams): xdr.ScVal[] {
  return [
    toScVal(params.caller, 'address'),
    toScVal(params.positionId, 'u64'),
    attestationStructArg(params.attestation),
  ];
}

export function buildAdlWithPriceOp(routerContractId: string, params: AdlWithPriceParams): InvokeOp {
  return buildInvokeOp(routerContractId, METHOD, buildAdlWithPriceArgs(params));
}

export async function buildAdlWithPriceTx(
  ctx: TxBuildContext,
  routerContractId: string,
  params: AdlWithPriceParams,
): Promise<PreparedTx> {
  return buildContractTx(ctx, params.caller, routerContractId, METHOD, buildAdlWithPriceArgs(params));
}
