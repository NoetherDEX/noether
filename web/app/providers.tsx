'use client';

import { useEffect } from 'react';
import { WalletProvider } from '@/components/wallet';
import { assertContractsConfigured, CONTRACTS } from '@/lib/utils/constants';

// Build-time constant: env vars are inlined by Next, so this is identical on
// server and client (no hydration mismatch).
const ROUTER_MISSING =
  process.env.NODE_ENV === 'production' && !CONTRACTS.NOETHER_ROUTER;

function RouterMissingBanner() {
  return (
    <div className="fixed bottom-0 inset-x-0 z-[100] border-t border-amber-500/40 bg-amber-950/95 px-4 py-2 text-center text-xs text-amber-200">
      NOETHER_ROUTER is not configured — trades fall back to the direct,
      stale-prone price path. Set <code className="font-mono">NEXT_PUBLIC_NOETHER_ROUTER_ID</code>.
    </div>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    try {
      assertContractsConfigured();
    } catch {
      // Already logged the curated message — avoid a cryptic render crash.
    }
    if (ROUTER_MISSING) {
      console.error(
        '[noether] NEXT_PUBLIC_NOETHER_ROUTER_ID is unset in a production build — trades fall back to the direct, stale-prone price path.',
      );
    }
  }, []);

  return (
    <WalletProvider>
      {children}
      {ROUTER_MISSING && <RouterMissingBanner />}
    </WalletProvider>
  );
}
