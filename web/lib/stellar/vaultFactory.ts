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
