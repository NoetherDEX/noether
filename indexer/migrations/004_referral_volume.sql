-- L1-18: trade_recorded gains a 6th field (referred trade's 7-dec notional).
-- NULL on rows projected from pre-Batch-1 (5-field) events.
ALTER TABLE referral_trades ADD COLUMN IF NOT EXISTS volume TEXT;
