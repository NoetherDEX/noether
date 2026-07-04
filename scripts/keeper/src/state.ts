/**
 * Noether Keeper Bot - Persisted State (K-2 / K-7)
 *
 * The price circuit breaker must survive restarts: an in-memory-only
 * "last pushed price" resets on every deploy, letting a bad upstream walk
 * the price anywhere right after boot. Last-pushed prices (and the last
 * successful apply_funding submit time) are persisted to a small JSON file
 * (env KEEPER_STATE_FILE, default ./keeper-state.json) and loaded at boot.
 *
 * Writes are atomic (tmp file + rename) and failures are non-fatal — the
 * keeper must keep running even on a read-only filesystem.
 */

import * as fs from 'fs';
import * as path from 'path';
import { KeeperState, PersistedPrice } from './types';

export function emptyKeeperState(): KeeperState {
  return { lastPushedPrices: {} };
}

/** Load state from disk; missing or corrupt files yield a fresh state. */
export function loadKeeperState(filePath: string): KeeperState {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`💾 No keeper state file at ${filePath} — starting fresh`);
      return emptyKeeperState();
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<KeeperState>;
    const state = emptyKeeperState();

    if (parsed.lastPushedPrices && typeof parsed.lastPushedPrices === 'object') {
      for (const [symbol, entry] of Object.entries(parsed.lastPushedPrices)) {
        if (isValidPersistedPrice(entry)) {
          state.lastPushedPrices[symbol] = entry;
        }
      }
    }
    if (typeof parsed.lastFundingSubmitTime === 'number' && parsed.lastFundingSubmitTime > 0) {
      state.lastFundingSubmitTime = parsed.lastFundingSubmitTime;
    }

    const symbols = Object.keys(state.lastPushedPrices);
    console.log(
      `💾 Loaded keeper state from ${filePath}` +
        (symbols.length > 0 ? ` (last pushed: ${symbols.join(', ')})` : ' (no prior prices)'),
    );
    return state;
  } catch (error) {
    console.warn(
      `⚠️  Failed to load keeper state from ${filePath} — starting fresh: ${
        error instanceof Error ? error.message : error
      }`,
    );
    return emptyKeeperState();
  }
}

/** Atomically persist state (tmp + rename). Non-fatal on failure. */
export function saveKeeperState(filePath: string, state: KeeperState): void {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    console.warn(
      `⚠️  Failed to persist keeper state to ${filePath}: ${
        error instanceof Error ? error.message : error
      }`,
    );
  }
}

function isValidPersistedPrice(entry: unknown): entry is PersistedPrice {
  if (typeof entry !== 'object' || entry === null) return false;
  const candidate = entry as Record<string, unknown>;
  return (
    typeof candidate.price === 'number' &&
    isFinite(candidate.price) &&
    candidate.price > 0 &&
    typeof candidate.priceScaled === 'string' &&
    /^\d+$/.test(candidate.priceScaled) &&
    typeof candidate.timestamp === 'number' &&
    candidate.timestamp > 0
  );
}
