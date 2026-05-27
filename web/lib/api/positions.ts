/**
 * Open positions feed sourced from the indexer projection.
 * Lets the leader-mode trade panel skip the contract-side
 * iterate-all-positions loop and hit the right ids directly.
 */

const API_BASE = process.env.NEXT_PUBLIC_NOETHER_API_URL ?? 'http://localhost:4000';

export interface OpenPositionRow {
  positionId: number;
  trader: string;
  asset: string;
  direction: number;
  size: string;
  entryPrice: string;
  openedAt: number;
  openedTxHash: string;
}

export async function listOpenPositions(trader: string): Promise<OpenPositionRow[]> {
  const res = await fetch(
    `${API_BASE}/v1/positions/open?trader=${encodeURIComponent(trader)}`,
    { headers: { accept: 'application/json' }, cache: 'no-store' },
  );
  if (!res.ok) {
    throw new Error(`positions api ${res.status}`);
  }
  const data = (await res.json()) as { positions: OpenPositionRow[] };
  return data.positions;
}
