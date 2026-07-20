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

const METHOD = 'liquidate_with_price';

export interface LiquidateWithPriceParams {
  keeper: StellarAddress;
  positionId: number | bigint;
  attestation: PriceAttestation;
}

export function buildLiquidateWithPriceArgs(params: LiquidateWithPriceParams): xdr.ScVal[] {
  return [
    toScVal(params.keeper, 'address'),
    toScVal(params.positionId, 'u64'),
    attestationStructArg(params.attestation),
  ];
}

export function buildLiquidateWithPriceOp(
  routerContractId: string,
  params: LiquidateWithPriceParams,
): InvokeOp {
  return buildInvokeOp(routerContractId, METHOD, buildLiquidateWithPriceArgs(params));
}

export async function buildLiquidateWithPriceTx(
  ctx: TxBuildContext,
  routerContractId: string,
  params: LiquidateWithPriceParams,
): Promise<PreparedTx> {
  return buildContractTx(ctx, params.keeper, routerContractId, METHOD, buildLiquidateWithPriceArgs(params));
}
