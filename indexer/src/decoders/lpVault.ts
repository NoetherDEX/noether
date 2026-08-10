/**
 * Decoder for LP vault contract events (the USDC liquidity pool the
 * market settles against, contracts/vault). This is a different contract
 * from the vault factory: factory topics carry a vault id as the second
 * topic, while LP vault topics are plain symbols, except exposure_synced
 * which carries the asset symbol as its second topic.
 *
 * Field names mirror the publish sites in contracts/vault/src/lib.rs in
 * emission order. Decoding is positional: each payload value is bound to
 * the matching field name, and payload values beyond the known names are
 * kept under extraN keys so a contract upgrade that appends a field never
 * loses data.
 *
 * Returns null for topics the LP vault is not known to emit; the poller
 * treats null as skip, matching the other decoders.
 */

import type { rpc, xdr } from '@stellar/stellar-sdk';
import { decodeEventValue, decodeTopics } from './scval.js';

export type RawEvent = rpc.Api.EventResponse;

/**
 * Every topic the LP vault emits, mapped to its payload field names in
 * emission order. Sourced from contracts/vault/src/lib.rs publish sites.
 */
export const LP_VAULT_TOPIC_FIELDS: Record<string, readonly string[]> = {
  initialized: ['admin', 'market', 'usdcToken', 'noeToken'],
  deposit: ['depositor', 'usdcAmount', 'noeMinted', 'fee'],
  withdraw: ['withdrawer', 'noeBurned', 'usdcOut', 'fee'],
  payout_shortfall: ['trader', 'pnl', 'paid', 'shortfall'],
  pnl_settled: ['pnl'],
  loss_received: ['amount'],
  bounty_paid: ['keeper', 'amount', 'paid'],
  protocol_fee_routed: ['amount', 'toBuffer', 'overflow'],
  exposure_synced: ['assetUnrealizedPnl', 'totalUnrealizedPnl', 'release'],
  market_updated: ['oldMarket', 'newMarket'],
  deposit_fee_updated: ['feeBps'],
  withdraw_fee_updated: ['feeBps'],
  deposit_cap_set: ['cap'],
  withdraw_cooldown_set: ['seconds'],
  buffer_target_set: ['bps'],
  buffer_seeded: ['amount', 'toReserve'],
  buffer_funded: ['amount', 'toReserve'],
  shortfall_repaid: ['trader', 'paid', 'remaining'],
  buffer_drawn: ['amount', 'covered'],
  buffer_paid: ['to', 'amount', 'paid'],
  asset_cap_abs_set: ['asset', 'maxNotional'],
  skew_cap_set: ['asset', 'bps'],
  paused: [],
  unpaused: [],
  admin_updated: ['oldAdmin', 'newAdmin'],
  recovery_init: ['recipient'],
  recovery_proposed: ['amount', 'executeAfter'],
  recovery_executed: ['paid', 'recipient'],
  recovery_cancelled: [],
};

export const LP_VAULT_TOPICS: readonly string[] = Object.keys(LP_VAULT_TOPIC_FIELDS);

export interface LpVaultEvent {
  /** Soroban event id (unique, used as the deduplication key). */
  id: string;
  /** LP vault contract address that emitted the event. */
  contractId: string;
  /** Topic symbol, e.g. "deposit" or "buffer_drawn". */
  topic: string;
  ledger: number;
  ledgerCloseTs: number;
  txHash: string;
  /** Asset symbol from topic[1]. Only exposure_synced carries one. */
  asset?: string;
  /** Raw topic ScVals (base64 XDR), attached by the poller. */
  topicXdr?: string[];
  /** Raw value ScVal (base64 XDR), attached by the poller. */
  valueXdr?: string;
  /** Positionally decoded payload fields, named per LP_VAULT_TOPIC_FIELDS. */
  [field: string]: unknown;
}

export function decodeLpVaultEvent(raw: RawEvent): LpVaultEvent | null {
  const topics = decodeTopics(raw.topic as xdr.ScVal[]);
  const topic = topics[0];
  if (typeof topic !== 'string') return null;
  const names = LP_VAULT_TOPIC_FIELDS[topic];
  if (!names) return null;

  const values = decodeEventValue(raw.value as unknown as xdr.ScVal);
  const event: LpVaultEvent = {
    id: raw.id,
    contractId: raw.contractId?.toString() ?? '',
    topic,
    ledger: raw.ledger,
    ledgerCloseTs: Math.floor(new Date(raw.ledgerClosedAt).getTime() / 1000),
    txHash: raw.txHash,
  };
  if (topic === 'exposure_synced' && typeof topics[1] === 'string') {
    event.asset = topics[1];
  }
  names.forEach((name, i) => {
    event[name] = values[i];
  });
  // An empty Soroban payload decodes to a single null; skip nullish
  // extras so topics like paused stay clean while real appended fields
  // are still captured.
  for (let i = names.length; i < values.length; i++) {
    if (values[i] !== null && values[i] !== undefined) {
      event[`extra${i - names.length}`] = values[i];
    }
  }
  return event;
}
