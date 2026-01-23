import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { signTransaction } from '@stellar/freighter-api';
import { Networks } from '@stellar/stellar-sdk';
import toast from 'react-hot-toast';
import {
  buildAddTrustlineTransaction,
  submitTransaction,
  ClaimRecord,
  ClaimAmount,
  DAILY_LIMIT_USDC,
  calculateRunningTotals,
} from '@/lib/stellar/faucet';
import { useWallet } from '@/lib/hooks/useWallet';

interface FaucetHistoryResponse {
  success: boolean;
  hasTrustline: boolean;
  records: ClaimRecord[];
  claimedToday: number;
  remainingToday: number;
  totalAllTime: number;
  dailyLimit: number;
}

interface ClaimResponse {
  success: boolean;
  txHash?: string;
  amount?: number;
  remaining?: number;
  message?: string;
  error?: string;
}

export type TrustlineStatus = 'checking' | 'not_found' | 'adding' | 'active' | 'error';

export function useFaucet(publicKey: string | null) {
  const queryClient = useQueryClient();
  const { refreshBalances } = useWallet();
  const [trustlineStatus, setTrustlineStatus] = useState<TrustlineStatus>('checking');
  const [selectedAmount, setSelectedAmount] = useState<ClaimAmount | null>(null);
  const [trustlineError, setTrustlineError] = useState<string | null>(null);

  // Fetch faucet history and status
  const {
    data: faucetData,
    isLoading: isLoadingHistory,
    error: historyError,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['faucet-history', publicKey],
    queryFn: async (): Promise<FaucetHistoryResponse> => {
      if (!publicKey) {
        throw new Error('No wallet connected');
      }

      const response = await fetch(`/api/faucet/history?address=${publicKey}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch faucet data');
      }

      return data;
    },
    enabled: !!publicKey,
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 10000,
  });

  // Update trustline status based on fetched data
  useEffect(() => {
    if (isLoadingHistory) {
      setTrustlineStatus('checking');
    } else if (faucetData) {
      setTrustlineStatus(faucetData.hasTrustline ? 'active' : 'not_found');
    } else if (historyError) {
      setTrustlineStatus('error');
    }
  }, [faucetData, isLoadingHistory, historyError]);

  // Add trustline mutation
  const addTrustlineMutation = useMutation({
    mutationFn: async () => {
      if (!publicKey) {
        throw new Error('No wallet connected');
      }

      setTrustlineStatus('adding');
      setTrustlineError(null);

      try {
        // Build the transaction
        const xdr = await buildAddTrustlineTransaction(publicKey);

        // Sign with Freighter
        const signedXdr = await signTransaction(xdr, {
          networkPassphrase: Networks.TESTNET,
        });

        // Submit to network
        await submitTransaction(signedXdr);

        return true;
      } catch (error) {
        setTrustlineStatus('error');
        throw error;
      }
    },
    onSuccess: () => {
      setTrustlineStatus('active');
      toast.success('USDC trustline added successfully!');
      refetchHistory();
    },
    onError: (error: Error) => {
      setTrustlineStatus('error');
      setTrustlineError(error.message);
      toast.error(error.message || 'Failed to add trustline');
    },
  });

  // Claim USDC mutation
  const claimMutation = useMutation({
    mutationFn: async (amount: ClaimAmount): Promise<ClaimResponse> => {
      if (!publicKey) {
        throw new Error('No wallet connected');
      }

      const response = await fetch('/api/faucet/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: publicKey, amount }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to claim USDC');
      }

      return data;
    },
    onSuccess: (data) => {
      toast.success(`Received ${data.amount} USDC!`);
      setSelectedAmount(null);
      // Refresh wallet balance to show new USDC
      refreshBalances();
      // Invalidate and refetch faucet history
      queryClient.invalidateQueries({ queryKey: ['faucet-history', publicKey] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to claim USDC');
    },
  });

  // Add trustline handler
  const addTrustline = useCallback(() => {
    addTrustlineMutation.mutate();
  }, [addTrustlineMutation]);

  // Claim handler
  const claimUsdc = useCallback(
    (amount: ClaimAmount) => {
      claimMutation.mutate(amount);
    },
    [claimMutation]
  );

  // Parse history records with dates
  const historyWithDates =
    faucetData?.records.map((record) => ({
      ...record,
      timestamp: new Date(record.timestamp),
    })) || [];

  // Calculate running totals for display
  const historyWithTotals = calculateRunningTotals(historyWithDates);

  return {
    // Trustline
    trustlineStatus,
    trustlineError,
    addTrustline,
    isAddingTrustline: addTrustlineMutation.isPending,

    // Claim
    selectedAmount,
    setSelectedAmount,
    claimUsdc,
    isClaiming: claimMutation.isPending,

    // Data
    isLoading: isLoadingHistory,
    claimedToday: faucetData?.claimedToday || 0,
    remainingToday: faucetData?.remainingToday || DAILY_LIMIT_USDC,
    totalAllTime: faucetData?.totalAllTime || 0,
    dailyLimit: DAILY_LIMIT_USDC,
    history: historyWithTotals,

    // Actions
    refetch: refetchHistory,
  };
}
