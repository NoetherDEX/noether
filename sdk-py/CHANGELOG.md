# Changelog

## 0.1.2 — 2026-07-04

* Gateway parity: added `markets.stats()`, `markets.candles()`, `oracle.health()`, `trades.list()`, `adl.queue()`, `account.volume()` and `account.shortfall()`. The leaderboard endpoints are intentionally left out while their shape is reworked.
* `account.positions()` now returns the full route shape (`AccountPositionsResponse` with `positions` and `events`). Earlier builds dropped the positions projection and returned only the events list.
* Error taxonomy: 403 now raises `ForbiddenError` (still an `AuthError`, so existing handlers keep working), 409 raises `ConflictError`, 451 raises `RegionRestrictedError`, and 503 raises `ServiceUnavailableError` carrying `retry_after_sec`. Every `ApiError` exposes a `code` property with the machine readable error code from the body.
* Cursor pagination: `events.list()`, `account.events()` and `account.orders()` accept `before_ts`; `trades.list()` supports it as well.
* `OpenPositionRow` gains the advisory `adl_quintile` field served by `/v1/positions/open`.

- `orders.prepare` gains `time_in_force` (0=GTC, 1=IOC, 2=PostOnly) and `reduce_only` passthrough for `place_limit_order` / `place_stop_limit_order`, and `limit_price` on `set_take_profit` (take-limit). Rides the gateway/tx-builders fix for the deployed contract arities — with the pre-fix gateway these three ops failed Soroban simulation.

- Fixed API-key issuance: `keys.create` now wraps the challenge in a manageData transaction signed over `tx.hash()` (the format the gateway verifies) instead of raw challenge bytes — 0.1.1 key issuance always got 401. `keys.exchange` now takes `signed_xdr` (base64 XDR) instead of `signature_hex`; `stellar-sdk` (the `[stellar]` extra) is required for `keys.create`.
- Added `positions.open()`, `vaults.trades()`, `referral.info()`, `keys.beta_status()` mirroring the gateway.
- WsClient: `connect()` now raises on failure/timeout instead of hanging (`connect_timeout`, default 15s), surfaces `rejected` + failed-login frames via `on_rejected` / `on_login`, and re-sends `account.*` subscriptions after each login ack.
- Capped `websockets>=12,<14` (v14 removed `.closed`); `__version__` is now single-sourced from `noether_sdk/__init__.py` via hatch.

## 0.1.1

- Initial PyPI release.
