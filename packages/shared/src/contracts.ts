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
  | 'mockOracle'
  | 'oracleAdapter'
  | 'vault'
  | 'market'
  | 'usdcToken'
  | 'noeToken'
  // Tranche 2 additions — populated when those contracts are deployed.
  | 'vaultFactory'
  | 'referral';

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

export function getContract(key: ContractKey, manifest?: ContractsManifest): StellarAddress {
  const m = manifest ?? loadContracts();
  const addr = m.contracts[key];
  if (!addr) {
    throw new Error(`Contract '${key}' not present in contracts.json (network: ${m.network})`);
  }
  return addr;
}

export function hasContract(key: ContractKey, manifest?: ContractsManifest): boolean {
  const m = manifest ?? loadContracts();
  return Boolean(m.contracts[key]);
}
