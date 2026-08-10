import type { Network } from '@noether/types';
import { getContract } from './contracts.js';

/**
 * Deployment scope registry for environment scoped read models (today: the
 * leaderboard). A scope names one venue's history: which market contract ids
 * feed its board and which slice of the leaderboard_legacy baseline it may
 * inherit. One gateway serves every frontend, so the scope is what keeps
 * testnet rows out of a mainnet page: the mainnet scope starts with no
 * market ids and no legacy inheritance, which makes its board empty until a
 * real mainnet deployment is registered.
 */

export type ScopeId = 'testnet' | 'mainnet';

/** Stellar network family a scope's data lives on. 'public' is the
 *  passphrase family name for mainnet. */
export type ScopeNetwork = 'testnet' | 'public';

export interface DeploymentScope {
  id: ScopeId;
  network: ScopeNetwork;
  label: string;
  /** Market contract ids whose events belong to this scope's board. */
  marketIds: readonly string[];
  /** leaderboard_legacy.scope_key value folded into this scope's board;
   *  null folds nothing (mainnet must never inherit the testnet baseline). */
  legacyScopeKey: string | null;
}

export interface ScopeResolveOptions {
  /**
   * The market id the calling service is configured with (for the api this
   * is the resolved manifest value, so a CONTRACT_MARKET override or an
   * injected test id wins over the baked contracts.json read). Applies only
   * to the testnet default list; the mainnet default stays empty until
   * SCOPE_MAINNET_MARKET_IDS names a real deployment.
   */
  currentMarketId?: string;
}

const SCOPE_IDS: readonly ScopeId[] = ['testnet', 'mainnet'];

/** Comma separated id list from an env var; null when unset or blank. */
function parseIdList(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : null;
}

/**
 * Testnet market ids, most specific source first:
 * 1. SCOPE_TESTNET_MARKET_IDS (comma separated) when set. This is also how
 *    retired testnet market generations are added back for continuity.
 * 2. The caller's configured market id.
 * 3. The current market in contracts.json.
 * The default is the single live market so the board matches what the
 * gateway has always served; widening it is an explicit operator step.
 */
function testnetMarketIds(opts?: ScopeResolveOptions): readonly string[] {
  const fromEnv = parseIdList(process.env.SCOPE_TESTNET_MARKET_IDS);
  if (fromEnv) return fromEnv;
  if (opts?.currentMarketId) return [opts.currentMarketId];
  try {
    return [getContract('market')];
  } catch {
    // No manifest on disk (out of repo consumer) and no injected id: there
    // is no meaningful default, so resolve to an empty venue.
    return [];
  }
}

function mainnetMarketIds(): readonly string[] {
  return parseIdList(process.env.SCOPE_MAINNET_MARKET_IDS) ?? [];
}

/**
 * Resolve a scope id to its registry entry. An omitted or blank id resolves
 * to the default testnet scope; an unknown id returns null so callers can
 * reject it explicitly.
 */
export function resolveScope(id?: string, opts?: ScopeResolveOptions): DeploymentScope | null {
  const scopeId = id === undefined || id === '' ? 'testnet' : id;
  if (scopeId === 'testnet') {
    return {
      id: 'testnet',
      network: 'testnet',
      label: 'Stellar Testnet',
      marketIds: testnetMarketIds(opts),
      legacyScopeKey: 'testnet',
    };
  }
  if (scopeId === 'mainnet') {
    return {
      id: 'mainnet',
      network: 'public',
      label: 'Stellar Mainnet',
      marketIds: mainnetMarketIds(),
      legacyScopeKey: null,
    };
  }
  return null;
}

/**
 * The scope this deployment serves, from LEADERBOARD_SCOPE. Unset defaults
 * to 'testnet'; an explicitly unknown value throws at boot instead of
 * silently serving the wrong venue.
 */
export function scopeFromEnv(opts?: ScopeResolveOptions): DeploymentScope {
  const raw = process.env.LEADERBOARD_SCOPE?.trim();
  const scope = resolveScope(raw || undefined, opts);
  if (!scope) {
    throw new Error(
      `LEADERBOARD_SCOPE is set to an unknown scope "${raw}". Valid scopes: ${SCOPE_IDS.join(', ')}`,
    );
  }
  return scope;
}

/**
 * True when a gateway configured for the given Stellar network holds this
 * scope's data. The config uses 'mainnet' where scope networks use the
 * passphrase family name 'public'.
 */
export function scopeServedByNetwork(scope: DeploymentScope, network: Network | string): boolean {
  const asScopeNetwork = network === 'mainnet' ? 'public' : network;
  return scope.network === asScopeNetwork;
}
