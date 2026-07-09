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

/** Error carrying the gateway's HTTP status + machine code alongside a
 *  user-readable message, so callers can branch on `.status` / `.code`
 *  instead of string-matching the message. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Build an ApiError from a non-OK gateway Response with user-readable copy.
 *
 * Remaps the two statuses that previously surfaced as raw
 * "<status> <statusText>: <body>" toasts — 429 (rate limit) and 5xx (server) —
 * to friendly text. Every other status keeps its original raw string so
 * existing component-level handling (e.g. 403 `not_in_beta`, 401
 * `invalid_signature`, 404) that matches on that string is unaffected. Reads
 * the response body exactly once.
 */
export async function apiError(res: Response, fallbackPath?: string): Promise<ApiError> {
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    // body unavailable / already consumed — fall through with empty text
  }

  let envelope: { error?: string; message?: string; retry_after_sec?: number } | null = null;
  try {
    envelope = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    // non-JSON body (e.g. Fastify plain-text default) — leave envelope null
  }
  const code = envelope?.error;

  if (res.status === 429) {
    const secs = envelope?.retry_after_sec ?? retryAfterSeconds(res);
    const when = secs && secs > 0 ? `try again in ${secs}s` : 'please wait a moment and try again';
    return new ApiError(429, `You're sending requests too quickly — ${when}`, code);
  }
  if (res.status >= 500) {
    return new ApiError(
      res.status,
      'The Noether API is temporarily unavailable — please try again in a moment',
      code
    );
  }
  return new ApiError(
    res.status,
    `${res.status} ${res.statusText}: ${bodyText || fallbackPath || ''}`.trim(),
    code
  );
}

function retryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
