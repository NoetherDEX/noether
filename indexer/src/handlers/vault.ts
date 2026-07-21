/**
 * Indexer handler for vault_factory events.
 *
 * Persists three things on every event:
 *   1. The decoded payload to events_raw (firehose; same as market).
 *   2. A row into the per-event log table (vault_deposits, etc.).
 *   3. An UPSERT into the `vaults` projection — the marketplace UI
 *      reads from this.
 *
 * All three run inside one libsql transaction so a mid-event crash
 * can never half-apply (I-2). The on-chain resync after leader trades
 * is RPC-driven and runs after commit.
 *
 * Handlers register against the vault_factory contract address via
 * `buildVaultRegistrations(...)` in the same way as market handlers,
 * so the router treats them identically.
 */

import type { Db, DbTransaction } from '@noether/db';
import type { VaultEvent } from '@noether/types';
import type { Handler, HandlerContext } from '../router.js';
import type { DecodedMarketEvent } from '../types/events.js';
import { syncVaultRow } from '../vaultSync.js';

type AnyEvent = DecodedMarketEvent;
type DbConn = Db | DbTransaction;

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

async function persistRaw(db: DbConn, raw: RawShape, event: VaultEvent): Promise<boolean> {
  const { topicXdr, valueXdr, ...payload } =
    event as VaultEvent & { topicXdr?: string[]; valueXdr?: string };
  const result = await db.execute({
    sql: `
      INSERT INTO events_raw (
        event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, topic_xdr, value_xdr, inserted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (event_id) DO NOTHING
    `,
    args: [
      raw.id,
      raw.contractId,
      raw.topic,
      raw.ledger,
      raw.ledgerCloseTs,
      raw.txHash,
      JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      topicXdr ? JSON.stringify(topicXdr) : null,
      valueXdr ?? null,
      Date.now(),
    ],
  });
  return result.rowsAffected > 0;
}

async function upsertVault(db: DbConn, event: VaultEvent, contractId: string): Promise<void> {
  switch (event.topic) {
    case 'vault_created':
      await db.execute({
        sql: `
          INSERT INTO vaults (
            id, leader, name, created_at, total_usdc, circulating_shares,
            hwm_nav, realized_pnl, leader_shares, profit_share_bps, paused, contract_id, updated_at
          ) VALUES (?, ?, ?, ?, 0, 0, 10000000, 0, 0, 1000, 0, ?, ?)
          ON CONFLICT (id) DO UPDATE SET
            leader = EXCLUDED.leader,
            name = EXCLUDED.name,
            created_at = EXCLUDED.created_at,
            total_usdc = EXCLUDED.total_usdc,
            circulating_shares = EXCLUDED.circulating_shares,
            hwm_nav = EXCLUDED.hwm_nav,
            realized_pnl = EXCLUDED.realized_pnl,
            leader_shares = EXCLUDED.leader_shares,
            profit_share_bps = EXCLUDED.profit_share_bps,
            paused = EXCLUDED.paused,
            contract_id = EXCLUDED.contract_id,
            updated_at = EXCLUDED.updated_at
        `,
        args: [event.vaultId, event.leader, event.name, event.ledgerCloseTs, contractId, Date.now()],
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
    case 'leader_close':
    case 'order_reconciled':
    case 'position_reconciled':
      // Handled after commit: the truthful numbers come from an
      // on-chain view_vault simulation (see makeHandler), which must
      // not run inside the write transaction. Reconciles change
      // total_usdc on-chain the same way leader trades do.
      return;
    case 'leader_limit':
    case 'leader_cancel':
    case 'leader_stop_limit':
    case 'leader_sl':
    case 'leader_tp':
    case 'leader_trail':
      // Archive-only: order placement moves no vault cash the projection
      // tracks (prefunded collateral is reconciled via order_reconciled).
      return;
  }
}

async function logActivity(db: DbConn, event: VaultEvent, eventId: string, contractId: string): Promise<void> {
  switch (event.topic) {
    case 'deposit':
      await db.execute({
        sql: `
          INSERT INTO vault_deposits (vault_id, depositor, amount, shares, ledger, ts, tx_hash, event_id, contract_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (event_id) DO NOTHING
        `,
        args: [
          event.vaultId,
          event.depositor,
          event.amount.toString(),
          event.shares.toString(),
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
          eventId,
          contractId,
        ],
      });
      return;
    case 'withdraw':
      await db.execute({
        sql: `
          INSERT INTO vault_withdraws (vault_id, depositor, shares, usdc_out, ledger, ts, tx_hash, event_id, contract_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (event_id) DO NOTHING
        `,
        args: [
          event.vaultId,
          event.depositor,
          event.shares.toString(),
          event.usdcOut.toString(),
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
          eventId,
          contractId,
        ],
      });
      return;
    case 'fees_claimed':
      await db.execute({
        sql: `
          INSERT INTO vault_fee_claims (vault_id, leader, amount, new_nav, ledger, ts, tx_hash, event_id, contract_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (event_id) DO NOTHING
        `,
        args: [
          event.vaultId,
          event.leader,
          event.owed.toString(),
          event.newNav.toString(),
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
          eventId,
          contractId,
        ],
      });
      return;
    case 'leader_open':
      await db.execute({
        sql: `
          INSERT INTO vault_trades
            (vault_id, position_id, action, leader, collateral, ledger, ts, tx_hash, contract_id)
          VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?)
          ON CONFLICT (vault_id, position_id, action, tx_hash) DO NOTHING
        `,
        args: [
          event.vaultId,
          event.positionId.toString(),
          event.leader,
          event.collateral.toString(),
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
          contractId,
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
          SELECT payload_json ->> 'pnl' AS pnl
          FROM events_raw
          WHERE topic = 'position_closed'
            AND tx_hash = ?
            AND (payload_json ->> 'positionId')::bigint = ?
          LIMIT 1
        `,
        args: [event.txHash, Number(event.positionId)],
      });
      const pnl = (closeLookup.rows[0]?.pnl as string | null | undefined) ?? null;

      await db.execute({
        sql: `
          INSERT INTO vault_trades
            (vault_id, position_id, action, leader, collateral, pnl, ledger, ts, tx_hash, contract_id)
          VALUES (?, ?, 'close', ?, '0', ?, ?, ?, ?, ?)
          ON CONFLICT (vault_id, position_id, action, tx_hash) DO NOTHING
        `,
        args: [
          event.vaultId,
          event.positionId.toString(),
          event.leader,
          pnl,
          event.ledger,
          event.ledgerCloseTs,
          event.txHash,
          contractId,
        ],
      });
      return;
    }
    default:
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
  // Batch-1 (L0-20/L1-30) — inert until the redeployed factory emits them.
  'leader_limit',
  'leader_cancel',
  'leader_stop_limit',
  'leader_sl',
  'leader_tp',
  'leader_trail',
  'order_reconciled',
  'position_reconciled',
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
    const eventId = (event as unknown as { id: string }).id;
    const raw = envelopeFor(v, eventId, contractId);

    const tx = await ctx.db.transaction('write');
    try {
      const inserted = await persistRaw(tx, raw, v);
      if (!inserted && !ctx.replay) {
        await rollbackQuietly(tx);
        ctx.log.debug({ topic, vaultId: v.vaultId }, 'Duplicate vault event — projection and bus emit skipped');
        return;
      }
      await upsertVault(tx, v, contractId);
      await logActivity(tx, v, eventId, contractId);
      await tx.commit();
    } catch (err) {
      await rollbackQuietly(tx);
      // Keep the archive row so the retry pass hits the idempotency
      // guard and the cursor can advance past the dead-lettered event.
      await persistRaw(ctx.db, raw, v).catch(() => {});
      throw err;
    }

    if (
      v.topic === 'leader_open' ||
      v.topic === 'leader_close' ||
      v.topic === 'order_reconciled' ||
      v.topic === 'position_reconciled'
    ) {
      // Re-read the canonical VaultInfo struct from the factory.
      // We can't rely on event payloads for leader trades:
      //  - leader_open carries `collateral` but doesn't reflect the
      //    fee deducted by the market.
      //  - leader_close carries no settled amount at all (PnL depends
      //    on live oracle price at settlement time).
      // The contract calls sync_total_usdc(...) before publishing
      // either event, so simulating view_vault gives us the truth.
      const passphrase = process.env.NETWORK_PASSPHRASE
        ?? 'Test SDF Network ; September 2015';
      await syncVaultRow(ctx.db, ctx.rpc, contractId, v.vaultId, passphrase)
        .catch((err) => {
          ctx.log.warn(
            { vaultId: v.vaultId, err: (err as Error).message },
            'on-chain vault resync failed',
          );
        });
    }

    if (!ctx.replay) ctx.bus.emit('event', event);
    ctx.log.debug({ topic, vaultId: v.vaultId }, 'vault event processed');
  };
}
