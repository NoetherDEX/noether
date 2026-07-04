import type { Direction, StellarAddress } from '@noether/types';
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

const METHOD = 'open_with_price';

export interface OpenWithPriceParams {
  trader: StellarAddress;
  asset: string;
  collateral: bigint;
  leverage: number;
  direction: Direction;
  attestation: PriceAttestation;
}

export function buildOpenWithPriceArgs(params: OpenWithPriceParams): xdr.ScVal[] {
  return [
    toScVal(params.trader, 'address'),
    toScVal(params.asset, 'symbol'),
    toScVal(params.collateral, 'i128'),
    toScVal(params.leverage, 'u32'),
    toScVal(params.direction, 'direction'),
    ...attestationTailArgs(params.attestation),
  ];
}

export function buildOpenWithPriceOp(routerContractId: string, params: OpenWithPriceParams): InvokeOp {
  return buildInvokeOp(routerContractId, METHOD, buildOpenWithPriceArgs(params));
}

export async function buildOpenWithPriceTx(
  ctx: TxBuildContext,
  routerContractId: string,
  params: OpenWithPriceParams,
): Promise<PreparedTx> {
  return buildContractTx(ctx, params.trader, routerContractId, METHOD, buildOpenWithPriceArgs(params));
}
