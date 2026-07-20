/**
 * Open positions feed sourced from the indexer projection.
 * Lets the leader-mode trade panel skip the contract-side
 * iterate-all-positions loop and hit the right ids directly.
 */

import { apiBase } from './base';

export interface OpenPositionRow {
  positionId: number;
  trader: string;
  asset: string;
  direction: number;
  size: string;
  entryPrice: string;
  openedAt: number;
  openedTxHash: string;
  /** L0-1 advisory ADL quintile (1 = first deleveraged); null/absent when
   *  not in the queue or the gateway predates the field. */
  adlQuintile?: number | null;
}

export async function listOpenPositions(trader: string): Promise<OpenPositionRow[]> {
  const res = await fetch(
    `${apiBase()}/v1/positions/open?trader=${encodeURIComponent(trader)}`,
    { headers: { accept: 'application/json' }, cache: 'no-store' },
  );
  if (!res.ok) {
    throw new Error(`positions api ${res.status}`);
  }
  const data = (await res.json()) as { positions: OpenPositionRow[] };
  return data.positions;
}
