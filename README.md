# Noether - Soroban Perpetual DEX

A GMX-style Perpetual DEX built on Stellar Futurenet using the Soroban SDK.

## Architecture

This is a monorepo containing:

- **Contracts** (`contracts/`): Rust smart contracts using Soroban SDK
- **Frontend** (`frontend/`): Next.js + TypeScript + Tailwind CSS
- **Shared** (`shared/`): Shared types and error definitions

## Development

### Contracts

```bash
# Build all contracts
cargo build --workspace

# Test all contracts
cargo test --workspace

# Build optimized WASM
cd contracts/<contract-name>
soroban contract build
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Roadmap

### Phase 1: Foundation ✅
- [x] Workspace structure
- [x] Cargo workspace setup
- [x] Shared libraries for types/errors

### Phase 2: Core Contracts (In Progress)
- [ ] Vault contract (GLP-style liquidity pool)
- [ ] Position manager contract
- [ ] Oracle adapter contract
- [ ] Fee collector contract

### Phase 3: Frontend
- [ ] Wallet integration (Freighter)
- [ ] Trading interface
- [ ] Position management UI
- [ ] Liquidity provider interface

## License

MIT
