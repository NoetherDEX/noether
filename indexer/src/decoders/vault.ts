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
]);

function envelope(raw: RawEvent, topic: string, vaultId: number): VaultEventEnvelope {
  return {
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
    default:
      return null;
  }
}
