#!/usr/bin/env bash
# Dump the Supabase Postgres DB (indexer/API projections + api_keys) to a
# timestamped gzip file, optionally uploading to S3. Successor to
# scripts/backup_turso.sh after the 2026-07 Supabase migration.
#
# Usage:
#   DATABASE_URL='postgresql://…pooler.supabase.com:5432/postgres?sslmode=require' \
#     ./scripts/backup_postgres.sh [output-dir]
#
# Optional: BACKUP_S3_URI='s3://bucket/prefix' to also upload (needs aws cli).
#
# Free-tier Supabase has NO managed backups — run this on a schedule (or
# upgrade to Pro for daily backups + PITR).

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set (Supabase session-pooler URL)." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found — install postgresql client tools (brew install libpq && brew link --force libpq)." >&2
  exit 1
fi

OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUT_DIR/noether-pg-$STAMP.sql.gz"

echo "Dumping to $OUT_FILE …"
pg_dump --no-owner --no-privileges --dbname="$DATABASE_URL" | gzip > "$OUT_FILE"
echo "Done: $(du -h "$OUT_FILE" | cut -f1)"

if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  echo "Uploading to $BACKUP_S3_URI …"
  aws s3 cp "$OUT_FILE" "$BACKUP_S3_URI/$(basename "$OUT_FILE")"
  echo "Uploaded."
fi
