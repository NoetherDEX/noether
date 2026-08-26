import { describe, expect, it } from 'vitest';
import {
  computeHeadroom,
  reserveCapOf,
  sideCapOf,
  skewCapOf,
  skewRoom,
  vaultAccepts,
  type CapacityInputs,
  type PositionSide,
} from '../src/capacity.js';

const P = 10_000_000n; // 7-decimal USDC
const usd = (n: number | bigint): bigint => BigInt(n) * P;

/** Contract-default vault with a flat book — override per case. */
function inputs(over: Partial<CapacityInputs> = {}): CapacityInputs {
  return {
    aum: usd(1_000),
    reservedPayout: 0n,
    reserveCapBps: 7_000,
    usdcBalance: usd(1_000),
    shortfallReserve: 0n,
    assetCapBps: 2_500,
    capAbs: 0n,
    skewCapBps: 1_500,
    longOi: 0n,
    shortOi: 0n,
    maxPositionSize: null,
    ...over,
  };
}

describe('vaultAccepts — transliteration of vault reserve_for_position', () => {
  // contracts/vault/src/lib.rs `absolute_cap_binds_below_the_bps_leg`
  it('absolute per-side cap binds below the bps leg (#82 side)', () => {
    const i = inputs({ capAbs: usd(100) }); // bps leg = 250, abs = 100
    expect(sideCapOf(i)).toBe(usd(100));
    expect(vaultAccepts(i, 'long', usd(90)).ok).toBe(true);
    const over = vaultAccepts(inputs({ capAbs: usd(100), longOi: usd(90) }), 'long', usd(30));
    expect(over).toEqual({ ok: false, reason: 'side' });
  });

  // contracts/vault/src/lib.rs `skew_cap_rejects_worsening_open_but_allows_reducing`
  it('rejects a skew-worsening open past the cap (#89) but always passes a reducing one', () => {
    const base = inputs({ assetCapBps: 10_000, skewCapBps: 1_000 }); // skew cap = 100
    expect(skewCapOf(base)).toBe(usd(100));
    // net 0 → 150 worsens past 100.
    expect(vaultAccepts(base, 'long', usd(150))).toEqual({ ok: false, reason: 'skew' });
    // net +200 → +120: both over the cap, but it helps → allowed.
    expect(vaultAccepts({ ...base, longOi: usd(200) }, 'short', usd(80)).ok).toBe(true);
    // net +200 → −200 (exactly as bad as before) is still allowed — the gate
    // only fires when |net| gets strictly worse.
    expect(vaultAccepts({ ...base, longOi: usd(200) }, 'short', usd(400)).ok).toBe(true);
    // net +200 → −201: worse than before AND over the cap → #89.
    expect(vaultAccepts({ ...base, longOi: usd(200) }, 'short', usd(401))).toEqual({
      ok: false,
      reason: 'skew',
    });
  });

  it('checks gates in the contract order: aggregate → side → skew → liquidity', () => {
    // Everything fails; the first gate wins.
    const i = inputs({
      reservedPayout: usd(700),
      longOi: usd(300),
      usdcBalance: usd(10),
    });
    expect(vaultAccepts(i, 'long', usd(1))).toEqual({ ok: false, reason: 'aggregate' });
    expect(vaultAccepts({ ...i, reservedPayout: 0n }, 'long', usd(1))).toEqual({
      ok: false,
      reason: 'side',
    });
    expect(vaultAccepts({ ...i, reservedPayout: 0n, longOi: usd(100) }, 'long', usd(60))).toEqual({
      ok: false,
      reason: 'skew',
    });
    expect(vaultAccepts({ ...i, reservedPayout: 0n, longOi: 0n }, 'long', usd(20))).toEqual({
      ok: false,
      reason: 'liquidity',
    });
  });

  it('earmarked shortfall USDC cannot back new reservations', () => {
    const i = inputs({ usdcBalance: usd(100), shortfallReserve: usd(60) });
    expect(vaultAccepts(i, 'long', usd(40)).ok).toBe(true);
    expect(vaultAccepts(i, 'long', usd(41))).toEqual({ ok: false, reason: 'liquidity' });
  });

  it('non-positive sizes are the contract InvalidAmount, not a gate', () => {
    expect(vaultAccepts(inputs(), 'long', 0n)).toEqual({ ok: false });
    expect(vaultAccepts(inputs(), 'short', -1n)).toEqual({ ok: false });
  });
});

describe('computeHeadroom — pinned fixtures', () => {
  it('flat book: skew cap binds before the side cap at defaults (15% < 25%)', () => {
    const h = computeHeadroom(inputs());
    expect(h.long).toEqual({ headroom: usd(150), binding: 'skew' });
    expect(h.short).toEqual({ headroom: usd(150), binding: 'skew' });
    expect(h.aggregateHeadroom).toBe(usd(700));
    expect(h.aggregateBinding).toBe('aggregate');
  });

  it('aggregate room and side room from the L1-13 spec (650 reserved of 700; long 200 of 250)', () => {
    const i = inputs({ reservedPayout: usd(650), longOi: usd(200), assetCapBps: 2_500, skewCapBps: 10_000 });
    expect(reserveCapOf(i)).toBe(usd(700));
    const h = computeHeadroom(i);
    expect(h.aggregateHeadroom).toBe(usd(50));
    // long: aggregate 50 vs side 50 → tie resolves to the earlier gate.
    expect(h.long).toEqual({ headroom: usd(50), binding: 'aggregate' });
    expect(h.short).toEqual({ headroom: usd(50), binding: 'aggregate' });
  });

  it('physical liquidity floor can bind below the aggregate cap', () => {
    const h = computeHeadroom(inputs({ usdcBalance: usd(300), shortfallReserve: usd(100) }));
    expect(h.aggregateHeadroom).toBe(usd(200));
    expect(h.aggregateBinding).toBe('liquidity');
  });

  it('cap already breached: increasing side has zero room, reducing side may flip to −|net|', () => {
    const i = inputs({ assetCapBps: 10_000, skewCapBps: 1_000, longOi: usd(200) }); // cap 100, net +200
    const h = computeHeadroom(i);
    expect(h.long).toEqual({ headroom: 0n, binding: 'skew' });
    expect(h.short).toEqual({ headroom: usd(400), binding: 'skew' });
    expect(vaultAccepts(i, 'short', usd(400)).ok).toBe(true);
    expect(vaultAccepts(i, 'short', usd(400) + 1n).ok).toBe(false);
  });

  it('max position size caps the headroom and names itself as the binding', () => {
    const h = computeHeadroom(inputs({ maxPositionSize: usd(100) }));
    expect(h.long).toEqual({ headroom: usd(100), binding: 'maxPosition' });
    // An unknown max (null / 0) is simply not a term.
    expect(computeHeadroom(inputs({ maxPositionSize: 0n })).long.binding).toBe('skew');
  });

  it('prod XLM on 2026-08-24 (pre-deposit): short bound by skew at ≈$80,385, long by the $100k max', () => {
    const i: CapacityInputs = {
      aum: 14_436_001_453_851n,
      reservedPayout: 8_961_594_157_885n,
      reserveCapBps: 7_000,
      usdcBalance: 14_747_198_788_346n,
      shortfallReserve: 0n,
      assetCapBps: 2_500,
      capAbs: 0n,
      skewCapBps: 1_500,
      longOi: 252_541_116_930n,
      shortOi: 1_614_090_000_000n,
      maxPositionSize: 1_000_000_000_000n,
    };
    const h = computeHeadroom(i);
    // Matches vault.get_asset_caps(XLM)[3] read on-chain that day.
    expect(h.sideCap).toBe(3_609_000_363_462n);
    expect(h.skewCap).toBe(2_165_400_218_077n);
    expect(h.net).toBe(-1_361_548_883_070n);
    expect(h.short).toEqual({ headroom: 803_851_335_007n, binding: 'skew' });
    expect(h.long).toEqual({ headroom: 1_000_000_000_000n, binding: 'maxPosition' });
    expect(h.aggregateHeadroom).toBe(1_143_606_859_810n);
    // The friend's near-max short fails, the same size long passes.
    expect(vaultAccepts(i, 'short', 950_000_000_000n)).toEqual({ ok: false, reason: 'skew' });
    expect(vaultAccepts(i, 'long', 950_000_000_000n).ok).toBe(true);
  });
});

describe('skewRoom', () => {
  it('flat book: both sides get the full cap', () => {
    expect(skewRoom(0n, 100n, 'long')).toBe(100n);
    expect(skewRoom(0n, 100n, 'short')).toBe(100n);
  });
  it('increasing side: cap − |net|; reducing side: |net| + max(cap, |net|)', () => {
    expect(skewRoom(30n, 100n, 'long')).toBe(70n);
    expect(skewRoom(30n, 100n, 'short')).toBe(130n);
    expect(skewRoom(-30n, 100n, 'short')).toBe(70n);
    expect(skewRoom(-30n, 100n, 'long')).toBe(130n);
    expect(skewRoom(250n, 100n, 'long')).toBe(-150n); // floored by computeHeadroom
    expect(skewRoom(250n, 100n, 'short')).toBe(500n);
  });
});

/** Deterministic LCG so a failure reproduces from the seed in the message. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
}
const pick = (r: () => number, max: bigint): bigint => (max <= 0n ? 0n : BigInt(Math.floor(r() * Number(max + 1n))));

describe('parity: size ≤ headroom ⇔ the vault accepts it', () => {
  const CASES = 3_000;
  it(`holds over ${CASES} random vault states per side`, () => {
    const r = rng(20_260_824);
    for (let n = 0; n < CASES; n++) {
      const aum = pick(r, 2_000_000n * P);
      const i: CapacityInputs = {
        aum,
        reservedPayout: pick(r, aum),
        reserveCapBps: 1 + Math.floor(r() * 10_000),
        usdcBalance: pick(r, 2n * aum),
        shortfallReserve: 0n,
        assetCapBps: 1 + Math.floor(r() * 10_000),
        capAbs: r() < 0.5 ? 0n : pick(r, aum),
        skewCapBps: 1 + Math.floor(r() * 10_000),
        longOi: pick(r, aum / 2n),
        shortOi: pick(r, aum / 2n),
        maxPositionSize: r() < 0.3 ? null : 1n + pick(r, aum),
      };
      i.shortfallReserve = pick(r, i.usdcBalance / 2n);
      const h = computeHeadroom(i);
      for (const side of ['long', 'short'] as PositionSide[]) {
        const { headroom, binding } = h[side];
        const ctx = `seed case ${n} ${side} ${JSON.stringify(i, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`;
        expect(headroom >= 0n, ctx).toBe(true);
        if (headroom > 0n) {
          for (const size of [1n, headroom / 2n, headroom - 1n, headroom]) {
            if (size >= 1n) expect(vaultAccepts(i, side, size).ok, `${ctx} size=${size}`).toBe(true);
          }
        }
        if (binding !== 'maxPosition') {
          for (const size of [headroom + 1n, headroom + 7n, 2n * headroom + 1n]) {
            const verdict = vaultAccepts(i, side, size);
            expect(verdict.ok, `${ctx} size=${size}`).toBe(false);
            // At exactly one past the bound, the binding gate is the one that fires.
            if (size === headroom + 1n && headroom > 0n) {
              expect(verdict.reason, `${ctx} size=${size}`).toBe(binding);
            }
          }
        }
      }
    }
  });
});
