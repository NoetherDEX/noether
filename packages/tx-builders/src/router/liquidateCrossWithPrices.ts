import type { StellarAddress } from '@noether/types';
import { xdr } from '@stellar/stellar-sdk';
import {
  buildContractTx,
  buildInvokeOp,
  type InvokeOp,
  type PreparedTx,
  type TxBuildContext,
} from '../client.js';
import { toScVal } from '../scval.js';
import { attestationStructArg, type PriceAttestation } from './attestation.js';

const METHOD = 'liquidate_cross_with_prices';

export interface LiquidateCrossWithPricesParams {
  keeper: StellarAddress;
  trader: StellarAddress;
  /** One attestation per asset the trader holds cross positions in. */
  attestations: PriceAttestation[];
}

export function buildLiquidateCrossWithPricesArgs(
  params: LiquidateCrossWithPricesParams,
): xdr.ScVal[] {
  return [
    toScVal(params.keeper, 'address'),
    toScVal(params.trader, 'address'),
    xdr.ScVal.scvVec(params.attestations.map(attestationStructArg)),
  ];
}

export function buildLiquidateCrossWithPricesOp(
  routerContractId: string,
  params: LiquidateCrossWithPricesParams,
): InvokeOp {
  return buildInvokeOp(routerContractId, METHOD, buildLiquidateCrossWithPricesArgs(params));
}

export async function buildLiquidateCrossWithPricesTx(
  ctx: TxBuildContext,
  routerContractId: string,
  params: LiquidateCrossWithPricesParams,
): Promise<PreparedTx> {
  return buildContractTx(
    ctx,
    params.keeper,
    routerContractId,
    METHOD,
    buildLiquidateCrossWithPricesArgs(params),
    {
      op: 'liquidate_cross',
      keyCtx: { trader: params.trader, assets: params.attestations.map((a) => a.asset) },
    },
  );
}
