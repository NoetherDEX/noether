import { rpc } from '@stellar/stellar-sdk';

export type RpcServer = rpc.Server;

export function createRpc(rpcUrl: string): RpcServer {
  return new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
}

export async function getLatestLedger(server: RpcServer): Promise<number> {
  const info = await server.getLatestLedger();
  return info.sequence;
}

export interface FetchEventsParams {
  startLedger: number;
  contractIds: string[];
  cursor?: string;
  limit?: number;
}

/**
 * Wrapper around server.getEvents that retries transient errors.
 * Soroban RPC events are best-effort: indexes occasionally lag behind the
 * latest ledger and the RPC may return TRY_AGAIN_LATER.
 */
export async function fetchEvents(
  server: RpcServer,
  params: FetchEventsParams,
  retries = 3,
): Promise<rpc.Api.GetEventsResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const baseRequest = {
        filters: [
          {
            type: 'contract' as const,
            contractIds: params.contractIds,
          },
        ],
        limit: params.limit ?? 1000,
      };
      const request = params.cursor
        ? { ...baseRequest, cursor: params.cursor }
        : { ...baseRequest, startLedger: params.startLedger };
      return await server.getEvents(request);
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      const transient =
        message.includes('TRY_AGAIN_LATER') ||
        message.includes('ECONNRESET') ||
        message.includes('ETIMEDOUT') ||
        message.includes('fetch failed');
      if (!transient || attempt === retries) throw err;
      const backoff = 500 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
