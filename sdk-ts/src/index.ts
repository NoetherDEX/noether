/**
 * @noether/sdk — Phase 1 skeleton.
 *
 * The full client surface (markets, account, orders, ws, vaults, referral)
 * lands across Phases 5-12. For now we only export the client class and
 * shared domain types so consumers can start writing against the type
 * surface as it solidifies.
 */

export { NoetherClient, type NoetherClientOptions } from './client.js';
export * from '@noether/types';
