'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui';
import { useWalletStore, useLeaderModeStore } from '@/lib/store';
import { claimLeaderFees, setVaultPaused } from '@/lib/stellar/vaultFactory';
import { toUserMessage } from '@/lib/utils/userError';
import { fmtUsdc7 } from '@/lib/utils/format';
import { VAULT_PRECISION, vaultNav } from '@/types/vault';
import { DepositWithdrawModal } from './DepositWithdrawModal';
import type { VaultRow } from '@/types/vault';

/** EXACT mirror of the contract's math::leader_profit_owed — the profit
 *  share owed above the high-water mark. Same inputs, same integer math,
 *  so the displayed figure IS the on-chain payout (B19). */
function leaderProfitOwed(vault: VaultRow): bigint {
  const shares = BigInt(vault.circulatingShares);
  if (shares <= 0n) return 0n;
  const nav = vaultNav(vault);
  const hwm = BigInt(vault.hwmNav);
  if (nav <= hwm) return 0n;
  const totalGain = ((nav - hwm) * shares) / VAULT_PRECISION;
  return (totalGain * BigInt(vault.profitShareBps)) / 10_000n;
}

export function VaultActions({ vault }: { vault: VaultRow }) {
  const [open, setOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [pausing, setPausing] = useState(false);
  const router = useRouter();
  const wallet = useWalletStore();
  const { setVault: setLeaderVault } = useLeaderModeStore();
  const isLeader = !!wallet.address && wallet.address === vault.leader;

  const claimable = isLeader ? leaderProfitOwed(vault) : 0n;

  // B19: the claim used to be reachable ONLY by hand-typing an unlinked URL,
  // with no amount shown anywhere. Disabled at zero so NoFeesToClaim can
  // never blind-revert.
  const handleClaim = async () => {
    if (!wallet.address || !wallet.walletId || claimable <= 0n) return;
    setClaiming(true);
    try {
      await claimLeaderFees(wallet.address, wallet.walletId, vault.id);
      toast.success(`Claimed $${fmtUsdc7(claimable, 2)} profit share`);
      router.refresh();
    } catch (err) {
      toast.error(toUserMessage(err, { contract: 'vault_factory' }));
    } finally {
      setClaiming(false);
    }
  };

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
        {isLeader && (
          <Button
            variant="secondary"
            onClick={handleClaim}
            disabled={claimable <= 0n || claiming}
            isLoading={claiming}
            title={
              claimable <= 0n
                ? 'Profit share accrues when NAV rises above the high-water mark'
                : undefined
            }
          >
            {claimable > 0n
              ? `Claim profit share — $${fmtUsdc7(claimable, 2)}`
              : 'No profit share to claim'}
          </Button>
        )}
        {isLeader && (
          <Button
            variant="ghost"
            onClick={async () => {
              if (!wallet.address || !wallet.walletId) return;
              setPausing(true);
              try {
                await setVaultPaused(wallet.address, wallet.walletId, vault.id, !vault.paused);
                toast.success(
                  vault.paused
                    ? 'Vault unpaused — deposits and withdrawals re-enabled'
                    : 'Vault paused — deposits and withdrawals disabled'
                );
                router.refresh();
              } catch (err) {
                toast.error(toUserMessage(err, { contract: 'vault_factory' }));
              } finally {
                setPausing(false);
              }
            }}
            disabled={pausing}
            isLoading={pausing}
          >
            {vault.paused ? 'Unpause vault' : 'Pause vault'}
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
