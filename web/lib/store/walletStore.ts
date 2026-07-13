import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WalletState {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  address: string | null;
  publicKey: string | null;
  walletId: string | null; // Which wallet module was used (e.g. 'freighter', 'wallet_connect')

  // Balances — null = unknown (read failed or not yet fetched).
  // Renders as '—'; NEVER coerce null to 0 (fabricates money data).
  xlmBalance: number | null;
  usdcBalance: number | null;
  noeBalance: number | null;

  // Actions
  setConnected: (address: string, publicKey: string, walletId?: string) => void;
  setDisconnected: () => void;
  setConnecting: (isConnecting: boolean) => void;
  setBalances: (xlm: number | null, usdc: number | null, noe: number | null) => void;
  setUsdcBalance: (usdc: number | null) => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      isConnected: false,
      isConnecting: false,
      address: null,
      publicKey: null,
      walletId: null,
      xlmBalance: null,
      usdcBalance: null,
      noeBalance: null,

      setConnected: (address, publicKey, walletId) =>
        set({
          isConnected: true,
          isConnecting: false,
          address,
          publicKey,
          ...(walletId !== undefined && { walletId }),
        }),

      setDisconnected: () =>
        set({
          isConnected: false,
          isConnecting: false,
          address: null,
          publicKey: null,
          walletId: null,
          xlmBalance: null,
          usdcBalance: null,
          noeBalance: null,
        }),

      setConnecting: (isConnecting) => set({ isConnecting }),

      setBalances: (xlmBalance, usdcBalance, noeBalance) =>
        set({ xlmBalance, usdcBalance, noeBalance }),

      setUsdcBalance: (usdcBalance) => set({ usdcBalance }),
    }),
    {
      name: 'noether-wallet',
      partialize: (state) => ({
        address: state.address,
        publicKey: state.publicKey,
        walletId: state.walletId,
      }),
    }
  )
);
