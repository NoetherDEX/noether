'use client';

import { useCallback } from 'react';
import { useWalletStore } from '@/lib/store';
import { NETWORK } from '@/lib/utils/constants';
import { getUSDCBalance } from '@/lib/stellar/token';
import { signWithWallet, disconnectWallet, WALLETCONNECT_ID } from '@/lib/stellar/walletKit';
import toast from 'react-hot-toast';

// Horizon Testnet URL for balance fetching
const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';

/**
 * Fetches XLM balance from Horizon Testnet API
 */
async function fetchXLMBalance(publicKey: string): Promise<number> {
  try {
    const response = await fetch(`${HORIZON_TESTNET_URL}/accounts/${publicKey}`);
    if (!response.ok) {
      if (response.status === 404) return 0; // Account not funded
      throw new Error(`Horizon API error: ${response.status}`);
    }
    const data = await response.json();
    const nativeBalance = data.balances?.find(
      (b: { asset_type: string }) => b.asset_type === 'native'
    );
    return nativeBalance ? parseFloat(nativeBalance.balance) : 0;
  } catch (error) {
    console.error('Failed to fetch XLM balance:', error);
    return 0;
  }
}

export function useWallet() {
  const {
    isConnected,
    isConnecting,
    address,
    publicKey,
    xlmBalance,
    usdcBalance,
    noeBalance,
    setConnected,
    setDisconnected,
    setConnecting,
    setBalances,
    setUsdcBalance,
  } = useWalletStore();

  /** Called by WalletModal after a wallet is selected and address is obtained */
  const onConnected = useCallback(
    async (walletAddress: string, walletId?: string) => {
      setConnecting(true);
      try {
        setConnected(walletAddress, walletAddress, walletId);

        const [xlmBal, usdcBal] = await Promise.all([
          fetchXLMBalance(walletAddress),
          getUSDCBalance(walletAddress),
        ]);
        setBalances(xlmBal, usdcBal, 0);
      } catch (error) {
        console.error('Failed to complete wallet connection:', error);
        setDisconnected();
      } finally {
        setConnecting(false);
      }
    },
    [setConnecting, setConnected, setDisconnected, setBalances]
  );

  const disconnect = useCallback(async () => {
    await disconnectWallet();
    setDisconnected();
  }, [setDisconnected]);

  const walletId = useWalletStore((s) => s.walletId);

  const sign = useCallback(
    async (xdr: string): Promise<string> => {
      if (!isConnected || !address) {
        throw new Error('Wallet not connected');
      }

      const isWC = walletId === WALLETCONNECT_ID;
      let wcToastId: string | undefined;

      if (isWC) {
        wcToastId = toast.loading('Open your wallet app to approve the transaction', {
          duration: 120000,
        });
      }

      try {
        // Race between signing and a 2-minute timeout for WalletConnect
        const signPromise = signWithWallet(xdr, {
          networkPassphrase: NETWORK.PASSPHRASE,
          address,
        });

        if (isWC) {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Wallet approval timed out. Please try again.')), 120000)
          );
          const signedXdr = await Promise.race([signPromise, timeoutPromise]);
          return signedXdr;
        }

        return await signPromise;
      } finally {
        if (wcToastId) toast.dismiss(wcToastId);
      }
    },
    [isConnected, address, walletId]
  );

  // Refresh balances
  const refreshBalances = useCallback(async () => {
    if (!publicKey) return;

    const [xlmBal, usdcBal] = await Promise.all([
      fetchXLMBalance(publicKey),
      getUSDCBalance(publicKey),
    ]);
    setBalances(xlmBal, usdcBal, noeBalance);
  }, [publicKey, noeBalance, setBalances]);

  return {
    isConnected,
    isConnecting,
    address,
    publicKey,
    walletId,
    xlmBalance,
    usdcBalance,
    noeBalance,
    onConnected,
    disconnect,
    sign,
    refreshBalances,
    setBalances,
    setUsdcBalance,
  };
}
