/**
 * Decoders for vault_factory contract events.
 *
 * Topic format is (event_symbol, vault_id_u32) — the second topic
 * carries the vault id so subscribers can filter cheaply without
 * deserialising the payload.
 *
 * Returns null for events whose first topic isn't a recognised vault
 * factory topic; the router treats null as "skip" (forward-compatible
 * with future topics).
 */

import type { rpc, xdr } from '@stellar/stellar-sdk';
import type {
  VaultCreatedEvent,
  VaultDepositEvent,
  VaultEvent,
  VaultEventEnvelope,
  VaultFeesClaimedEvent,
  VaultPausedEvent,
  VaultWithdrawEvent,
  VaultLeaderOpenEvent,
  VaultLeaderCloseEvent,
  VaultLeaderOrderEvent,
  VaultLeaderProtectiveEvent,
  VaultOrderReconciledEvent,
  VaultPositionReconciledEvent,
} from '@noether/types';
import { decodeEventValue, decodeTopics, asBigInt, asNumber, asString } from './scval.js';

export type RawEvent = rpc.Api.EventResponse;

const VAULT_TOPICS = new Set([
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
  'leader_limit',
  'leader_cancel',
  'leader_stop_limit',
  'leader_sl',
  'leader_tp',
  'leader_trail',
  'order_reconciled',
  'position_reconciled',
]);

function envelope(raw: RawEvent, topic: string, vaultId: number): VaultEventEnvelope & {
  id: string;
  contractId: string;
} {
  return {
    id: raw.id,
    contractId: raw.contractId?.toString() ?? '',
    topic,
    vaultId,
    ledger: raw.ledger,
    ledgerCloseTs: Math.floor(new Date(raw.ledgerClosedAt).getTime() / 1000),
    txHash: raw.txHash,
  };
}

export function decodeVaultEvent(raw: RawEvent): VaultEvent | null {
  const topics = decodeTopics(raw.topic as xdr.ScVal[]);
  const topic = topics[0];
  if (typeof topic !== 'string' || !VAULT_TOPICS.has(topic)) return null;
  const vaultId = asNumber(topics[1], 'vault topic[1] (vault_id)');
  const value = decodeEventValue(raw.value as unknown as xdr.ScVal);

  switch (topic) {
    case 'vault_created':
      return {
        ...envelope(raw, 'vault_created', vaultId),
        topic: 'vault_created',
        leader: asString(value[0], 'vault_created.leader'),
        name: asString(value[1], 'vault_created.name'),
      } satisfies VaultCreatedEvent;
    case 'deposit':
      return {
        ...envelope(raw, 'deposit', vaultId),
        topic: 'deposit',
        depositor: asString(value[0], 'vault.deposit.depositor'),
        amount: asBigInt(value[1], 'vault.deposit.amount'),
        shares: asBigInt(value[2], 'vault.deposit.shares'),
      } satisfies VaultDepositEvent;
    case 'withdraw':
      return {
        ...envelope(raw, 'withdraw', vaultId),
        topic: 'withdraw',
        depositor: asString(value[0], 'vault.withdraw.depositor'),
        shares: asBigInt(value[1], 'vault.withdraw.shares'),
        usdcOut: asBigInt(value[2], 'vault.withdraw.usdc_out'),
      } satisfies VaultWithdrawEvent;
    case 'fees_claimed':
      return {
        ...envelope(raw, 'fees_claimed', vaultId),
        topic: 'fees_claimed',
        leader: asString(value[0], 'vault.fees_claimed.leader'),
        owed: asBigInt(value[1], 'vault.fees_claimed.owed'),
        newNav: asBigInt(value[2], 'vault.fees_claimed.new_nav'),
      } satisfies VaultFeesClaimedEvent;
    case 'paused':
    case 'unpaused':
    case 'admin_paused':
    case 'admin_unpaused':
      return {
        ...envelope(raw, topic, vaultId),
        topic,
      } satisfies VaultPausedEvent;
    case 'leader_open':
      return {
        ...envelope(raw, 'leader_open', vaultId),
        topic: 'leader_open',
        leader: asString(value[0], 'vault.leader_open.leader'),
        positionId: asBigInt(value[1], 'vault.leader_open.position_id'),
        collateral: asBigInt(value[2], 'vault.leader_open.collateral'),
      } satisfies VaultLeaderOpenEvent;
    case 'leader_close':
      return {
        ...envelope(raw, 'leader_close', vaultId),
        topic: 'leader_close',
        leader: asString(value[0], 'vault.leader_close.leader'),
        positionId: asBigInt(value[1], 'vault.leader_close.position_id'),
      } satisfies VaultLeaderCloseEvent;
    case 'leader_limit':
    case 'leader_cancel':
    case 'leader_stop_limit':
      return {
        ...envelope(raw, topic, vaultId),
        topic,
        leader: asString(value[0], `vault.${topic}.leader`),
        orderId: asBigInt(value[1], `vault.${topic}.order_id`),
      } satisfies VaultLeaderOrderEvent;
    case 'leader_sl':
    case 'leader_tp':
    case 'leader_trail':
      return {
        ...envelope(raw, topic, vaultId),
        topic,
        leader: asString(value[0], `vault.${topic}.leader`),
        orderId: asBigInt(value[1], `vault.${topic}.order_id`),
        positionId: asBigInt(value[2], `vault.${topic}.position_id`),
      } satisfies VaultLeaderProtectiveEvent;
    case 'order_reconciled':
      return {
        ...envelope(raw, 'order_reconciled', vaultId),
        topic: 'order_reconciled',
        orderId: asBigInt(value[0], 'vault.order_reconciled.order_id'),
        positionId: asBigInt(value[1], 'vault.order_reconciled.position_id'),
        credited: asBigInt(value[2], 'vault.order_reconciled.credited'),
      } satisfies VaultOrderReconciledEvent;
    case 'position_reconciled':
      return {
        ...envelope(raw, 'position_reconciled', vaultId),
        topic: 'position_reconciled',
        positionId: asBigInt(value[0], 'vault.position_reconciled.position_id'),
        proceeds: asBigInt(value[1], 'vault.position_reconciled.proceeds'),
      } satisfies VaultPositionReconciledEvent;
    default:
      return null;
  }
}
