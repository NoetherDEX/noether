'use client';

import { useEffect, useState } from 'react';
import { Button, Card, CardContent, Input, Modal } from '@/components/ui';
import { useWalletStore } from '@/lib/store';
import {
  depositToVault,
  withdrawFromVault,
  getUserVaultShares,
  getWalletUsdcBalance,
} from '@/lib/stellar/vaultFactory';
import { VAULT_PRECISION, vaultNav } from '@/types/vault';
import type { VaultRow } from '@/types/vault';
import toast from 'react-hot-toast';

interface Props {
  open: boolean;
  onClose: () => void;
  vault: VaultRow;
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

function fmt(raw: bigint, decimals = 4): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const whole = abs / VAULT_PRECISION;
  const frac = (abs % VAULT_PRECISION).toString().padStart(7, '0').slice(0, decimals);
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/** Pretty-print common on-chain errors so the toast is actionable. */
function humanizeError(raw: string): string {
  const s = raw || '';
  // SAC balance error (10) — most common cause for deposit
  if (/Error\(Contract, #10\)/.test(s)) {
    return 'Insufficient USDC balance for this deposit.';
  }
  if (/Error\(Contract, #9\)/.test(s)) {
    return 'USDC allowance too low — approve the vault to spend your USDC.';
  }
  if (/Error\(Contract, #11\)/.test(s)) {
    return 'Leader minimum violated: the leader must hold ≥5% of the vault after this transaction.';
  }
  if (/Error\(Contract, #12\)/.test(s)) return 'Vault is paused.';
  if (/Error\(Contract, #8\)/.test(s)) return 'Amount must be positive.';
  if (/Error\(Contract, #13\)/.test(s)) return 'Arithmetic overflow.';
  if (/Error\(Contract, #14\)/.test(s)) return 'NAV calculation failed.';
  if (/Error\(Contract, #5\)/.test(s))  return 'Vault not found.';
  if (/Error\(Contract, #6\)/.test(s))  return 'Only the vault leader can do this.';
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

export function DepositWithdrawModal({ open, onClose, vault, onSuccess }: Props) {
  const wallet = useWalletStore();
  const [mode, setMode] = useState<Mode>('deposit');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [userShares, setUserShares] = useState<bigint>(0n);
  const [refreshKey, setRefreshKey] = useState(0);

  const connected = Boolean(wallet.address);
  const nav = vaultNav(vault);
  const isLeader = wallet.address === vault.leader;

  // Load balances when modal opens or wallet changes
  useEffect(() => {
    if (!open || !wallet.address) {
      setUsdcBalance(0n);
      setUserShares(0n);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [usdc, shares] = await Promise.all([
          getWalletUsdcBalance(wallet.address!),
          getUserVaultShares(wallet.address!, vault.id, wallet.address!),
        ]);
        if (!cancelled) {
          setUsdcBalance(usdc);
          setUserShares(shares);
        }
      } catch (err) {
        console.warn('[vault modal] balance fetch failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, wallet.address, vault.id, refreshKey]);

  if (!open) return null;

  const parsed = parseAmount(amount);
  const maxRaw = mode === 'deposit' ? usdcBalance : userShares;
  const exceedsBalance = parsed !== null && parsed > maxRaw;
  const insufficientLiquidity =
    mode === 'withdraw' &&
    parsed !== null &&
    parsed > 0n &&
    BigInt(vault.circulatingShares) > 0n &&
    (parsed * BigInt(vault.totalUsdc)) / BigInt(vault.circulatingShares) > BigInt(vault.totalUsdc);

  // Preview math
  let previewLine = '';
  if (parsed !== null && parsed > 0n) {
    if (mode === 'deposit') {
      // First deposit: 1 USDC = 1 share. Subsequent: amount * circulating / total_usdc.
      const totalUsdc = BigInt(vault.totalUsdc);
      const circulating = BigInt(vault.circulatingShares);
      const sharesOut =
        circulating === 0n || totalUsdc === 0n
          ? parsed
          : (parsed * circulating) / totalUsdc;
      previewLine = `You will receive ≈ ${fmt(sharesOut)} shares`;
    } else {
      // shares burned * NAV
      const usdcOut = (parsed * nav) / VAULT_PRECISION;
      previewLine = `You will receive ≈ ${fmt(usdcOut)} USDC`;
    }
  }

  function setMax() {
    if (maxRaw === 0n) return;
    setAmount(fmt(maxRaw, 7).replace(/\.?0+$/, ''));
  }

  async function submit() {
    if (!parsed || parsed <= 0n) return toast.error('Enter a valid amount > 0');
    if (!wallet.address || !wallet.walletId) return toast.error('Connect a wallet first');
    if (exceedsBalance) {
      return toast.error(
        mode === 'deposit'
          ? `Amount exceeds USDC balance (${fmt(usdcBalance)} available)`
          : `Amount exceeds your shares (${fmt(userShares)} available)`,
      );
    }
    setBusy(true);
    try {
      if (mode === 'deposit') {
        await depositToVault(wallet.address, wallet.walletId, vault.id, parsed);
        toast.success(`Deposited ${amount} USDC into ${vault.name}`);
      } else {
        await withdrawFromVault(wallet.address, wallet.walletId, vault.id, parsed);
        toast.success(`Withdrew ${amount} shares from ${vault.name}`);
      }
      setAmount('');
      setRefreshKey((k) => k + 1);
      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed: ${humanizeError(msg)}`);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    connected &&
    !busy &&
    parsed !== null &&
    parsed > 0n &&
    !exceedsBalance &&
    (mode === 'deposit' || !insufficientLiquidity);

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={`${mode === 'deposit' ? 'Deposit to' : 'Withdraw from'} ${vault.name}`}
    >
      <div className="space-y-4 p-4">
        {/* Tab toggle */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={mode === 'deposit' ? 'primary' : 'ghost'}
            onClick={() => {
              setMode('deposit');
              setAmount('');
            }}
          >
            Deposit
          </Button>
          <Button
            size="sm"
            variant={mode === 'withdraw' ? 'primary' : 'ghost'}
            onClick={() => {
              setMode('withdraw');
              setAmount('');
            }}
          >
            Withdraw
          </Button>
        </div>

        {/* Vault status row */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-md bg-zinc-900/50 px-3 py-2">
            <div className="text-zinc-500">Vault TVL</div>
            <div className="font-mono mt-0.5">{fmt(BigInt(vault.totalUsdc))} USDC</div>
          </div>
          <div className="rounded-md bg-zinc-900/50 px-3 py-2">
            <div className="text-zinc-500">NAV</div>
            <div className="font-mono mt-0.5">{fmt(nav)}</div>
          </div>
          <div className="rounded-md bg-zinc-900/50 px-3 py-2">
            <div className="text-zinc-500">Shares out</div>
            <div className="font-mono mt-0.5">{fmt(BigInt(vault.circulatingShares))}</div>
          </div>
        </div>

        {/* Amount input */}
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-end justify-between gap-2">
              <label className="text-xs text-zinc-500 uppercase tracking-wider">
                {mode === 'deposit' ? 'USDC amount' : 'Share amount'}
              </label>
              <button
                type="button"
                onClick={setMax}
                disabled={!connected || maxRaw === 0n}
                className="text-xs text-amber-400 hover:text-amber-300 disabled:text-zinc-600 disabled:cursor-not-allowed"
              >
                Max ({fmt(maxRaw)})
              </button>
            </div>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              type="text"
              inputMode="decimal"
            />
            {previewLine && (
              <p className="text-xs text-zinc-400 font-mono">{previewLine}</p>
            )}
            {exceedsBalance && (
              <p className="text-xs text-red-400">
                Amount exceeds {mode === 'deposit' ? 'USDC balance' : 'share balance'}.
              </p>
            )}
            {insufficientLiquidity && (
              <p className="text-xs text-red-400">
                Vault doesn&apos;t have enough free USDC for this withdrawal — leader
                has open positions tying up the capital.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Context banner */}
        {!connected && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="p-3 text-xs text-amber-400">
              Connect a wallet from the navbar to sign the transaction.
            </CardContent>
          </Card>
        )}

        {connected && mode === 'deposit' && !isLeader && BigInt(vault.leaderShares) === 0n && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="p-3 text-xs text-amber-400">
              The leader has not seeded this vault yet — outside deposits would
              break the 5% leader-skin invariant and will fail on-chain. Wait
              for the leader to deposit first.
            </CardContent>
          </Card>
        )}

        {connected && mode === 'withdraw' && userShares === 0n && (
          <Card className="border-zinc-700 bg-zinc-900/40">
            <CardContent className="p-3 text-xs text-zinc-400">
              You have no shares in this vault to withdraw.
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? 'Signing…' : mode === 'deposit' ? 'Deposit' : 'Withdraw'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
