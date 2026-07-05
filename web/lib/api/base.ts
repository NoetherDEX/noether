/**
 * Single source of the Noether API gateway base URL (NEXT_PUBLIC_NOETHER_API_URL).
 *
 * LAZY by design: resolved at CALL time, never at module scope. A module-scope
 * throw breaks the Vercel production build (a documented incident in this repo
 * — see the constants.ts safety note), so this module must stay side-effect
 * free at import time.
 *
 * Behavior:
 * - env var set        → use it (trailing slashes stripped).
 * - unset, production  → THROW a clear, actionable error at call time. The old
 *   silent `?? 'http://localhost:4000'` fallback made referral/keys/vaults
 *   lookups silently dead on a misconfigured deploy — and rendered the
 *   localhost URL to users.
 * - unset, dev         → fall back to http://localhost:4000 with a ONE-TIME
 *   console.warn.
 */

let warnedDevFallback = false;

/** Resolve the gateway base URL. Throws in a production build when
 *  NEXT_PUBLIC_NOETHER_API_URL is unset — call inside try/catch (or use
 *  apiBaseOrNull) where an unconfigured gateway should degrade to '—'. */
export function apiBase(): string {
  // NOTE: both env references must stay as literal `process.env.X` expressions
  // so Next.js can inline them at build time.
  const configured = process.env.NEXT_PUBLIC_NOETHER_API_URL;
  if (configured) return configured.replace(/\/+$/, '');

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_NOETHER_API_URL is not set for this production build — the Noether API gateway address is unknown. ' +
        'Set it in the deploy environment (Vercel → Settings → Environment Variables) and redeploy.'
    );
  }

  if (!warnedDevFallback) {
    warnedDevFallback = true;
    console.warn(
      '[noether/api] NEXT_PUBLIC_NOETHER_API_URL is not set — falling back to http://localhost:4000 (dev only).'
    );
  }
  return 'http://localhost:4000';
}

/** Non-throwing variant for display-only contexts (e.g. rendering the
 *  "{base}/docs" link): null when the gateway is unconfigured in production. */
export function apiBaseOrNull(): string | null {
  try {
    return apiBase();
  } catch {
    return null;
  }
}
