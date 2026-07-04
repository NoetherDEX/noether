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
import { syncVaultRow } from '../vaultSync.js';

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

async function persistRaw(db: Client, raw: RawShape, payload: object): Promise<boolean> {
  const result = await db.execute({
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
  return result.rowsAffected > 0;
}

async function upsertVault(
  db: Client,
  event: VaultEvent,
  ctx?: { rpc: HandlerContext['rpc']; log: HandlerContext['log']; contractId: string },
): Promise<void> {
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
    case 'deposit': {
      // Mirror the contract — only bump leader_shares when the
      // depositor *is* the leader. Without this branch every vault's
      // leader_shares projection stays at 0 even though the on-chain
      // 5% invariant has clearly been met, which made the marketplace
      // surface a misleading "Leader Holding 0% (violation)" banner.
      const leaderRow = await db.execute({
        sql: 'SELECT leader FROM vaults WHERE id = ?',
        args: [event.vaultId],
      });
      const leaderAddr = (leaderRow.rows[0] as { leader?: string } | undefined)?.leader;
      const isLeader = leaderAddr === event.depositor;
      await db.execute({
        sql: `
          UPDATE vaults
          SET total_usdc          = total_usdc + ?,
              circulating_shares  = circulating_shares + ?,
              leader_shares       = leader_shares + ?,
              updated_at          = ?
          WHERE id = ?
        `,
        args: [
          event.amount.toString(),
          event.shares.toString(),
          isLeader ? event.shares.toString() : '0',
          Date.now(),
          event.vaultId,
        ],
      });
      return;
    }
    case 'withdraw': {
      const leaderRow = await db.execute({
        sql: 'SELECT leader FROM vaults WHERE id = ?',
        args: [event.vaultId],
      });
      const leaderAddr = (leaderRow.rows[0] as { leader?: string } | undefined)?.leader;
      const isLeader = leaderAddr === event.depositor;
      await db.execute({
        sql: `
          UPDATE vaults
          SET total_usdc          = total_usdc - ?,
              circulating_shares  = circulating_shares - ?,
              leader_shares       = leader_shares - ?,
              updated_at          = ?
          WHERE id = ?
        `,
        args: [
          event.usdcOut.toString(),
          event.shares.toString(),
          isLeader ? event.shares.toString() : '0',
          Date.now(),
          event.vaultId,
        ],
      });
      return;
    }
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
    case 'leader_open':
    case 'leader_close': {
      // Re-read the canonical VaultInfo struct from the factory.
      // We can't rely on event payloads for leader trades:
      //  - leader_open carries `collateral` but doesn't reflect the
      //    fee deducted by the market.
      //  - leader_close carries no settled amount at all (PnL depends
      //    on live oracle price at settlement time).
      // The contract calls sync_total_usdc(...) before publishing
      // either event, so simulating view_vault gives us the truth.
      if (ctx) {
        const passphrase = process.env.NETWORK_PASSPHRASE
          ?? 'Test SDF Network ; September 2015';
        await syncVaultRow(db, ctx.rpc, ctx.contractId, event.vaultId, passphrase)
          .catch((err) => {
            ctx.log.warn(
              { vaultId: event.vaultId, err: (err as Error).message },
              'on-chain vault resync failed',
            );
          });
      }
      return;
    }
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
    case 'leader_open':
      await db.execute({
        sql: `
          INSERT OR IGNORE INTO vault_trades
            (vault_id, position_id, action, leader, collateral, ledger, ts, tx_hash)
          VALUES (?, ?, 'open', ?, ?, ?, ?, ?)
        `,
        args: [
          event.vaultId,
          event.positionId.toString(),
          event.leader,
          event.collateral.toString(),
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
        ],
      });
      return;
    case 'leader_close': {
      // The leader_close event itself carries no PnL — but the
      // market contract published a position_closed event in the
      // same transaction with the settled amount. Within a single
      // tx Soroban emits events in invocation order, so the
      // market's position_closed lands in events_raw before our
      // factory's leader_close handler runs.
      const closeLookup = await db.execute({
        sql: `
          SELECT json_extract(payload_json, '$.pnl') AS pnl
          FROM events_raw
          WHERE topic = 'position_closed'
            AND tx_hash = ?
            AND CAST(json_extract(payload_json, '$.positionId') AS INTEGER) = ?
          LIMIT 1
        `,
        args: [event.txHash, Number(event.positionId)],
      });
      const pnl = (closeLookup.rows[0]?.pnl as string | null | undefined) ?? null;

      await db.execute({
        sql: `
          INSERT OR IGNORE INTO vault_trades
            (vault_id, position_id, action, leader, collateral, pnl, ledger, ts, tx_hash)
          VALUES (?, ?, 'close', ?, 0, ?, ?, ?, ?)
        `,
        args: [
          event.vaultId,
          event.positionId.toString(),
          event.leader,
          pnl,
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
        ],
      });
      return;
    }
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
  'leader_open',
  'leader_close',
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
    const inserted = await persistRaw(ctx.db, raw, v);
    if (!inserted) {
      ctx.log.debug({ topic, vaultId: v.vaultId }, 'Duplicate vault event — projection and bus emit skipped');
      return;
    }
    await upsertVault(ctx.db, v, { rpc: ctx.rpc, log: ctx.log, contractId });
    await logActivity(ctx.db, v);
    ctx.bus.emit('event', event);
    ctx.log.debug({ topic, vaultId: v.vaultId }, 'vault event processed');
  };
}
