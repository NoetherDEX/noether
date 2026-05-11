'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, Input, Modal } from '@/components/ui';
import { useWalletStore } from '@/lib/store';
import { createVault } from '@/lib/stellar/vaultFactory';
import toast from 'react-hot-toast';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateVaultModal({ open, onClose }: Props) {
  const router = useRouter();
  const wallet = useWalletStore();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;
  const connected = Boolean(wallet.address);

  async function submit() {
    if (!name || name.length < 1 || name.length > 64) {
      return toast.error('Name must be 1-64 characters');
    }
    if (!wallet.address || !wallet.walletId) {
      return toast.error('Connect a wallet first');
    }
    setBusy(true);
    try {
      await createVault(wallet.address, wallet.walletId, name);
      toast.success(`Vault "${name}" created`);
      setName('');
      onClose();
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed: ${msg.slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen={open} onClose={onClose} title="Create vault">
      <div className="space-y-4 p-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-zinc-500 uppercase tracking-wider">
                Vault name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="alpha-mm, momentum, …"
                maxLength={64}
              />
            </div>
            <ul className="text-xs text-zinc-400 list-disc pl-4 space-y-1">
              <li>You become the vault leader; depositors back you with USDC.</li>
              <li>You take 10% of any gains above the high-water mark.</li>
              <li>You must hold at least 5% of the vault yourself at all
                times — seed the vault with your own deposit before sharing.</li>
            </ul>
          </CardContent>
        </Card>

        {!connected && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="p-3 text-xs text-amber-400">
              Connect a wallet from the navbar to sign the transaction.
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !connected}>
            {busy ? 'Signing…' : 'Create vault'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
