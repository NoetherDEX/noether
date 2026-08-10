import type { Credentials, Transport } from '../transport.js';
import type { RawEvent, EventQuery } from './events.js';
import type { OpenPositionRow } from './positions.js';

export interface AccountIdentity {
  owner: string;
  tier: 'standard' | 'market_maker';
  keyId: string;
}

/**
 * Response of GET /v1/account/me/positions: currently open positions
 * from the indexer projection plus the owner's position events
 * (position_opened, position_closed, position_liquidated).
 */
export interface AccountPositions {
  positions: OpenPositionRow[];
  events: RawEvent[];
}

/** Trailing 14 day traded notional for a wallet, as a 7 decimal USDC string. */
export interface AccountVolume {
  address: string;
  volume14d: string;
}

/**
 * Claimable shortfall for a wallet: USDC the vault still owes this
 * trader from payouts it could not cover in full, plus the global
 * repayment reserve. When `supported` is false the zeros are
 * placeholders, not facts: hide the surface instead of rendering them.
 */
export interface AccountShortfall {
  address: string;
  owed: string;
  reserve: string;
  supported: boolean;
}

export interface AccountHistoryQuery {
  /** Cursor: only events with a ledger close time strictly below this unix time. */
  beforeTs?: number;
  limit?: number;
}

export class AccountApi {
  constructor(private readonly transport: Transport, private readonly credentials: Credentials | null) {}

  async me(): Promise<AccountIdentity> {
    this.requireAuth();
    return this.transport.request<AccountIdentity>({
      path: '/v1/account/me',
      credentials: this.credentials,
    });
  }

  async events(query: Pick<EventQuery, 'topic' | 'beforeTs' | 'limit'> = {}): Promise<RawEvent[]> {
    this.requireAuth();
    const res = await this.transport.request<{ events: RawEvent[] }>({
      path: '/v1/account/me/events',
      query: { topic: query.topic, before_ts: query.beforeTs, limit: query.limit },
      credentials: this.credentials,
    });
    return res.events;
  }

  /**
   * Open positions for the authenticated owner plus the owner's
   * position events. Returns the full route shape; earlier SDK
   * versions dropped the positions projection and returned only the
   * events list.
   */
  async positions(): Promise<AccountPositions> {
    this.requireAuth();
    return this.transport.request<AccountPositions>({
      path: '/v1/account/me/positions',
      credentials: this.credentials,
    });
  }

  async orders(query: AccountHistoryQuery = {}): Promise<RawEvent[]> {
    this.requireAuth();
    const res = await this.transport.request<{ events: RawEvent[] }>({
      path: '/v1/account/me/orders',
      query: { before_ts: query.beforeTs, limit: query.limit },
      credentials: this.credentials,
    });
    return res.events;
  }

  /** Public. Trailing 14 day traded notional for any wallet; needs no API key. */
  async volume(address: string): Promise<AccountVolume> {
    return this.transport.request<AccountVolume>({
      path: '/v1/account/volume',
      query: { address },
    });
  }

  /** Public. Claimable shortfall owed to a wallet; needs no API key. */
  async shortfall(address: string): Promise<AccountShortfall> {
    return this.transport.request<AccountShortfall>({
      path: '/v1/account/shortfall',
      query: { address },
    });
  }

  private requireAuth(): void {
    if (!this.credentials) throw new Error('account.* methods require an authenticated client');
  }
}
