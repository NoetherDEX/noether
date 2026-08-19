/**
 * Direct vault_factory contract calls — mirrors web/lib/stellar/market.ts.
 *
 * The contract address is read from `NEXT_PUBLIC_VAULT_FACTORY_ID`;
 * if unset the helpers throw so the UI can surface a "deploy pending"
 * state instead of misrouting transactions.
 */

import { Address, Contract, TransactionBuilder, BASE_FEE, rpc, scValToNative } from '@stellar/stellar-sdk';
import { buildTransaction, simulateCallResult, submitTransaction, sorobanRpc, toScVal } from './client';
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

// R-6: follower slippage tolerance for the on-chain min-out bounds. The
// factory reverts (MinOutputNotMet) instead of filling below quote − 0.5%.
const LP_SLIPPAGE_BPS = 50n;
const BPS = 10_000n;

function minOut(quoted: bigint): bigint {
  return (quoted * (BPS - LP_SLIPPAGE_BPS)) / BPS;
}

export async function depositToVault(
  signerPublicKey: string,
  walletId: string,
  vaultId: number,
  amount: bigint,
): Promise<void> {
  const factory = vaultFactoryContract();
  // R-6: pre-quote the share mint at full NAV, bound the real call below it.
  const probeArgs = [
    toScVal(signerPublicKey, 'address'),
    toScVal(vaultId, 'u32'),
    toScVal(amount, 'i128'),
    toScVal(0n, 'i128'),
  ];
  const quoted = await simulateCallResult<bigint>(signerPublicKey, factory, 'deposit', probeArgs);
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(vaultId, 'u32'),
    toScVal(amount, 'i128'),
    toScVal(minOut(quoted), 'i128'),
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
  // R-6: pre-quote the USDC payout, bound the real call below it.
  const probeArgs = [
    toScVal(signerPublicKey, 'address'),
    toScVal(vaultId, 'u32'),
    toScVal(shares, 'i128'),
    toScVal(0n, 'i128'),
  ];
  const quoted = await simulateCallResult<bigint>(signerPublicKey, factory, 'withdraw', probeArgs);
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(vaultId, 'u32'),
    toScVal(shares, 'i128'),
    toScVal(minOut(quoted), 'i128'),
  ];
  const xdr = await buildTransaction(signerPublicKey, factory, 'withdraw', args);
  await signAndSubmit(signerPublicKey, walletId, xdr);
}

export async function createVault(
  signerPublicKey: string,
  walletId: string,
  name: string,
): Promise<number | null> {
  const factory = vaultFactoryContract();
  const args = [toScVal(signerPublicKey, 'address'), toScVal(name, 'string')];
  const xdr = await buildTransaction(signerPublicKey, factory, 'create_vault', args);
  const result = await signAndSubmit(signerPublicKey, walletId, xdr);
  // B16: the contract returns the new vault id — surface it so the UI can
  // route straight to the fresh vault instead of dead-ending on a grid the
  // indexer hasn't caught up with yet.
  try {
    const rv = (result as { returnValue?: Parameters<typeof scValToNative>[0] })?.returnValue;
    if (rv) return Number(scValToNative(rv));
  } catch {
    /* id extraction is best-effort — creation itself succeeded */
  }
  return null;
}

/** Leader-only pause/unpause — while paused, deposit() and withdraw()
 *  revert with FactoryError::Paused (B19: was never wired in the UI). */
export async function setVaultPaused(
  signerPublicKey: string,
  walletId: string,
  vaultId: number,
  paused: boolean,
): Promise<void> {
  const factory = vaultFactoryContract();
  const args = [toScVal(vaultId, 'u32'), toScVal(paused, 'bool')];
  const xdr = await buildTransaction(signerPublicKey, factory, 'set_paused', args);
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
  // profit_share_bps is a required field of the on-chain VaultInfo struct
  // (contracts/vault_factory/src/types.rs). If it's missing the decode is
  // broken — fail loud rather than silently invent "10%" leader economics
  // (getVaultInfo's catch turns this into null, hiding the row).
  if (r.profit_share_bps == null) {
    throw new Error(`view_vault decode: profit_share_bps missing (vault ${String(r.id)})`);
  }
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
    profitShareBps: Number(r.profit_share_bps),
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
 * L0-20 full NAV (Batch-1 factory): liquid USDC + Σ live position equity +
 * Σ pending order collateral — the price deposits/withdrawals/claims use.
 * Fail-closed on-chain (#18 ValuationUnavailable) while any leg is
 * unreadable — surfaced as 'unavailable' so pages explain instead of
 * rendering a wrong number. null = the deployed factory predates L0-20
 * (or the read failed) — callers omit the row entirely.
 */
export async function getFullNav(
  source: string,
  vaultId: number,
): Promise<bigint | 'unavailable' | null> {
  const factory = vaultFactoryContract();
  try {
    const raw = await simulateView(factory, source, 'get_full_nav', [toScVal(vaultId, 'u32')]);
    return BigInt(raw as bigint);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/Error\(Contract, #18\)/.test(msg)) return 'unavailable';
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
