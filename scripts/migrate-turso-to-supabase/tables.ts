/**
 * Copy manifest: every table carried from the old indexer/API Turso DB into
 * the Supabase baseline (indexer/migrations/001_baseline.sql).
 *
 * `key` drives keyset pagination on the SOURCE (must be a unique, orderable
 * column set there). `identity` marks tables whose BIGINT id sequence must be
 * bumped with setval() after inserting original ids.
 *
 * Deliberately skipped: rate_limit_buckets (ephemeral counters),
 * schema_versions (the pg runner owns its own), positions_cache /
 * orders_cache (dead tables, dropped from the baseline).
 *
 * The old prod DB may predate migrations 012–017 (the Railway indexer froze
 * on 2026-06-08), so copy.ts intersects these column lists with what the
 * source actually has and fills the rest with NULL.
 */

export interface TableSpec {
  name: string;
  columns: string[];
  key: string[];
  identity?: boolean;
}

export const TABLES: TableSpec[] = [
  {
    name: 'events_raw',
    columns: [
      'event_id', 'contract_id', 'topic', 'ledger', 'ledger_close_ts',
      'tx_hash', 'payload_json', 'inserted_at', 'topic_xdr', 'value_xdr',
    ],
    key: ['event_id'],
  },
  {
    name: 'api_keys',
    columns: ['key_id', 'secret_hash', 'owner', 'tier', 'label', 'created_at', 'last_used_at', 'revoked_at'],
    key: ['key_id'],
  },
  {
    name: 'candles',
    columns: ['asset', 'interval', 'bucket_ts', 'open', 'high', 'low', 'close', 'volume'],
    key: ['asset', 'interval', 'bucket_ts'],
  },
  {
    name: 'positions',
    columns: ['position_id', 'trader', 'asset', 'direction', 'size', 'entry_price', 'opened_at', 'opened_tx_hash', 'contract_id'],
    key: ['position_id'],
  },
  {
    name: 'trades',
    columns: [
      'id', 'event_id', 'position_id', 'trader', 'asset', 'direction', 'kind',
      'size', 'entry_price', 'close_price', 'pnl', 'ledger', 'ts', 'tx_hash', 'contract_id',
    ],
    key: ['id'],
    identity: true,
  },
  {
    name: 'vaults',
    columns: [
      'id', 'leader', 'name', 'created_at', 'total_usdc', 'circulating_shares',
      'hwm_nav', 'realized_pnl', 'leader_shares', 'profit_share_bps', 'paused', 'updated_at', 'contract_id',
    ],
    key: ['id'],
  },
  {
    name: 'vault_snapshots',
    columns: ['vault_id', 'ts', 'tvl', 'nav', 'open_positions', 'hwm'],
    key: ['vault_id', 'ts'],
  },
  {
    name: 'vault_deposits',
    columns: ['id', 'vault_id', 'depositor', 'amount', 'shares', 'ledger', 'ts', 'tx_hash', 'event_id', 'contract_id'],
    key: ['id'],
    identity: true,
  },
  {
    name: 'vault_withdraws',
    columns: ['id', 'vault_id', 'depositor', 'shares', 'usdc_out', 'ledger', 'ts', 'tx_hash', 'event_id', 'contract_id'],
    key: ['id'],
    identity: true,
  },
  {
    name: 'vault_fee_claims',
    columns: ['id', 'vault_id', 'leader', 'amount', 'new_nav', 'ledger', 'ts', 'tx_hash', 'event_id', 'contract_id'],
    key: ['id'],
    identity: true,
  },
  {
    name: 'vault_trades',
    columns: ['id', 'vault_id', 'position_id', 'action', 'leader', 'collateral', 'ledger', 'ts', 'tx_hash', 'pnl', 'contract_id'],
    key: ['id'],
    identity: true,
  },
  {
    name: 'referrers',
    columns: [
      'referrer', 'code', 'created_at', 'referred_count', 'total_volume_generated',
      'total_earned', 'claimable', 'updated_at', 'contract_id',
    ],
    key: ['referrer'],
  },
  {
    name: 'referral_bindings',
    columns: ['referee', 'referrer', 'code', 'bound_at', 'tx_hash', 'contract_id'],
    key: ['referee'],
  },
  {
    name: 'referral_trades',
    columns: ['id', 'referee', 'referrer', 'original_fee', 'discount', 'payout', 'ledger', 'ts', 'tx_hash', 'event_id', 'contract_id'],
    key: ['id'],
    identity: true,
  },
  {
    name: 'referral_claims',
    columns: ['id', 'referrer', 'amount', 'ledger', 'ts', 'tx_hash', 'event_id', 'contract_id'],
    key: ['id'],
    identity: true,
  },
  {
    name: 'dead_letter',
    columns: ['id', 'event_id', 'contract_id', 'ledger', 'stage', 'error', 'payload_json', 'created_at'],
    key: ['id'],
    identity: true,
  },
  {
    name: 'ledger_gaps',
    columns: ['id', 'from_ledger', 'to_ledger', 'reason', 'recorded_at'],
    key: ['id'],
    identity: true,
  },
];
