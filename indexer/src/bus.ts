import { EventEmitter } from 'node:events';
import type { DecodedMarketEvent } from './types/events.js';

/**
 * Internal event bus.
 *
 * The indexer publishes decoded events here after they have been written
 * to libsql. The API gateway and (later) the WebSocket fan-out subscribe
 * to this bus to push real-time updates to clients.
 *
 * Phase 2 emits market events. Phase 10/11 will emit vault and referral
 * events without changing the bus contract.
 */
export type IndexerBusChannel =
  | 'event'
  | 'trade'
  | 'position'
  | 'order'
  | 'funding';

export interface IndexerBusMap {
  event: DecodedMarketEvent;
  trade: { kind: 'open' | 'close' | 'liquidation'; positionId: number; trader: string; price: bigint; size: bigint; ts: number; asset?: string };
  position: { positionId: number; trader: string; state: 'opened' | 'closed' | 'liquidated' | 'reduced' };
  order: { orderId: number; state: 'placed' | 'cancelled' | 'executed' };
  funding: { fundingRate: bigint; hoursElapsed: bigint; ts: number };
}

export class IndexerBus {
  private readonly inner = new EventEmitter();

  emit<C extends IndexerBusChannel>(channel: C, payload: IndexerBusMap[C]): void {
    this.inner.emit(channel, payload);
  }

  on<C extends IndexerBusChannel>(channel: C, handler: (payload: IndexerBusMap[C]) => void): () => void {
    this.inner.on(channel, handler as (...args: unknown[]) => void);
    return () => this.inner.off(channel, handler as (...args: unknown[]) => void);
  }

  off<C extends IndexerBusChannel>(channel: C, handler: (payload: IndexerBusMap[C]) => void): void {
    this.inner.off(channel, handler as (...args: unknown[]) => void);
  }
}
