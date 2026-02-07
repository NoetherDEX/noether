'use client';

import { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/layout';
import { WalletProvider } from '@/components/wallet';
import { useWallet } from '@/lib/hooks/useWallet';
import { fromPrecision, toPrecision } from '@/lib/utils';
import {
  StatsBar,
  YourPosition,
  DepositWithdrawCard,
  TransactionHistory,
  HowItWorks,
} from '@/components/vault';
import {
  deposit,
  withdraw,
  approveNoeForWithdraw,
  getPoolInfo,
  getNoeBalance,
  getNoePrice,
} from '@/lib/stellar/vault';
import {
  hasNoeTrustline,
  createAddTrustlineTransaction,
  submitTrustlineTransaction,
} from '@/lib/stellar/trustline';

function VaultPage() {
  const { isConnected, publicKey, usdcBalance, sign, refreshBalances } = useWallet();

  // Loading state
  const [isLoading, setIsLoading] = useState(true);

  // Pool stats
  const [poolStats, setPoolStats] = useState({
    tvl: 0,
    noePrice: 1.0,
    apy: 12.5, // TODO: Calculate from actual fees
    noeBalance: 0,
  });

  // Trustline state
  const [hasTrustline, setHasTrustline] = useState(true); // Assume true until checked
  const [isAddingTrustline, setIsAddingTrustline] = useState(false);

  // Deposit/Withdraw state
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // Fetch pool data
  const fetchPoolData = useCallback(async () => {
    if (!publicKey) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [poolInfo, noeBalance, noePrice, trustlineStatus] = await Promise.all([
        getPoolInfo(publicKey),
        getNoeBalance(publicKey, publicKey),
        getNoePrice(publicKey),
        hasNoeTrustline(publicKey),
      ]);

      // Debug: Log raw poolInfo to see what we're getting
      console.log('[Vault] Raw poolInfo:', poolInfo);
      console.log('[Vault] Raw noePrice:', noePrice);
      console.log('[Vault] Raw noeBalance:', noeBalance);

      if (poolInfo) {
        // Safely convert values with fallbacks
        const noePriceNum = noePrice ? fromPrecision(Number(noePrice)) : 1.0;
        const noeBalanceNum = noeBalance ? fromPrecision(Number(noeBalance)) : 0;

        // Helper to get field value - Soroban returns snake_case, TypeScript expects camelCase
        // Check both naming conventions
        const getField = (obj: Record<string, unknown>, camelCase: string, snakeCase: string): bigint => {
          const value = obj[camelCase] ?? obj[snakeCase];
          return value != null ? BigInt(value as string | number | bigint) : BigInt(0);
        };

        const poolData = poolInfo as unknown as Record<string, unknown>;

        // Calculate AUM: Total USDC + Fees - Unrealized PnL
        const totalUsdc = fromPrecision(Number(getField(poolData, 'totalUsdc', 'total_usdc')));
        const totalFees = fromPrecision(Number(getField(poolData, 'totalFees', 'total_fees')));
        const unrealizedPnl = fromPrecision(Number(getField(poolData, 'unrealizedPnl', 'unrealized_pnl')));

        const aum = totalUsdc + totalFees - unrealizedPnl;

        console.log('[Vault] Calculated values:', { totalUsdc, totalFees, unrealizedPnl, aum, noePriceNum, noeBalanceNum });

        setPoolStats({
          tvl: isNaN(aum) ? 0 : aum,
          noePrice: isNaN(noePriceNum) ? 1.0 : noePriceNum,
          apy: 12.5, // TODO: Calculate from actual fees
          noeBalance: isNaN(noeBalanceNum) ? 0 : noeBalanceNum,
        });
      }

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
    } catch (error) {
      console.error('Failed to add trustline:', error);
    } finally {
      setIsAddingTrustline(false);
    }
  };

  // Handle deposit
  const handleDeposit = async () => {
    if (!depositAmount || !isConnected || !publicKey) return;

    setIsDepositing(true);
    try {
      const amountWithPrecision = toPrecision(parseFloat(depositAmount));
      const noeReceived = await deposit(publicKey, sign, amountWithPrecision);
      console.log('Deposited! NOE received:', fromPrecision(Number(noeReceived)));
      setDepositAmount('');
      // Refresh pool stats and balances after deposit
      await Promise.all([fetchPoolData(), refreshBalances()]);
    } catch (error) {
      console.error('Deposit failed:', error);
    } finally {
      setIsDepositing(false);
    }
  };

  // Handle withdraw
  const handleWithdraw = async () => {
    if (!withdrawAmount || !isConnected || !publicKey) return;

    setIsWithdrawing(true);
    try {
      const noeAmount = toPrecision(parseFloat(withdrawAmount));

      // Step 1: Approve NOE tokens for vault to spend
      console.log('Approving NOE for withdrawal...');
      await approveNoeForWithdraw(publicKey, sign, noeAmount);

      // Step 2: Withdraw (vault transfers NOE from user, sends USDC back)
      console.log('Withdrawing...');
      const usdcReceived = await withdraw(publicKey, sign, noeAmount);
      console.log('Withdrawn! USDC received:', fromPrecision(Number(usdcReceived)));

      setWithdrawAmount('');
      // Refresh pool stats and balances after withdrawal
      await Promise.all([fetchPoolData(), refreshBalances()]);
    } catch (error) {
      console.error('Withdraw failed:', error);
    } finally {
      setIsWithdrawing(false);
    }
  };

  // Calculate preview values
  const depositNum = parseFloat(depositAmount) || 0;
  const noeToReceive = poolStats.noePrice > 0 ? (depositNum * 0.997) / poolStats.noePrice : 0;
  const depositFee = depositNum * 0.003;

  const withdrawNum = parseFloat(withdrawAmount) || 0;
  const usdcToReceive = withdrawNum * poolStats.noePrice * 0.997;
  const withdrawFee = withdrawNum * poolStats.noePrice * 0.003;

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

            {/* Section 3: Deposit/Withdraw */}
            <DepositWithdrawCard
              depositAmount={depositAmount}
              onDepositAmountChange={setDepositAmount}
              onDeposit={handleDeposit}
              isDepositing={isDepositing}
              usdcBalance={usdcBalance}
              noeToReceive={noeToReceive}
              depositFee={depositFee}
              withdrawAmount={withdrawAmount}
              onWithdrawAmountChange={setWithdrawAmount}
              onWithdraw={handleWithdraw}
              isWithdrawing={isWithdrawing}
              noeBalance={poolStats.noeBalance}
              usdcToReceive={usdcToReceive}
              withdrawFee={withdrawFee}
              isConnected={isConnected}
              noePrice={poolStats.noePrice}
              isLoading={isLoading && isConnected}
            />
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
