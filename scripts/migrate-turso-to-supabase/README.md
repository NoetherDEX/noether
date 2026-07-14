# Turso → Supabase data migration

One-shot tooling for the 2026-07 move of the indexer/API database from Turso
(libsql) to Supabase (Postgres), plus the legacy web-leaderboard import.
Standalone package on purpose — the retired `@libsql/client` lives only here.

## Env

| Var | What | Where to find it |
|---|---|---|
| `TURSO_LIBSQL_URL` / `TURSO_LIBSQL_AUTH_TOKEN` | OLD indexer/API DB (read-only use) | Railway → api/indexer service → `LIBSQL_URL` / `LIBSQL_AUTH_TOKEN` |
| `TURSO_WEB_DATABASE_URL` / `TURSO_WEB_AUTH_TOKEN` | OLD web leaderboard DB | Vercel → noether project → `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` |
| `DATABASE_URL` | NEW Supabase Postgres | Supabase → Connect → **Session pooler** URL (`…pooler.supabase.com:5432/postgres?sslmode=require`). Never the direct `db.<ref>…` host (IPv6-only). |

## Order of operations (mirrors the cutover runbook)

Concrete constants (computed 2026-07-14):
- Prod stack deployed **2026-07-06 14:00:02Z** (`contracts.production.json` says
  `17:00:00` but the deploy script stamps LOCAL Istanbul time, UTC+3).
- Deploy ledger ≈ **3,466,193**; rewind target **3466000** (a few minutes
  earlier — harmless, ledgers below RPC retention are recorded as a gap).
- Supabase project: `uvycmqasgtuvttygdufy`, region `eu-central-1` (schema +
  RLS hardening already applied via MCP, 2026-07-14).

```bash
cd scripts/migrate-turso-to-supabase && npm install

# 0. Schema first (from repo root) — already applied to the prod project via
#    the Supabase MCP on 2026-07-14; run anyway, it no-ops when up to date:
DATABASE_URL=… npm -w @noether/indexer run migrate

# 1. Stop the Railway indexer (Mert). Old api keeps serving Turso reads.

# 2. Copy everything (idempotent, resumable; --table=<name> to redo one):
npm run copy

# 3. Get the RPC's oldest retained ledger AT CUTOVER TIME — it advances
#    ~17k ledgers/day, and it is where the chain backfill will start:
curl -s -X POST https://soroban-testnet.stellar.org \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
#    → note result.oldestLedgerCloseTime (e.g. 1783374762 on 2026-07-14)

# 4. Import the legacy leaderboard baseline UP TO that moment — everything
#    after it is re-derived exactly from chain, so nothing is lost or
#    double-counted at the seam:
npm run legacy -- --cutover=<oldestLedgerCloseTime>

# 5. Gate: parity report must print PARITY OK:
npm run parity

# 6. Rewind the cursor to just before the true deploy ledger; the poller
#    records ledgers below RPC retention in `ledger_gaps` (audit trail) and
#    starts fetching at the oldest retained ledger:
npm run rewind-cursor -- --ledger=3466000

# 7. Swap Railway env (DATABASE_URL in, LIBSQL_* out), deploy indexer →
#    watch /healthz + ledger_gaps, then deploy api → check /v1/health.
```

Notes:
- **DATABASE_URL must carry `?uselibpqcompat=true&sslmode=require`** —
  node-postgres otherwise enforces full CA verification and rejects the
  Supabase pooler chain ("self-signed certificate in certificate chain").
  Same string goes to Railway. CA pinning is the mainnet upgrade.
- Every insert is `ON CONFLICT DO NOTHING`; reruns are safe.
- The old prod DB may predate migrations 012–017 (its indexer froze
  2026-06-08) — missing tables/columns are skipped/NULLed with a log line.
- `parity` intentionally marks `poll_cursor` as NOTE (the rewind changes it).
- Turso stays untouched — it is the rollback substrate. Keep it ≥2 weeks.
- The web-DB hourly histogram shows launch-day activity was ~3 rows, so the
  pre-retention hole is a non-issue; a targeted Horizon top-up remains the
  fallback if a specific wallet reports missing history.
