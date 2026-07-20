import { nativeToScVal } from '@stellar/stellar-sdk';
import { TtlCache } from './cache.js';
import type { ContractReader } from './contractReader.js';

export interface AccountShortfall {
  address: string;
  /** i128 decimal string, 7-decimal USDC owed to this trader (L0-3). */
  owed: string;
  /** Global USDC earmarked for shortfall repayment (reserve bucket). */
  reserve: string;
  /** false = the deployed vault predates L0-3 (views absent) or the read
   *  failed — the web card hides rather than fabricating zeros-as-truth. */
  supported: boolean;
}

const SHORTFALL_TTL_MS = 5_000;

/**
 * GET /v1/account/shortfall backing service — chain reads of the L0-3
 * vault views (get_shortfall_owed / get_shortfall_reserve). Fail-soft by
 * design: a pre-Batch-1 vault or transport failure serves supported:false,
 * never a 5xx for a portfolio card.
 */
export class ShortfallService {
  private readonly cache = new TtlCache<AccountShortfall>(SHORTFALL_TTL_MS);

  constructor(
    private readonly reader: ContractReader,
    private readonly vaultId: string,
  ) {}

  async accountShortfall(address: string): Promise<AccountShortfall> {
    return this.cache.getOrLoad(address, async () => {
      if (!this.vaultId) return { address, owed: '0', reserve: '0', supported: false };
      try {
        const [owed, reserve] = await Promise.all([
          this.reader.read<bigint>(this.vaultId, 'get_shortfall_owed', [
            nativeToScVal(address, { type: 'address' }),
          ]),
          this.reader.read<bigint>(this.vaultId, 'get_shortfall_reserve', []),
        ]);
        return {
          address,
          owed: BigInt(owed ?? 0).toString(),
          reserve: BigInt(reserve ?? 0).toString(),
          supported: true,
        };
      } catch {
        return { address, owed: '0', reserve: '0', supported: false };
      }
    });
  }
}
