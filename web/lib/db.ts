import { createClient, type Client } from '@libsql/client';

let client: Client | null = null;

export function getDb(): Client {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
  }
  return client;
}

export async function ensureSchema(): Promise<void> {
  const db = getDb();

  await db.batch([
    `CREATE TABLE IF NOT EXISTS trades (
      tx_hash TEXT NOT NULL,
      trader TEXT NOT NULL,
      event_type TEXT NOT NULL,
      size REAL NOT NULL DEFAULT 0,
      pnl REAL NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(tx_hash, event_type, trader)
    )`,
    `CREATE TABLE IF NOT EXISTS traders (
      address TEXT PRIMARY KEY,
      trade_count INTEGER NOT NULL DEFAULT 0,
      total_volume REAL NOT NULL DEFAULT 0,
      total_pnl REAL NOT NULL DEFAULT 0,
      last_updated INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    // Append-only set of every trader we have ever seen (open position or a
    // parsed event). The leaderboard scan seeds from this so a trader who
    // closed all positions — and whose `traders` row was therefore rebuilt
    // away — is still re-scanned next run instead of falling off the board.
    `CREATE TABLE IF NOT EXISTS known_traders (
      address TEXT PRIMARY KEY,
      first_seen INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
  ]);
}
