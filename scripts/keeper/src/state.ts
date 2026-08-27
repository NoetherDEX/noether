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
import { EntityWalkState, KeeperState, PersistedPrice } from './types';

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
    // Chain-walk discovery memory (Phase 4). Without restoring this, every
    // restart re-walks the entire id space from zero — the exact first-cycle
    // cost the watermark exists to amortize.
    if (isValidWalkState(parsed.discovery?.positions) && isValidWalkState(parsed.discovery?.orders)) {
      state.discovery = {
        positions: parsed.discovery!.positions,
        orders: parsed.discovery!.orders,
      };
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

/**
 * Write-avoidance: the discovery walk calls saveKeeperState every poll
 * cycle and the oracle push every 30s, while the state file lives on an
 * Azure Files SMB mount where every mkdir/create/write/rename is a billed
 * operation (~5M ops/month across the keepers before this guard). A write
 * is skipped when the payload is byte-identical to the last successful
 * write, and otherwise rate-limited to one per STATE_MIN_WRITE_MS unless
 * `force` is set (funding submit, shutdown). Losing ≤60s of last-pushed
 * price on a crash is harmless for the K-2 breaker, and funding replay is
 * already idempotent on-chain (#55 FundingIntervalNotElapsed → 'not-due').
 * Because callers keep calling every cycle, a throttled change is still
 * persisted within one window.
 */
const STATE_MIN_WRITE_MS = 60_000;
const lastWrite = new Map<string, { payload: string; at: number }>();

/** Atomically persist state (tmp + rename). Non-fatal on failure. */
export function saveKeeperState(
  filePath: string,
  state: KeeperState,
  opts: { force?: boolean } = {},
): void {
  try {
    const payload = JSON.stringify(state, null, 2);
    const prev = lastWrite.get(filePath);
    if (prev) {
      if (prev.payload === payload) return;
      if (!opts.force && Date.now() - prev.at < STATE_MIN_WRITE_MS) return;
    }
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, payload, 'utf-8');
    fs.renameSync(tmpPath, filePath);
    lastWrite.set(filePath, { payload, at: Date.now() });
  } catch (error) {
    console.warn(
      `⚠️  Failed to persist keeper state to ${filePath}: ${
        error instanceof Error ? error.message : error
      }`,
    );
  }
}

function isValidWalkState(entry: unknown): entry is EntityWalkState {
  if (typeof entry !== 'object' || entry === null) return false;
  const candidate = entry as Record<string, unknown>;
  return (
    typeof candidate.watermark === 'string' &&
    /^\d+$/.test(candidate.watermark) &&
    Array.isArray(candidate.live) &&
    candidate.live.every((id) => typeof id === 'string' && /^\d+$/.test(id))
  );
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
