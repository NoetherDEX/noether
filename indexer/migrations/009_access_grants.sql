-- 009: Workstream A — access system (waitlist + approvals + audit trail).
--
-- One row per wallet in access_grants: the single source of truth for who
-- may enter the gated app AND who passes the gateway's closed-beta check
-- (replaces the API_KEY_ALLOWLIST env var; a migration script seeds the
-- current env list as source='code_migration'). access_audit_log is the
-- append-only trail of every admin decision — the audit-themed launch keeps
-- its own audit trail.

CREATE TABLE IF NOT EXISTS access_grants (
  wallet        TEXT PRIMARY KEY,
  email         TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  source        TEXT NOT NULL
                CHECK (source IN ('waitlist', 'admin', 'code_migration')),
  wave          TEXT,
  segment       TEXT CHECK (segment IN ('trader', 'lp', 'both')),
  attested_at   TIMESTAMPTZ,
  tos_version   TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ,
  decided_by    TEXT,
  notes         TEXT,
  email_sent_at TIMESTAMPTZ
)

--# split

CREATE INDEX IF NOT EXISTS idx_access_grants_status
  ON access_grants (status, requested_at)

--# split

CREATE TABLE IF NOT EXISTS access_audit_log (
  id     BIGSERIAL PRIMARY KEY,
  at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor  TEXT NOT NULL,
  action TEXT NOT NULL,
  wallet TEXT,
  detail JSONB
)

--# split

CREATE INDEX IF NOT EXISTS idx_access_audit_log_at ON access_audit_log (at)

--# split

ALTER TABLE access_grants ENABLE ROW LEVEL SECURITY

--# split

ALTER TABLE access_audit_log ENABLE ROW LEVEL SECURITY
