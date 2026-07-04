import { createHash, randomBytes } from 'node:crypto';
import type { Client } from '@libsql/client';

export type KeyTier = 'standard' | 'market_maker';

export interface ApiKeyRecord {
  keyId: string;
  owner: string;
  tier: KeyTier;
  label: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface IssuedApiKey {
  keyId: string;
  secret: string;
  tier: KeyTier;
  owner: string;
  createdAt: number;
}

const KEY_ID_BYTES = 12;
const SECRET_BYTES = 32;

export class ApiKeyStore {
  constructor(
    private readonly db: Client,
    private readonly pepper: string,
  ) {}

  async issue(owner: string, label?: string, tier: KeyTier = 'standard'): Promise<IssuedApiKey> {
    const keyId = `nk_${randomBytes(KEY_ID_BYTES).toString('hex')}`;
    const secret = randomBytes(SECRET_BYTES).toString('hex');
    const secretHash = this.hashSecret(secret);
    const createdAt = Date.now();
    await this.db.execute({
      sql: `
        INSERT INTO api_keys (key_id, secret_hash, owner, tier, label, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [keyId, secretHash, owner, tier, label ?? null, createdAt],
    });
    return { keyId, secret, owner, tier, createdAt };
  }

  async lookupForAuth(keyId: string, presentedSecret: string): Promise<ApiKeyRecord | null> {
    const result = await this.db.execute({
      sql: `
        SELECT key_id, secret_hash, owner, tier, label, created_at, last_used_at, revoked_at
        FROM api_keys
        WHERE key_id = ?
      `,
      args: [keyId],
    });
    const row = result.rows[0];
    if (!row) return null;
    if (row.revoked_at !== null) return null;
    if (!timingSafeEqualHex(this.hashSecret(presentedSecret), String(row.secret_hash))) return null;

    // Update last_used_at; ignore failures.
    void this.db
      .execute({
        sql: 'UPDATE api_keys SET last_used_at = ? WHERE key_id = ?',
        args: [Date.now(), keyId],
      })
      .catch(() => undefined);

    return {
      keyId: String(row.key_id),
      owner: String(row.owner),
      tier: String(row.tier) as KeyTier,
      label: (row.label as string | null) ?? null,
      createdAt: Number(row.created_at),
      lastUsedAt: row.last_used_at !== null ? Number(row.last_used_at) : null,
      revokedAt: row.revoked_at !== null ? Number(row.revoked_at) : null,
    };
  }

  /**
   * Look up by keyId only (for auth middleware that has the secret separately).
   * Returns null when revoked.
   */
  async lookup(keyId: string): Promise<{ record: ApiKeyRecord; secretHash: string } | null> {
    const result = await this.db.execute({
      sql: `
        SELECT key_id, secret_hash, owner, tier, label, created_at, last_used_at, revoked_at
        FROM api_keys
        WHERE key_id = ?
      `,
      args: [keyId],
    });
    const row = result.rows[0];
    if (!row) return null;
    if (row.revoked_at !== null) return null;
    return {
      secretHash: String(row.secret_hash),
      record: {
        keyId: String(row.key_id),
        owner: String(row.owner),
        tier: String(row.tier) as KeyTier,
        label: (row.label as string | null) ?? null,
        createdAt: Number(row.created_at),
        lastUsedAt: row.last_used_at !== null ? Number(row.last_used_at) : null,
        revokedAt: null,
      },
    };
  }

  async listForOwner(owner: string): Promise<ApiKeyRecord[]> {
    const result = await this.db.execute({
      sql: `
        SELECT key_id, owner, tier, label, created_at, last_used_at, revoked_at
        FROM api_keys
        WHERE owner = ?
        ORDER BY created_at DESC
      `,
      args: [owner],
    });
    return result.rows.map((row) => ({
      keyId: String(row.key_id),
      owner: String(row.owner),
      tier: String(row.tier) as KeyTier,
      label: (row.label as string | null) ?? null,
      createdAt: Number(row.created_at),
      lastUsedAt: row.last_used_at !== null ? Number(row.last_used_at) : null,
      revokedAt: row.revoked_at !== null ? Number(row.revoked_at) : null,
    }));
  }

  async revoke(keyId: string, owner: string): Promise<boolean> {
    const result = await this.db.execute({
      sql: `
        UPDATE api_keys
        SET revoked_at = ?
        WHERE key_id = ? AND owner = ? AND revoked_at IS NULL
      `,
      args: [Date.now(), keyId, owner],
    });
    return Number(result.rowsAffected ?? 0) > 0;
  }

  hashSecret(secret: string): string {
    return createHash('sha256').update(secret).update(this.pepper).digest('hex');
  }
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
