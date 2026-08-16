<a id="readme-top"></a>

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://noether.exchange">
    <img src="docs/logo.png" alt="Noether Logo" width="160" height="160">
  </a>

  <h1 align="center">Noether</h1>

  <p align="center">
    <strong>Decentralized Perpetual Futures Exchange on Stellar</strong>
    <br />
    Trade crypto perpetuals with up to 10x leverage — fully on-chain, powered by Soroban smart contracts.
    <br />
    <br />
    <a href="https://noether.exchange/trade"><strong>Trade on Testnet »</strong></a>
    &nbsp;·&nbsp;
    <a href="https://docs.noether.exchange"><strong>Docs »</strong></a>
    <br />
    <br />
    <a href="https://noether.exchange">Website</a>
    ·
    <a href="https://docs.noether.exchange">Documentation</a>
    ·
    <a href="https://twitter.com/Noetherdex">Twitter</a>
    ·
    <a href="https://discord.gg/hmS6t2R5z">Discord</a>
    ·
    <a href="https://t.me/Noetherdex">Telegram</a>
    ·
    <a href="https://github.com/NoetherDEX/noether/issues">Report Bug</a>
  </p>
</div>

<!-- BADGES -->
<div align="center">

[![License: MIT][license-shield]][license-url]
[![Stellar Testnet][stellar-shield]][stellar-url]
[![Built with Soroban][soroban-shield]][soroban-url]
[![Funded by SCF #41][scf-shield]][scf-url]
[![Docs][docs-shield]][docs-url]
[![npm][npm-shield]][npm-url]
[![PyPI][pypi-shield]][pypi-url]
[![Twitter Follow][twitter-shield]][twitter-url]
[![Discord][discord-shield]][discord-url]
[![Telegram][telegram-shield]][telegram-url]

</div>

<!-- SCREENSHOT -->
<br />
<div align="center">
  <img src="docs/screenshot-trade.png" alt="Noether Trade Page" width="100%">
</div>

<br />

<!-- TABLE OF CONTENTS -->
<details>
  <summary><strong>Table of Contents</strong></summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li><a href="#features">Features</a></li>
    <li><a href="#live-demo">Live Demo</a></li>
    <li><a href="#architecture">Architecture</a></li>
    <li><a href="#how-it-works">How It Works</a></li>
    <li><a href="#trading-parameters">Trading Parameters</a></li>
    <li><a href="#built-with">Built With</a></li>
    <li><a href="#contract-addresses">Contract Addresses</a></li>
    <li><a href="#project-structure">Project Structure</a></li>
    <li><a href="#getting-started">Getting Started</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#security">Security</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#team">Team</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
    <li><a href="#why-noether">Why "Noether"?</a></li>
  </ol>
</details>

---

## About The Project

**Noether** is a decentralized perpetual futures exchange (PerpDEX) built on the [Stellar](https://stellar.org) blockchain using [Soroban](https://soroban.stellar.org) smart contracts. Every order, match, and settlement lives on-chain — verifiable by anyone, custodied by nobody.

The protocol is funded by [Stellar Community Fund #41](https://communityfund.stellar.org/) with a grant of **$86,200** delivered across three tranches. Tranche 1 (trading engine) is complete and live on testnet; **Tranche 2** (developer tooling, user-created vaults, on-chain referral) is **code-complete with operator steps pending**; **Tranche 3** (mainnet launch) is **underway** — 14 trading pairs live on testnet and the full [documentation site](https://docs.noether.exchange) shipped.

### Why Stellar?

| | |
|---|---|
| **~5s Finality** | Near-instant transaction confirmation |
| **Sub-cent Fees** | Fraction of a cent per transaction |
| **Soroban** | Rust-based smart contracts with WASM safety guarantees |
| **Native USDC** | Circle-issued USDC with deep ecosystem support |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Features

### For Traders

- **Up to 10x leverage** on 14 perpetual markets — BTC, ETH, XLM, SOL, XRP, ADA, BNB, TRX, HYPE, DOGE, ZEC, LINK, BCH, LTC
- **Isolated and cross-margin** modes — per-position collateral, or a shared pool with account-level liquidation
- **Full order suite**: Market, Limit, Stop-Limit, Stop-Loss, Take-Profit, Trailing Stop
- **Time-in-Force controls**: GTC, IOC, Post-Only, plus a Reduce-Only flag
- **Volume-based fee tiers** — 4 tiers over a 14-day rolling window, sub-basis-point precision
- **Funding rates** that auto-balance long/short open interest, applied lazily on close/liquidate
- **Keeper-executed orders** — limit, stop, and trailing orders execute on-chain without requiring you to be online
- **Multi-wallet support** — Freighter, xBull, and other extension wallets via [Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit), plus LOBSTR and mobile wallets over WalletConnect
- **On-chain referrals** — register a code and bind referees on-chain today; a 4% referee discount and 10% referrer share activate in v1.1

### For Liquidity Providers

- **Deposit USDC, receive NOE** — the protocol vault's LP token (a SAC-wrapped classic Stellar asset)
- **Transparent AUM accounting**: `AUM = total_usdc + accumulated_fees − unrealized_trader_pnl`
- **Fee share** on every trade routed through the vault
- **Withdraw anytime** — burn NOE, receive pro-rata USDC at current NOE price
- **User-created trading vaults** (Tranche 2) — opt-in marketplace of leader-managed vaults as an alternative to the protocol vault

### For Vault Leaders

- **Create a vault** with one call to the on-chain `vault_factory`
- **Earn a 10% profit share** above the high-water mark on depositor PnL
- **Trade on shared collateral** via proxied `leader_trade` calls — depositors keep custody of their share token, you keep the upside
- **5% min-holding invariant** — leaders are required to keep their own skin in the game, enforced on-chain
- **Browse the marketplace** at [`/vaults`](https://noether.exchange/vaults); manage your vault at `/vaults/[id]/manage`

### For Developers

- **Documentation** — user guides, REST + WebSocket reference, SDK quickstarts, and protocol docs at [docs.noether.exchange](https://docs.noether.exchange)
- **Public REST + WebSocket API** — [Fastify](https://fastify.dev/) gateway, OpenAPI auto-served at `/docs`. Wallet-challenge authentication issues bearer keys (currently closed-beta — see [Security](#security))
- **TypeScript SDK** — [`noether-sdk` on npm](https://www.npmjs.com/package/noether-sdk) ships every endpoint plus `WsClient` with auto-reconnect and subscription replay
- **Python SDK** — [`noether-sdk` on PyPI](https://pypi.org/project/noether-sdk/) mirrors the TS surface (httpx + websockets)
- **Soroban event indexer** — captures every contract event into a Postgres projection table, ready for analytics
- **Shared `@noether/tx-builders`** — single source of truth for Soroban transaction assembly across api + sdk-ts
- **Fully open source** (MIT) — npm-workspace monorepo (`api/`, `indexer/`, `sdk-ts/`, `packages/*`) with vitest, CI, and Docker images for Azure Container Apps
- **Blue-green testnet deploys** via `scripts/deploy_staging.sh` (deploy → verify → promote)
- **On-chain events** — documented schemas matched exactly by the frontend parser
- **Optimized WASM** — `opt-level = "z"`, LTO, panic = abort, stripped symbols
- **Shared math crate** — fixed-point arithmetic in `noether_common`, no floating point anywhere

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Live Demo

Trade on testnet in under a minute:

1. Install [Freighter Wallet](https://freighter.app/) and switch to **Testnet**
2. Visit [noether.exchange/faucet](https://noether.exchange/faucet) and claim USDC (up to 1,000/day)
3. Head to [noether.exchange/trade](https://noether.exchange/trade) and open your first position

No signup. No KYC. No custody. Just a browser and a wallet.

Building on the API instead? Start at [docs.noether.exchange/developers](https://docs.noether.exchange/developers).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Architecture

Noether consists of six Soroban smart contracts on Stellar, a Next.js trading frontend, an autonomous keeper bot, and a Tranche 2 off-chain stack (REST + WS API gateway, Soroban event indexer, TypeScript + Python SDKs).

```
                ┌────────────────────────────────────────────────────────────┐
                │                  Stellar Network (Soroban)                 │
                │                                                            │
                │  ┌──────────┐  ┌───────┐  ┌──────────────┐  ┌───────────┐  │
                │  │  Market  │◄►│ Vault │  │Noeracle Shim │  │ Noeracle  │  │
                │  │ Contract │  │  (LP) │  │  (SEP-40)    │  │ (signed)  │  │
                │  └────┬─────┘  └───┬───┘  └──────┬───────┘  └─────┬─────┘  │
                │       │            │             │                │        │
                │  ┌────┴─────────┐  ┌─┴────────┐  ┌────────────────────┐    │
                │  │ Vault Factory│  │ Referral │  │   Noether Router   │    │
                │  └──────────────┘  └──────────┘  └────────────────────┘    │
                └─────────┬────────────────────────────────────┬─────────────┘
                          │ writes prices,                     │ Soroban events
                          │ liquidates                         │ (getEvents poll)
                          ▼                                    ▼
                ┌──────────────────┐                ┌──────────────────────┐
                │   Keeper Bot     │                │      Indexer         │
                │     (Azure)      │                │      (Azure)         │
                │ Oracle / Liq /   │                │  decode → Postgres   │
                │ Orders / Funding │                │   (Azure Postgres)   │
                └──────────────────┘                └──────────┬───────────┘
                                                               │
                                                               ▼
                                                    ┌──────────────────────┐
                                                    │     API Gateway      │
                                                    │  Fastify REST + WS   │
                                                    │    (closed beta)     │
                                                    │       (Azure)        │
                                                    └──────────┬───────────┘
                                                               │
                              ┌────────────────────────────────┼────────────────────┐
                              ▼                                ▼                    ▼
                    ┌─────────────────────┐           ┌────────────────┐  ┌────────────────┐
                    │  Next.js Frontend   │           │  noether-sdk   │  │  noether-sdk   │
                    │      (Vercel)       │           │  (TypeScript)  │  │    (Python)    │
                    │  Trade · Vaults ·   │           └────────────────┘  └────────────────┘
                    │  Referrals · Faucet │
                    │ Stellar Wallets Kit │
                    └─────────────────────┘

       The frontend reads chain directly (Stellar SDK) for trading + oracle prices,
       and uses sdk-web wrappers over the API gateway for indexed data
       (vault marketplace, referral stats, leaderboard). User trades route through
       the Noether Router, which relays a fresh signed Noeracle price and calls
       the market in the same transaction (verify-then-trade).
```

### Smart Contracts

| Contract | LOC / Tests | Purpose |
|----------|-------------|---------|
| **Market** | ~2,800 LOC | Core trading engine — isolated + cross-margin positions, advanced orders, liquidation, funding |
| **Vault** | ~990 LOC | LP pool — USDC deposits, NOE LP token, PnL settlement with Market |
| **Noeracle Shim** | ~200 LOC | SEP-40 reader — translates `lastprice(Symbol)` to `Noeracle.get_price_pers`, scales to 7 decimals |
| **Noether Router** | ~230 LOC | Atomic verify-then-trade — stores a freshly-signed Noeracle price then opens/closes in one tx |
| **Vault Factory** | T2 · 37 tests | User-created trading vaults — share math, 5% min-holding invariant, leader_trade proxies |
| **Referral** | T2 · 13 tests | On-chain referral system — code registration, `record_trade` accrual, claim payout |
| **Noether Common** | — | Shared types, error codes, fixed-point math (utility crate) |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## How It Works

### Position Lifecycle

```
  Trader                    Market Contract                   Vault
    │                             │                             │
    │  open_position(asset,       │                             │
    │  collateral, leverage, dir) │                             │
    │────────────────────────────►│                             │
    │                             │  lastprice(asset)           │
    │                             │──────────► Noeracle Shim    │
    │                             │◄──────────                  │
    │                             │                             │
    │                             │  transfer USDC (collateral) │
    │                             │────────────────────────────►│
    │                             │  reserve_for_position()     │
    │                             │────────────────────────────►│
    │                             │                             │
    │  Position { id, entry_price,│                             │
    │   liquidation_price, ... }  │                             │
    │◄────────────────────────────│                             │
    │                             │                             │
    │        ... time passes, price moves ...                   │
    │                             │                             │
    │  close_position(id)         │                             │
    │────────────────────────────►│                             │
    │                             │  calculate PnL              │
    │                             │  apply pending funding      │
    │                             │                             │
    │                             │  settle_pnl(pnl)            │
    │                             │────────────────────────────►│
    │                             │                             │
    │  USDC returned              │                             │
    │  (collateral + PnL − fees)  │                             │
    │◄────────────────────────────│                             │
```

### Order System

```
  Order Types
  ├── Market ──────── Opens/closes immediately at current oracle price
  ├── Limit Entry ─── Opens a new position when price reaches trigger
  ├── Stop Loss ───── Closes position to cap losses at trigger price
  ├── Take Profit ─── Closes position to lock in gains (market or limit variant)
  ├── Stop Limit ──── Two-phase: stop price triggers a limit order
  └── Trailing Stop ─ Tracks peak price; closes on reversal (1–50% configurable)

  Time-in-Force
  ├── GTC  ─ Good Till Cancelled (default)
  ├── IOC  ─ Immediate Or Cancel (cancels + refunds if trigger not immediately met)
  └── Post ─ Post-Only (rejected if the trigger would fire immediately)

  Flags
  └── Reduce-Only — Restricts order to reducing an existing position only
```

Orders are placed on-chain and executed by the keeper bot when trigger conditions are met. If slippage exceeds the order's tolerance at execution time, the order is cancelled and collateral refunded — the transaction does **not** revert.

### Cross-Margin

In cross-margin mode, a single USDC pool acts as collateral across all of a trader's positions. Liquidation is decided at the account level, not per-position.

```
Equity        = poolBalance + totalCollateral + unrealizedPnL + pendingFunding
Used Margin   = totalCollateral (sum across open cross positions)
Free Margin   = Equity − Used Margin
Margin Ratio  = Equity / MaintenanceMargin × 100%      (liquidation at 100%)
```

Cross-margin deposits and withdrawals use dedicated entry points (`deposit_cross_margin` / `withdraw_cross_margin`), with withdrawals gated on equity remaining above maintenance margin.

### Liquidation

A position is liquidatable when its equity falls below the maintenance-margin threshold (default 1% / 100 bps).

```
Liquidation Price (Long)  = entry − entry × (1/leverage − mm_bps/10000) / PRECISION
Liquidation Price (Short) = entry + entry × (1/leverage − mm_bps/10000) / PRECISION

Keeper Bot (every ~5s):
  ├── Isolated:  get_all_position_ids() → is_liquidatable() → liquidate()
  └── Cross:     attempt liquidate_cross_account() for each tracked cross-trader

Keeper reward = remaining_collateral × liquidation_fee_bps / 10000
                (capped at 10% of collateral)
```

### Funding Rate

```
funding_rate = base_rate × (longs − shorts) / max(longs, shorts)

Positive rate → longs pay shorts
Negative rate → shorts pay longs
```

Funding is **lazy**: the keeper calls `apply_funding()` hourly, which stores the global rate. Actual funding is calculated and applied per-position on close or liquidation — gas-efficient, no mass-update transaction.

### Vault Flow

```
  Liquidity Provider Flow
  ═══════════════════════

  ┌────────┐   deposit USDC    ┌───────────┐   transfer   ┌───────────┐
  │   LP   │──────────────────►│   Vault   │─────────────►│ NOE Token │
  └────────┘                   │  Contract │  (pre-mint)  │  (SAC)    │
                               └─────┬─────┘              └───────────┘
                                     │
                         ┌───────────┴───────────┐
                         │                       │
                    Trader wins             Trader loses
                    (vault pays)           (vault receives)
                         │                       │
                         ▼                       ▼
                   AUM decreases          AUM increases
                   NOE price drops        NOE price rises


  AUM       = total_usdc + accumulated_fees − unrealized_trader_pnl   (floored at 0)
  NOE Price = AUM × PRECISION / circulating_NOE
```

NOE is a SAC-wrapped classic Stellar asset, pre-minted to the vault. Deposits move NOE via `transfer` (not `mint`); withdrawals require the user to first `approve()` the vault.

### User-Created Vaults (Tranche 2)

Anyone can deploy a new trading vault via `vault_factory.create_vault(leader, name, profit_share_bps)`. The leader trades on behalf of all depositors using shared collateral and earns a profit share above the high-water mark; depositors hold share tokens denominated in vault NAV.

```
  Depositor                  Vault Factory                Market
    │                              │                        │
    │  create_vault(leader, name)  │                        │
    │ ──── (called by leader) ───► │                        │
    │                              │                        │
    │  deposit(vault_id, usdc)     │                        │
    │ ────────────────────────────►│                        │
    │                              │  USDC → vault reserve  │
    │  shares ◄────────────────────│  (proportional mint)   │
    │                              │                        │
    │       ... leader trades ...                           │
    │                              │  leader_trade(…)       │
    │                              │ ──── (proxied auth) ──►│
    │                              │                        │
    │  withdraw(vault_id, shares)  │                        │
    │ ────────────────────────────►│                        │
    │  USDC ◄──────────────────────│  pro-rata NAV − fees   │

  NAV          = vault_usdc + open_position_equity
  Share Price  = NAV × PRECISION / total_shares
  Profit Share = leader_share_bps × (NAV − HWM) / 10000      (default: 10%)
  Invariant    : leader's own deposit ≥ 5% of total shares   (checked every withdraw)
```

The 5% min-holding invariant is enforced on every withdraw — leaders cannot drain below it while depositors remain. Browse the marketplace at [`/vaults`](https://noether.exchange/vaults).

### Referral System (Tranche 2)

The `referral` contract lets traders mint a short code, share it via `?ref=CODE` links, and accrue revenue from referred trades. Code registration and referee binding are live on-chain today; from **v1.1**, referees pay 4% less in fees and referrers earn a 10% share of the fee paid by their referees.

```
  Referrer                  Referral Contract              Market
    │                              │                        │
    │  register_code("ALICE")      │                        │
    │ ────────────────────────────►│                        │
    │  (code stored on-chain)      │                        │
    │                              │                        │
  Referee                          │                        │
    │  set_referrer("ALICE")       │                        │
    │ ────────────────────────────►│                        │
    │  (binding stored)            │                        │
    │                              │                        │
    │       ... referee trades ...                          │
    │                              │  record_trade(         │
    │                              │    referee, fee)       │
    │                              │◄───────────────────────│
    │                              │  • 4% discount returned│
    │                              │    to referee          │
    │                              │  • 10% of fee added    │
    │                              │    to referrer claim   │
    │                              │                        │
  Referrer                         │                        │
    │  claim()                     │                        │
    │ ────────────────────────────►│                        │
    │  USDC ◄──────────────────────│                        │

  discount_bps         = 400    (4%, referee's per-trade fee discount)
  referrer_share_bps   = 1_000  (10% of full fee accrues to referrer)
  min_code_volume      = 0      (lowered on testnet — anyone can register)
```

> **Status (testnet).** Code registration and referee binding are live
> on-chain today. The deployed market does not yet call `record_trade` on
> every fee, so the 4% referee discount, the 10% referrer accrual, and
> `claim()` payouts **activate in v1.1** — once the market is redeployed
> with the hook (operator step — see [Roadmap](#roadmap)). The contract
> path is fully implemented and tested (13 tests); it's a deploy-time
> step, not new code.

Browse and claim at [`/referrals`](https://noether.exchange/referrals).

### Oracle (Noeracle, pull-based + signed)

```
  ┌─────────────────────────┐
  │  Noeracle service       │   Ed25519-signed price rounds (~500ms)
  │  api.noeracle.org       │   median of 5 CEX sources
  └───────────┬─────────────┘
              │ keeper publishes signed attestations on-chain
              ▼
  ┌─────────────────────────┐   verifies signature + staleness,
  │  Noeracle  (Soroban)    │   stores PriceEntry{price,ts,round_id}
  └───────────┬─────────────┘
              │ get_price_pers(tag) -> PriceEntry
              ▼
  ┌─────────────────────────┐   lastprice(Symbol) -> (i128, u64)
  │  noeracle_shim (SEP-40) │   8-byte tag map + 7-decimal scaling
  └───────────┬─────────────┘
              │
              ▼
        Market reads price
```

For user trades, the **noether_router** collapses verify + trade into one
transaction (`open_with_price` / `close_with_price`): it stores a freshly-signed
price, then calls the market — so the price is only seconds old at execution and
never trips the staleness check. Prices are `i128` at 7 decimals.

### Keeper Loop

The keeper is an autonomous TypeScript bot that runs continuously, executing four phases per cycle.

```
Keeper Bot (5-second cycle)
═══════════════════════════

  Phase 1 — Oracle Updates (every 30s)
    Fetches Ed25519-signed attestations from Noeracle (api.noeracle.org)
    Publishes them on-chain via Noeracle.update_ed25519_persistent
    50% price-change circuit breaker

  Phase 2 — Liquidation Scan (every cycle)
    Isolated:  check every open position against maintenance margin → liquidate
    Cross:     attempt liquidate_cross_account per tracked trader

  Phase 3 — Trailing Peaks + Order Execution (every cycle)
    update_trailing_peak() for each TrailingStop order
    execute_order() for any order whose trigger conditions are met
    Slippage exceeded → order cancelled, collateral refunded (reward = 0)

  Phase 4 — Funding Rate (every 1h)
    apply_funding() — stores new global rate for lazy per-position application
```

### Off-Chain Pipeline (Tranche 2)

Tranche 2 introduced a Soroban event indexer feeding a Fastify REST + WebSocket gateway, with TypeScript and Python SDKs on top.

```
  Stellar Soroban ───► Indexer ───► libSQL ───► API Gateway ───► SDKs / Web
   (getEvents)        (decode &   (Supabase)     (Fastify,         (TS, Py,
                       project)                   REST + WS,        frontend)
                                                  closed beta)
```

- **Indexer** (`indexer/`) polls `getEvents` from a persistent ledger cursor, dispatches by contract address (`router.ts`), runs per-contract decoders, and writes structured projections to libSQL.
- **API Gateway** (`api/`) reads projections, serves REST routes (`/v1/markets, /v1/candles, /v1/trades, /v1/positions, /v1/leaderboard, /v1/oracle, /v1/account, /v1/orders, /v1/tx, /v1/vaults, /v1/referral, /v1/events, /v1/keys, …`), and broadcasts 4 WebSocket channel families. OpenAPI auto-served at `/docs`; full reference at [docs.noether.exchange/developers](https://docs.noether.exchange/developers). Wallet-challenge auth issues bearer keys hashed at rest with an HMAC pepper.
- **SDKs** ship sub-clients matching the API surface 1:1 plus an auto-reconnecting `WsClient` (`noether-sdk` on both npm and PyPI).
- **Frontend** uses the SDKs for indexed data (vault marketplace, referral stats, leaderboard) and reads the chain directly via `@stellar/stellar-sdk` for trading + oracle prices.

> **Closed beta.** API-key issuance is gated by an `API_KEY_ALLOWLIST` while
> the protocol matures. Wallet-only Soroban operations (registering a
> referral code, opening positions, depositing to vaults) do **not** require
> the gateway — they go straight to chain and work for any wallet. Email or
> join Discord to request beta access.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Trading Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| Max Leverage | 10x | 25x planned for mainnet |
| Min Collateral | 10 USDC | Prevents dust positions |
| Maintenance Margin | 1% (100 bps) | Triggers liquidation |
| Liquidation Fee | 5% (500 bps) | Keeper reward, capped at 10% of collateral |
| Base Maker Fee | 0.020% | Lowest tier: 0.005% |
| Base Taker Fee | 0.050% | Lowest tier: 0.020% |
| Funding Rate | 0.01% / hour base | Lazy — applied per-position on close |
| Price Precision | 7 decimals | `PRECISION = 10_000_000` |
| Fee Precision | Deci-bps (100,000) | 1 unit = 0.001% — sub-bps accuracy |
| Max Price Staleness | 60 seconds | Market rejects older quotes |
| Max Position Size | $100,000 | Per position |
| Supported Markets | 14 pairs — BTC, ETH, XLM, SOL, XRP, ADA, BNB, TRX, HYPE, DOGE, ZEC, LINK, BCH, LTC | HYPE is API-only for now |

### Fee Tiers (14-day rolling volume, testnet)

| Tier | Volume Threshold | Maker | Taker |
|------|-----------------|-------|-------|
| 0 | $0 | 0.020% | 0.050% |
| 1 | > $20,000 | 0.015% | 0.040% |
| 2 | > $50,000 | 0.010% | 0.030% |
| 3 | > $100,000 | 0.005% | 0.020% |

> Mainnet thresholds will be raised to **$1M / $5M / $25M**.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Built With

### Smart Contracts
[![Rust][rust-shield]][rust-url] [![Soroban][soroban-built-shield]][soroban-url] [![WebAssembly][wasm-shield]][wasm-url]

Rust (Edition 2021) · Soroban SDK 21.0 · Compiled to WASM with `opt-level=z`, LTO, `panic=abort`, stripped symbols.

### Frontend
[![Next.js][nextjs-shield]][nextjs-url] [![TypeScript][typescript-shield]][typescript-url] [![TailwindCSS][tailwind-shield]][tailwind-url] [![React][react-shield]][react-url]

Next.js 14 (App Router) · TypeScript 5.2 · Tailwind CSS · Zustand · Framer Motion · Three.js · TradingView lightweight-charts · `@stellar/stellar-sdk` 14 · `@creit-tech/stellar-wallets-kit` (Freighter + LOBSTR + WalletConnect) · leaderboard via the gateway (`/v1/leaderboard`).

### Keeper Bot
[![Node.js][node-shield]][node-url] [![TypeScript][typescript-shield]][typescript-url]

Node.js · TypeScript · `@stellar/stellar-sdk` · publishes Ed25519-signed Noeracle attestations on-chain (~30s cadence) · liquidation scans, order execution, hourly funding.

### API Gateway (Tranche 2)
[![Node.js][node-shield]][node-url] [![TypeScript][typescript-shield]][typescript-url]

[Fastify](https://fastify.dev/) · `@fastify/swagger` (OpenAPI at `/docs`) · `@fastify/websocket` · Postgres (Azure) via `@noether/db` · HMAC-peppered bearer keys · tiered rate limiting · vitest · Dockerised for Azure Container Apps.

### Indexer (Tranche 2)
[![Node.js][node-shield]][node-url] [![TypeScript][typescript-shield]][typescript-url]

Soroban `getEvents` polling · per-contract decoders → Postgres (Azure) projections · persistent ledger cursor · vitest · Dockerised for Azure Container Apps.

### SDKs (Tranche 2)

- **[`noether-sdk` (TypeScript, npm)](https://www.npmjs.com/package/noether-sdk)** — tsup-bundled, full REST + WsClient surface, `executeTrade` helper, vitest-covered.
- **[`noether-sdk` (Python, PyPI)](https://pypi.org/project/noether-sdk/)** — httpx + websockets, mirrors the TS sub-clients, pytest-covered.

### Infrastructure

Azure Container Apps (web, api, indexer, keepers) · Azure Database for PostgreSQL · Stellar Testnet (RPC + Horizon).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Contract Addresses

Current testnet deployment: the **Batch-1 stack, deployed 2026-07-21** and
upgraded in place since — addresses are stable across code upgrades because
the market swaps WASM via `upgrade()` rather than redeploying. Canonical
source is [`contracts.json`](./contracts.json). A running gateway echoes the
addresses it actually serves at [`GET /v1/health`](https://noether-api.proudmeadow-533cf0d8.germanywestcentral.azurecontainerapps.io/v1/health),
and the always-current table lives at
[docs.noether.exchange/protocol/contracts](https://docs.noether.exchange/protocol/contracts):

| Contract | Address |
|----------|---------|
| **Market** | `CBHHWFAYLB3SXJCE232DC6WNSK74IBEOROAGCI2AFBA2H5NQOH2KYKNN` |
| **Vault** | `CBSWA5P75NGV2LP5KOY7A7LOAX2CENI5OYBSJ5IVLHENKQJF2I3ZBSYE` |
| **Noether Router** (verify-then-trade) | `CBDVQKYEN6QMRGQZC77DFYEQXQHDMCVJ3TPBJKNERJVMIESA6GQT44LG` |
| **Noeracle Shim** | `CDRQJDCZ2EKIVAM6D6U2YFTE7VNMN3TFUUJGZ5SKAFB5TCLMSHSSWU6N` |
| **Noeracle** (signed price source) | `CBTO5K2NLG2KYHQDL5ME4SWFQ5GRR7GVU4DFATOXGVS3OUJJDFF2YYNS` |
| **Vault Factory** (T2) | `CAG5E6IM32GFEXGZOXWLFHNVRMDOYGPRZKZSBFXXHVJ5Q5MNJUSNQKT7` |
| **Referral** (T2) | `CB4A2OHP6BKKF2RC532PPRE7K4X3UOZEVASEQTTTWMRSZGUN2AV2REND` |
| **USDC Token** | `CA63EPM4EEXUVUANF6FQUJEJ37RWRYIXCARWFXYUMPP7RLZWFNLTVNR4` |
| **NOE Token** | `CADEAZ3TT5SIGJVBIWMMWC4TFZKPKGPGGJ6O4JGAAZTLR6MIBDRBQ4H5` |
| **Admin** | `GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN` |

**NOE asset:** code `NOE`, issuer = Admin address. Addresses rotate on testnet
resets and redeploys — trust `contracts.json` / `/v1/health` over any snapshot.

Prices come from **Noeracle**, a pull-based, Ed25519-signed price oracle (~500ms
rounds). The keeper publishes signed attestations on-chain; the market reads them
via the `noeracle_shim` (a SEP-40 reader translating to `Noeracle.get_price_pers`).

### Network Configuration

```
Network:    testnet
RPC URL:    https://soroban-testnet.stellar.org
Horizon:    https://horizon-testnet.stellar.org
Passphrase: Test SDF Network ; September 2015
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Project Structure

```
noether/
├── contracts/              # Soroban smart contracts (Rust)
│   ├── market/             # Trading engine (positions, orders, liquidation)
│   ├── vault/              # LP pool + NOE token
│   ├── noeracle_shim/      # SEP-40 reader → Noeracle.get_price_pers
│   ├── noether_router/     # Atomic verify-then-trade (Noeracle)
│   ├── vault_factory/      # T2 — user-created trading vaults
│   ├── referral/           # T2 — on-chain referral system
│   └── noether_common/     # Shared types, errors, fixed-point math
├── web/                    # Next.js 14 frontend
│   ├── app/                # Pages: trade, portfolio, vault, leaderboard, faucet
│   ├── components/         # React components (trading, vault, wallet, landing, ui)
│   └── lib/
│       ├── stellar/        # Contract interaction layer (never called from components)
│       ├── store/          # Zustand stores (walletStore, tradeStore)
│       ├── hooks/          # useWallet, usePriceData, useFaucet
│       └── utils/          # constants, formatting
├── scripts/
│   ├── keeper/             # Autonomous keeper bot (TypeScript)
│   ├── build_contracts.sh  # Compile + optimize all WASM
│   ├── deploy_staging.sh   # Blue-green testnet deploy → verify → promote
│   ├── deploy_production.sh# Production stack deploy
│   ├── fund_market.sh      # Transfer USDC to market (interactive)
│   └── legacy/             # Retired one-shot deploy scripts (exit-guarded)
├── packages/               # Tranche 2 — shared monorepo packages
│   ├── types/              # @noether/types  · domain types (Position, Order, …)
│   ├── shared/             # @noether/shared · precision, contracts loader, network
│   └── tx-builders/        # @noether/tx-builders · Soroban tx assembly (api + sdk-ts)
├── api/                    # Tranche 2 — REST + WebSocket gateway (Fastify)
├── indexer/                # Tranche 2 — Soroban event indexer (Postgres)
├── sdk-ts/                 # Tranche 2 — public TypeScript SDK (npm)
├── sdk-py/                 # Tranche 2 — public Python SDK (PyPI)
├── docs/                   # README assets + GIT_WORKFLOW.md, CONTRIBUTING.md
├── .github/                # PR template, CI workflows
├── .husky/                 # Branch + commit-msg hooks
├── package.json            # npm workspace root (api, indexer, sdk-ts, packages/*)
├── tsconfig.base.json      # Shared TypeScript config
├── contracts.json          # Authoritative deployed addresses
├── LICENSE                 # MIT
└── .env.example            # Environment template
```

> **Monorepo note.** The `web/` and `scripts/keeper/` packages keep their own
> `package.json` and install paths — they are **not** workspace members for
> now. Only the new Tranche 2 packages (`api/`, `indexer/`, `sdk-ts/`,
> `packages/*`) are wired into the root npm workspace.
> See [`docs/GIT_WORKFLOW.md`](./docs/GIT_WORKFLOW.md) for the branch model
> and [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) for setup instructions.

### Pages

| Page | Path | Description |
|------|------|-------------|
| Landing | `/` | Protocol overview with live trading preview |
| Trade | `/trade` | Full trading interface — chart, order panel, positions, trade history |
| Portfolio | `/portfolio` | Open positions, trade history, PnL tracking |
| Protocol Vault | `/vault` | LP interface — deposit USDC, withdraw NOE, pool stats |
| Vaults Marketplace | `/vaults` | T2 — browse user-created trading vaults |
| Vault Detail | `/vaults/[id]` | T2 — deposit / withdraw a single vault |
| Vault Manage | `/vaults/[id]/manage` | T2 — leader panel (trade + claim fees) |
| Referrals | `/referrals` | T2 — register a code, share, claim accrued rewards |
| API Keys | `/api-keys` | T2 — in-browser issuance of gateway bearer keys (closed beta) |
| Leaderboard | `/leaderboard` | Top traders by volume and PnL (proxied from the gateway `/v1/leaderboard`) |
| Faucet | `/faucet` | Testnet USDC (up to 1,000/day) |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://rustup.rs/) + `wasm32-unknown-unknown` target — for contract work
- [Stellar CLI](https://developers.stellar.org/docs/smart-contracts/getting-started/setup) — for deployment
- [Freighter Wallet](https://freighter.app/) or any Stellar Wallets Kit-compatible wallet (LOBSTR, etc.)

### Run the Frontend

```bash
git clone https://github.com/NoetherDEX/noether.git
cd noether/web
npm install
npm run dev
```

Open `http://localhost:3000`.

### Run the Keeper Bot

```bash
cd scripts/keeper
npm install
cp ../../.env.example .env    # Configure your keeper keypair
npm start                     # or: npm run dev (auto-restart)
```

### Run the API + Indexer (Tranche 2 — monorepo)

```bash
# From repo root — npm workspaces (api, indexer, sdk-ts, packages/*)
npm install
npm run build:packages         # types → shared → tx-builders (order matters)

# Indexer — polls Soroban events into libSQL
npm -w @noether/indexer run migrate
npm -w @noether/indexer run dev

# API gateway — Fastify REST + WS, port 4000
npm -w @noether/api run dev
# OpenAPI / Swagger UI: http://localhost:4000/docs

# All tests across workspaces
npm test
```

> **Closed beta.** Bearer-key issuance via the gateway honours
> `API_KEY_ALLOWLIST`. Wallet-only Soroban calls (registering a referral
> code, opening positions, depositing to vaults) work without an API key.
> See [Security](#security).

### Build & Deploy Contracts

```bash
# Build all contracts (optimized WASM)
./scripts/build_contracts.sh

# Blue-green testnet deploy → verify → promote
./scripts/deploy_staging.sh

# Production stack deploy
./scripts/deploy_production.sh

# Oracle-side contracts
./scripts/deploy_noeracle_shim.sh
./scripts/deploy_noether_router.sh

# Tranche 2 contracts
npx tsx web/scripts/referral-set-min-volume.ts      # set on-chain min_code_volume
```

> One-shot deploy and repair scripts from earlier stack generations were
> removed once their work shipped — git history keeps them if archaeology
> is ever needed.

Addresses are written to `contracts.json` automatically. Update `.env` and the
Azure container app env vars (web, api, indexer, keepers) manually so they match.

### Environment Variables

Copy `.env.example` to `.env` and populate:

```env
# Network
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
SOROBAN_RPC_URL="https://soroban-testnet.stellar.org"
# SOROBAN_RPC_URLS="https://primary,https://fallback"   # comma-separated failover

# Keys
ADMIN_SECRET_KEY=S...           # Deployment + admin operations
KEEPER_SECRET_KEY=S...          # (Optional) dedicated keeper key
ORACLE_SECRET_KEY=S...          # (Optional) dedicated oracle-updater key

# Contract addresses (canonical source: contracts.json)
NEXT_PUBLIC_MARKET_ID=C...
NEXT_PUBLIC_VAULT_ID=C...
NEXT_PUBLIC_NOERACLE_SHIM_ID=C...
NEXT_PUBLIC_NOERACLE_ID=C...
NEXT_PUBLIC_NOETHER_ROUTER_ID=C...
NEXT_PUBLIC_NOERACLE_API_URL=https://api.noeracle.org
NEXT_PUBLIC_VAULT_FACTORY_ID=C...    # Tranche 2
NEXT_PUBLIC_REFERRAL_ID=C...         # Tranche 2
NEXT_PUBLIC_USDC_TOKEN_ID=C...
NEXT_PUBLIC_NOE_TOKEN_ID=C...

# Frontend
NEXT_PUBLIC_NOETHER_API_URL=http://localhost:4000   # api gateway base URL
FAUCET_ADMIN_SECRET_KEY=S...                        # /faucet payments

# Indexer (Tranche 2)
DATABASE_URL="postgresql://postgres:dev@localhost:5432/postgres"  # Supabase session-pooler URL in prod
INDEXER_POLL_INTERVAL_MS=2000

# API Gateway (Tranche 2)
API_PORT=4000
API_HMAC_PEPPER=                      # openssl rand -hex 32 — must be stable across restarts
API_CORS_ORIGIN=*
API_KEY_ALLOWLIST=                    # comma-separated G… addresses for closed beta
```

> The keeper's secret-key resolution order is `KEEPER_SECRET_KEY` → `ORACLE_SECRET_KEY` → `ADMIN_SECRET_KEY`. Using a dedicated oracle wallet avoids sequence-number conflicts with the admin wallet during deploys.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Roadmap

Noether is being delivered in three tranches under [Stellar Community Fund #41](https://communityfund.stellar.org/).

### Tranche 1 — Trading Engine Upgrades · $17,240 · **Complete**

- [x] Cross-margin mode (shared collateral, per-trader equity, account-level liquidation)
- [x] Advanced orders: Stop-Limit, Take-Limit, Trailing Stop, Reduce-Only
- [x] Time-in-force: GTC, IOC, Post-Only
- [x] Maker/taker fee system with 4 volume-based tiers

### Tranche 2 — Developer Tooling & Vault Ecosystem · $25,800 · **Code Complete · Operator steps pending**

- [x] Public REST + WebSocket APIs (`api/` — Fastify, OpenAPI at `/docs`, 4 WS channel families, 37 vitest tests)
- [x] TypeScript SDK — `noether-sdk` with `WsClient` (25 tests)
- [x] Python SDK — `noether-sdk` mirroring the TS surface (12 tests)
- [x] User-created trading vaults — `vault_factory` contract (37 tests) + `/vaults` marketplace + leader manage panel
- [x] Multi-wallet support — Freighter, LOBSTR, xBull, Albedo, Ledger via Stellar Wallets Kit
- [x] On-chain referral system — `referral` contract (13 tests) + sticky `?ref=CODE` banner + `/referrals` dashboard
- [x] Soroban event indexer — Postgres (Supabase) projections feeding the API gateway

Pending operator steps:

- [ ] Market WASM-optimise + redeploy with the on-chain referral discount hook (currently applied off-chain at the gateway — see [Referral System](#referral-system-tranche-2))
- [x] npm publish — [`noether-sdk`](https://www.npmjs.com/package/noether-sdk) live on npm
- [x] PyPI publish — [`noether-sdk`](https://pypi.org/project/noether-sdk/) live on PyPI
- [ ] Paid Soroban RPC endpoint (`SOROBAN_RPC_URLS`) for keeper + indexer — see [`docs/RPC.md`](./docs/RPC.md)

### Tranche 3 — Mainnet Launch · $34,480 · **In Progress**

- [ ] Production oracle hardening — Noeracle multi-publisher (M-of-N) signatures + TWAP for funding/liquidation
- [ ] All contracts deployed to Stellar mainnet with 25x leverage
- [ ] Partial liquidation (20% initial, 30s grace period) + insurance fund
- [ ] 10+ trading pairs — **14 live on testnet**; mainnet deploy pending
- [ ] Mobile-responsive UI
- [x] Comprehensive documentation — live at [docs.noether.exchange](https://docs.noether.exchange)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Security

- **Authorization** — Every state-changing function calls `require_auth()` on the relevant signer (trader for trading, admin for admin ops)
- **Leverage cap** — Hard-coded 10x limit mitigates protocol risk during the testnet phase
- **Collateral floor** — 10 USDC minimum prevents dust positions
- **Oracle validation** — Noeracle Ed25519-signed prices verified on-chain; market enforces a 60s staleness check (the router relays a fresh price in the same transaction, so execution-time prices are at most seconds old)
- **Integer math only** — No floating point anywhere; all values are 7-decimal fixed-point `i128`
- **Overflow protection** — `overflow-checks = true` in the release profile
- **Emergency withdraw** — Admin-only withdrawal gated on paused state (vault)
- **API gateway in closed beta** — Bearer-key issuance is restricted to `API_KEY_ALLOWLIST` while the protocol matures. Wallet-only Soroban calls always work without a key
- **Referral economics gated to v1.1** — Until the market contract is redeployed with the `referral.record_trade` hook, the 4% referee discount and 10% referrer accrual are not applied; code registration and binding are live on-chain. Tracked as a Tranche 2 operator step
- **Responsible disclosure** — see [SECURITY.md](./SECURITY.md); report vulnerabilities privately to security@noether.exchange rather than filing a public issue

> **Testnet only. Unaudited. Use at your own risk.**
> Contracts are deployed on Stellar Testnet and have not undergone a formal audit. Do not use with mainnet funds.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## License

Distributed under the MIT License. See [`LICENSE`](./LICENSE) for the full text.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Team

| | Role | |
|---|---|---|
| **Yahya Emir Soyer** | Co-founder & CEO — Smart Contracts (Soroban/Rust) | https://github.com/y4hyya |
| **Mert Cicekci** | Co-founder & CTO — Full-stack Web3, DevRel | https://github.com/merth |

### Contact & Community

- Website: [noether.exchange](https://noether.exchange)
- Twitter / X: [@Noetherdex](https://twitter.com/Noetherdex)
- Discord: [discord.gg/hmS6t2R5z](https://discord.gg/hmS6t2R5z)
- Telegram: [t.me/Noetherdex](https://t.me/Noetherdex)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Acknowledgments

- [Stellar Development Foundation](https://stellar.org) — for the grant and the ecosystem
- [Stellar Community Fund #41](https://communityfund.stellar.org/) — funding partner
- [Soroban](https://soroban.stellar.org) — Rust smart-contract platform
- [Noeracle](https://noeracle.org) — pull-based, Ed25519-signed price oracle for Stellar
- [shadcn/ui](https://ui.shadcn.com/) — UI primitives
- [TradingView lightweight-charts](https://github.com/tradingview/lightweight-charts) — charting library
- [@creit-tech/stellar-wallets-kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit) — wallet integration

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Why "Noether"?

The protocol is named after **[Emmy Noether](https://en.wikipedia.org/wiki/Emmy_Noether)** (1882–1935), one of the most important mathematicians of the 20th century. Her namesake theorem — **Noether's theorem** — proves that every continuous symmetry of a physical system corresponds to a conservation law. Symmetry under time translation gives conservation of energy; symmetry under spatial translation gives conservation of momentum. It is, quietly, one of the most consequential results in modern science.

We chose the name because we believe the same principle belongs in financial infrastructure: invariants should be **structural**, not ceremonial. In Noether, the conservation law is simple — for every long there is a short, for every profit a loss, for every deposit a claim. The protocol enforces these symmetries on-chain, where no operator, exchange, or intermediary can bend them.

Einstein called her *"the most significant creative mathematical genius thus far produced since the higher education of women began."* Noether was paid nothing for her first seven years of university teaching, was barred from a professorship in Göttingen for being a woman, fled Nazi Germany in 1933, and died two years later in the United States. Her work underpins modern physics, algebra, and topology — and, we hope, a small contribution to open financial systems.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

<div align="center">
  <sub>Built with Rust, Soroban, and mathematics on <a href="https://stellar.org">Stellar</a>.</sub>
</div>

<!-- MARKDOWN LINKS & IMAGES -->
[license-shield]: https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square
[license-url]: ./LICENSE
[stellar-shield]: https://img.shields.io/badge/Stellar-Testnet-000000?style=flat-square&logo=stellar&logoColor=white
[stellar-url]: https://stellar.org
[soroban-shield]: https://img.shields.io/badge/Built%20with-Soroban-7D00FF?style=flat-square
[soroban-built-shield]: https://img.shields.io/badge/Soroban-21.0-7D00FF?style=flat-square
[soroban-url]: https://soroban.stellar.org
[scf-shield]: https://img.shields.io/badge/Funded%20by-SCF%20%2341-0d1117?style=flat-square
[scf-url]: https://communityfund.stellar.org/
[docs-shield]: https://img.shields.io/badge/docs-docs.noether.exchange-8b5cf6?style=flat-square&logo=readthedocs&logoColor=white
[docs-url]: https://docs.noether.exchange
[npm-shield]: https://img.shields.io/npm/v/noether-sdk?style=flat-square&logo=npm&label=noether-sdk
[npm-url]: https://www.npmjs.com/package/noether-sdk
[pypi-shield]: https://img.shields.io/pypi/v/noether-sdk?style=flat-square&logo=pypi&logoColor=white&label=noether-sdk
[pypi-url]: https://pypi.org/project/noether-sdk/
[twitter-shield]: https://img.shields.io/twitter/follow/Noetherdex?style=flat-square&logo=x&logoColor=white&label=%40Noetherdex
[twitter-url]: https://twitter.com/Noetherdex
[discord-shield]: https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white
[discord-url]: https://discord.gg/hmS6t2R5z
[telegram-shield]: https://img.shields.io/badge/Telegram-Join-26A5E4?style=flat-square&logo=telegram&logoColor=white
[telegram-url]: https://t.me/Noetherdex
[rust-shield]: https://img.shields.io/badge/Rust-2021-000000?style=flat-square&logo=rust&logoColor=white
[rust-url]: https://www.rust-lang.org/
[wasm-shield]: https://img.shields.io/badge/WebAssembly-654FF0?style=flat-square&logo=webassembly&logoColor=white
[wasm-url]: https://webassembly.org/
[nextjs-shield]: https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=next.js&logoColor=white
[nextjs-url]: https://nextjs.org/
[typescript-shield]: https://img.shields.io/badge/TypeScript-5.2-3178C6?style=flat-square&logo=typescript&logoColor=white
[typescript-url]: https://www.typescriptlang.org/
[tailwind-shield]: https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white
[tailwind-url]: https://tailwindcss.com/
[react-shield]: https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black
[react-url]: https://react.dev/
[node-shield]: https://img.shields.io/badge/Node.js-18+-5FA04E?style=flat-square&logo=node.js&logoColor=white
[node-url]: https://nodejs.org/
