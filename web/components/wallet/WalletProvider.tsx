'use client';

import { ReactNode, createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { isConnected as checkIsConnected, getPublicKey, getNetwork } from '@stellar/freighter-api';
import { useWalletStore } from '@/lib/store';
import { NETWORK } from '@/lib/utils/constants';
import { getUSDCBalance } from '@/lib/stellar/token';

// Horizon Testnet URL for balance fetching
const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';

interface WalletContextType {
  isReady: boolean;
  hasFreighter: boolean;
  refreshBalance: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType>({
  isReady: false,
  hasFreighter: false,
  refreshBalance: async () => {},
});

export function useWalletContext() {
  return useContext(WalletContext);
}

interface WalletProviderProps {
  children: ReactNode;
}

/**
 * Fetches XLM balance from Horizon Testnet API
 * Returns balance in XLM (not stroops)
 */
async function fetchXLMBalance(publicKey: string): Promise<number> {
  try {
    const response = await fetch(`${HORIZON_TESTNET_URL}/accounts/${publicKey}`);

    if (!response.ok) {
      if (response.status === 404) {
        // Account not found - not funded yet
        console.log('Account not found on testnet - may need to be funded');
        return 0;
      }
      throw new Error(`Horizon API error: ${response.status}`);
    }

    const data = await response.json();

    // Find native XLM balance
    const nativeBalance = data.balances?.find(
      (b: { asset_type: string; balance: string }) => b.asset_type === 'native'
    );

    if (nativeBalance) {
      // Balance is already in XLM from Horizon (not stroops)
      return parseFloat(nativeBalance.balance);
    }

    return 0;
  } catch (error) {
    console.error('Failed to fetch XLM balance:', error);
    return 0;
  }
}

export function WalletProvider({ children }: WalletProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const [hasFreighter, setHasFreighter] = useState(false);
  const { setConnected, setDisconnected, setBalances, publicKey, isConnected } = useWalletStore();

  // Track previous public key to detect account changes
  const previousPublicKeyRef = useRef<string | null>(null);

  // Refresh balance function
  const refreshBalance = useCallback(async () => {
    const currentPublicKey = useWalletStore.getState().publicKey;
    if (!currentPublicKey) return;

    const [xlmBalance, usdcBalance] = await Promise.all([
      fetchXLMBalance(currentPublicKey),
      getUSDCBalance(currentPublicKey),
    ]);
    setBalances(xlmBalance, usdcBalance, 0); // GLP balance would come from contract
  }, [setBalances]);

  // Initial setup - check for Freighter and existing connection
  useEffect(() => {
    const init = async () => {
      try {
        // Check if Freighter is available (client-side only)
        const connected = await checkIsConnected();
        setHasFreighter(true);

        if (connected) {
          try {
            const pubKey = await getPublicKey();
            if (pubKey) {
              // Verify we're on testnet
              const network = await getNetwork();
              if (network !== 'TESTNET' && network !== 'testnet') {
                console.warn(`Connected to ${network}, please switch to TESTNET in Freighter`);
              }

              setConnected(pubKey, pubKey);
              previousPublicKeyRef.current = pubKey;

              // Fetch initial balances
              const [xlmBalance, usdcBalance] = await Promise.all([
                fetchXLMBalance(pubKey),
                getUSDCBalance(pubKey),
              ]);
              setBalances(xlmBalance, usdcBalance, 0);
            }
          } catch {
            // Not connected or not allowed
            setDisconnected();
          }
        }
      } catch {
        // Freighter not installed
        setHasFreighter(false);
      }

      setIsReady(true);
    };

    init();
  }, [setConnected, setDisconnected, setBalances]);

  // Poll for account changes every 2 seconds
  useEffect(() => {
    if (!hasFreighter) return;

    const checkForAccountChange = async () => {
      try {
        const connected = await checkIsConnected();

        if (connected) {
          const currentPubKey = await getPublicKey();
          const storeState = useWalletStore.getState();

          // Check if account changed
          if (currentPubKey && currentPubKey !== previousPublicKeyRef.current) {
            console.log('Account changed detected:', currentPubKey);
            previousPublicKeyRef.current = currentPubKey;

            // Update store with new account
            setConnected(currentPubKey, currentPubKey);

            // Fetch new balances
            const [xlmBalance, usdcBalance] = await Promise.all([
              fetchXLMBalance(currentPubKey),
              getUSDCBalance(currentPubKey),
            ]);
            setBalances(xlmBalance, usdcBalance, 0);
          } else if (storeState.isConnected && storeState.publicKey) {
            // Refresh balance periodically even if account didn't change
            const [xlmBalance, usdcBalance] = await Promise.all([
              fetchXLMBalance(storeState.publicKey),
              getUSDCBalance(storeState.publicKey),
            ]);
            setBalances(xlmBalance, usdcBalance, 0);
          }
        } else if (useWalletStore.getState().isConnected) {
          // Was connected but now disconnected
          setDisconnected();
          previousPublicKeyRef.current = null;
        }
      } catch (error) {
        console.error('Error checking for account change:', error);
      }
    };

    // Start polling
    const interval = setInterval(checkForAccountChange, 2000);

    return () => clearInterval(interval);
  }, [hasFreighter, setConnected, setDisconnected, setBalances]);

  return (
    <WalletContext.Provider value={{ isReady, hasFreighter, refreshBalance }}>
      {children}
    </WalletContext.Provider>
  );
}
