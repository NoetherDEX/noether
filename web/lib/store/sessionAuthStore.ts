import { create } from 'zustand';

interface SessionAuthState {
  keyId: string | null;
  secret: string | null;
  owner: string | null;
  setAuth: (input: { keyId: string; secret: string; owner: string }) => void;
  clearAuth: () => void;
}

export const useSessionAuthStore = create<SessionAuthState>((set) => ({
  keyId: null,
  secret: null,
  owner: null,
  setAuth: ({ keyId, secret, owner }) => set({ keyId, secret, owner }),
  clearAuth: () => set({ keyId: null, secret: null, owner: null }),
}));

export function getSessionAuth(): { keyId: string; secret: string } | null {
  const { keyId, secret } = useSessionAuthStore.getState();
  if (!keyId || !secret) return null;
  return { keyId, secret };
}
