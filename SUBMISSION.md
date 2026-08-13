# Noether — Pre-Launch #2 (Testnet) — Resubmission Notes

This document is the bridge between each deliverable in the Tranche 2
plan and the artefact that proves it. Reviewers should be able to read
one entry, click two links, and verify everything end-to-end.

> **Live URLs**
> - Frontend: <https://noether.exchange>
> - API gateway: <https://noether-api.proudmeadow-533cf0d8.germanywestcentral.azurecontainerapps.io>
> - Repository: <https://github.com/NoetherDEX/noether>
> - Stellar Expert (vault_factory): <https://stellar.expert/explorer/testnet/contract/CCEQJKB3WVADOSCLCMFXL3VBZ4RKYEGFCG4SJVPERLFEWSIFMIWROLZA>

---

## 1. REST API for Programmatic Trading & SDK

### Deliverables addressed in the previous feedback

> *"Unit tests pass for all cross-margin scenarios (multi-position, liquidation, partial close)."*

| Scenario | Test fn | File / line |
|---|---|---|
| Multi-position sharing same collateral pool | `test_cross_margin_open_two_positions` | `contracts/market/src/lib.rs:2608` |
| Closing a cross position returns PnL to the pool | `test_cross_margin_close_returns_pnl_to_pool` | `contracts/market/src/lib.rs:2638` |
| Insufficient free margin reverts | `test_cross_margin_insufficient_free_margin` | `contracts/market/src/lib.rs:2662` |
| Liquidation when total account equity < aggregate maintenance margin | `test_cross_margin_liquidation` | `contracts/market/src/lib.rs:2692` |
| Partial close of a cross position | `test_cross_margin_partial_close` | `contracts/market/src/lib.rs:2718` |

**Reproduce locally:**

```bash
git clone https://github.com/NoetherDEX/noether
cd noether/contracts

# Build the contract WASMs that the test harness imports
cargo +1.79.0 build --target wasm32-unknown-unknown --release \
  -p vault

# Run just the cross-margin tests
cargo test -p market cross_margin

# Or the entire workspace (116 tests passing on a clean checkout)
cargo test
```

**Recorded test snapshots:** every cross-margin scenario also produces a
deterministic Soroban budget snapshot file. The 20 cross-margin snapshot
files are tracked in git under
[`contracts/market/test_snapshots/tests/`](https://github.com/NoetherDEX/noether/tree/main/contracts/market/test_snapshots/tests):

```
test_cross_margin_open_two_positions.1.json
test_cross_margin_close_returns_pnl_to_pool.1.json
test_cross_margin_insufficient_free_margin.1.json
test_cross_margin_liquidation.1.json
test_cross_margin_liquidation_execution.1.json
test_cross_margin_multi_position_liquidation.1.json
test_cross_margin_partial_close.1.json
test_cross_margin_two_positions_share_pool.1.json
test_cross_margin_volume_recorded.1.json
test_cross_margin_isolated_independent.1.json
test_cross_margin_liquidatable_when_equity_drops.1.json
test_cross_margin_not_liquidatable_healthy.1.json
test_cannot_liquidate_healthy_cross_account.1.json
test_deposit_cross_margin.1.json
test_withdraw_cross_margin.1.json
test_withdraw_cross_margin_exceeds_balance.1.json
test_open_cross_margin_position.1.json
test_open_cross_auto_deposits_from_wallet.1.json
test_open_cross_exceeds_pool_balance.1.json
test_get_cross_margin_traders.1.json
```

### Live REST API (independent of the unit tests)

| Endpoint | Notes |
|---|---|
| `GET /v1/health` | Liveness probe |
| `GET /v1/markets` | All markets with live oracle price |
| `GET /v1/oracle/prices` | Snapshot across BTC / ETH / XLM |
| `GET /v1/events` | Indexer firehose with cursor pagination |
| `GET /v1/vaults` | Marketplace listing — now enriched with `apyBps`, `drawdownBps`, `depositorCount`, `openPositions`, `tradeCount` per row |
| `GET /v1/vaults/:id` | Single-vault snapshot (same enriched fields) |
| `GET /v1/vaults/:id/trades` | Leader trade history (new — `leader_open` / `leader_close` events) |
| `GET /v1/vaults/:id/deposits` `…/withdraws` `…/fee-claims` | Activity tables |
| `POST /v1/keys/challenge` `POST /v1/keys` | SEP-10 style wallet-signed key issuance |
| `POST /v1/orders/prepare` `POST /v1/tx/submit` | Prepare-then-submit trading flow |
| `GET /v1/referral/info?address=…` | Public referral state lookup |

Quick smoke from your terminal:

```bash
curl -s https://noether-api.proudmeadow-533cf0d8.germanywestcentral.azurecontainerapps.io/v1/health
curl -s https://noether-api.proudmeadow-533cf0d8.germanywestcentral.azurecontainerapps.io/v1/markets | jq
curl -s https://noether-api.proudmeadow-533cf0d8.germanywestcentral.azurecontainerapps.io/v1/vaults | jq
```

### TypeScript SDK

Published as **`noether-sdk@0.1.x`** on npm: <https://www.npmjs.com/package/noether-sdk>.

```bash
npm i noether-sdk
```

End-to-end example (`sdk-ts/examples/demo.ts`):

```bash
npx tsx sdk-ts/examples/demo.ts https://noether-api.proudmeadow-533cf0d8.germanywestcentral.azurecontainerapps.io
```

### Python SDK

Published as **`noether-sdk`** on PyPI: <https://pypi.org/project/noether-sdk/>.

```bash
pip install noether-sdk
```

---

## 2. WebSocket API for Real-Time Data

- WebSocket gateway deployed alongside REST: `wss://noether-api.proudmeadow-533cf0d8.germanywestcentral.azurecontainerapps.io/v1/ws`
- Channels: `ticker.<ASSET>`, `events`, per-key `account.events.<owner>`
- TypeScript SDK example: `sdk-ts/examples/ws-ticker.ts`

```bash
npx tsx sdk-ts/examples/ws-ticker.ts https://noether-api.proudmeadow-533cf0d8.germanywestcentral.azurecontainerapps.io
```

Connecting subscribes you to live BTC oracle ticks within the same
2-second indexer poll window.

---

## 3. User-Created Vaults

### Vault factory smart contract deployed on testnet

| Field | Value |
|---|---|
| Contract ID | `CCEQJKB3WVADOSCLCMFXL3VBZ4RKYEGFCG4SJVPERLFEWSIFMIWROLZA` |
| Network | Stellar Testnet |
| Stellar Expert | <https://stellar.expert/explorer/testnet/contract/CCEQJKB3WVADOSCLCMFXL3VBZ4RKYEGFCG4SJVPERLFEWSIFMIWROLZA> |
| Source | [`contracts/vault_factory`](https://github.com/NoetherDEX/noether/tree/main/contracts/vault_factory) |
| Init signature | `initialize(admin, market, usdc)` |
| Public view fns | `vault_count() -> u32`, `view_vault(id) -> VaultInfo`, `shares_of(id, addr)` |

Reproduce the read functions directly via Soroban RPC:

```bash
stellar contract invoke \
  --network testnet \
  --id CCEQJKB3WVADOSCLCMFXL3VBZ4RKYEGFCG4SJVPERLFEWSIFMIWROLZA \
  -- vault_count
```

### Marketplace page — `name`, `APY`, `TVL`, `drawdown`, `depositor count`

Live page: <https://noether.exchange/vaults>

Each `<VaultCard />` now renders:

| Column | Source |
|---|---|
| `name` | `vault.name` (on-chain) |
| `APY` | `vault.apyBps` (API aggregate — `realizedPnl / TVL × 365 / days_active`) |
| `TVL` | `vault.totalUsdc` (on-chain) |
| `Drawdown` | `vault.drawdownBps` (API aggregate — `(hwm − nav) / hwm`) |
| `Depositor count` | `vault.depositorCount` (API aggregate — `count(distinct depositor)` over `vault_deposits`) |

Source: [`web/components/vault/VaultCard.tsx`](https://github.com/NoetherDEX/noether/blob/main/web/components/vault/VaultCard.tsx).

API contract:

```bash
curl -s https://noether-api.proudmeadow-533cf0d8.germanywestcentral.azurecontainerapps.io/v1/vaults | jq '.vaults[] | {id, name, totalUsdc, apyBps, drawdownBps, depositorCount, openPositions}'
```

### Comprehensive per-vault page — PnL history, open positions, trade history

Live page (vault id `0`): <https://noether.exchange/vaults/0>

Sections, top-to-bottom:

1. **Header** — vault name, leader (links to Stellar Expert), pause badge.
2. **`<VaultMetrics />`** — three rows of three cards: TVL · APY · Drawdown / Open positions · Total trades · Depositors / NAV · Realized PnL · Leader holding.
3. **`<VaultPnlSummary />`** — headline realized PnL + SVG sparkline of every fee-claim event (PnL history), four tiles: APY / drawdown / inflow / outflow.
4. **`<MyVaultPosition />`** — the connected wallet's share + value-at-NAV + unrealised P&L.
5. **`<VaultTradeHistory />`** — table of every `leader_open` / `leader_close` event the indexer has captured.
6. **Deposits / Withdraws / Fee Claims** — three activity tables.

Source files:

- [`web/app/vaults/[id]/page.tsx`](https://github.com/NoetherDEX/noether/blob/main/web/app/vaults/%5Bid%5D/page.tsx)
- [`web/components/vault/VaultMetrics.tsx`](https://github.com/NoetherDEX/noether/blob/main/web/components/vault/VaultMetrics.tsx)
- [`web/components/vault/VaultPnlSummary.tsx`](https://github.com/NoetherDEX/noether/blob/main/web/components/vault/VaultPnlSummary.tsx)
- [`web/components/vault/VaultTradeHistory.tsx`](https://github.com/NoetherDEX/noether/blob/main/web/components/vault/VaultTradeHistory.tsx)

### Leader-skin invariant + on-chain enforcement

Vault factory rejects any deposit / withdrawal that leaves the leader
holding less than 5 % of total shares (see
[`contracts/vault_factory/src/lib.rs`](https://github.com/NoetherDEX/noether/blob/main/contracts/vault_factory/src/lib.rs)
— `math::leader_min_holding_ok`). UI surfaces this in `VaultMetrics`
("Leader Holding") and warns inside the deposit modal whenever a tx
would break the rule.

---

## 4. Multi-Wallet Support & On-Chain Referral System

### Multi-wallet adapter

Wallets supported via [Creit Tech Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit):

- Freighter
- xBull
- Albedo
- Hana
- LOBSTR (via WalletConnect)
- Hardware wallets (Ledger via Freighter)

Source: [`web/lib/stellar/walletKit.ts`](https://github.com/NoetherDEX/noether/blob/main/web/lib/stellar/walletKit.ts).

### On-chain referral

| Field | Value |
|---|---|
| Contract ID | `CAGZXABWTJN6FU7TMCIWL3RH7EC6K4CQLLZJWUFN3CD7YHVDYWJCIG3O` |
| Stellar Expert | <https://stellar.expert/explorer/testnet/contract/CAGZXABWTJN6FU7TMCIWL3RH7EC6K4CQLLZJWUFN3CD7YHVDYWJCIG3O> |

Frontend: <https://noether.exchange/referrals>

- Code creation is open to any wallet (the `min_code_volume` threshold
  is set to `0` on testnet — admin tx
  `3a7134370cd3c4f8f0777042bd027623c3ae36b504e4a77e4c4e7167cdf44dbe`).
- A referee visiting `?ref=CODE` sees a floating banner with a single
  "Claim 4 % discount" button that fires `referral.set_referrer`.
- Referrers see live earnings + a claim button driven by
  `referral.claim`.

---

## Reviewer cheat-sheet

```bash
# 1. Clone + build
git clone https://github.com/NoetherDEX/noether
cd noether
cargo +1.79.0 build --manifest-path contracts/Cargo.toml \
  --target wasm32-unknown-unknown --release \
  -p vault

# 2. Cross-margin tests (the SCF-feedback POC)
cargo test --manifest-path contracts/Cargo.toml -p market cross_margin
# expected: 5 passed; 0 failed

# 3. Live frontend
open https://noether.exchange/vaults
open https://noether.exchange/vaults/0   # any deployed vault id

# 4. Live API
curl -s https://noether-api.proudmeadow-533cf0d8.germanywestcentral.azurecontainerapps.io/v1/vaults | jq

# 5. Vault factory on-chain
open https://stellar.expert/explorer/testnet/contract/CCEQJKB3WVADOSCLCMFXL3VBZ4RKYEGFCG4SJVPERLFEWSIFMIWROLZA
```

All four feedback items are now reproducible, linkable, and visible
on a single live deploy. Resubmission point: **<https://github.com/NoetherDEX/noether> @ `main`** + this document.
