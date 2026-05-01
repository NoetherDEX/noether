import type { Network } from '@noether/types';
import { DEFAULT_RPC_URLS } from './network.js';

/**
 * Resolve the Soroban RPC URL list from environment.
 *
 * Order of precedence:
 *   1. `SOROBAN_RPC_URLS` (comma-separated list — primary first)
 *   2. `SOROBAN_RPC_URL`  (single URL)
 *   3. Network default (e.g. https://soroban-testnet.stellar.org)
 *
 * Most callers want only the primary URL — use `getPrimaryRpcUrl`. The
 * full list is exposed for active failover wrappers introduced in
 * later phases.
 */
export function getRpcUrls(network: Network, env: NodeJS.ProcessEnv = process.env): string[] {
  const list = env.SOROBAN_RPC_URLS;
  if (list) {
    return list
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const single = env.SOROBAN_RPC_URL;
  if (single) return [single.trim()];
  return [DEFAULT_RPC_URLS[network]];
}

export function getPrimaryRpcUrl(network: Network, env: NodeJS.ProcessEnv = process.env): string {
  return getRpcUrls(network, env)[0]!;
}
