<p align="center">
  <h1 align="center">Noether</h1>
  <p align="center">
    <strong>Decentralized Perpetual Exchange on Stellar</strong>
  </p>
  <p align="center">
    Trade crypto perpetuals with up to 10x leverage, powered by Soroban smart contracts
  </p>
</p>

<p align="center">
  <a href="#overview">Overview</a> •
  <a href="#features">Features</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#roadmap">Roadmap</a>
</p>

---

## Overview

**Noether** is a next-generation perpetual decentralized exchange (PerpDex) built on the [Stellar](https://stellar.org) blockchain using the [Soroban](https://soroban.stellar.org) smart contract platform. Inspired by the GMX protocol model, Noether enables traders to open leveraged long and short positions on crypto assets without expiry dates, while liquidity providers earn yield by supplying capital to the protocol.

Named after [Emmy Noether](https://en.wikipedia.org/wiki/Emmy_Noether), the brilliant mathematician whose theorem on symmetry and conservation laws revolutionized physics, our protocol aims to bring the same elegance and mathematical rigor to decentralized derivatives trading on Stellar.

### Why Stellar?

- **Speed**: Near-instant finality (~5 second block times)
- **Low Fees**: Fraction of a cent per transaction
- **Soroban**: Modern, Rust-based smart contract platform with first-class safety guarantees
- **Ecosystem**: Growing DeFi ecosystem with native USDC support

### Why Noether?

- **Non-Custodial**: Your funds remain under your control at all times
- **Transparent**: All trades and positions are on-chain and verifiable
- **Capital Efficient**: GLP-style liquidity model maximizes capital utilization
- **Oracle Secured**: Dual oracle integration (Band + DIA) for reliable price feeds

---

## Features

### For Traders

| Feature | Description |
|---------|-------------|
| **Perpetual Contracts** | Trade without expiry dates - hold positions as long as you want |
| **Up to 10x Leverage** | Amplify your trading positions with controlled risk |
| **Long & Short** | Profit from both rising and falling markets |
| **Market Orders** | Instant execution at current oracle prices |
| **Position Averaging** | Add to existing positions seamlessly |
| **Real-Time PnL** | Track your profits and losses in real-time |

### For Liquidity Providers

| Feature | Description |
|---------|-------------|
| **GLP Token** | Receive GLP tokens representing your share of the liquidity pool |
| **Earn Yield** | Earn from trader losses and protocol fees |
| **Proportional Shares** | Fair distribution based on your contribution |
| **Flexible Withdrawals** | Withdraw your liquidity at any time |

### Protocol Features

| Feature | Description |
|---------|-------------|
| **Dual Oracle System** | Band Protocol + DIA oracles for price reliability |
| **Funding Rates** | Automatic balancing mechanism for long/short positions |
| **Liquidation Engine** | Automated keeper bot for position health monitoring |
| **Price Deviation Protection** | Built-in safeguards against oracle manipulation |

---

## How It Works

### Trading Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Trader    │────▶│   Market    │────▶│   Vault     │
│             │     │  Contract   │     │  (GLP Pool) │
└─────────────┘     └──────┬──────┘     └─────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │   Oracle    │
                   │   Adapter   │
                   └──────┬──────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
       ┌─────────────┐         ┌─────────────┐
       │    Band     │         │     DIA     │
       │   Oracle    │         │   Oracle    │
       └─────────────┘         └─────────────┘
```

1. **Open Position**: Trader deposits USDC collateral and specifies position size, direction (long/short), and leverage
2. **Price Fetching**: Market contract queries the Oracle Adapter for current asset prices
3. **Position Recording**: Position details are stored on-chain with entry price and liquidation price
4. **Close Position**: Trader closes position, PnL is calculated, and settlement occurs with the Vault

### Liquidity Provider Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│     LP      │────▶│   Vault     │────▶│ GLP Tokens  │
│             │     │  Contract   │     │  (Receipt)  │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │
       │    USDC           │    Proportional
       │    Deposit        │    Share Calculation
       ▼                   ▼
┌─────────────────────────────────────────────────────┐
│                   Liquidity Pool                     │
│                                                      │
│   AUM = Total USDC - Aggregate Trader PnL           │
│                                                      │
└─────────────────────────────────────────────────────┘
```

1. **Deposit**: LP deposits USDC into the Vault
2. **Mint GLP**: Receives GLP tokens proportional to their share of the pool
3. **Earn Yield**: When traders lose, LPs profit (and vice versa)
4. **Withdraw**: Burn GLP tokens to receive USDC based on current AUM

---

## Architecture

Noether is structured as a monorepo with clear separation of concerns:

```
noether/
├── contracts/                 # Soroban Smart Contracts (Rust)
│   ├── market/               # Trading engine & position management
│   ├── vault/                # GLP liquidity pool
│   ├── oracle_adapter/       # Band & DIA oracle integration
│   ├── mock_oracle/          # Testing oracle
│   └── noether_common/       # Shared types & utilities
│
├── frontend/                  # Trading Interface (Next.js)
│   ├── components/           # UI components (Radix UI)
│   ├── lib/                  # Contract interaction logic
│   └── app/                  # Next.js app router
│
├── scripts/                   # Deployment & Operations
│   ├── setup_and_deploy.sh   # Automated deployment
│   └── keeper.ts             # Liquidation bot
│
└── shared/                    # Shared Libraries
    ├── types/                # Common data structures
    └── errors/               # Error definitions
```

### Smart Contracts

| Contract | Purpose |
|----------|---------|
| **Market** | Core trading engine - handles position opens, closes, and PnL calculation |
| **Vault** | GLP-style liquidity pool - manages LP deposits and trader settlements |
| **Oracle Adapter** | Aggregates prices from Band and DIA oracles with safety checks |
| **Common** | Shared types, traits, and utilities used across contracts |

### Technology Stack

**Smart Contracts**
- Rust + Soroban SDK
- WASM compilation target
- Optimized for minimal contract size

**Frontend**
- Next.js 16 with App Router
- Tailwind CSS + Radix UI
- Freighter Wallet integration
- Stellar SDK

---

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup)
- [Node.js](https://nodejs.org/) (v18+)
- [Freighter Wallet](https://freighter.app/) (browser extension)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/noether.git
cd noether

# Build smart contracts
cargo build --workspace

# Install frontend dependencies
cd frontend && npm install
```

### Configuration

Create a `.env` file in the root directory:

```env
ADMIN_SECRET_KEY=S...           # Your Stellar secret key
ADMIN_PUBLIC_KEY=G...           # Your Stellar public key
NETWORK=testnet                 # Network (testnet/mainnet)
RPC_URL=https://soroban-testnet.stellar.org
```

### Deployment

```bash
# Automated full deployment
./scripts/setup_and_deploy.sh
```

### Run Frontend

```bash
cd frontend
npm run dev
```

Visit `http://localhost:3000` to access the trading interface.

---

## Supported Assets

| Asset | Description | Trading Pair |
|-------|-------------|--------------|
| **XLM** | Stellar Lumens | XLM/USD |
| **USDC** | USD Coin | USDC/USD |

*More assets coming soon*

---

## Roadmap

### Phase 1: Foundation 
- [ ] Monorepo architecture
- [ ] Core smart contract development
- [ ] Shared type system and error handling

### Phase 2: Core Protocol 
- [ ] Market contract with position management
- [ ] Vault contract with GLP model
- [ ] Oracle adapter with Band + DIA integration
- [ ] Automated deployment scripts

### Phase 3: Operations 
- [ ] Testnet deployment
- [ ] Liquidation keeper bot
- [ ] Frontend trading interface

### Phase 4: Enhancement (In Progress)
- [ ] Additional trading pairs
- [ ] Limit orders and stop-loss
- [ ] Advanced order types
- [ ] Mobile-responsive UI improvements

### Phase 5: Production
- [ ] Security audits
- [ ] Mainnet deployment
- [ ] Governance token
- [ ] DAO structure

---

## Security

Noether implements multiple layers of security:

- **Authorization Checks**: All sensitive operations require proper authentication
- **Leverage Limits**: Maximum 20x leverage to manage risk
- **Oracle Safeguards**: Price staleness and deviation checks
- **Admin Controls**: Protected initialization and configuration functions

> **Note**: This project is currently deployed on Stellar Testnet. Smart contracts have not been audited. Use at your own risk.

---

<p align="center">
  <sub>Built with Rust and Soroban on Stellar</sub>
</p>
