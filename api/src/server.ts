import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Client } from '@libsql/client';
import type { ApiConfig } from './config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMarketsRoutes } from './routes/markets.js';
import { registerOracleRoutes } from './routes/oracle.js';
import { registerEventsRoutes } from './routes/events.js';
import { registerKeyRoutes } from './routes/keys.js';
import { registerAccountRoutes } from './routes/account.js';
import { registerOrderRoutes, type OrdersRouteDeps } from './routes/orders.js';
import { registerTxRoutes, type TxRoutesDeps } from './routes/tx.js';
import { registerVaultRoutes } from './routes/vaults.js';
import { registerReferralRoutes } from './routes/referral.js';
import { registerPositionsRoutes } from './routes/positions.js';
import { VaultsService } from './services/vaults.js';
import { ReferralReadService } from './services/referral.js';
import { ContractReader } from './services/contractReader.js';
import { OracleService } from './services/oracle.js';
import { MarketsService } from './services/markets.js';
import { EventsService } from './services/events.js';
import { ApiKeyStore } from './services/apiKeys.js';
import { WalletAuth } from './services/walletAuth.js';
import { RateLimiter } from './services/rateLimit.js';
import { WsBus } from './services/wsBus.js';
import { WsManager } from './services/wsManager.js';
import { OracleTicker } from './services/oracleTicker.js';
import { LiveTailer } from './services/liveTailer.js';
import { createIndexerDb } from './services/indexerDb.js';
import { getNetworkPassphrase } from '@noether/shared';
import { authPlugin } from './plugins/auth.js';
import { rateLimitPlugin } from './plugins/rateLimit.js';
import { wsPlugin } from './plugins/ws.js';

export interface ServerDeps {
  oracle: OracleService;
  markets: MarketsService;
  events: EventsService;
  apiKeys: ApiKeyStore;
  walletAuth: WalletAuth;
  rateLimiter: RateLimiter;
  db: Client;
  orders: OrdersRouteDeps;
  tx: TxRoutesDeps;
  wsBus: WsBus;
  wsManager: WsManager;
  oracleTicker: OracleTicker;
  liveTailer: LiveTailer;
  vaults: VaultsService;
  referral: ReferralReadService;
}

export async function buildServer(config: ApiConfig, depsOverride?: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  await app.register(cors, { origin: config.corsOrigin });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Noether API',
        description:
          'Public REST + WebSocket gateway for the Noether decentralized perpetual exchange on Stellar / Soroban.',
        version: '0.0.0-dev',
      },
      servers: [{ url: `http://${config.host}:${config.port}` }],
    },
  });

  await app.register(swaggerUi, { routePrefix: '/docs' });

  const deps = depsOverride ?? buildDefaultDeps(config, app.log as unknown as import('pino').Logger);

  await app.register(authPlugin, { apiKeys: deps.apiKeys });
  await app.register(rateLimitPlugin, { limiter: deps.rateLimiter });
  await app.register(wsPlugin, { manager: deps.wsManager, apiKeys: deps.apiKeys });

  await app.register(registerHealthRoutes);
  await app.register((instance) => registerMarketsRoutes(instance, deps.markets));
  await app.register((instance) => registerOracleRoutes(instance, deps.oracle));
  await app.register((instance) => registerEventsRoutes(instance, deps.events));
  await app.register((instance) => registerKeyRoutes(instance, deps.apiKeys, deps.walletAuth));
  await app.register((instance) => registerAccountRoutes(instance, deps.events, deps.db));
  await app.register((instance) => registerOrderRoutes(instance, deps.orders));
  await app.register((instance) => registerTxRoutes(instance, deps.tx));
  await app.register((instance) => registerVaultRoutes(instance, deps.vaults));
  await app.register((instance) => registerReferralRoutes(instance, deps.referral));
  await app.register((instance) => registerPositionsRoutes(instance, deps.db));

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
  const oracle = new OracleService(reader, config.contracts.contracts.mockOracle);
  const markets = new MarketsService(oracle);
  const db = createIndexerDb(config);
  const events = new EventsService(db);
  const pepper = process.env.API_HMAC_PEPPER ?? 'change-me-in-production';
  const apiKeys = new ApiKeyStore(db, pepper);
  const walletAuth = new WalletAuth(getNetworkPassphrase(config.network));
  const rateLimiter = new RateLimiter(db);
  const txCtx = { rpcUrl: config.rpcUrl, network: config.network };
  const orders: OrdersRouteDeps = { txCtx, marketContractId: config.contracts.contracts.market };
  const tx: TxRoutesDeps = { txCtx };
  const wsBus = new WsBus();
  wsBus.setMaxListeners(64);
  const wsManager = new WsManager(wsBus, log);
  const oracleTicker = new OracleTicker({ oracle, bus: wsBus, log });
  const liveTailer = new LiveTailer({ db, bus: wsBus, log });
  const vaults = new VaultsService(db);
  const referral = new ReferralReadService(db);
  return { oracle, markets, events, apiKeys, walletAuth, rateLimiter, db, orders, tx, wsBus, wsManager, oracleTicker, liveTailer, vaults, referral };
}
