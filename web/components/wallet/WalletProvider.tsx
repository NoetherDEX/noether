'use client';

import { ReactNode, createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useWalletStore } from '@/lib/store';
import { initWalletKit, getWalletAddress, restoreWalletSession, setupWalletModule, WALLETCONNECT_ID } from '@/lib/stellar/walletKit';
import { NETWORK, NOE_ASSET } from '@/lib/utils/constants';

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
 * Fetches the XLM balance AND the NOE trustline balance from one Horizon
 * account payload (NOE is a classic asset, so its line is in `balances`).
 * Fixes the "NOE balance always written as 0" bug — the real value was in
 * the payload we already fetched. No trustline genuinely means 0.
 */
async function fetchHorizonBalances(
  publicKey: string
): Promise<{ xlm: number | null; noe: number | null }> {
  try {
    const response = await fetch(`${NETWORK.HORIZON_URL}/accounts/${publicKey}`);

    if (!response.ok) {
      if (response.status === 404) {
        // Account not funded on testnet yet — both balances are genuinely 0.
        return { xlm: 0, noe: 0 };
      }
      throw new Error(`Horizon API error: ${response.status}`);
    }

    const data = await response.json();
    const balances: Array<{
      asset_type: string;
      asset_code?: string;
      asset_issuer?: string;
      balance: string;
    }> = data.balances ?? [];

    const nativeBalance = balances.find((b) => b.asset_type === 'native');
    const noeBalance = balances.find(
      (b) => b.asset_code === NOE_ASSET.CODE && b.asset_issuer === NOE_ASSET.ISSUER
    );

    return {
      xlm: nativeBalance ? parseFloat(nativeBalance.balance) : 0,
      noe: noeBalance ? parseFloat(noeBalance.balance) : 0,
    };
  } catch (error) {
    // Read FAILED — balances are unknown, not zero. Callers render '—'.
    console.error('Failed to fetch Horizon balances:', error);
    return { xlm: null, noe: null };
  }
}

/**
 * Lazily loads the USDC balance reader. The dynamic import keeps
 * @stellar/stellar-sdk (pulled in transitively by lib/stellar/token) out of
 * the initial/first-load JS bundle — it only loads once a balance is actually
 * fetched (i.e. after a wallet is connected), never on the marketing landing.
 */
async function fetchUSDCBalance(publicKey: string): Promise<number | null> {
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

    const [horizonBalances, usdcBalance] = await Promise.all([
      fetchHorizonBalances(currentPublicKey),
      fetchUSDCBalance(currentPublicKey),
    ]);
    setBalances(horizonBalances.xlm, usdcBalance, horizonBalances.noe);
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
          const [horizonBalances, usdcBalance] = await Promise.all([
            fetchHorizonBalances(storedKey),
            fetchUSDCBalance(storedKey),
          ]);
          if (!cancelled) setBalances(horizonBalances.xlm, usdcBalance, horizonBalances.noe);
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

            const [horizonBalances, usdcBalance] = await Promise.all([
              fetchHorizonBalances(result.address),
              fetchUSDCBalance(result.address),
            ]);
            if (!cancelled) setBalances(horizonBalances.xlm, usdcBalance, horizonBalances.noe);
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
