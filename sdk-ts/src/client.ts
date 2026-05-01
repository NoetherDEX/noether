export interface NoetherClientOptions {
  /** Base URL of the Noether API gateway (e.g. https://api.noether.exchange). */
  baseUrl: string;
  /** API key id, issued via the dashboard or POST /v1/keys. Optional for public endpoints. */
  apiKey?: string;
  /** API key secret, returned once at issuance. Optional for public endpoints. */
  apiSecret?: string;
  /** Override the global fetch implementation (e.g. for testing). */
  fetch?: typeof fetch;
}

/**
 * Top-level Noether SDK client.
 *
 * Phase 1 ships only the constructor and a sanity-check ping method.
 * Markets / account / orders / ws sub-clients land in Phases 5+.
 */
export class NoetherClient {
  readonly baseUrl: string;
  readonly hasAuth: boolean;
  private readonly apiKey: string | undefined;
  private readonly apiSecret: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NoetherClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.hasAuth = Boolean(options.apiKey && options.apiSecret);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /** GET /v1/health — convenience wrapper for the API liveness probe. */
  async ping(): Promise<{ status: string; uptime: number; version: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/health`);
    if (!res.ok) {
      throw new Error(`Noether API health check failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as { status: string; uptime: number; version: string };
  }
}
