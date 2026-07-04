# Changelog

## 0.1.2 — 2026-07-04

- README: fixed install/import name (`noether-sdk`, not `@noether/sdk`), documented the testnet USDC faucet step, removed stale "WS lands in Phase 8" claims.
- Added `positions.open()`, `vaults.trades()`, `referral.info()`, `keys.betaStatus()` mirroring the gateway; re-synced vendored vault types (leader_open / leader_close events).
- WsClient: `connect()` now rejects on failure/timeout instead of hanging (`connectTimeoutMs`, default 15s), surfaces `rejected` + failed-login frames via `onSubscriptionRejected` / `onLogin`, and re-sends `account.*` subscriptions after each login ack.

## 0.1.1

- Initial npm release.
