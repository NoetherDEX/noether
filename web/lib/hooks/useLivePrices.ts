'use client';

import { useEffect, useRef, useState } from 'react';
import {
  subscribeLivePrices,
  type PriceStreamStatus,
} from '@/lib/stellar/noeracle';
import { getPrice, priceToDisplay } from '@/lib/stellar/oracle';

interface Options {
  /** Connected wallet public key — enables the on-chain shim-poll fallback. */
  publicKey?: string | null;
  /** How often to poll the shim (ms) while the SSE stream is unhealthy. */
  fallbackPollMs?: number;
}

interface LivePricesResult {
  /** Latest human-readable price per asset symbol (e.g. `{ BTC: 64200.5 }`). */
  prices: Record<string, number>;
  /** Health of the Noeracle SSE stream. */
  status: PriceStreamStatus;
}

/**
 * Live Noeracle prices for a set of assets, with a staleness signal and an
 * on-chain shim-poll fallback (P0-9 / W-4).
 *
 * - Subscribes to the public ~500ms SSE stream (no auth needed), so prices
 *   display whether or not a wallet is connected.
 * - `status` is `live` while frames flow, `stale` if none arrive within the
 *   watchdog window, `connecting` on transport error/reconnect.
 * - While the stream is unhealthy AND a wallet is connected, polls the SEP-40
 *   shim every `fallbackPollMs` (default 5s) so marks keep moving. The shim read
 *   needs a funded source account, hence the `publicKey` gate.
 */
export function useLivePrices(
  assets: string[],
  { publicKey, fallbackPollMs = 5000 }: Options = {},
): LivePricesResult {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<PriceStreamStatus>('connecting');

  // Stable join so the effect only re-subscribes when the SET of assets changes,
  // not on every render that passes a fresh array reference.
  const key = Array.from(new Set(assets)).sort().join(',');

  // Keep the latest status readable inside the poll loop without re-arming it.
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const list = key ? key.split(',') : [];
    if (list.length === 0) return;

    let cancelled = false;

    const unsubscribe = subscribeLivePrices(
      list,
      ({ asset, price }) => {
        if (!cancelled) setPrices((prev) => ({ ...prev, [asset]: price }));
      },
      { onStatus: (s) => { if (!cancelled) setStatus(s); } },
    );

    // On-chain shim-poll fallback — only meaningful with a funded source account.
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    if (publicKey) {
      const poll = async () => {
        if (statusRef.current === 'live') return; // stream healthy — leave it to SSE
        await Promise.all(
          list.map(async (asset) => {
            const pd = await getPrice(publicKey, asset);
            if (pd && !cancelled) {
              setPrices((prev) => ({ ...prev, [asset]: priceToDisplay(pd.price) }));
            }
          }),
        );
      };
      // Seed once immediately for an accurate starting mark, then poll while unhealthy.
      void poll();
      pollTimer = setInterval(() => { void poll(); }, fallbackPollMs);
    }

    return () => {
      cancelled = true;
      unsubscribe();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [key, publicKey, fallbackPollMs]);

  return { prices, status };
}
