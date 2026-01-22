'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Droplets } from 'lucide-react';
import { Header } from '@/components/layout';
import { WalletProvider } from '@/components/wallet';
import { useWallet } from '@/lib/hooks/useWallet';
import { useFaucet } from '@/lib/hooks/useFaucet';
import { Card, CardContent } from '@/components/ui';
import {
  HowItWorks,
  TrustlineSection,
  ClaimSection,
  ClaimHistory,
} from '@/components/faucet';

function FaucetPage() {
  const { isConnected, publicKey } = useWallet();
  const {
    trustlineStatus,
    trustlineError,
    addTrustline,
    isAddingTrustline,
    selectedAmount,
    setSelectedAmount,
    claimUsdc,
    isClaiming,
    isLoading,
    claimedToday,
    remainingToday,
    dailyLimit,
    totalAllTime,
    history,
  } = useFaucet(publicKey);

  return (
    <div className="min-h-screen bg-[#09090b]">
      <Header />

      <main className="pt-16">
        <div className="max-w-2xl mx-auto p-4 lg:p-6">
          {/* Hero */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 mb-6">
              <Droplets className="w-8 h-8 text-blue-400" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-3">
              Testnet Faucet
            </h1>
            <p className="text-neutral-400 max-w-md mx-auto">
              Get free test USDC to try perpetual trading on Noether.
              Claim up to 1,000 USDC per day.
            </p>
          </div>

          {!isConnected ? (
            <Card className="text-center py-12">
              <CardContent>
                <Droplets className="w-16 h-16 text-neutral-700 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-white mb-2">
                  Connect Your Wallet
                </h2>
                <p className="text-neutral-400 mb-6 max-w-sm mx-auto">
                  Connect your Freighter wallet to claim test USDC tokens.
                </p>
                <p className="text-sm text-neutral-500">
                  Click &quot;Connect&quot; in the top right corner to get started.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* How It Works */}
              <HowItWorks />

              {/* Trustline Section */}
              <TrustlineSection
                status={trustlineStatus}
                onAddTrustline={addTrustline}
                isAdding={isAddingTrustline}
                error={trustlineError}
              />

              {/* Claim Section */}
              <ClaimSection
                claimedToday={claimedToday}
                remainingToday={remainingToday}
                dailyLimit={dailyLimit}
                selectedAmount={selectedAmount}
                onSelectAmount={setSelectedAmount}
                onClaim={claimUsdc}
                isClaiming={isClaiming}
                disabled={trustlineStatus !== 'active'}
              />

              {/* Claim History */}
              <ClaimHistory
                records={history}
                totalAllTime={totalAllTime}
                isLoading={isLoading}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// Create QueryClient outside component to avoid re-creation on render
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10000,
      retry: 1,
    },
  },
});

export default function FaucetPageWrapper() {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <FaucetPage />
      </WalletProvider>
    </QueryClientProvider>
  );
}
