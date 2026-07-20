/**
 * Claimable shortfall for a wallet (L0-3), from the gateway's chain-read
 * endpoint. null = gateway unreachable/unconfigured; supported:false = the
 * deployed vault predates the shortfall ledger — either way the card hides.
 */

import { apiBase } from './base';

export interface AccountShortfall {
  owed: bigint;
  reserve: bigint;
  supported: boolean;
}

export async function fetchAccountShortfall(address: string): Promise<AccountShortfall | null> {
  try {
    const res = await fetch(
      `${apiBase()}/v1/account/shortfall?address=${encodeURIComponent(address)}`,
      { headers: { accept: 'application/json' }, cache: 'no-store' },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { owed: string; reserve: string; supported: boolean };
    return { owed: BigInt(data.owed), reserve: BigInt(data.reserve), supported: data.supported };
  } catch {
    return null;
  }
}
