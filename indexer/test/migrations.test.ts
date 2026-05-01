import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { runMigrations } from '../src/migrations.js';

describe('migration runner', () => {
  it('applies all pending migrations and is idempotent', async () => {
    const db = createClient({ url: ':memory:' });
    const first = await runMigrations(db);
    expect(first.applied.length).toBeGreaterThan(0);

    const tables = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = tables.rows.map((r) => String(r.name));
    expect(names).toContain('events_raw');
    expect(names).toContain('poll_cursor');
    expect(names).toContain('schema_versions');
    expect(names).toContain('trades');

    const second = await runMigrations(db);
    expect(second.applied).toHaveLength(0);

    db.close();
  });
});
