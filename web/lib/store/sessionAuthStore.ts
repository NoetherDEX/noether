import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface SessionAuthState {
  keyId: string | null;
  secret: string | null;
  owner: string | null;
  setAuth: (input: { keyId: string; secret: string; owner: string }) => void;
  clearAuth: () => void;
}

// B26: persisted to sessionStorage — memory-only auth meant every page
// refresh minted a brand-new PERMANENT server-side API key (credential
// sprawl with no revoke surface). sessionStorage survives refresh but dies
// with the tab, so a live secret never sits in localStorage.
export const useSessionAuthStore = create<SessionAuthState>()(
  persist(
    (set) => ({
      keyId: null,
      secret: null,
      owner: null,
      setAuth: ({ keyId, secret, owner }) => set({ keyId, secret, owner }),
      clearAuth: () => set({ keyId: null, secret: null, owner: null }),
    }),
    {
      name: 'noether-session-auth',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);

export function getSessionAuth(): { keyId: string; secret: string } | null {
  const { keyId, secret } = useSessionAuthStore.getState();
  if (!keyId || !secret) return null;
  return { keyId, secret };
}

/** Sign out AND kill the key server-side (best-effort) — a session key that
 *  outlives its session is exactly the sprawl B26 flagged. */
export async function signOutAndRevoke(): Promise<void> {
  const { keyId, secret } = useSessionAuthStore.getState();
  useSessionAuthStore.getState().clearAuth();
  if (keyId && secret) {
    try {
      const { revokeApiKey } = await import('@/lib/api/keys');
      await revokeApiKey({ keyId, secret }, keyId);
    } catch {
      // Revocation is best-effort — the local session is already gone.
    }
  }
}
