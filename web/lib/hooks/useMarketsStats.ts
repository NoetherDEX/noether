import { useQuery } from '@tanstack/react-query';
import { getMarketsStats, type MarketsStats } from '@/lib/api/markets';

/** Shared key so every consumer (stats bar, desktop + mobile order panels)
 *  rides one poller, and a submit can invalidate it. */
export const MARKETS_STATS_QUERY_KEY = ['markets-stats'] as const;

/**
 * GET /v1/markets/stats via the global QueryClient (web/app/providers.tsx):
 * one 10s poller for the whole trade page. The pool-capacity headroom in the
 * payload is advisory and moves with every ledger, so the cache goes stale
 * fast on purpose; `dataUpdatedAt` lets callers refuse data older than they
 * are willing to clamp on. A failed fetch resolves to null (no throw) and
 * the last good payload is dropped — never clamp on stale money.
 */
export function useMarketsStats() {
  return useQuery<MarketsStats | null>({
    queryKey: MARKETS_STATS_QUERY_KEY,
    queryFn: getMarketsStats,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}
