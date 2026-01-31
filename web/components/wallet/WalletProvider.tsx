'use client';

import { ReactNode, createContext, useContext, useEffect, useState, useCallback } from 'react';
import { isConnected as checkIsConnected, isAllowed, getPublicKey, getNetwork } from '@stellar/freighter-api';
import { useWalletStore } from '@/lib/store';
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
  const { setConnected, setDisconnected, setBalances } = useWalletStore();

  // Refresh balance function - can be called manually after trades/deposits
  const refreshBalance = useCallback(async () => {
    const currentPublicKey = useWalletStore.getState().publicKey;
    if (!currentPublicKey) return;

    const [xlmBalance, usdcBalance] = await Promise.all([
      fetchXLMBalance(currentPublicKey),
      getUSDCBalance(currentPublicKey),
    ]);
    setBalances(xlmBalance, usdcBalance, 0); // NOE balance would come from contract
  }, [setBalances]);

  // Initial setup - check for Freighter and existing connection (runs once on mount)
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        // Check if Freighter is available (client-side only)
        const connected = await checkIsConnected();
        if (cancelled) return;

        setHasFreighter(true);

        if (connected) {
          // Check if user previously granted permission to this app
          // Only auto-reconnect if permission was already granted (no popup)
          const allowed = await isAllowed();
          if (cancelled) return;

          if (!allowed) {
            // User hasn't granted permission yet - don't trigger popup
            // Wait for them to click "Connect Wallet"
            setIsReady(true);
            return;
          }

          try {
            const pubKey = await getPublicKey();
            if (cancelled || !pubKey) {
              if (!pubKey) setDisconnected();
              setIsReady(true);
              return;
            }

            // Verify we're on testnet
            const network = await getNetwork();
            if (network !== 'TESTNET' && network !== 'testnet') {
              console.warn(`Connected to ${network}, please switch to TESTNET in Freighter`);
            }

            setConnected(pubKey, pubKey);

            // Fetch initial balances
            const [xlmBalance, usdcBalance] = await Promise.all([
              fetchXLMBalance(pubKey),
              getUSDCBalance(pubKey),
            ]);
            if (!cancelled) {
              setBalances(xlmBalance, usdcBalance, 0);
            }
          } catch {
            // Not connected or not allowed
            if (!cancelled) setDisconnected();
          }
        }
      } catch {
        // Freighter not installed
        if (!cancelled) setHasFreighter(false);
      }

      if (!cancelled) setIsReady(true);
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [setConnected, setDisconnected, setBalances]);

  return (
    <WalletContext.Provider value={{ isReady, hasFreighter, refreshBalance }}>
      {children}
    </WalletContext.Provider>
  );
}
