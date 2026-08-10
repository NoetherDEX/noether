import { Transport, type Credentials } from './transport.js';
import { HealthApi } from './sub/health.js';
import { MarketsApi } from './sub/markets.js';
import { OracleApi } from './sub/oracle.js';
import { EventsApi } from './sub/events.js';
import { KeysApi, type ChallengeSigner } from './sub/keys.js';
import { AccountApi } from './sub/account.js';
import { OrdersApi, type PrepareRequest, type PreparedTransaction } from './sub/orders.js';
import { PositionsApi } from './sub/positions.js';
import { TradesApi } from './sub/trades.js';
import { AdlApi } from './sub/adl.js';
import { TxApi, type SubmittedTx } from './sub/tx.js';
import { VaultsApi } from './sub/vaults.js';
import { ReferralApi } from './sub/referral.js';
import { WsClient, type WsClientOptions } from './sub/ws.js';

export interface NoetherClientOptions {
  /** Base URL of the Noether API gateway (e.g. https://api.noether.exchange). */
  baseUrl: string;
  /** API key + secret. Required for authed endpoints (account, orders, tx, key mgmt). */
  credentials?: Credentials;
  /** Override the global fetch implementation (for testing or custom transports). */
  fetch?: typeof fetch;
}

/**
 * SDK signer that turns a base64 XDR into a signed XDR. Typically wraps
 * a Stellar Keypair or a wallet adapter (Freighter, Wallets Kit, Ledger).
 */
export type XdrSigner = (xdr: string) => string | Promise<string>;

export interface ExecuteTradeOptions {
  request: PrepareRequest;
  signer: XdrSigner;
  pollTimeoutMs?: number;
}

export interface ExecuteTradeResult {
  prepared: PreparedTransaction;
  submitted: SubmittedTx;
}

export class NoetherClient {
  readonly baseUrl: string;
  readonly hasAuth: boolean;
  readonly health: HealthApi;
  readonly markets: MarketsApi;
  readonly oracle: OracleApi;
  readonly events: EventsApi;
  readonly keys: KeysApi;
  readonly account: AccountApi;
  readonly orders: OrdersApi;
  readonly positions: PositionsApi;
  readonly trades: TradesApi;
  readonly adl: AdlApi;
  readonly tx: TxApi;
  readonly vaults: VaultsApi;
  readonly referral: ReferralApi;

  private readonly transport: Transport;
  private readonly credentials: Credentials | null;

  constructor(options: NoetherClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.credentials = options.credentials ?? null;
    this.hasAuth = this.credentials !== null;

    this.transport = new Transport({ baseUrl: this.baseUrl, fetch: options.fetch });
    this.health = new HealthApi(this.transport);
    this.markets = new MarketsApi(this.transport);
    this.oracle = new OracleApi(this.transport);
    this.events = new EventsApi(this.transport);
    this.keys = new KeysApi(this.transport, this.credentials);
    this.account = new AccountApi(this.transport, this.credentials);
    this.orders = new OrdersApi(this.transport, this.credentials);
    this.positions = new PositionsApi(this.transport);
    this.trades = new TradesApi(this.transport);
    this.adl = new AdlApi(this.transport);
    this.tx = new TxApi(this.transport, this.credentials);
    this.vaults = new VaultsApi(this.transport);
    this.referral = new ReferralApi(this.transport, this.credentials);
  }

  /** Return a new client bound to the given credentials. Original is untouched. */
  withCredentials(credentials: Credentials): NoetherClient {
    return new NoetherClient({ baseUrl: this.baseUrl, credentials });
  }

  /**
   * One-shot trade execution: prepare → caller signs → submit.
   * The signer never has to round-trip through the SDK.
   */
  async executeTrade(opts: ExecuteTradeOptions): Promise<ExecuteTradeResult> {
    if (!this.hasAuth) throw new Error('executeTrade requires an authenticated client');
    const prepared = await this.orders.prepare(opts.request);
    const signedXdr = await opts.signer(prepared.xdr);
    const submitted = await this.tx.submit({ signedXdr, pollTimeoutMs: opts.pollTimeoutMs });
    return { prepared, submitted };
  }

  /**
   * Convenience entry-point for the wallet challenge flow when you have
   * a raw signer (e.g. a Stellar Keypair). Mirrors keys.create.
   */
  async issueKey(input: { address: string; signer: ChallengeSigner; label?: string }) {
    return this.keys.create(input);
  }

  /**
   * Construct a WebSocket sub-client bound to the same gateway. The URL
   * is derived from baseUrl by replacing http(s) with ws(s) and
   * appending `/v1/ws`. The current credentials (if any) are forwarded.
   */
  ws(opts: Omit<WsClientOptions, 'url' | 'credentials'> = {}): WsClient {
    const url = this.baseUrl.replace(/^http/, 'ws') + '/v1/ws';
    return new WsClient({ url, credentials: this.credentials ?? undefined, ...opts });
  }
}
