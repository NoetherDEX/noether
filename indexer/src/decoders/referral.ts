import type { rpc, xdr } from '@stellar/stellar-sdk';
import type {
  ReferralCodeCreatedEvent,
  ReferralEvent,
  ReferralReferrerSetEvent,
  ReferralTradeRecordedEvent,
  ReferralClaimedEvent,
} from '@noether/types';
import { decodeEventValue, decodeTopics, asBigInt, asString } from './scval.js';

export type RawEvent = rpc.Api.EventResponse;

const REFERRAL_TOPICS = new Set([
  'code_created',
  'referrer_set',
  'trade_recorded',
  'claimed',
]);

function envelope(raw: RawEvent, topic: string): {
  topic: string;
  ledger: number;
  ledgerCloseTs: number;
  txHash: string;
} {
  return {
    topic,
    ledger: raw.ledger,
    ledgerCloseTs: Math.floor(new Date(raw.ledgerClosedAt).getTime() / 1000),
    txHash: raw.txHash,
  };
}

export function decodeReferralEvent(raw: RawEvent): ReferralEvent | null {
  const topics = decodeTopics(raw.topic as xdr.ScVal[]);
  const topic = topics[0];
  if (typeof topic !== 'string' || !REFERRAL_TOPICS.has(topic)) return null;
  const value = decodeEventValue(raw.value as unknown as xdr.ScVal);

  switch (topic) {
    case 'code_created':
      return {
        ...envelope(raw, 'code_created'),
        topic: 'code_created',
        referrer: asString(value[0], 'code_created.referrer'),
        code: asString(value[1], 'code_created.code'),
      } satisfies ReferralCodeCreatedEvent;
    case 'referrer_set':
      return {
        ...envelope(raw, 'referrer_set'),
        topic: 'referrer_set',
        referee: asString(value[0], 'referrer_set.referee'),
        referrer: asString(value[1], 'referrer_set.referrer'),
        code: asString(value[2], 'referrer_set.code'),
      } satisfies ReferralReferrerSetEvent;
    case 'trade_recorded':
      return {
        ...envelope(raw, 'trade_recorded'),
        topic: 'trade_recorded',
        referee: asString(value[0], 'trade_recorded.referee'),
        referrer: asString(value[1], 'trade_recorded.referrer'),
        originalFee: asBigInt(value[2], 'trade_recorded.original_fee'),
        discount: asBigInt(value[3], 'trade_recorded.discount'),
        payout: asBigInt(value[4], 'trade_recorded.payout'),
      } satisfies ReferralTradeRecordedEvent;
    case 'claimed':
      return {
        ...envelope(raw, 'claimed'),
        topic: 'claimed',
        referrer: asString(value[0], 'claimed.referrer'),
        amount: asBigInt(value[1], 'claimed.amount'),
      } satisfies ReferralClaimedEvent;
    default:
      return null;
  }
}
