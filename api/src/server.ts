import { readFileSync } from 'node:fs';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Db } from '@noether/db';
import { DEFAULT_HMAC_PEPPER, type ApiConfig } from './config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMarketsRoutes } from './routes/markets.js';
import { registerOracleRoutes } from './routes/oracle.js';
import { registerOracleHealthRoutes } from './routes/oracleHealth.js';
import { registerEventsRoutes } from './routes/events.js';
import { registerKeyRoutes } from './routes/keys.js';
import { registerAccessRoutes } from './routes/access.js';
import { registerAccountRoutes } from './routes/account.js';
import { registerOrderRoutes, type OrdersRouteDeps } from './routes/orders.js';
import { registerTxRoutes, type TxRoutesDeps } from './routes/tx.js';
import { registerVaultRoutes } from './routes/vaults.js';
import { registerReferralRoutes } from './routes/referral.js';
import { registerPositionsRoutes } from './routes/positions.js';
import { registerVolumeRoutes } from './routes/volume.js';
import { registerAdlRoutes } from './routes/adl.js';
import { registerTradesRoutes } from './routes/trades.js';
import { registerCandlesRoutes } from './routes/candles.js';
import { registerLeaderboardRoutes } from './routes/leaderboard.js';
import { VaultsService } from './services/vaults.js';
import { ReferralReadService } from './services/referral.js';
import { ContractReader } from './services/contractReader.js';
import { PauseStateService } from './services/pauseState.js';
import { OracleService } from './services/oracle.js';
import { MarketsService } from './services/markets.js';
import { EventsService } from './services/events.js';
import { ApiKeyStore } from './services/apiKeys.js';
import { WalletAuth } from './services/walletAuth.js';
import { AccessGrantsService } from './services/accessGrants.js';
import { CloudflareTurnstile, DisabledTurnstile, type TurnstileVerifier } from './services/turnstile.js';
import { AcsEmailer, NoopEmailer, type ApprovalEmailer } from './services/accessEmail.js';
import { RateLimiter } from './services/rateLimit.js';
import { WsBus } from './services/wsBus.js';
import { WsManager } from './services/wsManager.js';
import { OracleTicker } from './services/oracleTicker.js';
import { LiveTailer } from './services/liveTailer.js';
import { StatsService } from './services/stats.js';
import { AdlQueueService } from './services/adlQueue.js';
import { ShortfallService } from './services/shortfall.js';
import { createIndexerDb } from './services/indexerDb.js';
import { getNetworkPassphrase } from '@noether/shared';
import { authPlugin } from './plugins/auth.js';
import { rateLimitPlugin } from './plugins/rateLimit.js';
import { wsPlugin } from './plugins/ws.js';
import { geoBlockPlugin } from './plugins/geoBlock.js';

export interface ServerDeps {
  oracle: OracleService;
  markets: MarketsService;
  events: EventsService;
  apiKeys: ApiKeyStore;
  walletAuth: WalletAuth;
  access: AccessGrantsService;
  /** Dedicated instance — WalletAuth's pending map is keyed by address, so
   *  the unlock flow must not share the key-issuance instance. */
  accessWalletAuth: WalletAuth;
  turnstile: TurnstileVerifier;
  approvalEmailer: ApprovalEmailer;
  rateLimiter: RateLimiter;
  db: Db;
  orders: OrdersRouteDeps;
  tx: TxRoutesDeps;
  wsBus: WsBus;
  wsManager: WsManager;
  oracleTicker: OracleTicker;
  liveTailer: LiveTailer;
  vaults: VaultsService;
  referral: ReferralReadService;
  stats: StatsService;
  adlQueue: AdlQueueService;
  shortfall: ShortfallService;
  /** L0-15 pause-state probe for /v1/health — optional in test setups. */
  pauseState?: PauseStateService;
  /** Chain reader for the /v1/health open-count drift alarm (Phase 4) —
   *  optional in test setups. */
  reader?: ContractReader;
}

const PKG = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version?: string };

export async function buildServer(config: ApiConfig, depsOverride?: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: 1,
    requestIdHeader: 'x-request-id',
  });

  /**
   * Fastify's default handler serialises `err.message` straight into the 500
   * body. An unhandled Postgres error therefore hands the caller our schema,
   * DB username, host and Supabase project ref — and because any route can
   * induce one, that is a free schema-fingerprinting primitive.
   *
   * Deliberate 4xx responses keep their message: those strings are ours and
   * are what makes the API usable. Everything 5xx is logged in full server
   * side and reduced to an opaque body carrying only the request id, so a
   * report can still be traced back to its log line.
   */
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status < 500) {
      return reply.code(status).send({
        error: err.code ?? 'bad_request',
        message: err.message,
        ...(err.validation ? { validation: err.validation } : {}),
      });
    }
    request.log.error({ err, reqId: request.id }, 'unhandled error');
    return reply.code(500).send({
      error: 'internal_error',
      message: 'The request could not be completed.',
      requestId: request.id,
    });
  });

  await app.register(cors, { origin: config.corsOrigin });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Noether API',
        description:
          'Public REST + WebSocket gateway for the Noether decentralized perpetual exchange on Stellar / Soroban.',
        version: PKG.version ?? '0.0.0',
      },
      servers: [{ url: process.env.API_PUBLIC_URL ?? `http://localhost:${config.port}` }],
    },
  });

  await app.register(swaggerUi, { routePrefix: '/docs' });

  const deps = depsOverride ?? buildDefaultDeps(config, app.log as unknown as import('pino').Logger);

  await app.register(geoBlockPlugin, {
    enabled: process.env.API_GEOBLOCK === '1',
    countryHeader: process.env.GEO_COUNTRY_HEADER ?? 'cf-ipcountry',
    regionHeader: process.env.GEO_REGION_HEADER ?? 'cf-region-code',
  });
  await app.register(authPlugin, { apiKeys: deps.apiKeys });
  await app.register(rateLimitPlugin, { limiter: deps.rateLimiter, apiKeys: deps.apiKeys });
  await app.register(wsPlugin, { manager: deps.wsManager, apiKeys: deps.apiKeys });

  await app.register((instance) =>
    registerHealthRoutes(instance, {
      db: deps.db,
      contracts: config.contracts,
      pauseState: deps.pauseState,
      openCounts: deps.reader
        ? () => deps.reader!.readOpenCounts(config.contracts.contracts.market ?? '')
        : undefined,
      marketId: config.contracts.contracts.market,
    }),
  );
  await app.register((instance) => registerMarketsRoutes(instance, deps.markets, deps.stats));
  await app.register((instance) => registerOracleRoutes(instance, deps.oracle));
  await app.register((instance) =>
    registerOracleHealthRoutes(instance, {
      oracle: deps.oracle,
      heartbeatSecret: config.keeperHeartbeatSecret,
    }),
  );
  await app.register((instance) => registerEventsRoutes(instance, deps.events));
  await app.register((instance) =>
    registerKeyRoutes(instance, deps.apiKeys, deps.walletAuth, deps.access, config.adminWallets),
  );
  await app.register((instance) =>
    registerAccessRoutes(instance, {
      access: deps.access,
      walletAuth: deps.accessWalletAuth,
      turnstile: deps.turnstile,
      emailer: deps.approvalEmailer,
      adminWallets: config.adminWallets,
    }),
  );
  await app.register((instance) => registerAccountRoutes(instance, deps.db));
  await app.register((instance) => registerOrderRoutes(instance, deps.orders, deps.stats));
  await app.register((instance) => registerTxRoutes(instance, deps.tx));
  await app.register((instance) => registerVaultRoutes(instance, deps.vaults));
  await app.register((instance) => registerReferralRoutes(instance, deps.referral));
  await app.register((instance) => registerPositionsRoutes(instance, deps.db, deps.adlQueue));
  await app.register((instance) => registerVolumeRoutes(instance, deps.stats));
  await app.register((instance) => registerAdlRoutes(instance, deps.adlQueue, deps.shortfall));
  await app.register((instance) => registerTradesRoutes(instance, deps.stats));
  await app.register((instance) => registerCandlesRoutes(instance, deps.stats));
  await app.register((instance) => registerLeaderboardRoutes(instance, deps.stats));

  deps.wsManager.attachBus();
  app.addHook('onReady', async () => {
    deps.oracleTicker.start();
    deps.liveTailer.start();
  });
  app.addHook('onClose', async () => {
    deps.oracleTicker.stop();
    deps.liveTailer.stop();
    deps.wsManager.detachBus();
  });

  return app;
}

function buildDefaultDeps(config: ApiConfig, log: import('pino').Logger): ServerDeps {
  const reader = new ContractReader({
    rpcUrl: config.rpcUrl,
    network: config.network,
    sourceAccount: config.sourceAccount,
  });
  const oracle = new OracleService(reader, config.contracts.contracts.noeracleShim);
  const markets = new MarketsService(oracle);
  const db = createIndexerDb(config);
  const events = new EventsService(db);
  const pepper = process.env.API_HMAC_PEPPER ?? DEFAULT_HMAC_PEPPER;
  const apiKeys = new ApiKeyStore(db, pepper);
  const walletAuth = new WalletAuth(getNetworkPassphrase(config.network));
  const access = new AccessGrantsService(db);
  const accessWalletAuth = new WalletAuth(getNetworkPassphrase(config.network));
  const turnstile: TurnstileVerifier = config.turnstileSecret
    ? new CloudflareTurnstile(config.turnstileSecret)
    : new DisabledTurnstile();
  const approvalEmailer: ApprovalEmailer =
    config.acsConnectionString && config.acsSender
      ? new AcsEmailer(config.acsConnectionString, config.acsSender, log)
      : new NoopEmailer(log);
  const rateLimiter = new RateLimiter(db);
  const txCtx = { rpcUrl: config.rpcUrl, network: config.network };
  const orders: OrdersRouteDeps = { txCtx, marketContractId: config.contracts.contracts.market };
  const tx: TxRoutesDeps = { txCtx };
  const wsBus = new WsBus();
  wsBus.setMaxListeners(64);
  const wsManager = new WsManager(wsBus, log, config.ws);
  const oracleTicker = new OracleTicker({ oracle, bus: wsBus, log });
  const liveTailer = new LiveTailer({ db, bus: wsBus, log });
  const vaults = new VaultsService(db, {
    reader,
    vaultFactoryId: config.contracts.contracts.vaultFactory ?? '',
  });
  const pauseState = new PauseStateService(reader, config.contracts.contracts.market ?? '');
  const referral = new ReferralReadService(db);
  // Scope leaderboard scans to the live market so retired deployments
  // never leak into the totals (resolves via CONTRACT_MARKET override).
  // The network feeds the deployment scope gate: a leaderboard request for
  // another network's scope is answered not_indexed_here, never with this
  // network's rows.
  const stats = new StatsService(db, config.contracts.contracts.market, config.network);
  // L0-1/L0-3 (Batch-1 surfaces, fail-soft against today's chain).
  const adlQueue = new AdlQueueService({
    db,
    oracle,
    marketContractId: config.contracts.contracts.market,
    rpcUrl: config.rpcUrl,
  });
  const shortfall = new ShortfallService(reader, config.contracts.contracts.vault);
  return { oracle, markets, events, apiKeys, walletAuth, access, accessWalletAuth, turnstile, approvalEmailer, rateLimiter, db, orders, tx, wsBus, wsManager, oracleTicker, liveTailer, vaults, referral, stats, adlQueue, shortfall, pauseState, reader };
}
