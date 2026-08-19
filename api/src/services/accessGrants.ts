import { isMissingTable, type Db, type Row } from '@noether/db';

/**
 * Workstream A access store — the single source of truth for who may enter
 * the gated app AND who passes the closed-beta gate (union with the legacy
 * API_KEY_ALLOWLIST env during the transition; migration 009).
 *
 * Every admin decision writes access_audit_log — the launch's own audit
 * trail. Approval checks are FAIL-CLOSED: a missing table reads as "not
 * approved", never as "open".
 */

export type GrantStatus = 'pending' | 'approved' | 'rejected' | 'revoked';
export type GrantAction = 'approve' | 'reject' | 'revoke';
export type GrantSegment = 'trader' | 'lp' | 'both';

/** Stamped server-side on every join; bump when /terms changes materially. */
export const TOS_VERSION = 'v1-2026-08';

export interface AccessGrantRecord {
  wallet: string;
  email: string | null;
  status: GrantStatus;
  source: string;
  wave: string | null;
  segment: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  notes: string | null;
  emailSentAt: string | null;
}

export interface JoinInput {
  wallet: string;
  email?: string;
  segment?: GrantSegment;
}

export interface ListFilter {
  status?: GrantStatus;
  wave?: string;
  q?: string;
  limit: number;
  offset: number;
}

export interface DecideInput {
  wallets: string[];
  action: GrantAction;
  wave?: string;
  notes?: string;
  actor: string;
}

function toRecord(row: Row): AccessGrantRecord {
  const r = row as unknown as Record<string, unknown>;
  return {
    wallet: String(r.wallet),
    email: r.email == null ? null : String(r.email),
    status: String(r.status) as GrantStatus,
    source: String(r.source),
    wave: r.wave == null ? null : String(r.wave),
    segment: r.segment == null ? null : String(r.segment),
    requestedAt: String(r.requested_at),
    decidedAt: r.decided_at == null ? null : String(r.decided_at),
    decidedBy: r.decided_by == null ? null : String(r.decided_by),
    notes: r.notes == null ? null : String(r.notes),
    emailSentAt: r.email_sent_at == null ? null : String(r.email_sent_at),
  };
}

export class AccessGrantsService {
  constructor(private readonly db: Db) {}

  /**
   * Idempotent waitlist join: first write wins, a re-submission returns the
   * wallet's current status untouched (people re-submit; never error).
   */
  async join(input: JoinInput): Promise<{ status: GrantStatus }> {
    const inserted = await this.db.execute({
      sql: `
        INSERT INTO access_grants (wallet, email, status, source, segment, attested_at, tos_version)
        VALUES (?, ?, 'pending', 'waitlist', ?, now(), ?)
        ON CONFLICT (wallet) DO NOTHING
        RETURNING status
      `,
      args: [input.wallet, input.email ?? null, input.segment ?? null, TOS_VERSION],
    });
    const fresh = inserted.rows[0];
    if (fresh) return { status: String((fresh as unknown as Record<string, unknown>).status) as GrantStatus };
    const existing = await this.db.execute({
      sql: 'SELECT status FROM access_grants WHERE wallet = ?',
      args: [input.wallet],
    });
    const row = existing.rows[0] as unknown as Record<string, unknown> | undefined;
    return { status: (row ? String(row.status) : 'pending') as GrantStatus };
  }

  /**
   * Coarse public status: approved / pending / none. Rejected and revoked
   * deliberately read as 'pending' — the public endpoint never discloses a
   * negative decision.
   */
  async status(wallet: string): Promise<'approved' | 'pending' | 'none'> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT status FROM access_grants WHERE wallet = ?',
        args: [wallet],
      });
      const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
      if (!row) return 'none';
      return String(row.status) === 'approved' ? 'approved' : 'pending';
    } catch (err) {
      if (isMissingTable(err)) return 'none';
      throw err;
    }
  }

  /** Fail-closed approval check (missing table ⇒ NOT approved). */
  async isApproved(wallet: string): Promise<boolean> {
    try {
      const result = await this.db.execute({
        sql: "SELECT 1 AS ok FROM access_grants WHERE wallet = ? AND status = 'approved'",
        args: [wallet],
      });
      return result.rows.length > 0;
    } catch (err) {
      if (isMissingTable(err)) return false;
      throw err;
    }
  }

  /** Approved wallet's wave tag (for the approval email / unlock response). */
  async grantOf(wallet: string): Promise<AccessGrantRecord | null> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT * FROM access_grants WHERE wallet = ?',
        args: [wallet],
      });
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    } catch (err) {
      if (isMissingTable(err)) return null;
      throw err;
    }
  }

  async list(filter: ListFilter): Promise<AccessGrantRecord[]> {
    const clauses: string[] = [];
    const args: Array<string | number> = [];
    if (filter.status) {
      clauses.push('status = ?');
      args.push(filter.status);
    }
    if (filter.wave) {
      clauses.push('wave = ?');
      args.push(filter.wave);
    }
    if (filter.q) {
      clauses.push('(wallet ILIKE ? OR email ILIKE ?)');
      args.push(`${filter.q}%`, `%${filter.q}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await this.db.execute({
      sql: `SELECT * FROM access_grants ${where} ORDER BY requested_at DESC LIMIT ? OFFSET ?`,
      args: [...args, filter.limit, filter.offset],
    });
    return result.rows.map(toRecord);
  }

  async counts(): Promise<Record<string, number>> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT status, COUNT(*) AS n FROM access_grants GROUP BY status',
      });
      const out: Record<string, number> = {};
      for (const row of result.rows) {
        const r = row as unknown as Record<string, unknown>;
        out[String(r.status)] = Number(r.n);
      }
      return out;
    } catch (err) {
      if (isMissingTable(err)) return {};
      throw err;
    }
  }

  /**
   * Batch decision. approve upserts (an admin may grant a wallet that never
   * joined — source 'admin'); reject/revoke only touch existing rows. Every
   * outcome writes one audit row. Returns the wallets actually changed.
   */
  async decide(input: DecideInput): Promise<{ updated: string[] }> {
    const status: GrantStatus =
      input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : 'revoked';
    const updated: string[] = [];
    const tx = await this.db.transaction('write');
    try {
      for (const wallet of input.wallets) {
        let changed = 0;
        if (input.action === 'approve') {
          const result = await tx.execute({
            sql: `
              INSERT INTO access_grants (wallet, status, source, wave, notes, decided_at, decided_by)
              VALUES (?, 'approved', 'admin', ?, ?, now(), ?)
              ON CONFLICT (wallet) DO UPDATE SET
                status = 'approved',
                wave = COALESCE(EXCLUDED.wave, access_grants.wave),
                notes = COALESCE(EXCLUDED.notes, access_grants.notes),
                decided_at = now(),
                decided_by = EXCLUDED.decided_by
            `,
            args: [wallet, input.wave ?? null, input.notes ?? null, input.actor],
          });
          changed = Number(result.rowsAffected ?? 0);
        } else {
          const result = await tx.execute({
            sql: `
              UPDATE access_grants
              SET status = ?, notes = COALESCE(?, notes), decided_at = now(), decided_by = ?
              WHERE wallet = ?
            `,
            args: [status, input.notes ?? null, input.actor, wallet],
          });
          changed = Number(result.rowsAffected ?? 0);
        }
        if (changed > 0) {
          updated.push(wallet);
          await tx.execute({
            sql: 'INSERT INTO access_audit_log (actor, action, wallet, detail) VALUES (?, ?, ?, ?)',
            args: [
              input.actor,
              input.action,
              wallet,
              JSON.stringify({ wave: input.wave ?? null, notes: input.notes ?? null }),
            ],
          });
        }
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    return { updated };
  }

  async markEmailSent(wallet: string): Promise<void> {
    await this.db.execute({
      sql: 'UPDATE access_grants SET email_sent_at = now() WHERE wallet = ?',
      args: [wallet],
    });
  }

  /** Append a standalone audit row (exports, resends, …). */
  async audit(actor: string, action: string, wallet: string | null, detail?: unknown): Promise<void> {
    await this.db.execute({
      sql: 'INSERT INTO access_audit_log (actor, action, wallet, detail) VALUES (?, ?, ?, ?)',
      args: [actor, action, wallet, detail === undefined ? null : JSON.stringify(detail)],
    });
  }
}
