/**
 * Deployed-contract capability detection.
 *
 * The Batch-1 fresh deploy adds every new market entry point at once
 * (partial close, add/remove collateral, pause state, …), so ONE probe of
 * the cheapest new view — get_pause_state — answers "does the deployed
 * market have the Batch-1 surface?" for all of them. Probe-once, cached;
 * a null read (old market OR transient RPC failure) resolves false and
 * clears the memo so a later call may re-probe.
 *
 * Keeps the new UI inert against the pre-Batch-1 chain without a coupled
 * web deploy at the contract flip.
 */

import { getPauseState } from './market';

let memo: Promise<boolean> | null = null;

export function marketHasBatch1Features(): Promise<boolean> {
  if (!memo) {
    memo = getPauseState().then((state) => {
      if (state === null) memo = null; // allow a later re-probe
      return state !== null;
    });
  }
  return memo;
}
