import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createPgliteDb } from '@noether/db/pglite';
import { runMigrations } from '../src/migrations.js';

describe('migration runner', () => {
  it('applies all pending migrations and is idempotent', async () => {
    const db = createPgliteDb(new PGlite());
    const first = await runMigrations(db);
    expect(first.applied.length).toBeGreaterThan(0);

    const tables = await db.execute(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const names = tables.rows.map((r) => String(r.name));
    expect(names).toContain('events_raw');
    expect(names).toContain('poll_cursor');
    expect(names).toContain('schema_versions');
    expect(names).toContain('trades');
    expect(names).toContain('dead_letter');

    const second = await runMigrations(db);
    expect(second.applied).toHaveLength(0);

    await db.close();
  });
});
