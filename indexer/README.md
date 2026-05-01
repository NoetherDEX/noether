# @noether/indexer

Soroban event indexer for the Noether protocol.

## Status

**Phase 1** — skeleton: config, db, migration framework. No polling yet.

## Responsibilities (final form)

- Poll Soroban RPC `getEvents` for our contracts (`market`, `vault_factory`, `referral`).
- Decode events from ScVal to typed objects.
- Persist to libsql (trades, positions, orders, candles, etc.).
- Emit to an in-process event bus consumed by the API gateway and WebSocket server.

## Layout

```
indexer/
├── src/
│   ├── index.ts          # entry, lifecycle
│   ├── config.ts         # env loading
│   ├── db.ts             # libsql client factory
│   ├── migrations.ts     # SQL migration runner
│   └── ... (Phase 2 adds: poller, decoder/, handlers/, bus.ts)
└── migrations/
    └── 001_core_tables.sql
```

## Development

```bash
# Install (from repo root)
npm install

# Apply pending migrations
npm run migrate -w @noether/indexer

# Type check
npm run typecheck -w @noether/indexer

# Build
npm run build -w @noether/indexer

# Run (Phase 1 stub: starts, applies migrations, idles 60s, exits)
npm run dev -w @noether/indexer
```

## Migration Conventions

- Filenames: `NNN_short_description.sql` (zero-padded numeric prefix).
- Multi-statement migrations split on the marker line `--# split` so each
  statement runs through libsql separately.
- Once applied to any deployed environment, never edit a migration file —
  add a new one. Migrations are recorded in `schema_versions`.
