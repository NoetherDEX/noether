import type { Client } from '@libsql/client';

export interface PollCursor {
  lastLedger: number;
  lastPagingToken: string | null;
  updatedAt: number;
}

/**
 * Read the singleton cursor row. Returns null if not yet initialized.
 */
export async function readCursor(db: Client): Promise<PollCursor | null> {
  const result = await db.execute('SELECT last_ledger, last_pagination_token, updated_at FROM poll_cursor WHERE id = 1');
  const row = result.rows[0];
  if (!row) return null;
  return {
    lastLedger: Number(row.last_ledger),
    lastPagingToken: (row.last_pagination_token as string | null) ?? null,
    updatedAt: Number(row.updated_at),
  };
}

/**
 * Compare-and-swap write of the cursor singleton. The write only lands
 * when the row still holds `expectedLastLedger` (null = the row must
 * not exist yet). A miss means another poller wrote concurrently —
 * the caller must stop instead of double-applying (I-4).
 */
export async function writeCursor(
  db: Client,
  cursor: PollCursor,
  expectedLastLedger: number | null,
): Promise<boolean> {
  if (expectedLastLedger === null) {
    const result = await db.execute({
      sql: `
        INSERT OR IGNORE INTO poll_cursor (id, last_ledger, last_pagination_token, updated_at)
        VALUES (1, ?, ?, ?)
      `,
      args: [cursor.lastLedger, cursor.lastPagingToken, cursor.updatedAt],
    });
    return result.rowsAffected > 0;
  }
  const result = await db.execute({
    sql: `
      UPDATE poll_cursor
      SET last_ledger = ?, last_pagination_token = ?, updated_at = ?
      WHERE id = 1 AND last_ledger = ?
    `,
    args: [cursor.lastLedger, cursor.lastPagingToken, cursor.updatedAt, expectedLastLedger],
  });
  return result.rowsAffected > 0;
}
