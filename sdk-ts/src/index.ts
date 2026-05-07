/**
 * @noether/sdk — public surface.
 *
 * Stable starting point: the NoetherClient root + sub-clients for every
 * REST endpoint shipped through phase 5. WebSocket sub-client lands in
 * phase 8.
 */

export { NoetherClient, type NoetherClientOptions, type XdrSigner, type ExecuteTradeOptions, type ExecuteTradeResult } from './client.js';
export type { Credentials } from './transport.js';

// Sub-client types so consumers can write helper functions without
// reaching into nested paths.
export { type HealthStatus } from './sub/health.js';
export { type MarketSummary, type OracleSnapshot } from './sub/markets.js';
export { type RawEvent, type EventQuery } from './sub/events.js';
export {
  type IssuedChallenge,
  type IssuedApiKey,
  type ApiKeyRecord,
  type ChallengeSigner,
} from './sub/keys.js';
export { type AccountIdentity } from './sub/account.js';
export {
  type PrepareRequest,
  type OpenPositionRequest,
  type ClosePositionRequest,
  type PlaceLimitOrderRequest,
  type CancelOrderRequest,
  type PreparedTransaction,
} from './sub/orders.js';
export { type SubmitRequest, type SubmittedTx } from './sub/tx.js';
export { WsClient, type WsClientOptions, type ChannelHandler } from './sub/ws.js';

export {
  NoetherError,
  ApiError,
  AuthError,
  BadRequestError,
  NotFoundError,
  RateLimitError,
  ServerError,
  NetworkError,
} from './errors.js';

export * from '@noether/types';
