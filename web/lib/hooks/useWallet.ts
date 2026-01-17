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
    glpBalance,
    setConnected,
    setDisconnected,
    setConnecting,
    setBalances,
  } = useWalletStore();

  const connect = useCallback(async () => {
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

      // Fetch and set balance immediately after connecting
      const xlmBal = await fetchXLMBalance(pubKey);
      setBalances(xlmBal, 0);

      return pubKey;
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      setDisconnected();
      throw error;
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

      const signedXdr = await signTransaction(xdr, {
        networkPassphrase: NETWORK.PASSPHRASE,
      });

      return signedXdr;
    },
    [isConnected]
  );

  return {
    isConnected,
    isConnecting,
    address,
    publicKey,
    xlmBalance,
    glpBalance,
    connect,
    disconnect,
    sign,
    setBalances,
  };
}
