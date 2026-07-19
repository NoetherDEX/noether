/**
 * noether-sdk — public surface.
 *
 * The NoetherClient root + sub-clients for every REST endpoint on the
 * gateway, plus the WsClient WebSocket sub-client at `client.ws()`.
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
  type BetaStatus,
  type ChallengeSigner,
} from './sub/keys.js';
export { type AccountIdentity } from './sub/account.js';
export {
  type PrepareRequest,
  type OpenPositionRequest,
  type ClosePositionRequest,
  type PlaceLimitOrderRequest,
  type PlaceStopLimitOrderRequest,
  type PlaceTrailingStopRequest,
  type SetStopLossRequest,
  type SetTakeProfitRequest,
  type SetStopOrTakeProfitRequest,
  type CancelOrderRequest,
  type PreparedTransaction,
} from './sub/orders.js';
export { type SubmitRequest, type SubmittedTx } from './sub/tx.js';
export { type OpenPositionRow, type OpenPositionsQuery } from './sub/positions.js';
export {
  type VaultRow,
  type VaultActivityRow,
  type VaultTradeRow,
  type VaultListQuery,
  type VaultActivityQuery,
} from './sub/vaults.js';
export {
  type ReferrerRow,
  type ReferralBindingRow,
  type ReferralTradeRow,
  type ReferralClaimRow,
  type ReferralMeResponse,
} from './sub/referral.js';
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

export type {
  Asset,
  Candle,
  CandleInterval,
  Direction,
  MarginMode,
  MarketConfig,
  Network,
  Order,
  OrderStatus,
  OrderType,
  PoolInfo,
  Position,
  PriceData,
  ReferralClaimedEvent,
  ReferralCodeCreatedEvent,
  ReferralConfig,
  ReferralEvent,
  ReferralInfo,
  ReferralReferrerSetEvent,
  ReferralTradeRecordedEvent,
  StellarAddress,
  Trade,
  TradeKind,
  TraderFeeInfo,
  TriggerCondition,
  VaultCreatedEvent,
  VaultDepositEvent,
  VaultEvent,
  VaultEventEnvelope,
  VaultFeesClaimedEvent,
  VaultInfo,
  VaultLeaderCloseEvent,
  VaultLeaderOpenEvent,
  VaultPausedEvent,
  VaultSnapshot,
  VaultWithdrawEvent,
} from './types/index.js';
