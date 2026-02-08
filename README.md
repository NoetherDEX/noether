<p align="center">
  <img src="web/public/images/favicon.svg" alt="Noether" height="48" />
</p>

<h3 align="center">Decentralized Perpetual Futures Exchange on Stellar</h3>

<p align="center">
  Trade crypto perpetuals with up to 10x leverage — fully on-chain, powered by Soroban smart contracts.
</p>

<p align="center">
  <a href="https://noether.exchange">Website</a> &middot;
  <a href="https://testnet.noether.exchange/trade">Trade on Testnet</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#getting-started">Getting Started</a>
</p>

---

## Overview

**Noether** is a decentralized perpetual futures exchange (PerpDEX) built on the [Stellar](https://stellar.org) blockchain using [Soroban](https://soroban.stellar.org) smart contracts. Every order, match, and settlement lives on-chain — verifiable by anyone.

Named after [Emmy Noether](https://en.wikipedia.org/wiki/Emmy_Noether), the mathematician whose theorem on symmetry and conservation laws revolutionized physics, our protocol brings mathematical rigor to decentralized derivatives trading.

### Why Stellar?

| | |
|---|---|
| **~5s Finality** | Near-instant transaction confirmation |
| **Sub-cent Fees** | Fraction of a cent per transaction |
| **Soroban** | Rust-based smart contracts with first-class safety guarantees |
| **Native USDC** | Circle-issued USDC with deep ecosystem support |

---

## Architecture

Noether's architecture consists of three Soroban smart contracts, a keeper bot for automated operations, and a Next.js trading frontend.

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
               │   │ Freighter       │                            │
               │   │ Wallet          │                            │
               │   └─────────────────┘                            │
               └──────────────────────────────────────────────────┘
```

### Smart Contracts

| Contract | Description |
|----------|-------------|
| **Market** | Core trading engine — position management, order system (limit, stop-loss, take-profit), liquidation engine, funding rate calculation |
| **Vault** | Liquidity pool — holds USDC deposits, mints/burns NOE LP token (SAC-wrapped classic asset), settles PnL with Market |
| **Oracle Adapter** | Dual-source price oracle — aggregates Band Protocol + DIA, staleness/deviation validation, cached fallback |

### Contract Addresses (Testnet)

| Contract | Address |
|----------|---------|
| Market | `CD4ZEYKAS6OICSECQDTRZU3GDIJYTJYO7UMRP6KULXPHOD6SXGNMHMMO` |
| Vault | `CD5WYLEHTFHOKPPH2GMNUFW2MK7XIQFKI365G6CBAATYWVNPE3RFYMY3` |
| Oracle Adapter | `CBDH7R4PBFHMN4AER74O4RG7VHUWUMFI67UKDIY6ISNQP4H5KFKMSBS4` |
| USDC Token | `CA63EPM4EEXUVUANF6FQUJEJ37RWRYIXCARWFXYUMPP7RLZWFNLTVNR4` |
| NOE Token | `CD7VRBXIDYP2C2F2AZZL242GY4PRDVDH2BG3LAN2ASXYUXCPHWQJTDP5` |

---

## Trading Engine

### Supported Markets

| Pair | Asset | Leverage | Min Collateral |
|------|-------|----------|----------------|
| BTC-PERP | Bitcoin | 1-10x | 10 USDC |
| ETH-PERP | Ethereum | 1-10x | 10 USDC |
| XLM-PERP | Stellar Lumens | 1-10x | 10 USDC |

### Trading Parameters

| Parameter | Value |
|-----------|-------|
| Trading Fee | 0.1% (10 bps) |
| Liquidation Fee | 5% (500 bps) |
| Maintenance Margin | 5% (500 bps) |
| Price Precision | 7 decimals |
| Max Price Staleness | 60 seconds |

### Position Lifecycle

```
  Trader                    Market Contract                   Vault
    │                             │                             │
    │  open_position(asset,       │                             │
    │  collateral, leverage, dir) │                             │
    │────────────────────────────►│                             │
    │                             │  get_price(asset)           │
    │                             │──────────► Oracle           │
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
    │                             │  = (exit - entry) * size    │
    │                             │                             │
    │                             │  settle_pnl(pnl)            │
    │                             │────────────────────────────►│
    │                             │                             │
    │  USDC returned              │                             │
    │  (collateral +/- PnL)       │                             │
    │◄────────────────────────────│                             │
```

### Order System

The Market contract supports three order types, all executed by the keeper bot when trigger conditions are met:

```
  Order Types
  ├── Limit Entry ── Opens a new position when price reaches trigger
  ├── Stop Loss ──── Closes position to cap losses at trigger price
  └── Take Profit ── Closes position to lock in gains at trigger price

  Order Lifecycle
  ┌──────────┐    keeper checks    ┌───────────┐    execute     ┌──────────┐
  │ Pending  │──────────────────►  │ Triggered │──────────────► │ Executed │
  └──────────┘    price matches    └───────────┘   on-chain     └──────────┘
       │
       │  trader cancels
       ▼
  ┌───────────┐
  │ Cancelled │
  └───────────┘
```

### Liquidation

Positions are liquidated when equity falls below maintenance margin:

```
  Liquidation Price (Long)  = entry_price * (1 - 1/leverage + maintenance_margin)
  Liquidation Price (Short) = entry_price * (1 + 1/leverage - maintenance_margin)

  Keeper Bot
    │
    │  Every ~5s: scan all positions
    │
    ├── get_liquidatable_positions(asset)
    │     │
    │     ▼
    │   For each undercollateralized position:
    │     │
    │     ├── liquidate(position_id)
    │     │     ├── Close position at current oracle price
    │     │     ├── Settle PnL with Vault
    │     │     └── Pay keeper reward (0.50 USDC + 0.05% of size)
    │     │
    │     └── Emit position_liquidated event
    │
    └── Continue monitoring...
```

### Funding Rate

Funding rates balance long/short demand. Applied every 8 hours by the keeper bot:

```
  funding_rate = base_rate * (total_long_size - total_short_size) / max(total_long_size, total_short_size)

  If funding_rate > 0: longs pay shorts
  If funding_rate < 0: shorts pay longs
```

---

## Vault System

The Vault acts as the counterparty to all trades. Liquidity providers deposit USDC and receive NOE tokens representing their share.

```
  Liquidity Provider Flow
  ═══════════════════════

  ┌────────┐   deposit USDC    ┌───────────┐   mint    ┌───────────┐
  │   LP   │──────────────────►│   Vault   │─────────► │ NOE Token │
  └────────┘                   │  Contract │           │  (SAC)    │
                               └─────┬─────┘           └───────────┘
                                     │
                         ┌───────────┴───────────┐
                         │                       │
                    Trader wins             Trader loses
                    (vault pays)           (vault receives)
                         │                       │
                         ▼                       ▼
                   Pool decreases          Pool increases
                   NOE price drops         NOE price rises


  NOE Price = AUM / Total NOE Supply
  AUM       = Total USDC + Accumulated Fees - Unrealized PnL
```

### Vault Functions

| Function | Description |
|----------|-------------|
| `deposit(amount)` | Deposit USDC, receive NOE tokens at current price |
| `withdraw(noe_amount)` | Burn NOE tokens, receive USDC at current price |
| `settle_pnl(pnl)` | Called by Market contract to settle trader P&L |
| `get_noe_price()` | Current NOE token price (7 decimal precision) |
| `get_pool_info()` | Pool stats: total USDC, total NOE, AUM, fees |

---

## Oracle System

The Oracle Adapter aggregates prices from Band Protocol and DIA with validation:

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
  │  One valid ───► Return single      │
  │                 (confidence: 80%)  │
  │                                    │
  │  None valid ──► Return cached      │
  │                 or revert          │
  └────────────────────────────────────┘
```

Each price response includes: `price` (i128, 7 decimals), `timestamp`, `source`, and `confidence` score.

---

## Keeper Bot

The keeper bot is a TypeScript service that handles automated protocol operations:

```
  Keeper Bot (runs continuously)
  ══════════════════════════════

  Every ~5 seconds:
  ┌─────────────────────────────────────────────┐
  │                                             │
  │  1. Oracle Updates                          │
  │     Fetch BTC/ETH/XLM prices from Binance   │
  │     Push to Oracle Adapter contract          │
  │                                             │
  │  2. Liquidation Scan                        │
  │     Check all positions for undercollateral  │
  │     Liquidate unhealthy positions            │
  │                                             │
  │  3. Order Execution                         │
  │     Check pending limit/SL/TP orders         │
  │     Execute orders where trigger is met      │
  │                                             │
  │  4. Funding Rate                            │
  │     Apply funding every 8 hours              │
  │                                             │
  └─────────────────────────────────────────────┘

  Keeper Rewards:
  ├── Liquidation: 0.50 USDC + 0.05% of position size
  └── Order Execution: 0.50 USDC + 0.05% of position size
```

---

## Tech Stack

### Smart Contracts

| | |
|---|---|
| Language | Rust (Edition 2021) |
| Runtime | Soroban SDK v21.0.0 |
| Target | WASM (optimized for size) |
| Shared | `noether_common` crate — types, errors, math |

### Frontend

| | |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5.2 |
| Styling | Tailwind CSS 3.3 |
| State | Zustand 4.5 |
| Data Fetching | TanStack React Query 5 |
| Charts | TradingView Lightweight Charts 4.2 |
| Animations | Framer Motion |
| Wallet | Freighter API |
| Blockchain | Stellar SDK 14.4 |

### Keeper Bot

| | |
|---|---|
| Runtime | Node.js (TypeScript) |
| SDK | @stellar/stellar-sdk 14.4 |
| Operations | Oracle updates, liquidations, order execution, funding rates |

---

## Project Structure

```
noether/
├── contracts/                    # Soroban Smart Contracts
│   ├── market/                  # Trading engine
│   │   └── src/
│   │       ├── lib.rs           # Contract entry points
│   │       ├── trading.rs       # Position open/close logic
│   │       ├── funding.rs       # Funding rate calculations
│   │       ├── liquidation.rs   # Liquidation engine
│   │       ├── position.rs      # Position data management
│   │       └── storage.rs       # On-chain storage helpers
│   ├── vault/                   # LP vault
│   │   └── src/
│   │       ├── lib.rs           # Deposit, withdraw, settlement
│   │       ├── storage.rs       # Pool state management
│   │       └── noe.rs           # NOE token operations
│   ├── oracle_adapter/          # Price oracle
│   │   └── src/
│   │       ├── lib.rs           # Aggregation + validation
│   │       └── external.rs      # Band/DIA integration
│   ├── noether_common/          # Shared library
│   │   └── src/
│   │       ├── types.rs         # Position, Order, Config structs
│   │       ├── errors.rs        # NoetherError enum
│   │       └── math.rs          # Fixed-point arithmetic
│   └── mock_oracle/             # Testing oracle
│
├── web/                          # Next.js Frontend
│   ├── app/
│   │   ├── trade/               # Trading interface
│   │   ├── vault/               # LP deposit/withdraw
│   │   ├── portfolio/           # Position management
│   │   ├── leaderboard/         # Trader rankings
│   │   ├── faucet/              # Testnet USDC faucet
│   │   └── api/                 # API routes (leaderboard, faucet)
│   ├── components/
│   │   ├── trading/             # Chart, OrderPanel, OrderBook, RecentTrades
│   │   ├── vault/               # DepositPanel, WithdrawPanel, PoolStats
│   │   ├── portfolio/           # PositionList, TradeHistory
│   │   ├── landing/             # Hero, Navbar, FlagshipSection
│   │   ├── wallet/              # WalletConnect, WalletProvider
│   │   └── ui/                  # Button, Card, Modal, Tabs, etc.
│   ├── lib/
│   │   ├── stellar/             # Soroban client, contract wrappers
│   │   ├── hooks/               # useWallet, usePriceData
│   │   ├── store/               # walletStore, tradeStore (Zustand)
│   │   └── utils/               # constants, formatting
│   └── public/                  # Static assets
│
├── scripts/
│   ├── keeper/                  # Keeper Bot (TypeScript)
│   │   └── src/
│   │       ├── index.ts         # Main loop
│   │       ├── stellar.ts       # Soroban transaction helpers
│   │       └── config.ts        # Configuration
│   ├── build_contracts.sh       # Build WASM artifacts
│   ├── deploy_testnet.sh        # Deploy to Stellar Testnet
│   └── setup_and_deploy.sh      # Full setup + deployment
│
└── contracts.json                # Deployed contract addresses
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Freighter Wallet](https://freighter.app/) browser extension
- For contract development: [Rust](https://rustup.rs/) + [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup)

### Run the Frontend

```bash
git clone https://github.com/NoetherDEX/noether.git
cd noether/web
npm install
npm run dev
```

Visit `http://localhost:3000` to access the trading interface.

### Run the Keeper Bot

```bash
cd scripts/keeper
npm install
cp .env.example .env    # Configure your keeper keypair
npm run dev
```

### Environment Variables

Create `web/.env.local`:

```env
FAUCET_ADMIN_SECRET_KEY=S...     # Admin key for faucet operations
```

Contract addresses are hardcoded in `web/lib/utils/constants.ts` and can be overridden via `NEXT_PUBLIC_*` env vars.

### Build Contracts

```bash
# Install Soroban CLI
cargo install --locked soroban-cli

# Build all contracts
cd contracts
cargo build --target wasm32-unknown-unknown --release

# Or use the script
./scripts/build_contracts.sh
```

---

## Pages

| Page | Path | Description |
|------|------|-------------|
| Landing | `/` | Protocol overview with live trading screenshot |
| Trade | `/trade` | Full trading interface — chart, order panel, order book, recent trades |
| Portfolio | `/portfolio` | Open positions, trade history, PnL tracking |
| Vault | `/vault` | LP interface — deposit USDC, withdraw NOE, pool stats |
| Leaderboard | `/leaderboard` | Top traders by volume and PnL |
| Faucet | `/faucet` | Get testnet USDC (up to 1,000/day) |

---

## Security

- **Authorization**: All state-changing functions require `require_auth()` from the caller
- **Leverage Limits**: Capped at 10x to manage protocol risk
- **Collateral Minimum**: 10 USDC floor prevents dust positions
- **Oracle Validation**: Staleness checks (60s max), deviation checks (1% max), dual-source aggregation
- **Pause Mechanism**: Admin can pause/unpause Market and Vault contracts independently
- **Emergency Withdraw**: Admin-only withdrawal when contract is paused

> **Note**: Contracts are deployed on Stellar Testnet and have not been audited. Use at your own risk.

---

## License

MIT

---

<p align="center">
  <sub>Built with Rust and Soroban on Stellar</sub>
</p>
