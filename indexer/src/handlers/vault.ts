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
      // The factory pulled `collateral` USDC out of the vault to fund
      // the new position, so the vault's USDC pool drops by exactly
      // that amount (the contract resyncs total_usdc from the
      // on-chain balance immediately after the proxy call). Mirror it
      // here so the marketplace + /trade leader balance line stay
      // truthful between trades.
      await db.execute({
        sql: `
          UPDATE vaults
          SET total_usdc = total_usdc - ?,
              updated_at = ?
          WHERE id = ?
        `,
        args: [event.collateral.toString(), Date.now(), event.vaultId],
      });
      return;
    case 'leader_close':
      // Close events don't carry the settled amount on-chain — PnL
      // depends on live oracle price. Until we wire an on-chain
      // `view_vault` resync the projection's total_usdc stays stale
      // after a close; deposits / withdrawals will re-anchor it.
      // For demo accuracy, prefer closing positions only when the UI
      // can tolerate one stale poll cycle.
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
    case 'leader_close':
      await db.execute({
        sql: `
          INSERT OR IGNORE INTO vault_trades
            (vault_id, position_id, action, leader, collateral, ledger, ts, tx_hash)
          VALUES (?, ?, 'close', ?, 0, ?, ?, ?)
        `,
        args: [
          event.vaultId,
          event.positionId.toString(),
          event.leader,
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
    await persistRaw(ctx.db, raw, v);
    await upsertVault(ctx.db, v);
    await logActivity(ctx.db, v);
    ctx.bus.emit('event', event);
    ctx.log.debug({ topic, vaultId: v.vaultId }, 'vault event processed');
  };
}
