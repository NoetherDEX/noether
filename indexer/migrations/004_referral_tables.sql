-- Phase 11.6: referral projection tables.

CREATE TABLE IF NOT EXISTS referrers (
  referrer                TEXT PRIMARY KEY,
  code                    TEXT NOT NULL UNIQUE,
  created_at              INTEGER NOT NULL,
  referred_count          INTEGER NOT NULL DEFAULT 0,
  total_volume_generated  INTEGER NOT NULL DEFAULT 0,
  total_earned            INTEGER NOT NULL DEFAULT 0,
  claimable               INTEGER NOT NULL DEFAULT 0,
  updated_at              INTEGER NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_referrers_code ON referrers (code);

--# split

CREATE TABLE IF NOT EXISTS referral_bindings (
  referee     TEXT PRIMARY KEY,
  referrer    TEXT NOT NULL,
  code        TEXT NOT NULL,
  bound_at    INTEGER NOT NULL,
  tx_hash     TEXT NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_referral_bindings_referrer ON referral_bindings (referrer);

--# split

CREATE TABLE IF NOT EXISTS referral_trades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  referee         TEXT NOT NULL,
  referrer        TEXT NOT NULL,
  original_fee    INTEGER NOT NULL,
  discount        INTEGER NOT NULL,
  payout          INTEGER NOT NULL,
  ledger          INTEGER NOT NULL,
  ts              INTEGER NOT NULL,
  tx_hash         TEXT NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_referral_trades_referrer ON referral_trades (referrer, ts DESC);

--# split

CREATE INDEX IF NOT EXISTS idx_referral_trades_referee ON referral_trades (referee, ts DESC);

--# split

CREATE TABLE IF NOT EXISTS referral_claims (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer    TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  ledger      INTEGER NOT NULL,
  ts          INTEGER NOT NULL,
  tx_hash     TEXT NOT NULL
);

--# split

CREATE INDEX IF NOT EXISTS idx_referral_claims_referrer ON referral_claims (referrer, ts DESC);
