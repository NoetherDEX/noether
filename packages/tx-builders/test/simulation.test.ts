/**
 * Live-simulation arity guard (L0-21).
 *
 * The XDR snapshot tests in builders.test.ts pin what we BUILD; they cannot
 * catch drift between the builders and the DEPLOYED contract (that is exactly
 * how the 8-vs-9 / 9-vs-10 / 4-vs-5 arity break shipped and stayed green).
 * This suite builds every market op via buildContractTx — which simulates
 * against a real RPC — and fails on any argument-shape rejection.
 *
 * A contract-level error (Error(Contract, #N): bogus position id, stale
 * price, insufficient balance…) PROVES the arity was accepted: dispatch
 * succeeded and contract code ran. Only host-layer argument/shape failures
 * (unexpected arguments, UnexpectedSize…) indicate builder drift.
 *
 * Opt-in: set SIMULATE_RPC_URL (and optionally SIMULATE_CONTRACTS_JSON /
 * SIMULATE_NETWORK) — skipped otherwise so the default unit run stays
 * offline. CI runs it in .github/workflows/builder-simulation.yml.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Network } from '@noether/types';
import { Market, type TxBuildContext } from '../src/index.js';

const RPC_URL = process.env.SIMULATE_RPC_URL;
const d = RPC_URL ? describe : describe.skip;

/** Sim-error fragments that mean "the argument shape itself was rejected". */
const ARITY_FAILURE = /unexpected arguments|invalid number of arguments|UnexpectedSize|MismatchingParameterLen|wrong number of/i;

interface ContractsJson {
  contracts: { market: string };
  admin: string;
}

function loadContracts(): ContractsJson {
  const path =
    process.env.SIMULATE_CONTRACTS_JSON ?? new URL('../../../contracts.json', import.meta.url).pathname;
  return JSON.parse(readFileSync(path, 'utf-8')) as ContractsJson;
}

async function expectAritySound(build: () => Promise<unknown>): Promise<void> {
  try {
    await build();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Contract-level rejections are fine — the call reached contract code.
    expect(message).not.toMatch(ARITY_FAILURE);
  }
}

d('deployed-contract simulation (arity guard)', () => {
  const { contracts, admin } = loadContracts();
  const ctx: TxBuildContext = {
    rpcUrl: RPC_URL!,
    network: (process.env.SIMULATE_NETWORK ?? 'testnet') as Network,
  };
  const market = contracts.market;
  const trader = admin; // funded, always exists on the target network
  const T = 30_000;

  const base = {
    trader,
    asset: 'BTC',
    direction: 'Long' as const,
    collateral: 1_000_000_000n, // 100 USDC (7dp)
    leverage: 5,
  };
  const trigger = {
    triggerPrice: 300_000_000_000_000n, // $30M — never triggers accidentally
    triggerCondition: 'Above' as const,
    slippageToleranceBps: 100,
  };
  const bogusId = 999_999_999;

  it('open_position', () => expectAritySound(() => Market.buildOpenPositionTx(ctx, market, base)), T);
  it('open_position_cross', () => expectAritySound(() => Market.buildOpenPositionCrossTx(ctx, market, base)), T);
  it('close_position', () => expectAritySound(() => Market.buildClosePositionTx(ctx, market, { trader, positionId: bogusId })), T);
  it('close_position_cross', () => expectAritySound(() => Market.buildClosePositionCrossTx(ctx, market, { trader, positionId: bogusId })), T);
  it('place_limit_order (9 args incl. time_in_force)', () =>
    expectAritySound(() => Market.buildPlaceLimitOrderTx(ctx, market, { ...base, ...trigger, timeInForce: 0 })), T);
  it('place_stop_limit_order (10 args incl. time_in_force)', () =>
    expectAritySound(() =>
      Market.buildPlaceStopLimitOrderTx(ctx, market, { ...base, ...trigger, limitPrice: 310_000_000_000_000n, timeInForce: 0 }),
    ), T);
  it('place_trailing_stop', () =>
    expectAritySound(() =>
      Market.buildPlaceTrailingStopTx(ctx, market, { trader, positionId: bogusId, trailingPercentBps: 200, slippageToleranceBps: 100 }),
    ), T);
  it('set_stop_loss (4 args)', () =>
    expectAritySound(() =>
      Market.buildSetStopLossTx(ctx, market, { trader, positionId: bogusId, triggerPrice: trigger.triggerPrice, slippageToleranceBps: 100 }),
    ), T);
  it('set_take_profit (5 args incl. limit_price)', () =>
    expectAritySound(() =>
      Market.buildSetTakeProfitTx(ctx, market, {
        trader,
        positionId: bogusId,
        triggerPrice: trigger.triggerPrice,
        slippageToleranceBps: 100,
        limitPrice: 310_000_000_000_000n,
      }),
    ), T);
  it('cancel_order', () => expectAritySound(() => Market.buildCancelOrderTx(ctx, market, { trader, orderId: bogusId })), T);
});
