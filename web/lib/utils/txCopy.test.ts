import { describe, expect, it } from 'vitest';
import {
  feeChargedXlm,
  genericFailureMessage,
  retryProgressMessage,
  staleFootprintMessage,
  tryAgainLaterMessage,
} from './txCopy';
import type { TradeOp } from '../stellar/footprintGuard';

// The page-level error mappers turn any of these into "rejected in wallet".
const WALLET_REJECTION_WORDS = /reject|declin|denied|cancel/i;

const OPS: TradeOp[] = [
  'open', 'open_cross', 'close', 'close_partial', 'close_cross',
  'place_order', 'cancel_order', 'execute_order', 'liquidate', 'liquidate_cross', 'adl', 'other',
];

describe('txCopy', () => {
  it('a close never claims that no position was opened, and admits the fee', () => {
    const msg = staleFootprintMessage('close', '0.0092339');
    expect(msg).toContain('Your position is untouched and still open.');
    expect(msg).toContain('0.0092339 XLM');
    expect(msg).not.toMatch(/no position was opened/i);
    expect(msg).not.toMatch(/nothing was charged/i);
  });

  it('an open says what did not happen', () => {
    const msg = staleFootprintMessage('open');
    expect(msg).toContain('No position was opened and your collateral did not move.');
    expect(msg).toContain('A small network fee was charged for the attempt');
  });

  it('never uses wallet-rejection vocabulary in any op (including cancel_order)', () => {
    for (const op of [...OPS, undefined]) {
      for (const msg of [
        staleFootprintMessage(op, '0.01'),
        staleFootprintMessage(op),
        retryProgressMessage(op),
        tryAgainLaterMessage(op),
        genericFailureMessage(op, '0.01'),
      ]) {
        expect(msg, `${op}: ${msg}`).not.toMatch(WALLET_REJECTION_WORDS);
      }
    }
  });

  it('formats charged fees in XLM without trailing zeros', () => {
    expect(feeChargedXlm(92_339n)).toBe('0.0092339');
    expect(feeChargedXlm(10_000_000n)).toBe('1');
    expect(feeChargedXlm(12_500_000n)).toBe('1.25');
    expect(feeChargedXlm(0n)).toBeUndefined();
    expect(feeChargedXlm(null)).toBeUndefined();
  });

  it('retry copy names the action', () => {
    expect(retryProgressMessage('close')).toContain('your close');
    expect(retryProgressMessage('open')).toContain('your trade');
    expect(retryProgressMessage('place_order')).toContain('your order');
  });
});
