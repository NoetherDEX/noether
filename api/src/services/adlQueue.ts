import { Address, nativeToScVal, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import type { Db } from '@noether/db';
import { TtlCache } from './cache.js';
import type { OracleService } from './oracle.js';

/**
 * L0-1 ADL queue (advisory, Binance-style): who gets auto-deleveraged
 * first if the pool's coverage fails. The positions projection lacks
 * collateral/leverage (position_opened doesn't carry them), so full
 * Position structs are bulk-hydrated straight from ledger entries —
 * DataKey::Position(u64) contract-data reads, batched ≤200 keys/request.
 * Works against the CURRENT deployed market (Position storage is T1-era);
 * only the on-chain ADL flag itself is Batch-1.
 */

export interface AdlQueueRow {
  positionId: number;
  trader: string;
  asset: string;
  direction: number;
  /** 7-decimal strings — i128-safe. */
  size: string;
  pnl: string;
  score: string;
  /** 1 = first to be deleveraged. */
  rank: number;
  /** 1..5 among positive-pnl positions (1 = highest ADL priority). */
  quintile: number;
}

export interface AdlQueueResult {
  asset: string;
  updatedAt: number;
  /** true = the ranking could not be computed this window (RPC/oracle down)
   *  — an empty degraded queue is "unknown", never "nobody is at risk". */
  degraded: boolean;
  rows: AdlQueueRow[];
}

export interface AdlPositionState {
  positionId: number;
  trader: string;
  direction: number; // 0 = Long, 1 = Short
  collateral: bigint;
  size: bigint;
  entryPrice: bigint;
  leverage: number;
}

const PRECISION_BPS = 10_000n;

/**
 * Pure ranking per the L0-1 formula: score = pnl>0 ? (pnl×10_000/collateral)
 * ×leverage : 0. Winners sorted by score desc (ties → lower id first),
 * quintiles assigned 1..5 across the sorted winners. Losers never queue.
 */
export function rankAdlQueue(
  positions: AdlPositionState[],
  mark: bigint,
  asset: string,
): AdlQueueRow[] {
  const winners: Array<AdlPositionState & { pnl: bigint; score: bigint }> = [];
  for (const position of positions) {
    if (position.entryPrice <= 0n || position.collateral <= 0n) continue;
    const diff =
      position.direction === 0 ? mark - position.entryPrice : position.entryPrice - mark;
    const pnl = (position.size * diff) / position.entryPrice;
    if (pnl <= 0n) continue;
    winners.push({
      ...position,
      pnl,
      score: ((pnl * PRECISION_BPS) / position.collateral) * BigInt(position.leverage),
    });
  }
  winners.sort((a, b) => {
    if (a.score !== b.score) return b.score > a.score ? 1 : -1;
    return a.positionId - b.positionId;
  });
  const count = winners.length;
  return winners.map((winner, index) => ({
    positionId: winner.positionId,
    trader: winner.trader,
    asset,
    direction: winner.direction,
    size: winner.size.toString(),
    pnl: winner.pnl.toString(),
    score: winner.score.toString(),
    rank: index + 1,
    quintile: Math.min(5, Math.floor((index * 5) / count) + 1),
  }));
}

/** Decode one Position contract-data ledger entry (exported for tests). */
export function decodePositionEntry(val: xdr.LedgerEntryData): AdlPositionState | null {
  try {
    const native = scValToNative(val.contractData().val()) as Record<string, unknown>;
    const rawDirection = native.direction;
    const direction = Array.isArray(rawDirection)
      ? String(rawDirection[0]) === 'Long'
        ? 0
        : 1
      : typeof rawDirection === 'string'
        ? rawDirection === 'Long'
          ? 0
          : 1
        : Number(rawDirection ?? 0);
    return {
      positionId: Number(native.id),
      trader: String(native.trader),
      direction,
      collateral: BigInt((native.collateral as bigint | number) ?? 0),
      size: BigInt((native.size as bigint | number) ?? 0),
      entryPrice: BigInt((native.entry_price as bigint | number) ?? 0),
      leverage: Number(native.leverage ?? 0),
    };
  } catch {
    return null;
  }
}

const ADL_TTL_MS = 30_000;
const LEDGER_KEY_CHUNK = 200;
const MAX_POSITIONS_PER_ASSET = 1_000;

export interface AdlQueueOpts {
  db: Db;
  oracle: OracleService;
  marketContractId: string;
  rpcUrl: string;
  /** Test seam — replaces the ledger-entry hydration entirely. */
  hydratePositions?: (ids: number[]) => Promise<AdlPositionState[]>;
}

export class AdlQueueService {
  private readonly cache = new TtlCache<AdlQueueResult>(ADL_TTL_MS);
  private readonly server: rpc.Server | null;

  constructor(private readonly opts: AdlQueueOpts) {
    this.server = opts.hydratePositions
      ? null
      : new rpc.Server(opts.rpcUrl, { allowHttp: opts.rpcUrl.startsWith('http://') });
  }

  async queue(asset: string): Promise<AdlQueueResult> {
    return this.cache.getOrLoad(asset, () => this.compute(asset));
  }

  /** adlQuintile per open position id (merged into /v1/positions/open). */
  async quintiles(asset: string): Promise<Map<number, number>> {
    const result = await this.queue(asset);
    return new Map(result.rows.map((row) => [row.positionId, row.quintile]));
  }

  private async compute(asset: string): Promise<AdlQueueResult> {
    try {
      const result = await this.opts.db.execute({
        sql: 'SELECT position_id FROM positions WHERE asset = ? LIMIT ?',
        args: [asset, MAX_POSITIONS_PER_ASSET],
      });
      const ids = (result.rows as unknown as Array<{ position_id: number | bigint }>).map((r) =>
        Number(r.position_id),
      );
      if (ids.length === 0) {
        return { asset, updatedAt: Date.now(), degraded: false, rows: [] };
      }
      const mark = (await this.opts.oracle.getPrice(asset)).price;
      const positions = this.opts.hydratePositions
        ? await this.opts.hydratePositions(ids)
        : await this.hydrateFromLedger(ids);
      return { asset, updatedAt: Date.now(), degraded: false, rows: rankAdlQueue(positions, mark, asset) };
    } catch {
      // Unknown ≠ safe: flag it so clients render "queue unavailable",
      // never "nobody is in the ADL queue".
      return { asset, updatedAt: Date.now(), degraded: true, rows: [] };
    }
  }

  private async hydrateFromLedger(ids: number[]): Promise<AdlPositionState[]> {
    const out: AdlPositionState[] = [];
    for (let i = 0; i < ids.length; i += LEDGER_KEY_CHUNK) {
      const keys = ids.slice(i, i + LEDGER_KEY_CHUNK).map((id) =>
        xdr.LedgerKey.contractData(
          new xdr.LedgerKeyContractData({
            contract: new Address(this.opts.marketContractId).toScAddress(),
            key: xdr.ScVal.scvVec([
              xdr.ScVal.scvSymbol('Position'),
              nativeToScVal(BigInt(id), { type: 'u64' }),
            ]),
            durability: xdr.ContractDataDurability.persistent(),
          }),
        ),
      );
      const response = await this.server!.getLedgerEntries(...keys);
      for (const entry of response.entries ?? []) {
        const decoded = decodePositionEntry(entry.val);
        if (decoded) out.push(decoded);
      }
    }
    return out;
  }
}
