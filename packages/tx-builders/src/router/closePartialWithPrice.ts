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

const METHOD = 'close_partial_with_price';

export interface ClosePartialWithPriceParams {
  trader: StellarAddress;
  positionId: number | bigint;
  /** Notional size to close (7dp) — the market enforces the L0-6 residual floor. */
  closeSize: bigint;
  attestation: PriceAttestation;
}

export function buildClosePartialWithPriceArgs(params: ClosePartialWithPriceParams): xdr.ScVal[] {
  return [
    toScVal(params.trader, 'address'),
    toScVal(params.positionId, 'u64'),
    toScVal(params.closeSize, 'i128'),
    attestationStructArg(params.attestation),
  ];
}

export function buildClosePartialWithPriceOp(
  routerContractId: string,
  params: ClosePartialWithPriceParams,
): InvokeOp {
  return buildInvokeOp(routerContractId, METHOD, buildClosePartialWithPriceArgs(params));
}

export async function buildClosePartialWithPriceTx(
  ctx: TxBuildContext,
  routerContractId: string,
  params: ClosePartialWithPriceParams,
): Promise<PreparedTx> {
  return buildContractTx(
    ctx,
    params.trader,
    routerContractId,
    METHOD,
    buildClosePartialWithPriceArgs(params),
  );
}
