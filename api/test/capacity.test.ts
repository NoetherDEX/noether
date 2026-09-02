import { describe, expect, it } from 'vitest';
import { CapacityService } from '../src/services/capacity.js';
import type { ContractReader } from '../src/services/contractReader.js';

const PRECISION = 10_000_000n;
const PARAM_METHODS = new Set(['get_reserve_cap', 'get_asset_caps', 'get_asset_risk']);

/** Scripted chain reader: counts reads, can stall or fail on demand. */
class FakeReader {
  hotReads = 0;
  paramReads = 0;
  exposureReads = 0;
  failing = false;
  hotDelayMs = 0;
  paramsDelayMs = 0;

  async read<T = unknown>(_contractId: string, method: string): Promise<T> {
    if (this.failing) throw new Error('rpc down');
    if (PARAM_METHODS.has(method)) {
      this.paramReads++;
      if (this.paramsDelayMs) await sleep(this.paramsDelayMs);
    } else {
      this.hotReads++;
      if (this.hotDelayMs) await sleep(this.hotDelayMs);
    }
    switch (method) {
      case 'get_reserve_cap':
        return 7_000 as T;
      case 'get_asset_caps':
        return [2_500, 0n, 1_500, 0n] as T;
      case 'get_asset_risk':
        return null as T;
      case 'get_aum':
      case 'get_usdc_balance':
        return (1_000_000n * PRECISION) as T;
      default:
        return 0n as T;
    }
  }

  async readAssetExposure(): Promise<{ exposure: Map<string, { long: bigint; short: bigint }>; latestLedger: number | null }> {
    if (this.failing) throw new Error('rpc down');
    this.exposureReads++;
    if (this.hotDelayMs) await sleep(this.hotDelayMs);
    return { exposure: new Map([['BTC', { long: 0n, short: 0n }]]), latestLedger: 4_314_754 };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function service(reader: FakeReader, opts: Partial<ConstructorParameters<typeof CapacityService>[0]> = {}) {
  return new CapacityService({
    reader: reader as unknown as ContractReader,
    vaultId: 'CVAULT',
    marketId: 'CMARKET',
    symbols: ['BTC'],
    hotTtlMs: 40,
    staleGraceMs: 2_000,
    refreshCooldownMs: 200,
    ...opts,
  });
}

describe('CapacityService stale-while-revalidate', () => {
  it('serves the last good snapshot at once past the hot TTL and refreshes in the background', async () => {
    const reader = new FakeReader();
    const svc = service(reader);
    const first = await svc.snapshot();
    expect(first?.pool.stale).toBe(false);
    const hotReadsAfterFirst = reader.hotReads;

    await sleep(60); // past the hot TTL, inside the grace window
    reader.hotDelayMs = 300;
    const t0 = Date.now();
    const served = await svc.snapshot();
    expect(Date.now() - t0).toBeLessThan(150); // did not wait on the 300ms chain read
    expect(served?.pool.ts).toBe(first?.pool.ts); // the cached snapshot
    expect(served?.pool.stale).toBe(false); // a refresh is running, none has failed

    await sleep(400); // let the background refresh land
    expect(reader.hotReads).toBeGreaterThan(hotReadsAfterFirst);
    const fresh = await svc.snapshot();
    expect(fresh?.pool.ts).toBeGreaterThan(first?.pool.ts ?? 0);
  });

  it('flags stale only after a refresh failed, and pauses between failed refreshes', async () => {
    const reader = new FakeReader();
    const svc = service(reader);
    await svc.snapshot();
    reader.failing = true;
    await sleep(60);

    // First call past the TTL kicks a refresh that fails; it still serves the
    // last good snapshot and cannot yet know the refresh failed.
    const served = await svc.snapshot();
    expect(served?.pool.stale).toBe(false);
    await sleep(10);
    const afterFailure = await svc.snapshot();
    expect(afterFailure?.pool.stale).toBe(true);

    // Inside the cooldown no new read batch is started, however often it is asked.
    reader.failing = false;
    const hotReads = reader.hotReads;
    await svc.snapshot();
    await svc.snapshot();
    await svc.snapshot();
    expect(reader.hotReads).toBe(hotReads);

    // Past the cooldown it refreshes and clears the flag.
    await sleep(250);
    await svc.snapshot();
    await sleep(20);
    expect(reader.hotReads).toBeGreaterThan(hotReads);
    expect((await svc.snapshot())?.pool.stale).toBe(false);
  });

  it('never blocks a hot read on an expired admin-params set', async () => {
    const reader = new FakeReader();
    // hotTtl 0 + no grace: every call awaits a real refresh, so a blocking
    // params reload would show up in the latency.
    const svc = service(reader, { hotTtlMs: 0, staleGraceMs: 0, paramsTtlMs: 30 });
    await svc.snapshot();
    const paramReads = reader.paramReads;
    await sleep(50); // params expired
    reader.paramsDelayMs = 400;

    const t0 = Date.now();
    const snap = await svc.snapshot();
    expect(snap).not.toBeNull();
    expect(Date.now() - t0).toBeLessThan(200); // served on the old params
    await sleep(500);
    expect(reader.paramReads).toBeGreaterThan(paramReads); // reloaded in the background
  });

  it('returns null, never a fabricated zero, when nothing was ever read', async () => {
    const reader = new FakeReader();
    reader.failing = true;
    const svc = service(reader);
    expect(await svc.snapshot()).toBeNull();
  });
});
