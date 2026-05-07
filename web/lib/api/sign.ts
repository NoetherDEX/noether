/**
 * Sign arbitrary bytes with the connected Stellar wallet.
 *
 * Used by the API-key challenge flow: the gateway returns 32 random
 * bytes the user must sign with their wallet keypair. Some wallet
 * adapters expose `signMessage` directly; for ones that only sign
 * full transactions we wrap the bytes in a SEP-10-style manageData
 * tx, sign it, and pull the signature off the resulting envelope.
 */

import {
  Networks,
  Operation,
  TransactionBuilder,
  Account,
  Keypair,
  type Transaction,
} from '@stellar/stellar-sdk';
import { signWithWallet } from '@/lib/stellar/walletKit';
import { NETWORK } from '@/lib/utils/constants';

/**
 * Sign a 32-byte challenge buffer with the connected wallet and
 * return a hex-encoded ed25519 signature compatible with the
 * gateway's `Keypair.fromPublicKey(addr).verify(...)` check.
 *
 * Implementation detail: we wrap the challenge bytes as the value
 * field of a `manageData` operation on a sequence-0 source-account
 * tx (SEP-10 pattern, but server-less). The wallet signs the tx;
 * we extract the resulting decorated signature's raw bytes.
 */
export async function signChallengeWithWallet(
  challengeHex: string,
  signerAddress: string,
): Promise<string> {
  // Use a dummy keypair as the source account so the placeholder tx
  // has valid network framing without touching the user's account.
  // The wallet only signs the tx; we never submit it.
  const placeholder = Keypair.random().publicKey();
  const account = new Account(placeholder, '0');

  const tx = new TransactionBuilder(account, {
    fee: '0',
    networkPassphrase: NETWORK.PASSPHRASE,
  })
    .addOperation(
      Operation.manageData({
        name: 'noether-api auth',
        value: Buffer.from(challengeHex, 'hex'),
        source: signerAddress,
      }),
    )
    .setTimeout(0)
    .build();

  const signedXdr = await signWithWallet(tx.toXDR(), {
    networkPassphrase: NETWORK.PASSPHRASE,
    address: signerAddress,
  });

  const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK.PASSPHRASE) as Transaction;
  const sig = signedTx.signatures[0]?.signature();
  if (!sig) throw new Error('Wallet did not return a signature');
  return sig.toString('hex');
}

void Networks;
