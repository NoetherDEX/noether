import {
  Contract,
  rpc,
  Horizon,
  SorobanDataBuilder,
  TransactionBuilder,
  Transaction,
  Networks,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
} from '@stellar/stellar-sdk';
import { NETWORK, CONTRACTS } from '@/lib/utils/constants';
import { debugLog, debugError } from '@/lib/utils/debug';
import {
  decodeContractError,
  messageForCode,
  txResultCodeMessage,
  type ContractErrorContext,
} from '@/lib/utils/contractErrors';
import { conditionalWriteKeys, padFootprint, type KeyCtx, type TradeOp } from './footprintGuard';
import { TxFailedError } from './txErrors';
import { feeChargedXlm, genericFailureMessage, staleFootprintMessage, tryAgainLaterMessage } from '@/lib/utils/txCopy';

/** Per-call hints for the footprint guard (see footprintGuard.ts). */
export interface BuildTxOptions {
  op?: TradeOp;
  keyCtx?: Partial<Omit<KeyCtx, 'vault' | 'market' | 'trader'>>;
}

// Horizon server for account queries (balances, etc.)
const horizonServer = new Horizon.Server(NETWORK.HORIZON_URL);

// Soroban RPC client
export const sorobanRpc = new rpc.Server(NETWORK.RPC_URL);

// Contract instances
export const marketContract = new Contract(CONTRACTS.MARKET);
export const vaultContract = new Contract(CONTRACTS.VAULT);
export const usdcTokenContract = new Contract(CONTRACTS.USDC_TOKEN);
// Optional verify-then-trade router. Null unless NEXT_PUBLIC_NOETHER_ROUTER_ID
// is set — null means trades go straight to the market (default, unchanged).
export const routerContract = CONTRACTS.NOETHER_ROUTER
  ? new Contract(CONTRACTS.NOETHER_ROUTER)
  : null;

/**
 * Resolve which error table a contract's failures decode through. Error
 * codes are per-contract enums — decoding a vault_factory/referral failure
 * through the market table produces factually wrong messages (A26).
 * Unknown/unset addresses (tokens, router) keep the default market table.
 */
function contractErrorContext(contract: Contract): ContractErrorContext | undefined {
  const id = contract.contractId();
  if (CONTRACTS.VAULT_FACTORY && id === CONTRACTS.VAULT_FACTORY) return 'vault_factory';
  if (CONTRACTS.REFERRAL && id === CONTRACTS.REFERRAL) return 'referral';
  if (CONTRACTS.VAULT && id === CONTRACTS.VAULT) return 'vault';
  return undefined;
}

/**
 * Simulate a contract call and return its decoded return value WITHOUT
 * building a signable transaction — used to pre-quote outputs so the R-6
 * min-out bounds are derived from the same state the user is looking at.
 */
export async function simulateCallResult<T>(
  sourcePublicKey: string,
  contract: Contract,
  method: string,
  args: xdr.ScVal[]
): Promise<T> {
  const account = await sorobanRpc.getAccount(sourcePublicKey);
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(300)
    .build();

  const simulated = await sorobanRpc.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(
      decodeContractError(`Simulation failed: ${simulated.error}`, {
        contract: contractErrorContext(contract),
      })
    );
  }
  const retval = simulated.result?.retval;
  if (!retval) {
    throw new Error('Simulation returned no value');
  }
  return scValToNative(retval) as T;
}

/**
 * Build a transaction for a contract call
 */
export async function buildTransaction(
  sourcePublicKey: string,
  contract: Contract,
  method: string,
  args: xdr.ScVal[],
  opts: BuildTxOptions = {}
): Promise<string> {
  const account = await sorobanRpc.getAccount(sourcePublicKey);

  const operation = contract.call(method, ...args);

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();

  // Simulate to get the proper footprint and fees
  const simulated = await sorobanRpc.simulateTransaction(transaction);

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(
      decodeContractError(`Simulation failed: ${simulated.error}`, {
        contract: contractErrorContext(contract),
      })
    );
  }

  // Prepare the transaction with the simulation results, declare the keys
  // the contracts MAY write (footprint guard — the 2026-08-30 stale-footprint
  // trap), then widen the declared resources before the user ever sees the
  // signing prompt.
  const guardKeys =
    opts.op && CONTRACTS.VAULT && CONTRACTS.MARKET
      ? conditionalWriteKeys(opts.op, {
          ...opts.keyCtx,
          vault: CONTRACTS.VAULT,
          market: CONTRACTS.MARKET,
          trader: sourcePublicKey,
        })
      : [];
  const prepared = withResourceHeadroom(
    padFootprint(rpc.assembleTransaction(transaction, simulated).build(), guardKeys),
  );

  // Convert to XDR string for Freighter
  // Use toXDR() which returns base64 string in browser environment
  const xdrString = prepared.toXDR();

  debugLog('[DEBUG] Built transaction XDR (first 100 chars):', xdrString.substring(0, 100));

  return xdrString;
}

/**
 * Margin applied to the simulated Soroban resources before signing.
 *
 * Simulation prices the call against ledger state at that instant, and those
 * numbers are frozen into the envelope as a hard ceiling. The market rewrites
 * shared index entries (AllPositions, TraderPositions) on every open, so any
 * trade landing before ours executes makes the real cost exceed what we
 * declared — and the host aborts with a bare ExceededLimit trap carrying no
 * contract code.
 *
 * A browser transaction is unusually exposed here: the footprint is fixed at
 * simulation, then sits in the wallet for however long the user takes to
 * review and approve. That window is far wider than a server-side signer's,
 * so the margin is correspondingly generous.
 *
 * The margin is not free. Soroban refunds only the rent and events portion of
 * the resource fee; the compute and ledger io portion is charged from the
 * resources we declare, not the ones we use. Widening them by a quarter
 * therefore costs roughly a quarter more on that portion, which is worth it
 * against a trade that fails outright and still burns the fee.
 */
const RESOURCE_MARGIN = 1.25;

function withResourceHeadroom(assembled: Transaction): Transaction {
  try {
    const sorobanData = assembled.toEnvelope().v1().tx().ext().sorobanData();
    if (!sorobanData) return assembled;

    const res = sorobanData.resources();
    const originalResourceFee = BigInt(sorobanData.resourceFee().toString());
    const inflatedResourceFee = BigInt(Math.ceil(Number(originalResourceFee) * RESOURCE_MARGIN));

    const data = new SorobanDataBuilder(sorobanData)
      .setResources(
        Math.ceil(res.instructions() * RESOURCE_MARGIN),
        Math.ceil(res.diskReadBytes() * RESOURCE_MARGIN),
        Math.ceil(res.writeBytes() * RESOURCE_MARGIN),
      )
      .setResourceFee(inflatedResourceFee)
      .build();

    // TransactionBuilder takes the INCLUSION fee per operation and adds the
    // soroban resource fee itself during build. Handing it base plus resource
    // made build add the resource fee a second time, so the wallet showed
    // roughly two and a half times the real cost. Pass only the base portion
    // and let build supply the rest.
    const numOps = BigInt(assembled.operations.length || 1);
    const basePortion = BigInt(assembled.fee) - originalResourceFee;
    const perOpBase = basePortion > 0n ? basePortion / numOps : BigInt(BASE_FEE);

    return TransactionBuilder.cloneFrom(assembled, { fee: perOpBase.toString() })
      .setSorobanData(data)
      .build();
  } catch (err) {
    // Never block a trade over fee tuning — fall back to simulated resources.
    debugError('[buildTransaction] resource headroom unavailable:', err);
    return assembled;
  }
}

/**
 * Scan Soroban diagnostic events for an `Error(Contract, #N)` and return its
 * human-readable message. Ported from the api gateway's findContractError
 * (api/src/services/contractErrors.ts) — the proven server-side decoder.
 *
 * This is where post-simulation reverts get decoded: a trade that trips the
 * deviation guard (#81) or staleness (#30) because the price moved between
 * simulate and submit only carries its contract code on the on-chain result,
 * not at simulation time. Decodes against the NoetherError (market/vault)
 * table — every error that can reach on-chain execution is a market/vault one.
 */
function contractErrorFromDiagnostics(
  events: xdr.DiagnosticEvent[] | undefined | null
): string | null {
  for (const ev of events ?? []) {
    try {
      const body = ev.event().body().v0();
      for (const val of [...body.topics(), body.data()]) {
        const code = scErrorContractCode(val);
        if (code !== null) return messageForCode(code) ?? `Contract error #${code}`;
      }
    } catch {
      // malformed / unexpected event shape — keep scanning
    }
  }
  return null;
}

/**
 * Recognise a host-level (non-contract) failure and explain it in plain terms.
 *
 * `contractErrorFromDiagnostics` deliberately ignores anything that is not
 * `Error(Contract, #N)`, so a resource trap used to fall all the way through to
 * the bare generic — which reads like the app is broken when in fact the trade
 * was simply overtaken by other on-chain activity and will very likely succeed
 * on a retry. Distinguishing the two is the difference between "try again" and
 * "something is wrong with this market".
 */
export function hostErrorFromDiagnostics(
  events: xdr.DiagnosticEvent[] | undefined | null
): { type: string; code: string } | null {
  for (const ev of events ?? []) {
    try {
      const body = ev.event().body().v0();
      for (const val of [...body.topics(), body.data()]) {
        if (val.switch() !== xdr.ScValType.scvError()) continue;
        const err = val.error();
        if (err.switch() === xdr.ScErrorType.sceContract()) continue; // handled elsewhere
        // Mirrors api/src/services/contractErrors.ts findHostError: the
        // subsystem ("storage", "budget", …) and code ("exceeded_limit", …)
        // as snake_case names, so the flow layer can classify the failure.
        return {
          type: err.switch().name.replace(/^sce/, '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(),
          code: err.code().name.replace(/^scec/, '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(),
        };
      }
    } catch {
      // malformed / unexpected event shape — keep scanning
    }
  }
  return null;
}

/** First Error(Contract, #N) code in the diagnostic events, or null. */
function contractCodeFromDiagnostics(events: xdr.DiagnosticEvent[] | undefined | null): number | null {
  for (const ev of events ?? []) {
    try {
      const body = ev.event().body().v0();
      for (const val of [...body.topics(), body.data()]) {
        const code = scErrorContractCode(val);
        if (code !== null) return code;
      }
    } catch {
      // keep scanning
    }
  }
  return null;
}

function txResultCodeName(txResult: xdr.TransactionResult | undefined | null): string | null {
  try {
    return txResult ? txResult.result().switch().name : null;
  } catch {
    return null;
  }
}

function feeChargedFrom(txResult: xdr.TransactionResult | undefined | null): bigint | null {
  try {
    return txResult ? BigInt(txResult.feeCharged().toString()) : null;
  } catch {
    return null;
  }
}

function scErrorContractCode(val: xdr.ScVal): number | null {
  try {
    if (val.switch() !== xdr.ScValType.scvError()) return null;
    const err = val.error();
    if (err.switch() !== xdr.ScErrorType.sceContract()) return null;
    return err.contractCode();
  } catch {
    return null;
  }
}

/** Translate an outer transaction result (txBadSeq, txInsufficientBalance, …)
 *  into a friendly line; null for uninformative codes so the caller can fall
 *  back to a contract-error message or a generic. */
function txResultMessage(txResult: xdr.TransactionResult | undefined | null): string | null {
  if (!txResult) return null;
  try {
    return txResultCodeMessage(txResult.result().switch().name);
  } catch {
    return null;
  }
}

/**
 * Thrown when a submitted transaction hasn't reached a final status within
 * the polling window. The tx was NOT rejected — it may still land. Carries
 * the hash so UIs can link the explorer instead of claiming failure.
 */
export class TxStillPendingError extends Error {
  readonly txHash: string;
  constructor(txHash: string) {
    super(
      `Transaction is still confirming (${txHash.slice(0, 8)}…) — it was submitted, ` +
        'not rejected. Check its status on the explorer or your history before retrying.'
    );
    this.name = 'TxStillPendingError';
    this.txHash = txHash;
  }
}

/**
 * Submit a signed transaction
 */
export async function submitTransaction(
  signedXdr: string,
  op?: TradeOp,
): Promise<rpc.Api.GetTransactionResponse> {
  debugLog('[DEBUG] Submitting signed XDR (first 100 chars):', signedXdr.substring(0, 100));
  debugLog('[DEBUG] Full signed XDR length:', signedXdr.length);

  // Parse the signed XDR using TransactionBuilder.fromXDR
  const transaction = TransactionBuilder.fromXDR(signedXdr, NETWORK.PASSPHRASE) as Transaction;
  debugLog('[DEBUG] Parsed transaction successfully');

  const response = await sorobanRpc.sendTransaction(transaction);

  debugLog('[DEBUG] Send response:', response.status, response.hash);

  if (response.status === 'TRY_AGAIN_LATER') {
    // The RPC's queue is full; the tx was NOT accepted. Retryable as-is.
    throw new TxFailedError(tryAgainLaterMessage(op), {
      op,
      stage: 'send',
      hash: response.hash,
      sendStatus: response.status,
    });
  }

  if (response.status === 'ERROR') {
    debugError('[submitTransaction] send ERROR:', response.errorResult, response.diagnosticEvents);
    // Prefer a decoded contract error, then a transaction-level reason, then a
    // clean generic. Never surface the raw errorResult JSON to the user.
    const message =
      contractErrorFromDiagnostics(response.diagnosticEvents) ??
      txResultMessage(response.errorResult) ??
      'Transaction could not be submitted — please try again';
    throw new TxFailedError(message, {
      op,
      stage: 'send',
      hash: response.hash,
      sendStatus: response.status,
      txResultCode: txResultCodeName(response.errorResult),
      hostError: hostErrorFromDiagnostics(response.diagnosticEvents),
      contractCode: contractCodeFromDiagnostics(response.diagnosticEvents),
    });
  }

  // Wait for confirmation - poll until we get a final status
  let result = await sorobanRpc.getTransaction(response.hash);
  let attempts = 0;
  const maxAttempts = 30; // 30 seconds max wait

  while (result.status === 'NOT_FOUND' && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    result = await sorobanRpc.getTransaction(response.hash);
    attempts++;
  }

  if (result.status === 'FAILED') {
    debugError('[submitTransaction] FAILED on-chain:', result);
    // A contract revert that slipped past simulation (e.g. #81 deviation, #30
    // staleness after the price moved) carries its code in the diagnostic
    // events, not the outer result — decode that first, then the tx-level code,
    // then a clean generic. Replaces the old bare "Transaction failed: txFailed".
    const events =
      'diagnosticEventsXdr' in result
        ? (result.diagnosticEventsXdr as xdr.DiagnosticEvent[] | undefined)
        : undefined;
    const txResult =
      'resultXdr' in result ? (result.resultXdr as xdr.TransactionResult) : undefined;
    const hostError = hostErrorFromDiagnostics(events);
    const contractCode = contractCodeFromDiagnostics(events);
    const feeCharged = feeChargedFrom(txResult);
    const feeXlm = feeChargedXlm(feeCharged);
    // A contract revert keeps its decoded message. A footprint/resource trap
    // (state moved between simulate and apply) gets copy that names what the
    // user was doing and admits the fee — the network DID charge it.
    const message =
      contractErrorFromDiagnostics(events) ??
      (hostError?.code === 'exceeded_limit' ? staleFootprintMessage(op, feeXlm) : null) ??
      txResultMessage(txResult) ??
      genericFailureMessage(op, feeXlm);
    throw new TxFailedError(message, {
      op,
      stage: 'apply',
      hash: response.hash,
      txResultCode: txResultCodeName(txResult),
      hostError,
      contractCode,
      feeChargedStroops: feeCharged,
    });
  }

  if (result.status !== 'SUCCESS') {
    // NOT a failure: the tx is submitted and may still land. Give the hash
    // so the outcome is checkable — a bare "failed" here invited duplicate
    // leveraged submissions (B21).
    throw new TxStillPendingError(response.hash);
  }

  debugLog('[DEBUG] Transaction successful!');
  return result;
}

/**
 * Convert native types to ScVal
 */
export function toScVal(value: unknown, type: string): xdr.ScVal {
  switch (type) {
    case 'address':
      return new Address(value as string).toScVal();
    case 'symbol':
      return nativeToScVal(value as string, { type: 'symbol' });
    case 'i128':
      return nativeToScVal(BigInt(value as number | bigint), { type: 'i128' });
    case 'u32':
      return nativeToScVal(value as number, { type: 'u32' });
    case 'u64':
      return nativeToScVal(BigInt(value as number), { type: 'u64' });
    case 'bool':
      return nativeToScVal(value as boolean, { type: 'bool' });
    case 'direction':
      // Direction enum is encoded as u32: Long = 0, Short = 1
      // (confirmed via: stellar contract invoke ... -- open_position --help)
      const dirValue = (value as string) === 'Long' ? 0 : 1;
      return nativeToScVal(dirValue, { type: 'u32' });
    default:
      return nativeToScVal(value);
  }
}

/**
 * Convert ScVal to native types
 */
export function fromScVal(scVal: xdr.ScVal): unknown {
  return scValToNative(scVal);
}

/**
 * Get account XLM balance using Horizon
 */
export async function getAccountBalance(publicKey: string): Promise<number> {
  try {
    const account = await horizonServer.loadAccount(publicKey);
    const xlmBalance = account.balances.find(
      (b): b is Horizon.HorizonApi.BalanceLineNative => b.asset_type === 'native'
    );
    return xlmBalance ? parseFloat(xlmBalance.balance) : 0;
  } catch {
    return 0;
  }
}

// Re-export rpc for other modules
export { sorobanRpc as rpc };
