import { nativeToScVal } from '@stellar/stellar-sdk';
import type { Asset, PriceData, StellarAddress } from '@noether/types';
import { SUPPORTED_ASSETS, fromPrecision } from '@noether/shared';
import { TtlCache } from './cache.js';
import type { ContractReader } from './contractReader.js';

export interface OraclePrice {
  asset: string;
  price: bigint;
  priceFloat: number;
  timestamp: number;
}

const PRICE_TTL_MS = 3_000;

/**
 * Reads `lastprice(asset)` on the Noeracle SEP-40 shim and caches results.
 * The shim returns (price: i128, timestamp: u64), translating to Noeracle's
 * signed `get_price_pers`.
 */
export class OracleService {
  private readonly cache = new TtlCache<OraclePrice>(PRICE_TTL_MS);

  constructor(
    private readonly reader: ContractReader,
    private readonly oracleId: StellarAddress,
  ) {}

  async getPrice(asset: string): Promise<OraclePrice> {
    return this.cache.getOrLoad(asset, () => this.fetch(asset));
  }

  async getAllPrices(): Promise<OraclePrice[]> {
    return Promise.all(SUPPORTED_ASSETS.map((a: Asset) => this.getPrice(a.symbol)));
  }

  private async fetch(asset: string): Promise<OraclePrice> {
    const result = await this.reader.read<[bigint, bigint] | { 0: bigint; 1: bigint }>(
      this.oracleId,
      'lastprice',
      [nativeToScVal(asset, { type: 'symbol' })],
    );
    const tuple = Array.isArray(result) ? result : [result[0], result[1]];
    const price = tuple[0]!;
    const timestamp = Number(tuple[1]!);
    const priceData: PriceData = { price, timestamp };
    return {
      asset,
      price: priceData.price,
      priceFloat: fromPrecision(priceData.price),
      timestamp: priceData.timestamp,
    };
  }
}
