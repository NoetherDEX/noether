'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { useWalletStore, useLeaderModeStore } from '@/lib/store';
import { DepositWithdrawModal } from './DepositWithdrawModal';
import type { VaultRow } from '@/types/vault';

export function VaultActions({ vault }: { vault: VaultRow }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const wallet = useWalletStore();
  const { setVault: setLeaderVault } = useLeaderModeStore();
  const isLeader = !!wallet.address && wallet.address === vault.leader;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setOpen(true)} disabled={vault.paused}>
          {vault.paused ? 'Vault paused' : 'Deposit / Withdraw'}
        </Button>
        {isLeader && (
          <Button
            variant="secondary"
            onClick={() => {
              setLeaderVault(vault);
              router.push(`/trade?vault=${vault.id}`);
            }}
          >
            Trade as leader →
          </Button>
        )}
      </div>
      <DepositWithdrawModal
        open={open}
        onClose={() => setOpen(false)}
        vault={vault}
        onSuccess={() => router.refresh()}
      />
    </>
  );
}
