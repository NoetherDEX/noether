# Changelog

## 0.1.2 — 2026-07-04

* Gateway parity: added `markets.stats()`, `markets.candles()`, `oracle.health()`, `trades.list()`, `adl.queue()`, `account.volume()` and `account.shortfall()`. The leaderboard endpoints are intentionally left out while their shape is reworked.
* `account.positions()` now returns the full route shape `{ positions, events }`. Earlier builds dropped the positions projection and returned only the events list.
* Error taxonomy: 403 now raises `ForbiddenError` (still an `AuthError`, so existing handlers keep working), 409 raises `ConflictError`, 451 raises `RegionRestrictedError`, and 503 raises `ServiceUnavailableError` carrying `retryAfterSec`. Every `ApiError` exposes a `code` getter with the machine readable error code from the body.
* Cursor pagination: `events.list()`, `account.events()` and `account.orders()` accept `beforeTs`; `trades.list()` supports it as well.
* `OpenPositionRow` gains the advisory `adlQuintile` field served by `/v1/positions/open`.

- README: fixed install/import name (`noether-sdk`, not `@noether/sdk`), documented the testnet USDC faucet step, removed stale "WS lands in Phase 8" claims.
- Added `positions.open()`, `vaults.trades()`, `referral.info()`, `keys.betaStatus()` mirroring the gateway; re-synced vendored vault types (leader_open / leader_close events).
- WsClient: `connect()` now rejects on failure/timeout instead of hanging (`connectTimeoutMs`, default 15s), surfaces `rejected` + failed-login frames via `onSubscriptionRejected` / `onLogin`, and re-sends `account.*` subscriptions after each login ack.

## 0.1.1

- Initial npm release.
