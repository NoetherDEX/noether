import type { Credentials, Transport } from '../transport.js';
import type { RawEvent, EventQuery } from './events.js';

export interface AccountIdentity {
  owner: string;
  tier: 'standard' | 'market_maker';
  keyId: string;
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

  async events(query: Pick<EventQuery, 'topic' | 'limit'> = {}): Promise<RawEvent[]> {
    this.requireAuth();
    const res = await this.transport.request<{ events: RawEvent[] }>({
      path: '/v1/account/me/events',
      query: { topic: query.topic, limit: query.limit },
      credentials: this.credentials,
    });
    return res.events;
  }

  async positions(): Promise<RawEvent[]> {
    this.requireAuth();
    const res = await this.transport.request<{ events: RawEvent[] }>({
      path: '/v1/account/me/positions',
      credentials: this.credentials,
    });
    return res.events;
  }

  async orders(): Promise<RawEvent[]> {
    this.requireAuth();
    const res = await this.transport.request<{ events: RawEvent[] }>({
      path: '/v1/account/me/orders',
      credentials: this.credentials,
    });
    return res.events;
  }

  private requireAuth(): void {
    if (!this.credentials) throw new Error('account.* methods require an authenticated client');
  }
}
