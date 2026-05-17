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
 * Upsert the cursor singleton.
 */
export async function writeCursor(db: Client, cursor: PollCursor): Promise<void> {
  await db.execute({
    sql: `
      INSERT INTO poll_cursor (id, last_ledger, last_pagination_token, updated_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_ledger = excluded.last_ledger,
        last_pagination_token = excluded.last_pagination_token,
        updated_at = excluded.updated_at
    `,
    args: [cursor.lastLedger, cursor.lastPagingToken, cursor.updatedAt],
  });
}
