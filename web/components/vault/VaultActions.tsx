'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { DepositWithdrawModal } from './DepositWithdrawModal';
import type { VaultRow } from '@/types/vault';

export function VaultActions({ vault }: { vault: VaultRow }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <div className="flex gap-2">
        <Button onClick={() => setOpen(true)} disabled={vault.paused}>
          {vault.paused ? 'Vault paused' : 'Deposit / Withdraw'}
        </Button>
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
