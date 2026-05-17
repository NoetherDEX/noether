/**
 * Client-side `?ref=CODE` capture.
 *
 * Reads the URL once on first load, validates the format (3..16 chars,
 * alphanumeric + dash/underscore), and parks it in localStorage. Pages
 * that handle wallet auth can later call `consumePendingReferral()`
 * to retrieve and clear the pending code right before issuing the
 * `set_referrer` transaction.
 *
 * Pure browser helpers; SSR-safe (returns null when window is absent).
 */

const STORAGE_KEY = 'noether.pending_ref';
const QUERY_KEY = 'ref';
const CODE_PATTERN = /^[A-Za-z0-9_-]{3,16}$/;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/** Capture from window.location, stash in localStorage, return the code. */
export function captureReferralFromLocation(): string | null {
  if (!isBrowser()) return null;
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get(QUERY_KEY);
    if (!raw) return null;
    if (!CODE_PATTERN.test(raw)) return null;
    window.localStorage.setItem(STORAGE_KEY, raw);
    // Strip the query param so subsequent shares of the URL don't
    // re-trigger capture.
    url.searchParams.delete(QUERY_KEY);
    window.history.replaceState({}, '', url.toString());
    return raw;
  } catch {
    return null;
  }
}

export function getPendingReferral(): string | null {
  if (!isBrowser()) return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && CODE_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function consumePendingReferral(): string | null {
  if (!isBrowser()) return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    window.localStorage.removeItem(STORAGE_KEY);
    return value && CODE_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearPendingReferral(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
