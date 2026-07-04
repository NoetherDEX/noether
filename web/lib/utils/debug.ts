/**
 * Dev-only logging helpers. No-op in production builds so tx build/submit
 * internals (XDR fragments, RPC responses) never reach the browser console
 * of real users.
 */
export function debugLog(...args: unknown[]): void {
  if (process.env.NODE_ENV === 'production') return;
  console.log(...args);
}

export function debugError(...args: unknown[]): void {
  if (process.env.NODE_ENV === 'production') return;
  console.error(...args);
}
