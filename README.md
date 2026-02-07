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

**Noether** is a decentralized perpetual futures exchange (PerpDEX) built on the [Stellar](https://stellar.org) blockchain using [Soroban](https://soroban.stellar.org) smart contracts. Traders can open leveraged long and short positions on crypto assets without expiry dates, while liquidity providers earn yield by supplying capital to the protocol.

Named after [Emmy Noether](https://en.wikipedia.org/wiki/Emmy_Noether), the brilliant mathematician whose theorem on symmetry and conservation laws revolutionized physics, our protocol aims to bring the same elegance and mathematical rigor to decentralized derivatives trading on Stellar.

### Why Stellar?

- **Speed**: Near-instant finality (~5 second block times)
- **Low Fees**: Fraction of a cent per transaction
- **Soroban**: Modern, Rust-based smart contract platform with first-class safety guarantees
- **Ecosystem**: Growing DeFi ecosystem with native USDC support

### Why Noether?

- **Non-Custodial**: Your funds remain under your control at all times
- **Transparent**: All trades and positions are on-chain and verifiable
- **Capital Efficient**: LP-style liquidity model maximizes capital utilization
- **Real-Time Data**: Live price charts and global trade activity feed

---

## Features

### For Traders

| Feature | Description |
|---------|-------------|
| **Perpetual Contracts** | Trade without expiry dates - hold positions as long as you want |
| **Up to 10x Leverage** | Amplify your trading positions with controlled risk |
| **Long & Short** | Profit from both rising and falling markets |
| **Multiple Assets** | Trade BTC, ETH, and XLM perpetuals |
| **Real-Time Charts** | Live candlestick charts with multiple timeframes (1m, 5m, 15m, 1H, 4H, 1D) |
| **Recent Trades Feed** | See all global trading activity in real-time |
| **Trade History** | Track your personal trading history with PnL |
| **Position Management** | Monitor open positions with live PnL updates |

### For Liquidity Providers

| Feature | Description |
|---------|-------------|
| **NOE Token** | Receive NOE tokens representing your share of the liquidity pool |
| **Earn Yield** | Earn from trading fees and protocol activity |
| **Proportional Shares** | Fair distribution based on your contribution |
| **Flexible Withdrawals** | Withdraw your liquidity at any time |
| **Trustline Management** | Easy one-click trustline setup for NOE token |
| **Transaction History** | Track all your deposits and withdrawals |

### Protocol Features

| Feature | Description |
|---------|-------------|
| **Oracle System** | Reliable price feeds for accurate trading |
| **Auto Oracle Updates** | Automated price synchronization script |
| **Liquidation Engine** | Automated position health monitoring |
| **Test Faucet** | Get test USDC for trading (up to 1,000/day on testnet) |

---

## Trading Parameters

| Parameter | Value |
|-----------|-------|
| Minimum Collateral | 10 USDC |
| Maximum Leverage | 10x |
| Trading Fee | 0.1% |
| Liquidation Fee | 5% |
| Precision | 7 decimals |

---

## Supported Assets

| Asset | Description | Trading Pair |
|-------|-------------|--------------|
| **BTC** | Bitcoin | BTC/USD |
| **ETH** | Ethereum | ETH/USD |
| **XLM** | Stellar Lumens | XLM/USD |

---

## How It Works

### Trading Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Trader    │────▶│   Market    │────▶│   Vault     │
│             │     │  Contract   │     │  (LP Pool)  │
└─────────────┘     └──────┬──────┘     └─────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │   Oracle    │
                   │   Adapter   │
                   └─────────────┘
```

1. **Open Position**: Trader deposits USDC collateral and specifies asset, direction (long/short), and leverage
2. **Price Fetching**: Market contract queries the Oracle for current asset prices
3. **Position Recording**: Position details are stored on-chain with entry price and liquidation price
4. **Close Position**: Trader closes position, PnL is calculated, and settlement occurs with the Vault

### Liquidity Provider Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│     LP      │────▶│   Vault     │────▶│ NOE Tokens  │
│             │     │  Contract   │     │  (Receipt)  │
└─────────────┘     └─────────────┘     └─────────────┘
```

1. **Add Trustline**: LP adds NOE token trustline (one-time setup)
2. **Deposit**: LP deposits USDC into the Vault
3. **Mint NOE**: Receives NOE tokens proportional to their share of the pool
4. **Earn Yield**: Earn from trading fees and protocol activity
5. **Withdraw**: Burn NOE tokens to receive USDC based on current pool value

---

## Architecture

Noether consists of smart contracts and a web frontend:

```
noether/
├── contracts/                 # Soroban Smart Contracts (Rust)
│   ├── market/               # Trading engine & position management
│   ├── vault/                # NOE liquidity pool
│   ├── oracle_adapter/       # Oracle integration
│   ├── mock_oracle/          # Testing oracle
│   └── noether_common/       # Shared types & utilities
│
├── web/                       # Trading Interface (Next.js)
│   ├── app/                  # Next.js app router pages
│   │   ├── trade/           # Trading page
│   │   ├── vault/           # Liquidity provider page
│   │   └── faucet/          # Test USDC faucet
│   ├── components/          # React components
│   │   ├── trading/         # Chart, OrderPanel, RecentTrades, etc.
│   │   ├── vault/           # LP components
│   │   └── ui/              # Reusable UI primitives
│   ├── lib/                 # Utilities and hooks
│   │   ├── stellar/         # Blockchain interactions
│   │   ├── hooks/           # React hooks
│   │   └── store/           # Zustand state
│   └── scripts/             # Oracle update scripts
│
└── shared/                    # Shared Libraries
    └── types/                # Common data structures
```

### Smart Contracts (Testnet)

| Contract | Address | Purpose |
|----------|---------|---------|
| **Market** | `CBBSM4FYZZN4ONAV3JMHLW6S5BRKUXKARTF77SKRJ4GC4IIJGFL6SN6O` | Trading engine - position management |
| **Vault** | `CD5WYLEHTFHOKPPH2GMNUFW2MK7XIQFKI365G6CBAATYWVNPE3RFYMY3` | LP pool - manages deposits & settlements |
| **Oracle Adapter** | `CBDH7R4PBFHMN4AER74O4RG7VHUWUMFI67UKDIY6ISNQP4H5KFKMSBS4` | Price feed aggregation |
| **USDC Token** | `CA63EPM4EEXUVUANF6FQUJEJ37RWRYIXCARWFXYUMPP7RLZWFNLTVNR4` | Collateral token |
| **NOE Token** | `CD7VRBXIDYP2C2F2AZZL242GY4PRDVDH2BG3LAN2ASXYUXCPHWQJTDP5` | Liquidity provider token |

### Technology Stack

**Smart Contracts**
- Rust + Soroban SDK
- WASM compilation target

**Frontend**
- Next.js 14 with App Router
- TypeScript
- Tailwind CSS
- Zustand (state management)
- TanStack React Query
- Freighter Wallet integration
- Stellar SDK
- Lightweight Charts (TradingView)

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Freighter Wallet](https://freighter.app/) (browser extension)
- For contract development: [Rust](https://rustup.rs/) + [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/noether.git
cd noether

# Install frontend dependencies
cd web
npm install
```

### Configuration

Create a `.env.local` file in the `web/` directory:

```env
# Admin key for faucet operations
FAUCET_ADMIN_SECRET_KEY=S...

# Optional: Override contract addresses
NEXT_PUBLIC_MARKET_ID=CBBSM4FYZZN4ONAV3JMHLW6S5BRKUXKARTF77SKRJ4GC4IIJGFL6SN6O
NEXT_PUBLIC_VAULT_ID=CD5WYLEHTFHOKPPH2GMNUFW2MK7XIQFKI365G6CBAATYWVNPE3RFYMY3
```

### Running the Application

```bash
cd web

# Start the frontend development server
npm run dev

# In a separate terminal, start the oracle price updater
npm run oracle:auto
```

Visit `http://localhost:3000` to access the trading interface.

### Pages

| Page | URL | Description |
|------|-----|-------------|
| **Landing** | `/` | Introduction and overview |
| **Trade** | `/trade` | Main trading interface with charts, order panel, positions |
| **Vault** | `/vault` | Liquidity provider interface - deposit/withdraw |
| **Faucet** | `/faucet` | Get test USDC (up to 1,000/day) |

---

## Roadmap

### Phase 1: Foundation ✅
- [x] Smart contract architecture
- [x] Core trading engine
- [x] Vault/LP system with NOE token

### Phase 2: Core Protocol ✅
- [x] Market contract with position management
- [x] Vault contract with LP model
- [x] Oracle adapter integration
- [x] Testnet deployment

### Phase 3: Frontend ✅
- [x] Trading interface with real-time charts
- [x] Position management
- [x] Recent Trades feed (global activity)
- [x] Trade History (personal)
- [x] Vault page for LPs
- [x] Faucet for test tokens
- [x] Freighter wallet integration

### Phase 4: Enhancement (In Progress)
- [x] Limit orders and stop-loss
- [ ] Advanced order types
- [ ] Mobile-responsive improvements
- [ ] Additional trading pairs

### Phase 5: Production
- [ ] Security audits
- [ ] Mainnet deployment
- [ ] Governance features

---

## Security

Noether implements multiple layers of security:

- **Authorization Checks**: All sensitive operations require proper authentication
- **Leverage Limits**: Maximum 10x leverage to manage risk
- **Collateral Requirements**: Minimum 10 USDC collateral per position
- **Oracle Safeguards**: Price validation and staleness checks
- **Admin Controls**: Protected initialization and configuration functions

> **Note**: This project is currently deployed on Stellar Testnet. Smart contracts have not been audited. Use at your own risk.

---

## License

MIT

---

<p align="center">
  <sub>Built with Rust and Soroban on Stellar</sub>
</p>
