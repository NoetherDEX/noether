/**
 * Sign the API gateway's challenge with the connected Stellar wallet.
 *
 * The gateway hands back 32 random bytes; we wrap them as the `value`
 * field of a `manageData` op on a sequence-0 placeholder transaction
 * (SEP-10 style). The wallet signs the tx; we return the full signed
 * XDR. The server then:
 *   - parses the XDR
 *   - checks that op[0] is a manageData op carrying the challenge
 *   - verifies one of the tx signatures against `tx.hash()` using the
 *     submitter's public key
 *
 * Verifying against the tx hash (instead of raw bytes) keeps us
 * compatible with every browser wallet, since `signTransaction` is
 * the only universally-exposed signing primitive.
 */

import {
  Operation,
  TransactionBuilder,
  Account,
  Keypair,
} from '@stellar/stellar-sdk';
import { signWithWallet } from '@/lib/stellar/walletKit';
import { NETWORK } from '@/lib/utils/constants';

/**
 * Sign a 32-byte challenge buffer with the connected wallet and
 * return the base64 XDR of the signed transaction. The API gateway
 * verifies the tx-hash signature server-side.
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

  return signedXdr;
}
