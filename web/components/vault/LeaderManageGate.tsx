'use client';

import { Card, CardContent } from '@/components/ui';
import { useWalletStore } from '@/lib/store';
import type { VaultRow } from '@/types/vault';
import { LeaderTradePanel } from './LeaderTradePanel';

export function LeaderManageGate({ vault }: { vault: VaultRow }) {
  const wallet = useWalletStore();

  if (!wallet.address) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          Connect your wallet to manage this vault.
        </CardContent>
      </Card>
    );
  }

  if (wallet.address !== vault.leader) {
    return (
      <Card className="border-primary/25 bg-primary/10">
        <CardContent className="p-5 text-sm">
          <p className="text-primary font-medium">Leader-only page</p>
          <p className="text-foreground mt-1">
            You're connected as{' '}
            <code className="text-xs font-mono">{wallet.address.slice(0, 8)}…</code>
            {' '}but this vault's leader is{' '}
            <code className="text-xs font-mono">{vault.leader.slice(0, 8)}…</code>.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <LeaderTradePanel vaultId={vault.id} vaultName={vault.name} />;
}
