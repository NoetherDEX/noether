import { randomBytes } from 'node:crypto';
import {
  Keypair,
  TransactionBuilder,
  type Transaction,
  type FeeBumpTransaction,
} from '@stellar/stellar-sdk';

/**
 * Stellar wallet challenge / verify.
 *
 * Lightweight scheme used to bootstrap API key issuance:
 *  1. Client requests a challenge for their Stellar address.
 *  2. Server returns 32 random bytes (hex) with a 5 min in-memory TTL.
 *  3. Client wraps those bytes as the `value` of a `manageData` op on a
 *     placeholder tx, has the wallet sign the tx (SEP-10 style), and
 *     submits the base64-encoded signed XDR.
 *  4. Server parses the XDR, asserts the manageData op's value matches
 *     the issued challenge, and verifies one of the tx signatures
 *     against the transaction hash using
 *     `Keypair.fromPublicKey(address).verify(txHash, sig)`.
 *
 * Verifying the tx hash (not raw bytes) is what makes this compatible
 * with every browser wallet — Freighter, xBull, Lobstr, Wallets Kit
 * adapters all expose `signTransaction` but rarely `signMessage`.
 */

const CHALLENGE_TTL_MS = 5 * 60_000;

interface PendingChallenge {
  challenge: Buffer;
  expiresAt: number;
}

export interface IssuedChallenge {
  challengeHex: string;
  expiresAt: number;
}

export class WalletAuth {
  private readonly pending = new Map<string, PendingChallenge>();

  constructor(private readonly networkPassphrase: string) {}

  issueChallenge(address: string): IssuedChallenge {
    this.gc();
    const challenge = randomBytes(32);
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    this.pending.set(address, { challenge, expiresAt });
    return { challengeHex: challenge.toString('hex'), expiresAt };
  }

  /**
   * One-shot verify: consumes the challenge whether successful or not.
   * `proof` is the base64 XDR of a signed Stellar transaction whose
   * first operation is `manageData` carrying the challenge bytes.
   */
  verify(address: string, challengeHex: string, proof: string): boolean {
    this.gc();
    const pending = this.pending.get(address);
    if (!pending) return false;
    this.pending.delete(address);

    if (pending.expiresAt < Date.now()) return false;
    if (pending.challenge.toString('hex') !== challengeHex) return false;

    try {
      const tx = TransactionBuilder.fromXDR(proof, this.networkPassphrase) as
        | Transaction
        | FeeBumpTransaction;
      // We only emit plain Transactions on the client; reject fee-bump
      // envelopes outright.
      if ('innerTransaction' in tx) return false;

      // Pull the challenge bytes out of the first manageData op.
      const ops = tx.operations;
      const op = ops[0];
      if (!op || op.type !== 'manageData') return false;
      const value = (op as { value?: Buffer | string }).value;
      const valueBuf =
        value instanceof Buffer
          ? value
          : typeof value === 'string'
          ? Buffer.from(value, 'base64')
          : null;
      if (!valueBuf || !valueBuf.equals(pending.challenge)) return false;

      // Verify *any* attached signature matches the address's pubkey
      // over the transaction hash.
      const kp = Keypair.fromPublicKey(address);
      const txHash = tx.hash();
      for (const decoratedSig of tx.signatures) {
        try {
          if (kp.verify(txHash, decoratedSig.signature())) return true;
        } catch {
          // try next
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  private gc(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) {
      if (v.expiresAt < now) this.pending.delete(k);
    }
  }
}
