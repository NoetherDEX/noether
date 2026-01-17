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
  glpBalance: number;

  // Actions
  setConnected: (address: string, publicKey: string) => void;
  setDisconnected: () => void;
  setConnecting: (isConnecting: boolean) => void;
  setBalances: (xlm: number, glp: number) => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      isConnected: false,
      isConnecting: false,
      address: null,
      publicKey: null,
      xlmBalance: 0,
      glpBalance: 0,

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
          glpBalance: 0,
        }),

      setConnecting: (isConnecting) => set({ isConnecting }),

      setBalances: (xlmBalance, glpBalance) =>
        set({ xlmBalance, glpBalance }),
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
