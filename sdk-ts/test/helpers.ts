import { NoetherClient, type NoetherClientOptions } from '../src/index.js';

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

export interface FetchScript {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Create a fake fetch that records every call and returns the next
 * scripted response. Pop responses FIFO; throws if none queued.
 */
export function makeFakeFetch(scripts: FetchScript[]) {
  const calls: FetchCall[] = [];
  const queue = [...scripts];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error(`fake fetch ran out of scripted responses (called ${url})`);
    const bodyText = next.body !== undefined ? JSON.stringify(next.body) : '';
    return new Response(bodyText, {
      status: next.status,
      headers: { 'content-type': 'application/json', ...(next.headers ?? {}) },
    });
  };
  return { fetch: fetchImpl, calls };
}

export function makeClient(opts?: Partial<NoetherClientOptions> & { scripts?: FetchScript[] }) {
  const scripts = opts?.scripts ?? [];
  const fake = makeFakeFetch(scripts);
  const client = new NoetherClient({
    baseUrl: 'http://api.test',
    fetch: fake.fetch,
    ...opts,
  });
  return { client, fake };
}
