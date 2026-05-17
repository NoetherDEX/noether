import { ApiErrorBody, NetworkError, classifyError } from './errors.js';

export interface Credentials {
  keyId: string;
  secret: string;
}

export interface TransportOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  credentials?: Credentials | null;
  /** Send X-Timestamp header for replay protection (default true when authed). */
  withTimestamp?: boolean;
  signal?: AbortSignal;
}

const RETRY_AFTER_HEADER = 'retry-after';

export class Transport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;

  constructor(opts: TransportOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error('global fetch is unavailable; pass `fetch` in NoetherClient options (Node 18+ has it native).');
    }
    this.defaultHeaders = opts.defaultHeaders ?? {};
  }

  async request<T = unknown>(opts: RequestOptions): Promise<T> {
    const url = this.buildUrl(opts.path, opts.query);
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...this.defaultHeaders,
    };

    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    if (opts.credentials) {
      headers.authorization = `Bearer ${opts.credentials.keyId}:${opts.credentials.secret}`;
      if (opts.withTimestamp !== false) {
        headers['x-timestamp'] = String(Math.floor(Date.now() / 1000));
      }
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });
    } catch (err) {
      throw new NetworkError(`fetch ${opts.method ?? 'GET'} ${url} failed`, err);
    }

    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // non-JSON; surface raw text below
      }
    }

    if (!response.ok) {
      const body = (typeof parsed === 'object' && parsed !== null ? (parsed as ApiErrorBody) : { error: text || `HTTP ${response.status}` });
      const retryHeader = response.headers.get(RETRY_AFTER_HEADER);
      const retryAfter = retryHeader ? Number(retryHeader) : null;
      throw classifyError(response.status, body, url, Number.isFinite(retryAfter) ? retryAfter : null);
    }

    return parsed as T;
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(path.startsWith('/') ? `${this.baseUrl}${path}` : `${this.baseUrl}/${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }
}
