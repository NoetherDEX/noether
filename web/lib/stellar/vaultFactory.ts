/**
 * Direct vault_factory contract calls — mirrors web/lib/stellar/market.ts.
 *
 * The contract address is read from `NEXT_PUBLIC_VAULT_FACTORY_ID`;
 * if unset the helpers throw so the UI can surface a "deploy pending"
 * state instead of misrouting transactions.
 */

import { Contract } from '@stellar/stellar-sdk';
import { buildTransaction, submitTransaction, toScVal } from './client';
import { signWithWallet, WALLETCONNECT_ID } from './walletKit';
import { NETWORK } from '@/lib/utils/constants';

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
