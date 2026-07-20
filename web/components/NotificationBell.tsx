'use client';

/**
 * L1-10 account-event inbox: floating bell + unread badge on every page,
 * backed by the persisted notification store (poll-diff toasts feed it
 * today; the gateway-WS path will reuse the same store + dedupe). The
 * persistent record is the point — a liquidation that happened while the
 * tab was on another page is still here.
 */

import { useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useNotificationStore } from '@/lib/store/notificationStore';
import { unreadCount } from '@/lib/notifications/core';
import { cn } from '@/lib/utils/cn';

const TYPE_TONE: Record<string, string> = {
  fill: 'text-long',
  cancel: 'text-muted-foreground',
  slippage_cancel: 'text-short',
  liquidation: 'text-short',
  partial_liquidation: 'text-short',
  cross_liquidation: 'text-short',
  margin_call: 'text-primary',
  adl: 'text-short',
};

export function NotificationBell() {
  const entries = useNotificationStore((s) => s.entries);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const [open, setOpen] = useState(false);
  const unread = unreadCount(entries);

  return (
    <div data-noether-chrome className="fixed bottom-4 left-4 z-[95]">
      {open && (
        <div className="absolute bottom-12 left-0 w-80 max-h-96 overflow-y-auto rounded-lg border border-border bg-surface shadow-xl">
          <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-3 py-2">
            <span className="text-xs font-medium text-foreground">Account events</span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] text-primary hover:underline"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Close notifications"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No account events yet — fills, cancels and liquidations land here.
            </p>
          ) : (
            <ul>
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className={cn(
                    'border-b border-border px-3 py-2 last:border-b-0',
                    !entry.read && 'bg-primary/5',
                  )}
                >
                  <p className={cn('text-xs', TYPE_TONE[entry.type] ?? 'text-foreground')}>
                    {entry.title}
                  </p>
                  {entry.body && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{entry.body}</p>
                  )}
                  <p className="mt-0.5 text-[10px] text-faint">
                    {new Date(entry.ts).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground shadow-lg transition-colors hover:text-foreground"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-short px-1 text-[9px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </div>
  );
}
