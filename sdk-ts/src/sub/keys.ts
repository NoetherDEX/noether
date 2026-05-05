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

/**
 * Function the caller provides to sign a raw challenge buffer with the
 * Stellar private key. The SDK never sees the secret. Examples:
 *
 *   import { Keypair } from '@stellar/stellar-sdk';
 *   const kp = Keypair.fromSecret('S...');
 *   const sign: Signer = (data) => kp.sign(data);
 */
export type ChallengeSigner = (data: Buffer) => Buffer | Promise<Buffer>;

export class KeysApi {
  constructor(private readonly transport: Transport, private readonly credentials: Credentials | null) {}

  async requestChallenge(address: string): Promise<IssuedChallenge> {
    return this.transport.request<IssuedChallenge>({
      method: 'POST',
      path: '/v1/keys/challenge',
      body: { address },
    });
  }

  async exchange(input: { address: string; challenge: string; signatureHex: string; label?: string }): Promise<IssuedApiKey> {
    return this.transport.request<IssuedApiKey>({
      method: 'POST',
      path: '/v1/keys',
      body: {
        address: input.address,
        challenge: input.challenge,
        signature: input.signatureHex,
        label: input.label,
      },
    });
  }

  /**
   * Convenience: request a challenge, ask the caller to sign it, exchange
   * for a key. Returns both the key id and secret — store the secret
   * immediately, it cannot be retrieved later.
   */
  async create(input: { address: string; signer: ChallengeSigner; label?: string }): Promise<IssuedApiKey> {
    const challenge = await this.requestChallenge(input.address);
    const signature = await input.signer(Buffer.from(challenge.challengeHex, 'hex'));
    const signatureHex = Buffer.from(signature).toString('hex');
    return this.exchange({
      address: input.address,
      challenge: challenge.challengeHex,
      signatureHex,
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
