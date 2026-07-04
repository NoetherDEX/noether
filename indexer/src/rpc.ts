import { rpc } from '@stellar/stellar-sdk';

export type RpcServer = rpc.Server;

export function createRpc(rpcUrl: string): RpcServer {
  return new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
}

/**
 * Round-robin pool over the configured RPC endpoints (SOROBAN_RPC_URLS).
 * fetchEvents rotates to the next endpoint on transient failures so one
 * dead RPC does not stall the poller (I-3 failover).
 */
export class RpcPool {
  private index = 0;

  constructor(
    private readonly servers: RpcServer[],
    private readonly urls: string[] = [],
  ) {
    if (servers.length === 0) throw new Error('RpcPool requires at least one server');
  }

  get size(): number {
    return this.servers.length;
  }

  current(): RpcServer {
    return this.servers[this.index]!;
  }

  currentUrl(): string {
    return this.urls[this.index] ?? `rpc[${this.index}]`;
  }

  rotate(): RpcServer {
    this.index = (this.index + 1) % this.servers.length;
    return this.current();
  }
}

export function createRpcPool(urls: string[]): RpcPool {
  return new RpcPool(urls.map(createRpc), urls);
}

export async function getLatestLedger(server: RpcServer): Promise<number> {
  const info = await server.getLatestLedger();
  return info.sequence;
}

/** Oldest ledger the RPC still retains, or null if the probe fails. */
export async function getOldestLedger(server: RpcServer): Promise<number | null> {
  try {
    const health = (await server.getHealth()) as { oldestLedger?: number };
    return typeof health.oldestLedger === 'number' ? health.oldestLedger : null;
  } catch {
    return null;
  }
}

export interface RetentionErrorInfo {
  oldestLedger: number | null;
  latestLedger: number | null;
}

/**
 * Classify a getEvents failure as "startLedger/cursor fell out of the
 * RPC retention window". The RPC reports its live range in the message
 * ("startLedger must be within the ledger range: X - Y"); parse it out
 * when present so the caller can clamp without another round-trip.
 */
export function parseRetentionError(err: unknown): RetentionErrorInfo | null {
  const message = err instanceof Error ? err.message : String(err);
  const outOfRange =
    /(startLedger|start ledger|cursor)[^.]*?(must be within|outside|before the oldest|ledger range)/i.test(message) ||
    /outside of retention window/i.test(message);
  if (!outOfRange) return null;
  const range = message.match(/(\d{2,})\s*(?:-|to|and)\s*(\d{2,})/);
  return {
    oldestLedger: range ? Number(range[1]) : null,
    latestLedger: range ? Number(range[2]) : null,
  };
}

export interface FetchEventsParams {
  startLedger: number;
  contractIds: string[];
  cursor?: string;
  limit?: number;
}

/**
 * Wrapper around server.getEvents that retries transient errors,
 * rotating through the pool between attempts. Soroban RPC events are
 * best-effort: indexes occasionally lag behind the latest ledger and
 * the RPC may return TRY_AGAIN_LATER. Retention errors are rethrown
 * immediately — the poller handles those by clamping + recording a gap.
 */
export async function fetchEvents(
  pool: RpcPool,
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
      return await pool.current().getEvents(request);
    } catch (err) {
      lastErr = err;
      if (parseRetentionError(err)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const transient =
        message.includes('TRY_AGAIN_LATER') ||
        message.includes('ECONNRESET') ||
        message.includes('ETIMEDOUT') ||
        message.includes('fetch failed');
      if (!transient || attempt === retries) throw err;
      if (pool.size > 1) pool.rotate();
      const backoff = 500 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
