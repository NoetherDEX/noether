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
    <a href="https://testnet.noether.exchange/trade"><strong>Trade on Testnet »</strong></a>
    <br />
    <br />
    <a href="https://noether.exchange">Website</a>
    ·
    <a href="https://twitter.com/Noetherdex">Twitter</a>
    ·
    <a href="https://discord.gg/2BxYv6Uc">Discord</a>
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

The protocol is funded by [Stellar Community Fund #41](https://communityfund.stellar.org/) with a grant of **$86,200** delivered across three tranches. Tranche 1 (trading engine) is complete and live on testnet today.

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

- **Up to 10x leverage** on BTC-PERP, ETH-PERP, XLM-PERP
- **Isolated and cross-margin** modes — per-position collateral, or a shared pool with account-level liquidation
- **Full order suite**: Market, Limit, Stop-Limit, Stop-Loss, Take-Profit, Trailing Stop
- **Time-in-Force controls**: GTC, IOC, Post-Only, plus a Reduce-Only flag
- **Volume-based fee tiers** — 4 tiers over a 14-day rolling window, sub-basis-point precision
- **Funding rates** that auto-balance long/short open interest, applied lazily on close/liquidate
- **Keeper-executed orders** — limit, stop, and trailing orders execute on-chain without requiring you to be online

### For Liquidity Providers

- **Deposit USDC, receive NOE** — the vault's LP token (a SAC-wrapped classic Stellar asset)
- **Transparent AUM accounting**: `AUM = total_usdc + accumulated_fees − unrealized_trader_pnl`
- **Fee share** on every trade routed through the vault
- **Withdraw anytime** — burn NOE, receive pro-rata USDC at current NOE price

### For Developers

- **Fully open source** (MIT)
- **Single-command deploy** to Stellar testnet via `setup_and_deploy.sh`
- **On-chain events** — documented schemas matched exactly by the frontend parser
- **Optimized WASM** — `opt-level = "z"`, LTO, panic = abort, stripped symbols
- **Shared math crate** — fixed-point arithmetic in `noether_common`, no floating point anywhere

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Live Demo

Trade on testnet in under a minute:

1. Install [Freighter Wallet](https://freighter.app/) and switch to **Testnet**
2. Visit [testnet.noether.exchange/faucet](https://testnet.noether.exchange/faucet) and claim USDC (up to 1,000/day)
3. Head to [testnet.noether.exchange/trade](https://testnet.noether.exchange/trade) and open your first position

No signup. No KYC. No custody. Just a browser and a wallet.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Architecture

Noether consists of four Soroban smart contracts on Stellar, a Next.js trading frontend, and an autonomous keeper bot.

```
                    ┌──────────────────────────────────────────────┐
                    │              Stellar Network                 │
                    │                (Soroban)                     │
                    │                                              │
                    │  ┌──────────┐  ┌───────┐  ┌──────────────┐  │
                    │  │  Market  │◄►│ Vault │  │Oracle Adapter│  │
                    │  │ Contract │  │  (LP) │  │ (Band + DIA) │  │
                    │  └────┬─────┘  └───┬───┘  └──────┬───────┘  │
                    │       │            │             │           │
                    └───────┼────────────┼─────────────┼───────────┘
                            │            │             │
               ┌────────────┼────────────┼─────────────┼──────────┐
               │            ▼            ▼             ▼          │
               │  ┌──────────────────────────────────────────┐    │
               │  │           Stellar SDK / RPC              │    │
               │  └──────────────────────────────────────────┘    │
               │            │                        │            │
               │   ┌────────┴────────┐    ┌──────────┴─────────┐  │
               │   │  Next.js        │    │  Keeper Bot        │  │
               │   │  Frontend       │    │  (Oracle, Liq,     │  │
               │   │  (Trade UI)     │    │   Orders, Funding) │  │
               │   └────────┬────────┘    └────────────────────┘  │
               │            │                                     │
               │   ┌────────┴────────┐                            │
               │   │ Stellar         │                            │
               │   │ Wallets Kit     │                            │
               │   └─────────────────┘                            │
               └──────────────────────────────────────────────────┘
```

### Smart Contracts

| Contract | LOC | Purpose |
|----------|-----|---------|
| **Market** | ~2,800 | Core trading engine — isolated + cross-margin positions, advanced orders, liquidation, funding |
| **Vault** | ~990 | LP pool — USDC deposits, NOE LP token, PnL settlement with Market |
| **Oracle Adapter** | ~685 | Dual-source aggregation — Band + DIA, staleness + deviation validation, cached fallback |
| **Noether Common** | — | Shared types, error codes, fixed-point math |
| **Mock Oracle** | ~405 | SEP-0040 compatible test feed for testnet |

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
    │                             │  get_price(asset)           │
    │                             │──────────► Oracle Adapter   │
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

### Oracle Aggregation

```
  ┌──────────────┐     ┌──────────────┐
  │ Band Protocol│     │   DIA Oracle │
  │  (Primary)   │     │  (Secondary) │
  └──────┬───────┘     └──────┬───────┘
         │                    │
         ▼                    ▼
  ┌────────────────────────────────────┐
  │         Oracle Adapter             │
  │                                    │
  │  1. Fetch from both sources        │
  │  2. Check staleness (< 60s)        │
  │  3. Check deviation (< 1%)         │
  │                                    │
  │  Both valid ──► Return average     │
  │                 (confidence: 100%) │
  │                                    │
  │  One valid ───► Return that price  │
  │                 (confidence: 80%)  │
  │                                    │
  │  None valid ──► Return cached      │
  │                 or revert          │
  └────────────────────────────────────┘
```

Each price response includes `price` (i128, 7 decimals), `timestamp`, `source`, and `confidence`. Results are cached in persistent storage with TTL to survive transient oracle downtime.

### Keeper Loop

The keeper is an autonomous TypeScript bot that runs continuously, executing four phases per cycle.

```
Keeper Bot (5-second cycle)
═══════════════════════════

  Phase 1 — Oracle Updates (every 30s)
    Primary:  Reflector on-chain oracle (SEP-40, 14-decimal precision)
    Fallback: Binance REST API
    Writes to Mock Oracle contract
    50% price-change circuit breaker

  Phase 2 — Liquidation Scan (every cycle)
    Isolated:  iterate all position IDs → is_liquidatable → liquidate
    Cross:     attempt liquidate_cross_account per tracked trader

  Phase 3 — Trailing Peaks + Order Execution (every cycle)
    update_trailing_peak() for each TrailingStop order
    execute_order() for any order where should_execute_order == true
    Slippage exceeded → order cancelled, collateral refunded (reward = 0)

  Phase 4 — Funding Rate (every 1h)
    apply_funding() — stores new global rate for lazy per-position application
```

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
| Max Price Staleness | 60 seconds | Oracle adapter rejects older quotes |
| Max Position Size | $100,000 | Per position |
| Supported Pairs | BTC-PERP, ETH-PERP, XLM-PERP | |

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

Next.js 14 (App Router) · TypeScript 5.2 · Tailwind CSS · Zustand · Framer Motion · Three.js · TradingView lightweight-charts · `@stellar/stellar-sdk` 14 · `@creit-tech/stellar-wallets-kit` (Freighter + LOBSTR + WalletConnect) · Turso (libSQL) for leaderboard persistence.

### Keeper Bot
[![Node.js][node-shield]][node-url] [![TypeScript][typescript-shield]][typescript-url]

Node.js · TypeScript · `@stellar/stellar-sdk` · Reflector on-chain oracle (primary) · Binance REST (fallback).

### Infrastructure

Vercel (frontend) · Railway (keeper bot) · Stellar Testnet (RPC + Horizon).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Contract Addresses

Current testnet deployment — canonical source is [`contracts.json`](./contracts.json):

| Contract | Address |
|----------|---------|
| **Market** | `CC2HH34Q7GOMNBNPSNSQIIUSYYXLYLOOLMUY3ZTFFBLJ2DENWHGS6GNB` |
| **Vault** | `CD5WYLEHTFHOKPPH2GMNUFW2MK7XIQFKI365G6CBAATYWVNPE3RFYMY3` |
| **Oracle Adapter** | `CBDH7R4PBFHMN4AER74O4RG7VHUWUMFI67UKDIY6ISNQP4H5KFKMSBS4` |
| **Mock Oracle** | `CAUGTIO44JFE3KV74OLJJHYLEGPFIZTZAXVF5BBY6WNUAUHHEO4JCGIH` |
| **USDC Token** | `CA63EPM4EEXUVUANF6FQUJEJ37RWRYIXCARWFXYUMPP7RLZWFNLTVNR4` |
| **NOE Token** | `CD7VRBXIDYP2C2F2AZZL242GY4PRDVDH2BG3LAN2ASXYUXCPHWQJTDP5` |
| **Admin** | `GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN` |

**NOE asset:** code `NOE`, issuer = Admin address.

### External Oracle Contracts (Testnet)

| Oracle | Address |
|--------|---------|
| Band Protocol | `CBRV5ZEQSSCQ4FFO64OF46I3UASBVEJNE5C2MCFWVIXL4Z7DMD7PJJMF` |
| DIA | `CAEDPEZDRCEJCF73ASC5JGNKCIJDV2QJQSW6DJ6B74MYALBNKCJ5IFP4` |

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
│   ├── oracle_adapter/     # Dual-source price aggregation
│   ├── noether_common/     # Shared types, errors, fixed-point math
│   └── mock_oracle/        # Testnet price feed
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
│   ├── deploy_testnet.sh   # Deploy all contracts from scratch
│   ├── setup_and_deploy.sh # Full pipeline (recommended for fresh deploys)
│   ├── market.sh           # Build + deploy + init market only
│   ├── vault.sh            # Build + deploy + init vault only
│   └── fund_market.sh      # Transfer USDC to market (interactive)
├── packages/               # Tranche 2 — shared monorepo packages
│   ├── types/              # @noether/types  · domain types (Position, Order, …)
│   └── shared/             # @noether/shared · precision, contracts loader, network
├── api/                    # Tranche 2 — REST + WebSocket gateway (Fastify)
├── indexer/                # Tranche 2 — Soroban event indexer (libsql)
├── sdk-ts/                 # Tranche 2 — public TypeScript SDK
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
| Vault | `/vault` | LP interface — deposit USDC, withdraw NOE, pool stats |
| Leaderboard | `/leaderboard` | Top traders by volume and PnL (backed by Turso DB + cron) |
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

### Build & Deploy Contracts

```bash
# Build all contracts (optimized WASM)
./scripts/build_contracts.sh

# Full deploy pipeline — deploys all 4 contracts, initializes, saves addresses
./scripts/setup_and_deploy.sh

# Or per-contract (build + deploy + init)
./scripts/market.sh
./scripts/vault.sh
```

Addresses are written to both `.env` (as `NEXT_PUBLIC_*` vars) and `contracts.json` automatically.

### Environment Variables

Copy `.env.example` to `.env` and populate:

```env
# Network
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Keys
ADMIN_SECRET_KEY=S...           # Deployment + admin operations
KEEPER_SECRET_KEY=S...          # (Optional) dedicated keeper key
ORACLE_SECRET_KEY=S...          # (Optional) dedicated oracle-updater key

# Contract addresses (auto-populated by deploy scripts)
NEXT_PUBLIC_MARKET_ID=C...
NEXT_PUBLIC_VAULT_ID=C...
NEXT_PUBLIC_ORACLE_ADAPTER_ID=C...
NEXT_PUBLIC_MOCK_ORACLE_ID=C...
NEXT_PUBLIC_USDC_TOKEN_ID=C...
NEXT_PUBLIC_NOE_TOKEN_ID=C...

# Frontend-only
FAUCET_ADMIN_SECRET_KEY=S...    # Required for /faucet payments
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

### Tranche 2 — Developer Tooling & Vault Ecosystem · $25,800 · **Upcoming**

- [ ] Public REST + WebSocket APIs
- [ ] Python and TypeScript SDKs for programmatic trading
- [ ] User-created trading vaults (vault leaders earn 10% profit share)
- [ ] Multi-wallet support (Freighter, LOBSTR, xBull, Albedo, Ledger)
- [ ] On-chain referral system (10% referrer / 4% referee discount)

### Tranche 3 — Mainnet Launch · $34,480 · **Future**

- [ ] Production oracle — 5 CEX sources + Reflector/DIA/Band aggregation
- [ ] All contracts deployed to Stellar mainnet with 25x leverage
- [ ] Partial liquidation (20% initial, 30s grace period) + insurance fund
- [ ] 10+ trading pairs
- [ ] Mobile-responsive UI
- [ ] Full technical documentation

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Security

- **Authorization** — Every state-changing function calls `require_auth()` on the relevant signer (trader for trading, admin for admin ops)
- **Leverage cap** — Hard-coded 10x limit mitigates protocol risk during the testnet phase
- **Collateral floor** — 10 USDC minimum prevents dust positions
- **Oracle validation** — Dual-source (Band + DIA), 60s staleness check, 1% deviation check, cached fallback
- **Integer math only** — No floating point anywhere; all values are 7-decimal fixed-point `i128`
- **Overflow protection** — `overflow-checks = true` in the release profile
- **Emergency withdraw** — Admin-only withdrawal gated on paused state (vault)

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
| **Mert Cicekci** | Co-founder & CTO — Full-stack Web3, DevRel | https://github.com/mertcicekci0 |

### Contact & Community

- Website: [noether.exchange](https://noether.exchange)
- Twitter / X: [@Noetherdex](https://twitter.com/Noetherdex)
- Discord: [discord.gg/2BxYv6Uc](https://discord.gg/2BxYv6Uc)
- Telegram: [t.me/Noetherdex](https://t.me/Noetherdex)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Acknowledgments

- [Stellar Development Foundation](https://stellar.org) — for the grant and the ecosystem
- [Stellar Community Fund #41](https://communityfund.stellar.org/) — funding partner
- [Soroban](https://soroban.stellar.org) — Rust smart-contract platform
- [Band Protocol](https://bandprotocol.com/) + [DIA](https://www.diadata.org/) — oracle data sources
- [Reflector Network](https://reflector.network/) — on-chain price feeds used by the keeper
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
[twitter-shield]: https://img.shields.io/twitter/follow/Noetherdex?style=flat-square&logo=x&logoColor=white&label=%40Noetherdex
[twitter-url]: https://twitter.com/Noetherdex
[discord-shield]: https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white
[discord-url]: https://discord.gg/2BxYv6Uc
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
