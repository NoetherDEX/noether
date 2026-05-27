import { create } from 'zustand';
import type { VaultRow } from '@/types/vault';

interface LeaderModeState {
  vault: VaultRow | null;
  setVault: (vault: VaultRow | null) => void;
}

export const useLeaderModeStore = create<LeaderModeState>((set) => ({
  vault: null,
  setVault: (vault) => set({ vault }),
}));
