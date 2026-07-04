# Turso backup & restore (D-8 / P3-6)

The libsql/Turso database is the one piece of **non-re-derivable** protocol
state. Everything else can be rebuilt from chain (`npm -w @noether/indexer run
reindex` replays `events_raw` into the projections), but two things cannot:

- **`api_keys`** — HMAC-hashed API-key credentials. There is no way to
  regenerate a lost key hash; losing this table invalidates every issued key.
- **history beyond RPC retention** — `events_raw` rows for ledgers the public
  RPC no longer serves.

## Backup

`scripts/backup_turso.sh` dumps the DB to a timestamped `.sql` and (optionally)
ships it to object storage. It keeps the last 30 local dumps and warns if the
dump doesn't contain `api_keys`.

```bash
# Turso (production) — requires `turso auth login`
TURSO_DB=noether-prod BACKUP_S3_URI=s3://noether-backups/turso/ ./scripts/backup_turso.sh

# Local dev file
LIBSQL_FILE=./data/indexer.db ./scripts/backup_turso.sh
```

### Schedule (operator)

Two options, pick one:

1. **Turso PITR** (preferred, zero-ops): Turso's paid tiers offer point-in-time
   restore. Enable it on the production DB — nothing to schedule.
2. **Nightly dump cron**: run `backup_turso.sh` from a scheduled job (GitHub
   Actions `schedule:`, a Railway cron service, or the machine's crontab) with
   `TURSO_DB` + `BACKUP_S3_URI` set. Daily is the floor; hourly if key issuance
   is active.

## Restore

1. Fetch the dump you want (latest good one from object storage / local).
2. Create a fresh Turso DB (or clear the target):
   ```bash
   turso db create noether-restore
   ```
3. Load the dump:
   ```bash
   turso db shell noether-restore < noether-prod-<STAMP>.sql
   ```
4. Repoint the services at the restored DB — set `LIBSQL_URL` (+
   `LIBSQL_AUTH_TOKEN`) on the Railway **api** and **indexer** services, and on
   the Vercel leaderboard cron. Redeploy is not needed for env-only changes on
   Railway, but restart the services so they reconnect.
5. Verify:
   - `curl $NOETHER_API_URL/v1/health | jq .indexer` — the cursor should be
     present; it will resume polling forward from the restored cursor.
   - Issue + use a test API key end-to-end (`e2e/` harness) to confirm
     `api_keys` restored cleanly.
6. If the restored cursor is behind live, the indexer catches up; if it is
   *ahead* of what the dump captured (unlikely), run `reindex` to rebuild the
   projections from `events_raw`.

## Hardening plan

- **Split `api_keys` into its own DB.** Today it shares the projection DB, so a
  reindex/wipe of projections risks the credential table. A dedicated
  `noether-keys` DB (separate `LIBSQL_URL` for the api-keys store) isolates the
  irreplaceable data from the re-derivable projections. Tracked under P3-6.
- Test the restore path quarterly against a scratch DB — an untested backup is
  not a backup.
