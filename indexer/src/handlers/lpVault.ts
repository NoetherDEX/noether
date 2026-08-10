/**
 * Indexer handler for LP vault contract events.
 *
 * Every recognised event is archived to events_raw inside one write
 * transaction, exactly like the market and factory handlers, so the
 * duplicate guard and the reindex replay behave the same way. The high
 * value money flows (deposit, withdraw, pnl_settled and the four buffer
 * moves) also get typed projection rows keyed on the Soroban event id
 * with ON CONFLICT DO NOTHING. Every other topic is captured generically
 * by the events_raw archive, which already stores contract id, topic,
 * ledger, event id, close timestamp, transaction hash and the decoded
 * payload as JSONB, so no separate generic table is needed.
 */

import type { Db, DbTransaction } from '@noether/db';
import type { Handler, HandlerContext } from '../router.js';
import type { DecodedMarketEvent } from '../types/events.js';
import { LP_VAULT_TOPICS, type LpVaultEvent } from '../decoders/lpVault.js';

type DbConn = Db | DbTransaction;

const ENVELOPE_KEYS = new Set([
  'id',
  'contractId',
  'topic',
  'ledger',
  'ledgerCloseTs',
  'txHash',
  'topicXdr',
  'valueXdr',
]);

function serialisePayload(event: LpVaultEvent): string {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event)) {
    if (!ENVELOPE_KEYS.has(k)) rest[k] = v;
  }
  return JSON.stringify(rest, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/**
 * Money and id fields arrive as bigint from the live decoder and as
 * strings on a reindex replay (payload_json stores bigints as strings),
 * so accept both and store text, like the other handlers.
 */
function text(v: unknown, label: string): string {
  if (typeof v === 'bigint' || typeof v === 'number' || typeof v === 'string') return String(v);
  throw new Error(`Expected a numeric or string value for ${label}, got ${typeof v}`);
}

function addr(v: unknown, label: string): string {
  if (typeof v === 'string' && v.length > 0) return v;
  throw new Error(`Expected an address string for ${label}, got ${typeof v}`);
}

async function persistRaw(db: DbConn, event: LpVaultEvent): Promise<boolean> {
  const result = await db.execute({
    sql: `
      INSERT INTO events_raw (
        event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, topic_xdr, value_xdr, inserted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (event_id) DO NOTHING
    `,
    args: [
      event.id,
      event.contractId,
      event.topic,
      event.ledger,
      event.ledgerCloseTs,
      event.txHash,
      serialisePayload(event),
      event.topicXdr ? JSON.stringify(event.topicXdr) : null,
      event.valueXdr ?? null,
      Date.now(),
    ],
  });
  return result.rowsAffected > 0;
}

async function logTyped(db: DbConn, event: LpVaultEvent): Promise<void> {
  switch (event.topic) {
    case 'deposit':
      await db.execute({
        sql: `
          INSERT INTO lp_vault_deposits (event_id, depositor, usdc_amount, noe_minted, fee, ledger, ts, tx_hash, contract_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (event_id) DO NOTHING
        `,
        args: [
          event.id,
          addr(event.depositor, 'lp_vault.deposit.depositor'),
          text(event.usdcAmount, 'lp_vault.deposit.usdcAmount'),
          text(event.noeMinted, 'lp_vault.deposit.noeMinted'),
          text(event.fee, 'lp_vault.deposit.fee'),
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
          event.contractId,
        ],
      });
      return;
    case 'withdraw':
      await db.execute({
        sql: `
          INSERT INTO lp_vault_withdraws (event_id, withdrawer, noe_burned, usdc_out, fee, ledger, ts, tx_hash, contract_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (event_id) DO NOTHING
        `,
        args: [
          event.id,
          addr(event.withdrawer, 'lp_vault.withdraw.withdrawer'),
          text(event.noeBurned, 'lp_vault.withdraw.noeBurned'),
          text(event.usdcOut, 'lp_vault.withdraw.usdcOut'),
          text(event.fee, 'lp_vault.withdraw.fee'),
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
          event.contractId,
        ],
      });
      return;
    case 'pnl_settled':
      await db.execute({
        sql: `
          INSERT INTO lp_vault_pnl_settlements (event_id, pnl, ledger, ts, tx_hash, contract_id)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (event_id) DO NOTHING
        `,
        args: [
          event.id,
          text(event.pnl, 'lp_vault.pnl_settled.pnl'),
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
          event.contractId,
        ],
      });
      return;
    case 'buffer_seeded':
    case 'buffer_funded':
    case 'buffer_drawn':
    case 'buffer_paid': {
      // secondary_amount per kind: the slice routed to the shortfall
      // reserve for seeds and funds, the amount actually covered for
      // draws, the amount actually paid for pays. counterparty is the
      // recipient on buffer_paid and NULL otherwise.
      const secondary =
        event.topic === 'buffer_drawn'
          ? text(event.covered, `lp_vault.${event.topic}.covered`)
          : event.topic === 'buffer_paid'
            ? text(event.paid, `lp_vault.${event.topic}.paid`)
            : text(event.toReserve, `lp_vault.${event.topic}.toReserve`);
      const counterparty =
        event.topic === 'buffer_paid' ? addr(event.to, 'lp_vault.buffer_paid.to') : null;
      await db.execute({
        sql: `
          INSERT INTO lp_vault_buffer_flows (event_id, kind, amount, secondary_amount, counterparty, ledger, ts, tx_hash, contract_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (event_id) DO NOTHING
        `,
        args: [
          event.id,
          event.topic,
          text(event.amount, `lp_vault.${event.topic}.amount`),
          secondary,
          counterparty,
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
          event.contractId,
        ],
      });
      return;
    }
    default:
      // Archive only: the events_raw row written above is the generic
      // capture for every remaining topic.
      return;
  }
}

async function rollbackQuietly(tx: DbTransaction): Promise<void> {
  try {
    await tx.rollback();
  } catch {
    /* transaction already closed */
  }
}

export interface LpVaultHandlerRegistration {
  contractId: string;
  topic: string;
  handler: Handler;
}

export function buildLpVaultRegistrations(lpVaultContractId: string): LpVaultHandlerRegistration[] {
  return LP_VAULT_TOPICS.map((topic) => ({
    contractId: lpVaultContractId,
    topic,
    handler: makeHandler(topic),
  }));
}

function makeHandler(topic: string): Handler {
  return async (event: DecodedMarketEvent, ctx: HandlerContext) => {
    // The router types decoded events as DecodedMarketEvent (the union
    // the dispatcher was wired with). By the time this handler fires the
    // event was already routed by contract id and topic, so recast to
    // the LP vault shape, same as the factory handler does.
    const v = event as unknown as LpVaultEvent;
    if (v.topic !== topic) return;

    const tx = await ctx.db.transaction('write');
    try {
      const inserted = await persistRaw(tx, v);
      if (!inserted && !ctx.replay) {
        await rollbackQuietly(tx);
        ctx.log.debug({ topic, eventId: v.id }, 'Duplicate LP vault event, projection and bus emit skipped');
        return;
      }
      await logTyped(tx, v);
      await tx.commit();
    } catch (err) {
      await rollbackQuietly(tx);
      // Keep the archive row so the retry pass hits the idempotency
      // guard and the cursor can advance past the dead lettered event.
      await persistRaw(ctx.db, v).catch(() => {});
      throw err;
    }

    if (!ctx.replay) ctx.bus.emit('event', event);
    ctx.log.debug({ topic, eventId: v.id, ledger: v.ledger }, 'LP vault event processed');
  };
}
