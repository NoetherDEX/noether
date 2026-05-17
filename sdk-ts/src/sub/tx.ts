import type { Credentials, Transport } from '../transport.js';

export interface SubmitRequest {
  signedXdr: string;
  pollTimeoutMs?: number;
}

export interface SubmittedTx {
  hash: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'NOT_FOUND';
  ledger?: number;
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
