/**
 * Direct vault_factory contract calls — mirrors web/lib/stellar/market.ts.
 *
 * The contract address is read from `NEXT_PUBLIC_VAULT_FACTORY_ID`;
 * if unset the helpers throw so the UI can surface a "deploy pending"
 * state instead of misrouting transactions.
 */

import { Address, Contract, TransactionBuilder, BASE_FEE, rpc, scValToNative } from '@stellar/stellar-sdk';
import { buildTransaction, submitTransaction, sorobanRpc, toScVal } from './client';
import { signWithWallet, WALLETCONNECT_ID } from './walletKit';
import { NETWORK, CONTRACTS } from '@/lib/utils/constants';

function getVaultFactoryAddress(): string {
  const addr = process.env.NEXT_PUBLIC_VAULT_FACTORY_ID;
  if (!addr) {
    throw new Error(
      'vault_factory contract not configured — set NEXT_PUBLIC_VAULT_FACTORY_ID once the contract is deployed.',
    );
  }
  return addr;
}

function vaultFactoryContract(): Contract {
  return new Contract(getVaultFactoryAddress());
}

async function signAndSubmit(
  signerPublicKey: string,
  walletId: string,
  xdr: string,
): Promise<unknown> {
  const signedXdr = await signWithWallet(xdr, {
    networkPassphrase: NETWORK.PASSPHRASE,
    address: signerPublicKey,
  });
  // WalletConnect signed XDR may include extra wrapping; signWithWallet
  // already normalises to a base64 string for us.
  void walletId; // future: per-wallet flow tweaks
  return submitTransaction(signedXdr);
}

export async function depositToVault(
  signerPublicKey: string,
  walletId: string,
  vaultId: number,
  amount: bigint,
): Promise<void> {
  const factory = vaultFactoryContract();
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(vaultId, 'u32'),
    toScVal(amount, 'i128'),
  ];
  const xdr = await buildTransaction(signerPublicKey, factory, 'deposit', args);
  await signAndSubmit(signerPublicKey, walletId, xdr);
}

export async function withdrawFromVault(
  signerPublicKey: string,
  walletId: string,
  vaultId: number,
  shares: bigint,
): Promise<void> {
  const factory = vaultFactoryContract();
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(vaultId, 'u32'),
    toScVal(shares, 'i128'),
  ];
  const xdr = await buildTransaction(signerPublicKey, factory, 'withdraw', args);
  await signAndSubmit(signerPublicKey, walletId, xdr);
}

export async function createVault(
  signerPublicKey: string,
  walletId: string,
  name: string,
): Promise<void> {
  const factory = vaultFactoryContract();
  const args = [toScVal(signerPublicKey, 'address'), toScVal(name, 'string')];
  const xdr = await buildTransaction(signerPublicKey, factory, 'create_vault', args);
  await signAndSubmit(signerPublicKey, walletId, xdr);
}

export async function claimLeaderFees(
  signerPublicKey: string,
  walletId: string,
  vaultId: number,
): Promise<void> {
  const factory = vaultFactoryContract();
  const args = [toScVal(vaultId, 'u32')];
  const xdr = await buildTransaction(signerPublicKey, factory, 'claim_leader_fees', args);
  await signAndSubmit(signerPublicKey, walletId, xdr);
}

export async function leaderOpenPosition(
  signerPublicKey: string,
  walletId: string,
  params: {
    vaultId: number;
    asset: string;
    collateral: bigint;
    leverage: number;
    direction: 'Long' | 'Short';
  },
): Promise<void> {
  const factory = vaultFactoryContract();
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(params.vaultId, 'u32'),
    toScVal(params.asset, 'symbol'),
    toScVal(params.collateral, 'i128'),
    toScVal(params.leverage, 'u32'),
    toScVal(params.direction === 'Long' ? 0 : 1, 'u32'),
  ];
  const xdr = await buildTransaction(signerPublicKey, factory, 'leader_open_position', args);
  await signAndSubmit(signerPublicKey, walletId, xdr);
}

export async function leaderClosePosition(
  signerPublicKey: string,
  walletId: string,
  vaultId: number,
  positionId: number,
): Promise<void> {
  const factory = vaultFactoryContract();
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(vaultId, 'u32'),
    toScVal(positionId, 'u64'),
  ];
  const xdr = await buildTransaction(signerPublicKey, factory, 'leader_close_position', args);
  await signAndSubmit(signerPublicKey, walletId, xdr);
}

export const VAULT_FACTORY_CONFIGURED = (): boolean =>
  Boolean(process.env.NEXT_PUBLIC_VAULT_FACTORY_ID);

void WALLETCONNECT_ID;

// ─── Read-only simulations ──────────────────────────────────────────────

async function simulateView(contract: Contract, source: string, method: string, args: any[]): Promise<unknown> {
  const account = await sorobanRpc.getAccount(source);
  const op = contract.call(method, ...args);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();
  const sim = await sorobanRpc.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  if (!sim.result?.retval) return null;
  return scValToNative(sim.result.retval);
}

/** Read the depositor's share balance for a vault (returns precision-scaled bigint as string). */
export async function getUserVaultShares(source: string, vaultId: number, depositor: string): Promise<bigint> {
  const factory = vaultFactoryContract();
  const result = await simulateView(factory, source, 'shares_of', [
    toScVal(vaultId, 'u32'),
    toScVal(depositor, 'address'),
  ]);
  return typeof result === 'bigint' ? result : BigInt(result as number | string | 0);
}

/** Read the depositor's USDC balance via the SAC. */
export async function getWalletUsdcBalance(source: string): Promise<bigint> {
  const usdc = new Contract(CONTRACTS.USDC_TOKEN);
  const result = await simulateView(usdc, source, 'balance', [
    new Address(source).toScVal(),
  ]);
  return typeof result === 'bigint' ? result : BigInt(result as number | string | 0);
}

/**
 * On-chain shape of VaultInfo, exactly as the contract emits it from
 * the `view_vault` view fn (mirrors the Rust struct field order).
 */
export interface OnChainVaultInfo {
  id: number;
  leader: string;
  name: string;
  createdAt: number;
  totalUsdc: bigint;
  circulatingShares: bigint;
  hwmNav: bigint;
  realizedPnl: bigint;
  leaderShares: bigint;
  profitShareBps: number;
  paused: boolean;
}

function decodeVaultInfo(raw: unknown): OnChainVaultInfo {
  // scValToNative turns the struct into a plain object keyed by the
  // contract's snake_case field names.
  const r = raw as Record<string, unknown>;
  return {
    id: Number(r.id ?? 0),
    leader: String(r.leader),
    name: String(r.name),
    createdAt: Number(r.created_at ?? 0),
    totalUsdc: BigInt((r.total_usdc as number | bigint | string | undefined) ?? 0),
    circulatingShares: BigInt((r.circulating_shares as number | bigint | string | undefined) ?? 0),
    hwmNav: BigInt((r.hwm_nav as number | bigint | string | undefined) ?? 0),
    realizedPnl: BigInt((r.realized_pnl as number | bigint | string | undefined) ?? 0),
    leaderShares: BigInt((r.leader_shares as number | bigint | string | undefined) ?? 0),
    profitShareBps: Number(r.profit_share_bps ?? 1000),
    paused: Boolean(r.paused),
  };
}

/** How many vaults exist (vault ids are dense 0..N-1). */
export async function getVaultCount(source: string): Promise<number> {
  const factory = vaultFactoryContract();
  const v = await simulateView(factory, source, 'vault_count', []);
  return Number(v ?? 0);
}

/** Fetch a single VaultInfo by id. */
export async function getVaultInfo(source: string, vaultId: number): Promise<OnChainVaultInfo | null> {
  const factory = vaultFactoryContract();
  try {
    const raw = await simulateView(factory, source, 'view_vault', [toScVal(vaultId, 'u32')]);
    return decodeVaultInfo(raw);
  } catch {
    return null;
  }
}

/**
 * Read every vault from the chain in parallel. Used by the marketplace
 * page so it doesn't depend on the indexer/API being up.
 */
export async function listAllVaultsOnChain(source: string): Promise<OnChainVaultInfo[]> {
  const count = await getVaultCount(source);
  if (count === 0) return [];
  const ids = Array.from({ length: count }, (_, i) => i);
  const results = await Promise.all(ids.map((id) => getVaultInfo(source, id)));
  return results.filter((v): v is OnChainVaultInfo => v !== null);
}
