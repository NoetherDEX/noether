/**
 * Pool-capacity headroom (L1-13) — how much notional each market can still
 * take per side before the vault's reserve_for_position gates reject the open
 * (#82 aggregate / per-side OI caps, #89 net-skew cap, InsufficientLiquidity
 * physical floor). Feeds the OrderPanel clamp and the SDKs through
 * GET /v1/markets/stats.
 *
 * Reads EXACTLY the inputs the contract checks: the vault's live views
 * (get_aum, get_reserved_payout, get_usdc_balance, get_shortfall_reserve)
 * plus the market's AssetExposure(asset) ledger entries — not the indexer
 * projection, which can lag or clamp. The math lives in @noether/shared
 * (`computeHeadroom`) with a parity test against the vault predicate.
 *
 * Money-truth rule: a failed read yields `null`, and the route omits the
 * fields. Nothing here is ever rendered as a zero it did not read. A recent
 * good snapshot is served for a short grace window flagged `stale: true`.
 */

import { nativeToScVal } from '@stellar/stellar-sdk';
import {
  SUPPORTED_ASSET_SYMBOLS,
  computeHeadroom,
  type CapacityBinding,
  type CapacityInputs,
} from '@noether/shared';
import type { ContractReader } from './contractReader.js';
import { withTimeout } from './timeout.js';

export interface AssetCapacity {
  /** Largest notional the vault accepts for a new long/short right now. 7-dec USDC strings. */
  headroomLong: string;
  headroomShort: string;
  bindingLong: CapacityBinding;
  bindingShort: CapacityBinding;
  /** Chain AssetExposure (long_size, short_size, long − short) — the vault's exact inputs. */
  oiLong: string;
  oiShort: string;
  netSkew: string;
  /** Effective per-side cap now = min(AUM × assetCapBps, capAbs when set). */
  sideCap: string;
  /** AUM × skewCapBps / 10_000. */
  skewCap: string;
  assetCapBps: number;
  capAbs: string;
  skewCapBps: number;
  /** market.get_asset_risk(asset).max_position_size; null when unset. */
  maxPositionSize: string | null;
}

export interface PoolCapacity {
  aum: string;
  reservedPayout: string;
  usdcBalance: string;
  shortfallReserve: string;
  reserveCapBps: number;
  reserveCap: string;
  /** min(reserveCap − reserved, usdc − shortfall − reserved), floored at 0. */
  aggregateHeadroom: string;
  aggregateBinding: 'aggregate' | 'liquidity';
  /** Ledger the AssetExposure entries were read at; null when unknown. */
  asOfLedger: number | null;
  /** Unix ms when the snapshot was computed. */
  ts: number;
  /** True when served past its TTL because the refresh failed. */
  stale: boolean;
}

export interface CapacitySnapshot {
  pool: PoolCapacity;
  assets: Record<string, AssetCapacity>;
}

/** Admin-set parameters: change only by admin invoke, cached for minutes. */
interface VaultParams {
  reserveCapBps: number;
  perAsset: Record<
    string,
    { assetCapBps: number; capAbs: bigint; skewCapBps: number; maxPositionSize: bigint | null }
  >;
}

export interface CapacityServiceOptions {
  reader: ContractReader;
  vaultId: string;
  marketId: string;
  symbols?: readonly string[];
  hotTtlMs?: number;
  paramsTtlMs?: number;
  staleGraceMs?: number;
  readTimeoutMs?: number;
  /** Simulations issued concurrently while (re)loading the per-asset params. */
  paramsConcurrency?: number;
}

const HOT_TTL_MS = 5_000;
const PARAMS_TTL_MS = 300_000;
const STALE_GRACE_MS = 30_000;
const READ_TIMEOUT_MS = 2_500;
const PARAMS_TIMEOUT_MS = 15_000;
const PARAMS_CONCURRENCY = 4;

export class CapacityService {
  private readonly reader: ContractReader;
  private readonly vaultId: string;
  private readonly marketId: string;
  private readonly symbols: readonly string[];
  private readonly hotTtlMs: number;
  private readonly paramsTtlMs: number;
  private readonly staleGraceMs: number;
  private readonly readTimeoutMs: number;
  private readonly paramsConcurrency: number;

  private last: { value: CapacitySnapshot; at: number } | null = null;
  private inflight: Promise<CapacitySnapshot | null> | null = null;
  private params: { value: VaultParams; at: number } | null = null;

  constructor(opts: CapacityServiceOptions) {
    this.reader = opts.reader;
    this.vaultId = opts.vaultId;
    this.marketId = opts.marketId;
    this.symbols = opts.symbols ?? SUPPORTED_ASSET_SYMBOLS;
    this.hotTtlMs = opts.hotTtlMs ?? HOT_TTL_MS;
    this.paramsTtlMs = opts.paramsTtlMs ?? PARAMS_TTL_MS;
    this.staleGraceMs = opts.staleGraceMs ?? STALE_GRACE_MS;
    this.readTimeoutMs = opts.readTimeoutMs ?? READ_TIMEOUT_MS;
    this.paramsConcurrency = opts.paramsConcurrency ?? PARAMS_CONCURRENCY;
  }

  /**
   * Current snapshot: fresh (≤ hot TTL), else refreshed, else the last good
   * one within the stale grace window (flagged), else null.
   */
  async snapshot(): Promise<CapacitySnapshot | null> {
    const now = Date.now();
    if (this.last && now - this.last.at < this.hotTtlMs) return this.last.value;
    if (!this.inflight) {
      this.inflight = this.refresh().finally(() => {
        this.inflight = null;
      });
    }
    const fresh = await this.inflight;
    if (fresh) return fresh;
    if (this.last && now - this.last.at < this.hotTtlMs + this.staleGraceMs) {
      return { ...this.last.value, pool: { ...this.last.value.pool, stale: true } };
    }
    return null;
  }

  /** Drop every cached value (tests, admin cap changes). */
  invalidate(): void {
    this.last = null;
    this.params = null;
  }

  private async refresh(): Promise<CapacitySnapshot | null> {
    if (!this.vaultId || !this.marketId) return null;
    try {
      const params = await this.loadParams();
      const [exposure, aum, reservedPayout, usdcBalance, shortfallReserve] = await withTimeout(
        Promise.all([
          this.reader.readAssetExposure(this.marketId, this.symbols),
          this.reader.read<bigint>(this.vaultId, 'get_aum'),
          this.reader.read<bigint>(this.vaultId, 'get_reserved_payout'),
          this.reader.read<bigint>(this.vaultId, 'get_usdc_balance'),
          this.reader.read<bigint>(this.vaultId, 'get_shortfall_reserve'),
        ]),
        this.readTimeoutMs,
      );

      const assets: Record<string, AssetCapacity> = {};
      let pool: PoolCapacity | null = null;
      for (const symbol of this.symbols) {
        const p = params.perAsset[symbol];
        if (!p) continue;
        const oi = exposure.exposure.get(symbol) ?? { long: 0n, short: 0n };
        const inputs: CapacityInputs = {
          aum: BigInt(aum),
          reservedPayout: BigInt(reservedPayout),
          reserveCapBps: params.reserveCapBps,
          usdcBalance: BigInt(usdcBalance),
          shortfallReserve: BigInt(shortfallReserve),
          assetCapBps: p.assetCapBps,
          capAbs: p.capAbs,
          skewCapBps: p.skewCapBps,
          longOi: oi.long,
          shortOi: oi.short,
          maxPositionSize: p.maxPositionSize,
        };
        const h = computeHeadroom(inputs);
        assets[symbol] = {
          headroomLong: h.long.headroom.toString(),
          headroomShort: h.short.headroom.toString(),
          bindingLong: h.long.binding,
          bindingShort: h.short.binding,
          oiLong: oi.long.toString(),
          oiShort: oi.short.toString(),
          netSkew: h.net.toString(),
          sideCap: h.sideCap.toString(),
          skewCap: h.skewCap.toString(),
          assetCapBps: p.assetCapBps,
          capAbs: p.capAbs.toString(),
          skewCapBps: p.skewCapBps,
          maxPositionSize: p.maxPositionSize === null ? null : p.maxPositionSize.toString(),
        };
        pool ??= {
          aum: inputs.aum.toString(),
          reservedPayout: inputs.reservedPayout.toString(),
          usdcBalance: inputs.usdcBalance.toString(),
          shortfallReserve: inputs.shortfallReserve.toString(),
          reserveCapBps: params.reserveCapBps,
          reserveCap: h.reserveCap.toString(),
          aggregateHeadroom: h.aggregateHeadroom.toString(),
          aggregateBinding: h.aggregateBinding,
          asOfLedger: exposure.latestLedger,
          ts: Date.now(),
          stale: false,
        };
      }
      if (!pool) return null;
      const snapshot: CapacitySnapshot = { pool, assets };
      this.last = { value: snapshot, at: Date.now() };
      return snapshot;
    } catch {
      return null;
    }
  }

  /**
   * Admin parameters (get_reserve_cap, get_asset_caps ×N, get_asset_risk ×N)
   * with a long TTL. A failed reload falls back to the last good set — caps
   * only move by admin invoke, so old params beat no params — and throws only
   * when nothing was ever loaded.
   */
  private async loadParams(): Promise<VaultParams> {
    const now = Date.now();
    if (this.params && now - this.params.at < this.paramsTtlMs) return this.params.value;
    try {
      const value = await withTimeout(this.fetchParams(), PARAMS_TIMEOUT_MS);
      this.params = { value, at: now };
      return value;
    } catch (err) {
      if (this.params) return this.params.value;
      throw err;
    }
  }

  private async fetchParams(): Promise<VaultParams> {
    const reserveCapBps = Number(await this.reader.read<number>(this.vaultId, 'get_reserve_cap'));
    const perAsset: VaultParams['perAsset'] = {};
    const symbols = [...this.symbols];
    for (let i = 0; i < symbols.length; i += this.paramsConcurrency) {
      const chunk = symbols.slice(i, i + this.paramsConcurrency);
      const rows = await Promise.all(
        chunk.map(async (symbol) => {
          const sym = nativeToScVal(symbol, { type: 'symbol' });
          const [caps, risk] = await Promise.all([
            this.reader.read<[number, bigint, number, bigint]>(this.vaultId, 'get_asset_caps', [sym]),
            this.reader.read<{ max_position_size?: bigint } | null>(this.marketId, 'get_asset_risk', [sym]),
          ]);
          const maxRaw = risk?.max_position_size;
          return [
            symbol,
            {
              assetCapBps: Number(caps[0]),
              capAbs: BigInt(caps[1]),
              skewCapBps: Number(caps[2]),
              maxPositionSize: maxRaw == null ? null : BigInt(maxRaw),
            },
          ] as const;
        }),
      );
      for (const [symbol, p] of rows) perAsset[symbol] = p;
    }
    return { reserveCapBps, perAsset };
  }
}
