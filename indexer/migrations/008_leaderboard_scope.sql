-- Leaderboard legacy baseline scope key.
--
-- leaderboard_legacy is the one time import of the retired web pipeline's
-- board, and every row in it is testnet history. Scoped leaderboards fold
-- the baseline in only for scopes whose legacyScopeKey matches this column,
-- so a future mainnet board can never inherit testnet rows. Existing rows
-- and future imports default to 'testnet'.
ALTER TABLE leaderboard_legacy ADD COLUMN IF NOT EXISTS scope_key TEXT NOT NULL DEFAULT 'testnet';
