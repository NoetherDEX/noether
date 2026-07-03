/**
 * Dev-only console logging.
 *
 * `process.env.NODE_ENV` is statically inlined by Next.js, so in a production
 * build these collapse to `if (false) { ... }` and the calls are dropped — no
 * `[DEBUG]` transaction/XDR noise (or its overhead) ships to users.
 */
const DEBUG_ENABLED = process.env.NODE_ENV !== 'production';

export function debugLog(...args: unknown[]): void {
  if (DEBUG_ENABLED) console.log(...args);
}

export function debugError(...args: unknown[]): void {
  if (DEBUG_ENABLED) console.error(...args);
}
