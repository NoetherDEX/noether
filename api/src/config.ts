import 'dotenv/config';
import type { Network } from '@noether/types';
import { getRpcUrls, resolvedManifest, type ContractsManifest } from '@noether/shared';

export interface ApiConfig {
  network: Network;
  host: string;
  port: number;
  logLevel: string;
  /** One origin, '*' (dev only), or a parsed comma-separated LIST. */
  corsOrigin: string | string[];
  rpcUrls: string[];
  rpcUrl: string;
  /** Public key whose account will be used as source for read-only simulations. */
  sourceAccount: string;
  /** Postgres URL for the indexer database (Supabase session pooler). */
  databaseUrl: string;
  contracts: ContractsManifest;
  ws: WsLimits;
  /**
   * Shared secret the keeper presents on POST /v1/oracle/heartbeat.
   * Optional: unset disables the heartbeat ingest (oracle health then
   * serves the on-chain-only view) — deliberately NOT a fail-closed boot
   * requirement.
   */
  keeperHeartbeatSecret?: string;
  /**
   * Cloudflare Turnstile server secret for POST /v1/waitlist. Optional:
   * unset makes the join endpoint 503 (fail loud, never silently
   * bot-open). Cloudflare's always-pass test secret works for dev.
   */
  turnstileSecret?: string;
  /**
   * Azure Communication Services connection string + verified sender for
   * the approval email. Optional: unset means approvals simply never
   * email (email_sent_at stays null; admin can resend later).
   */
  acsConnectionString?: string;
  acsSender?: string;
  /**
   * Wallets allowed into the /v1/admin/* surface (comma-separated env
   * ADMIN_WALLETS — the founders' PERSONAL wallets, never the contract
   * admin key). Empty = every admin route fails closed with 403.
   */
  adminWallets: string[];
}

/** WebSocket abuse controls (audit A-5). All overridable via env. */
export interface WsLimits {
  maxConnections: number;
  maxPerIp: number;
  pingIntervalMs: number;
  msgRate: number;
  maxBufferedBytes: number;
}

export const DEFAULT_HMAC_PEPPER = 'change-me-in-production';

export function loadConfig(): ApiConfig {
  // resolvedManifest, not loadContracts, so a CONTRACT_ override actually
  // repoints the service everywhere, not only in getContract.
  const contracts = resolvedManifest();
  const network = (process.env.NETWORK ?? 'testnet') as Network;
  const rpcUrls = getRpcUrls(network);
  const corsOriginRaw = process.env.API_CORS_ORIGIN ?? '*';
  if (process.env.NODE_ENV === 'production') {
    assertProductionEnv(corsOriginRaw);
  }
  // Comma-separated origins MUST become a list. Passed as one string,
  // @fastify/cors echoes the raw value verbatim into
  // Access-Control-Allow-Origin — and a comma-joined header is invalid
  // CORS, so browsers on every listed site rejected every direct gateway
  // response while the web's fallback paths quietly masked the breakage
  // (bit prod + staging from the 2026-07-15 cutover until 2026-07-17).
  const corsOrigin = corsOriginRaw.includes(',')
    ? corsOriginRaw
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : corsOriginRaw;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // No local-file fallback exists on Postgres. Tests inject their own db,
    // so this only fires for a real boot with missing env.
    throw new Error('DATABASE_URL is not set (postgresql://…). The libsql LIBSQL_URL/LIBSQL_AUTH_TOKEN pair was retired in the Supabase migration.');
  }
  return {
    network,
    host: process.env.API_HOST ?? '0.0.0.0',
    port: Number(process.env.API_PORT ?? 4000),
    logLevel: process.env.API_LOG_LEVEL ?? 'info',
    corsOrigin,
    rpcUrls,
    rpcUrl: rpcUrls[0]!,
    sourceAccount: process.env.API_SOURCE_ACCOUNT ?? contracts.admin,
    databaseUrl,
    keeperHeartbeatSecret: process.env.KEEPER_HEARTBEAT_SECRET || undefined,
    turnstileSecret: process.env.TURNSTILE_SECRET || undefined,
    acsConnectionString: process.env.ACS_CONNECTION_STRING || undefined,
    acsSender: process.env.ACS_SENDER || undefined,
    adminWallets: (process.env.ADMIN_WALLETS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length === 56 && s.startsWith('G')),
    contracts,
    ws: {
      maxConnections: Number(process.env.WS_MAX_CONNECTIONS ?? 1000),
      maxPerIp: Number(process.env.WS_MAX_PER_IP ?? 20),
      pingIntervalMs: Number(process.env.WS_PING_INTERVAL_MS ?? 30_000),
      msgRate: Number(process.env.WS_MSG_RATE ?? 20),
      maxBufferedBytes: Number(process.env.WS_MAX_BUFFERED_BYTES ?? 1_048_576),
    },
  };
}

/**
 * Fail-closed startup checks. The Docker runtime stage sets
 * NODE_ENV=production, so a deployed gateway refuses to boot with
 * default-permissive secrets; dev and tests keep booting with defaults.
 */
function assertProductionEnv(corsOrigin: string): void {
  const pepper = process.env.API_HMAC_PEPPER;
  if (!pepper || pepper === DEFAULT_HMAC_PEPPER) {
    throw new Error(
      'API_HMAC_PEPPER must be set to a non-default value in production (generate with: openssl rand -hex 32)',
    );
  }
  if (!process.env.API_KEY_ALLOWLIST?.trim()) {
    throw new Error(
      'API_KEY_ALLOWLIST must be set in production — leaving it unset opens API key issuance to anyone',
    );
  }
  if (corsOrigin === '*') {
    throw new Error('API_CORS_ORIGIN must not be the wildcard default in production');
  }
}
