'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { assertContractsConfigured, isRouterMissingInProd } from '@/lib/utils/constants';

/**
 * Client-side configuration guard, mounted once at app start (P0-8 / W-5).
 *
 * - Calls `assertContractsConfigured()` so a deploy missing a required contract
 *   address (VAULT / MARKET / USDC / NOE / NOERACLE_SHIM) fails loud instead of
 *   silently pointing the trading UI at the wrong chain state.
 * - Renders a persistent banner when the verify-then-trade router is unset on a
 *   production deploy — without it, trades execute directly on a possibly-stale
 *   on-chain price and can be rejected with #30 PriceStale.
 */
export function ConfigGuard({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    assertContractsConfigured();
  }, []);

  return (
    <>
      {children}
      {isRouterMissingInProd() && (
        <div
          role="alert"
          className="fixed inset-x-0 bottom-0 z-[60] flex items-center justify-center gap-2 border-t border-amber-400/30 bg-amber-400/10 px-4 py-2 text-center text-xs font-medium text-amber-300 backdrop-blur"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            Price router not configured (NEXT_PUBLIC_NOETHER_ROUTER_ID) — trades execute
            directly on-chain and may be rejected on a stale price. Set the router to
            restore fresh-price execution.
          </span>
        </div>
      )}
    </>
  );
}
