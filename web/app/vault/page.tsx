'use client';

import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Header } from '@/components/layout';
import { WalletProvider, WalletModal } from '@/components/wallet';
import { useWallet } from '@/lib/hooks/useWallet';
import { fromPrecision, toPrecision, formatNumber } from '@/lib/utils';
import { decodeContractError } from '@/lib/utils/contractErrors';
import { debugLog } from '@/lib/utils/debug';
import {
  StatsBar,
  YourPosition,
  DepositWithdrawCard,
  TransactionHistory,
  HowItWorks,
  RiskDisclosure,
} from '@/components/vault';
import {
  deposit,
  approveAndWithdraw,
  getVaultUsdcBalance,
  getNoeBalance,
  getNoePrice,
  getVaultDepositFeeBps,
  getVaultWithdrawFeeBps,
} from '@/lib/stellar/vault';
import {
  hasNoeTrustline,
  createAddTrustlineTransaction,
  submitTrustlineTransaction,
} from '@/lib/stellar/trustline';

function VaultPage() {
  const { isConnected, publicKey, usdcBalance, sign, refreshBalances, onConnected } = useWallet();

  // Loading state
  const [isLoading, setIsLoading] = useState(true);

  // Pool stats — null means "unknown" (read failed or not fetched yet) and
  // renders as '—'; never a fabricated $0 TVL or $1.00 NOE price.
  const [poolStats, setPoolStats] = useState<{
    tvl: number | null;
    noePrice: number | null;
    apy: number | null;
    noeBalance: number | null;
  }>({
    tvl: null,
    noePrice: null,
    apy: null, // real APR needs fee-revenue history (P4-15); hidden until then
    noeBalance: 0,
  });

  // On-chain deposit/withdraw fees in basis points (30 = 0.30%); null = unknown
  const [depositFeeBps, setDepositFeeBps] = useState<number | null>(null);
  const [withdrawFeeBps, setWithdrawFeeBps] = useState<number | null>(null);

  // Trustline state
  const [hasTrustline, setHasTrustline] = useState(true); // Assume true until checked
  const [isAddingTrustline, setIsAddingTrustline] = useState(false);

  // Deposit/Withdraw state
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  // Which of the two withdraw signatures is in flight (1 = approve NOE, 2 = withdraw)
  const [withdrawPhase, setWithdrawPhase] = useState<1 | 2 | null>(null);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);

  // Fetch pool data. NOE price + fee reads simulate from NULL_ACCOUNT, so
  // they work logged-out; TVL/balance/trustline reads need a wallet.
  const fetchPoolData = useCallback(async () => {
    const publicReads = Promise.all([
      getNoePrice(publicKey),
      getVaultDepositFeeBps(publicKey),
      getVaultWithdrawFeeBps(publicKey),
    ]);

    if (!publicKey) {
      const [noePrice, depFeeBps, wdFeeBps] = await publicReads;
      setPoolStats({
        tvl: null,
        noePrice: noePrice != null ? fromPrecision(noePrice) : null,
        apy: null,
        noeBalance: 0,
      });
      setDepositFeeBps(depFeeBps);
      setWithdrawFeeBps(wdFeeBps);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [[noePrice, depFeeBps, wdFeeBps], vaultBalance, noeBalance, trustlineStatus] =
        await Promise.all([
          publicReads,
          getVaultUsdcBalance(publicKey),
          getNoeBalance(publicKey, publicKey),
          hasNoeTrustline(publicKey),
        ]);

      debugLog('[Vault] Raw noePrice:', noePrice, 'noeBalance:', noeBalance);

      const noePriceNum = noePrice != null ? fromPrecision(noePrice) : null;
      const noeBalanceNum = noeBalance != null ? fromPrecision(noeBalance) : null;

      // TVL = actual USDC token balance held by vault contract
      // This reflects all deposits, fees, settlements, and direct transfers
      setPoolStats({
        tvl: vaultBalance,
        noePrice: noePriceNum != null && isNaN(noePriceNum) ? null : noePriceNum,
        apy: null, // real APR needs fee-revenue history (P4-15); hidden until then
        noeBalance: noeBalanceNum,
      });
      setDepositFeeBps(depFeeBps);
      setWithdrawFeeBps(wdFeeBps);
      setHasTrustline(trustlineStatus);
    } catch (error) {
      console.error('Failed to fetch pool data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey]);

  // Fetch data on mount and when connection changes
  useEffect(() => {
    fetchPoolData();
  }, [fetchPoolData]);

  // Handle adding trustline
  const handleAddTrustline = async () => {
    if (!publicKey) return;

    setIsAddingTrustline(true);
    try {
      const xdr = await createAddTrustlineTransaction(publicKey);
      const signedXdr = await sign(xdr);
      await submitTrustlineTransaction(signedXdr);
      setHasTrustline(true);
      toast.success('NOE trustline added — you can now deposit');
    } catch (error) {
      toast.error(decodeContractError(error) || 'Failed to add NOE trustline');
    } finally {
      setIsAddingTrustline(false);
    }
  };

  // Handle deposit
  const handleDeposit = async () => {
    if (!depositAmount || !isConnected || !publicKey) return;

    setIsDepositing(true);
    try {
      const amountNum = parseFloat(depositAmount);
      const noeReceived = await deposit(publicKey, sign, toPrecision(amountNum));
      toast.success(
        `Deposited ${formatNumber(amountNum)} USDC → ${formatNumber(fromPrecision(noeReceived), 4)} NOE`
      );
      setDepositAmount('');
      // Refresh pool stats and balances after deposit
      await Promise.all([fetchPoolData(), refreshBalances()]);
    } catch (error) {
      toast.error(decodeContractError(error, { contract: 'vault' }) || 'Deposit failed');
    } finally {
      setIsDepositing(false);
    }
  };

  // Handle withdraw — TWO wallet signatures: approve NOE (1/2), then withdraw (2/2)
  const handleWithdraw = async () => {
    if (!withdrawAmount || !isConnected || !publicKey) return;

    setIsWithdrawing(true);
    let phase = 1 as 1 | 2; // local copy — state updates are async, catch needs the live value (as-cast keeps TS from narrowing to the literal 1)
    try {
      const amountNum = parseFloat(withdrawAmount);
      const usdcReceived = await approveAndWithdraw(publicKey, sign, toPrecision(amountNum), (p) => {
        phase = p;
        setWithdrawPhase(p);
      });
      toast.success(
        `Withdrew ${formatNumber(amountNum, 4)} NOE → ${formatNumber(fromPrecision(usdcReceived))} USDC`
      );
      setWithdrawAmount('');
      // Refresh pool stats and balances after withdrawal
      await Promise.all([fetchPoolData(), refreshBalances()]);
    } catch (error) {
      const detail = decodeContractError(error, { contract: 'vault' });
      toast.error(
        phase === 2
          ? `Withdraw failed after the NOE approval — no USDC left the pool. ${detail}`.trim()
          : detail || 'NOE approval failed — nothing was withdrawn'
      );
    } finally {
      setIsWithdrawing(false);
      setWithdrawPhase(null);
    }
  };

  // Calculate preview values from the on-chain fee + price reads.
  // Unknown inputs yield null previews (rendered as '—'), never a made-up rate.
  const depositNum = parseFloat(depositAmount) || 0;
  const depositFeeRate = depositFeeBps != null ? depositFeeBps / 10_000 : null;
  const noeToReceive =
    depositFeeRate != null && poolStats.noePrice != null && poolStats.noePrice > 0
      ? (depositNum * (1 - depositFeeRate)) / poolStats.noePrice
      : null;
  const depositFee = depositFeeRate != null ? depositNum * depositFeeRate : null;

  const withdrawNum = parseFloat(withdrawAmount) || 0;
  const withdrawFeeRate = withdrawFeeBps != null ? withdrawFeeBps / 10_000 : null;
  const usdcToReceive =
    withdrawFeeRate != null && poolStats.noePrice != null
      ? withdrawNum * poolStats.noePrice * (1 - withdrawFeeRate)
      : null;
  const withdrawFee =
    withdrawFeeRate != null && poolStats.noePrice != null
      ? withdrawNum * poolStats.noePrice * withdrawFeeRate
      : null;

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Header />

      <main className="pt-16 pb-20">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
          {/* Section 1: Stats Bar */}
          <StatsBar
            tvl={poolStats.tvl}
            noePrice={poolStats.noePrice}
            apy={poolStats.apy}
            isLoading={isLoading && isConnected}
          />

          {/* Section 2 & 3: Position + Deposit/Withdraw (side by side on desktop) */}
          <div className="grid lg:grid-cols-2 gap-8">
            {/* Section 2: Your Position */}
            <YourPosition
              noeBalance={poolStats.noeBalance}
              noePrice={poolStats.noePrice}
              tvl={poolStats.tvl}
              apy={poolStats.apy}
              isConnected={isConnected}
              isLoading={isLoading && isConnected}
              hasTrustline={hasTrustline}
              onAddTrustline={handleAddTrustline}
              isAddingTrustline={isAddingTrustline}
            />

            {/* Section 3: Deposit/Withdraw + risk disclosure at the point of deposit */}
            <div className="space-y-6">
              <DepositWithdrawCard
                depositAmount={depositAmount}
                onDepositAmountChange={setDepositAmount}
                onDeposit={handleDeposit}
                isDepositing={isDepositing}
                usdcBalance={usdcBalance}
                noeToReceive={noeToReceive}
                depositFee={depositFee}
                depositFeeBps={depositFeeBps}
                withdrawAmount={withdrawAmount}
                onWithdrawAmountChange={setWithdrawAmount}
                onWithdraw={handleWithdraw}
                isWithdrawing={isWithdrawing}
                withdrawPhase={withdrawPhase}
                noeBalance={poolStats.noeBalance ?? 0}
                usdcToReceive={usdcToReceive}
                withdrawFee={withdrawFee}
                withdrawFeeBps={withdrawFeeBps}
                isConnected={isConnected}
                onConnectWallet={() => setIsWalletModalOpen(true)}
                hasTrustline={hasTrustline}
                onAddTrustline={handleAddTrustline}
                isAddingTrustline={isAddingTrustline}
                noePrice={poolStats.noePrice}
                isLoading={isLoading && isConnected}
              />
              <RiskDisclosure />
            </div>
          </div>

          {/* Section 4: Transaction History */}
          <TransactionHistory
            publicKey={publicKey}
            isConnected={isConnected}
          />

          {/* Section 5: How It Works + Risk */}
          <HowItWorks />
        </div>
      </main>

      {/* Wallet connect modal — opened by the card's Connect Wallet CTAs */}
      <WalletModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        onConnected={onConnected}
      />
    </div>
  );
}

export default function VaultPageWrapper() {
  return (
    <WalletProvider>
      <VaultPage />
    </WalletProvider>
  );
}
