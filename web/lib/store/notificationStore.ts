import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  AccountNotification,
  NotificationType,
  applyNotification,
} from '@/lib/notifications/core';

/**
 * L1-10 persistent account-event inbox (localStorage, FIFO cap 100).
 * push() returns true only when the entry was FRESH — callers toast on
 * true, so the store's dedupe is also the double-toast guard between the
 * poll-diff path and the future WS path.
 */

export interface PushInput {
  dedupeKey: string;
  type: NotificationType;
  title: string;
  body?: string;
  txHash?: string;
  ts?: number;
}

interface NotificationState {
  entries: AccountNotification[];
  push: (input: PushInput) => boolean;
  markAllRead: () => void;
  clear: () => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      entries: [],
      push: (input) => {
        const entry: AccountNotification = {
          id: input.dedupeKey,
          dedupeKey: input.dedupeKey,
          type: input.type,
          title: input.title,
          body: input.body,
          txHash: input.txHash,
          ts: input.ts ?? Date.now(),
          read: false,
        };
        const current = get().entries;
        const next = applyNotification(current, entry);
        if (next === current) return false;
        set({ entries: next as AccountNotification[] });
        return true;
      },
      markAllRead: () =>
        set({ entries: get().entries.map((e) => (e.read ? e : { ...e, read: true })) }),
      clear: () => set({ entries: [] }),
    }),
    {
      name: 'noether-notifications',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
