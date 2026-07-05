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
import { getVaultTrades } from '@/lib/api/vaults';
import { VAULT_PRECISION, vaultNav } from '@/types/vault';
import type { VaultRow } from '@/types/vault';
import { fmtUsdc7 } from '@/lib/utils/format';
import { decodeContractError } from '@/lib/utils/contractErrors';
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

/** Plain (comma-free) amount string for filling the input — the parseAmount
 *  regex above rejects thousands separators, so display formatting must not
 *  leak into the field. Balances here are never negative. */
function fmtInputAmount(raw: bigint): string {
  const whole = raw / VAULT_PRECISION;
  const frac = (raw % VAULT_PRECISION).toString().padStart(7, '0');
  return `${whole}.${frac}`.replace(/\.?0+$/, '');
}

/**
 * Decode on-chain errors with the vault_factory table (A26 — the old local
 * map explained withdraw failures as deposit problems). Mode-aware carve-out:
 * the factory never raises #10 on `deposit`, so a #10 there bubbled from the
 * USDC SAC (payer balance) — including when buildTransaction already rewrote
 * it into the factory-table sentence during simulation.
 */
function humanizeError(err: unknown, mode: Mode): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (
    mode === 'deposit' &&
    (/Error\(Contract, #10\)/.test(raw) || raw.includes('does not have enough free USDC'))
  ) {
    return 'USDC transfer failed — insufficient USDC balance for this deposit.';
  }
  const decoded = decodeContractError(err, { contract: 'vault_factory' });
  return decoded.length > 200 ? `${decoded.slice(0, 200)}…` : decoded;
}

export function DepositWithdrawModal({ open, onClose, vault, onSuccess }: Props) {
  const wallet = useWalletStore();
  const [mode, setMode] = useState<Mode>('deposit');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [userShares, setUserShares] = useState<bigint>(0n);
  const [refreshKey, setRefreshKey] = useState(0);
  // Capital the leader currently has deployed in open positions — excluded
  // from the liquid NAV a withdrawal is priced at (A20). null = unknown.
  const [deployed, setDeployed] = useState<{ count: number; usdc: bigint } | null>(null);

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

  // Best-effort read of the leader's open trades so the withdraw warning can
  // show the ≈ dollar figure of excluded capital. Unmatched leader_open rows
  // (no leader_close for the same positionId) approximate what is deployed.
  useEffect(() => {
    if (!open) {
      setDeployed(null);
      return;
    }
    let cancelled = false;
    getVaultTrades(vault.id, 200)
      .then((trades) => {
        if (cancelled) return;
        const opens = new Map<string, bigint>();
        const closed = new Set<string>();
        for (const t of trades) {
          if (t.action === 'open') {
            let coll = 0n;
            try {
              coll = BigInt(t.collateral);
            } catch {
              /* unparseable row — count the position, skip its amount */
            }
            opens.set(t.positionId, coll);
          } else {
            closed.add(t.positionId);
          }
        }
        let count = 0;
        let usdc = 0n;
        opens.forEach((coll, id) => {
          if (!closed.has(id)) {
            count += 1;
            usdc += coll;
          }
        });
        setDeployed({ count, usdc });
      })
      .catch(() => {
        if (!cancelled) setDeployed(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, vault.id, refreshKey]);

  if (!open) return null;

  const parsed = parseAmount(amount);
  const maxRaw = mode === 'deposit' ? usdcBalance : userShares;
  const exceedsBalance = parsed !== null && parsed > maxRaw;
  // How many positions the leader has open right now. Trades-derived count
  // (paired with the ≈$ figure, 200-row window) and the API aggregate can
  // each miss independently — warn if EITHER says capital is deployed. The
  // old "insufficient liquidity" pre-check here was dead code AND a lie —
  // the contract pays such withdrawals out at the collapsed liquid NAV
  // instead of rejecting them, which is exactly why this warning exists.
  const openPositionCount = Math.max(deployed?.count ?? 0, vault.openPositions ?? 0);

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
      previewLine = `You will receive ≈ ${fmtUsdc7(sharesOut, 4)} shares`;
    } else {
      // shares burned * liquid NAV
      const usdcOut = (parsed * nav) / VAULT_PRECISION;
      previewLine = `You will receive ≈ ${fmtUsdc7(usdcOut, 4)} USDC at liquid NAV`;
    }
  }

  function setMax() {
    if (maxRaw === 0n) return;
    setAmount(fmtInputAmount(maxRaw));
  }

  async function submit() {
    if (!parsed || parsed <= 0n) return toast.error('Enter a valid amount > 0');
    if (!wallet.address || !wallet.walletId) return toast.error('Connect a wallet first');
    if (exceedsBalance) {
      return toast.error(
        mode === 'deposit'
          ? `Amount exceeds USDC balance (${fmtUsdc7(usdcBalance, 4)} available)`
          : `Amount exceeds your shares (${fmtUsdc7(userShares, 4)} available)`,
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
      toast.error(`Failed: ${humanizeError(err, mode)}`);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    connected && !busy && parsed !== null && parsed > 0n && !exceedsBalance;

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
            <div className="text-zinc-500">Liquid TVL</div>
            <div className="font-mono mt-0.5">{fmtUsdc7(vault.totalUsdc)} USDC</div>
          </div>
          <div className="rounded-md bg-zinc-900/50 px-3 py-2">
            <div className="text-zinc-500">Liquid NAV</div>
            <div className="font-mono mt-0.5">{fmtUsdc7(nav, 4)}</div>
          </div>
          <div className="rounded-md bg-zinc-900/50 px-3 py-2">
            <div className="text-zinc-500">Shares out</div>
            <div className="font-mono mt-0.5">{fmtUsdc7(vault.circulatingShares)}</div>
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
                Max ({fmtUsdc7(maxRaw, 4)})
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
          </CardContent>
        </Card>

        {/* Hard warning (A20): withdrawing while the leader has capital
            deployed pays out at the collapsed liquid NAV — the depositor
            permanently forfeits their share of the in-flight capital. */}
        {mode === 'withdraw' && openPositionCount > 0 && (
          <Card className="border-red-500/40 bg-red-500/5">
            <CardContent className="p-3 text-xs text-red-400 space-y-1">
              <p className="font-semibold">
                The leader has {openPositionCount} open position
                {openPositionCount === 1 ? '' : 's'}
                {deployed && deployed.usdc > 0n
                  ? ` holding ≈ $${fmtUsdc7(deployed.usdc)} of vault capital`
                  : ''}
                .
              </p>
              <p>
                That capital is excluded from the liquid NAV this withdrawal is
                priced at — withdrawing now permanently forfeits your share of
                it. Consider waiting until the positions close.
              </p>
            </CardContent>
          </Card>
        )}

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
