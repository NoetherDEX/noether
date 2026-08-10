import { rpc, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';
import { getNetworkPassphrase } from '@noether/shared';
import type { TxBuildContext } from '@noether/tx-builders';
import {
  findContractError,
  findHostError,
  type ContractErrorInfo,
  type HostErrorInfo,
} from './contractErrors.js';

export interface TxSubmitOpts {
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

export type TxSubmitOutcome =
  | { kind: 'success'; hash: string; ledger?: number }
  | { kind: 'pending'; hash: string }
  | {
      kind: 'failed';
      hash: string;
      contractError: ContractErrorInfo | null;
      /** Set when the host aborted outside contract code, e.g. a resource overrun. */
      hostError?: HostErrorInfo | null;
      resultXdr?: string;
    }
  | { kind: 'try_again_later'; hash: string }
  | {
      kind: 'rejected';
      hash: string;
      message: string;
      contractError: ContractErrorInfo | null;
      hostError?: HostErrorInfo | null;
    };

export interface RpcLike {
  sendTransaction(tx: Transaction): Promise<rpc.Api.SendTransactionResponse>;
  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse>;
}

/**
 * Submit a signed XDR with an explicit error taxonomy:
 *  - PENDING     → poll until final status or pollTimeoutMs
 *  - DUPLICATE   → idempotent: poll the same hash and return the prior result
 *  - TRY_AGAIN_LATER → surfaced as a distinct retryable outcome (503 upstream)
 *  - FAILED      → contract error number + name decoded from diagnostic events
 *  - ERROR       → rejected at submission, with contract error when decodable
 */
export class TxSubmitService {
  private readonly server: RpcLike;

  constructor(
    private readonly ctx: TxBuildContext,
    serverOverride?: RpcLike,
  ) {
    this.server =
      serverOverride ??
      new rpc.Server(ctx.rpcUrl, { allowHttp: ctx.rpcUrl.startsWith('http://') });
  }

  async submit(signedXdr: string, opts: TxSubmitOpts = {}): Promise<TxSubmitOutcome> {
    const tx = TransactionBuilder.fromXDR(
      signedXdr,
      getNetworkPassphrase(this.ctx.network),
    ) as Transaction;
    const send = await this.server.sendTransaction(tx);

    if (send.status === 'ERROR') {
      return {
        kind: 'rejected',
        hash: send.hash,
        message: 'Submission rejected by RPC',
        contractError: findContractError(send.diagnosticEvents),
        hostError: findHostError(send.diagnosticEvents),
      };
    }
    if (send.status === 'TRY_AGAIN_LATER') {
      return { kind: 'try_again_later', hash: send.hash };
    }
    return this.poll(send.hash, opts);
  }

  private async poll(hash: string, opts: TxSubmitOpts): Promise<TxSubmitOutcome> {
    const pollTimeoutMs = opts.pollTimeoutMs ?? 30_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 1_000;
    const deadline = Date.now() + pollTimeoutMs;

    for (;;) {
      const res = await this.server.getTransaction(hash);
      if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return { kind: 'success', hash, ledger: res.ledger };
      }
      if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
        return {
          kind: 'failed',
          hash,
          contractError: findContractError(res.diagnosticEventsXdr),
          hostError: findHostError(res.diagnosticEventsXdr),
          resultXdr: safeResultXdr(res),
        };
      }
      if (Date.now() >= deadline) {
        return { kind: 'pending', hash };
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }
}

function safeResultXdr(res: rpc.Api.GetFailedTransactionResponse): string | undefined {
  try {
    return res.resultXdr.toXDR('base64');
  } catch {
    return undefined;
  }
}
