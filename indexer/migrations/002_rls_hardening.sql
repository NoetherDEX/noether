-- Supabase Data-API hardening (2026-07).
--
-- Supabase exposes the `public` schema over PostgREST to anyone holding the
-- project's publishable/anon key. Every table here is service-only: the
-- api/indexer connect directly as the table OWNER (postgres), which bypasses
-- row-level security, so enabling RLS with NO policies blocks REST access
-- completely without affecting the services. api_keys (HMAC-hashed key
-- credentials) is the table this protects most.
--
-- The revoke block runs only where the Supabase roles exist, so this
-- migration stays a no-op on plain Postgres / PGlite test runs.

ALTER TABLE poll_cursor ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE events_raw ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE candles ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE vaults ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE vault_snapshots ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE vault_deposits ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE vault_withdraws ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE vault_fee_claims ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE vault_trades ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE referrers ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE referral_bindings ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE referral_trades ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE referral_claims ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE dead_letter ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE ledger_gaps ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE leaderboard_legacy ENABLE ROW LEVEL SECURITY;

--# split

ALTER TABLE schema_versions ENABLE ROW LEVEL SECURITY;

--# split

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
  END IF;
END $$;
