'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { Header } from '@/components/layout';
import { WalletProvider } from '@/components/wallet';
import { useWallet } from '@/lib/hooks/useWallet';
import { useFaucet } from '@/lib/hooks/useFaucet';
import {
  HowItWorks,
  TrustlineSection,
  ClaimSection,
  ClaimHistory,
} from '@/components/faucet';

function FaucetPage() {
  const { isConnected, publicKey } = useWallet();
  const {
    accountStatus,
    fundAccount,
    isFundingAccount,
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
    <div className="min-h-screen bg-[#0a0a0a]">
      <Header />

      <main className="pt-16 pb-20">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
          {!isConnected ? (
            <div className="rounded-2xl border border-white/10 bg-card p-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] mb-4">
                <Wallet className="w-8 h-8 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Connect Your Wallet
              </h2>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                Connect your Freighter wallet to claim test USDC tokens.
              </p>
              <p className="text-sm text-muted-foreground/70">
                Click &quot;Connect Wallet&quot; in the top right corner to get started.
              </p>
            </div>
          ) : (
            <>
              {/* How It Works */}
              <HowItWorks />

              {/* Trustline + Claim Section (side by side on desktop) */}
              <div className="grid lg:grid-cols-2 gap-8">
                {/* Trustline Section */}
                <TrustlineSection
                  status={trustlineStatus}
                  onAddTrustline={addTrustline}
                  isAdding={isAddingTrustline}
                  error={trustlineError}
                  accountStatus={accountStatus}
                  onFundAccount={fundAccount}
                  isFundingAccount={isFundingAccount}
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
              </div>

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
