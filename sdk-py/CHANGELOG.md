# Changelog

## 0.1.2 — 2026-07-04

- Fixed API-key issuance: `keys.create` now wraps the challenge in a manageData transaction signed over `tx.hash()` (the format the gateway verifies) instead of raw challenge bytes — 0.1.1 key issuance always got 401. `keys.exchange` now takes `signed_xdr` (base64 XDR) instead of `signature_hex`; `stellar-sdk` (the `[stellar]` extra) is required for `keys.create`.
- Added `positions.open()`, `vaults.trades()`, `referral.info()`, `keys.beta_status()` mirroring the gateway.
- WsClient: `connect()` now raises on failure/timeout instead of hanging (`connect_timeout`, default 15s), surfaces `rejected` + failed-login frames via `on_rejected` / `on_login`, and re-sends `account.*` subscriptions after each login ack.
- Capped `websockets>=12,<14` (v14 removed `.closed`); `__version__` is now single-sourced from `noether_sdk/__init__.py` via hatch.

## 0.1.1

- Initial PyPI release.
