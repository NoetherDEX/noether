import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * Stellar wallet challenge / verify.
 *
 * Lightweight scheme used to bootstrap API key issuance:
 * 1. Client requests a challenge for their Stellar address.
 * 2. Server returns 32 random bytes (hex) and stores it in-memory with
 *    a 5 min expiry.
 * 3. Client signs the raw bytes with their Stellar keypair.
 * 4. Server verifies the signature using
 *    `Keypair.fromPublicKey(addr).verify(...)`.
 *
 * For browser wallets that do not expose raw byte signing (Freighter
 * mostly does, Ledger does not directly), Phase 9 will add a SEP-10
 * style transaction-based fallback.
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

  issueChallenge(address: string): IssuedChallenge {
    this.gc();
    const challenge = randomBytes(32);
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    this.pending.set(address, { challenge, expiresAt });
    return { challengeHex: challenge.toString('hex'), expiresAt };
  }

  /** One-shot verify: consumes the challenge whether successful or not. */
  verify(address: string, challengeHex: string, signatureHex: string): boolean {
    this.gc();
    const pending = this.pending.get(address);
    if (!pending) return false;
    this.pending.delete(address);

    if (pending.expiresAt < Date.now()) return false;
    if (pending.challenge.toString('hex') !== challengeHex) return false;

    try {
      const kp = Keypair.fromPublicKey(address);
      const signature = Buffer.from(signatureHex, 'hex');
      return kp.verify(pending.challenge, signature);
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
