/**
 * L1-10 notification core — pure, unit-tested (no React, no storage).
 * The store and BOTH producer paths (poll-diff today, gateway WS later)
 * funnel through applyNotification, so a fill observed twice can never
 * toast or list twice: dedupeKey is the identity.
 */

export type NotificationType =
  | 'fill'
  | 'cancel'
  | 'slippage_cancel'
  | 'liquidation'
  | 'partial_liquidation'
  | 'cross_liquidation'
  | 'margin_call'
  | 'adl';

export interface AccountNotification {
  id: string;
  /** Identity for dedupe — stable across producer paths (e.g. order id + status). */
  dedupeKey: string;
  type: NotificationType;
  title: string;
  body?: string;
  txHash?: string;
  ts: number;
  read: boolean;
}

export const NOTIFICATION_CAP = 100;

/**
 * Pure insert: rejects duplicates by dedupeKey (returns the SAME array so
 * stores can skip the update), prepends newest-first, evicts past the cap.
 */
export function applyNotification(
  entries: readonly AccountNotification[],
  entry: AccountNotification,
  cap: number = NOTIFICATION_CAP,
): readonly AccountNotification[] {
  if (entries.some((existing) => existing.dedupeKey === entry.dedupeKey)) return entries;
  return [entry, ...entries].slice(0, cap);
}

export function unreadCount(entries: readonly AccountNotification[]): number {
  return entries.reduce((count, entry) => (entry.read ? count : count + 1), 0);
}
