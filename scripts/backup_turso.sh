#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# backup_turso.sh — dump the Turso/libsql database (D-8 / TASKS.md P3-6)
#
# The DB holds non-re-derivable state: api_keys (HMAC-hashed credentials
# that CANNOT be regenerated) and history beyond RPC retention. Losing it
# silently invalidates every issued API key. This produces a timestamped
# SQL dump; point cron at it (see docs/BACKUP_RESTORE.md) and ship the
# output to object storage.
#
# Usage:
#   TURSO_DB=noether-prod ./scripts/backup_turso.sh [out_dir]
#   # or a direct libsql/sqlite file:
#   LIBSQL_FILE=./data/indexer.db ./scripts/backup_turso.sh [out_dir]
#
# Env:
#   TURSO_DB      Turso database name (uses the `turso` CLI, must be logged in)
#   LIBSQL_FILE   path to a local libsql/sqlite file (uses sqlite3) — alt to TURSO_DB
#   BACKUP_S3_URI optional: `aws s3 cp` destination (e.g. s3://bucket/turso/)
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ -n "${TURSO_DB:-}" ]]; then
  command -v turso >/dev/null 2>&1 || { echo "turso CLI not found (brew install tursodatabase/tap/turso)" >&2; exit 1; }
  OUT="$OUT_DIR/${TURSO_DB}-${STAMP}.sql"
  echo "Dumping Turso db '$TURSO_DB' → $OUT"
  turso db shell "$TURSO_DB" ".dump" > "$OUT"
elif [[ -n "${LIBSQL_FILE:-}" ]]; then
  command -v sqlite3 >/dev/null 2>&1 || { echo "sqlite3 not found" >&2; exit 1; }
  [[ -f "$LIBSQL_FILE" ]] || { echo "no file at $LIBSQL_FILE" >&2; exit 1; }
  OUT="$OUT_DIR/libsql-${STAMP}.sql"
  echo "Dumping libsql file '$LIBSQL_FILE' → $OUT"
  sqlite3 "$LIBSQL_FILE" ".dump" > "$OUT"
else
  echo "Set TURSO_DB (Turso CLI) or LIBSQL_FILE (local file)." >&2
  exit 1
fi

# Sanity: a non-trivial dump contains the api_keys table.
if ! grep -q "api_keys" "$OUT"; then
  echo "WARNING: dump does not mention api_keys — verify it is complete." >&2
fi
SIZE=$(wc -c < "$OUT")
echo "Wrote $OUT (${SIZE} bytes)"

# Retain the last 30 dumps locally.
ls -1t "$OUT_DIR"/*.sql 2>/dev/null | tail -n +31 | xargs -r rm -f

if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  command -v aws >/dev/null 2>&1 || { echo "aws CLI not found for BACKUP_S3_URI upload" >&2; exit 1; }
  echo "Uploading → ${BACKUP_S3_URI}"
  aws s3 cp "$OUT" "$BACKUP_S3_URI"
fi

echo "Backup complete."
