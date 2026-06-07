'use client';

import { ReactNode, createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useWalletStore } from '@/lib/store';
import { initWalletKit, getWalletAddress, restoreWalletSession, setupWalletModule, WALLETCONNECT_ID } from '@/lib/stellar/walletKit';

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

/**
 * Lazily loads the USDC balance reader. The dynamic import keeps
 * @stellar/stellar-sdk (pulled in transitively by lib/stellar/token) out of
 * the initial/first-load JS bundle — it only loads once a balance is actually
 * fetched (i.e. after a wallet is connected), never on the marketing landing.
 */
async function fetchUSDCBalance(publicKey: string): Promise<number> {
  const { getUSDCBalance } = await import('@/lib/stellar/token');
  return getUSDCBalance(publicKey);
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
      fetchUSDCBalance(currentPublicKey),
    ]);
    setBalances(xlmBalance, usdcBalance, 0);
  }, [setBalances]);

  // Initialize wallet kit and attempt auto-reconnect from persisted state
  useEffect(() => {
    let cancelled = false;

    const { publicKey: storedKey, walletId: storedWalletId } = useWalletStore.getState();

    // Extension wallets (Freighter, xBull, etc.): restore immediately from stored data.
    // No async wallet API calls needed — avoids popup AND avoids slow kit init blocking the UI.
    if (storedKey && storedWalletId && storedWalletId !== WALLETCONNECT_ID) {
      setConnected(storedKey, storedKey, storedWalletId);
      setIsReady(true);

      // Background: fetch balances + init kit for future signing
      (async () => {
        try {
          const [xlmBalance, usdcBalance] = await Promise.all([
            fetchXLMBalance(storedKey),
            fetchUSDCBalance(storedKey),
          ]);
          if (!cancelled) setBalances(xlmBalance, usdcBalance, 0);
        } catch {}

        // Set up wallet module so signing works later
        try {
          await initWalletKit();
          await setupWalletModule(storedWalletId, storedKey);
        } catch {}
      })();

      return () => { cancelled = true; };
    }

    // WalletConnect or no stored wallet: full async init
    const init = async () => {
      try {
        await initWalletKit();

        if (storedKey && storedWalletId === WALLETCONNECT_ID) {
          try {
            const result = await restoreWalletSession(storedWalletId, storedKey);
            if (cancelled) { setIsReady(true); return; }

            if (!result) {
              setDisconnected();
              setIsReady(true);
              return;
            }

            setConnected(result.address, result.address, storedWalletId);

            const [xlmBalance, usdcBalance] = await Promise.all([
              fetchXLMBalance(result.address),
              fetchUSDCBalance(result.address),
            ]);
            if (!cancelled) setBalances(xlmBalance, usdcBalance, 0);
          } catch {
            if (!cancelled) setDisconnected();
          }
        } else if (storedKey) {
          // Legacy: no walletId stored, clear stale state
          setDisconnected();
        }
      } catch {
        console.error('Failed to initialize wallet kit');
      }

      if (!cancelled) setIsReady(true);
    };

    init();

    return () => { cancelled = true; };
  }, [setConnected, setDisconnected, setBalances]);

  return (
    <WalletContext.Provider value={{ isReady, refreshBalance }}>
      {children}
    </WalletContext.Provider>
  );
}
