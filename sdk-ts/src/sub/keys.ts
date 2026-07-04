import {
  Account,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import type { Credentials, Transport } from '../transport.js';

export interface IssuedChallenge {
  challengeHex: string;
  expiresAt: number;
}

export interface IssuedApiKey {
  keyId: string;
  secret: string;
  owner: string;
  tier: 'standard' | 'market_maker';
  createdAt: number;
}

export interface ApiKeyRecord {
  keyId: string;
  owner: string;
  tier: 'standard' | 'market_maker';
  label: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface BetaStatus {
  /** True when key issuance is gated to a closed-beta allowlist. */
  gated: boolean;
  /** True when issuance is open, or the supplied address is on the allowlist. */
  allowed: boolean;
}

/**
 * Function the caller provides to sign 32 bytes (a transaction hash) with
 * the Stellar private key. The SDK never sees the secret. Examples:
 *
 *   import { Keypair } from '@stellar/stellar-sdk';
 *   const kp = Keypair.fromSecret('S...');
 *   const sign: ChallengeSigner = (data) => kp.sign(data);
 */
export type ChallengeSigner = (data: Buffer) => Buffer | Promise<Buffer>;

export interface KeysCreateOptions {
  address: string;
  signer: ChallengeSigner;
  label?: string;
  /**
   * Network passphrase used to construct the wrapping manageData tx.
   * Defaults to the public testnet (`Networks.TESTNET`). The value must
   * match the API gateway's network — pass `Networks.PUBLIC` for
   * mainnet deployments.
   */
  networkPassphrase?: string;
}

export class KeysApi {
  constructor(private readonly transport: Transport, private readonly credentials: Credentials | null) {}

  /** Public — whether key issuance is closed-beta gated (and if `address` is allowed). */
  async betaStatus(address?: string): Promise<BetaStatus> {
    return this.transport.request<BetaStatus>({
      path: '/v1/keys/beta-status',
      query: { address },
    });
  }

  async requestChallenge(address: string): Promise<IssuedChallenge> {
    return this.transport.request<IssuedChallenge>({
      method: 'POST',
      path: '/v1/keys/challenge',
      body: { address },
    });
  }

  /**
   * Exchange a SEP-10-style signed XDR for an API key. The `signature`
   * field on the server endpoint carries the full base64-encoded signed
   * transaction (legacy field name; kept for wire compatibility).
   */
  async exchange(input: {
    address: string;
    challenge: string;
    signedXdr: string;
    label?: string;
  }): Promise<IssuedApiKey> {
    return this.transport.request<IssuedApiKey>({
      method: 'POST',
      path: '/v1/keys',
      body: {
        address: input.address,
        challenge: input.challenge,
        signature: input.signedXdr,
        label: input.label,
      },
    });
  }

  /**
   * Convenience: request a challenge, wrap it as a manageData op on a
   * placeholder transaction, ask the caller's signer to sign the tx
   * hash, assemble a signed XDR, exchange it for an API key.
   *
   * This matches the gateway's verification path:
   *   1. Server parses the XDR.
   *   2. Asserts op[0] is manageData carrying the issued challenge.
   *   3. Verifies any tx signature against `tx.hash()` with the
   *      address's pubkey.
   */
  async create(input: KeysCreateOptions): Promise<IssuedApiKey> {
    const networkPassphrase = input.networkPassphrase ?? Networks.TESTNET;
    const challenge = await this.requestChallenge(input.address);

    // Build a sequence-0 placeholder tx whose only op is a manageData
    // carrying the challenge bytes. We use a random source account so
    // we don't need the user's actual account state.
    const placeholderSource = Keypair.random().publicKey();
    const account = new Account(placeholderSource, '0');
    const tx = new TransactionBuilder(account, {
      fee: '0',
      networkPassphrase,
    })
      .addOperation(
        Operation.manageData({
          name: 'noether-api auth',
          value: Buffer.from(challenge.challengeHex, 'hex'),
          source: input.address,
        }),
      )
      .setTimeout(0)
      .build();

    // Get the caller to sign the tx hash, then attach as a decorated
    // signature using the address's keypair hint.
    const txHash = tx.hash();
    const rawSig = await input.signer(txHash);
    const kp = Keypair.fromPublicKey(input.address);
    tx.addSignature(input.address, Buffer.from(rawSig).toString('base64'));
    void kp; // keep the import warning-free; hint is derived inside addSignature

    return this.exchange({
      address: input.address,
      challenge: challenge.challengeHex,
      signedXdr: tx.toXDR(),
      label: input.label,
    });
  }

  async list(): Promise<ApiKeyRecord[]> {
    this.requireAuth();
    const res = await this.transport.request<{ keys: ApiKeyRecord[] }>({
      path: '/v1/keys',
      credentials: this.credentials,
    });
    return res.keys;
  }

  async revoke(keyId: string): Promise<void> {
    this.requireAuth();
    await this.transport.request({
      method: 'DELETE',
      path: `/v1/keys/${encodeURIComponent(keyId)}`,
      credentials: this.credentials,
    });
  }

  private requireAuth(): void {
    if (!this.credentials) throw new Error('keys.list / keys.revoke require an authenticated client (pass credentials in NoetherClient options)');
  }
}
