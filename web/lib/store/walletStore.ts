import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WalletState {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  address: string | null;
  publicKey: string | null;

  // Balances
  xlmBalance: number;
  usdcBalance: number;
  noeBalance: number;

  // Actions
  setConnected: (address: string, publicKey: string) => void;
  setDisconnected: () => void;
  setConnecting: (isConnecting: boolean) => void;
  setBalances: (xlm: number, usdc: number, noe: number) => void;
  setUsdcBalance: (usdc: number) => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      isConnected: false,
      isConnecting: false,
      address: null,
      publicKey: null,
      xlmBalance: 0,
      usdcBalance: 0,
      noeBalance: 0,

      setConnected: (address, publicKey) =>
        set({
          isConnected: true,
          isConnecting: false,
          address,
          publicKey,
        }),

      setDisconnected: () =>
        set({
          isConnected: false,
          isConnecting: false,
          address: null,
          publicKey: null,
          xlmBalance: 0,
          usdcBalance: 0,
          noeBalance: 0,
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
      }),
    }
  )
);
