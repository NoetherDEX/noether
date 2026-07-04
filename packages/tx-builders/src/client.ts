/**
 * Core Soroban transaction-building helpers.
 *
 * The flow for any write operation is:
 *   1. buildContractTx(...) constructs an unsigned, simulated, prepared
 *      transaction. It returns the XDR for the client to sign and the
 *      simulation result (so the caller can inspect retval / footprint
 *      / fee without re-simulating).
 *   2. The client signs the XDR with their wallet.
 *   3. submitSignedTx(...) sends the signed XDR and polls until a final
 *      status (SUCCESS or FAILED).
 *
 * This module never touches private keys.
 */

import {
  BASE_FEE,
  Contract,
  Networks,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import type { Network } from '@noether/types';

export interface TxBuildContext {
  rpcUrl: string;
  network: Network;
}

export interface PreparedTx {
  /** Base64-encoded XDR ready for signing. */
  xdr: string;
  /** The simulation result (kept for clients that want fee / retval info). */
  simulation: rpc.Api.SimulateTransactionSuccessResponse;
}

const NETWORK_PASSPHRASE: Record<Network, string> = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
  futurenet: Networks.FUTURENET,
};

function passphrase(network: Network): string {
  const p = NETWORK_PASSPHRASE[network];
  if (!p) throw new Error(`unknown network: ${network}`);
  return p;
}

function rpcServer(rpcUrl: string): rpc.Server {
  return new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
}

/** The unsigned invoke-contract operation produced by `Contract.call`. */
export type InvokeOp = ReturnType<Contract['call']>;

/**
 * Build the unsigned invoke-contract operation for a method call. Pure and
 * synchronous — no network, no simulation — so builders can expose it as a
 * deterministic seam (offline op inspection, XDR snapshot tests).
 */
export function buildInvokeOp(contractId: string, method: string, args: xdr.ScVal[]): InvokeOp {
  return new Contract(contractId).call(method, ...args);
}

/**
 * Construct, simulate, and assemble a contract call transaction.
 * The source account is the trader (their address); they will sign and
 * submit. The API never holds private keys.
 */
export async function buildContractTx(
  ctx: TxBuildContext,
  sourcePublicKey: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<PreparedTx> {
  const server = rpcServer(ctx.rpcUrl);
  const account = await server.getAccount(sourcePublicKey);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: passphrase(ctx.network),
  })
    .addOperation(buildInvokeOp(contractId, method, args))
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new TxSimulationError(`Simulation failed: ${sim.error}`, contractId, method, sim);
  }
  const prepared = rpc.assembleTransaction(tx, sim).build();
  return {
    xdr: prepared.toXDR(),
    simulation: sim as rpc.Api.SimulateTransactionSuccessResponse,
  };
}

export class TxSimulationError extends Error {
  override name = 'TxSimulationError';
  constructor(
    message: string,
    public readonly contractId: string,
    public readonly method: string,
    public readonly simulation: rpc.Api.SimulateTransactionResponse,
  ) {
    super(message);
  }
}

export class TxSubmitError extends Error {
  override name = 'TxSubmitError';
  constructor(
    message: string,
    public readonly status: string,
    public readonly hash?: string,
  ) {
    super(message);
  }
}

export interface SubmitOpts {
  /** Max wait in milliseconds before giving up on getTransaction (default 30s). */
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface SubmittedTx {
  hash: string;
  status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND' | 'PENDING';
  result?: rpc.Api.GetTransactionResponse;
}

/**
 * Send a signed XDR and poll getTransaction until success/failure or timeout.
 */
export async function submitSignedTx(
  ctx: TxBuildContext,
  signedXdr: string,
  opts: SubmitOpts = {},
): Promise<SubmittedTx> {
  const server = rpcServer(ctx.rpcUrl);
  const tx = TransactionBuilder.fromXDR(signedXdr, passphrase(ctx.network)) as Transaction;
  const send = await server.sendTransaction(tx);

  if (send.status === 'ERROR') {
    throw new TxSubmitError('Submission rejected by RPC', send.status, send.hash);
  }

  const pollTimeoutMs = opts.pollTimeoutMs ?? 30_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1_000;
  const deadline = Date.now() + pollTimeoutMs;

  let last: rpc.Api.GetTransactionResponse | null = null;
  while (Date.now() < deadline) {
    last = await server.getTransaction(send.hash);
    if (last.status === 'SUCCESS' || last.status === 'FAILED') {
      return { hash: send.hash, status: last.status, result: last };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  return {
    hash: send.hash,
    status: 'PENDING',
    result: last ?? undefined,
  };
}
