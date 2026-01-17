#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Noether Full Setup and Deploy Script
# ═══════════════════════════════════════════════════════════════════════════════
# One-command setup for the entire Noether protocol.
#
# This script will:
#   1. Check all prerequisites
#   2. Build all smart contracts
#   3. Deploy to Stellar Testnet
#   4. Initialize all contracts
#   5. Save contract addresses
#
# Usage: ./scripts/setup_and_deploy.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════════════════════════╗"
echo "║                                                                               ║"
echo "║     _   _            _   _                                                   ║"
echo "║    | \ | | ___   ___| |_| |__   ___ _ __                                     ║"
echo "║    |  \| |/ _ \ / _ \ __| '_ \ / _ \ '__|                                    ║"
echo "║    | |\  | (_) |  __/ |_| | | |  __/ |                                       ║"
echo "║    |_| \_|\___/ \___|\__|_| |_|\___|_|                                       ║"
echo "║                                                                               ║"
echo "║               Decentralized Perpetual Exchange on Stellar                     ║"
echo "║                                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Prerequisites Check
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}[1/4] Checking Prerequisites${NC}"
echo "───────────────────────────────────────────────────────────────────────────────"

# Check Rust
echo -n "  Rust toolchain... "
if command -v rustc &> /dev/null; then
    RUST_VERSION=$(rustc --version | cut -d' ' -f2)
    echo -e "${GREEN}✓ ($RUST_VERSION)${NC}"
else
    echo -e "${RED}✗ Not found${NC}"
    echo "  Install: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# Check wasm32 target
echo -n "  wasm32 target... "
if rustup target list | grep -q "wasm32-unknown-unknown (installed)"; then
    echo -e "${GREEN}✓ installed${NC}"
else
    echo -e "${YELLOW}Installing...${NC}"
    rustup target add wasm32-unknown-unknown
    echo -e "${GREEN}✓ installed${NC}"
fi

# Check Stellar/Soroban CLI
echo -n "  Stellar CLI... "
if command -v stellar &> /dev/null; then
    CLI="stellar"
    CLI_VERSION=$($CLI version 2>/dev/null | head -1 || echo "unknown")
    echo -e "${GREEN}✓ ($CLI_VERSION)${NC}"
elif command -v soroban &> /dev/null; then
    CLI="soroban"
    CLI_VERSION=$($CLI version 2>/dev/null | head -1 || echo "unknown")
    echo -e "${GREEN}✓ ($CLI_VERSION)${NC}"
else
    echo -e "${RED}✗ Not found${NC}"
    echo "  Install: cargo install --locked stellar-cli"
    exit 1
fi

# Check .env file
echo -n "  .env configuration... "
if [ -f "$PROJECT_ROOT/.env" ]; then
    source "$PROJECT_ROOT/.env"
    if [ -n "$ADMIN_SECRET_KEY" ]; then
        echo -e "${GREEN}✓ configured${NC}"
    else
        echo -e "${RED}✗ ADMIN_SECRET_KEY not set${NC}"
        echo "  Please set ADMIN_SECRET_KEY in .env file"
        exit 1
    fi
else
    echo -e "${YELLOW}Creating from template...${NC}"
    if [ -f "$PROJECT_ROOT/.env.example" ]; then
        cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
        echo -e "${YELLOW}  Please edit .env and set ADMIN_SECRET_KEY${NC}"
        exit 1
    else
        echo -e "${RED}✗ .env.example not found${NC}"
        exit 1
    fi
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Build Contracts
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}[2/4] Building Smart Contracts${NC}"
echo "───────────────────────────────────────────────────────────────────────────────"

cd "$PROJECT_ROOT/contracts"

echo "  Compiling contracts (this may take a few minutes)..."
cargo build --release --target wasm32-unknown-unknown 2>&1 | while read line; do
    if [[ "$line" == *"Compiling"* ]]; then
        echo "    $line"
    fi
done

echo -e "${GREEN}  ✓ Build complete${NC}"
echo ""

# Optimize WASM files
echo "  Optimizing WASM files..."
WASM_DIR="$PROJECT_ROOT/contracts/target/wasm32-unknown-unknown/release"
OPTIMIZED_DIR="$PROJECT_ROOT/contracts/target/wasm"
mkdir -p "$OPTIMIZED_DIR"

for contract in mock_oracle oracle_adapter vault market; do
    if [ -f "$WASM_DIR/${contract}.wasm" ]; then
        echo -n "    $contract... "
        $CLI contract optimize --wasm "$WASM_DIR/${contract}.wasm" --wasm-out "$OPTIMIZED_DIR/${contract}.wasm" 2>/dev/null || \
            cp "$WASM_DIR/${contract}.wasm" "$OPTIMIZED_DIR/${contract}.wasm"
        SIZE=$(wc -c < "$OPTIMIZED_DIR/${contract}.wasm" | tr -d ' ')
        echo -e "${GREEN}✓ (${SIZE} bytes)${NC}"
    fi
done

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Deploy to Testnet
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}[3/4] Deploying to Stellar Testnet${NC}"
echo "───────────────────────────────────────────────────────────────────────────────"

# Use secret key directly (avoiding interactive identity prompt)
echo "  Admin: $ADMIN_PUBLIC_KEY"
SOURCE_ARG="--source-account $ADMIN_SECRET_KEY"

# Fund account using public key directly
echo -n "  Funding account... "
curl -s "https://friendbot.stellar.org?addr=$ADMIN_PUBLIC_KEY" > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || echo "already funded or error"

# Deploy contracts
echo ""
echo "  Deploying contracts..."

echo -n "    Mock Oracle... "
MOCK_ORACLE_ID=$($CLI contract deploy --wasm "$OPTIMIZED_DIR/mock_oracle.wasm" $SOURCE_ARG --network testnet 2>/dev/null)
echo -e "${GREEN}✓${NC}"

echo -n "    Oracle Adapter... "
ORACLE_ADAPTER_ID=$($CLI contract deploy --wasm "$OPTIMIZED_DIR/oracle_adapter.wasm" $SOURCE_ARG --network testnet 2>/dev/null)
echo -e "${GREEN}✓${NC}"

echo -n "    Vault... "
VAULT_ID=$($CLI contract deploy --wasm "$OPTIMIZED_DIR/vault.wasm" $SOURCE_ARG --network testnet 2>/dev/null)
echo -e "${GREEN}✓${NC}"

echo -n "    Market... "
MARKET_ID=$($CLI contract deploy --wasm "$OPTIMIZED_DIR/market.wasm" $SOURCE_ARG --network testnet 2>/dev/null)
echo -e "${GREEN}✓${NC}"

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Initialize Contracts
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${YELLOW}[4/4] Initializing Contracts${NC}"
echo "───────────────────────────────────────────────────────────────────────────────"

# Initialize Mock Oracle
echo -n "  Initializing Mock Oracle... "
$CLI contract invoke --id "$MOCK_ORACLE_ID" $SOURCE_ARG --network testnet \
    -- initialize --admin "$ADMIN_PUBLIC_KEY" >/dev/null 2>&1
echo -e "${GREEN}✓${NC}"

# Set initial price
echo -n "  Setting XLM price (\$0.15)... "
$CLI contract invoke --id "$MOCK_ORACLE_ID" $SOURCE_ARG --network testnet \
    -- set_price --asset XLM --price 1500000 >/dev/null 2>&1
echo -e "${GREEN}✓${NC}"

# Initialize Oracle Adapter
echo -n "  Initializing Oracle Adapter... "
$CLI contract invoke --id "$ORACLE_ADAPTER_ID" $SOURCE_ARG --network testnet \
    -- initialize \
    --admin "$ADMIN_PUBLIC_KEY" \
    --primary_oracle "$MOCK_ORACLE_ID" \
    --secondary_oracle "$MOCK_ORACLE_ID" \
    --max_staleness 3600 \
    --max_deviation_bps 500 >/dev/null 2>&1
echo -e "${GREEN}✓${NC}"

# For testnet, use native XLM as collateral (via Stellar Asset Contract)
echo -n "  Getting XLM SAC address... "
USDC_TOKEN_ID=$($CLI contract id asset --asset native --network testnet 2>/dev/null || $CLI contract asset id --asset native --network testnet 2>/dev/null)
echo -e "${GREEN}✓${NC}"
echo "    XLM SAC: $USDC_TOKEN_ID"

# Initialize Vault
echo -n "  Initializing Vault... "
$CLI contract invoke --id "$VAULT_ID" $SOURCE_ARG --network testnet \
    -- initialize \
    --admin "$ADMIN_PUBLIC_KEY" \
    --usdc_token "$USDC_TOKEN_ID" \
    --market_contract "$MARKET_ID" \
    --deposit_fee_bps 30 \
    --withdraw_fee_bps 30 >/dev/null 2>&1
echo -e "${GREEN}✓${NC}"

# Initialize Market (with config struct)
echo -n "  Initializing Market... "
CONFIG='{"min_collateral":100000000,"max_leverage":10,"maintenance_margin_bps":100,"liquidation_fee_bps":500,"trading_fee_bps":10,"base_funding_rate_bps":1,"max_position_size":1000000000000,"max_price_staleness":60,"max_oracle_deviation_bps":100}'
$CLI contract invoke --id "$MARKET_ID" $SOURCE_ARG --network testnet \
    -- initialize \
    --admin "$ADMIN_PUBLIC_KEY" \
    --oracle_adapter "$ORACLE_ADAPTER_ID" \
    --vault "$VAULT_ID" \
    --usdc_token "$USDC_TOKEN_ID" \
    --config "$CONFIG" >/dev/null 2>&1
echo -e "${GREEN}✓${NC}"

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Save Results
# ═══════════════════════════════════════════════════════════════════════════════

# Update .env
cat >> "$PROJECT_ROOT/.env" << EOF

# Deployed Contracts ($(date '+%Y-%m-%d %H:%M:%S'))
NEXT_PUBLIC_MOCK_ORACLE_ID=$MOCK_ORACLE_ID
NEXT_PUBLIC_ORACLE_ADAPTER_ID=$ORACLE_ADAPTER_ID
NEXT_PUBLIC_VAULT_ID=$VAULT_ID
NEXT_PUBLIC_MARKET_ID=$MARKET_ID
NEXT_PUBLIC_USDC_TOKEN_ID=$USDC_TOKEN_ID
EOF

# Create contracts.json
cat > "$PROJECT_ROOT/contracts.json" << EOF
{
  "network": "testnet",
  "deployedAt": "$(date -Iseconds)",
  "contracts": {
    "mockOracle": "$MOCK_ORACLE_ID",
    "oracleAdapter": "$ORACLE_ADAPTER_ID",
    "vault": "$VAULT_ID",
    "market": "$MARKET_ID",
    "usdcToken": "$USDC_TOKEN_ID"
  },
  "admin": "$ADMIN_PUBLIC_KEY"
}
EOF

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${GREEN}"
echo "╔═══════════════════════════════════════════════════════════════════════════════╗"
echo "║                        Deployment Successful! 🎉                               ║"
echo "╚═══════════════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "${CYAN}Contract Addresses:${NC}"
echo "  ┌─────────────────┬──────────────────────────────────────────────────────────┐"
echo "  │ Mock Oracle     │ $MOCK_ORACLE_ID"
echo "  │ Oracle Adapter  │ $ORACLE_ADAPTER_ID"
echo "  │ Vault           │ $VAULT_ID"
echo "  │ Market          │ $MARKET_ID"
echo "  │ USDC Token      │ $USDC_TOKEN_ID"
echo "  └─────────────────┴──────────────────────────────────────────────────────────┘"
echo ""
echo -e "${CYAN}Admin Address:${NC} $ADMIN_PUBLIC_KEY"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "  1. Start the frontend:"
echo "     ${BLUE}cd web && npm install && npm run dev${NC}"
echo ""
echo "  2. Start the keeper bot:"
echo "     ${BLUE}cd scripts/keeper && npm install && npm start${NC}"
echo ""
echo "  3. Open your browser to http://localhost:3000"
echo ""
echo "  Contract addresses have been saved to:"
echo "    - .env (for frontend)"
echo "    - contracts.json (for programmatic access)"
echo ""
