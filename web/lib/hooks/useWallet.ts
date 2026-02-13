'use client';

import { useCallback } from 'react';
import { useWalletStore } from '@/lib/store';
import { NETWORK } from '@/lib/utils/constants';
import { getUSDCBalance } from '@/lib/stellar/token';
import { signWithWallet, disconnectWallet } from '@/lib/stellar/walletKit';

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
    async (walletAddress: string) => {
      setConnecting(true);
      try {
        setConnected(walletAddress, walletAddress);

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

  const sign = useCallback(
    async (xdr: string): Promise<string> => {
      if (!isConnected || !address) {
        throw new Error('Wallet not connected');
      }

      const signedXdr = await signWithWallet(xdr, {
        networkPassphrase: NETWORK.PASSPHRASE,
        address,
      });

      return signedXdr;
    },
    [isConnected, address]
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
