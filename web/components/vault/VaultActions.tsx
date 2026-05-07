'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { DepositWithdrawModal } from './DepositWithdrawModal';

export function VaultActions({
  vaultId,
  vaultName,
  paused,
}: {
  vaultId: number;
  vaultName: string;
  paused: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex gap-2">
        <Button onClick={() => setOpen(true)} disabled={paused}>
          {paused ? 'Vault paused' : 'Deposit / Withdraw'}
        </Button>
      </div>
      <DepositWithdrawModal
        open={open}
        onClose={() => setOpen(false)}
        vaultId={vaultId}
        vaultName={vaultName}
      />
    </>
  );
}
