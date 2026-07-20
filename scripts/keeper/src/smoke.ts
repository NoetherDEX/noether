/**
 * Offline smoke test — NO network calls.
 *
 * Verifies that the config module loads and that the local
 * liquidation-health math (health.ts — the P2-9 replacement for the
 * removed on-chain `is_liquidatable`) classifies hardcoded fixtures
 * correctly against the contract formulas:
 *   pnl    = size × (P − entry) / entry   (sign by direction)
 *   margin = collateral + pnl
 *   liquidatable when margin < size × maintenance_margin_bps / 10_000
 *
 *   npm run smoke
 */

import * as assert from 'assert';
import { scValToNative } from '@stellar/stellar-sdk';
import { loadConfig } from './config';
import {
  buildRouterCallArgs,
  buildPriceAttestationScVal,
  extractContractErrorCode,
  isMissingContractFunction,
} from './stellar';
import { trackTriggeredStuck } from './deadman';
import {
  PRECISION,
  calculatePnl,
  positionMargin,
  maintenanceMargin,
  crossesLiquidationPrice,
  isUnderwater,
  isLiquidationCandidate,
  isCrossLiquidationCandidate,
  adlRank,
  assetPayableUpnl,
  adlFlagDecision,
  rankAdlCandidates,
  HealthPosition,
  AdlPosition,
} from './health';

let checks = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  assert.deepStrictEqual(actual, expected, `${label}: expected ${expected}, got ${actual}`);
  checks++;
  console.log(`  ✅ ${label}`);
}

console.log('Noether keeper smoke test (offline)\n');

// ── config module loads without side effects ────────────────────────────
check('config module exports loadConfig', typeof loadConfig, 'function');

// ── fixture: healthy long ────────────────────────────────────────────────
// 100 USDC collateral, $1000 size (10x), entry $1.00, now $1.00.
// margin = 100, maintenance = 1% × 1000 = 10 → clearly healthy.
const healthyLong: HealthPosition = {
  asset: 'XLM',
  collateral: 100n * PRECISION,
  size: 1000n * PRECISION,
  entry_price: PRECISION, // $1.00
  direction: 'Long',
  liquidation_price: 0n,
};
const flat = PRECISION; // $1.00

check('healthy long: pnl at entry price is 0', calculatePnl(healthyLong, flat), 0n);
check('healthy long: margin = collateral', positionMargin(healthyLong, flat), 100n * PRECISION);
check('healthy long: maintenance margin = 1% of size', maintenanceMargin(healthyLong.size), 10n * PRECISION);
check('healthy long: NOT liquidatable', isUnderwater(healthyLong, flat), false);
check('healthy long: NOT even a candidate', isLiquidationCandidate(healthyLong, flat), false);

// ── fixture: clearly underwater long ─────────────────────────────────────
// Price dropped 10% → pnl = 1000 × (0.90 − 1.00) / 1.00 = −100.
// margin = 100 − 100 = 0 < 10 → liquidatable.
const crashed = (PRECISION * 9n) / 10n; // $0.90
check('underwater long: pnl = −100 USDC', calculatePnl(healthyLong, crashed), -100n * PRECISION);
check('underwater long: margin = 0', positionMargin(healthyLong, crashed), 0n);
check('underwater long: IS liquidatable', isUnderwater(healthyLong, crashed), true);
check('underwater long: IS a candidate', isLiquidationCandidate(healthyLong, crashed), true);

// ── fixture: clearly underwater short ────────────────────────────────────
// Same shape, price pumped 10% against the short → margin 0 < 10.
const underwaterShort: HealthPosition = { ...healthyLong, direction: 'Short' };
const pumped = (PRECISION * 11n) / 10n; // $1.10
check('underwater short: pnl = −100 USDC', calculatePnl(underwaterShort, pumped), -100n * PRECISION);
check('underwater short: IS liquidatable', isUnderwater(underwaterShort, pumped), true);
check('healthy short at $0.90: NOT liquidatable', isUnderwater(underwaterShort, crashed), false);

// ── fixture: near-boundary long → candidate but not (yet) underwater ─────
// Price $0.915 → pnl = −85, margin = 15. Maintenance = 10, buffered
// threshold = 20 → prefilter flags it for simulation, exact check says no.
const nearBoundary = 9_150_000n; // $0.915
check('near-boundary long: margin = 15 USDC', positionMargin(healthyLong, nearBoundary), 15n * PRECISION);
check('near-boundary long: NOT underwater (exact check)', isUnderwater(healthyLong, nearBoundary), false);
check('near-boundary long: IS a candidate (buffered prefilter)', isLiquidationCandidate(healthyLong, nearBoundary), true);

// ── fixture: stored liquidation price crossed ────────────────────────────
// Contract's should_liquidate ORs the stored liquidation price in.
const withLiqPrice: HealthPosition = { ...healthyLong, liquidation_price: 9_500_000n };
check('liq-price crossing long: IS liquidatable at $0.94', crossesLiquidationPrice(withLiqPrice, 9_400_000n), true);
check('liq-price crossing long: isUnderwater honors it', isUnderwater(withLiqPrice, 9_400_000n), true);
check('liq-price crossing long: fine at $0.96', isUnderwater(withLiqPrice, 9_600_000n), false);

// ── fixtures: cross-margin account prefilter ─────────────────────────────
// One cross position: 50 collateral, 500 size, entry $1. Maintenance = 5,
// buffered threshold = 10.
const crossPosition: HealthPosition = {
  asset: 'BTC',
  collateral: 50n * PRECISION,
  size: 500n * PRECISION,
  entry_price: PRECISION,
  direction: 'Long',
  liquidation_price: 0n, // cross positions store 0
};
const priceMapHealthy = new Map([['BTC', 9_550_000n]]); // $0.955 → pnl −22.5 → equity 27.5
const priceMapCrashed = new Map([['BTC', 9_050_000n]]); // $0.905 → pnl −47.5 → equity 2.5

check(
  'cross account: healthy (equity 27.5 vs buffered threshold 10) → not a candidate',
  isCrossLiquidationCandidate(0n, [crossPosition], priceMapHealthy),
  false,
);
check(
  'cross account: underwater (equity 2.5 < 10) → candidate',
  isCrossLiquidationCandidate(0n, [crossPosition], priceMapCrashed),
  true,
);
check(
  'cross account: missing local price → conservative candidate',
  isCrossLiquidationCandidate(0n, [crossPosition], new Map()),
  true,
);
check(
  'cross account: pool balance rescues equity → not a candidate',
  isCrossLiquidationCandidate(50n * PRECISION, [crossPosition], priceMapCrashed),
  false,
);
check('cross account: no positions → never a candidate', isCrossLiquidationCandidate(0n, [], priceMapCrashed), false);

// ── ADL ranking parity (L0-1) ───────────────────────────────────────────
// rank = (pnl × 10_000 / collateral) × leverage — pins parity with the
// contract's inlined formula and contracts/risk::adl_rank.
check(
  'adlRank: higher leverage ranks first at equal pnl%',
  adlRank(50n * PRECISION, 100n * PRECISION, 10n) > adlRank(50n * PRECISION, 100n * PRECISION, 5n),
  true,
);
check(
  'adlRank: exact value (50% of collateral × 10x = 50_000 bps-leverage)',
  adlRank(50n * PRECISION, 100n * PRECISION, 10n),
  50_000n,
);
check('adlRank: a loser never ranks', adlRank(-1n, 100n * PRECISION, 10n), 0n);
check('adlRank: zero collateral is safe', adlRank(50n * PRECISION, 0n, 10n), 0n);

// ── Per-asset mm resolver in the cross prefilter (L0-12) ────────────────
// Same account, same prices: a 5% per-asset mm makes it a candidate where
// the legacy flat 1% does not — the resolver must flow into the sum.
{
  const pos: HealthPosition = {
    asset: 'BTC',
    collateral: 9n * PRECISION, // between the 1%×2 (2) and 5%×2 (10) thresholds
    size: 100n * PRECISION,
    entry_price: PRECISION,
    direction: 'Long',
    liquidation_price: 0n,
  };
  const flat = new Map([['BTC', PRECISION]]);
  check(
    'cross mm resolver: legacy 1% flat → healthy',
    isCrossLiquidationCandidate(0n, [pos], flat, () => 100n),
    false,
  );
  check(
    'cross mm resolver: 5% ladder mm flips the same account to candidate',
    isCrossLiquidationCandidate(0n, [pos], flat, () => 500n),
    true,
  );
}

// ── ADL trigger mirror + walk order (L0-1) ──────────────────────────────
// assetPayableUpnl mirrors check_adl_trigger's per-side exposure formula:
//   long_upnl = price × lk / PRECISION − ls, clamped per side at 0.
const mkAdl = (
  id: bigint,
  direction: 'Long' | 'Short',
  size: bigint,
  entry: bigint,
  collateral: bigint,
  leverage: number,
): AdlPosition => ({
  id,
  leverage,
  asset: 'BTC',
  direction,
  size,
  entry_price: entry,
  collateral,
  liquidation_price: 0n,
});

const px = (n: number): bigint => BigInt(Math.round(n * 10_000_000));

check(
  'payableUpnl: single long winner (100 @ 1.00 → 1.10 = +10)',
  assetPayableUpnl([mkAdl(1n, 'Long', 100n * PRECISION, px(1), 10n * PRECISION, 10)], px(1.1)),
  10n * PRECISION,
);
check(
  'payableUpnl: losing side clamps to 0, never nets against winners',
  assetPayableUpnl(
    [
      mkAdl(1n, 'Long', 100n * PRECISION, px(1), 10n * PRECISION, 10),
      mkAdl(2n, 'Short', 50n * PRECISION, px(1), 5n * PRECISION, 10),
    ],
    px(1.1),
  ),
  10n * PRECISION,
);
check(
  'payableUpnl: both sides can be payable (long +10, short entry 1.25 → +6)',
  assetPayableUpnl(
    [
      mkAdl(1n, 'Long', 100n * PRECISION, px(1), 10n * PRECISION, 10),
      mkAdl(2n, 'Short', 50n * PRECISION, px(1.25), 5n * PRECISION, 10),
    ],
    px(1.1),
  ),
  16n * PRECISION,
);
check('payableUpnl: zero price is safe', assetPayableUpnl([mkAdl(1n, 'Long', 100n * PRECISION, px(1), 10n * PRECISION, 10)], 0n), 0n);

// Hysteresis: trigger 12_500 (< 1.25× coverage), clear 15_000 (≥ 1.5×).
const PAYABLE = 100n * PRECISION;
check(
  'adlFlag: activates when coverage under trigger ratio (124 < 125)',
  adlFlagDecision(PAYABLE, 124n * PRECISION, false, 12_500n, 15_000n),
  'activate',
);
check(
  'adlFlag: holds at exactly the trigger boundary (125)',
  adlFlagDecision(PAYABLE, 125n * PRECISION, false, 12_500n, 15_000n),
  'hold',
);
check(
  'adlFlag: active holds inside the hysteresis band (149 < 150)',
  adlFlagDecision(PAYABLE, 149n * PRECISION, true, 12_500n, 15_000n),
  'hold',
);
check(
  'adlFlag: clears at the clear ratio (150)',
  adlFlagDecision(PAYABLE, 150n * PRECISION, true, 12_500n, 15_000n),
  'clear',
);
check('adlFlag: clears when nothing is payable', adlFlagDecision(0n, 0n, true, 12_500n, 15_000n), 'clear');
check('adlFlag: inactive with nothing payable holds', adlFlagDecision(0n, 0n, false, 12_500n, 15_000n), 'hold');

// Walk order: highest score first, losers excluded, ties by lower id.
const walk = rankAdlCandidates(
  [
    mkAdl(1n, 'Long', 200n * PRECISION, px(1), 100n * PRECISION, 2), // pnl +20 → score 2_000×2
    mkAdl(2n, 'Long', 1000n * PRECISION, px(1), 100n * PRECISION, 10), // pnl +100 → score 10_000×10
    mkAdl(3n, 'Short', 100n * PRECISION, px(1), 100n * PRECISION, 10), // loser — excluded
  ],
  px(1.1),
);
check('adlWalk: winners only', walk.length, 2);
check('adlWalk: highest score first', walk[0].position.id, 2n);
check('adlWalk: exact top score ((100% of coll in bps) × 10x)', walk[0].score, 100_000n);
const tie = rankAdlCandidates(
  [
    mkAdl(7n, 'Long', 100n * PRECISION, px(1), 100n * PRECISION, 5),
    mkAdl(3n, 'Long', 100n * PRECISION, px(1), 100n * PRECISION, 5),
  ],
  px(1.1),
);
check('adlWalk: score ties break by lower id', tie[0].position.id, 3n);

// ── Router call assembly (L0-19) — the G-6 arity-drift guard ────────────
// Pins the exact arg order/types of execute_with_price / liquidate_with_price
// / adl_with_price: (actor, id u64, asset symbol, price i128, timestamp u64,
// round_id u64, pubkeys Vec<BytesN<32>>, sigs Vec<BytesN<64>>).
{
  const NULL_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  const round = {
    price: '1234567',
    timestamp: 1_700_000_000,
    round_id: 42,
    publisher: 'ab'.repeat(32),
    signature: 'cd'.repeat(64),
  };
  const args = buildRouterCallArgs(NULL_KEY, 7n, 'BTC', round);
  check('router args: exactly 8 (flattened attestation)', args.length, 8);
  check('router args[0]: actor address', scValToNative(args[0]), NULL_KEY);
  check('router args[1]: id u64', scValToNative(args[1]), 7n);
  check('router args[2]: asset symbol', scValToNative(args[2]), 'BTC');
  check('router args[3]: price i128', scValToNative(args[3]), 1234567n);
  check('router args[4]: timestamp u64', scValToNative(args[4]), 1700000000n);
  check('router args[5]: round_id u64', scValToNative(args[5]), 42n);
  const pubkeys = scValToNative(args[6]) as Buffer[];
  const sigs = scValToNative(args[7]) as Buffer[];
  check('router args[6]: one 32-byte pubkey', `${pubkeys.length}:${pubkeys[0].length}`, '1:32');
  check('router args[7]: one 64-byte sig', `${sigs.length}:${sigs[0].length}`, '1:64');

  // PriceAttestation struct map: UDT decode requires KEY-SORTED entries.
  const att = buildPriceAttestationScVal('ETH', round);
  const keys = att
    .map()!
    .map((entry) => entry.key().sym().toString());
  check(
    'attestation map: entries key-sorted for UDT decode',
    keys.join(','),
    'asset,price,pubkeys,round_id,sigs,timestamp',
  );
  const native = scValToNative(att) as Record<string, unknown>;
  check('attestation map: asset roundtrips', native.asset, 'ETH');
  check('attestation map: price roundtrips', native.price, 1234567n);
}

// ── Market error codes survive the router hop (L0-19) ───────────────────
// The router's env.invoke_contract trap surfaces the market's inner code in
// the simulation diagnostics — the extractor must find it in wrapped,
// multi-line messages, and missing-export detection must not false-match.
check(
  'router hop: #62 extracted from wrapped diagnostics',
  extractContractErrorCode(
    'Simulation failed: HostError: Error(Contract, #62)\nBacktrace: router invoke_contract trap',
  ),
  62,
);
check(
  'router hop: #78 extracted from wrapped diagnostics',
  extractContractErrorCode('host invocation failed: Error(Contract, #78) [diagnostic events omitted]'),
  78,
);
check(
  'missing-export: adl_with_price on a pre-Batch-1 router',
  isMissingContractFunction('HostError: Error(WasmVm, MissingValue)\ninvoking unknown export: adl_with_price'),
  true,
);
check(
  'missing-export: a plain contract rejection is NOT a missing export',
  isMissingContractFunction('Simulation failed: HostError: Error(Contract, #62)'),
  false,
);

// ── Dead-man counter (L0-19) ────────────────────────────────────────────
{
  const counts = new Map<string, number>();
  const t = (...ids: string[]) => trackTriggeredStuck(counts, new Set(ids), 3);
  check('deadman: cycle 1 silent', t('a').join(','), '');
  check('deadman: cycle 2 silent', t('a').join(','), '');
  check('deadman: fires exactly at the threshold', t('a').join(','), 'a');
  check('deadman: fire-once (no refire while still stuck)', t('a').join(','), '');
  check('deadman: executed order prunes its counter', (t(), counts.size), 0);
  t('b');
  t('b', 'c');
  check('deadman: independent ids fire independently', t('b', 'c').join(','), 'b');
}

console.log(`\n✅ smoke: all ${checks} assertions passed (no network calls made)`);
