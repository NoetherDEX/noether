import type { Credentials, Transport } from '../transport.js';

export interface SubmitRequest {
  signedXdr: string;
  pollTimeoutMs?: number;
}

export interface SubmittedTx {
  hash: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'NOT_FOUND';
  ledger?: number;
  /** Decoded Error(Contract, #N) when the contract reverted; null otherwise. */
  contractError?: { code: number; name?: string; message?: string } | null;
  /**
   * Decoded non-contract host error (e.g. { type: 'storage', code: 'exceeded_limit' }
   * — the state moved between simulation and apply); null otherwise.
   */
  hostError?: { type: string; code: string } | null;
}

export class TxApi {
  constructor(private readonly transport: Transport, private readonly credentials: Credentials | null) {}

  async submit(request: SubmitRequest): Promise<SubmittedTx> {
    if (!this.credentials) throw new Error('tx.submit requires an authenticated client');
    return this.transport.request<SubmittedTx>({
      method: 'POST',
      path: '/v1/tx/submit',
      body: request,
      credentials: this.credentials,
    });
  }
}
