import type { Db, DbTransaction } from '@noether/db';
import type { ReferralEvent } from '@noether/types';
import type { Handler, HandlerContext } from '../router.js';
import type { DecodedMarketEvent } from '../types/events.js';

type DbConn = Db | DbTransaction;

async function persistRaw(
  db: DbConn,
  contractId: string,
  eventId: string,
  event: ReferralEvent,
): Promise<boolean> {
  const { topicXdr, valueXdr, ...payload } =
    event as ReferralEvent & { topicXdr?: string[]; valueXdr?: string };
  const result = await db.execute({
    sql: `
      INSERT INTO events_raw (
        event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, topic_xdr, value_xdr, inserted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (event_id) DO NOTHING
    `,
    args: [
      eventId,
      contractId,
      event.topic,
      event.ledger,
      event.ledgerCloseTs,
      event.txHash,
      JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      topicXdr ? JSON.stringify(topicXdr) : null,
      valueXdr ?? null,
      Date.now(),
    ],
  });
  return result.rowsAffected > 0;
}

async function applyEvent(
  db: DbConn,
  event: ReferralEvent,
  eventId: string,
  contractId: string,
): Promise<void> {
  switch (event.topic) {
    case 'code_created':
      await db.execute({
        sql: `
          INSERT INTO referrers (
            referrer, code, created_at,
            referred_count, total_volume_generated, total_earned, claimable, contract_id, updated_at
          ) VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?)
          ON CONFLICT(referrer) DO UPDATE SET
            code = excluded.code,
            contract_id = excluded.contract_id,
            updated_at = excluded.updated_at
        `,
        args: [event.referrer, event.code, event.ledgerCloseTs, contractId, Date.now()],
      });
      return;
    case 'referrer_set': {
      const bound = await db.execute({
        sql: `
          INSERT INTO referral_bindings (referee, referrer, code, bound_at, tx_hash, contract_id)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (referee) DO NOTHING
        `,
        args: [event.referee, event.referrer, event.code, event.ledgerCloseTs, event.txHash, contractId],
      });
      if (bound.rowsAffected === 0) return;
      await db.execute({
        sql: `
          UPDATE referrers
          SET referred_count = referred_count + 1, updated_at = ?
          WHERE referrer = ?
        `,
        args: [Date.now(), event.referrer],
      });
      return;
    }
    case 'trade_recorded': {
      const inserted = await db.execute({
        sql: `
          INSERT INTO referral_trades (referee, referrer, original_fee, discount, payout, volume, ledger, ts, tx_hash, event_id, contract_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (event_id) DO NOTHING
        `,
        args: [
          event.referee,
          event.referrer,
          event.originalFee.toString(),
          event.discount.toString(),
          event.payout.toString(),
          event.volume == null ? null : event.volume.toString(),
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
          eventId,
          contractId,
        ],
      });
      if (inserted.rowsAffected === 0) return;
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
    }
    case 'claimed': {
      const inserted = await db.execute({
        sql: `
          INSERT INTO referral_claims (referrer, amount, ledger, ts, tx_hash, event_id, contract_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (event_id) DO NOTHING
        `,
        args: [
          event.referrer,
          event.amount.toString(),
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
          eventId,
          contractId,
        ],
      });
      if (inserted.rowsAffected === 0) return;
      await db.execute({
        sql: `UPDATE referrers SET claimable = 0, updated_at = ? WHERE referrer = ?`,
        args: [Date.now(), event.referrer],
      });
      return;
    }
  }
}

async function rollbackQuietly(tx: DbTransaction): Promise<void> {
  try {
    await tx.rollback();
  } catch {
    /* transaction already closed */
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

    const tx = await ctx.db.transaction('write');
    try {
      const inserted = await persistRaw(tx, contractId, eventId, r);
      if (!inserted && !ctx.replay) {
        await rollbackQuietly(tx);
        ctx.log.debug({ topic, eventId }, 'Duplicate referral event — projection and bus emit skipped');
        return;
      }
      await applyEvent(tx, r, eventId, contractId);
      await tx.commit();
    } catch (err) {
      await rollbackQuietly(tx);
      // Keep the archive row so the retry pass hits the idempotency
      // guard and the cursor can advance past the dead-lettered event.
      await persistRaw(ctx.db, contractId, eventId, r).catch(() => {});
      throw err;
    }

    if (!ctx.replay) ctx.bus.emit('event', event);
    ctx.log.debug({ topic, contractId }, 'referral event processed');
  };
}
