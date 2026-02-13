'use client';

import { ReactNode, createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useWalletStore } from '@/lib/store';
import { getUSDCBalance } from '@/lib/stellar/token';
import { initWalletKit, getWalletAddress } from '@/lib/stellar/walletKit';

// Horizon Testnet URL for balance fetching
const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';

interface WalletContextType {
  isReady: boolean;
  refreshBalance: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType>({
  isReady: false,
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
        console.log('Account not found on testnet - may need to be funded');
        return 0;
      }
      throw new Error(`Horizon API error: ${response.status}`);
    }

    const data = await response.json();

    const nativeBalance = data.balances?.find(
      (b: { asset_type: string; balance: string }) => b.asset_type === 'native'
    );

    if (nativeBalance) {
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
  const { setConnected, setDisconnected, setBalances } = useWalletStore();

  // Refresh balance function - can be called manually after trades/deposits
  const refreshBalance = useCallback(async () => {
    const currentPublicKey = useWalletStore.getState().publicKey;
    if (!currentPublicKey) return;

    const [xlmBalance, usdcBalance] = await Promise.all([
      fetchXLMBalance(currentPublicKey),
      getUSDCBalance(currentPublicKey),
    ]);
    setBalances(xlmBalance, usdcBalance, 0);
  }, [setBalances]);

  // Initialize wallet kit and attempt auto-reconnect from persisted state
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        // Initialize the wallet kit (registers all wallet modules)
        await initWalletKit();

        // Check if we have a previously connected wallet in the persisted store
        const { publicKey: storedKey } = useWalletStore.getState();
        if (storedKey) {
          try {
            // Try to restore session via the kit
            const { address } = await getWalletAddress();
            if (cancelled || !address) {
              if (!address) setDisconnected();
              setIsReady(true);
              return;
            }

            setConnected(address, address);

            // Fetch initial balances
            const [xlmBalance, usdcBalance] = await Promise.all([
              fetchXLMBalance(address),
              getUSDCBalance(address),
            ]);
            if (!cancelled) {
              setBalances(xlmBalance, usdcBalance, 0);
            }
          } catch {
            // Previous session no longer valid
            if (!cancelled) setDisconnected();
          }
        }
      } catch {
        // Kit init failed — still mark as ready so the UI isn't stuck
        console.error('Failed to initialize wallet kit');
      }

      if (!cancelled) setIsReady(true);
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [setConnected, setDisconnected, setBalances]);

  return (
    <WalletContext.Provider value={{ isReady, refreshBalance }}>
      {children}
    </WalletContext.Provider>
  );
}
