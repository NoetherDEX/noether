#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Noether Testnet Deployment Script
# ═══════════════════════════════════════════════════════════════════════════════
# Deploys all Noether contracts to Stellar Testnet.
#
# Prerequisites:
#   - Build contracts first: ./scripts/build_contracts.sh
#   - Set up .env file with ADMIN_SECRET_KEY
#
# Usage: ./scripts/deploy_testnet.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WASM_DIR="$PROJECT_ROOT/contracts/target/wasm"

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                    Noether Testnet Deployment                                  ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Load environment
if [ -f "$PROJECT_ROOT/.env" ]; then
    export $(cat "$PROJECT_ROOT/.env" | grep -v '^#' | xargs)
else
    echo -e "${RED}Error: .env file not found. Please copy .env.example to .env and configure it.${NC}"
    exit 1
fi

# Validate required variables
if [ -z "$ADMIN_SECRET_KEY" ]; then
    echo -e "${RED}Error: ADMIN_SECRET_KEY not set in .env${NC}"
    exit 1
fi

# Use stellar CLI if available
if command -v stellar &> /dev/null; then
    CLI="stellar"
else
    CLI="soroban"
fi

# Network configuration
NETWORK="testnet"
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

echo -e "${YELLOW}Configuration:${NC}"
echo "  Network: $NETWORK"
echo "  RPC URL: $RPC_URL"
echo ""

# Check WASM files exist
echo -e "${YELLOW}Checking WASM files...${NC}"
for contract in mock_oracle oracle_adapter vault market; do
    if [ ! -f "$WASM_DIR/${contract}.wasm" ]; then
        echo -e "${RED}Error: $contract.wasm not found. Run ./scripts/build_contracts.sh first.${NC}"
        exit 1
    fi
done
echo -e "${GREEN}✓ All WASM files present${NC}"
echo ""

# Create identity if not exists
IDENTITY="noether_admin"
echo -e "${YELLOW}Setting up identity: $IDENTITY${NC}"
$CLI keys add "$IDENTITY" --secret-key "$ADMIN_SECRET_KEY" 2>/dev/null || true
ADMIN_PUBLIC_KEY=$($CLI keys address "$IDENTITY")
echo "  Admin address: $ADMIN_PUBLIC_KEY"
echo ""

# Fund account if needed (testnet only)
echo -e "${YELLOW}Checking account balance...${NC}"
$CLI keys fund "$IDENTITY" --network testnet 2>/dev/null || echo "Account already funded or funding not available"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Deploy Contracts
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}                         Deploying Contracts                                    ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# 1. Deploy Mock Oracle (for testing)
echo -e "${YELLOW}[1/4] Deploying Mock Oracle...${NC}"
MOCK_ORACLE_ID=$($CLI contract deploy \
    --wasm "$WASM_DIR/mock_oracle.wasm" \
    --source "$IDENTITY" \
    --network testnet)
echo -e "${GREEN}✓ Mock Oracle deployed: $MOCK_ORACLE_ID${NC}"

# Initialize Mock Oracle
echo "  Initializing Mock Oracle..."
$CLI contract invoke \
    --id "$MOCK_ORACLE_ID" \
    --source "$IDENTITY" \
    --network testnet \
    -- initialize \
    --admin "$ADMIN_PUBLIC_KEY"
echo -e "${GREEN}✓ Mock Oracle initialized${NC}"

# Set initial XLM price ($0.15)
echo "  Setting initial XLM price..."
$CLI contract invoke \
    --id "$MOCK_ORACLE_ID" \
    --source "$IDENTITY" \
    --network testnet \
    -- set_price \
    --asset XLM \
    --price 1500000
echo -e "${GREEN}✓ XLM price set to \$0.15${NC}"
echo ""

# 2. Deploy Oracle Adapter
echo -e "${YELLOW}[2/4] Deploying Oracle Adapter...${NC}"
ORACLE_ADAPTER_ID=$($CLI contract deploy \
    --wasm "$WASM_DIR/oracle_adapter.wasm" \
    --source "$IDENTITY" \
    --network testnet)
echo -e "${GREEN}✓ Oracle Adapter deployed: $ORACLE_ADAPTER_ID${NC}"

# Initialize Oracle Adapter (using mock oracle as both primary and secondary for testnet)
echo "  Initializing Oracle Adapter..."
$CLI contract invoke \
    --id "$ORACLE_ADAPTER_ID" \
    --source "$IDENTITY" \
    --network testnet \
    -- initialize \
    --admin "$ADMIN_PUBLIC_KEY" \
    --primary_oracle "$MOCK_ORACLE_ID" \
    --secondary_oracle "$MOCK_ORACLE_ID" \
    --max_staleness 3600 \
    --max_deviation_bps 500
echo -e "${GREEN}✓ Oracle Adapter initialized${NC}"
echo ""

# 3. Deploy Vault
echo -e "${YELLOW}[3/4] Deploying Vault...${NC}"
VAULT_ID=$($CLI contract deploy \
    --wasm "$WASM_DIR/vault.wasm" \
    --source "$IDENTITY" \
    --network testnet)
echo -e "${GREEN}✓ Vault deployed: $VAULT_ID${NC}"
echo ""

# 4. Deploy Market
echo -e "${YELLOW}[4/4] Deploying Market...${NC}"
MARKET_ID=$($CLI contract deploy \
    --wasm "$WASM_DIR/market.wasm" \
    --source "$IDENTITY" \
    --network testnet)
echo -e "${GREEN}✓ Market deployed: $MARKET_ID${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Initialize Remaining Contracts
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}                      Initializing Contracts                                    ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Deploy a test USDC token (for testnet)
echo -e "${YELLOW}Deploying test USDC token...${NC}"
# For testnet, we'll use the native asset as a placeholder
# In production, this would be the official USDC token
USDC_TOKEN_ID="${USDC_TOKEN_ID:-$($CLI contract asset deploy --asset native --source $IDENTITY --network testnet 2>/dev/null || echo 'NATIVE')}"
echo -e "${GREEN}✓ USDC Token: $USDC_TOKEN_ID${NC}"
echo ""

# Initialize Vault
echo -e "${YELLOW}Initializing Vault...${NC}"
$CLI contract invoke \
    --id "$VAULT_ID" \
    --source "$IDENTITY" \
    --network testnet \
    -- initialize \
    --admin "$ADMIN_PUBLIC_KEY" \
    --usdc_token "$USDC_TOKEN_ID" \
    --market_contract "$MARKET_ID" \
    --deposit_fee_bps 30 \
    --withdraw_fee_bps 30
echo -e "${GREEN}✓ Vault initialized${NC}"
echo ""

# Initialize Market
echo -e "${YELLOW}Initializing Market...${NC}"

# Market config in JSON format for complex struct
CONFIG='{
    "min_collateral": 100000000,
    "max_leverage": 10,
    "maintenance_margin_bps": 100,
    "liquidation_fee_bps": 500,
    "trading_fee_bps": 10,
    "base_funding_rate_bps": 1,
    "max_position_size": 1000000000000,
    "max_price_staleness": 60,
    "max_oracle_deviation_bps": 100
}'

$CLI contract invoke \
    --id "$MARKET_ID" \
    --source "$IDENTITY" \
    --network testnet \
    -- initialize \
    --admin "$ADMIN_PUBLIC_KEY" \
    --oracle_adapter "$ORACLE_ADAPTER_ID" \
    --vault "$VAULT_ID" \
    --usdc_token "$USDC_TOKEN_ID" \
    --config "$CONFIG"
echo -e "${GREEN}✓ Market initialized${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Save Contract IDs
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}                       Saving Contract IDs                                      ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Create/update .env with contract IDs
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
cat >> "$PROJECT_ROOT/.env" << EOF

# ═══════════════════════════════════════════════════════════════════════════════
# Deployed Contract IDs - $TIMESTAMP
# ═══════════════════════════════════════════════════════════════════════════════
NEXT_PUBLIC_MOCK_ORACLE_ID=$MOCK_ORACLE_ID
NEXT_PUBLIC_ORACLE_ADAPTER_ID=$ORACLE_ADAPTER_ID
NEXT_PUBLIC_VAULT_ID=$VAULT_ID
NEXT_PUBLIC_MARKET_ID=$MARKET_ID
NEXT_PUBLIC_USDC_TOKEN_ID=$USDC_TOKEN_ID
EOF

echo -e "${GREEN}Contract IDs saved to .env${NC}"
echo ""

# Also create a contracts.json for easy programmatic access
cat > "$PROJECT_ROOT/contracts.json" << EOF
{
  "network": "testnet",
  "deployedAt": "$TIMESTAMP",
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
echo -e "${GREEN}Contract IDs saved to contracts.json${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════

echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                      Deployment Complete!                                      ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${CYAN}Contract Addresses:${NC}"
echo "  Mock Oracle:    $MOCK_ORACLE_ID"
echo "  Oracle Adapter: $ORACLE_ADAPTER_ID"
echo "  Vault:          $VAULT_ID"
echo "  Market:         $MARKET_ID"
echo "  USDC Token:     $USDC_TOKEN_ID"
echo ""
echo -e "${CYAN}Admin:${NC} $ADMIN_PUBLIC_KEY"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Start the frontend: cd web && npm run dev"
echo "  2. Start the keeper bot: cd scripts/keeper && npm start"
echo "  3. Open http://localhost:3000 to use the application"
echo ""
