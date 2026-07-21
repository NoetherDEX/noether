import { TtlCache } from './cache.js';
import type { ContractReader } from './contractReader.js';

export interface MarketPauseState {
  /** false = the deployed market predates L0-15 (view absent) or the read
   *  failed — consumers treat unknown as "not paused", never as mode 0 truth. */
  supported: boolean;
  /** 0 live / 1 halt-open (exit-only) / 2 full-freeze. null when unsupported. */
  mode: number | null;
  /** Unix seconds the current mode was entered. null when unsupported. */
  since: number | null;
}

const PAUSE_TTL_MS = 15_000;

/**
 * /v1/health `market.pauseState` backing service — one cached chain read of
 * the L0-15 `get_pause_state` view (returns the effective mode, i.e. the
 * 72h full-freeze auto-degrade is already applied read-side). Fail-soft:
 * a pre-Batch-1 market or transport failure serves supported:false.
 */
export class PauseStateService {
  private readonly cache = new TtlCache<MarketPauseState>(PAUSE_TTL_MS);

  constructor(
    private readonly reader: ContractReader,
    private readonly marketId: string,
  ) {}

  async pauseState(): Promise<MarketPauseState> {
    return this.cache.getOrLoad('pause', async () => {
      if (!this.marketId) return { supported: false, mode: null, since: null };
      try {
        const state = await this.reader.read<[number | bigint, number | bigint]>(
          this.marketId,
          'get_pause_state',
          [],
        );
        if (!Array.isArray(state) || state.length < 2) {
          return { supported: false, mode: null, since: null };
        }
        return {
          supported: true,
          mode: Number(state[0]),
          since: Number(state[1]),
        };
      } catch {
        return { supported: false, mode: null, since: null };
      }
    });
  }
}
