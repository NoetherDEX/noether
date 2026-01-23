'use client';

import { useCallback } from 'react';
import {
  isConnected as checkIsConnected,
  isAllowed,
  setAllowed,
  getPublicKey,
  getNetwork,
  signTransaction,
} from '@stellar/freighter-api';
import { useWalletStore } from '@/lib/store';
import { NETWORK } from '@/lib/utils/constants';
import { getUSDCBalance } from '@/lib/stellar/token';

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
    glpBalance,
    setConnected,
    setDisconnected,
    setConnecting,
    setBalances,
    setUsdcBalance,
  } = useWalletStore();

  const connect = useCallback(async () => {
    // Prevent multiple simultaneous connection attempts
    if (useWalletStore.getState().isConnecting) {
      console.log('Connection already in progress, skipping...');
      return;
    }

    setConnecting(true);

    try {
      // Check if Freighter is installed
      const connected = await checkIsConnected();
      if (!connected) {
        throw new Error('Freighter wallet not found. Please install the Freighter extension.');
      }

      // Check if already allowed
      const allowed = await isAllowed();
      if (!allowed) {
        // Request permission
        await setAllowed();
      }

      // Get public key
      const pubKey = await getPublicKey();
      if (!pubKey) {
        throw new Error('Failed to get public key from Freighter');
      }

      // Verify network - warn if not on testnet
      const network = await getNetwork();
      if (network !== 'TESTNET' && network !== 'testnet') {
        console.warn(`Connected to ${network}, please switch to TESTNET in Freighter settings`);
      }

      // Set connected state
      setConnected(pubKey, pubKey);

      // Fetch balances in parallel
      const [xlmBal, usdcBal] = await Promise.all([
        fetchXLMBalance(pubKey),
        getUSDCBalance(pubKey),
      ]);
      setBalances(xlmBal, usdcBal, 0);

      return pubKey;
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      setDisconnected();
      throw error;
    } finally {
      // Ensure isConnecting is reset even if something goes wrong
      setConnecting(false);
    }
  }, [setConnecting, setConnected, setDisconnected, setBalances]);

  const disconnect = useCallback(() => {
    setDisconnected();
  }, [setDisconnected]);

  const sign = useCallback(
    async (xdr: string): Promise<string> => {
      if (!isConnected) {
        throw new Error('Wallet not connected');
      }

      console.log('[DEBUG] Sending to Freighter XDR (first 100 chars):', xdr.substring(0, 100));

      const result = await signTransaction(xdr, {
        networkPassphrase: NETWORK.PASSPHRASE,
      });

      console.log('[DEBUG] Freighter returned:', typeof result, result);

      // Freighter API returns the signed XDR as a string
      // Some versions may return an object with signedTxXdr property
      let signedXdr: string;
      if (typeof result === 'string') {
        signedXdr = result;
      } else if (result && typeof result === 'object' && 'signedTxXdr' in result) {
        signedXdr = (result as { signedTxXdr: string }).signedTxXdr;
      } else {
        console.error('[DEBUG] Unexpected Freighter response format:', result);
        throw new Error('Unexpected response format from Freighter');
      }

      console.log('[DEBUG] Signed XDR (first 100 chars):', signedXdr.substring(0, 100));

      return signedXdr;
    },
    [isConnected]
  );

  // Refresh balances
  const refreshBalances = useCallback(async () => {
    if (!publicKey) return;

    const [xlmBal, usdcBal] = await Promise.all([
      fetchXLMBalance(publicKey),
      getUSDCBalance(publicKey),
    ]);
    setBalances(xlmBal, usdcBal, glpBalance);
  }, [publicKey, glpBalance, setBalances]);

  return {
    isConnected,
    isConnecting,
    address,
    publicKey,
    xlmBalance,
    usdcBalance,
    glpBalance,
    connect,
    disconnect,
    sign,
    refreshBalances,
    setBalances,
    setUsdcBalance,
  };
}
