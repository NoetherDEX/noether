'use client';

import { notFound } from 'next/navigation';
import { IS_MAINNET_BUILD } from '@/lib/utils/constants';
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
    historyError,
    history,
  } = useFaucet(publicKey);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-12 pb-16">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
          {!isConnected ? (
            <div className="rounded-lg border border-border bg-surface p-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-lg bg-surface-2 border border-border mb-4">
                <Wallet className="w-8 h-8 text-muted-foreground" />
              </div>
              <h2 className="text-lg font-medium text-foreground mb-2">
                Connect Your Wallet
              </h2>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                Connect your Stellar wallet (Freighter, LOBSTR, …) to claim
                test USDC tokens.
              </p>
              <p className="text-sm text-faint">
                Click &quot;Connect Wallet&quot; in the top right corner to get started.
              </p>
            </div>
          ) : (
            <>
              {/* How It Works */}
              <HowItWorks />

              {/* Faucet data unavailable — stats below show '—', not zeros */}
              {historyError && (
                <div className="rounded-md border border-primary/25 bg-primary/5 px-4 py-2.5 text-sm text-primary">
                  Couldn&apos;t load your claim history — limits and totals show
                  &lsquo;—&rsquo; until it refreshes (retries automatically).
                </div>
              )}

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
  // Testnet-only surface: mainnet builds have no faucet, no admin mint key.
  if (IS_MAINNET_BUILD) notFound();
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <FaucetPage />
      </WalletProvider>
    </QueryClientProvider>
  );
}
