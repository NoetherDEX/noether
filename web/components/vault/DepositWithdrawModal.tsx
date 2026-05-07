'use client';

import { useState } from 'react';
import { Button, Card, CardContent, Input, Modal } from '@/components/ui';
import { useWalletStore } from '@/lib/store';
import { depositToVault, withdrawFromVault } from '@/lib/stellar/vaultFactory';
import { VAULT_PRECISION } from '@/types/vault';
import toast from 'react-hot-toast';

interface Props {
  open: boolean;
  onClose: () => void;
  vaultId: number;
  vaultName: string;
  onSuccess?: () => void;
}

type Mode = 'deposit' | 'withdraw';

function parseAmount(input: string): bigint | null {
  if (!input) return null;
  const m = input.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const whole = m[1] ?? '0';
  const frac = (m[2] ?? '').slice(0, 7).padEnd(7, '0');
  try {
    return BigInt(whole) * VAULT_PRECISION + BigInt(frac || '0');
  } catch {
    return null;
  }
}

export function DepositWithdrawModal({ open, onClose, vaultId, vaultName, onSuccess }: Props) {
  const wallet = useWalletStore();
  const [mode, setMode] = useState<Mode>('deposit');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;
  const connected = Boolean(wallet.address);

  async function submit() {
    const parsed = parseAmount(amount);
    if (!parsed) return toast.error('Enter a valid amount');
    if (!wallet.address || !wallet.walletId) return toast.error('Connect a wallet first');
    setBusy(true);
    try {
      if (mode === 'deposit') {
        await depositToVault(wallet.address, wallet.walletId, vaultId, parsed);
        toast.success(`Deposited ${amount} into ${vaultName}`);
      } else {
        await withdrawFromVault(wallet.address, wallet.walletId, vaultId, parsed);
        toast.success(`Withdrew ${amount} shares from ${vaultName}`);
      }
      setAmount('');
      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed: ${msg.slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`${mode === 'deposit' ? 'Deposit to' : 'Withdraw from'} ${vaultName}`}>
      <div className="space-y-4 p-4">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={mode === 'deposit' ? 'default' : 'ghost'}
            onClick={() => setMode('deposit')}
          >
            Deposit
          </Button>
          <Button
            size="sm"
            variant={mode === 'withdraw' ? 'default' : 'ghost'}
            onClick={() => setMode('withdraw')}
          >
            Withdraw
          </Button>
        </div>

        <Card>
          <CardContent className="p-4 space-y-2">
            <label className="text-xs text-zinc-500 uppercase tracking-wider">
              {mode === 'deposit' ? 'USDC amount' : 'Share amount'}
            </label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              type="text"
              inputMode="decimal"
            />
            <p className="text-xs text-zinc-500">
              {mode === 'deposit'
                ? 'Your USDC moves to the vault contract; you receive shares.'
                : 'Burn shares and receive USDC at the current NAV.'}
            </p>
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
            {busy ? 'Signing…' : mode === 'deposit' ? 'Deposit' : 'Withdraw'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
