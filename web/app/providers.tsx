'use client';

import { WalletProvider } from '@/components/wallet';
import { ConfigGuard } from '@/components/ConfigGuard';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <ConfigGuard>{children}</ConfigGuard>
    </WalletProvider>
  );
}
