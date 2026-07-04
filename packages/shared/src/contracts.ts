import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Network, StellarAddress } from '@noether/types';

export interface ContractsManifest {
  network: Network;
  deployedAt: string;
  contracts: Record<ContractKey, StellarAddress>;
  admin: StellarAddress;
  noeAsset: {
    code: string;
    issuer: StellarAddress;
  };
}

export type ContractKey =
  // Noeracle-only oracle path. The shim is the SEP-40 reader the market/api
  // call (lastprice → Noeracle.get_price_pers); noeracle is the signed source;
  // noetherRouter does atomic verify-then-trade.
  | 'noeracleShim'
  | 'noeracle'
  | 'noetherRouter'
  | 'vault'
  | 'market'
  | 'usdcToken'
  | 'noeToken'
  // Tranche 2 additions — populated when those contracts are deployed.
  | 'vaultFactory'
  | 'referral'
  // Retired oracle contracts. Kept in the type only because the production
  // contracts.json still carries them until production's Noeracle cutover;
  // no code should read these.
  | 'mockOracle'
  | 'oracleAdapter';

/**
 * Resolve the path to contracts.json by walking up from the current module.
 * Supports both running from repo root and from a service subdirectory.
 */
function findContractsManifestPath(start?: string): string {
  const __filename = fileURLToPath(import.meta.url);
  const startDir = start ?? dirname(__filename);

  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, 'contracts.json');
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // not here; try parent
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`contracts.json not found starting from ${startDir}`);
}

let cached: ContractsManifest | null = null;

export function loadContracts(path?: string): ContractsManifest {
  if (cached && !path) return cached;
  const resolvedPath = path ?? findContractsManifestPath();
  const raw = readFileSync(resolvedPath, 'utf8');
  const parsed = JSON.parse(raw) as ContractsManifest;
  if (!path) cached = parsed;
  return parsed;
}

/**
 * Environment-variable override name for a contract key, e.g.
 * `market` → `CONTRACT_MARKET`, `noetherRouter` → `CONTRACT_NOETHER_ROUTER`.
 * Set these on Railway/Vercel to re-point an address WITHOUT rebuilding the
 * Docker image — the manifest is COPY'd in at build time, so before this the
 * only way to change an address was a rebuild (audit D-4). An env override
 * always wins over the baked-in manifest.
 */
export function contractEnvVar(key: ContractKey): string {
  const snake = key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
  return `CONTRACT_${snake}`;
}

export function getContract(key: ContractKey, manifest?: ContractsManifest): StellarAddress {
  const override = process.env[contractEnvVar(key)];
  if (override && override.trim()) {
    return override.trim() as StellarAddress;
  }
  const m = manifest ?? loadContracts();
  const addr = m.contracts[key];
  if (!addr) {
    throw new Error(`Contract '${key}' not present in contracts.json (network: ${m.network})`);
  }
  return addr;
}

export function hasContract(key: ContractKey, manifest?: ContractsManifest): boolean {
  const override = process.env[contractEnvVar(key)];
  if (override && override.trim()) return true;
  const m = manifest ?? loadContracts();
  return Boolean(m.contracts[key]);
}

/**
 * Every contract address the process actually resolved to (env override or
 * manifest), tagged with the source. Logged at boot and echoed from
 * `/v1/health` so a running service self-reports which stack it serves —
 * the D-4 failure was silent divergence between the baked manifest and the
 * live site.
 */
export function resolvedContracts(
  keys: readonly ContractKey[],
  manifest?: ContractsManifest,
): Record<string, { address: string; source: 'env' | 'manifest' | 'unset' }> {
  const m = manifest ?? loadContracts();
  const out: Record<string, { address: string; source: 'env' | 'manifest' | 'unset' }> = {};
  for (const key of keys) {
    const override = process.env[contractEnvVar(key)];
    if (override && override.trim()) {
      out[key] = { address: override.trim(), source: 'env' };
    } else if (m.contracts[key]) {
      out[key] = { address: m.contracts[key], source: 'manifest' };
    } else {
      out[key] = { address: '', source: 'unset' };
    }
  }
  return out;
}
