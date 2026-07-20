import { describe, expect, it } from 'vitest';
import { messageForCode } from './contractErrors';

/**
 * L1-10 coverage guard: the friendly-copy table must never silently lag
 * errors.rs again. MAX_DOCUMENTED_MARKET_ERROR is a PR-checklist constant —
 * bump it in the same commit that adds a NoetherError variant (the enum sits
 * at its ~50-variant ceiling, so additions are rare and deliberate).
 */
const MAX_DOCUMENTED_MARKET_ERROR = 96;

// Codes deliberately absent from the map (gaps in errors.rs numbering).
const KNOWN_GAPS = new Set([
  8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 24, 25, 26, 28, 29, 33, 34, 35,
  36, 37, 38, 39, 44, 45, 46, 47, 48, 49, 51, 52, 53, 54, 56, 57, 58, 59, 63,
  71, 72, 73, 74, 75,
]);

describe('market error copy coverage', () => {
  it('has friendly copy for every documented code through the ceiling', () => {
    const missing: number[] = [];
    for (let code = 1; code <= MAX_DOCUMENTED_MARKET_ERROR; code++) {
      if (KNOWN_GAPS.has(code)) continue;
      if (!messageForCode(code)) missing.push(code);
    }
    expect(missing).toEqual([]);
  });

  it('covers the Batch-1 additions explicitly (#83–#96)', () => {
    for (const code of [83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96]) {
      expect(messageForCode(code), `code #${code}`).toBeTruthy();
    }
  });
});
