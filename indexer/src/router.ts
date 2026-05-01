/**
 * Event router.
 *
 * Maps (contract address, event topic) -> handler. New contracts (vault,
 * referral) plug into this router by registering their own (contract,
 * topic, handler) triples; existing market routes are untouched.
 */

import type { Logger } from 'pino';
import type { Client } from '@libsql/client';
import type { rpc as RpcNs } from '@stellar/stellar-sdk';
import type { IndexerBus } from './bus.js';
import type { DecodedMarketEvent } from './types/events.js';

export interface HandlerContext {
  db: Client;
  rpc: RpcNs.Server;
  bus: IndexerBus;
  log: Logger;
}

export type Handler<E = DecodedMarketEvent> = (event: E, ctx: HandlerContext) => Promise<void>;

interface Registration {
  contractId: string;
  topic: string;
  handler: Handler;
}

export class EventRouter {
  private readonly registrations: Registration[] = [];

  register(contractId: string, topic: string, handler: Handler): void {
    this.registrations.push({ contractId, topic, handler });
  }

  async dispatch(event: DecodedMarketEvent, ctx: HandlerContext): Promise<void> {
    const matches = this.registrations.filter(
      (r) => r.contractId === event.contractId && r.topic === event.topic,
    );
    for (const match of matches) {
      try {
        await match.handler(event, ctx);
      } catch (err) {
        ctx.log.error({ err, eventId: event.id, topic: event.topic }, 'Handler failed');
      }
    }
  }
}
