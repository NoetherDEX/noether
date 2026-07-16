# Postgres (Supabase) backup & restore (D-8 / P3-6)

> Migrated from Turso/libsql in 2026-07. `scripts/backup_turso.sh` stays only
> until the frozen Turso databases are deleted (they are the rollback
> substrate for the migration; see `scripts/migrate-turso-to-supabase/`).

The Postgres database is the one piece of **non-re-derivable** protocol
state. Everything else can be rebuilt from chain (`npm -w @noether/indexer run
reindex` replays `events_raw` into the projections), but three things cannot:

- **`api_keys`** — HMAC-hashed API-key credentials. There is no way to
  regenerate a lost key hash; losing this table invalidates every issued key.
- **history beyond RPC retention** — `events_raw` rows for ledgers the public
  RPC no longer serves.
- **`leaderboard_legacy`** — the one-time pre-2026-07 baseline imported from
  the retired web pipeline; its source DB will eventually be deleted.

## Backup

`scripts/backup_postgres.sh` runs `pg_dump` to a timestamped `.sql.gz` and
(optionally) ships it to object storage.

```bash
# Supabase (production) — session-pooler URL from the dashboard
DATABASE_URL='postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require' \
  BACKUP_S3_URI=s3://noether-backups/pg/ ./scripts/backup_postgres.sh

# Local dev
DATABASE_URL='postgresql://postgres:dev@localhost:5432/postgres' ./scripts/backup_postgres.sh
```

### Schedule (operator)

The Supabase **Free tier has NO managed backups** — a dump schedule is
mandatory there. Two options, pick one:

1. **Upgrade the org to Pro** (preferred, zero-ops): daily managed backups,
   PITR available as an add-on. Nothing to schedule.
2. **Nightly dump cron**: run `backup_postgres.sh` from a scheduled job
   (GitHub Actions `schedule:`, a Railway cron service, or a crontab) with
   `DATABASE_URL` + `BACKUP_S3_URI` set. Daily is the floor; hourly if key
   issuance is active.

## Restore

1. Fetch the dump you want (latest good one from object storage / local).
2. Create a fresh database (new Supabase project, or `CREATE DATABASE` on an
   existing instance).
3. Load the dump:
   ```bash
   gunzip -c noether-pg-<STAMP>.sql.gz | psql "$RESTORE_DATABASE_URL"
   ```
4. Repoint the services at the restored DB — set `DATABASE_URL` on the Railway
   **api** and **indexer** services. Restart them so the pools reconnect.
5. Verify:
   - `curl $NOETHER_API_URL/v1/health | jq .indexer` — the cursor should be
     present; the indexer resumes polling forward from the restored cursor.
   - Issue + use a test API key end-to-end (`e2e/` harness) to confirm
     `api_keys` restored cleanly.
6. If the restored cursor is behind live, the indexer catches up (RPC
   retention permitting — a `ledger_gaps` row records anything lost); if it is
   *ahead* of what the dump captured (unlikely), run `reindex` to rebuild the
   projections from `events_raw`.

## Hardening plan

- **Split `api_keys` into its own database/schema.** Today it shares the
  projection DB, so a reindex/wipe of projections risks the credential table.
  A dedicated schema (or second Supabase project) isolates the irreplaceable
  data from the re-derivable projections. Tracked under P3-6.
- Test the restore path quarterly against a scratch DB — an untested backup is
  not a backup.
