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
import { loadConfig } from './config';
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
  HealthPosition,
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

console.log(`\n✅ smoke: all ${checks} assertions passed (no network calls made)`);
