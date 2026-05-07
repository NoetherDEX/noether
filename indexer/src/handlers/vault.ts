/**
 * Indexer handler for vault_factory events.
 *
 * Persists three things on every event:
 *   1. The decoded payload to events_raw (firehose; same as market).
 *   2. A row into the per-event log table (vault_deposits, etc.).
 *   3. An UPSERT into the `vaults` projection — the marketplace UI
 *      reads from this.
 *
 * Handlers register against the vault_factory contract address via
 * `buildVaultRegistrations(...)` in the same way as market handlers,
 * so the router treats them identically.
 */

import type { Client } from '@libsql/client';
import type { VaultEvent } from '@noether/types';
import type { Handler, HandlerContext } from '../router.js';
import type { DecodedMarketEvent } from '../types/events.js';

type AnyEvent = DecodedMarketEvent;

interface RawShape {
  id: string;
  contractId: string;
  topic: string;
  ledger: number;
  ledgerCloseTs: number;
  txHash: string;
}

function envelopeFor(event: VaultEvent, fallbackId: string, contractId: string): RawShape {
  return {
    id: fallbackId,
    contractId,
    topic: event.topic,
    ledger: event.ledger,
    ledgerCloseTs: event.ledgerCloseTs,
    txHash: event.txHash,
  };
}

async function persistRaw(db: Client, raw: RawShape, payload: object): Promise<void> {
  await db.execute({
    sql: `
      INSERT OR IGNORE INTO events_raw (
        event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, inserted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      raw.id,
      raw.contractId,
      raw.topic,
      raw.ledger,
      raw.ledgerCloseTs,
      raw.txHash,
      JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      Date.now(),
    ],
  });
}

async function upsertVault(db: Client, event: VaultEvent): Promise<void> {
  switch (event.topic) {
    case 'vault_created':
      await db.execute({
        sql: `
          INSERT OR REPLACE INTO vaults (
            id, leader, name, created_at, total_usdc, circulating_shares,
            hwm_nav, realized_pnl, leader_shares, profit_share_bps, paused, updated_at
          ) VALUES (?, ?, ?, ?, 0, 0, 10000000, 0, 0, 1000, 0, ?)
        `,
        args: [event.vaultId, event.leader, event.name, event.ledgerCloseTs, Date.now()],
      });
      return;
    case 'deposit':
      await db.execute({
        sql: `
          UPDATE vaults
          SET total_usdc = total_usdc + ?,
              circulating_shares = circulating_shares + ?,
              updated_at = ?
          WHERE id = ?
        `,
        args: [event.amount.toString(), event.shares.toString(), Date.now(), event.vaultId],
      });
      return;
    case 'withdraw':
      await db.execute({
        sql: `
          UPDATE vaults
          SET total_usdc = total_usdc - ?,
              circulating_shares = circulating_shares - ?,
              updated_at = ?
          WHERE id = ?
        `,
        args: [event.usdcOut.toString(), event.shares.toString(), Date.now(), event.vaultId],
      });
      return;
    case 'fees_claimed':
      await db.execute({
        sql: `
          UPDATE vaults
          SET total_usdc = total_usdc - ?,
              realized_pnl = realized_pnl + ?,
              hwm_nav = ?,
              updated_at = ?
          WHERE id = ?
        `,
        args: [
          event.owed.toString(),
          event.owed.toString(),
          event.newNav.toString(),
          Date.now(),
          event.vaultId,
        ],
      });
      return;
    case 'paused':
    case 'admin_paused':
      await db.execute({
        sql: 'UPDATE vaults SET paused = 1, updated_at = ? WHERE id = ?',
        args: [Date.now(), event.vaultId],
      });
      return;
    case 'unpaused':
    case 'admin_unpaused':
      await db.execute({
        sql: 'UPDATE vaults SET paused = 0, updated_at = ? WHERE id = ?',
        args: [Date.now(), event.vaultId],
      });
      return;
  }
}

async function logActivity(db: Client, event: VaultEvent): Promise<void> {
  switch (event.topic) {
    case 'deposit':
      await db.execute({
        sql: `
          INSERT INTO vault_deposits (vault_id, depositor, amount, shares, ledger, ts, tx_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          event.vaultId,
          event.depositor,
          event.amount.toString(),
          event.shares.toString(),
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
        ],
      });
      return;
    case 'withdraw':
      await db.execute({
        sql: `
          INSERT INTO vault_withdraws (vault_id, depositor, shares, usdc_out, ledger, ts, tx_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          event.vaultId,
          event.depositor,
          event.shares.toString(),
          event.usdcOut.toString(),
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
        ],
      });
      return;
    case 'fees_claimed':
      await db.execute({
        sql: `
          INSERT INTO vault_fee_claims (vault_id, leader, amount, new_nav, ledger, ts, tx_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          event.vaultId,
          event.leader,
          event.owed.toString(),
          event.newNav.toString(),
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
        ],
      });
      return;
    default:
      return;
  }
}

export interface VaultHandlerRegistration {
  contractId: string;
  topic: VaultEvent['topic'];
  handler: Handler;
}

const VAULT_TOPICS: VaultEvent['topic'][] = [
  'vault_created',
  'deposit',
  'withdraw',
  'fees_claimed',
  'paused',
  'unpaused',
  'admin_paused',
  'admin_unpaused',
];

export function buildVaultRegistrations(
  vaultFactoryContractId: string,
): VaultHandlerRegistration[] {
  return VAULT_TOPICS.map((topic) => ({
    contractId: vaultFactoryContractId,
    topic: topic as never,
    handler: makeHandler(topic, vaultFactoryContractId),
  }));
}

function makeHandler(topic: VaultEvent['topic'], contractId: string): Handler {
  return async (event: AnyEvent, ctx: HandlerContext) => {
    // The router types decoded events as DecodedMarketEvent (the union we
    // wired the dispatcher with). When this handler fires the event has
    // already been routed by topic match — but to access vault-specific
    // fields we re-cast through a structural check.
    const v = event as unknown as VaultEvent;
    if (v.topic !== topic) return;
    const raw = envelopeFor(v, (event as unknown as { id: string }).id, contractId);
    await persistRaw(ctx.db, raw, v);
    await upsertVault(ctx.db, v);
    await logActivity(ctx.db, v);
    ctx.bus.emit('event', event);
    ctx.log.debug({ topic, vaultId: v.vaultId }, 'vault event processed');
  };
}
