import type { Client } from '@libsql/client';
import type { ReferralEvent } from '@noether/types';
import type { Handler, HandlerContext } from '../router.js';
import type { DecodedMarketEvent } from '../types/events.js';

async function persistRaw(
  db: Client,
  contractId: string,
  eventId: string,
  event: ReferralEvent,
): Promise<boolean> {
  const result = await db.execute({
    sql: `
      INSERT OR IGNORE INTO events_raw (
        event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, inserted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      eventId,
      contractId,
      event.topic,
      event.ledger,
      event.ledgerCloseTs,
      event.txHash,
      JSON.stringify(event, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      Date.now(),
    ],
  });
  return result.rowsAffected > 0;
}

async function applyEvent(db: Client, event: ReferralEvent): Promise<void> {
  switch (event.topic) {
    case 'code_created':
      await db.execute({
        sql: `
          INSERT INTO referrers (
            referrer, code, created_at,
            referred_count, total_volume_generated, total_earned, claimable, updated_at
          ) VALUES (?, ?, ?, 0, 0, 0, 0, ?)
          ON CONFLICT(referrer) DO UPDATE SET
            code = excluded.code,
            updated_at = excluded.updated_at
        `,
        args: [event.referrer, event.code, event.ledgerCloseTs, Date.now()],
      });
      return;
    case 'referrer_set':
      await db.execute({
        sql: `
          INSERT OR IGNORE INTO referral_bindings (referee, referrer, code, bound_at, tx_hash)
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [event.referee, event.referrer, event.code, event.ledgerCloseTs, event.txHash],
      });
      await db.execute({
        sql: `
          UPDATE referrers
          SET referred_count = referred_count + 1, updated_at = ?
          WHERE referrer = ?
        `,
        args: [Date.now(), event.referrer],
      });
      return;
    case 'trade_recorded':
      await db.execute({
        sql: `
          INSERT INTO referral_trades (referee, referrer, original_fee, discount, payout, ledger, ts, tx_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          event.referee,
          event.referrer,
          event.originalFee.toString(),
          event.discount.toString(),
          event.payout.toString(),
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
        ],
      });
      await db.execute({
        sql: `
          UPDATE referrers
          SET total_volume_generated = total_volume_generated + ?,
              total_earned = total_earned + ?,
              claimable = claimable + ?,
              updated_at = ?
          WHERE referrer = ?
        `,
        args: [
          event.originalFee.toString(),
          event.payout.toString(),
          event.payout.toString(),
          Date.now(),
          event.referrer,
        ],
      });
      return;
    case 'claimed':
      await db.execute({
        sql: `
          INSERT INTO referral_claims (referrer, amount, ledger, ts, tx_hash)
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [
          event.referrer,
          event.amount.toString(),
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
        ],
      });
      await db.execute({
        sql: `UPDATE referrers SET claimable = 0, updated_at = ? WHERE referrer = ?`,
        args: [Date.now(), event.referrer],
      });
      return;
  }
}

export interface ReferralHandlerRegistration {
  contractId: string;
  topic: ReferralEvent['topic'];
  handler: Handler;
}

const REFERRAL_TOPICS: ReferralEvent['topic'][] = [
  'code_created',
  'referrer_set',
  'trade_recorded',
  'claimed',
];

export function buildReferralRegistrations(
  referralContractId: string,
): ReferralHandlerRegistration[] {
  return REFERRAL_TOPICS.map((topic) => ({
    contractId: referralContractId,
    topic: topic as never,
    handler: makeHandler(topic, referralContractId),
  }));
}

function makeHandler(topic: ReferralEvent['topic'], contractId: string): Handler {
  return async (event: DecodedMarketEvent, ctx: HandlerContext) => {
    const r = event as unknown as ReferralEvent;
    if (r.topic !== topic) return;
    const eventId = (event as unknown as { id: string }).id;
    const inserted = await persistRaw(ctx.db, contractId, eventId, r);
    if (!inserted) {
      ctx.log.debug({ topic, eventId }, 'Duplicate referral event — projection and bus emit skipped');
      return;
    }
    await applyEvent(ctx.db, r);
    ctx.bus.emit('event', event);
    ctx.log.debug({ topic, contractId }, 'referral event processed');
  };
}
